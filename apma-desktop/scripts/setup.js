/**
 * APMA Desktop — build setup script
 * Run this once before building: node scripts/setup.js
 * It ensures all devDependencies are installed correctly.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');

function run(cmd) {
  console.log('  >', cmd);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function check(bin) {
  return fs.existsSync(path.join(root, 'node_modules', '.bin', bin));
}

console.log('\nAPMA Desktop — Build Setup\n');

// Install devDependencies with --prefix to ensure local node_modules
if (!check('vite') || !check('tsc') || !check('electron-builder')) {
  console.log('Installing devDependencies...');
  run('npm install --include=dev --legacy-peer-deps --prefix .');
} else {
  console.log('✓ All devDependencies already installed');
}

// Generate icons
console.log('\nGenerating icons...');
run('node scripts/generate-icons.js');

console.log('\n✓ Setup complete! You can now run:\n  npm run dist:win   — Windows installer\n  npm run dist:mac   — macOS DMG\n  npm run dist:linux — Linux AppImage\n');
