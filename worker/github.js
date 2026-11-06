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

/** Cloudflare's preview hostname for a branch: lowercase, non-alphanumerics to -, 63 at most. */
export function branchAlias(branch) {
  return String(branch)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/** One commit on a fresh branch and nothing else: no pull request until the editor accepts. */
export async function commitToBranch(gh, { base, branch, message, author, entries, replace }) {
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
  // Keep editing: the same proposal is moved to the new commit, so its
  // preview address stays the same. A branch that is gone is made again.
  if (replace) {
    try {
      await gh.call('PATCH', `/git/refs/heads/${branch}`, { sha: commit.sha, force: true });
      return { branch, commit: commit.sha, updated: true };
    } catch {
      /* fall through and create it */
    }
  }
  await gh.call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit.sha });
  return { branch, commit: commit.sha };
}

/**
 * The editor accepted the preview of a branch: open the pull request now,
 * record who and when on it, and merge (or arm auto-merge while checks run).
 */
export async function acceptBranch(gh, { base, branch, title, body, email, at, previewUrl }) {
  const pr = await gh.call('POST', '/pulls', { title, head: branch, base, body });
  const r = await acceptPr(gh, pr.number, { email, at, previewUrl });
  return { number: pr.number, url: pr.html_url, ...r };
}

/** The editor rejected the preview of a branch: drop the branch, nothing else exists. */
export async function rejectBranch(gh, branch) {
  if (!/^content\/[a-z0-9]+$/.test(branch)) throw new Error('Not a content branch');
  try {
    await gh.call('DELETE', `/git/refs/heads/${branch}`);
  } catch {
    /* already gone */
  }
  return { closed: true };
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
  return { url: pr.html_url, number: pr.number, branch, commit: commit.sha };
}

/**
 * The editor has looked at the preview and accepted it: record who and when
 * on the pull request, then merge. If the checks are still running, ask
 * GitHub to merge as soon as they pass.
 */
export async function acceptPr(gh, number, { email, at, previewUrl }) {
  await gh.call('POST', `/issues/${number}/comments`, {
    body: `Accepted by ${email} at ${at} after previewing ${previewUrl || 'the build'}.\n\n---\n_Recorded by the content admin_`,
  });
  try {
    const r = await gh.call('PUT', `/pulls/${number}/merge`, { merge_method: 'merge' });
    return { merged: Boolean(r.merged), autoMerge: false };
  } catch (e) {
    if (!/405|422/.test(e.message)) throw e;
    const pr = await gh.call('GET', `/pulls/${number}`);
    const result = await gh.graphql(
      'mutation($id: ID!) { enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: MERGE}) { clientMutationId } }',
      { id: pr.node_id },
    );
    if (result.errors)
      throw new Error(
        'Checks are still running and auto-merge is not enabled on the repository. Merge the pull request on GitHub once they pass.',
      );
    return { merged: false, autoMerge: true };
  }
}

/** The editor rejected the preview: close the pull request and drop its branch. */
export async function rejectPr(gh, number, branch, { email, at }) {
  await gh.call('POST', `/issues/${number}/comments`, {
    body: `Rejected by ${email} at ${at}. Nothing was published.\n\n---\n_Recorded by the content admin_`,
  });
  await gh.call('PATCH', `/pulls/${number}`, { state: 'closed' });
  if (branch) {
    try {
      await gh.call('DELETE', `/git/refs/heads/${branch}`);
    } catch {
      /* the branch may be protected or already gone */
    }
  }
  return { closed: true };
}
