/**
 * APMA Desktop — Electron main-process bundler
 *
 * Bundles electron/main.ts and electron/preload.ts into dist-electron/ using
 * esbuild (invoked via npx so it works even when esbuild is not pre-installed).
 *
 * All runtime dependencies (e.g. electron-store) are inlined into the output
 * bundle so the packaged .asar never needs a separate node_modules folder.
 *
 * Run: node scripts/build-electron.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'dist-electron');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function esbuild(entry, outfile, extra) {
  const rel = path.relative(root, path.join(root, entry));
  const out = path.relative(root, path.join(root, outfile));
  const flags = [
    `${rel}`,
    '--bundle',
    '--platform=node',
    '--target=node18',
    '--external:electron',
    '--format=cjs',
    '--log-level=info',
    `--outfile=${out}`,
    ...(extra || []),
  ].join(' ');

  console.log(`\n  > esbuild ${flags}`);
  execSync(`npx --yes esbuild@0.25.5 ${flags}`, {
    cwd: root,
    stdio: 'inherit',
  });
}

console.log('\nBuilding Electron main process…');
esbuild('electron/main.ts', 'dist-electron/main.js');
console.log('  ✓  dist-electron/main.js');

console.log('\nBuilding Electron preload…');
esbuild('electron/preload.ts', 'dist-electron/preload.js');
console.log('  ✓  dist-electron/preload.js');

console.log('\n✓ Electron build complete.\n');
