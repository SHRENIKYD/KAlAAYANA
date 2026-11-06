"""Generate dist/sitemap.xml from the build: every indexable route, nothing else."""
from pathlib import Path
import sys

ORIGIN = 'https://kalaayanastudios.com'


def routes(root, live):
    found = []
    for page in sorted(root.rglob('index.html')):
        body = page.read_text(encoding='utf-8')
        if 'content="noindex' in body:
            continue
        parts = page.relative_to(root).parts[:-1]
        route = '/' + '/'.join(parts) + ('/' if parts else '')
        if live and route == '/preview/':
            route = '/'
        found.append(route)
    return sorted(set(found), key=lambda r: (r != '/', r))


def main():
    root = Path('dist')
    live = Path('LIVE').exists()
    urls = routes(root, live)
    if not urls:
        raise SystemExit('sitemap: no indexable routes found')
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for route in urls:
        xml.append('  <url><loc>%s%s</loc></url>' % (ORIGIN, route))
    xml.append('</urlset>')
    (root / 'sitemap.xml').write_text('\n'.join(xml) + '\n', encoding='utf-8')
    print('Sitemap: %d route(s)%s' % (len(urls), ' (live)' if live else ' (holding page only)'))


if __name__ == '__main__':
    try:
        main()
    except OSError as e:
        print('[Kalaayana] sitemap_build_failed: %s' % e, file=sys.stderr)
        sys.exit(1)
