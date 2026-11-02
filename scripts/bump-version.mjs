import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function nextVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(\d{1,2})$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  let [, major, minor, patch] = match;
  let nextPatch = Number(patch) + 1;
  if (nextPatch > 99) {
    minor = String(BigInt(minor) + 1n);
    nextPatch = 0;
  }
  return `${major}.${minor}.${String(nextPatch).padStart(2, '0')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = readFileSync('VERSION', 'utf8').trim();
  const next = nextVersion(current);
  if (process.argv.includes('--dry-run')) console.log(`${current} -> ${next}`);
  else {
    writeFileSync('VERSION', `${next}\n`);
    console.log(
      `VERSION updated: ${current} -> ${next}. Add matching changelog notes before release.`,
    );
  }
}
