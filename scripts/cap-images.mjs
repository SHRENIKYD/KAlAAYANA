// After the build: no photograph in dist/_astro may be larger than the cap
// on its long edge. Astro can leave unreferenced copies of originals there;
// those are deleted. A referenced image over the cap fails the build, since
// it would hand out a full-resolution original.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const MAX_EDGE = 2000;
const dir = 'dist/_astro';
const raster = /\.(?:jpe?g|png|webp|avif|gif|tiff?)$/i;

const texts = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(?:html|css|js|mjs|json|xml|txt|webmanifest)$/i.test(e.name))
      texts.push(fs.readFileSync(p, 'utf8'));
  }
};
walk('dist');
const all = texts.join('\n');

let removed = 0;
const bad = [];
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!raster.test(name)) continue;
  const file = path.join(dir, name);
  const { width = 0, height = 0 } = await sharp(file).metadata();
  if (Math.max(width, height) <= MAX_EDGE) continue;
  if (all.includes(name)) bad.push(`${name} (${width}x${height})`);
  else {
    fs.rmSync(file);
    removed += 1;
  }
}
console.log(`cap-images: removed ${removed} unreferenced original(s) over ${MAX_EDGE}px`);
if (bad.length) {
  console.error(`cap-images: served images over ${MAX_EDGE}px:\n  ${bad.join('\n  ')}`);
  process.exit(1);
}
