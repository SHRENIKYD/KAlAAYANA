"""Generate legacy HTML aliases and Cloudflare permanent redirects."""
from pathlib import Path
import json
import sys

def main():
    root = Path('dist')
    redirects = []
    for page in list(root.rglob('index.html')):
        relative = page.relative_to(root)
        if len(relative.parts) == 1:
            continue
        route = '/' + relative.parent.as_posix() + '/'
        alias = root / (relative.parent.as_posix() + '.html')
        target = json.dumps(route)
        alias.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="robots" content="noindex,follow">'
            '<link rel="canonical" href="https://kalaayanastudios.com' + route + '">'
            '<meta http-equiv="refresh" content="0;url=' + route + '">'
            '<title>Page moved</title></head><body><a href="' + route + '">Continue</a>'
            '<script>location.replace(' + target + '+location.search+location.hash)</script>'
            '</body></html>', encoding='utf-8')
        redirects.append('/' + alias.relative_to(root).as_posix() + ' ' + route + ' 301')
    (root / '_redirects').write_text('\n'.join(redirects) + '\n', encoding='utf-8')
    print('Created', len(redirects), 'legacy URL redirects')

if __name__ == '__main__':
    try:
        main()
    except OSError:
        print('[Kalaayana] legacy_redirect_build_failed: check dist permissions and rerun the build.', file=sys.stderr)
        sys.exit(1)
