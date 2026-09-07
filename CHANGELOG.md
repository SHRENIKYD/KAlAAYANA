# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions below `1.0.0` cover the pre-launch period, during which the public site
is a holding page. `1.0.0` marks the launch of the full site.

## [Unreleased]

## [1.0.2] — 2026-09-07

### Changed
- Staging now serves the site under development at its root. `stamp.sh` swaps
  `index.html` and `preview.html` when the environment is `staging`, so
  `https://kalaayana.shrenikyd.workers.dev/` is the site being worked on, with
  the holding page still reachable at `/coming-soon.html`.

  Production is untouched: the swap is guarded on the environment name, and
  only `staging` matches. Production and rollback builds pass `production`, CI
  passes `ci`, so `kalaayanastudios.com` keeps serving the holding page from
  the root exactly as before.

## [1.0.1] — 2026-09-07

Holds the launch. The site is not ready to be public yet, so production goes
back to the holding page while the full site is verified on staging.

### Changed
- `index.html` is the **Coming Soon** holding page again, indexable with its
  canonical tag, so `kalaayanastudios.com` shows it to visitors.
- The full site returns to `preview.html`, marked `noindex, nofollow` with no
  canonical tag, so it cannot be indexed or compete with the holding page
  while it is unfinished.
- `scripts/check.py` guards `preview.html` again rather than
  `coming-soon.html`.

### Note
`1.0.0` remains tagged and is a valid, deployable release. Relaunching is the
same file swap in reverse, and will be `1.1.0`.

## [1.0.0] — 2026-09-07

Launch. The full site replaces the holding page at `kalaayanastudios.com`.

### Changed
- `index.html` is now the complete site — hero, our story, expertise,
  monumental landmarks, temple architecture, portraits and life sculptures,
  murals and contact — with its canonical tag restored and `noindex` removed
  so it can be found in search.
- The holding page is retained as `coming-soon.html`, marked
  `noindex, nofollow` and stripped of its canonical tag so it cannot compete
  with the live site. It stays available should the site ever need to be
  taken back down.
- `scripts/check.py` now expects `coming-soon.html` rather than `preview.html`
  in its list of pages that must stay out of search.

## [0.1.1] — 2026-09-07

### Fixed
- The release job could not tag a version. `git tag -a` needs a committer
  identity and the runner has none, so the job failed at its first git command
  and `v0.1.0` was never created. The deploy itself had already succeeded.
- Release notes were extracted with an awk regex containing `\[0.1.1\]`. YAML
  collapsed the escaping, so awk read `[0.1.1]` as a character class and
  matched the wrong lines — 103 characters of the changelog instead of 1,614.
  Now matched literally with `index()`, which has no escaping to get wrong.

### Added
- `wrangler.jsonc` and `.assetsignore` for the Cloudflare staging environment,
  and `scripts/stamp.sh` resolves the commit and ref from the checkout when
  they are not passed, so a Cloudflare build can stamp itself.

## [0.1.0] — 2026-09-06

The site is live at `kalaayanastudios.com` as a holding page, with the complete
site staged behind it.

### Added
- Full site built from the studio profile deck: hero, our story, expertise,
  monumental landmarks, temple architecture, portraits and life sculptures,
  murals and contact. Staged at `preview.html` pending launch.
- Scroll and motion system: progress bar, sticky header with scrollspy, hero
  parallax, `IntersectionObserver` reveals, animated counters, pointer tilt,
  lightbox. All suppressed under `prefers-reduced-motion`.
- The studio's logo, keyed out of a checkerboarded JPEG to true transparency
  and split into a full lockup, a mark and a favicon.
- The Hanuman photograph as the full-bleed hero.
- `themes.html` — eight colour directions and twelve lettering directions on
  the real page chrome, for choosing a look. Marked `noindex`.
- A **Coming Soon** holding page at `index.html` with no navigation, buttons or
  JavaScript, carrying contact details so enquiries are not lost.
- Custom domain `kalaayanastudios.com`, with canonical, Open Graph and Twitter
  tags, a social card, `robots.txt` and a sitemap.
- GitHub Pages deployment, with asset URLs stamped by commit SHA so a deploy
  can never be masked by a stale browser cache.

### Changed
- Site palette set to **Bone on Charcoal** — `#0A0908` on every surface,
  `#22333B` cards, `#5E503F` rules, `#C6AC8F` accent, `#EAE0D5` text — with
  headings in Cinzel and body in Jost.

[Unreleased]: https://github.com/SHRENIKYD/KAlAAYANA/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.2
[1.0.1]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.1
[1.0.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.0
[0.1.1]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v0.1.1
[0.1.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v0.1.0
