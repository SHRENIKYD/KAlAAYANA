#!/usr/bin/env bash
# Stamp the build with its version, so what is deployed is always identifiable.
#   usage: scripts/stamp.sh <environment> <commit-sha> <ref-name>
set -euo pipefail

environment="${1:?environment required}"
commit="${2:?commit sha required}"
ref="${3:-unknown}"

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
