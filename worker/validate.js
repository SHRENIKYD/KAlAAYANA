// Mirrors scripts/check.py so a save that would fail CI is refused here first.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png)$/;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function imageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'jpg';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png';
  return null;
}

/**
 * @param {object} payload  { projects, sections, uploads: {[file]: base64}, message }
 * @param {Set<string>} existingProjectFiles  filenames already in src/images/projects
 * @param {Set<string>} existingBannerFiles   filenames already in src/images/sections
 * @returns {string[]} problems, empty when the payload is acceptable
 */
export function validate(payload, existingProjectFiles, existingBannerFiles) {
  const bad = [];
  const { projects, sections, uploads = {}, banners = {} } = payload || {};
  if (!Array.isArray(projects)) return ['projects must be a list'];
  if (!sections || typeof sections !== 'object' || Array.isArray(sections))
    return ['sections must be an object'];

  for (const [key, s] of Object.entries(sections)) {
    if (!SLUG.test(key))
      bad.push(`section key ${JSON.stringify(key)} must be lowercase letters, digits and hyphens`);
    for (const f of ['eyebrow', 'title', 'lede', 'banner', 'bannerAlt']) {
      if (!String(s?.[f] ?? '').trim()) bad.push(`section ${key} is missing ${f}`);
    }
    if (s?.href !== `/${key}/`) bad.push(`section ${key} href must be /${key}/`);
    if (s?.banner && !FILE.test(s.banner))
      bad.push(`section ${key} banner ${s.banner} must be a lowercase .jpg or .png name`);
    if (s?.banner && !existingBannerFiles.has(s.banner) && !(s.banner in banners))
      bad.push(`section ${key} banner ${s.banner} is not uploaded`);
  }

  const seen = new Set();
  const referenced = new Set();
  projects.forEach((p, i) => {
    const where = p?.slug || `#${i}`;
    for (const f of ['slug', 'group', 'title', 'scale', 'description']) {
      if (!String(p?.[f] ?? '').trim()) bad.push(`project ${where} is missing ${f}`);
    }
    if (p?.slug && !SLUG.test(p.slug))
      bad.push(`project ${where} slug must be lowercase letters, digits and hyphens`);
    if (seen.has(p?.slug)) bad.push(`project slug ${where} is used twice`);
    seen.add(p?.slug);
    if (p?.group && !(p.group in sections))
      bad.push(`project ${where} has unknown section ${p.group}`);
    if (!Array.isArray(p?.images) || p.images.length === 0)
      bad.push(`project ${where} needs at least one image`);
    else
      p.images.forEach((img, j) => {
        if (!FILE.test(img?.file || ''))
          bad.push(`project ${where} image ${j + 1} has an invalid file name`);
        else {
          referenced.add(img.file);
          if (!existingProjectFiles.has(img.file) && !(img.file in uploads))
            bad.push(`project ${where} image ${img.file} is not uploaded`);
        }
        if (!String(img?.alt ?? '').trim())
          bad.push(`project ${where} image ${j + 1} needs alt text`);
      });
  });
  for (const file of Object.keys(uploads))
    if (!referenced.has(file)) bad.push(`uploaded ${file} is not used by any project`);
  for (const file of Object.keys(banners)) {
    if (!Object.values(sections).some((s) => s.banner === file))
      bad.push(`uploaded banner ${file} is not used by any section`);
  }
  return bad;
}

/** Image files no project references any more, so the commit removes them. */
export function orphans(projects, existingProjectFiles) {
  const used = new Set(projects.flatMap((p) => p.images.map((i) => i.file)));
  return [...existingProjectFiles].filter((f) => !used.has(f)).sort();
}
