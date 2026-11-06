#!/usr/bin/env python3
"""Pre-merge checks. Runs against the build output, since that is what ships."""
import os, re, sys, json, datetime

OUT = os.environ.get('OUT_DIR', 'dist')
FAIL = []
staging = os.environ.get('BUILD_ENV') == 'staging'
def bad(msg): FAIL.append(msg)

if not os.path.isdir(OUT):
    print('FAIL: %s/ not found — run the build first' % OUT)
    sys.exit(1)

# Walk, not listdir: routes such as temples/<slug>.html live in subdirectories
# and must be checked too.
html = sorted(
    os.path.relpath(os.path.join(root, f), OUT)
    for root, _dirs, files in os.walk(OUT)
    for f in files if f.endswith('.html')
)
if not html:
    bad('no HTML files in %s/' % OUT)

# 1. Every local asset a page references must exist in the output.
ref = re.compile(r'(?:src|href)="(?!https?:|mailto:|tel:|data:|#)([^"?#]+)')
for page in html:
    body = open(os.path.join(OUT, page), encoding='utf-8').read()
    for path in set(ref.findall(body)):
        if not os.path.exists(os.path.join(OUT, path.lstrip('/'))):
            bad('%s references a missing file: %s' % (page, path))

# 2. VERSION uses the studio's custom release format (patch 00 through 99).
try:
    version = open('VERSION', encoding='utf-8').read().strip()
except FileNotFoundError:
    version = ''
    bad('VERSION file is missing')
if version and not re.fullmatch(r'(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.\d{1,2}', version):
    bad('VERSION must use MAJOR.MINOR.PATCH with patch 00 through 99: %r' % version)

# 3. Indexing follows the LIVE marker. Before launch only the holding page is
#    indexable. After it, the holding page (served at /coming-soon/ once stamped)
#    is the only noindex route, the full site claims the canonical origin, and
#    every other page is indexable. Legacy .html aliases always stay noindex.
#    Checked by exclusion, so a route added later is covered automatically.
live = os.path.exists('LIVE')
def page_text(page): return open(os.path.join(OUT, page), encoding='utf-8').read()
def is_alias(page):
    return page.endswith('.html') and not page.endswith('index.html') and \
        os.path.exists(os.path.join(OUT, page[:-5], 'index.html'))
# Files copied verbatim from public/ (design mockups) are not site routes and
# must never enter search, live or not.
def is_static(page): return os.path.exists(os.path.join('public', page))

if 'index.html' in html:
    home = page_text('index.html')
    if 'rel="canonical"' not in home:
        bad('index.html has no canonical link')
    if not staging and not live and 'noindex' in home:
        bad('index.html is marked noindex — it is the public page')
    if live and 'noindex' not in home:
        bad('index.html (holding page) must be noindex once LIVE exists')

if live and 'preview/index.html' in html:
    public = page_text('preview/index.html')
    if 'noindex' in public:
        bad('preview/index.html is marked noindex but is the public site once LIVE exists')
    if 'rel="canonical" href="https://kalaayanastudios.com/"' not in public:
        bad('preview/index.html must claim the canonical origin once LIVE exists')

for page in sorted(html):
    text = page_text(page)
    if is_alias(page) or is_static(page):
        if 'noindex' not in text:
            bad('%s is not a site route and must be noindex' % page)
        continue
    if live:
        if page != 'index.html' and 'noindex' in text:
            bad('%s is marked noindex but the site is live' % page)
    else:
        if page == 'index.html' and not staging:
            continue
        if 'noindex' not in text:
            bad('%s is not marked noindex but is not the public page' % page)

# 4. The sitemap must exist and list exactly the indexable routes.
sitemap_path = os.path.join(OUT, 'sitemap.xml')
if not os.path.exists(sitemap_path):
    bad('sitemap.xml is missing from the build')
else:
    listed = set(re.findall(r'<loc>https://kalaayanastudios\.com(/[^<]*)</loc>', open(sitemap_path, encoding='utf-8').read()))
    expected = set()
    for page in html:
        if not page.endswith('index.html') or 'noindex' in page_text(page):
            continue
        route = '/' + page[:-len('index.html')]
        if live and route == '/preview/':
            route = '/'
        expected.add(route)
    for route in sorted(expected - listed):
        bad('sitemap.xml does not list indexable route %s' % route)
    for route in sorted(listed - expected):
        bad('sitemap.xml lists %s, which is not an indexable route' % route)

# 4b. Every page carries its Content Security Policy.
for page in html:
    if '<meta http-equiv="Content-Security-Policy"' not in page_text(page):
        bad('%s has no Content-Security-Policy meta' % page)
if os.path.exists(os.path.join(OUT, '_headers')) and '__SCRIPT_HASHES__' in open(os.path.join(OUT, '_headers'), encoding='utf-8').read():
    bad('_headers still carries the script hash placeholder')

# 5. Content data must be well formed — a malformed project must fail the build,
#    not reach a visitor. Presentation is not consulted; this checks data alone.
REQUIRED = ('slug', 'group', 'title', 'scale', 'description')
try:
    GROUPS = set(json.load(open('src/data/site.json', encoding='utf-8'))['sections'])
except Exception as e:
    GROUPS = set()
    bad('site.json sections are unreadable: %s' % e)
for key, section in (json.load(open('src/data/site.json', encoding='utf-8')).get('sections', {}) if GROUPS else {}).items():
    for field in ('eyebrow', 'title', 'lede', 'banner', 'bannerAlt', 'href'):
        if not str(section.get(field, '')).strip():
            bad('section %s is missing %s' % (key, field))
    if section.get('banner') and not os.path.exists(os.path.join('src/images/sections', section['banner'])):
        bad('section %s banner is missing: %s' % (key, section.get('banner')))

# 5a. Admin users: valid emails, known roles, at least one superadmin.
try:
    users = json.load(open('admin/users.json', encoding='utf-8')).get('users', [])
except Exception as e:
    users = None
    bad('admin/users.json is unreadable: %s' % e)
if users is not None:
    if not any(u.get('role') == 'superadmin' for u in users):
        bad('admin/users.json needs at least one superadmin')
    for u in users:
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', str(u.get('email', ''))):
            bad('admin/users.json has an invalid email: %r' % u.get('email'))
        if u.get('role') not in ('superadmin', 'admin'):
            bad('admin/users.json has an unknown role for %s: %r' % (u.get('email'), u.get('role')))

# 5b. Homepage features are data too: every entry needs its text and a real image.
try:
    works = json.load(open('src/data/site.json', encoding='utf-8')).get('home', {}).get('works', [])
except Exception:
    works = []
if not works:
    bad('site.json home.works is empty — the homepage would show no work')
for i, w in enumerate(works):
    where = 'home.works[%d]' % i
    for field in ('href', 'eyebrow', 'title', 'link'):
        if not str(w.get(field, '')).strip():
            bad('%s is missing %s' % (where, field))
    if w.get('section') is not None:
        if w['section'] not in GROUPS:
            bad('%s names a work that does not exist: %s' % (where, w['section']))
        elif w.get('href') != '/%s/' % w['section']:
            bad('%s must link to /%s/' % (where, w['section']))
    image = w.get('image') or {}
    if image.get('from') not in ('projects', 'sections'):
        bad('%s image.from must be projects or sections' % where)
    elif not os.path.exists(os.path.join('src/images', image['from'], str(image.get('file', '')))):
        bad('%s image is missing: %s/%s' % (where, image['from'], image.get('file')))
    if not str(image.get('alt', '')).strip():
        bad('%s image needs alt text' % where)
    if image.get('zoom') is not None and not (isinstance(image['zoom'], (int, float)) and 1 <= image['zoom'] <= 3):
        bad('%s image zoom must be a number between 1 and 3' % where)
    if image.get('fit') is not None and image['fit'] not in ('cover', 'contain'):
        bad('%s image fit must be cover or contain' % where)
    if image.get('background') is not None and not re.fullmatch(r'#[0-9a-fA-F]{6}', str(image['background'])):
        bad('%s image background must be a hex colour' % where)
    if image.get('focus') is not None and not re.fullmatch(r'\d{1,3}% \d{1,3}%', str(image['focus'])):
        bad('%s image focus must look like "50%% 40%%"' % where)
try:
    projects = json.load(open('src/data/projects.json', encoding='utf-8'))
except Exception as e:
    projects = []
    bad('projects.json is unreadable: %s' % e)

seen = set()
for i, p in enumerate(projects):
    where = p.get('slug') or '#%d' % i
    for field in REQUIRED:
        if not str(p.get(field, '')).strip():
            bad('project %s is missing %s' % (where, field))
    if p.get('group') not in GROUPS:
        bad('project %s has unknown group %r' % (where, p.get('group')))
    if p.get('slug') in seen:
        bad('duplicate project slug: %s' % p.get('slug'))
    seen.add(p.get('slug'))
    # Every project needs at least one photograph, each with alt text. The
    # photographs are build inputs: the pipeline emits hashed variants into the
    # output, so the invariant is that the source file exists.
    images = p.get('images')
    if not isinstance(images, list) or not images:
        bad('project %s has no images' % where)
        continue
    for n, im in enumerate(images, 1):
        if not str(im.get('alt', '')).strip():
            bad('project %s image %d has no alt text' % (where, n))
        f = str(im.get('file', ''))
        if not f:
            bad('project %s image %d has no file' % (where, n))
            continue
        path = os.path.join('src', 'images', 'projects', f)
        if not os.path.exists(path):
            bad('project %s references a missing source image: %s' % (where, path))

# 5b. A section that opens with a banner must have the banner it names.
try:
    site = json.load(open('src/data/site.json', encoding='utf-8'))
except Exception as e:
    site = {}
    bad('site.json is unreadable: %s' % e)

for key, sec in (site.get('sections') or {}).items():
    if 'banner' not in sec:
        continue
    for field in ('bannerAlt', 'href'):
        if not str(sec.get(field, '')).strip():
            bad('section %s has a banner but no %s' % (key, field))
    img = os.path.join('src', 'images', 'sections', str(sec.get('banner', '')))
    if not os.path.exists(img):
        bad('section %s references a missing banner image: %s' % (key, img))

# 5c. Production freeze. A date in the FREEZE file blocks merges into main until
#     it passes. This runs in the "Checks" job, which the repository ruleset makes
#     a required status check on main, so the gate is enforced rather than advisory
#     — the last freeze lived only in CONTRIBUTING.md and a PR went straight past it.
#     It also expires by itself: no edit is needed on the day, and the file can then
#     be deleted.
base_ref = os.environ.get('BASE_REF', '').strip()
try:
    freeze_until = open('FREEZE', encoding='utf-8').read().strip()
except FileNotFoundError:
    freeze_until = ''
if freeze_until:
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', freeze_until):
        bad('FREEZE is not an ISO date (YYYY-MM-DD): %r' % freeze_until)
    elif base_ref == 'main':
        today = datetime.date.today().isoformat()
        if today < freeze_until:
            bad('production is frozen until %s (today is %s) — this PR targets main. '
                'Merge into develop and review on staging; see CONTRIBUTING.md.'
                % (freeze_until, today))
        else:
            print('freeze lapsed on %s — delete the FREEZE file' % freeze_until)

# 6. Every changed release version requires notes, including staging milestones.
base = os.environ.get('BASE_VERSION', '').strip()
version_changed = bool(base and base != version)
if version_changed and re.fullmatch(r'\d+\.\d+\.\d+', base) and re.fullmatch(r'\d+\.\d+\.\d+', version):
    if tuple(map(int, version.split('.'))) <= tuple(map(int, base.split('.'))):
        bad('VERSION %s must be greater than base version %s' % (version, base))
if (os.environ.get('REQUIRE_RELEASE_NOTES') == 'true' or version_changed) and version:
    try:
        log = open('CHANGELOG.md', encoding='utf-8').read()
    except FileNotFoundError:
        log = ''
        bad('CHANGELOG.md is missing')
    if log and ('## [%s]' % version) not in log:
        bad('CHANGELOG.md has no "## [%s]" section — every release needs notes' % version)
    if base and base == version:
        bad('VERSION is still %s — bump it before merging to main' % version)

print('checked %d page(s), %d project(s) and %d photograph(s) at version %s'
      % (len(html), len(projects), sum(len(p.get('images') or []) for p in projects), version or '?'))
for f in FAIL:
    print('FAIL: %s' % f)
sys.exit(1 if FAIL else 0)
