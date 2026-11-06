// Keeps the Cloudflare Access policy for the admin in step with
// admin/users.json: the Allow policy's Include list becomes exactly the
// editors' emails, so inviting someone in the Users tab is enough for Access
// to send them a one-time code, and removing them shuts the door.
const API = 'https://api.cloudflare.com/client/v4';
const READ_ONLY = new Set(['id', 'uid', 'created_at', 'updated_at', 'app_count', 'reusable']);

/**
 * @param {object} args { token, accountId, hostname, emails, fetchImpl }
 * @returns {Promise<{app: string, policy: string, emails: string[]}>}
 */
export async function syncAccessPolicy({ token, accountId, hostname, emails, fetchImpl = fetch }) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  async function call(method, path, body) {
    const res = await fetchImpl(`${API}/accounts/${accountId}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false)
      throw new Error(
        `Cloudflare ${method} ${path} → ${res.status}: ${(data.errors || [])
          .map((e) => e.message)
          .join('; ')
          .slice(0, 200)}`,
      );
    return data.result;
  }
  const host = hostname.toLowerCase();
  const apps = await call('GET', '/access/apps?per_page=100');
  const app = apps.find((a) =>
    [a.domain, ...(a.self_hosted_domains || [])]
      .filter(Boolean)
      .some((d) => d.toLowerCase().replace(/\/.*$/, '') === host),
  );
  if (!app) throw new Error(`No Access application protects ${host}`);
  const policies = app.policies || [];
  const policy = policies.find((p) => p.decision === 'allow');
  if (!policy) throw new Error(`The Access application for ${host} has no Allow policy`);
  const body = {};
  for (const [k, v] of Object.entries(policy)) if (!READ_ONLY.has(k)) body[k] = v;
  const list = [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  body.include = list.map((e) => ({ email: { email: e } }));
  const path = policy.reusable
    ? `/access/policies/${policy.id}`
    : `/access/apps/${app.id}/policies/${policy.id}`;
  await call('PUT', path, body);
  return { app: app.id, policy: policy.id, emails: list };
}
