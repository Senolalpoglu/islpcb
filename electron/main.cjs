const { app, BrowserWindow, Menu, ipcMain, dialog, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { findCli, compileSketch } = require('./arduino.cjs');
const claude = require('./claude.cjs');
const bridge = require('./bridge.cjs');
const { createCloseGuard } = require('./close-guard.cjs');

// The program used to be called "SNL PCB": keep its data folder (language, theme, user library, Claude key).
app.setPath('userData', path.join(app.getPath('appData'), 'SNL PCB'));

// A bundled arduino-cli (resources/tools) wins over one found on the machine.
const cli = () => findCli([path.join(process.resourcesPath || '', 'tools'), path.join(app.getPath('userData'), 'tools')]);

// COM ports for the serial monitor: the page uses the Web Serial API. When it asks for a port, Chromium offers the list
// here; it is passed to the page, which shows it and answers with the chosen id (or "" for none).
let pendingPort = null;
function setupSerial() {
  const ses = session.defaultSession;
  ses.setDevicePermissionHandler((details) => details.deviceType === 'serial');
  ses.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    if (pendingPort) pendingPort('');
    pendingPort = callback;
    webContents.send(
      'serial:ports',
      portList.map((p) => ({ id: p.portId, name: p.portName, display: p.displayName || p.portName, vid: p.vendorId, pid: p.productId })),
    );
  });
  ipcMain.on('serial:choose', (_event, id) => {
    const cb = pendingPort;
    pendingPort = null;
    if (cb) cb(typeof id === 'string' ? id : '');
  });
}

// Printing the schematic sheet: the renderer has put the page on the body (see src/editor/PrintSheet.tsx) and its print
// style sheet hides the application, so printing the window prints exactly the sheet.
ipcMain.handle('print:run', async (event, opts) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'no window' };
  const page = { width: Math.round(opts.widthMm * 1000), height: Math.round(opts.heightMm * 1000) };
  if (opts.mode === 'pdf') {
    try {
      const data = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
      const { canceled, filePath } = await dialog.showSaveDialog(win, { defaultPath: 'circuit.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      if (canceled || !filePath) return { ok: true };
      fs.writeFileSync(filePath, data);
      return { ok: true, path: filePath };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }
  return new Promise((resolve) => {
    // pageSize in microns, the paper the sheet was laid out for (a landscape sheet is already wider than high).
    win.webContents.print({ silent: false, printBackground: true, landscape: false, pageSize: page, margins: { marginType: 'none' } }, (success, reason) => {
      resolve(success || reason === 'cancelled' ? { ok: true } : { ok: false, error: reason });
    });
  });
});

ipcMain.handle('arduino:available', () => cli() !== null);
ipcMain.handle('arduino:compile', async (_event, source, fqbn) => {
  const exe = cli();
  if (!exe) return { ok: false, hex: '', log: 'arduino-cli not found' };
  return compileSketch(exe, source, fqbn);
});

claude.register();
bridge.register();
// Closing the window with unsaved changes asks whether to save first.
const closeGuard = createCloseGuard({ ipcMain, dialog, fs });

/** How long the opening window stays up, at least. */
const SPLASH_MS = 5000;

/**
 * The small window in the middle of the screen that opens while the program loads: the name, the icon and a few
 * drawn circuits (electron/splash.html). Returns null when it is switched off (--no-splash or ISL_NO_SPLASH=1).
 */
function createSplash() {
  if (process.env.ISL_NO_SPLASH === '1' || process.argv.includes('--no-splash')) return null;
  const win = new BrowserWindow({
    width: 560,
    height: 340,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    center: true,
    show: false,
    title: 'ISL PCB',
    icon: path.join(__dirname, '..', 'installer', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const splash = { win, shownAt: 0 };
  win.once('ready-to-show', () => {
    splash.shownAt = Date.now();
    win.show();
  });
  win.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } }).catch(() => {
    // Without its page the splash is only an empty window: do not keep it.
    if (!win.isDestroyed()) win.close();
  });
  return splash;
}

function createWindow(splash = null) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#1b1e24',
    title: 'ISL PCB',
    icon: path.join(__dirname, '..', 'installer', 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  Menu.setApplicationMenu(null);
  closeGuard.attach(win);
  // Open filling the screen; the window is shown only once it is maximised so it does not flash at the small size.
  // With an opening window, it is shown once that has been up for SPLASH_MS (at once, if it was never shown).
  win.once('ready-to-show', () => {
    const wait = splash ? Math.max(0, SPLASH_MS - (Date.now() - (splash.shownAt || Date.now()))) : 0;
    setTimeout(() => {
      if (win.isDestroyed()) return;
      if (splash && !splash.win.isDestroyed()) splash.win.close();
      win.maximize();
      win.show();
    }, wait);
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  setupSerial();
  createWindow(createSplash());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
