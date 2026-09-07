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
# development at its root. Production keeps the holding page there until a
# release deliberately swaps them. Guarded on the environment name: only
# "staging" swaps, so production and rollback builds are untouched.
if [[ "$environment" == "staging" && -f "$out/preview.html" && -f "$out/index.html" ]]; then
  mv "$out/index.html" "$out/coming-soon.html"
  mv "$out/preview.html" "$out/index.html"
  echo "staging: serving the site under development at / (holding page at /coming-soon.html)"
fi

for f in "$out"/*.html; do
  [[ -e "$f" ]] || continue
  # 1. Asset URLs carry the commit, so a deploy cannot be hidden by a cache.
  sed -i "s/?v=dev/?v=$short/g" "$f"
  # 2. Every page states its version.
  sed -i "s#<head>#<head>\n<meta name=\"version\" content=\"$version+$short\">#" "$f"
done

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
