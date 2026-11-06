// Git data API: one commit on a fresh branch, then a pull request into the base.
const API = 'https://api.github.com';

export function client(token, repo, fetchImpl = fetch) {
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'kalaayana-admin',
    'x-github-api-version': '2022-11-28',
  };
  async function call(method, path, body) {
    const res = await fetchImpl(`${API}/repos/${repo}${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
      throw new Error(
        `GitHub ${method} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    return res.json();
  }
  return {
    call,
    async graphql(query, variables) {
      const res = await fetchImpl(`${API}/graphql`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) throw new Error(`GitHub GraphQL → ${res.status}`);
      return res.json();
    },
    async file(path, ref) {
      const res = await fetchImpl(
        `${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
        {
          headers: { ...headers, accept: 'application/vnd.github.raw+json' },
        },
      );
      if (!res.ok) throw new Error(`GitHub read ${path} → ${res.status}`);
      return res;
    },
    async listDir(path, ref) {
      const entries = await call('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`);
      return new Set(entries.filter((e) => e.type === 'file').map((e) => e.name));
    },
  };
}

/**
 * Builds the tree entries for one content commit.
 * @param {object} args { projectsJson, siteJson, uploads: {[file]: blobSha}, banners: {[file]: blobSha}, deletions: string[] }
 */
export function treeEntries({
  projectsJson,
  siteJson,
  uploads = {},
  banners = {},
  deletions = [],
}) {
  const blob = (path, extra) => ({ path, mode: '100644', type: 'blob', ...extra });
  return [
    blob('src/data/projects.json', { content: projectsJson }),
    blob('src/data/site.json', { content: siteJson }),
    ...Object.entries(uploads).map(([file, sha]) => blob(`src/images/projects/${file}`, { sha })),
    ...Object.entries(banners).map(([file, sha]) => blob(`src/images/sections/${file}`, { sha })),
    ...deletions.map((file) => blob(`src/images/projects/${file}`, { sha: null })),
  ];
}

export async function commitAndOpenPr(gh, { base, branch, message, author, entries, title, body }) {
  const head = await gh.call('GET', `/git/ref/heads/${base}`);
  const baseSha = head.object.sha;
  const baseCommit = await gh.call('GET', `/git/commits/${baseSha}`);
  const tree = await gh.call('POST', '/git/trees', {
    base_tree: baseCommit.tree.sha,
    tree: entries,
  });
  const commit = await gh.call('POST', '/git/commits', {
    message,
    tree: tree.sha,
    parents: [baseSha],
    author,
    committer: author,
  });
  await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
  const pr = await gh.call('POST', '/pulls', { title, head: branch, base, body });
  let autoMerge = false;
  try {
    const result = await gh.graphql(
      'mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: MERGE}) { clientMutationId } }',
      { id: pr.node_id },
    );
    autoMerge = !result.errors;
  } catch {
    autoMerge = false;
  }
  return { url: pr.html_url, number: pr.number, branch, commit: commit.sha, autoMerge };
}
