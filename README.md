# Kalaayana Studios

Static marketing site for **Kalaayana Studios LLP** — monumental sculpture, temple
architecture and portrait work — built from the studio's profile deck.

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

`themes.html` presents six complete palette directions — Ochre Nightfall (live),
Temple Stone, Bronze Patina, Sandalwood Maroon, Concrete & Saffron and Indigo
Vermilion — each rendered on the real page chrome with its seven tokens, hex
values and type pairing. Live at `/KAlAAYANA/themes.html`.

Applying one means replacing the seven custom properties at the top of
`assets/css/style.css` (`--ink`, `--ink-2`, `--panel`, `--line`, `--gold`,
`--gold-soft`, `--text`, `--muted`) plus the font links in `index.html`.

## Images

Every image in `assets/img/` is a generated SVG **placeholder**. Replace each file
with the real photograph of the same name (any web format) and update the `src`
attribute in `index.html` if the extension changes.

## Local preview

```bash
python3 -m http.server 8000
# open http://localhost:8000
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

The site then serves from `https://shrenikyd.github.io/KAlAAYANA/`.

## Stack

Plain HTML, CSS and vanilla JavaScript — no build step. Scroll effects use
`IntersectionObserver` and a `requestAnimationFrame`-throttled scroll handler, and
all motion is disabled under `prefers-reduced-motion`.
