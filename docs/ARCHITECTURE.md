# Architecture

Decisions recorded 2026-09-07. This documents what the site is, what it is
becoming, and why — so the reasoning survives the conversation it came from.

## Today

```
GitHub repo  (single source of truth)
   │
   ├── develop ──► Cloudflare Worker ──► Cloudflare Access ──► maintainer only
   │               staging: the site under development at /
   │
   └── main ─────► GitHub Pages ──► DNS (unproxied) ──► kalaayanastudios.com
                   production: holding page at / until relaunch
```

Static files. No server, no database, no build step. Theming through CSS custom
properties; ~157 lines of vanilla JavaScript for scroll behaviour. Releases are
tagged from `VERSION`, every build publishes `/version.json`, and any tag can be
redeployed from the Actions tab.

For a studio portfolio this shape is correct: fast, effectively free, no attack
surface, nothing to patch.

## Where it strains

| # | Issue | Consequence |
| --- | --- | --- |
| 1 | No image pipeline | Placeholders total 428 KB. Real photographs of monumental sculpture run 3–8 MB each; thirty of them is 100 MB+ of page weight, with no `srcset`, WebP or size budget. Unusable on a mobile connection. |
| 2 | Content is markup | 28 project cards and 35 `<img>` tags hand-written across 292 lines. Workable now, unmaintainable as the studio adds work. |
| 3 | `stamp.sh` mutates tracked files | It runs `sed -i` over `*.html`. Harmless in CI where the checkout is discarded; run locally it dirties the tree and stamped HTML can be committed. `.gitignore` covers `version.json` but not this. |
| 4 | Design tokens duplicated | 61 token references in `style.css`, 68 unique hex values in `themes.html`. Palette changes drift silently. |
| 5 | Staging ≠ production platform | Cloudflare Workers vs GitHub Pages differ in 404 handling, headers and redirects. Staging is high-fidelity for content, not for edge behaviour. |

## Decisions

### Pages are generated, not hand-written

Individual project pages and a second language mean 28 projects × 2 languages —
56+ pages. Hand-writing them is untenable, and client-side rendering would
defeat their purpose, since project pages exist largely for search and must be
real HTML at real URLs.

**Eleventy** generates them. It is small and mature, takes JSON data files
directly, has an i18n plugin, and `eleventy-img` produces responsive variants
with build caching. It emits plain HTML with no client framework, so abandoning
it later leaves working pages behind rather than a rewrite.

The site remains 100% static. Hosting, DNS, Access and the release pipeline are
unchanged. Only the origin of the HTML changes.

### Images are processed at build time

Originals are committed once under `src/images/`. The build emits WebP at
several widths and wires up `srcset`. Solves issue 1, and once a build step
exists this costs nothing extra.

### Content lives in JSON

`src/data/projects.json` holds every project: title, scale, material, location,
images, slug. One entry produces the home page card, the detail page, the
translated counterpart and every image variant. Adding a project means adding an
object — no markup, and no way for one card to drift from the others.

### No contact form

Enquiries continue through `mailto:` and `tel:` links. Rejected: a form endpoint
would add a service, a secret and a spam surface to a site that otherwise has
none. Revisit if enquiry volume justifies it.

## Target structure

```
src/
  data/
    projects.json      28 projects
    site.json          studio details, contact, navigation
    en.json / kn.json  interface strings
  images/              originals, committed once
  layouts/             page shells
  pages/               home, project template, contact

build ──► dist/
            index.html                            English
            kn/index.html                         Kannada
            work/hanuman-hangluru/index.html
            kn/work/hanuman-hangluru/index.html
            assets/img/…-400.webp …-800.webp …-1600.webp
            version.json
```

## Delivery

Phased, so each release ships through the existing pipeline and is verified on
staging before the next begins.

| Version | Delivers | Visible change |
| --- | --- | --- |
| `1.1.0` | Eleventy build, `projects.json`, image pipeline | **None** — output byte-identical |
| `1.2.0` | Real photographs, responsive variants | The site as intended |
| `1.3.0` | Individual project pages | New URLs, internal links, sitemap |
| `2.0.0` | Kannada alongside English | `/kn/` routes, hreflang, language switch |

`1.1.0` deliberately changes nothing visible. If the generator produces output
that differs from the hand-written HTML, that is visible immediately rather than
entangled with new photography.

Issues 3 and 4 are small and get fixed inside `1.1.0`.

## Known risks

- **Build step in two places.** GitHub Actions and the Cloudflare build command
  both need Node and `npm ci`. Most of `1.1.0`'s risk lives here, not in
  Eleventy itself.
- **Kannada copy.** Structure and routing are mechanical; the words are the
  studio's public voice and must be written or reviewed by a native speaker
  before publishing. A Kannada webfont also adds page weight.
- **Repository size.** Committed originals accumulate. If it becomes a problem,
  move originals to R2 and keep only derivatives in git.
