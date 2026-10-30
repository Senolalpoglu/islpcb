// Builds the portable app folder release/ISL_PCB (the input of installer/isl_pcb.iss).
//
// electron-builder needs symlink privileges on Windows to unpack its signing tools, which a normal
// user account does not have. This script does the small part of its job that we need instead:
// copy the Electron runtime, drop the app next to it, rename the exe and embed the icon.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const out = path.join(root, 'release', 'ISL_PCB');
const exeName = 'ISL PCB.exe';
const keepLocales = new Set(['en-US.pak', 'tr.pak']);

function must(p, hint) {
  if (!fs.existsSync(p)) throw new Error(`${p} not found. ${hint}`);
}

must(path.join(root, 'dist', 'index.html'), 'Run "npm run build" first.');
must(electronDist, 'Run "npm install" first.');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.cpSync(electronDist, out, { recursive: true });

fs.renameSync(path.join(out, 'electron.exe'), path.join(out, exeName));
fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });

const localeDir = path.join(out, 'locales');
for (const f of fs.readdirSync(localeDir)) if (!keepLocales.has(f)) fs.rmSync(path.join(localeDir, f));

const app = path.join(out, 'resources', 'app');
fs.mkdirSync(path.join(app, 'installer'), { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(app, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'electron'), path.join(app, 'electron'), { recursive: true });
// The MCP server Claude Desktop starts (see electron/bridge.cjs); it must sit next to the program.
fs.cpSync(path.join(root, 'mcp'), path.join(app, 'mcp'), { recursive: true });
fs.copyFileSync(path.join(root, 'installer', 'icon.ico'), path.join(app, 'installer', 'icon.ico'));
// Runtime dependencies of the main process: the Anthropic SDK and everything it needs.
const copied = new Set();
function copyModule(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const from = path.join(root, 'node_modules', name);
  if (!fs.existsSync(from)) return;
  fs.cpSync(from, path.join(app, 'node_modules', name), { recursive: true });
  const deps = JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8')).dependencies ?? {};
  for (const dep of Object.keys(deps)) copyModule(dep);
}
copyModule('@anthropic-ai/sdk');

fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, main: pkg.main }, null, 2),
);

const rcedit = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
must(rcedit, 'Run "npm install" first.');
execFileSync(rcedit, [
  path.join(out, exeName),
  '--set-icon', path.join(root, 'installer', 'icon.ico'),
  '--set-version-string', 'ProductName', pkg.productName,
  '--set-version-string', 'FileDescription', pkg.productName,
  '--set-version-string', 'CompanyName', 'ISL',
  '--set-version-string', 'OriginalFilename', exeName,
  '--set-file-version', pkg.version,
  '--set-product-version', pkg.version,
]);

console.log(`Packaged ${exeName} ${pkg.version} -> ${out}`);
