# Clean URLs

Astro builds directory routes with trailing slashes. All navigation, stylesheet
route selectors and canonical metadata now use paths such as /temples/ and
/portraits/saint-kanakadasa/. Local portfolio preview is /preview/.
Staging stamping serves the portfolio at / and preserves /preview/ for legacy
redirect targets. Production retains its holding page until approved launch.

The build generates old .html aliases plus Cloudflare _redirects rules (301).
GitHub Pages uses the HTML refresh/link fallback because it cannot honour a
Cloudflare redirects file. Existing query strings and fragments are retained by
the JavaScript fallback. Confirm edge redirect behaviour after deployment.
No indexability, production freeze or publication setting is changed here.
