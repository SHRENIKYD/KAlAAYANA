# Kalaayana Studios

Static marketing site for **Kalaayana Studios LLP** — monumental sculpture, temple
architecture and portrait work — built from the studio's profile deck.

## Development

Branching, versioning, releases and rollback are documented in
**[CONTRIBUTING.md](CONTRIBUTING.md)**. In short:

```
feature/*  ──PR──▶  develop  ──PR──▶  main
                       │                │
                 staging (private)   kalaayanastudios.com
```

`main` and `develop` are both PR-only. `VERSION` plus `CHANGELOG.md` drive
releases, and every deployment publishes `/version.json` so you can always tell
exactly what is live.

## Current state: holding page

`index.html` is the **Coming Soon** holding page — that is what
`kalaayanastudios.com` serves. The complete site sits at `preview.html`,
marked `noindex, nofollow`, and is reviewed on the private staging
environment until it is signed off.

Work happens on **https://kalaayana.shrenikyd.workers.dev/**, which serves the
site under development at its root and is private behind Cloudflare Access.
Only a `develop` → `main` release changes what the public domain shows.

`1.0.0` launched the full site and `1.0.1` pulled it back pending
verification. Relaunching is the same swap in reverse:

```bash
git mv index.html coming-soon.html
git mv preview.html index.html
```

then remove `noindex` from the new `index.html` and restore its canonical tag.

## Sections

| Section | Source content |
| --- | --- |
| Hero | Studio wordmark |
| Our Story | Five-generation lineage: Sri Tippaji → Shilpi K. Narayana Rao → Vishal Kavatekar |
| Expertise | Monumental landmarks, public sculptures, temple architecture, architectural installations, portrait & life sculptures; materials FRP / metal / concrete / GFRC |
| Monumental Landmarks | 7 major projects (85 ft Hanuman Hangluru → 25 ft Hanuman Punjab) |
| Temple Architecture | 4 facades and arches |
| Portraits & Life Sculptures | 9 works |
| Murals | 9 relief panels |
| Contact | Address, email, Instagram, phone numbers |

## Colour directions

The site runs **Bone on Charcoal** (theme 08): `#0A0908` on every surface,
`#22333B` cards, `#5E503F` rules, `#C6AC8F` accent, `#EAE0D5` text, `#AC957B`
muted, set in Cinzel and Jost.

`themes.html` presents eight complete palette directions — Ochre Nightfall,
Temple Stone, Bronze Patina, Sandalwood Maroon, Concrete & Saffron,
Indigo Vermilion, Slate & Bone and Bone on Charcoal (live) — each rendered on the real
page chrome with its tokens, hex values and type pairing. Live at `/themes.html`; it is marked `noindex`
and kept out of the sitemap, being an internal design tool rather than public
content.

It also carries twelve lettering directions — inscriptional (Cinzel), slanted
serifs (Cormorant Garamond, Playfair Display, DM Serif Display and EB Garamond
italics), calligraphic scripts (Tangerine, Great Vibes, Pinyon Script,
Parisienne), ornamental (Italiana) and Indic display faces (Rozha One, Yatra
One). Type and palette are independent; a selector on the page applies any face
to all eight palette mockups at once.

Slate & Bone comes from a five-colour Coolors palette
(`0a0908-22333b-eae0d5-c6ac8f-5e503f`). Five colours cover six of the seven
roles, so `muted` is derived as a 75/25 mix of the khaki and the brown
(`#AC957B`) — chosen to clear 4.5:1 against both the background and the slate
surface.

Applying one means replacing the custom properties at the top of
`assets/css/style.css` (`--ink`, `--ink-2`, `--panel`, `--line`, `--gold`,
`--gold-soft`, `--text`, `--muted`, `--on-accent`, `--serif`) plus the font
link in `index.html`, then regenerating the placeholder SVGs in the new
palette.

## Images

Real assets now in place:

| File | Use |
| --- | --- |
| `logo.png` | Full lockup — Kannada mark over KALAAYANA STUDIOS. Hero centrepiece. |
| `logo-mark.png` | Kannada mark alone. Header, beside the wordmark. |
| `favicon.png` | The mark on the ink ground, 96px. |
| `hero-hanuman.jpg` | Hanuman under bamboo scaffolding. Full-bleed hero. |

Both logo files were keyed out of a JPEG that had a transparency checkerboard
baked in: the checkerboard is perfectly neutral (R=G=B) while the artwork is
warm, so alpha is derived from saturation and the artwork is flattened to its
own brand gold, `#AC9D7E`.

All 29 project photographs are the studio's own work, extracted from the
company profile PDF and committed under `src/images/projects/`. The build emits
AVIF and WebP at three widths for each.

The two figures in the Our Story section are still generated placeholders and
are marked decorative; they are the only placeholder artwork left on the site.

## Local preview

```bash
npm ci
npm run dev          # http://localhost:4321
npm run build        # writes dist/
npm run check        # validates the build and the project data
```

## Hosting

Pushes to `main` (and the development branch) run `.github/workflows/deploy-pages.yml`,
which uploads the repository root and deploys it to GitHub Pages.

**One-time setup by a repository admin** — the workflow's `GITHUB_TOKEN` is not
allowed to create the Pages site itself (`Create Pages site failed. Error: Resource
not accessible by integration`):

1. **Settings → Pages → Build and deployment → Source: `GitHub Actions`**
2. **Settings → Actions → General → Workflow permissions: `Read and write permissions`**
3. Re-run the **Deploy site to GitHub Pages** workflow.

The site serves from `https://kalaayanastudios.com/`.

## Custom domain

The repo root carries a `CNAME` file containing `kalaayanastudios.com`, and
`index.html` declares that origin in its canonical, Open Graph and Twitter
tags. Two steps happen outside the repo:

**1. Repository — Settings → Pages → Custom domain:** enter
`kalaayanastudios.com`, save, and tick *Enforce HTTPS* once the certificate
has been issued (this can take up to an hour after DNS resolves).

**2. DNS at the registrar for `kalaayanastudios.com`:**

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `shrenikyd.github.io.` |

Once the custom domain is set, GitHub redirects
`shrenikyd.github.io/KAlAAYANA/` to the apex domain automatically, so existing
links keep working. Every asset path in the site is relative, so the pages
serve correctly from both the old project subpath and the new domain root.

## Cache busting

`index.html` references its CSS and JS as `?v=dev`. The deploy workflow
rewrites that to the first eight characters of the commit SHA before uploading
the artifact, so every deploy serves fresh asset URLs and browsers cannot hold
a stale stylesheet. Keep `?v=dev` in the committed file — it is the marker the
workflow substitutes, and it means local preview is never cached either.

## Stack

Astro generates static HTML from `src/data`. No client framework and no
JavaScript shipped beyond the site's own scroll effects, which use
`IntersectionObserver` and a `requestAnimationFrame`-throttled scroll handler and
are disabled under `prefers-reduced-motion`.

```
src/data/     content — projects.json, site.json
src/pages/    index.astro (holding page), preview.astro (the site)
src/layouts/  Base.astro — the document head
src/images/   originals, processed at build time
public/       served verbatim: CSS, JS, placeholder art, CNAME, robots, sitemap
dist/         build output, deployed
```

Adding a project means adding an object to `src/data/projects.json`. No template
is touched, and `npm run check` fails the build if a required field is missing,
a slug is duplicated or an image is absent.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning.
