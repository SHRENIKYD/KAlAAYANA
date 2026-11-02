// Preserve installed packages' original notices without inventing licence grants.
import fs from 'node:fs';
import path from 'node:path';

const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const sections = [];
for (const location of Object.keys(lock.packages).sort()) {
  if (!location || !fs.existsSync(path.join(location, 'package.json'))) continue;
  const pkg = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
  const files = fs
    .readdirSync(location)
    .filter(
      (name) =>
        /^(licen[sc]e|copying|notice|copyright)([.\-_]|$)/i.test(name) &&
        fs.statSync(path.join(location, name)).isFile(),
    );
  sections.push(
    [
      `${pkg.name} ${pkg.version}`,
      `Declared licence: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'not declared')}`,
      `Installed path: ${location}`,
      ...files.map(
        (file) => `\n--- ${file} ---\n${fs.readFileSync(path.join(location, file), 'utf8')}`,
      ),
      ...(!files.length
        ? [
            'No top-level licence file was included in this installed package; consult its upstream distribution.',
          ]
        : []),
    ].join('\n'),
  );
}
fs.mkdirSync('public/licenses', { recursive: true });
fs.writeFileSync(
  'public/licenses/software-notices.txt',
  'Installed build-environment software notices. Includes development tooling; not a browser-bundle manifest.\n\n' +
    sections.join('\n\n' + '='.repeat(72) + '\n\n'),
);
console.log(`Preserved notices for ${sections.length} installed packages.`);
