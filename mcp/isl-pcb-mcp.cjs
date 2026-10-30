#!/usr/bin/env node
// MCP server (stdio) that lets Claude Desktop build schematics and PCBs in the running ISL PCB program.
//
// Claude Desktop starts this process. It does no electronics itself: every tool call is passed to the program over
// a local HTTP bridge (electron/bridge.cjs) and runs on the project that is open there. Only Node's own modules are
// used, so nothing has to be installed. stdout carries protocol messages only; diagnostics go to stderr.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const readline = require('readline');

const PROTOCOL = '2024-11-05';
const CALL_TIMEOUT_MS = 10 * 60 * 1000;

/** Where the program keeps bridge.json (port and secret) and bridge-tools.json. */
function dataDir() {
  if (process.env.ISL_PCB_DATA) return process.env.ISL_PCB_DATA;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'SNL PCB');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'SNL PCB');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'SNL PCB');
}

const NOT_RUNNING = 'ISL PCB is not running, or Claude Desktop access is switched off. Start ISL PCB, open the assistant panel and press "Connect Claude Desktop".';

function bridgeInfo() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dataDir(), 'bridge.json'), 'utf8');
  } catch {
    throw new Error(NOT_RUNNING);
  }
  const { port, token } = JSON.parse(raw);
  return { port, token };
}

/** One HTTP request to the program. Resolves to the parsed JSON body. */
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = bridgeInfo();
    } catch (e) {
      reject(e);
      return;
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port: target.port,
        path: urlPath,
        method,
        headers: { authorization: `Bearer ${target.token}`, ...(payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {}) },
        timeout: CALL_TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            reject(new Error(`Unexpected answer from the program (HTTP ${res.statusCode}).`));
            return;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
          else reject(new Error(json.error || `HTTP ${res.statusCode}`));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('The program did not answer in time.')));
    req.on('error', (e) => reject(e.code === 'ECONNREFUSED' ? new Error(NOT_RUNNING) : e));
    if (payload) req.write(payload);
    req.end();
  });
}

/** The tools and instructions: live from the program, else what it offered last time. */
async function offer() {
  try {
    return await request('GET', '/info');
  } catch {
    try {
      return JSON.parse(fs.readFileSync(path.join(dataDir(), 'bridge-tools.json'), 'utf8'));
    } catch {
      return { tools: [], instructions: '' };
    }
  }
}

const HELP_TOOL = {
  name: 'connection_help',
  description: 'ISL PCB is not reachable. Call this to see how to connect it.',
  inputSchema: { type: 'object', properties: {} },
};

async function listTools() {
  const { tools } = await offer();
  if (!Array.isArray(tools) || tools.length === 0) return [HELP_TOOL];
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema || { type: 'object', properties: {} } }));
}

async function callTool(name, args) {
  if (name === HELP_TOOL.name) return { content: [{ type: 'text', text: NOT_RUNNING }], isError: true };
  try {
    const out = await request('POST', '/call', { tool: name, input: args || {} });
    const content = [{ type: 'text', text: out.text }];
    if (out.image) content.push({ type: 'image', data: out.image.data, mimeType: out.image.mimeType });
    return { content, isError: out.text.startsWith('Error:') };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
}

async function handle(msg) {
  switch (msg.method) {
    case 'initialize': {
      const { instructions } = await offer();
      return {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'isl-pcb', version: '1.0.0' },
        ...(instructions ? { instructions } : {}),
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: await listTools() };
    case 'tools/call':
      return callTool(msg.params?.name, msg.params?.arguments);
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function main() {
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    if (msg.id === undefined) return; // a notification (such as "initialized"): nothing to answer
    handle(msg).then(
      (result) => send({ jsonrpc: '2.0', id: msg.id, result }),
      (e) => send({ jsonrpc: '2.0', id: msg.id, error: { code: e.code || -32603, message: e.message } }),
    );
  });
  lines.on('close', () => process.exit(0));
}

if (require.main === module) main();

module.exports = { handle, dataDir };
