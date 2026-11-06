// Verifies the Cloudflare Access JWT the edge attaches to every request that
// passed the Access policy, and returns the signed-in email.
const certCache = new Map();

function b64url(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

async function keys(teamDomain, fetchImpl) {
  const cached = certCache.get(teamDomain);
  if (cached && cached.until > Date.now()) return cached.keys;
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error('Access certs unavailable');
  const { keys: jwks } = await res.json();
  certCache.set(teamDomain, { keys: jwks, until: Date.now() + 10 * 60 * 1000 });
  return jwks;
}

export async function verifyAccessJwt(token, { teamDomain, aud }, fetchImpl = fetch) {
  if (!token) throw new Error('No Access token');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('Malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (header.alg !== 'RS256') throw new Error('Unexpected algorithm');
  const jwk = (await keys(teamDomain, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64url(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('Bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now || payload.iss !== `https://${teamDomain}`)
    throw new Error('Token expired or wrong issuer');
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) throw new Error('Token is for another application');
  if (!payload.email) throw new Error('Token carries no email');
  return { email: payload.email.toLowerCase(), iat: Number(payload.iat) || now };
}
