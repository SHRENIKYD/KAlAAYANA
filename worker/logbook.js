// The admin's log: one JSON object per line in logs/admin-log.jsonl, a
// human line in CONTENT-LOG.md, and sign-in photographs in logs/photos/.
// Everything is appended; scripts/check.py fails a change that removes or
// alters an existing line or photograph, so the log can only grow.
export const CATEGORIES = ['content', 'admin', 'session', 'error'];

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, max);

export function makeEntry({ category, email, name, action, details, photo }, at = new Date()) {
  if (!CATEGORIES.includes(category)) throw new Error(`Unknown log category ${category}`);
  const ts = at.toISOString();
  const entry = {
    at: ts,
    category,
    email: clean(email, 254).toLowerCase(),
    name: clean(name, 60) || null,
    action: clean(action, 80),
    details: clean(details, 600),
  };
  let photoPath = null;
  if (photo) {
    photoPath = `logs/photos/${ts.replace(/[:.]/g, '-')}-${entry.email.replace(/[^a-z0-9]+/g, '-')}.jpg`;
    entry.photo = photoPath;
  }
  const who = entry.name ? `${entry.name} (${entry.email})` : entry.email;
  const md = `- ${ts} · ${who} · [${category}] ${entry.action}${entry.details ? ` · ${entry.details}` : ''}${photoPath ? ` · photo ${photoPath}` : ''}\n`;
  return { entry, json: JSON.stringify(entry) + '\n', md, photoPath };
}

export function parseLog(text) {
  return String(text || '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((e) => e && e.at && CATEGORIES.includes(e.category));
}

/** Append-only check: every old line must still be there, in order, from the top. */
export function isAppendOnly(oldText, newText) {
  const a = String(oldText || '');
  return String(newText || '').startsWith(a.replace(/\n*$/, a.endsWith('\n') ? '\n' : ''));
}

/** A JPEG the camera produced: starts with the SOI marker and is small. */
export function decodePhoto(b64, maxBytes = 400 * 1024) {
  if (!b64) return null;
  const bytes = Uint8Array.from(atob(String(b64).replace(/^data:image\/jpeg;base64,/, '')), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length > maxBytes) throw new Error('Photo is too large');
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff))
    throw new Error('Photo must be a JPEG');
  return bytes;
}
