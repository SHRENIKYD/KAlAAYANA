/**
 * Resolves a project photograph filename from the data to the image Astro
 * should process. Eager so every variant is generated at build time.
 *
 * Lives here rather than in a page because three routes need it: the home
 * page, the section gallery and the individual project page.
 */
import type { ImageMetadata } from 'astro';

const photos = import.meta.glob<{ default: ImageMetadata }>(
  '../images/projects/*.jpg', { eager: true });

export function photo(file: string): ImageMetadata {
  const found = photos[`../images/projects/${file}`];
  if (!found) throw new Error(`No photograph for ${file} — check src/data/projects.json`);
  return found.default;
}

const banners = import.meta.glob<{ default: ImageMetadata }>(
  '../images/sections/*.jpg', { eager: true });

export function banner(file: string): ImageMetadata {
  const found = banners[`../images/sections/${file}`];
  if (!found) throw new Error(`No banner image for ${file} — check src/data/site.json`);
  return found.default;
}
