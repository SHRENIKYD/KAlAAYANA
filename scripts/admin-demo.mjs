// Runs the content admin locally with no Cloudflare, GitHub or token.
// Serves the staging build and answers /admin/api/* from the working tree;
// Save validates exactly as the Worker does, then writes the result into
// .admin-demo/ instead of committing. Nothing in the repository changes.
//   npm run admin:demo   (or: npm run build && node scripts/admin-demo.mjs [port])
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { validate, orphans, imageType, MAX_IMAGE_BYTES } from '../worker/validate.js';
import { spawn } from 'node:child_process';

const port = Number(process.argv[2] || 8788);
const dist = path.resolve('dist');
const out = path.resolve('.admin-demo');
const previewRoot = path.join(out, 'preview');
let previewReady = false;
// Who may sign in to the demo. Mirrors ADMIN_EMAILS on the Worker.
const DEMO_ADMINS = (process.env.DEMO_ADMINS || 'demo@localhost,studio@kalaayanastudios.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const signedIn = (req) => {
  const m = /(?:^|;\s*)demo-user=([^;]+)/.exec(req.headers.cookie || '');
  const email = m ? decodeURIComponent(m[1]).toLowerCase() : '';
  return DEMO_ADMINS.includes(email) ? email : null;
};
const walk = (d) =>
  fs.readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return fs.statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
  });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
};
const json = (res, data, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const listDir = (p) =>
  new Set(fs.existsSync(p) ? fs.readdirSync(p).filter((f) => /\.(jpg|png)$/.test(f)) : []);

function decode(map) {
  const outMap = {};
  for (const [file, b64] of Object.entries(map || {})) {
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`${file} is larger than 20 MB`);
    const type = imageType(bytes);
    if (!type || !file.endsWith('.' + type))
      throw new Error(`${file} is not a ${file.split('.').pop()} image`);
    outMap[file] = bytes;
  }
  return outMap;
}

function materialize(dir, payload, uploads, banners, projectFiles) {
  const site = {
    ...readJson('src/data/site.json'),
    sections: payload.sections,
    home: payload.home,
  };
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'images/projects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'images/sections'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'projects.json'),
    JSON.stringify(payload.projects, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'site.json'), JSON.stringify(site, null, 2) + '\n');
  for (const [f, b] of Object.entries(uploads))
    fs.writeFileSync(path.join(dir, 'images/projects', f), b);
  for (const [f, source] of Object.entries(payload.bannerCopies || {}))
    fs.copyFileSync(
      uploads[source]
        ? path.join(dir, 'images/projects', source)
        : path.join('src/images/projects', source),
      path.join(dir, 'images/sections', f),
    );
  for (const [f, b] of Object.entries(banners))
    fs.writeFileSync(path.join(dir, 'images/sections', f), b);
  const deletions = orphans(
    readJson('src/data/projects.json'),
    payload.projects,
    projectFiles,
    payload.home.works.filter((w) => w.image.from === 'projects').map((w) => w.image.file),
  );
  fs.writeFileSync(
    path.join(dir, 'DELETIONS.txt'),
    deletions.join('\n') + (deletions.length ? '\n' : ''),
  );
  return deletions;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/admin/api/login') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let email = '';
      try {
        email = String(JSON.parse(body).email || '')
          .trim()
          .toLowerCase();
      } catch {}
      if (!DEMO_ADMINS.includes(email))
        return json(
          res,
          { error: `${email || 'That address'} is not on the editor list.`, demo: true },
          403,
        );
      res.setHeader(
        'set-cookie',
        `demo-user=${encodeURIComponent(email)}; Path=/admin; HttpOnly; SameSite=Lax`,
      );
      return json(res, { ok: true, email });
    }
    if (url.pathname.startsWith('/admin/api/') && !signedIn(req))
      return json(res, { error: 'Sign in to edit the site.', demo: true }, 401);
    if (url.pathname === '/admin/api/content') {
      const site = readJson('src/data/site.json');
      return json(res, {
        email: signedIn(req),
        demo: true,
        base: 'local working tree (demo)',
        projects: readJson('src/data/projects.json'),
        sections: site.sections,
        home: site.home,
        projectFiles: [...listDir('src/images/projects')],
        bannerFiles: [...listDir('src/images/sections')],
      });
    }
    const img = url.pathname.match(
      /^\/admin\/api\/image\/(projects|sections)\/([a-z0-9-]+\.(?:jpg|png))$/,
    );
    if (img) {
      const p = path.join('src/images', img[1], img[2]);
      if (!fs.existsSync(p)) return json(res, { error: 'missing' }, 404);
      res.writeHead(200, { 'content-type': types[path.extname(p)] });
      return fs.createReadStream(p).pipe(res);
    }
    if (
      req.method === 'POST' &&
      (url.pathname === '/admin/api/save' || url.pathname === '/admin/api/preview')
    ) {
      const isPreview = url.pathname.endsWith('/preview');
      let body = '';
      for await (const chunk of req) body += chunk;
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return json(res, { error: 'Body must be JSON' }, 400);
      }
      const projectFiles = listDir('src/images/projects'),
        bannerFiles = listDir('src/images/sections');
      let uploads, banners;
      try {
        uploads = decode(payload.uploads);
        banners = decode(payload.banners);
      } catch (e) {
        return json(res, { error: e.message }, 400);
      }
      const problems = validate({ ...payload, uploads, banners }, projectFiles, bannerFiles);
      if (problems.length)
        return json(res, { error: isPreview ? 'Cannot preview yet' : 'Not saved', problems }, 422);
      const target = isPreview ? path.join(previewRoot, 'input') : out;
      const deletions = materialize(target, payload, uploads, banners, projectFiles);
      if (!isPreview) {
        console.log(
          `saved → ${out} (${Object.keys(uploads).length} image(s) added, ${deletions.length} to delete) — "${payload.message || ''}"`,
        );
        return json(res, {
          demo: true,
          folder: '.admin-demo/',
          added: Object.keys(uploads).length,
          removed: deletions.length,
        });
      }
      // Preview: build the real site from a copy of the project with these
      // edits applied, so the page is exactly what a deploy would show.
      const started = Date.now();
      try {
        const site = path.join(previewRoot, 'site');
        fs.rmSync(site, { recursive: true, force: true });
        fs.mkdirSync(site, { recursive: true });
        for (const item of [
          'src',
          'public',
          'scripts',
          'astro.config.mjs',
          'package.json',
          'tsconfig.json',
          'VERSION',
        ])
          if (fs.existsSync(item)) fs.cpSync(item, path.join(site, item), { recursive: true });
        fs.symlinkSync(path.resolve('node_modules'), path.join(site, 'node_modules'), 'junction');
        fs.copyFileSync(
          path.join(target, 'projects.json'),
          path.join(site, 'src/data/projects.json'),
        );
        fs.copyFileSync(path.join(target, 'site.json'), path.join(site, 'src/data/site.json'));
        for (const kind of ['projects', 'sections'])
          for (const f of fs.readdirSync(path.join(target, 'images', kind)))
            fs.copyFileSync(
              path.join(target, 'images', kind, f),
              path.join(site, 'src/images', kind, f),
            );
        for (const f of deletions)
          fs.rmSync(path.join(site, 'src/images/projects', f), { force: true });
        // LIVE so the preview shows the launched site at /, like production after release.
        fs.writeFileSync(path.join(site, 'LIVE'), '');
        await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [path.resolve('node_modules/astro/bin/astro.mjs'), 'build'],
            {
              cwd: site,
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
          let log = '';
          child.stdout.on('data', (d) => (log += d));
          child.stderr.on('data', (d) => (log += d));
          child.on('close', (code) =>
            code === 0 ? resolve() : reject(new Error('astro build failed\n' + log.slice(-2000))),
          );
        });
        const built = path.join(site, 'dist');
        if (fs.existsSync(path.join(built, 'preview/index.html'))) {
          fs.copyFileSync(path.join(built, 'preview/index.html'), path.join(built, 'index.html'));
          for (const page of walk(built)) {
            const html = fs.readFileSync(page, 'utf8');
            fs.writeFileSync(page, html.replace(/href="\/preview\//g, 'href="/'));
          }
        }
        previewReady = true;
        const seconds = Math.round((Date.now() - started) / 1000);
        console.log(`preview built in ${seconds}s → http://localhost:${port}/admin/preview/`);
        return json(res, { url: '/admin/preview/', seconds });
      } catch (e) {
        return json(res, { error: e.message }, 500);
      }
    }
    if (url.pathname.startsWith('/admin/preview/')) {
      if (!previewReady) {
        res.writeHead(404);
        return res.end('No preview built yet');
      }
      const built = path.join(previewRoot, 'site/dist');
      let file = path.join(built, decodeURIComponent(url.pathname.slice('/admin/preview'.length)));
      if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
      if (!file.startsWith(built) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      let body = fs.readFileSync(file);
      if (file.endsWith('.html'))
        body = Buffer.from(
          body
            .toString('utf8')
            .replace(/(href|src|srcset|content)="\//g, '$1="/admin/preview/')
            .replace(/url\(\//g, 'url(/admin/preview/')
            .replace(/, \//g, ', /admin/preview/'),
        );
      res.writeHead(200, {
        'content-type': types[path.extname(file)] || 'application/octet-stream',
      });
      return res.end(body);
    }
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!file.startsWith(dist) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () =>
    console.log(
      `content admin demo: http://localhost:${port}/admin/  (saves go to .admin-demo/, nothing is committed)`,
    ),
  );
