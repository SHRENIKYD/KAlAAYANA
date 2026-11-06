// Staging Worker. Serves the built site as static assets and answers the
// content admin under /admin/api/. Every admin request must carry the Access
// JWT for an allow-listed email; the Worker then commits content changes to
// GitHub and opens a pull request into the base branch.
import { client, treeEntries, commitAndOpenPr } from './github.js';
import { verifyAccessJwt } from './access.js';
import { validate, orphans, imageType, MAX_IMAGE_BYTES } from './validate.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function identify(request, env) {
  const url = new URL(request.url);
  if (env.DEV_EMAIL && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    return env.DEV_EMAIL;
  const email = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
  });
  const allowed = (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(email)) throw new Error(`${email} is not an admin`);
  return email;
}

function decodeUploads(map) {
  const out = {};
  for (const [file, b64] of Object.entries(map || {})) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${file} is larger than 20 MB`);
    const type = imageType(bytes);
    if (!type || !file.endsWith('.' + type))
      throw new Error(`${file} is not a ${file.split('.').pop()} image`);
    out[file] = b64;
  }
  return out;
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/admin\/api/, '');
  let email;
  try {
    email = await identify(request, env);
  } catch (e) {
    return json({ error: e.message }, 403);
  }
  const gh = client(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const base = env.GITHUB_BASE || 'develop';

  if (request.method === 'GET' && route === '/content') {
    const [projects, site, projectFiles, bannerFiles] = await Promise.all([
      gh.file('src/data/projects.json', base).then((r) => r.json()),
      gh.file('src/data/site.json', base).then((r) => r.json()),
      gh.listDir('src/images/projects', base),
      gh.listDir('src/images/sections', base),
    ]);
    return json({
      email,
      base,
      projects,
      sections: site.sections,
      projectFiles: [...projectFiles],
      bannerFiles: [...bannerFiles],
    });
  }

  const image = route.match(/^\/image\/(projects|sections)\/([a-z0-9-]+\.(?:jpg|png))$/);
  if (request.method === 'GET' && image) {
    const res = await gh.file(`src/images/${image[1]}/${image[2]}`, base);
    return new Response(res.body, {
      headers: {
        'content-type': image[2].endsWith('.png') ? 'image/png' : 'image/jpeg',
        'cache-control': 'private, max-age=300',
      },
    });
  }

  if (request.method === 'POST' && route === '/save') {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }
    const [site, before, projectFiles, bannerFiles] = await Promise.all([
      gh.file('src/data/site.json', base).then((r) => r.json()),
      gh.file('src/data/projects.json', base).then((r) => r.json()),
      gh.listDir('src/images/projects', base),
      gh.listDir('src/images/sections', base),
    ]);
    let uploads, banners;
    try {
      uploads = decodeUploads(payload.uploads);
      banners = decodeUploads(payload.banners);
    } catch (e) {
      return json({ error: e.message }, 400);
    }
    const problems = validate({ ...payload, uploads, banners }, projectFiles, bannerFiles);
    if (problems.length) return json({ error: 'Not saved', problems }, 422);

    const blobSha = async (b64) =>
      (await gh.call('POST', '/git/blobs', { content: b64, encoding: 'base64' })).sha;
    const uploadShas = Object.fromEntries(
      await Promise.all(Object.entries(uploads).map(async ([f, b]) => [f, await blobSha(b)])),
    );
    const bannerShas = Object.fromEntries(
      await Promise.all(Object.entries(banners).map(async ([f, b]) => [f, await blobSha(b)])),
    );
    const deletions = orphans(before, payload.projects, projectFiles);

    const nextSite = { ...site, sections: payload.sections };
    const entries = treeEntries({
      projectsJson: JSON.stringify(payload.projects, null, 2) + '\n',
      siteJson: JSON.stringify(nextSite, null, 2) + '\n',
      uploads: uploadShas,
      banners: bannerShas,
      deletions,
    });
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
      .toLowerCase();
    const summary = String(payload.message || 'Content update')
      .trim()
      .slice(0, 72);
    const author = { name: email.split('@')[0], email };
    const body = [
      `Saved from the content admin by ${email}.`,
      '',
      `- ${payload.projects.length} project(s), ${Object.keys(payload.sections).length} section(s)`,
      `- ${Object.keys(uploads).length} image(s) added, ${deletions.length} removed, ${Object.keys(banners).length} banner(s) added`,
    ].join('\n');
    try {
      const result = await commitAndOpenPr(gh, {
        base,
        branch: `content/${stamp}`,
        message: `content: ${summary}\n\n${body}`,
        author,
        entries,
        title: `Content: ${summary}`,
        body,
      });
      return json(result);
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/admin/api/')) {
      try {
        return await handleApi(request, env);
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
