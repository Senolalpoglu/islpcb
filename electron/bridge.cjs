// Lets Claude Desktop drive the open project through an MCP server, with no API key.
//
// Claude Desktop starts mcp/isl-pcb-mcp.cjs; that process talks to the small HTTP bridge opened here (bridge-server.cjs),
// and the bridge hands each tool call to the page, which runs it on the project (the same tools the built-in assistant
// uses). The bridge is off until the user switches it on in the assistant panel; switching it on also registers the MCP
// server in Claude Desktop's configuration file.

const { app, BrowserWindow, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createBridge } = require('./bridge-server.cjs');
const config = require('./claude-config.cjs');

const SERVER_NAME = 'isl-pcb';
const PREFERRED_PORT = 47821;
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** A tool the main process answers itself: it needs the window, not the project. */
const CAPTURE_TOOL = {
  name: 'capture_view',
  description: 'Take a screenshot of the program window (the schematic or the PCB, whichever is showing; switch with show_view first). Use it to check the result against the picture or drawing the user gave you.',
  input_schema: { type: 'object', properties: {} },
};

const userData = () => app.getPath('userData');
const infoFile = () => path.join(userData(), 'bridge.json');
const enabledFile = () => path.join(userData(), 'bridge-enabled');
const cacheFile = () => path.join(userData(), 'bridge-tools.json');

let server = null;
let port = 0;
let token = '';
let ready = false;
let hello = { tools: [], instructions: '' };
let seq = 0;
const pending = new Map();

/** The tools the page offered last time, so the MCP server can list them while the program is still starting. */
function loadCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (Array.isArray(cached.tools)) hello = { tools: cached.tools.filter((t) => t.name !== CAPTURE_TOOL.name), instructions: String(cached.instructions || '') };
  } catch {
    /* nothing cached yet */
  }
}

const info = () => ({ ready, tools: [...hello.tools, CAPTURE_TOOL], instructions: hello.instructions });
const mainWindow = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());

async function capture() {
  const win = mainWindow();
  if (!win) throw new Error('The program window is not open.');
  if (win.isMinimized()) win.restore();
  const img = await win.webContents.capturePage();
  if (img.isEmpty()) throw new Error('The window could not be captured (is it hidden?).');
  const out = img.getSize().width > 1600 ? img.resize({ width: 1600, quality: 'good' }) : img;
  const { width, height } = out.getSize();
  return { text: `Screenshot of the program window, ${width}x${height}.`, image: { data: out.toPNG().toString('base64'), mimeType: 'image/png' } };
}

function forward(tool, input) {
  if (tool === CAPTURE_TOOL.name) return capture();
  const win = mainWindow();
  if (!win || !ready) return Promise.reject(new Error('The program has no project window ready yet. Wait a moment and try again.'));
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('The program did not answer in time.'));
    }, CALL_TIMEOUT_MS);
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    win.webContents.send('bridge:request', { id, tool, input });
  });
}

function start() {
  if (server) return Promise.resolve();
  token = crypto.randomBytes(24).toString('hex');
  const s = createBridge({ token, info, forward });
  return new Promise((resolve, reject) => {
    const listen = (p) => {
      s.removeAllListeners('error');
      s.once('error', (e) => {
        if (p !== 0 && e.code === 'EADDRINUSE') listen(0);
        else reject(e);
      });
      s.listen(p, '127.0.0.1', () => {
        server = s;
        port = s.address().port;
        fs.mkdirSync(userData(), { recursive: true });
        fs.writeFileSync(infoFile(), JSON.stringify({ port, token, pid: process.pid }));
        resolve();
      });
    };
    listen(PREFERRED_PORT);
  });
}

function stop() {
  if (server) server.close();
  server = null;
  port = 0;
  fs.rmSync(infoFile(), { force: true });
  for (const p of pending.values()) p.reject(new Error('The bridge was switched off.'));
  pending.clear();
}

/** How Claude Desktop starts the MCP server: this program's own runtime, acting as plain Node. */
const serverEntry = () => ({
  command: process.execPath,
  args: [path.join(__dirname, '..', 'mcp', 'isl-pcb-mcp.cjs')],
  env: { ELECTRON_RUN_AS_NODE: '1', ISL_PCB_DATA: userData() },
});

function status() {
  const file = config.configPath();
  return { enabled: fs.existsSync(enabledFile()), running: server !== null, port, configFile: file, installed: config.hasServer(file, SERVER_NAME), appReady: ready };
}

function register() {
  loadCache();
  ipcMain.handle('bridge:status', () => status());

  ipcMain.handle('bridge:enable', async () => {
    try {
      await start();
      fs.writeFileSync(enabledFile(), '1');
      config.installServer(config.configPath(), SERVER_NAME, serverEntry());
      return { ok: true, ...status() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...status() };
    }
  });

  ipcMain.handle('bridge:disable', () => {
    stop();
    fs.rmSync(enabledFile(), { force: true });
    try {
      config.removeServer(config.configPath(), SERVER_NAME);
    } catch {
      /* a configuration that cannot be read is left alone */
    }
    return { ok: true, ...status() };
  });

  // The page announces itself with the tools and instructions it offers, and answers the calls it is sent.
  ipcMain.on('bridge:hello', (_event, h) => {
    hello = { tools: Array.isArray(h?.tools) ? h.tools : [], instructions: String(h?.instructions ?? '') };
    ready = true;
    try {
      fs.mkdirSync(userData(), { recursive: true });
      fs.writeFileSync(cacheFile(), JSON.stringify(info()));
    } catch {
      /* the cache only lets the MCP server list tools while the program is closed */
    }
  });
  ipcMain.on('bridge:reply', (_event, r) => {
    const p = pending.get(r?.id);
    if (!p) return;
    pending.delete(r.id);
    p.resolve({ text: String(r.text ?? '') });
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-start-loading', () => {
      ready = false;
      for (const p of pending.values()) p.reject(new Error('The page was reloaded.'));
      pending.clear();
    });
  });
  app.whenReady().then(() => {
    if (fs.existsSync(enabledFile())) start().catch(() => {});
  });
  app.on('will-quit', stop);
}

module.exports = { register };
