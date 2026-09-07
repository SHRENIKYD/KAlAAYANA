#!/usr/bin/env bash
# Stamp the build with its version, so what is deployed is always identifiable.
#   usage: scripts/stamp.sh <environment> <commit-sha> <ref-name>
set -euo pipefail

environment="${1:?environment required}"
# Commit and ref are optional: CI passes them explicitly, while a Cloudflare
# build calls this with just the environment and we resolve them from the
# checkout itself.
commit="${2:-}"
ref="${3:-}"
[[ -n "$commit" ]] || commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
[[ -n "$ref" ]] || ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

# Staging is where the site is built and reviewed, so it serves the site under
# development at its root. Production keeps the holding page at the root until
# a release deliberately swaps them. Guarded on the environment name: only
# "staging" swaps, so production and rollback builds are untouched.
if [[ "$environment" == "staging" && -f preview.html && -f index.html ]]; then
  mv index.html coming-soon.html
  mv preview.html index.html
  echo "staging: serving the site under development at / (holding page at /coming-soon.html)"
fi

version="$(tr -d '[:space:]' < VERSION)"
short="${commit:0:8}"
built="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

[[ -n "$version" ]] || { echo "VERSION is empty"; exit 1; }

# 1. Asset URLs carry the commit, so a deploy can never be hidden by a cache.
for f in *.html; do
  [[ -e "$f" ]] || continue
  sed -i "s/?v=dev/?v=$short/g" "$f"
done

# 2. Every page states its version.
for f in *.html; do
  [[ -e "$f" ]] || continue
  sed -i "s#<head>#<head>\n<meta name=\"version\" content=\"$version+$short\">#" "$f"
done

# 3. A machine-readable record at a stable URL.
cat > version.json <<JSON
{
  "version": "$version",
  "commit": "$commit",
  "commitShort": "$short",
  "ref": "$ref",
  "environment": "$environment",
  "built": "$built"
}
JSON

echo "Stamped $environment: v$version ($short) from $ref"
grep -h '?v=' ./*.html || echo "(no versioned asset URLs)"
cat version.json
