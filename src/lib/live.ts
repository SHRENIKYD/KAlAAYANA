import { existsSync } from 'node:fs';

/**
 * Build-time switch for the public launch. While the LIVE marker is absent the
 * holding page is the only indexable route; once it exists the full site is
 * served at the root, every page is indexable and the sitemap lists them.
 */
export const LIVE = existsSync('LIVE');
