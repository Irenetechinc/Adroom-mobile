# APMA Dashboard — Build Guide

## Requirements
- Node.js 18+
- npm 9+

## First-Time Setup (run once)
```bash
cd apma-desktop
npm run setup
```
This installs all devDependencies locally and generates the icon files (`.ico`, `.icns`).

## Development
```bash
npm run dev
```

## Building

### Windows (.exe installer + portable)
```bash
npm run dist:win
```
> **Building Windows EXE on Linux/macOS:** Requires `wine` and `nsis` installed.
> On Ubuntu: `sudo apt-get install wine nsis`
> 
> **Without wine (cross-platform alternative):**
> ```bash
> npm run dist:win:zip
> ```
> This produces a `.zip` that works on Windows — no installer, just extract and run.

### macOS (.dmg)
```bash
npm run dist:mac
```
> Must be run on macOS to code-sign properly.

### Linux (AppImage + .deb)
```bash
npm run dist:linux
```
> Can be cross-compiled from any platform.

## Output
All built files land in `release/`:
- Windows: `release/APMA Dashboard Setup 1.0.0.exe` + `release/APMA Dashboard-1.0.0-portable.exe`
- macOS: `release/APMA Dashboard-1.0.0.dmg`
- Linux: `release/APMA Dashboard-1.0.0.AppImage` + `release/apma-desktop_1.0.0_amd64.deb`

## How the Electron Build Works

The `build` script runs two steps in sequence:

1. **Vite** (`npx vite build`) — bundles the React renderer into `dist/`
2. **esbuild** (`node scripts/build-electron.js`) — bundles the Electron main
   process (`electron/main.ts`) and preload (`electron/preload.ts`) into
   `dist-electron/` via `npx esbuild`.

esbuild **inlines all runtime dependencies** (including `electron-store`) directly
into `dist-electron/main.js`. This means the packaged `.asar` does **not** need
a `node_modules` folder alongside it — which is why `electron-builder` safely
excludes `node_modules` from the package with `"!node_modules/**/*"`.

> **Why esbuild instead of tsc?**
> `tsc` only type-checks and transpiles — it does not bundle. The compiled
> `main.js` would still contain `require('electron-store')`, but `node_modules`
> is excluded from the packaged app, causing the
> `Cannot find module 'electron-store'` crash. esbuild bundles all deps inline,
> solving the problem entirely.

## Troubleshooting

### "Cannot find module 'electron-store'" (or any runtime module)
This means the app was built with the old `tsc`-only pipeline. Rebuild with:
```bash
npm run build
npm run dist:win   # or dist:mac / dist:linux
```
The `build` script now uses esbuild to bundle all runtime deps into
`dist-electron/main.js`.

### "Cannot find module 'vite'" or blank binary errors
Run `npm run setup` — this installs devDependencies with the correct local prefix.

### Icons missing
Run `node scripts/generate-icons.js` — this generates `assets/icon.ico` and
`assets/icon.icns` from `assets/icon.png`.

### Windows build fails without wine
Use `npm run dist:win:zip` for a portable zip that doesn't require wine/NSIS.
