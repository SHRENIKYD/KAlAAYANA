// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://kalaayanastudios.com',
  outDir: './dist',
  publicDir: './public',
  build: {
    // Emit page.html rather than page/index.html: GitHub Pages and the
    // Cloudflare asset handler both serve these directly, and it keeps the
    // deployed URLs identical to the hand-written site.
    format: 'file',
  },
});
