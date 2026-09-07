# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Versions below `1.0.0` cover the pre-launch period, during which the public site
is a holding page. `1.0.0` marks the launch of the full site.

## [Unreleased]

### Added
- **Sections can open with a banner instead of a grid.** Temple Architecture is
  the first: the home page now shows the section name over a photograph of the
  Whitefield facade at dusk, with a single **View All** button. It follows the
  divider pages in the company profile PDF.
- `/temples.html` — the section gallery, all four temple projects.
- `/temples/<slug>.html` — each project on its own page, generated from the
  data, with scale, description, breadcrumbs and the rest of the section
  beneath. Adding a project to `projects.json` adds its page; no route is
  written by hand.
- `src/components/ProjectCard.astro` and `SectionBanner.astro`, plus
  `src/lib/photos.ts`, so the home page, the gallery and the project pages
  resolve and render photographs the same way rather than each keeping a copy.
- The studio's own photographs of all 29 projects, replacing the generated
  placeholder art. They were extracted from the company profile PDF supplied at
  the start of the project, so every image is work Kalaayana made and owns.
  Committed under `src/images/projects/` at up to 1600px, 4.7 MB in total.
- Real alt text for every project, written from the photographs themselves
  rather than from the project titles. No image now says "Placeholder".

### Changed
- Project photographs go through the image pipeline: AVIF and WebP at 400, 800
  and 1200px with a `sizes` hint matching the grid, so a 385px card fetches the
  400px variant rather than the 1200px one.
- Card frame from 4:3 landscape to 3:4 portrait. The work is vertical — at 4:3
  the 85-foot Hanuman at Hangluru had its head cropped off. Reliefs and murals
  were checked separately and still read correctly.
- The footer no longer claims all imagery is placeholder artwork, which stopped
  being true with this change.
- The two Our Story figures are now photographs from the studio's own archive:
  Shilpi K. Narayana Rao's signed elevation for the Anjaneya Arch Mantapa at
  Chikkanayakanahalli, and the team finishing the Bengaluru Buddha on bamboo
  scaffolding. Both carry real alt text. **No placeholder artwork remains on
  the site.**
- The drawing is cropped above the handwritten mobile number beneath the
  signature, so a personal phone number is not published. The signature itself
  is kept — it is the provenance.
- `img` now carries `height:auto` alongside `max-width:100%`. Astro emits real
  `width`/`height` attributes, so without it the drawing was stretched to its
  intrinsic height inside a narrower column. Hero and card images set their own
  height and are unaffected.
- The one wide card, Hanuman, Punjab, is now a normal card. `wide` spanned three
  columns, which under the 3:4 frame rendered a 1218×1624 image; the flag was a
  leftover from the 4:3 placeholder grid and every photograph is portrait. All
  29 cards now share one frame.
- The header carries one name. It showed the Kannada logo mark beside the
  Latin wordmark — two readings of the same name in a 96px bar. The mark is
  gone; `KALAAYANA / STUDIOS` remains. The Kannada logo still leads the hero
  and the holding page, where it has room to be read.
- `scripts/check.py` walks `dist/` rather than listing its top level, so pages
  in subdirectories are checked too — the four new project pages were invisible
  to it otherwise. Staged pages are now identified by exclusion: everything
  except `index.html` must be noindex, so a route added later is covered
  without anyone remembering to list it.
- `scripts/check.py` also validates section banner data: a section that names a
  banner must have the image, alt text and link to go with it.
- `main.js` no longer assumes the home page's furniture. The footer year,
  progress bar, nav toggle and lightbox are each optional, and the lightbox
  skips any card that is itself a link, where the click belongs to the
  navigation.
- The logo is vector. `logo.png` was 736px wide but displayed at 560 CSS px,
  which is 1120 device pixels at 2x — a 1.5x upscale, and it sat in `public/`
  so it bypassed the image pipeline entirely. It is now `logo.svg`, traced from
  that same file, so it cannot blur at any size. 30 curves, 29.5 KB gzipped
  against the PNG's 43 KB.
- Contact email is now `contact@kalaayanastudios.com`.
- In-page navigation no longer writes `#section` into the address bar. Links
  still work and still scroll to the right place; arriving on a deep link
  scrolls and then drops the fragment, including on back/forward.
- The favicon is a bone circle carrying the leading glyph of the Kannada
  wordmark in ink, cut from `logo.png` itself rather than redrawn. It was a
  dark square holding the whole wordmark, which is 2.2x wider than it is tall
  and rendered as an unreadable smudge at the 16px browsers actually draw.
  One glyph reads at every size, and a light mark stands out against dark
  browser chrome.
- The hero photograph is sharper. It was 876x1558 — the resolution of the file
  originally supplied — stretched across 2880 device pixels on a 1440px screen
  at 2x, a 3.3x upscale, which is what made it look soft. The company profile
  PDF holds the same frame at 1590x1967, so the hero now runs from that: no
  upscale at all on a phone, and 1.8x instead of 3.3x on desktop.
- Hero framing follows from that. The PDF frame is tighter, so `object-position`
  moves from `50% 30%` to `50% 0%` and the parallax overscan from 12% to 3%,
  which brings the face back into view. The overscan was only ever a safety
  margin — the parallax translates the layer down while the page scrolls up, so
  it cannot open a gap; measured across the hero's whole scroll range at both
  widths and at every overscan value down to 0, the gap is 0px.
- The native scrollbar is hidden on both mobile and desktop. The 2px progress
  bar at the top of the page already reports scroll position, so the two were
  redundant. Scrolling is untouched — wheel, touch, keyboard and anchor links
  all work, and the progress bar tracks position exactly (verified at 50% and
  at the foot of the page, at 1440px and 390px).
- `scripts/check.py` validates project images against `src/images/projects/`
  rather than the build output, since they are build inputs that the pipeline
  emits as hashed variants.

### Removed
- The 29 placeholder SVGs, now unreferenced.
- `story-01.svg` and `story-02.svg`, the last two generated illustrations.
- `logo-mark.png`, the header's Kannada mark, now unreferenced.
- `logo.png`, superseded by `logo.svg` and no longer referenced.

## [1.1.0] — 2026-09-07

Phase one of the architecture work. The site is now generated from data rather
than hand-maintained as markup. **No visible change** — the rendered page is
identical to the hand-written one.

### Added
- Astro build. `src/pages` holds the two pages, `src/layouts/Base.astro` owns
  the document head, and `dist/` is the deployed output.
- `src/data/projects.json` — all 29 projects as data. Adding a project means
  adding an object; no template is touched.
- `src/data/site.json` — navigation, expertise, statistics, materials, section
  headings, story and contact details, each defined once.
- Build-time image processing. The hero photograph is emitted as AVIF and WebP
  at four widths with `srcset`; it drops from 142 kB to 69 kB with no visible
  change. This is the pipeline the real photographs will use.
- Data validation in `scripts/check.py`: a project missing a required field,
  carrying an unknown group, duplicating a slug or pointing at an image that is
  not in the build now fails the build. It caught a real regression during this
  work — a hero reference left behind when the file moved.

### Changed
- `scripts/check.py` and `scripts/stamp.sh` operate on the build output rather
  than the repository root, since the output is what ships.
- Workflows install Node, run `npm ci` and build before checking; the Pages
  artifact is `./dist`.
- `wrangler.jsonc` serves `./dist`. `.assetsignore` is removed — the build
  output contains only the site, so there is nothing to exclude.

### Verified
Old and new rendered side by side in a browser and compared on twenty-one
properties: title, section ids, navigation labels, all 29 card titles and
scales, statistics, expertise, materials, section titles, contact links,
address, story text, background, card and accent colours, heading font, page
height, console errors and failed requests. **Every one identical**, and the
landmarks screenshots are pixel-identical.

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

[Unreleased]: https://github.com/SHRENIKYD/KAlAAYANA/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.1.0
[1.0.2]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.2
[1.0.1]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.1
[1.0.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v1.0.0
[0.1.1]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v0.1.1
[0.1.0]: https://github.com/SHRENIKYD/KAlAAYANA/releases/tag/v0.1.0
