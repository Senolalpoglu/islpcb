import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ratsnest } from '../core/pcb/ratsnest';
import { emptyPcb } from '../core/pcb/types';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { emptyDoc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';
import { executeTool, executeToolAsync, PART_FORMAT, TOOLS, type Workspace } from '../src/operator/tools';
import { MCP_INSTRUCTIONS } from '../src/operator/session';
import { autoLayout } from '../src/pcb/layout';
import { layoutInWorker } from '../src/pcb/layoutAsync';
import { padNets, padsWithNets } from '../src/pcb/sync';

const require = createRequire(import.meta.url);
const claudeConfig = require('../electron/claude-config.cjs');
const { createBridge } = require('../electron/bridge-server.cjs');
const mcpScript = path.resolve(__dirname, '../mcp/isl-pcb-mcp.cjs');

const tmp = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'isl-pcb-test-'));
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();
const workspace = (doc = emptyDoc()): Workspace => ({ doc, onLibraryChanged: () => {}, showView: () => {} });
const call = (ws: Workspace, name: string, input: Record<string, unknown> = {}) => executeTool(ws, name, input);

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

describe('Claude Desktop configuration', () => {
  it('adds the server and keeps everything else in the file', () => {
    const dir = tmp();
    const file = path.join(dir, 'claude_desktop_config.json');
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'x' } } }));
    claudeConfig.installServer(file, 'isl-pcb', { command: 'node', args: ['a.cjs'] });
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(cfg.theme).toBe('dark');
    expect(Object.keys(cfg.mcpServers)).toEqual(['other', 'isl-pcb']);
    expect(claudeConfig.hasServer(file, 'isl-pcb')).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).mcpServers.other).toBeDefined(); // the first change keeps a copy
    claudeConfig.removeServer(file, 'isl-pcb');
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers)).toEqual(['other']);
  });

  it('creates the file when there is none, and refuses to overwrite one it cannot read', () => {
    const dir = tmp();
    const fresh = path.join(dir, 'new', 'claude_desktop_config.json');
    claudeConfig.installServer(fresh, 'isl-pcb', { command: 'node' });
    expect(claudeConfig.hasServer(fresh, 'isl-pcb')).toBe(true);

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ "mcpServers": { oops');
    expect(() => claudeConfig.installServer(broken, 'isl-pcb', { command: 'node' })).toThrow();
    expect(fs.readFileSync(broken, 'utf8')).toBe('{ "mcpServers": { oops');
  });
});

/** Sends one HTTP request to a bridge and returns the status and parsed body. */
function fetchJson(port: number, method: string, urlPath: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers: { ...headers, ...(payload ? { 'content-length': String(payload.length) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const TOKEN = 'a'.repeat(48);
const listen = (server: http.Server): Promise<number> => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));

describe('bridge server', () => {
  const calls: Array<{ tool: string; input: unknown }> = [];
  const server: http.Server = createBridge({
    token: TOKEN,
    info: () => ({ ready: true, tools: [{ name: 'echo', description: 'Echo.', input_schema: { type: 'object', properties: {} } }], instructions: 'Be brief.' }),
    forward: async (tool: string, input: unknown) => {
      calls.push({ tool, input });
      return tool === 'capture_view' ? { text: 'shot', image: { data: 'AAAA', mimeType: 'image/png' } } : { text: `done ${tool}` };
    },
  });
  let port = 0;
  beforeAll(async () => {
    port = await listen(server);
  });
  afterAll(() => server.close());
  const auth = { authorization: `Bearer ${TOKEN}` };

  it('wants the secret token', async () => {
    expect((await fetchJson(port, 'GET', '/info', {})).status).toBe(401);
    expect((await fetchJson(port, 'GET', '/info', { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await fetchJson(port, 'GET', '/info', auth)).body.tools[0].name).toBe('echo');
  });

  it('refuses requests that come from a web page or carry another host name', async () => {
    expect((await fetchJson(port, 'GET', '/info', { ...auth, origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetchJson(port, 'GET', '/info', { ...auth, host: 'evil.example' })).status).toBe(403);
  });

  it('passes a call on and returns its answer', async () => {
    const r = await fetchJson(port, 'POST', '/call', { ...auth, 'content-type': 'application/json' }, { tool: 'add_part', input: { type: 'R' } });
    expect(r.body).toEqual({ text: 'done add_part' });
    expect(calls.at(-1)).toEqual({ tool: 'add_part', input: { type: 'R' } });
    const shot = await fetchJson(port, 'POST', '/call', auth, { tool: 'capture_view' });
    expect(shot.body.image.mimeType).toBe('image/png');
    expect((await fetchJson(port, 'POST', '/call', auth, { input: {} })).status).toBe(400);
  });
});

/** A running MCP server process with a tiny JSON-RPC client. */
function startMcp(dataDir: string): { rpc: (method: string, params?: unknown) => Promise<any>; stop: () => void } {
  const env: NodeJS.ProcessEnv = { ...process.env, ISL_PCB_DATA: dataDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [mcpScript], { env });
  const waiting = new Map<number, (m: any) => void>();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i: number;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      waiting.get(msg.id)?.(msg);
    }
  });
  let id = 0;
  return {
    rpc: (method, params) =>
      new Promise((resolve, reject) => {
        const mine = ++id;
        const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 15000);
        waiting.set(mine, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: mine, method, params })}\n`);
      }),
    stop: () => child.kill(),
  };
}

describe('MCP server', () => {
  const dir = tmp();
  const seen: Array<{ tool: string; input: unknown }> = [];
  const bridge: http.Server = createBridge({
    token: TOKEN,
    info: () => ({
      ready: true,
      tools: [{ name: 'search_parts', description: 'Search.', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }, { name: 'capture_view', description: 'Shot.', input_schema: { type: 'object', properties: {} } }],
      instructions: 'Build what the picture shows.',
    }),
    forward: async (tool: string, input: unknown) => {
      seen.push({ tool, input });
      if (tool === 'capture_view') return { text: 'Screenshot', image: { data: 'iVBORw0KGgo=', mimeType: 'image/png' } };
      return { text: tool === 'broken' ? 'Error: no such thing' : '[{"type":"R"}]' };
    },
  });
  let mcp: ReturnType<typeof startMcp>;
  beforeAll(async () => {
    const port = await listen(bridge);
    fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ port, token: TOKEN, pid: 1 }));
    mcp = startMcp(dir);
  });
  afterAll(() => {
    mcp.stop();
    bridge.close();
  });

  it('introduces itself with the instructions of the program', async () => {
    const r = await mcp.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    expect(r.result.serverInfo.name).toBe('isl-pcb');
    expect(r.result.capabilities.tools).toEqual({});
    expect(r.result.instructions).toBe('Build what the picture shows.');
  });

  it('lists the tools of the program with MCP field names', async () => {
    const r = await mcp.rpc('tools/list');
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(['search_parts', 'capture_view']);
    expect(r.result.tools[0].inputSchema.properties.query.type).toBe('string');
  });

  it('runs a tool on the program and returns text, flags errors, and passes screenshots as images', async () => {
    const ok = await mcp.rpc('tools/call', { name: 'search_parts', arguments: { query: 'relay' } });
    expect(ok.result.isError).toBe(false);
    expect(ok.result.content).toEqual([{ type: 'text', text: '[{"type":"R"}]' }]);
    expect(seen.at(-1)).toEqual({ tool: 'search_parts', input: { query: 'relay' } });
    const bad = await mcp.rpc('tools/call', { name: 'broken', arguments: {} });
    expect(bad.result.isError).toBe(true);
    const shot = await mcp.rpc('tools/call', { name: 'capture_view' });
    expect(shot.result.content[1]).toEqual({ type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
  });

  it('answers ping and rejects unknown methods', async () => {
    expect((await mcp.rpc('ping')).result).toEqual({});
    expect((await mcp.rpc('nope')).error.code).toBe(-32601);
  });

  it('explains how to connect when the program is not running', async () => {
    const lonely = startMcp(tmp());
    try {
      const tools = await lonely.rpc('tools/list');
      expect(tools.result.tools.map((t: { name: string }) => t.name)).toEqual(['connection_help']);
      const r = await lonely.rpc('tools/call', { name: 'add_part', arguments: {} });
      expect(r.result.isError).toBe(true);
      expect(r.result.content[0].text).toMatch(/not running/);
    } finally {
      lonely.stop();
    }
  });
});

describe('what the program offers Claude Desktop', () => {
  it('has a schema for every tool and describes the part format once', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.description.length).toBeGreaterThan(10);
      expect(t.input_schema.type).toBe('object');
    }
    expect(TOOLS.find((t) => t.name === 'define_part')!.description).toContain('footprintDef');
    expect(MCP_INSTRUCTIONS).toContain(PART_FORMAT);
    expect(MCP_INSTRUCTIONS).toContain('capture_view');
  });
});

describe('library tools', () => {
  const chip = {
    id: 'test-chip',
    label: { en: 'Test chip' },
    category: 'ic',
    prefix: 'U',
    symbol: { kind: 'box', left: ['IN', 'GND'], right: ['OUT', 'VCC'], title: 'TEST' },
    model: { elements: [{ type: 'R', nodes: ['IN', 'OUT'], value: 100 }] },
    footprint: 'TEST_PKG',
    footprintDef: {
      id: 'TEST_PKG',
      body: { w: 6, h: 4 },
      pads: [
        { name: '1', x: -2, y: -1, w: 1, h: 0.6, shape: 'rect' },
        { name: '2', x: -2, y: 1, w: 1, h: 0.6, shape: 'rect' },
        { name: '3', x: 2, y: 1, w: 1, h: 0.6, shape: 'rect' },
        { name: '4', x: 2, y: -1, w: 1, h: 0.6, shape: 'rect' },
      ],
    },
    padMap: ['IN', 'GND', 'OUT', 'VCC'],
  };

  it('adds a missing part with its own package, uses it, and lists it as a user part', () => {
    const ws = workspace();
    expect(JSON.parse(call(ws, 'search_parts', { query: 'test chip' }))).toEqual([]);
    const added = JSON.parse(call(ws, 'define_part', { spec: chip })) as { added: string[] };
    expect(added.added).toEqual(['test-chip']);

    const listed = JSON.parse(call(ws, 'list_library', { user_only: true })) as { total: number; parts: Array<{ type: string; pins: string[]; user_defined: boolean }> };
    expect(listed.parts.map((p) => p.type)).toContain('x:test-chip');
    expect(listed.parts.every((p) => p.user_defined)).toBe(true);
    expect(listed.parts.find((p) => p.type === 'x:test-chip')!.pins).toEqual(['IN', 'GND', 'OUT', 'VCC']);

    call(ws, 'add_part', { type: 'x:test-chip', x: 10, y: 10 });
    call(ws, 'pcb_update');
    const fp = ws.doc.pcb!.fps[0];
    expect(fp.footprint).toContain('TEST_PKG');
    // The pads are tied to the symbol pins through padMap, so nets reach them.
    const x = extractNetlist(ws.doc);
    const pads = padsWithNets(ws.doc.pcb!, padNets(ws.doc, x), ws.doc);
    expect(pads.map((p) => p.name)).toEqual(['1', '2', '3', '4']);
  });

  it('reports a bad definition instead of adding it, and refuses to remove a part that is in use', () => {
    const ws = workspace();
    expect(call(ws, 'define_part', { spec: { ...chip, id: 'Bad Id' } })).toMatch(/^Error:/);
    call(ws, 'define_part', { spec: { ...chip, id: 'test-chip2', footprint: undefined, footprintDef: undefined, padMap: undefined } });
    call(ws, 'add_part', { type: 'x:test-chip2' });
    expect(call(ws, 'remove_part_definition', { id: 'test-chip2' })).toMatch(/placed in the schematic/);
    ws.doc = { ...ws.doc, parts: [] };
    expect(call(ws, 'remove_part_definition', { id: 'test-chip2' })).toMatch(/^Removed/);
    expect(JSON.parse(call(ws, 'list_library', { query: 'test-chip2' })).total).toBe(0);
    expect(call(ws, 'remove_part_definition', { id: 'lm555' })).toMatch(/^Error:/); // built-in or unknown: never removed
  });
});

describe('locked footprints', () => {
  it('pcb_place locks a footprint, pcb_lock changes it, and the layout leaves locked parts where they are', () => {
    const doc = example('am-radio');
    const first = autoLayout(doc, emptyPcb(), { sides: 1, tries: 1 });
    const ws = workspace({ ...doc, pcb: first.pcb });
    const ref = ws.doc.parts.find((p) => ws.doc.pcb!.fps.some((f) => f.partId === p.id))!.ref;
    expect(call(ws, 'pcb_place', { ref, x: 12, y: 9, rotation: 90 })).toMatch(/locked/);
    const locked = ws.doc.pcb!.fps.find((f) => f.locked)!;
    expect([locked.x, locked.y, locked.rot]).toEqual([12, 9, 90]);

    const again = autoLayout(ws.doc, ws.doc.pcb!, { tries: 1 });
    const kept = again.pcb.fps.find((f) => f.partId === locked.partId)!;
    expect([kept.x, kept.y, kept.rot, kept.locked]).toEqual([12, 9, 90, true]);

    expect(call(ws, 'pcb_lock', { locked: false })).toMatch(/Unlocked/);
    expect(ws.doc.pcb!.fps.some((f) => f.locked)).toBe(false);
    expect(call(ws, 'pcb_lock', { refs: ['nope'] })).toMatch(/^Error:/);
  }, 120000);
});

describe('layout off the main thread', () => {
  it('executeToolAsync hands a layout to ws.layoutAsync and applies its result', async () => {
    const layoutAsync = vi.fn(async (...args: Parameters<typeof autoLayout>) => autoLayout(...args));
    const ws: Workspace = { ...workspace(example('am-radio')), layoutAsync };
    const out = JSON.parse(await executeToolAsync(ws, 'pcb_autolayout', { sides: 1 })) as { routed: number; failed: number };
    expect(layoutAsync).toHaveBeenCalledTimes(1);
    expect(out.failed).toBe(0);
    expect(ws.doc.pcb!.tracks.length).toBeGreaterThan(0);
    expect(ratsnest(ws.doc.pcb!, padsWithNets(ws.doc.pcb!, padNets(ws.doc, extractNetlist(ws.doc)), ws.doc))).toEqual([]);

    // Quick tools do not go through the worker.
    await executeToolAsync(ws, 'get_circuit', {});
    expect(layoutAsync).toHaveBeenCalledTimes(1);
  }, 120000);

  it('layoutInWorker gives the same board as autoLayout where there is no Worker', async () => {
    const doc = example('am-radio');
    const direct = autoLayout(doc, emptyPcb(), { sides: 1, tries: 1 });
    const viaWorker = await layoutInWorker(doc, emptyPcb(), { sides: 1, tries: 1 });
    expect(viaWorker.pcb.fps.map((f) => [f.x, f.y, f.rot])).toEqual(direct.pcb.fps.map((f) => [f.x, f.y, f.rot]));
    expect(viaWorker.routed).toBe(direct.routed);
  }, 120000);
});
