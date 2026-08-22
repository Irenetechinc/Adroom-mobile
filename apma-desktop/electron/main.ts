import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell } from 'electron';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store');
const store = new ElectronStore();
const isDev = !app.isPackaged;

let mainWin: BrowserWindow | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'APMA Dashboard',
    backgroundColor: '#0f172a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
  });

  mainWin = win;

  if (isDev) {
    win.loadURL('http://localhost:3456');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { mainWin = null; });
}

// ─── Auto-update check ────────────────────────────────────────────────────────
async function checkForUpdates(win: BrowserWindow): Promise<void> {
  try {
    const baseUrl = store.get('apma_base_url') as string | undefined;
    if (!baseUrl) return;

    const current = app.getVersion();
    const url = `${baseUrl}/api/app/version?platform=desktop&current=${encodeURIComponent(current)}`;

    // Use Electron's net.fetch — works in the main process without DOM types
    const res = await net.fetch(url);
    if (!res.ok) return;

    const data = await res.json() as {
      updateAvailable: boolean;
      forceUpdate: boolean;
      latestVersion: string | null;
      storeUrl: string | null;
      changelog: Array<{ version: string; notes: string }>;
    };

    if (!data.updateAvailable || !data.latestVersion) return;

    const notes = (data.changelog && data.changelog[0] && data.changelog[0].notes)
      ? data.changelog[0].notes.slice(0, 400)
      : '';
    const detail = `You are running v${current}.${notes ? `\n\nWhat's new in v${data.latestVersion}:\n${notes}` : ''}`;

    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `APMA Dashboard v${data.latestVersion} is available`,
      detail,
      buttons: data.forceUpdate
        ? ['Download Now']
        : ['Download Now', 'Remind Me Later'],
      defaultId: 0,
      cancelId: data.forceUpdate ? 0 : 1,
    });

    if (response === 0 && data.storeUrl) {
      shell.openExternal(data.storeUrl);
    }

    // Force update: close the app if user dismisses — they must update first
    if (data.forceUpdate && response !== 0) {
      app.quit();
    }
  } catch (_e) {
    // Silent fail — never block the app on a network or parse error
  }
}

app.whenReady().then(() => {
  // Remove the default "File Edit View Window Help" menu bar entirely
  Menu.setApplicationMenu(null);

  createWindow();

  // Check for updates 5 s after launch so the window finishes loading first
  setTimeout(() => { if (mainWin) checkForUpdates(mainWin); }, 5000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('store-get',         (_e, key: string)                => store.get(key));
ipcMain.handle('store-set',         (_e, key: string, value: unknown) => { store.set(key, value); });
ipcMain.handle('store-delete',      (_e, key: string)                => { store.delete(key); });
ipcMain.handle('check-for-updates', ()                               => { if (mainWin) checkForUpdates(mainWin); });
ipcMain.handle('get-version',       ()                               => app.getVersion());
