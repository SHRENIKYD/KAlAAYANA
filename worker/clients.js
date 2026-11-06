// The homepage's "Our clients" strip: src/data/clients.json, logos in
// public/assets/clients. Shared by the Worker and the local demo.
export const CLIENTS_JSON = 'src/data/clients.json';
export const CLIENT_DIR = 'public/assets/clients';
const LOGO = /^\/assets\/clients\/([a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png|webp|svg))$/;
const UPLOAD = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:jpg|png)$/;
const MAX_CLIENTS = 80;

export const logoFile = (logo) => (LOGO.exec(String(logo || '')) || [])[1] || null;

/** Problems with the edited list; empty when it can be saved. */
export function validateClients(clients, logos, existing) {
  if (!Array.isArray(clients)) return ['clients must be a list'];
  const bad = [];
  if (clients.length > MAX_CLIENTS) bad.push(`At most ${MAX_CLIENTS} clients`);
  const names = new Set();
  for (const f of Object.keys(logos || {}))
    if (!UPLOAD.test(f)) bad.push(`Client logo ${f}: name must be lowercase-hyphen .jpg or .png`);
  clients.forEach((c, i) => {
    const where = `Client ${i + 1}`;
    if (!c || typeof c !== 'object') return bad.push(`${where}: not an entry`);
    const keys = Object.keys(c).filter((k) => k !== 'name' && k !== 'logo');
    if (keys.length) bad.push(`${where}: unknown field ${keys.join(', ')}`);
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name || name.length > 80) bad.push(`${where}: a name of 1 to 80 characters is required`);
    else if (/[<>]/.test(name)) bad.push(`${where}: the name cannot contain < or >`);
    else if (names.has(name.toLowerCase())) bad.push(`${where}: ${name} is listed twice`);
    names.add(name.toLowerCase());
    if (c.logo !== undefined && c.logo !== null && c.logo !== '') {
      const file = logoFile(c.logo);
      if (!file) bad.push(`${where}: the logo must be a file in /assets/clients/`);
      else if (!existing.has(file) && !(logos && file in logos))
        bad.push(`${where}: logo ${file} does not exist`);
    }
  });
  return bad;
}

/** Clean list to write, and logo files no longer used by any client. */
export function applyClients(before, after, existing) {
  const list = after.map((c) => {
    const out = { name: c.name.trim() };
    if (c.logo) out.logo = c.logo;
    return out;
  });
  const used = new Set(list.map((c) => logoFile(c.logo)).filter(Boolean));
  const deletions = [
    ...new Set(
      (before || [])
        .map((c) => logoFile(c.logo))
        .filter((f) => f && !used.has(f) && existing.has(f)),
    ),
  ];
  return { json: JSON.stringify(list, null, 2) + '\n', deletions, used };
}

export const sameClients = (a, b) =>
  JSON.stringify((a || []).map((c) => [c.name, c.logo || ''])) ===
  JSON.stringify((b || []).map((c) => [String(c.name || '').trim(), c.logo || '']));
