#!/usr/bin/env python3
"""Pre-merge checks. Runs against the build output, since that is what ships."""
import os, re, sys, json

OUT = os.environ.get('OUT_DIR', 'dist')
FAIL = []
def bad(msg): FAIL.append(msg)

if not os.path.isdir(OUT):
    print('FAIL: %s/ not found — run the build first' % OUT)
    sys.exit(1)

html = sorted(f for f in os.listdir(OUT) if f.endswith('.html'))
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

# 4. Staged pages must stay out of search.
for page in ('preview.html', 'coming-soon.html', 'themes.html'):
    if page in html and 'noindex' not in open(os.path.join(OUT, page), encoding='utf-8').read():
        bad('%s is not marked noindex but is not the public page' % page)

# 5. Content data must be well formed — a malformed project must fail the build,
#    not reach a visitor. Presentation is not consulted; this checks data alone.
REQUIRED = ('slug', 'group', 'title', 'scale', 'description', 'image', 'alt')
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
    img = os.path.join(OUT, 'assets', 'img', str(p.get('image', '')))
    if p.get('image') and not os.path.exists(img):
        bad('project %s references a missing image: %s' % (where, p.get('image')))

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

print('checked %d page(s) and %d project(s) at version %s' % (len(html), len(projects), version or '?'))
for f in FAIL:
    print('FAIL: %s' % f)
sys.exit(1 if FAIL else 0)
