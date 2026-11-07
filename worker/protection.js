// The studio's on/off switches for the watermarks, kept in site.json under
// "protection". Missing switches count as on. Shared by the Worker, the
// local demo and the build.
export const PROTECTION_DEFAULTS = { watermarkPhotos: true, watermarkAdmin: true };

export function protectionOf(site) {
  const p = (site && site.protection) || {};
  return {
    watermarkPhotos: p.watermarkPhotos !== false,
    watermarkAdmin: p.watermarkAdmin !== false,
  };
}

/** Problems with a protection setting sent by the admin; empty when it can be saved. */
export function validateProtection(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['protection must be an object'];
  const bad = [];
  for (const key of Object.keys(p))
    if (!(key in PROTECTION_DEFAULTS)) bad.push(`Unknown protection setting ${key}`);
  for (const key of Object.keys(PROTECTION_DEFAULTS))
    if (typeof p[key] !== 'boolean') bad.push(`${key} must be on or off`);
  return bad;
}

export const sameProtection = (a, b) =>
  JSON.stringify(protectionOf({ protection: a })) ===
  JSON.stringify(protectionOf({ protection: b }));
