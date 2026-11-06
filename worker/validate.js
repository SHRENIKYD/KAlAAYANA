// Mirrors scripts/check.py so a save that would fail CI is refused here first.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png)$/;
const FOCUS = /^\d{1,3}% \d{1,3}%$/;
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
  const { projects, sections, uploads = {}, banners = {}, bannerCopies = {} } = payload || {};
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
    if (s?.bannerFocus != null && !FOCUS.test(String(s.bannerFocus)))
      bad.push(`section ${key} banner focus must look like 50% 40%`);
    if (s?.banner && !FILE.test(s.banner))
      bad.push(`section ${key} banner ${s.banner} must be a lowercase .jpg or .png name`);
    if (
      s?.banner &&
      !existingBannerFiles.has(s.banner) &&
      !(s.banner in banners) &&
      !(s.banner in bannerCopies)
    )
      bad.push(`section ${key} banner ${s.banner} is not uploaded`);
  }

  const works = payload.home?.works;
  if (!Array.isArray(works) || works.length === 0) bad.push('the homepage needs at least one work');
  const homeRefs = new Set();
  (Array.isArray(works) ? works : []).forEach((w, i) => {
    const where = `homepage work ${i + 1}`;
    for (const f of ['href', 'eyebrow', 'title', 'link']) {
      if (!String(w?.[f] ?? '').trim()) bad.push(`${where} is missing ${f}`);
    }
    if (w?.section != null) {
      if (!(w.section in sections))
        bad.push(`${where} names a work that does not exist: ${w.section}`);
      else if (w.href !== `/${w.section}/`) bad.push(`${where} must link to /${w.section}/`);
    }
    if (w?.href && !/^\/[a-z0-9-]+\/$/.test(w.href) && !/^#[a-z0-9-]+$/.test(w.href))
      bad.push(`${where} link must look like /section/`);
    const img = w?.image || {};
    if (!['projects', 'sections'].includes(img.from))
      bad.push(`${where} image source must be projects or sections`);
    else if (!FILE.test(img.file || '')) bad.push(`${where} has an invalid image file name`);
    else {
      const pool = img.from === 'projects' ? existingProjectFiles : existingBannerFiles;
      const staged = img.from === 'projects' ? uploads : banners;
      if (!pool.has(img.file) && !(img.file in staged))
        bad.push(`${where} image ${img.file} is not uploaded`);
      if (img.from === 'projects') homeRefs.add(img.file);
    }
    if (!String(img.alt ?? '').trim()) bad.push(`${where} image needs alt text`);
    if (img.zoom != null && !(Number(img.zoom) >= 1 && Number(img.zoom) <= 3))
      bad.push(`${where} zoom must be between 1 and 3`);
    if (img.fit != null && !['cover', 'contain'].includes(img.fit))
      bad.push(`${where} fit must be cover or contain`);
    if (img.background != null && !/^#[0-9a-f]{6}$/i.test(String(img.background)))
      bad.push(`${where} background must be a hex colour like #29251f`);
    if (img.focus != null && !FOCUS.test(String(img.focus)))
      bad.push(`${where} image focus must look like 50% 40%`);
  });

  const seen = new Set();
  const referenced = new Set(homeRefs);
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
  for (const [file, source] of Object.entries(bannerCopies)) {
    if (!FILE.test(file)) bad.push(`banner ${file} must be a lowercase .jpg or .png name`);
    if (!existingProjectFiles.has(source) && !(source in uploads))
      bad.push(`banner ${file} copies ${source}, which is not a project photograph`);
    if (!Object.values(sections).some((s) => s.banner === file))
      bad.push(`banner ${file} is not used by any section`);
  }
  for (const file of Object.keys(banners)) {
    if (!Object.values(sections).some((s) => s.banner === file))
      bad.push(`uploaded banner ${file} is not used by any section`);
  }
  return bad;
}

/**
 * Photographs this save took off a project: referenced before, not after, and
 * present in the repository. Files that were never referenced are left alone,
 * because pages may use them by hand.
 */
export function orphans(before, after, existingProjectFiles, keep = []) {
  const was = new Set(before.flatMap((p) => p.images.map((i) => i.file)));
  const still = new Set([...keep, ...after.flatMap((p) => p.images.map((i) => i.file))]);
  return [...was].filter((f) => !still.has(f) && existingProjectFiles.has(f)).sort();
}

export const ROLES = ['superadmin', 'admin'];
/** The studio's own address: always a superadmin, whatever the file says. */
export const PERMANENT_SUPERADMIN = 'contact@kalaayanastudios.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Reads admin/users.json; returns [] when it is missing or malformed. */
export function parseUsers(text) {
  try {
    const list = JSON.parse(text).users;
    return Array.isArray(list)
      ? list
          .filter((u) => u && EMAIL.test(String(u.email || '')) && ROLES.includes(u.role))
          .map((u) => ({ ...u, email: String(u.email).toLowerCase() }))
      : [];
  } catch {
    return [];
  }
}

export function roleOf(users, email) {
  const target = String(email || '').toLowerCase();
  if (target === PERMANENT_SUPERADMIN) return 'superadmin';
  return users.find((u) => u.email === target)?.role || null;
}

/** What an admin (not superadmin) may change: projects added or updated, nothing else. */
export function restrictForAdmin(base, payload) {
  const bad = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(base.sections, payload.sections)) bad.push('Only a superadmin can change works');
  if (!same(base.home, payload.home)) bad.push('Only a superadmin can change the homepage');
  const after = new Set((payload.projects || []).map((p) => p.slug));
  for (const p of base.projects || [])
    if (!after.has(p.slug)) bad.push(`Only a superadmin can delete a project (${p.slug})`);
  if (Object.keys(payload.banners || {}).length || Object.keys(payload.bannerCopies || {}).length)
    bad.push('Only a superadmin can change a work banner');
  return bad;
}

/** Applies one users change; returns the new list or throws with a readable message. */
export const PHOTO_MODES = ['required', 'optional'];

/** Whether this editor must be photographed at sign-in. The studio account always is. */
export function photoRequiredFor(users, email) {
  const target = String(email || '').toLowerCase();
  if (target === PERMANENT_SUPERADMIN) return true;
  return users.find((u) => u.email === target)?.photo !== 'optional';
}

export function applyUserChange(users, { action, email, role, photo }, by) {
  const target = String(email || '').toLowerCase();
  if (!EMAIL.test(target)) throw new Error('Enter a valid email address');
  const list = users.map((u) => ({ ...u }));
  const i = list.findIndex((u) => u.email === target);
  if (action === 'photo') {
    // Only the studio account decides who may sign in without a photograph.
    if (by !== PERMANENT_SUPERADMIN)
      throw new Error(`Only ${PERMANENT_SUPERADMIN} can change who needs a photograph`);
    if (target === PERMANENT_SUPERADMIN)
      throw new Error(`${PERMANENT_SUPERADMIN} is always photographed at sign-in`);
    if (!PHOTO_MODES.includes(photo)) throw new Error('Choose required or optional');
    if (i < 0) throw new Error(`${target} has no access`);
    list[i].photo = photo;
    return list;
  }
  if (target === PERMANENT_SUPERADMIN && action !== 'invite')
    throw new Error(`${PERMANENT_SUPERADMIN} is always a superadmin and cannot be changed`);
  if (action === 'invite') {
    if (!ROLES.includes(role)) throw new Error('Choose a role');
    if (i >= 0) throw new Error(`${target} already has access`);
    list.push({ email: target, role, invitedBy: by, invitedAt: new Date().toISOString() });
  } else if (action === 'role') {
    if (!ROLES.includes(role)) throw new Error('Choose a role');
    if (i < 0) throw new Error(`${target} has no access to change`);
    list[i].role = role;
  } else if (action === 'remove') {
    if (i < 0) throw new Error(`${target} has no access to remove`);
    list.splice(i, 1);
  } else throw new Error('Unknown action');
  if (!list.some((u) => u.role === 'superadmin'))
    throw new Error('There must always be at least one superadmin');
  return list;
}
