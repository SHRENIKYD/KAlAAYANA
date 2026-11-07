// @ts-check
import { defineConfig } from 'astro/config';
import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { featuresOf } from './worker/features.js';

// Cached images were made with the watermark switch as it was then; when the
// switch changes, the cache is cleared so every photograph is made again.
const marking = JSON.stringify({
  watermarkPhotos: featuresOf(JSON.parse(readFileSync('src/data/site.json', 'utf8')))
    .watermarkPhotos,
});
const stamp = 'node_modules/.astro/watermark-setting';
if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== marking) {
  rmSync('node_modules/.astro/assets', { recursive: true, force: true });
  mkdirSync('node_modules/.astro', { recursive: true });
  writeFileSync(stamp, marking);
}

export default defineConfig({
  devToolbar: {
    enabled: false,
  },
  trailingSlash: 'always',
  site: 'https://kalaayanastudios.com',
  outDir: './dist',
  publicDir: './public',
  build: {
    format: 'directory',
  },
  // Watermarks the studio's photographs and caps their size (see the file).
  image: {
    service: { entrypoint: './src/lib/image-service.mjs' },
  },
});
