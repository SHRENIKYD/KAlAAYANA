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

# 3. The public entry point must declare its canonical origin and be indexable.
if 'index.html' in html:
    home = open(os.path.join(OUT, 'index.html'), encoding='utf-8').read()
    if 'rel="canonical"' not in home:
        bad('index.html has no canonical link')
    if not staging and 'noindex' in home:
        bad('index.html is marked noindex — it is the public page')

# 4. Staged pages must stay out of search. Every page except the public entry
#    point is staged, so this is checked by exclusion — a new route added later
#    is covered without anyone remembering to list it here.
for page in sorted(html):
    if page == 'index.html' and not staging:
        continue
    if 'noindex' not in open(os.path.join(OUT, page), encoding='utf-8').read():
        bad('%s is not marked noindex but is not the public page' % page)

# 5. Content data must be well formed — a malformed project must fail the build,
#    not reach a visitor. Presentation is not consulted; this checks data alone.
REQUIRED = ('slug', 'group', 'title', 'scale', 'description')
GROUPS = {'landmarks', 'temples', 'portraits', 'murals', 'installations'}
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

# 5c. Production freeze. FREEZE holds the moment the freeze is scheduled to lift,
#     and blocks merges into main until it passes. This runs in the "Checks" job,
#     which the repository ruleset makes a required status check on main, so the
#     gate is enforced rather than advisory — the last freeze lived only in
#     CONTRIBUTING.md and a PR went straight past it.
#
#     A bare date (2026-11-09) means midnight UTC on it. A launch is set in the
#     team's own clock, not UTC, so a timestamp with an offset is also accepted
#     and is the clearer form: 2026-11-08T22:00:00+05:30 is 22:00 IST, which no
#     bare date can express. Both are compared as instants, so the gate cannot
#     drift with the runner's timezone.
#
#     Note that scripts/deploy_guard.py blocks a deploy while the FREEZE file
#     exists at all, whatever it says. That is deliberate: the timestamp lets a
#     release PR merge, and deleting the file is the separate, reviewed act that
#     lets it deploy.
base_ref = os.environ.get('BASE_REF', '').strip()
try:
    freeze_until = open('FREEZE', encoding='utf-8').read().strip()
except FileNotFoundError:
    freeze_until = ''
if freeze_until:
    moment = None
    if re.fullmatch(r'\d{4}-\d{2}-\d{2}', freeze_until):
        moment = datetime.datetime.fromisoformat(freeze_until).replace(
            tzinfo=datetime.timezone.utc)
    else:
        try:
            parsed = datetime.datetime.fromisoformat(freeze_until)
        except ValueError:
            parsed = None
        if parsed is None or parsed.tzinfo is None:
            bad('FREEZE must be an ISO date (2026-11-09) or a timestamp carrying a '
                'UTC offset (2026-11-08T22:00:00+05:30): %r' % freeze_until)
        else:
            moment = parsed
    if moment is not None and base_ref == 'main':
        now = datetime.datetime.now(datetime.timezone.utc)
        if now < moment:
            bad('production is frozen until %s (now %s) — this PR targets main. '
                'Merge into develop and review on staging; see CONTRIBUTING.md.'
                % (freeze_until, now.isoformat(timespec='seconds')))
        else:
            print('freeze lapsed at %s — delete the FREEZE file to allow a deploy'
                  % freeze_until)

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
