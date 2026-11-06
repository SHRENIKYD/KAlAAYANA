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

Production is unaffected by that swap until launch. `kalaayanastudios.com`
serves the holding page at its root, and every other page is `noindex`, while
the `LIVE` file is absent from the repo root.

**Launching the site.** Create an empty `LIVE` file at the repo root on
`develop`, in the same PR that removes `FREEZE`, and merge `develop` into
`main`. From then on every build — staging, production and rollback — serves
the full site at `/`, moves the holding page to `/coming-soon/` (noindex),
marks every page indexable, claims `https://kalaayanastudios.com/` as the
canonical origin and lists every route in `sitemap.xml`. `scripts/check.py`
enforces each of those in both states, so a build cannot half-launch.

## Content admin

Staging carries a content admin at `/admin/` for sections, projects and
photographs. Each save is one commit and one pull request into `develop`,
validated by the same `scripts/check.py` as any other change. Production
never includes it. Setup and use are in [docs/ADMIN-SETUP.md](docs/ADMIN-SETUP.md).

## Building locally

```bash
npm ci
npm run dev      # http://localhost:4321
npm run build    # writes dist/
npm run check    # validates the build output and the project data
```

Content lives in `src/data`. Adding a project is one object in `projects.json`.

## Versioning

See [VERSIONING.md](VERSIONING.md) for the authoritative numbering rules and
historical ledger. Current local candidate: **1.2.14**, unreleased. Latest published
staging prerelease is v1.2.13 at 11ea4a2 (4 November 2026). Production main
remains at 611c134. Historical releases v1.2.9 and v1.2.10 are published.

Use one increasing sequence for staging and stable releases. Do not reuse consumed
numbers. The custom patch counter runs through 99 and rolls 1.2.99 to 1.3.00.
Keep historical tags unchanged. VERSION, footer, changelog and release tag must
agree. See RELEASE_READINESS.md before any live rollout.

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

The existing FREEZE file contains **2026-11-07**. Do not merge into main or run
production/rollback workflows during the freeze. Staging work continues on develop.

The guards on develop block main-targeting PR checks and guard deployment and
rollback workflows. However, the live main branch still lacks these guards.
Consequently, manual runs from main and branches using old checks are not fully
blocked. The repository ruleset requires Checks but zero approving reviews.
Do not describe this as a complete production lock.

A repository-level approval control on the github-pages environment or equivalent
protection must be verified before launch. Changing GitHub settings, deleting
FREEZE or merging guards into main is not authorised merely by preparing a release.

Current workflow logic uses UTC and unlocks at 05:30 IST on 7 November, rather
than blocking through the whole day. Confirm the intended end time and obtain
explicit release approval. See RELEASE_READINESS.md for the unresolved blockers.

## Releasing

Handled by CI. On merge to `main` it tags `v$(cat VERSION)` and creates a
GitHub Release from that version's changelog section. If the tag already
exists the release step is skipped, so re-running is safe.
