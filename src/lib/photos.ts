/**
 * Resolves a project photograph filename from the data to the image Astro
 * should process. Eager so every variant is generated at build time.
 *
 * Lives here rather than in a page because three routes need it: the home
 * page, the section gallery and the individual project page.
 */
import type { ImageMetadata } from 'astro';

const photos = import.meta.glob<{ default: ImageMetadata }>('../images/projects/*.{jpg,png}', {
  eager: true,
});

export function photo(file: string): ImageMetadata {
  const found = photos[`../images/projects/${file}`];
  if (!found) throw new Error(`No photograph for ${file} — check src/data/projects.json`);
  return found.default;
}

const banners = import.meta.glob<{ default: ImageMetadata }>('../images/sections/*.jpg', {
  eager: true,
});

export function banner(file: string): ImageMetadata {
  const found = banners[`../images/sections/${file}`];
  if (!found) throw new Error(`No banner image for ${file} — check src/data/site.json`);
  return found.default;
}

/** The long edge every served photograph is capped at; matches src/lib/image-service.mjs. */
export const MAX_EDGE = 2000;

/** Responsive variants up to MAX_EDGE on the long edge, never larger than the original. */
export function photoWidths(source: ImageMetadata): number[] {
  const scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
  const limit = Math.floor(source.width * scale);
  return [...new Set([640, 960, 1400, limit].filter((width) => width <= limit))].sort(
    (a, b) => a - b,
  );
}

/** A homepage feature image: a project photograph or a section banner. */
export function homeImage(image: { from: string; file: string }): ImageMetadata {
  if (image.from === 'sections') return banner(image.file);
  if (image.from === 'projects') return photo(image.file);
  throw new Error(`Unknown image source ${image.from} — check site.json home.works`);
}
