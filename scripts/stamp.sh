#!/usr/bin/env bash
# Stamp a built site with its version, so what is deployed is always
# identifiable. Operates on the build output, never on sources.
#   usage: scripts/stamp.sh <environment> [commit-sha] [ref]
set -euo pipefail

environment="${1:?environment required}"
# Commit and ref are optional: CI passes them explicitly, while a Cloudflare
# build calls this with just the environment and we resolve them from the
# checkout itself.
commit="${2:-}"
ref="${3:-}"
[[ -n "$commit" ]] || commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
[[ -n "$ref" ]] || ref="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

out="${OUT_DIR:-dist}"
[[ -d "$out" ]] || { echo "$out/ not found — run the build first"; exit 1; }

version="$(tr -d '[:space:]' < VERSION)"
short="${commit:0:8}"
built="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
[[ -n "$version" ]] || { echo "VERSION is empty"; exit 1; }

# Staging is where the site is built and reviewed, so it serves the site under
# development at its root. Production keeps the holding page there until the
# LIVE marker exists at the repo root: from then on every environment serves
# the full site at its root, and the holding page moves to /coming-soon/.
if [[ ( "$environment" == "staging" || -f LIVE ) && -f "$out/preview/index.html" && -f "$out/index.html" ]]; then
  mkdir -p "$out/coming-soon"
  mv "$out/index.html" "$out/coming-soon/index.html"
  cp "$out/preview/index.html" "$out/index.html"
  sed -i 's#<head>#<head><meta name="robots" content="noindex,nofollow">#' "$out/coming-soon/index.html"
  # Local development uses /preview/; staging serves that same page at /.
  # Keep section and policy return links on the current staging deployment.
  while IFS= read -r -d '' page; do
    sed -i 's#href="/preview/#href="/#g' "$page"
  done < <(find "$out" -type f -name '*.html' -print0)
  echo "$environment: serving the full site at / (holding page at /coming-soon/)"
fi

# The content admin exists only on staging, where Cloudflare Access fronts it
# and the Worker answers its API. Every other environment ships without it.
if [[ "$environment" != "staging" && -d "$out/admin" ]]; then
  rm -r "$out/admin" "$out/admin.html"
  [[ -f "$out/_redirects" ]] && sed -i '\#^/admin.html #d' "$out/_redirects"
  echo "$environment: content admin removed from the build"
fi

while IFS= read -r -d '' f; do
  [[ -e "$f" ]] || continue
  # 1. Asset URLs carry the commit, so a deploy cannot be hidden by a cache.
  sed -i "s/?v=dev/?v=$short/g" "$f"
  # 2. Every page states its version.
  sed -i "s#<head>#<head>\n<meta name=\"version\" content=\"$version+$short\">#" "$f"
done < <(find "$out" -type f -name '*.html' -print0)

# 3. A machine-readable record at a stable URL.
cat > "$out/version.json" <<JSON
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
grep -h '?v=' "$out"/*.html || echo "(no versioned asset URLs)"
cat "$out/version.json"
