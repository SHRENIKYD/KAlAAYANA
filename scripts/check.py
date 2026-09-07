#!/usr/bin/env python3
"""Pre-merge checks. Runs against the build output, since that is what ships."""
import os, re, sys, json

OUT = os.environ.get('OUT_DIR', 'dist')
FAIL = []
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

# 2. VERSION must be semver.
try:
    version = open('VERSION', encoding='utf-8').read().strip()
except FileNotFoundError:
    version = ''
    bad('VERSION file is missing')
if version and not re.fullmatch(r'\d+\.\d+\.\d+', version):
    bad('VERSION is not semver: %r' % version)

# 3. The public entry point must declare its canonical origin and be indexable.
if 'index.html' in html:
    home = open(os.path.join(OUT, 'index.html'), encoding='utf-8').read()
    if 'rel="canonical"' not in home:
        bad('index.html has no canonical link')
    if 'noindex' in home:
        bad('index.html is marked noindex — it is the public page')

# 4. Staged pages must stay out of search. Every page except the public entry
#    point is staged, so this is checked by exclusion — a new route added later
#    is covered without anyone remembering to list it here.
for page in sorted(html):
    if page == 'index.html':
        continue
    if 'noindex' not in open(os.path.join(OUT, page), encoding='utf-8').read():
        bad('%s is not marked noindex but is not the public page' % page)

# 5. Content data must be well formed — a malformed project must fail the build,
#    not reach a visitor. Presentation is not consulted; this checks data alone.
REQUIRED = ('slug', 'group', 'title', 'scale', 'description')
GROUPS = {'landmarks', 'temples', 'portraits', 'murals'}
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

# 6. Releasing to production requires a changelog entry for this version.
if os.environ.get('REQUIRE_RELEASE_NOTES') == 'true' and version:
    try:
        log = open('CHANGELOG.md', encoding='utf-8').read()
    except FileNotFoundError:
        log = ''
        bad('CHANGELOG.md is missing')
    if log and ('## [%s]' % version) not in log:
        bad('CHANGELOG.md has no "## [%s]" section — every release needs notes' % version)
    base = os.environ.get('BASE_VERSION', '').strip()
    if base and base == version:
        bad('VERSION is still %s — bump it before merging to main' % version)

print('checked %d page(s), %d project(s) and %d photograph(s) at version %s'
      % (len(html), len(projects), sum(len(p.get('images') or []) for p in projects), version or '?'))
for f in FAIL:
    print('FAIL: %s' % f)
sys.exit(1 if FAIL else 0)
