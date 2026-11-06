"""Content Security Policy for the build output.

Every inline script is hashed, so the policy can be enforced without
'unsafe-inline'. Each page gets a <meta http-equiv> policy carrying its own
hashes, which is the only CSP GitHub Pages can serve. dist/_headers gets the
same policy with every hash, plus the directives a meta tag cannot express.

  python scripts/csp.py           inject
  python scripts/csp.py --verify  recompute after stamping and fail on drift
"""
from pathlib import Path
import base64
import hashlib
import re
import sys

SCRIPT = re.compile(r'<script\b([^>]*)>(.*?)</script>', re.S)
META = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]*)">')
PLACEHOLDER = '__SCRIPT_HASHES__'

DIRECTIVES = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self'{hashes}",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "frame-src https://maps.google.com https://www.google.com",
    "connect-src 'self'",
    "form-action 'self' mailto:",
]


def hashes(html):
    out = []
    for attrs, body in SCRIPT.findall(html):
        if re.search(r'\bsrc=', attrs) or 'application/ld+json' in attrs:
            continue
        digest = hashlib.sha256(body.encode('utf-8')).digest()
        out.append("'sha256-%s'" % base64.b64encode(digest).decode('ascii'))
    return sorted(set(out))


def policy(script_hashes):
    joined = ''.join(' ' + h for h in script_hashes)
    return '; '.join(d.format(hashes=joined) for d in DIRECTIVES)


def main(verify):
    root = Path('dist')
    pages = sorted(root.rglob('*.html'))
    if not pages:
        raise SystemExit('csp: no HTML in dist/')
    union = set()
    drift = []
    for page in pages:
        html = page.read_text(encoding='utf-8')
        page_hashes = hashes(html)
        union.update(page_hashes)
        expected = policy(page_hashes)
        if verify:
            found = META.search(html)
            if not found:
                drift.append('%s: no CSP meta' % page)
            elif found.group(1) != expected:
                drift.append('%s: CSP meta no longer matches its inline scripts' % page)
            continue
        if META.search(html):
            html = META.sub(lambda _m: '', html)
        html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="%s">' % expected, 1)
        page.write_text(html, encoding='utf-8')

    headers = root / '_headers'
    if verify:
        if PLACEHOLDER in headers.read_text(encoding='utf-8'):
            drift.append('_headers still carries the hash placeholder')
        if drift:
            print('\n'.join('FAIL: ' + d for d in drift), file=sys.stderr)
            sys.exit(1)
        print('CSP: %d page(s) verified, %d script hash(es)' % (len(pages), len(union)))
        return
    text = headers.read_text(encoding='utf-8')
    if PLACEHOLDER not in text:
        raise SystemExit('csp: public/_headers has no %s placeholder' % PLACEHOLDER)
    headers.write_text(text.replace(PLACEHOLDER, ''.join(' ' + h for h in sorted(union))), encoding='utf-8')
    print('CSP: %d page(s) stamped, %d distinct script hash(es)' % (len(pages), len(union)))


if __name__ == '__main__':
    main('--verify' in sys.argv)
