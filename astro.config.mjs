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
});
