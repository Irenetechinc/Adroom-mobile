const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const assetsDir = path.join(__dirname, '..', 'assets');
const srcPng = path.join(assetsDir, 'icon.png');

if (!fs.existsSync(srcPng)) {
  console.error('ERROR: assets/icon.png not found. Please add a PNG icon first.');
  process.exit(1);
}

async function generateIco() {
  const icoPath = path.join(assetsDir, 'icon.ico');
  try {
    // Resolve png-to-ico from the apma-desktop node_modules
    const pngToIcoPath = path.join(__dirname, '..', 'node_modules', 'png-to-ico');
    const pngToIco = require(pngToIcoPath);
    const icoBuffer = await pngToIco(srcPng);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('✓ Generated assets/icon.ico');
  } catch (e) {
    console.warn('⚠  png-to-ico failed:', e.message, '— copying PNG as .ico fallback');
    fs.copyFileSync(srcPng, icoPath);
    console.log('✓ assets/icon.ico created (PNG copy — electron-builder accepts this)');
  }
}

function generateIcns() {
  const icnsPath = path.join(assetsDir, 'icon.icns');
  if (fs.existsSync(icnsPath) && fs.statSync(icnsPath).size > 0) {
    console.log('✓ assets/icon.icns already exists — skipping');
    return;
  }
  // Try platform tools first
  const attempts = [
    () => { execSync(`png2icns "${icnsPath}" "${srcPng}"`, { stdio: 'pipe' }); return 'png2icns'; },
    () => { execSync(`iconutil -c icns "${srcPng}" -o "${icnsPath}"`, { stdio: 'pipe' }); return 'iconutil'; },
  ];
  for (const attempt of attempts) {
    try { console.log(`✓ Generated assets/icon.icns via ${attempt()}`); return; } catch {}
  }
  // Fallback: electron-builder on macOS will auto-convert a PNG named icon.icns
  fs.copyFileSync(srcPng, icnsPath);
  console.log('✓ assets/icon.icns placeholder created (PNG copy — macOS builder converts automatically)');
}

(async () => {
  console.log('Generating APMA Dashboard icons from assets/icon.png...');
  await generateIco();
  generateIcns();
  console.log('Icon generation complete. ✓');
})();
