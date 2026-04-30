/**
 * Patches metro packages to be compatible with @expo/metro-config@0.20.x.
 *
 * Two fixes are applied:
 *
 * Fix 1 — Package exports (applied to all metro-* packages):
 *   @expo/metro-config@0.20.x imports internal metro paths via both
 *   extension-less and .js-suffixed specifiers, e.g.:
 *     require("metro/src/DeltaBundler/Graph")                         ← no ext
 *     require("metro/src/DeltaBundler/Serializers/helpers/js.js")     ← .js ext
 *     require("metro-cache/src/stores/FileStore")
 *     require("metro-transform-worker/src/utils/getMinifier")
 *
 *   metro@0.83.x only exports: { ".": ..., "./package.json": ..., "./private/*": "./src/*.js" }
 *   Node's exports enforcement blocks all ./src/* imports.
 *
 *   Solution: prepend two ordered wildcards to each metro-* package's exports:
 *     "./src/*.js" -> "./src/*.js"   (catches specifiers already ending in .js)
 *     "./src/*"    -> "./src/*.js"   (catches extension-less specifiers)
 *   Order matters — .js entry must come first to prevent double-.js extension.
 *
 * Fix 2 — sourceMapString default export:
 *   @expo/metro-config's serializeChunks.js does:
 *     const m = __importDefault(require("metro/src/DeltaBundler/Serializers/sourceMapString"))
 *     const fn = typeof m.default !== 'function' ? m.default.sourceMapString : m.default
 *   In metro@0.83.x, sourceMapString uses named exports (no .default).
 *   __importDefault preserves the module as-is when __esModule=true, leaving .default=undefined.
 *   Solution: append `exports.default = exports.sourceMapString;` to that file.
 *
 * Both fixes are idempotent — safe to run multiple times.
 * Runs via "postinstall" on every npm install / npm ci (including EAS).
 */

const fs = require('fs');
const path = require('path');

const nmDir = path.join(__dirname, '..', 'node_modules');

// ─── Fix 1: Package exports ──────────────────────────────────────────────────

let patchedCount = 0;

const entries = fs.readdirSync(nmDir).filter(d => d.startsWith('metro'));

for (const pkgName of entries) {
  const pkgPath = path.join(nmDir, pkgName, 'package.json');

  if (!fs.existsSync(pkgPath)) {
    continue;
  }

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  } catch (e) {
    continue;
  }

  if (!pkg.exports) {
    continue;
  }

  const alreadyPatched =
    pkg.exports['./src/*.js'] === './src/*.js' &&
    pkg.exports['./src/*'] === './src/*.js';

  if (alreadyPatched) {
    continue;
  }

  // Prepend src/* entries so they match before ./private/* wildcard.
  const newExports = {
    './src/*.js': './src/*.js',
    './src/*': './src/*.js',
    ...pkg.exports,
  };

  pkg.exports = newExports;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
  console.log('[patch-metro] exports: patched ' + pkgName + '@' + pkg.version);
  patchedCount++;
}

if (patchedCount === 0) {
  console.log('[patch-metro] exports: all metro packages already patched.');
} else {
  console.log('[patch-metro] exports: patched ' + patchedCount + ' package(s).');
}

// ─── Fix 2: sourceMapString default export ───────────────────────────────────

const SENTINEL = '/* patch-metro: default export added */';
const smPath = path.join(nmDir, 'metro', 'src', 'DeltaBundler', 'Serializers', 'sourceMapString.js');

if (fs.existsSync(smPath)) {
  const smContent = fs.readFileSync(smPath, 'utf-8');
  if (!smContent.includes(SENTINEL)) {
    const patch = '\n' + SENTINEL + '\nexports.default = exports.sourceMapString;\n';
    fs.writeFileSync(smPath, smContent + patch, 'utf-8');
    console.log('[patch-metro] sourceMapString: added exports.default = exports.sourceMapString');
  } else {
    console.log('[patch-metro] sourceMapString: already patched.');
  }
} else {
  console.log('[patch-metro] sourceMapString: file not found, skipping.');
}
