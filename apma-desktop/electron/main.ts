import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store');
const store = new ElectronStore();
const isDev = !app.isPackaged;

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
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: securely store/retrieve the API key
ipcMain.handle('store-get', (_e, key: string) => store.get(key));
ipcMain.handle('store-set', (_e, key: string, value: unknown) => { store.set(key, value); });
ipcMain.handle('store-delete', (_e, key: string) => { store.delete(key); });
