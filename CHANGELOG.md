# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions below `1.0.0` cover the pre-launch period, during which the public site
is a holding page. `1.0.0` marks the launch of the full site.

## [Unreleased]

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

[Unreleased]: https://github.com/SHRENIKYD/KAlAAYANA/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v0.1.0
