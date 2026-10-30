// Registers the ISL PCB MCP server in Claude Desktop's configuration file (claude_desktop_config.json).
//
// The file is the user's: it may hold other servers and settings. It is parsed first and only the one entry is
// added or removed; if it cannot be parsed nothing is written. The first change keeps a copy next to it (.bak).

const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = 'claude_desktop_config.json';

/** Folders where Claude Desktop keeps its configuration, most likely first. */
function candidateDirs() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    const dirs = [];
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    // The Microsoft Store build keeps its "roaming" data inside its package folder.
    try {
      for (const d of fs.readdirSync(path.join(local, 'Packages'))) {
        if (/^(Claude|Anthropic)/i.test(d)) dirs.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude'));
      }
    } catch {
      /* no packages folder */
    }
    dirs.push(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Claude'));
    return dirs;
  }
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude')];
  return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude')];
}

/** The configuration file in use: an existing one, else the folder that exists, else the usual place. */
function configPath() {
  const dirs = candidateDirs();
  for (const d of dirs) if (fs.existsSync(path.join(d, FILE))) return path.join(d, FILE);
  for (const d of dirs) if (fs.existsSync(d)) return path.join(d, FILE);
  return path.join(dirs[dirs.length - 1], FILE);
}

/** Parses the file; a missing or empty file is an empty configuration. Throws if the JSON is damaged. */
function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  const json = JSON.parse(text);
  if (typeof json !== 'object' || json === null || Array.isArray(json)) throw new Error('The configuration is not a JSON object.');
  return json;
}

function write(file, cfg) {
  if (fs.existsSync(file) && !fs.existsSync(`${file}.bak`)) fs.copyFileSync(file, `${file}.bak`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

/** Adds or replaces the server `name`. */
function installServer(file, name, entry) {
  const cfg = readConfig(file);
  cfg.mcpServers = { ...(typeof cfg.mcpServers === 'object' && cfg.mcpServers !== null ? cfg.mcpServers : {}), [name]: entry };
  write(file, cfg);
}

/** Removes the server `name`; other entries stay. */
function removeServer(file, name) {
  if (!fs.existsSync(file)) return;
  const cfg = readConfig(file);
  if (!cfg.mcpServers || !(name in cfg.mcpServers)) return;
  delete cfg.mcpServers[name];
  write(file, cfg);
}

function hasServer(file, name) {
  try {
    const cfg = readConfig(file);
    return Boolean(cfg.mcpServers && cfg.mcpServers[name]);
  } catch {
    return false;
  }
}

module.exports = { configPath, readConfig, installServer, removeServer, hasServer };
