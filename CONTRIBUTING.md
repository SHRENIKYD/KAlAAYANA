# Working on this site

## Branches

```
feature/*  ──PR──▶  develop  ──PR──▶  main
                       │                │
                 staging (private)   kalaayanastudios.com
```

| Branch | Purpose | Direct pushes |
| --- | --- | --- |
| `main` | Production. Deploys to `kalaayanastudios.com` on merge. | Never — PR only |
| `develop` | Integration. Everything lands here first and is reviewed on staging. | Never — PR only |
| `feature/*` | One change each. Branch from `develop`, merge back to `develop`. | Yes, it is yours |

Branch names: `feature/<short-description>`, `fix/<short-description>`,
`chore/<short-description>`.

## The loop

1. `git switch develop && git pull`
2. `git switch -c feature/contact-form`
3. Commit, push, open a PR into **`develop`**.
4. CI runs. Cloudflare builds a preview URL for the branch, behind Cloudflare
   Access — only you can open it.
5. Merge. `develop` deploys to the staging site. Review it there.
6. When staging is right, open a PR from **`develop` into `main`**. This one
   must bump `VERSION` and add a `CHANGELOG.md` entry — CI fails without both.
7. Merge. Production deploys, the version is tagged, and a GitHub Release is
   cut from the changelog entry.

Nothing reaches `kalaayanastudios.com` without passing through staging first.

## Staging (Cloudflare)

Staging is a Cloudflare Worker built from this repo and protected by Cloudflare
Access, so only allowed accounts can open it. Its settings:

| Setting | Value |
| --- | --- |
| Production branch | `develop` |
| Build command | `npm run build:staging` |
| Deploy command | `npx wrangler deploy` |
| Builds for non-production branches | on — gives every branch its own URL |
| Protect with Cloudflare Access | on |

`wrangler.jsonc` serves the repo root as static assets; `.assetsignore` keeps
scripts, workflows and docs out of what is served. The build command is what
makes staging carry a real version — without it staging would serve `?v=dev`
forever and cache stale assets.

The build command is a single npm script on purpose. It expands to
`astro build && bash scripts/stamp.sh staging`, and both halves are required:
Cloudflare installs dependencies itself but never runs the build, so without
`astro build` there is no `dist/` and `scripts/stamp.sh` aborts. Keeping the
two steps in `package.json` rather than in the dashboard field means they are
version-controlled and reviewed, and the dashboard holds one token that cannot
lose half of itself.

Run `npm run check` against a plain `npm run build`, not after
`npm run build:staging`. The staging stamp swaps `index.html` and
`preview.html`, and the checks read the unswapped build — that is the order
`.github/workflows/ci.yml` uses.

**Staging is where the work happens.**

    https://kalaayana.shrenikyd.workers.dev/

Its root serves the site under development — the build swaps `index.html` and
`preview.html` for the `staging` environment only. The holding page is still
there at `/coming-soon.html`. Cloudflare Access sits in front, so only
permitted accounts and email addresses can open it.

Production is unaffected by that swap: `kalaayanastudios.com` serves the
holding page at its root until a release deliberately changes which file is
`index.html`.

## Building locally

```bash
npm ci
npm run dev      # http://localhost:4321
npm run build    # writes dist/
npm run check    # validates the build output and the project data
```

Content lives in `src/data`. Adding a project is one object in `projects.json`.

## Versioning

Current staging update: **1.2.10**; **1.2.8** is already released. Increment the final component for each
subsequent staging update: **1.2.10, 1.2.11, ... through 1.2.99**. Do not advance
to 1.3.0 automatically for feature or layout work during this series. The next
series after 1.2.99 needs an explicit decision. Each version gets a dated
CHANGELOG entry. Staging version changes do not create production releases. A
staging bump therefore needs no tag and no GitHub Release; the Release list
tracks production only, which is why it stops at `v1.2.8`.

[Semantic Versioning](https://semver.org). `VERSION` at the repo root is the
single source of truth — no version numbers are derived from commit messages.

| Bump | When |
| --- | --- |
| **Patch** `0.1.0 → 0.1.1` | Copy fix, colour tweak, bug fix, dependency change |
| **Minor** `0.1.0 → 0.2.0` | A new section, a new page, a feature |
| **Major** `0.9.0 → 1.0.0` | Launch, or a redesign that replaces what came before |

`1.0.0` is reserved for the moment the holding page comes down.

## What is deployed right now

Every deployment writes `/version.json`:

```
https://kalaayanastudios.com/version.json
```

```json
{ "version": "0.1.0", "commit": "37838c1", "environment": "production", ... }
```

The same version is in a `<meta name="version">` tag on every page. If you are
ever unsure whether a change is live, read that file — do not judge by eye,
since a cached stylesheet can make a current page look stale.

## Rolling back

Actions → **Rollback production** → Run workflow → enter a tag such as
`v0.1.0`. That tag's build is redeployed. No revert commit, no force-push.

## Production freeze

**No merge to `main` before 2026-11-07.**

The date lives in the `FREEZE` file at the repository root, read in three places:

- `scripts/check.py` fails any pull request whose base is `main` while the date
  is in the future. That runs as the `Checks` job, which the ruleset requires on
  `main`.
- **Deploy production** and **Rollback production** each begin with a `freeze`
  job that every other job depends on, so a manual `workflow_dispatch` is
  refused as well as an automatic deploy. Those jobs read the date from
  `origin/develop`, not from the ref being deployed, so redeploying an old tag
  does not escape the freeze.

**What this does not cover.** A pull request's checks run from the merge commit —
the head merged into the base — so `check.py` only carries the gate when one of
those two sides does. A branch taken from `main` while `main` lacks the gate,
merged into `main`, runs the old `check.py` and is not stopped. That is exactly
the route PR #52 took into production. The workflow gate closes the deploy end
of it, but only once these workflow files are themselves on `main`, and they
cannot get there during a freeze without being waved through by hand.

A freeze that must hold against every route, immediately, needs one thing set
outside this repository: require a reviewer on the `github-pages` environment,
or raise the ruleset's required approvals above zero. Both are GitHub settings,
not code, and both cover paths no file in this repository can see.

This replaces a freeze that was advisory. The previous one said
`No merge to main before 2026-09-13`, nothing enforced it, and a pull request
went into production past it while the expired text sat in this file for six
weeks. A date in a file avoids both halves of that: the gate holds while the
date stands, and it stops holding by itself the day after, with no edit needed.

While the freeze holds:

- Do not merge `develop` into `main`. That merge is the only thing that
  deploys production. CI will refuse it.
- Do not run **Deploy production** or **Rollback production** by hand. Their
  `freeze` job refuses both while the date stands.
- Staging milestones may bump `VERSION` with a dated changelog entry, without
  creating a production tag or GitHub Release. The 1.2.x series is staging-only;
  production keeps its deployed version until an approved release.
- Feature work continues as normal — `feature/*` into `develop`, reviewed on
  staging.

To lift it, delete the `FREEZE` file in the release PR that ends the freeze.
Changing the date extends or shortens it. Until then CI prints
`freeze lapsed on <date> — delete the FREEZE file` once the date passes, so a
stale file is visible in every run instead of going quiet.

## Releasing

Handled by CI. On merge to `main` it tags `v$(cat VERSION)` and creates a
GitHub Release from that version's changelog section. If the tag already
exists the release step is skipped, so re-running is safe.
