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

**Astro** generates them. Content collections validate the project data against
a schema at build time, so a missing image or a mistyped field fails the build
instead of shipping. `astro:assets` produces responsive variants without a
plugin, and i18n routing is first-class. Nothing ships to the browser unless
asked for: the output is static HTML with zero JavaScript, exactly as now.

The site remains 100% static. Hosting, DNS, Access and the release pipeline are
unchanged. Only the origin of the HTML changes.

Rejected, and why:

- **Eleventy** — excellent and mature, and the first choice here. Ruled out by
  the commerce horizon below: it is a pure static generator with no server
  story, so reaching commerce would mean replacing it or bolting separate
  infrastructure alongside it.
- **Next.js, SvelteKit and similar** — ship a JavaScript runtime to render text
  and photographs that never change. The site's most valuable technical
  property is that it is plain HTML which renders instantly on a mobile
  connection. These trade that away for conveniences a portfolio does not need.
- **Tailwind** — the existing 204 lines of hand-written CSS with custom
  properties do the job and the tokens are already clean. Replacing them with
  utility classes is a rewrite that buys nothing.

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

## Engineering principles

The intent is a codebase that stays principled as it grows into an application.
What that means concretely differs from what the words usually imply, so it is
worth being exact.

### Applied from the start

**Separation of concerns.** Content, presentation, behaviour and build tooling
are separate and stay separate. `src/data` knows nothing about how it is
rendered; templates know nothing about where data came from.

**Single source of truth.** Every fact is defined once. Design tokens live in
CSS custom properties only, and each project is one object in `projects.json`,
feeding its card, its detail page, its translation and its images.

`themes.html` is the exception, deliberately: it is a comparison tool that
exists to show eight palettes side by side, so holding all eight is its purpose
rather than a second definition of the live one. It sits outside the site's
dependency graph and ships as a static file.

**Dependency direction points inward.** Presentation depends on the content
schema. The schema does not know presentation exists. Renaming a CSS class must
never require touching data.

**Open for extension, closed for modification.** Adding a project means adding
data, never editing rendering code. This is the concrete, useful form of the
principle here — if adding the twenty-ninth project requires a template change,
the design is wrong.

**Validate at the boundary.** Content collections carry schemas. A missing
image, a malformed dimension or a mistyped field fails the build rather than
reaching a visitor. Errors surface where they are cheap.

**Composition over repetition.** One project template, not twenty-eight cards.
One layout, not four page shells that drift apart.

### Deliberately deferred

Layered architecture — entities, use cases, repositories, interface adapters —
and dependency inversion through interfaces are **not** applied now, and that is
a decision rather than an oversight.

Those patterns exist to protect domain logic from infrastructure. This site has
no domain logic. There are no business rules, no invariants, no state
transitions — it renders content. Adding those layers today would create
indirection with nothing behind it: more files, more concepts, no protection,
and a codebase that is harder to change while looking more rigorous.

**Trigger for revisiting:** the first real business rule. Commerce brings
pricing, tax, inventory and orders — genuine domain logic with invariants worth
protecting. At that point the boundary is drawn properly: domain logic that
knows nothing about Stripe, Cloudflare or Astro, with those as replaceable
details at the edges.

The preparation for that is not building the layers early. It is keeping content
and presentation clean enough that a domain layer has somewhere to land.

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

## Versioning policy

A version describes what production is serving, not what is being worked on. It
is bumped only when work reaches production; `develop` keeps the version
currently live no matter how much has accumulated on it.

Feature work adds notes under `## [Unreleased]`. A release is prepared by one PR
that bumps `VERSION` and moves those notes under the new heading, and shipped by
the `develop` → `main` PR that follows. CI requires the bump and the entry only
on a PR into `main`.

## Delivery

Phased, so each release ships through the existing pipeline and is verified on
staging before the next begins.

| Version | Delivers | Visible change |
| --- | --- | --- |
| `1.1.0` | Astro build, `projects.json`, image pipeline | **None** — rendered output identical |
| `1.2.0` | Real photographs, responsive variants | The site as intended |
| `1.3.0` | Individual project pages | New URLs, internal links, sitemap |
| `2.0.0` | Kannada alongside English | `/kn/` routes, hreflang, language switch |

`1.1.0` deliberately changes nothing visible. If the generator produces output
that differs from the hand-written HTML, that is visible immediately rather than
entangled with new photography.

The bar is *rendered* equivalence, not byte equivalence. A generator will differ
in whitespace and attribute order no matter what, so chasing identical bytes
would waste effort on a property nobody can observe. It is verified by rendering
both in a browser and comparing the resulting DOM, computed styles and
screenshots.

The bar is *rendered* equivalence, not byte equivalence. A generator will differ
in whitespace and attribute order no matter what, so chasing identical bytes
would waste effort on a property nobody can observe. It is verified by rendering
both in a browser and comparing the resulting DOM, computed styles and
screenshots.

Issues 3 and 4 are small and get fixed inside `1.1.0`.

## Commerce, in one to two years

The studio expects to sell work through the site eventually. **Nothing is being
built for that now** — no product schema, no cart scaffolding, no
"commerce-ready" abstractions. In two years the tooling will have moved and,
more to the point, what is being sold will actually be known. Structure invented
today would be wrong in ways that cannot be predicted now, and would be carried
the whole way.

What keeps the door open costs nothing extra and is already in the plan: a
stack that can grow, cleanly modelled content, and stable URLs.

The specific property that matters is Astro's hybrid rendering. A site is static
by default and individual routes opt into server rendering later. Adding
commerce means adding the Cloudflare adapter and making, say, `/shop/checkout`
server-rendered, while every other page stays exactly as fast as it is today.
The cost is paid only where it is used.

The surrounding platform is already in place: Cloudflare for the adapter, R2 for
product imagery, D1 for orders if it ever comes to that.

Worth stating plainly, because it is a business project rather than a website
feature: for a sculpture studio the cart is the easy part. Payments are an
afternoon. GST, shipping work that is heavy and fragile, insurance, breakage
liability, returns on bespoke pieces and the legal pages that must exist are the
real project. Another reason to decide it later with information rather than now
without any.

## Known risks

- **Build step in two places.** GitHub Actions and the Cloudflare build command
  both need Node and `npm ci`. Most of `1.1.0`'s risk lives here, not in
  Astro itself.
- **Kannada copy.** Structure and routing are mechanical; the words are the
  studio's public voice and must be written or reviewed by a native speaker
  before publishing. A Kannada webfont also adds page weight.
- **Repository size.** Committed originals accumulate. If it becomes a problem,
  move originals to R2 and keep only derivatives in git.
