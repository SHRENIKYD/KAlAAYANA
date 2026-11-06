// Staging Worker. Serves the built site as static assets and answers the
// content admin under /admin/api/. Every admin request must carry the Access
// JWT for an allow-listed email; the Worker then commits content changes to
// GitHub and opens a pull request into the base branch.
import {
  client,
  treeEntries,
  commitToBranch,
  acceptBranch,
  rejectBranch,
  branchAlias,
} from './github.js';
import { syncAccessPolicy } from './policy.js';
import { fetchInsights } from './insights.js';
import { verifyAccessJwt } from './access.js';
import { makeEntry, parseLog, decodePhoto } from './logbook.js';
import {
  validate,
  orphans,
  photoRequiredFor,
  PERMANENT_SUPERADMIN,
  imageType,
  MAX_IMAGE_BYTES,
  parseUsers,
  roleOf,
  restrictForAdmin,
  applyUserChange,
} from './validate.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// Sessions last one hour from sign-in, whatever Access itself allows.
const SESSION_SECONDS = 3600;

async function identify(request, env) {
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  if (env.DEV_EMAIL && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
    return { email: env.DEV_EMAIL, sessionEnds: (now + SESSION_SECONDS) * 1000 };
  const { email, iat } = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), {
    teamDomain: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
  });
  if (now - iat > SESSION_SECONDS)
    throw Object.assign(new Error('Your session has ended. Sign in again.'), {
      email,
      expired: true,
    });
  return { email, sessionEnds: (iat + SESSION_SECONDS) * 1000 };
}

// Who may edit, and as what, lives in admin/users.json on the base branch.
// ADMIN_EMAILS (comma-separated) is a fallback that grants superadmin while
// the file is missing, so the first superadmin can be invited through the UI.
async function usersOf(gh, base, env) {
  try {
    const users = parseUsers(await gh.file('admin/users.json', base).then((r) => r.text()));
    if (users.length) return users;
  } catch {
    /* fall through */
  }
  return (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .map((email) => ({ email, role: 'superadmin', invitedBy: null, invitedAt: null }));
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

// Reads a file from the base branch, '' when it does not exist yet.
const textOr = (gh, path, base, fallback = '') =>
  gh
    .file(path, base)
    .then((r) => r.text())
    .catch(() => fallback);

// Tree entries that append log items to logs/admin-log.jsonl and
// CONTENT-LOG.md and add their photographs. Existing lines are never touched.
async function logTreeEntries(gh, base, items) {
  const [jsonl, md] = await Promise.all([
    textOr(gh, 'logs/admin-log.jsonl', base),
    textOr(
      gh,
      'CONTENT-LOG.md',
      base,
      '# Content log\n\nOne line per change made through the content admin.\n\n',
    ),
  ]);
  const entries = [
    {
      path: 'logs/admin-log.jsonl',
      mode: '100644',
      type: 'blob',
      content: jsonl.replace(/\n*$/, jsonl ? '\n' : '') + items.map((i) => i.json).join(''),
    },
    {
      path: 'CONTENT-LOG.md',
      mode: '100644',
      type: 'blob',
      content: md.replace(/\n*$/, '\n') + items.map((i) => i.md).join(''),
    },
  ];
  for (const i of items)
    if (i.photoPath && i.photoBytes) {
      const b64 = btoa(String.fromCharCode(...i.photoBytes));
      const blob = await gh.call('POST', '/git/blobs', { content: b64, encoding: 'base64' });
      entries.push({ path: i.photoPath, mode: '100644', type: 'blob', sha: blob.sha });
    }
  return entries;
}

// One commit straight onto the base branch. Entries are built against the
// branch head at the moment of the commit, so if another commit lands first
// the head moves, the update is refused as not-a-fast-forward, and the whole
// commit is rebuilt on the new head. If the branch refuses direct commits
// altogether, the same commit goes up as a pull request that merges itself.
async function commitToBase(gh, base, { entries, message, author }, attempts = 4) {
  let commit;
  for (let i = 0; i < attempts; i++) {
    const head = await gh.call('GET', `/git/ref/heads/${base}`);
    const baseCommit = await gh.call('GET', `/git/commits/${head.object.sha}`);
    const tree = await gh.call('POST', '/git/trees', {
      base_tree: baseCommit.tree.sha,
      tree: typeof entries === 'function' ? await entries(head.object.sha) : entries,
    });
    commit = await gh.call('POST', '/git/commits', {
      message,
      tree: tree.sha,
      parents: [head.object.sha],
      author,
      committer: author,
    });
    try {
      await gh.call('PATCH', `/git/refs/heads/${base}`, { sha: commit.sha });
      return { commit: commit.sha };
    } catch (e) {
      if (!/fast forward/i.test(e.message)) break;
    }
  }
  const branch = `log/${commit.sha.slice(0, 10)}`;
  await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
  const pr = await gh.call('POST', '/pulls', {
    title: message.split('\n')[0],
    head: branch,
    base,
    body: message,
  });
  try {
    await gh.graphql(
      'mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: MERGE}) { clientMutationId } }',
      { id: pr.node_id },
    );
  } catch {
    /* merged by hand */
  }
  return { commit: commit.sha, pr: pr.number };
}

// Appends log items to the branch head as it is at commit time.
function logCommit(gh, base, items, message, author) {
  return commitToBase(gh, base, {
    entries: (sha) => logTreeEntries(gh, sha, items),
    message,
    author,
  });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/admin\/api/, '');
  let email;
  let sessionEnds;
  try {
    ({ email, sessionEnds } = await identify(request, env));
  } catch (e) {
    return json(
      { error: e.message, email: e.email, expired: Boolean(e.expired) },
      e.expired ? 401 : 403,
    );
  }
  const gh = client(env.GITHUB_TOKEN, env.GITHUB_REPO);
  const base = env.GITHUB_BASE || 'develop';
  // Everything /content needs is requested at once, before the role is known,
  // so the page waits for one round trip to GitHub rather than three.
  const content =
    request.method === 'GET' && route === '/content'
      ? {
          projects: gh.file('src/data/projects.json', base).then((r) => r.json()),
          site: gh.file('src/data/site.json', base).then((r) => r.json()),
          projectFiles: gh.listDir('src/images/projects', base),
          bannerFiles: gh.listDir('src/images/sections', base),
          log: textOr(gh, 'logs/admin-log.jsonl', base),
          prs: gh.call('GET', '/pulls?state=all&sort=created&direction=desc&per_page=30'),
        }
      : null;
  if (content) for (const p of Object.values(content)) p.catch(() => {});
  const users = await usersOf(gh, base, env);
  const role = roleOf(users, email);
  if (!role) return json({ error: `${email} is not an admin`, email }, 403);
  const superadmin = role === 'superadmin';
  const name = String(request.headers.get('x-admin-name') || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 60);
  const author = { name: name || email.split('@')[0], email };
  const logItem = (fields) => makeEntry({ email, name, ...fields });

  if (request.method === 'GET' && route === '/content') {
    const [projects, site, projectFiles, bannerFiles] = await Promise.all([
      content.projects,
      content.site,
      content.projectFiles,
      content.bannerFiles,
    ]);
    let log = null;
    let decisions = null;
    if (superadmin) {
      log = parseLog(await content.log);
      const prs = await content.prs.catch(() => []);
      decisions = prs
        .filter((pr) => pr.head?.ref?.startsWith('content/'))
        .map((pr) => ({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          by: pr.user?.login,
          at: pr.created_at,
          state: pr.merged_at ? 'published' : pr.state === 'closed' ? 'rejected' : 'proposed',
          decidedAt: pr.merged_at || pr.closed_at || null,
        }));
    }
    return json({
      email,
      sessionEnds,
      role,
      photoRequired: photoRequiredFor(users, email),
      canSetPhoto: email === PERMANENT_SUPERADMIN,
      users: superadmin ? users : undefined,
      log,
      decisions,
      base,
      projects,
      sections: site.sections,
      home: site.home,
      projectFiles: [...projectFiles],
      bannerFiles: [...bannerFiles],
    });
  }

  // Website insights, for every editor. Needs CF_API_TOKEN with Account
  // Analytics: Read and the Web Analytics site tag.
  if (request.method === 'GET' && route === '/insights') {
    if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID || !env.CF_WEB_ANALYTICS_SITE_TAG)
      return json(
        {
          error:
            'Insights are not set up yet: the Worker needs CF_API_TOKEN (with Account Analytics: Read) and CF_WEB_ANALYTICS_SITE_TAG.',
          unconfigured: true,
        },
        503,
      );
    try {
      const data = await fetchInsights({
        token: env.CF_API_TOKEN,
        accountId: env.CF_ACCOUNT_ID,
        siteTag: env.CF_WEB_ANALYTICS_SITE_TAG,
        days: url.searchParams.get('days'),
      });
      return json(data);
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  const image = route.match(/^\/image\/(projects|sections)\/([a-z0-9-]+\.(?:jpg|png))$/);
  if (request.method === 'GET' && image) {
    const res = await gh.file(`src/images/${image[1]}/${image[2]}`, base);
    return new Response(res.body, {
      headers: {
        'content-type': image[2].endsWith('.png') ? 'image/png' : 'image/jpeg',
        'cache-control': 'private, max-age=1800',
      },
    });
  }

  // Cloudflare builds every pull request's branch and comments its preview URL
  // on the PR. The admin polls this until the comment exists.
  // Cloudflare builds every pushed branch and serves it at a branch alias;
  // the preview is ready when that alias reports the proposed commit.
  if (request.method === 'GET' && route === '/preview-ready') {
    const branch = url.searchParams.get('branch') || '';
    const commit = url.searchParams.get('commit') || '';
    if (!/^content\/[a-z0-9]+$/.test(branch) || !/^[0-9a-f]{7,40}$/.test(commit))
      return json({ error: 'Bad branch or commit' }, 400);
    const previewHost = `${branchAlias(branch)}-${url.hostname}`;
    try {
      const res = await fetch(`https://${previewHost}/version.json`, {
        headers: { accept: 'application/json' },
        cf: { cacheTtl: 0 },
      });
      const v = res.ok ? await res.json() : null;
      const ready = Boolean(v && String(v.commit || '').startsWith(commit.slice(0, 7)));
      return json({ ready, url: ready ? `https://${previewHost}` : null });
    } catch {
      return json({ ready: false, url: null });
    }
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
    if (!superadmin)
      problems.push(
        ...restrictForAdmin(
          { sections: site.sections, home: site.home, projects: before },
          payload,
        ),
      );
    if (problems.length) return json({ error: 'Not saved', problems }, 422);

    const blobSha = async (b64) =>
      (await gh.call('POST', '/git/blobs', { content: b64, encoding: 'base64' })).sha;
    const uploadShas = Object.fromEntries(
      await Promise.all(Object.entries(uploads).map(async ([f, b]) => [f, await blobSha(b)])),
    );
    const bannerShas = Object.fromEntries(
      await Promise.all(Object.entries(banners).map(async ([f, b]) => [f, await blobSha(b)])),
    );
    // A banner chosen from an existing photograph reuses that blob: no re-upload.
    const copies = payload.bannerCopies || {};
    for (const [file, source] of Object.entries(copies)) {
      bannerShas[file] = uploadShas[source]
        ? uploadShas[source]
        : (
            await gh.call(
              'GET',
              `/contents/src/images/projects/${source}?ref=${encodeURIComponent(base)}`,
            )
          ).sha;
    }
    const deletions = orphans(
      before,
      payload.projects,
      projectFiles,
      payload.home.works.filter((w) => w.image.from === 'projects').map((w) => w.image.file),
    );

    const nextSite = { ...site, sections: payload.sections, home: payload.home };
    const saveItem = logItem({
      category: 'content',
      action: 'proposed',
      details: `"${String(payload.message || 'Content update')
        .trim()
        .slice(
          0,
          72,
        )}" · ${Object.keys(uploads).length} photograph(s) added, ${deletions.length} deleted, ${Object.keys(banners).length} banner(s) added`,
    });
    const entries = [
      ...treeEntries({
        projectsJson: JSON.stringify(payload.projects, null, 2) + '\n',
        siteJson: JSON.stringify(nextSite, null, 2) + '\n',
        uploads: uploadShas,
        banners: bannerShas,
        deletions,
      }),
    ];
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z')
      .toLowerCase();
    const summary = String(payload.message || 'Content update')
      .trim()
      .slice(0, 72);
    const body = [
      `Saved from the content admin by ${name ? `${name} (${email})` : email}.`,
      '',
      `- ${payload.projects.length} project(s), ${Object.keys(payload.sections).length} section(s)`,
      `- ${Object.keys(uploads).length} image(s) added, ${deletions.length} removed, ${Object.keys(banners).length} banner(s) added`,
    ].join('\n');
    try {
      const result = await commitToBranch(gh, {
        base,
        branch: `content/${stamp}`,
        message: `content: ${summary}\n\n${body}`,
        author,
        entries,
      });
      try {
        await logCommit(gh, base, [saveItem], `log: proposed ${result.branch}`, author);
      } catch {
        /* the proposal is the branch itself */
      }
      return json({ ...result, title: `Content: ${summary}`, body });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }
  if (request.method === 'POST' && route === '/users') {
    if (!superadmin) return json({ error: 'Only a superadmin can manage users' }, 403);
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }
    let next;
    try {
      next = applyUserChange(users, body, email);
    } catch (e) {
      return json({ error: e.message }, body.action === 'photo' ? 403 : 422);
    }
    // Access decides who may sign in at all; keep its Allow list equal to
    // the editors' emails. A failure here is recorded, not fatal: the user
    // change still commits, and the note tells the superadmin what to do.
    let access = 'Access policy not managed here';
    if (env.CF_API_TOKEN && env.CF_ACCOUNT_ID) {
      try {
        await syncAccessPolicy({
          token: env.CF_API_TOKEN,
          accountId: env.CF_ACCOUNT_ID,
          hostname: url.hostname,
          emails: next.map((u) => u.email),
        });
        access = 'Access policy updated';
      } catch (e) {
        access = `Access policy NOT updated: ${e.message}`;
      }
    }
    const item = logItem({
      category: 'admin',
      action: `users: ${body.action}`,
      details: `${String(body.email).toLowerCase()}${body.role ? ` as ${body.role}` : ''}${body.photo ? ` · photograph ${body.photo}` : ''} · ${access}`,
    });
    try {
      const r = await commitToBase(gh, base, {
        entries: async (sha) => [
          {
            path: 'admin/users.json',
            mode: '100644',
            type: 'blob',
            content: JSON.stringify({ users: next }, null, 2) + '\n',
          },
          ...(await logTreeEntries(gh, sha, [item])),
        ],
        message: `admin: ${body.action} ${String(body.email).toLowerCase()}${body.role ? ` as ${body.role}` : ''}\n\nBy ${name ? `${name} (${email})` : email} from the content admin.`,
        author,
      });
      return json({ users: next, access, ...r });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  // Who is using this account: name, and a photograph when the device has a
  // camera. Logged, with the photograph, in a commit nothing can take back.
  if (request.method === 'POST' && route === '/session') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }
    const who = String(body.name || '')
      .trim()
      .slice(0, 60);
    if (!who) return json({ error: 'Enter your name' }, 422);
    let photoBytes = null;
    try {
      photoBytes = decodePhoto(body.photo);
    } catch (e) {
      return json({ error: e.message }, 422);
    }
    if (!photoBytes && photoRequiredFor(users, email))
      return json(
        {
          error:
            'A photograph is required to sign in with this account. Use a device with a camera.',
        },
        422,
      );
    const item = makeEntry({
      category: 'session',
      email,
      name: who,
      action: 'signed in',
      details: photoBytes ? 'with photograph' : 'no camera',
      photo: Boolean(photoBytes),
    });
    item.photoBytes = photoBytes;
    try {
      const r = await logCommit(gh, base, [item], `log: ${who} signed in as ${email}`, {
        name: who,
        email,
      });
      return json({ ok: true, name: who, ...r });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  // Errors the admin page reports, and anything else worth a line.
  if (request.method === 'POST' && route === '/log') {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }
    if (body.category !== 'error')
      return json({ error: 'Only error entries can be logged directly' }, 422);
    const item = logItem({
      category: 'error',
      action: String(body.action || 'admin page error').slice(0, 80),
      details: body.details,
    });
    try {
      const r = await logCommit(gh, base, [item], `log: error — ${item.entry.action}`, author);
      return json({ ok: true, ...r });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  }

  const photo = route.match(/^\/photo\/(logs\/photos\/[a-zA-Z0-9.-]+\.jpg)$/);
  if (request.method === 'GET' && photo) {
    if (!superadmin) return json({ error: 'Only a superadmin can see the log' }, 403);
    const r = await gh.file(photo[1], base);
    return new Response(r.body, {
      headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' },
    });
  }

  // Accept opens the pull request and merges it; reject drops the branch.
  // Either way the decision is logged, and a branch already decided on
  // (gone) cannot be decided twice.
  const decide = route.match(/^\/(accept|reject)$/);
  if (request.method === 'POST' && decide) {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const branch = String(body.branch || '');
    if (!/^content\/[a-z0-9]+$/.test(branch)) return json({ error: 'Not a content branch' }, 400);
    const at = new Date().toISOString();
    try {
      try {
        await gh.call('GET', `/git/ref/heads/${branch}`);
      } catch {
        return json({ error: 'This proposal was already accepted or rejected.' }, 409);
      }
      const who = name ? `${name} (${email})` : email;
      const result =
        decide[1] === 'accept'
          ? await acceptBranch(gh, {
              base,
              branch,
              title: String(body.title || 'Content update').slice(0, 120),
              body: `${String(body.body || '')}\n\nAccepted by ${who} at ${at}.`,
              email: who,
              at,
              previewUrl: body.previewUrl,
            })
          : await rejectBranch(gh, branch);
      const item = logItem({
        category: 'content',
        action: decide[1] === 'accept' ? 'accepted' : 'rejected',
        details:
          decide[1] === 'accept'
            ? `pull request #${result.number} from ${branch}${body.previewUrl ? ` after previewing ${body.previewUrl}` : ''}`
            : `${branch}${body.previewUrl ? ` after previewing ${body.previewUrl}` : ''}`,
      });
      try {
        await logCommit(gh, base, [item], `log: ${item.entry.action} ${branch}`, author);
      } catch {
        /* the decision is on the pull request or in the dropped branch */
      }
      return json({ ...result, email, name, at });
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
