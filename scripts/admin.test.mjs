import test from 'node:test';
import { validateClients, applyClients, sameClients } from '../worker/clients.js';
import { featuresOf, validateFeatures, sameFeatures, FEATURES } from '../worker/features.js';
import assert from 'node:assert/strict';
import {
  validate,
  orphans,
  imageType,
  parseUsers,
  roleOf,
  restrictForAdmin,
  applyUserChange,
  photoRequiredFor,
  PERMANENT_SUPERADMIN,
} from '../worker/validate.js';
import { makeEntry, parseLog, isAppendOnly, decodePhoto } from '../worker/logbook.js';
import {
  treeEntries,
  commitAndOpenPr,
  acceptPr,
  rejectPr,
  client,
  branchAlias,
  commitToBranch,
  rejectBranch,
} from '../worker/github.js';
import { syncAccessPolicy } from '../worker/policy.js';
import { fetchInsights } from '../worker/insights.js';

const sections = {
  landmarks: {
    eyebrow: 'M',
    title: 'T',
    lede: 'L',
    banner: 'landmarks.jpg',
    bannerAlt: 'A',
    href: '/landmarks/',
  },
};
const project = (over = {}) => ({
  slug: 'hanuman',
  group: 'landmarks',
  title: 'Hanuman',
  scale: '85 ft',
  description: 'D',
  images: [{ file: 'hanuman-1.jpg', alt: 'The statue' }],
  ...over,
});
const files = new Set(['hanuman-1.jpg', 'old-1.jpg']);
const home = {
  works: [
    {
      href: '/landmarks/',
      eyebrow: 'L',
      title: 'Landmarks',
      link: 'Discover',
      image: { from: 'projects', file: 'hanuman-1.jpg', alt: 'a' },
    },
  ],
};
const banners = new Set(['landmarks.jpg']);

test('a well-formed payload passes', () => {
  assert.deepEqual(validate({ projects: [project()], sections, home }, files, banners), []);
});

test('mirrors check.py: required fields, groups, alt text, slugs', () => {
  const bad = validate(
    {
      projects: [
        project({ scale: '' }),
        project({ slug: 'Bad Slug', group: 'nope', images: [{ file: 'x.jpg', alt: '' }] }),
      ],
      sections,
    },
    files,
    banners,
  );
  assert.ok(bad.some((m) => m.includes('missing scale')));
  assert.ok(bad.some((m) => m.includes('slug must be')));
  assert.ok(bad.some((m) => m.includes('unknown section nope')));
  assert.ok(bad.some((m) => m.includes('needs alt text')));
  assert.ok(bad.some((m) => m.includes('x.jpg is not uploaded')));
});

test('uploads must be referenced and references must be uploaded or present', () => {
  const ok = validate(
    {
      projects: [project({ images: [{ file: 'new-1.jpg', alt: 'a' }] })],
      sections,
      home,
      uploads: { 'new-1.jpg': 'AA==' },
    },
    files,
    banners,
  );
  assert.deepEqual(ok, []);
  const stray = validate(
    { projects: [project()], sections, home, uploads: { 'stray.jpg': 'AA==' } },
    files,
    banners,
  );
  assert.ok(stray.some((m) => m.includes('stray.jpg is not used')));
});

test('new sections need a banner and a matching href', () => {
  const bad = validate(
    {
      projects: [],
      sections: {
        ...sections,
        gardens: {
          eyebrow: 'G',
          title: 'G',
          lede: 'G',
          banner: 'gardens.jpg',
          bannerAlt: 'G',
          href: '/garden/',
        },
      },
    },
    files,
    banners,
  );
  assert.ok(bad.some((m) => m.includes('href must be /gardens/')));
  assert.ok(bad.some((m) => m.includes('gardens.jpg is not uploaded')));
});

test('a tile that names a work must point at an existing work', () => {
  const tile = (over) => ({
    href: '/landmarks/',
    eyebrow: 'L',
    title: 'T',
    link: 'Go',
    image: { from: 'projects', file: 'hanuman-1.jpg', alt: 'a' },
    ...over,
  });
  assert.deepEqual(
    validate(
      { projects: [project()], sections, home: { works: [tile({ section: 'landmarks' })] } },
      files,
      banners,
    ),
    [],
  );
  const bad = validate(
    {
      projects: [project()],
      sections,
      home: {
        works: [tile({ section: 'gardens' }), tile({ section: 'landmarks', href: '/temples/' })],
      },
    },
    files,
    banners,
  );
  assert.ok(bad.some((m) => m.includes('does not exist: gardens')));
  assert.ok(bad.some((m) => m.includes('must link to /landmarks/')));
});

test('homepage works are validated and keep their photographs alive', () => {
  const bad = validate(
    {
      projects: [project()],
      sections,
      home: {
        works: [
          {
            href: 'landmarks',
            eyebrow: '',
            title: 'T',
            link: 'Go',
            image: { from: 'projects', file: 'nope.jpg', alt: '' },
          },
        ],
      },
    },
    files,
    banners,
  );
  assert.ok(bad.some((m) => m.includes('homepage work 1 is missing eyebrow')));
  assert.ok(bad.some((m) => m.includes('link must look like')));
  assert.ok(bad.some((m) => m.includes('nope.jpg is not uploaded')));
  assert.ok(bad.some((m) => m.includes('image needs alt text')));
  assert.deepEqual(
    validate({ projects: [project()], sections, home: { works: [] } }, files, banners),
    ['the homepage needs at least one work'],
  );
  const before = [
    project({
      images: [
        { file: 'hanuman-1.jpg', alt: 'a' },
        { file: 'old-1.jpg', alt: 'b' },
      ],
    }),
  ];
  assert.deepEqual(orphans(before, [project()], files, ['old-1.jpg']), []);
});

test('a section banner can be chosen from a project photograph', () => {
  const sec = {
    ...sections,
    gardens: {
      eyebrow: 'G',
      title: 'G',
      lede: 'G',
      banner: 'gardens.jpg',
      bannerAlt: 'G',
      href: '/gardens/',
    },
  };
  assert.deepEqual(
    validate(
      {
        projects: [project()],
        sections: sec,
        home,
        bannerCopies: { 'gardens.jpg': 'hanuman-1.jpg' },
      },
      files,
      banners,
    ),
    [],
  );
  const bad = validate(
    { projects: [project()], sections: sec, home, bannerCopies: { 'gardens.jpg': 'missing.jpg' } },
    files,
    banners,
  );
  assert.ok(bad.some((m) => m.includes('copies missing.jpg')));
});

test('only photographs removed by this save are deleted; never-referenced files are left alone', () => {
  const before = [
    project({
      images: [
        { file: 'hanuman-1.jpg', alt: 'a' },
        { file: 'old-1.jpg', alt: 'b' },
      ],
    }),
  ];
  assert.deepEqual(orphans(before, [project()], files), ['old-1.jpg']);
  assert.deepEqual(orphans([project()], [project()], new Set([...files, 'hand-used.jpg'])), []);
});

test('image type is read from bytes, not the name', () => {
  assert.equal(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'jpg');
  assert.equal(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])), 'png');
  assert.equal(imageType(new TextEncoder().encode('<svg onload=alert(1)>')), null);
});

test('tree entries write data, add uploads and delete orphans', () => {
  const t = treeEntries({
    projectsJson: '[]',
    siteJson: '{}',
    uploads: { 'a.jpg': 'sha1' },
    banners: { 'b.jpg': 'sha2' },
    deletions: ['c.jpg'],
  });
  assert.deepEqual(
    t.map((e) => [e.path, 'sha' in e ? e.sha : 'content']),
    [
      ['src/data/projects.json', 'content'],
      ['src/data/site.json', 'content'],
      ['src/images/projects/a.jpg', 'sha1'],
      ['src/images/sections/b.jpg', 'sha2'],
      ['src/images/projects/c.jpg', null],
    ],
  );
});

test('accept records who and when on the pull request, then merges or arms auto-merge', async () => {
  const calls = [];
  const fake =
    (mergeStatus) =>
    async (url, init = {}) => {
      calls.push([
        init.method || 'GET',
        url.replace('https://api.github.com/repos/o/r', ''),
        init.body,
      ]);
      if (url.endsWith('/merge'))
        return new Response(mergeStatus === 200 ? '{"merged":true}' : 'checks pending', {
          status: mergeStatus,
        });
      if (url.endsWith('/pulls/9')) return new Response('{"node_id":"N"}', { status: 200 });
      if (url.endsWith('/graphql')) return new Response('{"data":{}}', { status: 200 });
      return new Response('{}', { status: 200 });
    };
  let r = await acceptPr(client('t', 'o/r', fake(200)), 9, {
    email: 'a@b',
    at: '2026-11-06T10:00:00Z',
    previewUrl: 'https://p',
  });
  assert.deepEqual(r, { merged: true, autoMerge: false });
  assert.ok(calls[0][2].includes('Accepted by a@b at 2026-11-06T10:00:00Z'));
  calls.length = 0;
  r = await acceptPr(client('t', 'o/r', fake(405)), 9, { email: 'a@b', at: 'T' });
  assert.deepEqual(r, { merged: false, autoMerge: true });
  calls.length = 0;
  r = await rejectPr(client('t', 'o/r', fake(200)), 9, 'content/x', { email: 'a@b', at: 'T' });
  assert.deepEqual(r, { closed: true });
  assert.deepEqual(
    calls.map((c) => c[0] + ' ' + c[1]),
    ['POST /issues/9/comments', 'PATCH /pulls/9', 'DELETE /git/refs/heads/content/x'],
  );
});

test('one commit on a fresh branch, then a pull request that waits for acceptance', async () => {
  const calls = [];
  const fakeFetch = async (url, init = {}) => {
    calls.push([init.method || 'GET', url.replace('https://api.github.com/repos/o/r', '')]);
    const reply = (o) => new Response(JSON.stringify(o), { status: 200 });
    if (url.endsWith('/git/ref/heads/develop')) return reply({ object: { sha: 'base' } });
    if (url.includes('/git/commits/base')) return reply({ tree: { sha: 'tree0' } });
    if (url.endsWith('/git/trees')) return reply({ sha: 'tree1' });
    if (url.endsWith('/git/commits')) return reply({ sha: 'c1' });
    if (url.endsWith('/git/refs')) return reply({});
    if (url.endsWith('/pulls'))
      return reply({ html_url: 'https://x/pr/9', number: 9, node_id: 'N' });
    if (url.endsWith('/graphql')) return reply({ errors: [{ message: 'auto-merge off' }] });
    return new Response('nope', { status: 404 });
  };
  const gh = client('t', 'o/r', fakeFetch);
  const r = await commitAndOpenPr(gh, {
    base: 'develop',
    branch: 'content/x',
    message: 'm',
    author: { name: 'a', email: 'a@b' },
    entries: [],
    title: 't',
    body: 'b',
  });
  assert.deepEqual(r, {
    url: 'https://x/pr/9',
    number: 9,
    branch: 'content/x',
    commit: 'c1',
  });
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['GET', 'GET', 'POST', 'POST', 'POST', 'POST'],
  );
});

test('roles come from admin/users.json; admins may only add or update projects', () => {
  const users = parseUsers(
    JSON.stringify({
      users: [
        { email: 'Boss@X.com', role: 'superadmin' },
        { email: 'ed@x.com', role: 'admin' },
        { email: 'bad', role: 'admin' },
        { email: 'odd@x.com', role: 'owner' },
      ],
    }),
  );
  assert.deepEqual(
    users.map((u) => u.email + ':' + u.role),
    ['boss@x.com:superadmin', 'ed@x.com:admin'],
  );
  assert.equal(roleOf(users, 'BOSS@x.com'), 'superadmin');
  assert.equal(roleOf(users, 'nobody@x.com'), null);
  const base = { sections, home, projects: [project()] };
  assert.deepEqual(
    restrictForAdmin(base, { sections, home, projects: [project(), project({ slug: 'new-one' })] }),
    [],
  );
  assert.deepEqual(
    restrictForAdmin(base, { sections, home, projects: [project({ title: 'Edited' })] }),
    [],
  );
  const bad = restrictForAdmin(base, {
    sections: {},
    home: { works: [] },
    projects: [],
    banners: { 'x.jpg': 'AA==' },
  });
  assert.ok(bad.some((m) => m.includes('change works')));
  assert.ok(bad.some((m) => m.includes('change the homepage')));
  assert.ok(bad.some((m) => m.includes('delete a project (hanuman)')));
  assert.ok(bad.some((m) => m.includes('work banner')));
});

test('inviting, changing and removing users keeps at least one superadmin', () => {
  const users = [{ email: 'boss@x.com', role: 'superadmin', invitedBy: null, invitedAt: null }];
  const invited = applyUserChange(
    users,
    { action: 'invite', email: 'New@x.com', role: 'admin' },
    'boss@x.com',
  );
  assert.equal(invited[1].email, 'new@x.com');
  assert.equal(invited[1].invitedBy, 'boss@x.com');
  assert.throws(
    () =>
      applyUserChange(
        invited,
        { action: 'invite', email: 'new@x.com', role: 'admin' },
        'boss@x.com',
      ),
    /already has access/,
  );
  assert.throws(
    () =>
      applyUserChange(invited, { action: 'invite', email: 'nope', role: 'admin' }, 'boss@x.com'),
    /valid email/,
  );
  const promoted = applyUserChange(
    invited,
    { action: 'role', email: 'new@x.com', role: 'superadmin' },
    'boss@x.com',
  );
  assert.equal(promoted[1].role, 'superadmin');
  assert.throws(
    () => applyUserChange(users, { action: 'remove', email: 'boss@x.com' }, 'boss@x.com'),
    /at least one superadmin/,
  );
  assert.equal(
    applyUserChange(promoted, { action: 'remove', email: 'boss@x.com' }, 'new@x.com').length,
    1,
  );
});

test('contact@ is the master account and cannot be removed or demoted', () => {
  assert.equal(roleOf([], PERMANENT_SUPERADMIN), 'master');
  const users = [
    { email: PERMANENT_SUPERADMIN, role: 'superadmin' },
    { email: 'b@x.com', role: 'superadmin' },
  ];
  assert.throws(
    () => applyUserChange(users, { action: 'remove', email: PERMANENT_SUPERADMIN }, 'b@x.com'),
    /master account and cannot be changed/,
  );
  assert.throws(
    () =>
      applyUserChange(
        users,
        { action: 'role', email: PERMANENT_SUPERADMIN, role: 'admin' },
        'b@x.com',
      ),
    /master account and cannot be changed/,
  );
});

test('log entries are structured, photographs named by time and account, and the log only grows', () => {
  const at = new Date('2026-11-06T06:30:00.000Z');
  const item = makeEntry(
    {
      category: 'session',
      email: 'Contact@Kalaayanastudios.com',
      name: 'Priya',
      action: 'signed in',
      details: 'with photograph',
      photo: true,
    },
    at,
  );
  assert.equal(
    item.photoPath,
    'logs/photos/2026-11-06T06-30-00-000Z-contact-kalaayanastudios-com.jpg',
  );
  assert.deepEqual(parseLog(item.json)[0], item.entry);
  assert.ok(
    item.md.startsWith(
      '- 2026-11-06T06:30:00.000Z · Priya (contact@kalaayanastudios.com) · [session] signed in',
    ),
  );
  assert.throws(() => makeEntry({ category: 'other', email: 'a@b' }), /Unknown log category/);
  assert.ok(isAppendOnly('a\nb\n', 'a\nb\nc\n'));
  assert.ok(!isAppendOnly('a\nb\n', 'a\nc\n'));
  assert.ok(!isAppendOnly('a\nb\n', 'a\n'));
  assert.equal(decodePhoto(null), null);
  assert.throws(() => decodePhoto(btoa('<svg/>')), /JPEG/);
  assert.equal(decodePhoto(btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2))).length, 6);
});

test('the Access Allow policy is rewritten to exactly the editors', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body && JSON.parse(init.body) });
    const ok = (result) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
    if (url.endsWith('/access/apps?per_page=100'))
      return ok([
        { id: 'other', domain: 'elsewhere.example.com', policies: [] },
        {
          id: 'app1',
          name: 'Admin',
          destinations: [{ type: 'public', uri: 'https://kalaayana.example.workers.dev/admin' }],
          policies: [
            { id: 'deny', decision: 'deny', include: [] },
            {
              id: 'pol1',
              uid: 'pol1',
              reusable: true,
              name: 'Editors',
              decision: 'allow',
              include: [{ email: { email: 'old@example.com' } }],
              exclude: [],
              require: [],
              session_duration: '1h',
              created_at: 'x',
            },
          ],
        },
      ]);
    if (url.endsWith('/access/policies/pol1') && init.method === 'PUT') return ok({ id: 'pol1' });
    return new Response(JSON.stringify({ success: false, errors: [{ message: 'nope' }] }), {
      status: 404,
    });
  };
  const r = await syncAccessPolicy({
    token: 't',
    accountId: 'acc',
    hostname: 'KALAAYANA.example.workers.dev',
    emails: ['A@example.com', 'b@example.com', 'a@example.com'],
    fetchImpl,
  });
  assert.deepEqual(r, { app: 'app1', policy: 'pol1', emails: ['a@example.com', 'b@example.com'] });
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.url, 'https://api.cloudflare.com/client/v4/accounts/acc/access/policies/pol1');
  assert.deepEqual(put.body.include, [
    { email: { email: 'a@example.com' } },
    { email: { email: 'b@example.com' } },
  ]);
  assert.equal(put.body.session_duration, '1h');
  assert.equal(put.body.id, undefined);
  assert.equal(put.body.created_at, undefined);
  await assert.rejects(
    syncAccessPolicy({
      token: 't',
      accountId: 'acc',
      hostname: 'nowhere.test',
      emails: [],
      fetchImpl,
    }),
    /No Access application protects nowhere.test; found .*Admin \(kalaayana.example.workers.dev\)/,
  );
});

test('insights fill every day of the window and name empty referrers', async () => {
  const fetchImpl = async (url, init) => {
    const v = JSON.parse(init.body).variables;
    assert.equal(v.account, 'acc');
    assert.equal(v.site, 'tag');
    return new Response(
      JSON.stringify({
        data: {
          viewer: {
            accounts: [
              {
                previous: [{ count: 5, sum: { visits: 2 } }],
                byDay: [{ count: 10, sum: { visits: 4 }, dimensions: { date: '2026-11-05' } }],
                pages: [{ count: 7, sum: { visits: 3 }, dimensions: { requestPath: '/murals/' } }],
                referrers: [{ count: 7, sum: { visits: 3 }, dimensions: { refererHost: '' } }],
                countries: [{ count: 7, sum: { visits: 3 }, dimensions: { countryName: 'India' } }],
                devices: [{ count: 7, sum: { visits: 3 }, dimensions: { deviceType: 'mobile' } }],
              },
            ],
          },
        },
        errors: null,
      }),
      { status: 200 },
    );
  };
  const r = await fetchInsights({
    token: 't',
    accountId: 'acc',
    siteTag: 'tag',
    days: 3,
    now: new Date('2026-11-06T12:00:00Z'),
    fetchImpl,
  });
  assert.equal(r.days, 3);
  assert.deepEqual(
    r.byDay.map((d) => [d.date, d.visits]),
    [
      ['2026-11-04', 0],
      ['2026-11-05', 4],
      ['2026-11-06', 0],
    ],
  );
  assert.deepEqual(r.totals, { views: 10, visits: 4 });
  assert.deepEqual(r.previous, { views: 5, visits: 2 });
  assert.equal(r.referrers[0].label, 'Direct / none');
  assert.equal(r.pages[0].label, '/murals/');
  await assert.rejects(
    fetchInsights({
      token: 't',
      accountId: 'acc',
      siteTag: 'tag',
      days: 7,
      fetchImpl: async () =>
        new Response(JSON.stringify({ errors: [{ message: 'bad token' }] }), { status: 200 }),
    }),
    /bad token/,
  );
});

test('only the studio account decides who may sign in without a photograph', () => {
  const users = [
    { email: 'a@example.com', role: 'admin' },
    { email: PERMANENT_SUPERADMIN, role: 'superadmin' },
  ];
  assert.equal(photoRequiredFor(users, 'a@example.com'), true);
  assert.throws(
    () =>
      applyUserChange(
        users,
        { action: 'photo', email: 'a@example.com', photo: 'optional' },
        'a@example.com',
      ),
    /Only the master account/,
  );
  const next = applyUserChange(
    users,
    { action: 'photo', email: 'a@example.com', photo: 'optional' },
    PERMANENT_SUPERADMIN,
  );
  assert.equal(photoRequiredFor(next, 'a@example.com'), false);
  assert.equal(photoRequiredFor(next, PERMANENT_SUPERADMIN), true);
  assert.throws(
    () =>
      applyUserChange(
        users,
        { action: 'photo', email: PERMANENT_SUPERADMIN, photo: 'optional' },
        PERMANENT_SUPERADMIN,
      ),
    /always photographed/,
  );
});

test('a proposal is a branch, not a pull request, until it is accepted', async () => {
  assert.equal(branchAlias('content/20261106T085139Z'), 'content-20261106t085139z');
  const calls = [];
  const gh = client('t', 'o/r', async (url, init) => {
    calls.push(`${init.method} ${url.replace('https://api.github.com/repos/o/r', '')}`);
    const body = (p) => new Response(JSON.stringify(p), { status: 200 });
    if (url.endsWith('/git/ref/heads/develop')) return body({ object: { sha: 'base' } });
    if (url.includes('/git/commits/base')) return body({ tree: { sha: 'tree0' } });
    if (url.endsWith('/git/trees')) return body({ sha: 'tree1' });
    if (url.endsWith('/git/commits')) return body({ sha: 'c1' });
    if (url.endsWith('/git/refs')) return body({});
    if (url.includes('/git/refs/heads/content/x')) return body({});
    return new Response('{}', { status: 404 });
  });
  const r = await commitToBranch(gh, {
    base: 'develop',
    branch: 'content/x',
    message: 'm',
    author: { name: 'a', email: 'a@example.com' },
    entries: [],
  });
  assert.deepEqual(r, { branch: 'content/x', commit: 'c1' });
  assert.ok(!calls.some((c) => c.includes('/pulls')));
  await rejectBranch(gh, 'content/x');
  assert.ok(calls.includes('DELETE /git/refs/heads/content/x'));
  await assert.rejects(rejectBranch(gh, 'develop'), /Not a content branch/);
});

test('clients: names, logos and removed logo files', () => {
  const existing = new Set(['a.png', 'b.jpg', 'spare.png']);
  assert.deepEqual(
    validateClients([{ name: 'A', logo: '/assets/clients/a.png' }, { name: 'New' }], {}, existing),
    [],
  );
  assert.deepEqual(validateClients([{ name: 'Named only', logo: null }], {}, existing), []);
  assert.match(validateClients([{ name: ' ' }], {}, existing)[0], /name of 1 to 80/);
  assert.match(validateClients([{ name: 'A' }, { name: 'a' }], {}, existing)[0], /listed twice/);
  assert.match(
    validateClients([{ name: 'X', logo: '/assets/clients/missing.png' }], {}, existing)[0],
    /does not exist/,
  );
  assert.match(
    validateClients([{ name: 'X', logo: 'https://evil.example/x.png' }], {}, existing)[0],
    /must be a file/,
  );
  assert.deepEqual(
    validateClients([{ name: 'N', logo: '/assets/clients/n.png' }], { 'n.png': 'x' }, existing),
    [],
  );
  const before = [
    { name: 'A', logo: '/assets/clients/a.png' },
    { name: 'B', logo: '/assets/clients/b.jpg' },
  ];
  const r = applyClients(before, [{ name: ' A ', logo: '/assets/clients/a.png' }], existing);
  assert.deepEqual(r.deletions, ['b.jpg']);
  assert.deepEqual(JSON.parse(r.json), [{ name: 'A', logo: '/assets/clients/a.png' }]);
  assert.ok(
    sameClients(
      before,
      before.map((c) => ({ ...c })),
    ),
  );
  assert.ok(!sameClients(before, before.slice(0, 1)));
});

test('feature flags: defaults, booleans only, known keys, compared by value', () => {
  const all = Object.fromEntries(FEATURES.map((f) => [f.key, f.default]));
  assert.deepEqual(featuresOf({}), all);
  assert.equal(featuresOf({ features: { watermarkPhotos: false } }).watermarkPhotos, false);
  assert.equal(featuresOf({ features: { watermarkPhotos: 'no' } }).watermarkPhotos, true);
  assert.deepEqual(validateFeatures({ watermarkPhotos: false, loadingSkeletons: true }), []);
  assert.match(validateFeatures({ watermarkPhotos: 'no' })[0], /on or off/);
  assert.match(validateFeatures({ somethingElse: true })[0], /Unknown feature flag/);
  assert.ok(sameFeatures(undefined, all));
  assert.ok(!sameFeatures(undefined, { ...all, blockPhotoSaving: false }));
});
