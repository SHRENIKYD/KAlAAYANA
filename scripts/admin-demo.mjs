// Runs the content admin locally with no Cloudflare, GitHub or token.
// Serves the staging build and answers /admin/api/* from the working tree;
// Save validates exactly as the Worker does, then writes the result into
// .admin-demo/ instead of committing. Nothing in the repository changes.
//   npm run build:staging && node scripts/admin-demo.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { validate, orphans, imageType, MAX_IMAGE_BYTES } from '../worker/validate.js';

const port = Number(process.argv[2] || 8788);
const dist = path.resolve('dist');
const out = path.resolve('.admin-demo');
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

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/admin/api/content') {
      const site = readJson('src/data/site.json');
      return json(res, {
        email: 'demo@localhost',
        base: 'local working tree (demo)',
        projects: readJson('src/data/projects.json'),
        sections: site.sections,
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
    if (req.method === 'POST' && url.pathname === '/admin/api/save') {
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
      if (problems.length) return json(res, { error: 'Not saved', problems }, 422);
      const site = { ...readJson('src/data/site.json'), sections: payload.sections };
      fs.rmSync(out, { recursive: true, force: true });
      fs.mkdirSync(path.join(out, 'images/projects'), { recursive: true });
      fs.mkdirSync(path.join(out, 'images/sections'), { recursive: true });
      fs.writeFileSync(
        path.join(out, 'projects.json'),
        JSON.stringify(payload.projects, null, 2) + '\n',
      );
      fs.writeFileSync(path.join(out, 'site.json'), JSON.stringify(site, null, 2) + '\n');
      for (const [f, b] of Object.entries(uploads))
        fs.writeFileSync(path.join(out, 'images/projects', f), b);
      for (const [f, b] of Object.entries(banners))
        fs.writeFileSync(path.join(out, 'images/sections', f), b);
      const deletions = orphans(readJson('src/data/projects.json'), payload.projects, projectFiles);
      fs.writeFileSync(
        path.join(out, 'DELETIONS.txt'),
        deletions.join('\n') + (deletions.length ? '\n' : ''),
      );
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
