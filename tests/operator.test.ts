import { beforeAll, describe, expect, it } from 'vitest';
import { loadBuiltinLibrary } from '../src/editor/library';
import { emptyDoc, PART_DEFS } from '../src/editor/model';
import { runTurn, type ApiMessage } from '../src/operator/session';
import { TOOLS, executeTool, type Workspace } from '../src/operator/tools';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const workspace = (): Workspace => ({ doc: emptyDoc(), onLibraryChanged: () => undefined, showView: () => undefined });
const call = (ws: Workspace, name: string, input: Record<string, unknown> = {}): string => executeTool(ws, name, input);
const data = (text: string): Record<string, any> => {
  expect(text.startsWith('Error:'), text).toBe(false);
  return JSON.parse(text);
};

/** 9 V battery -> 330 ohm -> LED -> ground, built the way Claude would. */
function ledCircuit(ws: Workspace): void {
  data(call(ws, 'add_part', { type: 'VDC', params: { v: 9 } }));
  data(call(ws, 'add_part', { type: 'R', params: { r: 330 } }));
  data(call(ws, 'add_part', { type: 'LED' }));
  data(call(ws, 'add_part', { type: 'GND' }));
  const wires = [
    [['V1', '+'], ['R1', '1']],
    [['R1', '2'], ['D1', 'A']],
    [['D1', 'K'], ['GND', 'GND']],
    [['V1', '-'], ['GND', 'GND']],
  ];
  for (const [a, b] of wires) data(call(ws, 'connect', { a: { ref: a[0], pin: a[1] }, b: { ref: b[0], pin: b[1] } }));
}

describe('operator tools', () => {
  it('declares tools whose names are unique and which all have a schema', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const t of TOOLS) expect(t.input_schema.type).toBe('object');
  });

  it('finds parts and describes their pins', () => {
    const ws = workspace();
    const hits = data(call(ws, 'search_parts', { query: '7805' }));
    expect(hits.some((h: any) => h.type === 'x:lm7805')).toBe(true);
    const d = data(call(ws, 'describe_part', { type: 'x:lm7805' }));
    expect(d.pins.map((p: any) => p.name)).toEqual(['IN', 'GND', 'OUT']);
    expect(call(ws, 'describe_part', { type: 'nope' })).toMatch(/^Error:/);
  });

  it('places parts without overlap, wires them and the nets come out right', () => {
    const ws = workspace();
    ledCircuit(ws);
    const c = data(call(ws, 'get_circuit'));
    expect(c.parts).toHaveLength(4);
    const nets: string[][] = c.nets;
    const has = (a: string, b: string) => nets.some((n) => n.includes(a) && n.includes(b));
    expect(has('V1.+', 'R1.1')).toBe(true);
    expect(has('R1.2', 'D1.A')).toBe(true);
    expect(has('D1.K', 'V1.-')).toBe(true);
    expect(has('V1.+', 'D1.K')).toBe(false); // nothing was shorted by accident
    expect(c.hasGround).toBe(true);
  });

  it('simulates what it built: about 21 mA through a red LED from 9 V and 330 ohm', () => {
    const ws = workspace();
    ledCircuit(ws);
    const r = data(call(ws, 'simulate_dc'));
    expect(r.converged).toBe(true);
    expect(r.amps_through_parts.R1).toBeGreaterThan(0.015);
    expect(r.amps_through_parts.R1).toBeLessThan(0.03);
  });

  it('reports mistakes in plain words', () => {
    const ws = workspace();
    data(call(ws, 'add_part', { type: 'R' }));
    expect(call(ws, 'connect', { a: { ref: 'R1', pin: 'x' }, b: { ref: 'R1', pin: '2' } })).toMatch(/unknown pin "x".*pins are 1, 2/);
    expect(call(ws, 'set_params', { ref: 'R1', params: { volts: 3 } })).toMatch(/no parameter volts/);
    expect(call(ws, 'delete_part', { ref: 'R9' })).toMatch(/no part "R9"/);
    expect(call(ws, 'simulate_dc')).toMatch(/no ground/);
    expect(call(ws, 'add_wire', { x1: 0, y1: 0, x2: 3, y2: 4 })).toMatch(/horizontal or vertical/);
  });

  it('builds a new library part from JSON and uses it', () => {
    const ws = workspace();
    const spec = { id: 'op-test-divider', label: { en: 'Divider' }, category: 'misc', prefix: 'U', symbol: { kind: 'box', left: ['IN', 'GND'], right: ['OUT'], title: 'DIV' }, model: { elements: [{ type: 'R', nodes: ['IN', 'OUT'], value: 1000 }, { type: 'R', nodes: ['OUT', 'GND'], value: 1000 }] } };
    expect(data(call(ws, 'define_part', { spec })).added).toEqual(['op-test-divider']);
    expect(PART_DEFS['x:op-test-divider']).toBeDefined();
    expect(call(ws, 'define_part', { spec: { id: 'Bad Id' } })).toMatch(/^Error:/);
  });

  it('lays out a PCB: footprints, single-sided routing, a ground plane, no open connections', () => {
    const ws = workspace();
    ledCircuit(ws);
    expect(data(call(ws, 'pcb_update')).footprints).toBe(3); // the ground symbol has none
    expect(data(call(ws, 'pcb_settings', { sides: 1 })).sides).toBe(1);
    const routed = data(call(ws, 'pcb_autoroute'));
    expect(routed.failed).toBe(0);
    expect(call(ws, 'pcb_add_pour', { net: 'GND', layer: 'top' })).toMatch(/Added a GND pour on the bottom layer/);
    const s = data(call(ws, 'pcb_status'));
    expect(s.open_connections).toBe(0);
    expect(s.sides).toBe(1);
    expect(s.vias).toBe(0);
    expect(s.pours).toEqual(['GND/bottom']); // single-sided: the plane goes on the copper side whatever was asked
  });
});

describe('operator conversation', () => {
  const textMessage = (text: string) => ({ ok: true as const, message: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });

  it('carries out tool calls, feeds the results back and ends with Claude\'s answer', async () => {
    const ws = workspace();
    const seen: unknown[][] = [];
    const replies = [
      { ok: true as const, message: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'Placing a resistor.' }, { type: 'tool_use', id: 't1', name: 'add_part', input: { type: 'R', params: { r: 4700 } } }], stop_reason: 'tool_use' } },
      textMessage('Done: R1 = 4.7 kΩ.'),
    ];
    const items: Array<[string, string]> = [];
    const keep = await runTurn({
      model: 'claude-opus-5-5',
      history: [],
      userText: 'add a 4.7k resistor',
      ws,
      send: async (req) => {
        seen.push(JSON.parse(JSON.stringify(req.messages)));
        return replies.shift()!;
      },
      onItem: (role, text) => items.push([role, text]),
      onDoc: () => undefined,
      cancelled: () => false,
    });
    expect(ws.doc.parts).toHaveLength(1);
    expect(ws.doc.parts[0].params.r).toBe(4700);
    expect(items.map((i) => i[0])).toEqual(['assistant', 'tool', 'assistant']);
    // The second request carries the assistant turn unchanged (thinking block included) and one tool_result.
    const second = seen[1] as ApiMessage[];
    expect(second).toHaveLength(3);
    expect((second[1].content as any[])[0]).toMatchObject({ type: 'thinking', signature: 'sig' });
    expect((second[2].content as any[])[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(keep).toHaveLength(4);
  });

  it('shows an API error and keeps the earlier conversation intact', async () => {
    const before: ApiMessage[] = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }];
    const items: Array<[string, string]> = [];
    const keep = await runTurn({ model: 'm', history: before, userText: 'again', ws: workspace(), send: async () => ({ ok: false, error: 'Rate limited (429).' }), onItem: (r, t) => items.push([r, t]), onDoc: () => undefined, cancelled: () => false });
    expect(items).toEqual([['error', 'Rate limited (429).']]);
    expect(keep).toBe(before);
  });

  it('stops when asked', async () => {
    const items: Array<[string, string]> = [];
    await runTurn({ model: 'm', history: [], userText: 'x', ws: workspace(), send: async () => textMessage('never'), onItem: (r, t) => items.push([r, t]), onDoc: () => undefined, cancelled: () => true });
    expect(items).toEqual([['note', 'Stopped.']]);
  });
});
