/**
 * Astro's sharp image service with two protections for the studio's work:
 *
 * - Every photograph is served at most MAX_EDGE pixels on its long edge,
 *   whatever size a page asks for, so no full-resolution original leaves the
 *   build.
 * - Project, collectables and section photographs carry the studio mark in
 *   the bottom-right corner, added to the original before resizing so every
 *   size and format has it. Portraits of the artists, story images and the
 *   holding-page hero are left clean.
 *
 * The files in src/images are never changed; only the built copies are.
 *
 * The mark is switched off with "protection.watermarkPhotos": false in
 * src/data/site.json (the admin's Users tab has the switch for the master
 * account); the size cap stays either way.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharpService from 'astro/assets/services/sharp';
import { protectionOf } from '../../worker/protection.js';

export const MAX_EDGE = 2000;
const UNMARKED = /(?:^|\/)(?:artist-|story-|hero-)[^/]*$/;
const MARK_SHARE = 0.16; // mark width as a share of the photograph's width
const MARGIN_SHARE = 0.025;

let sharp;
// The build bundles this file, so the mark is read from the project root.
let logo;
let markPhotos;
const marked = new Map();

const fileName = (src) =>
  String(typeof src === 'string' ? src : src?.src || '')
    .split('?')[0]
    .split('/')
    .pop()
    // Built assets are named <original>.<hash>.<ext>.
    .replace(/\.[A-Za-z0-9_-]{8}(\.[a-z0-9]+)$/i, '$1');

async function withMark(buffer, src) {
  const key = fileName(src);
  if (marked.has(key)) return marked.get(key);
  const job = (async () => {
    sharp ||= (await import('sharp')).default;
    logo ||= readFileSync(resolve(process.cwd(), 'public/assets/img/logo.svg'), 'utf8');
    const source = await sharp(buffer, { failOn: 'none' }).metadata();
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = Math.max(120, Math.round(info.width * MARK_SHARE));
    const margin = Math.round(info.width * MARGIN_SHARE);
    const tint = (fill, opacity) =>
      Buffer.from(
        logo
          .replace(/fill="#[0-9A-Fa-f]{3,6}"/g, `fill="${fill}"`)
          .replace('<svg ', `<svg opacity="${opacity}" `),
      );
    const light = await sharp(tint('#ffffff', 0.55), { density: 300 })
      .resize({ width })
      .png()
      .toBuffer();
    const shade = await sharp(tint('#000000', 0.3), { density: 300 })
      .resize({ width })
      .blur(Math.max(1, width / 160))
      .png()
      .toBuffer();
    const { height } = await sharp(light).metadata();
    const left = info.width - width - margin;
    const top = info.height - height - margin;
    const out = await sharp(data, {
      raw: { width: info.width, height: info.height, channels: info.channels },
    })
      .composite([
        { input: shade, left, top, blend: 'over' },
        { input: light, left, top, blend: 'over' },
      ])
      .toFormat(source.format === 'png' ? 'png' : 'jpeg', { quality: 95 })
      .toBuffer();
    return out;
  })();
  marked.set(key, job);
  return job;
}

/** The size to ask for: at most MAX_EDGE on the long edge, never upscaled. */
function capped(transform, source) {
  if (!source?.width || !source?.height) return transform;
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const maxWidth = Math.floor(source.width * scale);
  const width = Math.min(transform.width || source.width, maxWidth);
  if (transform.width && transform.width <= maxWidth) return transform;
  return {
    ...transform,
    width,
    height: transform.height ? Math.round((transform.height * width) / transform.width) : undefined,
  };
}

const service = {
  ...sharpService,
  async transform(inputBuffer, transformOptions, config, logger) {
    sharp ||= (await import('sharp')).default;
    const meta = await sharp(inputBuffer, { failOn: 'none' }).metadata();
    if (!meta.format || meta.format === 'svg') {
      return sharpService.transform(inputBuffer, transformOptions, config, logger);
    }
    const upright = (meta.orientation || 1) >= 5;
    const source = upright
      ? { width: meta.height, height: meta.width }
      : { width: meta.width, height: meta.height };
    const transform = capped(transformOptions, source);
    const name = fileName(transformOptions.src);
    markPhotos ??= protectionOf(
      JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/site.json'), 'utf8')),
    ).watermarkPhotos;
    const buffer =
      !markPhotos || UNMARKED.test(name)
        ? inputBuffer
        : await withMark(inputBuffer, transformOptions.src);
    return sharpService.transform(buffer, transform, config, logger);
  },
};

export default service;
