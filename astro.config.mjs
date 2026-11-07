// @ts-check
import { defineConfig } from 'astro/config';

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
