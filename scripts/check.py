#!/usr/bin/env python3
"""Pre-merge checks. Fails the build on anything that would ship broken."""
import os, re, sys, json

FAIL = []
def bad(msg): FAIL.append(msg)

html = sorted(f for f in os.listdir('.') if f.endswith('.html'))
if not html:
    bad('no HTML files found at the repo root')

# 1. Every local asset a page references must exist.
ref = re.compile(r'(?:src|href)="(?!https?:|mailto:|tel:|data:|#)([^"?#]+)')
for page in html:
    body = open(page, encoding='utf-8').read()
    for path in set(ref.findall(body)):
        if not os.path.exists(path):
            bad('%s references a missing file: %s' % (page, path))

# 2. VERSION must be semver.
try:
    version = open('VERSION', encoding='utf-8').read().strip()
except FileNotFoundError:
    version = ''
    bad('VERSION file is missing')
if version and not re.fullmatch(r'\d+\.\d+\.\d+', version):
    bad('VERSION is not semver: %r' % version)

# 3. The public entry point must declare its canonical origin.
if 'index.html' in html:
    home = open('index.html', encoding='utf-8').read()
    if 'rel="canonical"' not in home:
        bad('index.html has no canonical link')
    if 'noindex' in home:
        bad('index.html is marked noindex — it is the public page')

# 4. Staged pages must stay out of search.
for page in ('coming-soon.html', 'themes.html'):
    if page in html and 'noindex' not in open(page, encoding='utf-8').read():
        bad('%s is not marked noindex but is not the public page' % page)

# 5. Releasing to production requires a changelog entry for this version.
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

print('checked %d page(s) at version %s' % (len(html), version or '?'))
for f in FAIL:
    print('FAIL: %s' % f)
sys.exit(1 if FAIL else 0)
