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

[Semantic Versioning](https://semver.org). `VERSION` at the repo root is the
single source of truth — no version numbers are derived from commit messages.

**A version is bumped only when the work reaches production.** Everything on
`develop` keeps the version currently in production, however many changes have
accumulated. The number describes what the public is being served, not what is
being worked on.

So a feature PR into `develop` does **not** touch `VERSION`. It adds its notes
under `## [Unreleased]` in the changelog. When a release is due, one preparation
PR into `develop` bumps `VERSION` and moves the accumulated `[Unreleased]` notes
under the new version heading. The `develop` → `main` PR then ships it.

CI enforces this in the right place: the bump and the changelog entry are
required only on a PR into `main`, never on a PR into `develop`.

    feature/*  ──▶  develop        VERSION untouched, notes under [Unreleased]
    feature/*  ──▶  develop        the release preparation: bump VERSION,
                                   move [Unreleased] under the new heading
    develop    ──▶  main           ships, tags, releases

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

The date lives in the `FREEZE` file at the repository root, and it is enforced
rather than advised. `scripts/check.py` reads it and fails any pull request
whose base is `main` while the date is in the future. That check runs as the
`Checks` job, which the repository ruleset requires on `main`, so a frozen
release cannot be merged even deliberately.

This replaces a freeze that was advisory. The previous one said
`No merge to main before 2026-09-13`, nothing enforced it, and a pull request
went into production past it while the expired text sat in this file for six
weeks. A date in a file avoids both halves of that: the gate holds while the
date stands, and it stops holding by itself the day after, with no edit needed.

While the freeze holds:

- Do not merge `develop` into `main`. That merge is the only thing that
  deploys production. CI will refuse it.
- Staging milestones may bump `VERSION` with a dated changelog entry, without
  creating a production tag or GitHub Release. Version 1.3.0 is a staging-only
  milestone; production retains its deployed version until an approved release.
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
