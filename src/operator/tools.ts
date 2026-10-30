// The tools Claude can use on the open project: look up parts, place them, wire them, simulate, and work the PCB.
// Every tool takes plain JSON and returns text (JSON for data, a short sentence for failures starting with "Error:").
// They change `Workspace.doc` in place; the panel pushes each new document into the editor as the conversation goes.

import { autoroute } from '../../core/pcb/router';
import { runDrc } from '../../core/pcb/drc';
import { ratsnest } from '../../core/pcb/ratsnest';
import { Simulator } from '../../core/sim/solver';
import { emptyPcb, type Layer, type PcbDoc } from '../../core/pcb/types';
import { en } from '../i18n/en';
import { allCustomSpecs, customSpec, customType, isCustomType } from '../editor/customParts';
import { importLibraryText, removeUserPart } from '../editor/library';
import { PART_DEFS, PART_ORDER, addPart, addWire, movePartWithWires, routeWire, transformPartWithWires, pinPositions, ptKey, type Doc, type Part, type Pt, type Rot } from '../editor/model';
import { extractNetlist } from '../editor/netlist';
import { autoLayout, netWidths, type LayoutOptions, type LayoutResult } from '../pcb/layout';
import { padNets, padsWithNets, syncPcb } from '../pcb/sync';

export interface Workspace {
  doc: Doc;
  /** Called after a part definition was imported, so the library list refreshes. */
  onLibraryChanged: () => void;
  showView: (view: 'schematic' | 'pcb') => void;
  /** Runs a layout off the page's main thread. Without it executeToolAsync does the work inline. */
  layoutAsync?: (doc: Doc, pcb: PcbDoc, opts: LayoutOptions) => Promise<LayoutResult>;
}

/** How a part is described for define_part. Shared by the tool description and the assistant's instructions. */
export const PART_FORMAT = `Part JSON for define_part
{ "id": "lowercase-id", "label": {"en": "...", "tr": "..."}, "category": "passive|source|semi|ic|logic|switch|electromech|meter|power|sensor|module|misc", "prefix": "U",
  "symbol": {"kind": "box", "left": ["IN","GND"], "right": ["OUT"], "title": "NAME"}   // or {"kind":"like","like":"R","pins":["1","2"]}, {"kind":"glyph","glyph":"scr"}
  "params": [{"name":"r","label":{"en":"Resistance (ohm)"},"default":1000}],
  "model": {"elements": [ {"type":"R","nodes":["IN","OUT"],"value":"$r"} ]},   // node names are pin names, internal names you invent, or "0" for ground
  "footprint": "SIP_3" }
Element types and node order: R C L V I D SW -> [a,b]; Q -> [collector,emitter,base] (props npn,bf,is); M -> [drain,source,gate] (props nmos,beta,vth); OA op-amp -> [out,in-,in+] with "p"/"n" supply nodes; VSW voltage-controlled switch and G transconductance -> [a,b,control+,control-]; THY thyristor (props bidir for a triac) -> [anode,cathode,gate]. Values may be numbers or expressions with $parameters ("$r*2").
Package: "footprint" names a package that exists (DIP8/14/16/18/28/40, SIP_n, HDR_1X2, TO92_BJT, SOT23, SOT223, LED_5MM, AXIAL_7.62, SMD_0805 ...); without one a header strip is chosen from the pin count. For a package that does not exist add "footprintDef": {"id":"MY_PKG","label":"...","body":{"w":10,"h":6},"pads":[{"name":"1","x":-2.54,"y":0,"w":1.6,"h":1.6,"shape":"round|rect|oval","drill":0.9}]} (mm from the part centre, x right, y down; no drill = surface-mount) and set "footprint" to the same id. When the pads are in a different order than the symbol pins, or a footprint has more pads than the symbol has pins, add "padMap": one entry per pad in the footprint's order, the symbol pin name it connects to ("-" for an unused pad). "virtual": true makes an ideal part with no package. A part without "model" is pinout-only: it is placed and routed but not simulated.`;

const pinRef = {
  type: 'object',
  properties: { ref: { type: 'string' }, pin: { type: ['string', 'integer'] } },
  required: ['ref', 'pin'],
};

/** JSON-schema definitions in the shape of the Messages API `tools` parameter. */
export const TOOLS = [
  {
    name: 'search_parts',
    description: 'Search the part library by words (name, type, category). Returns type ids to use with add_part, with pin names and parameters. Always look a part up before placing it.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for, e.g. "7805", "relay", "arduino".' }, category: { type: 'string', description: 'Optional: passive, source, semi, ic, logic, mcu, switch, electromech, meter, power, sensor, module, misc.' }, limit: { type: 'integer', description: 'Maximum results, default 25.' } } },
  },
  {
    name: 'describe_part',
    description: 'Full description of one part type: pin names with their offsets from the part origin (grid units, rotation 0) and its parameters with defaults.',
    input_schema: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] },
  },
  {
    name: 'get_circuit',
    description: 'The current schematic: every part (ref, type, position, rotation, parameters, pin positions) and the nets (which pins are connected). Use it before changing an existing design and to check your wiring.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'add_part',
    description: 'Place a part on the schematic. x and y are grid units (x to the right, y down); leave them out to let the program choose a free spot. Returns the reference (R1, ...) and the absolute position of every pin.',
    input_schema: { type: 'object', properties: { type: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' }, rotation: { type: 'integer', enum: [0, 90, 180, 270] }, params: { type: 'object', description: 'Parameter values by name, e.g. {"r": 4700}. Numbers are in base units (ohms, farads, volts).' } }, required: ['type'] },
  },
  {
    name: 'set_params',
    description: 'Change parameters of a placed part, e.g. {"ref":"R1","params":{"r":220}}.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, params: { type: 'object' } }, required: ['ref', 'params'] },
  },
  {
    name: 'move_part',
    description: 'Move a part to a new grid position; wires attached to its pins follow.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, x: { type: 'integer' }, y: { type: 'integer' } }, required: ['ref', 'x', 'y'] },
  },
  {
    name: 'rotate_part',
    description: 'Set the rotation of a part (0, 90, 180, 270) and optionally mirror it left to right. Wires attached to its pins follow.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, rotation: { type: 'integer', enum: [0, 90, 180, 270] }, mirror: { type: 'boolean' } }, required: ['ref', 'rotation'] },
  },
  {
    name: 'delete_part',
    description: 'Remove a part from the schematic (the wires stay; remove them with disconnect_pin if needed).',
    input_schema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
  },
  {
    name: 'connect',
    description: 'Wire one pin to another with an orthogonal wire that avoids other pins and wires where it can. A pin is {"ref":"R1","pin":"2"}: the pin name from the part description, or its 0-based index. Check the resulting nets with get_circuit.',
    input_schema: { type: 'object', properties: { a: pinRef, b: pinRef }, required: ['a', 'b'] },
  },
  {
    name: 'add_wire',
    description: 'Draw one straight horizontal or vertical wire between two grid points. Wires join where their ends meet a pin or another wire.',
    input_schema: { type: 'object', properties: { x1: { type: 'integer' }, y1: { type: 'integer' }, x2: { type: 'integer' }, y2: { type: 'integer' } }, required: ['x1', 'y1', 'x2', 'y2'] },
  },
  {
    name: 'disconnect_pin',
    description: 'Remove the wires that end at a pin.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, pin: { type: ['string', 'integer'] } }, required: ['ref', 'pin'] },
  },
  {
    name: 'clear_circuit',
    description: 'Delete the whole schematic (and its PCB). Only when the user asks to start over.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'define_part',
    description: `Add a new part to the library when search_parts / list_library has none that fits (a chip from a datasheet, a module, a part from a photo). Saved with the user's library and usable at once with add_part as "x:<id>". An existing user part with the same id is replaced; built-in parts cannot be. Returns the errors if the JSON does not validate: fix them and call again.\n\n${PART_FORMAT}`,
    input_schema: { type: 'object', properties: { spec: { type: 'object', description: 'The part JSON object.' } }, required: ['spec'] },
  },
  {
    name: 'list_library',
    description: 'List parts of the library with id, label, category, pin names and footprint. Use user_only to see just the parts that were added with define_part. Check here before defining a part, so the same part is not defined twice.',
    input_schema: { type: 'object', properties: { user_only: { type: 'boolean' }, query: { type: 'string', description: 'Optional words to filter by.' }, limit: { type: 'integer', description: 'Default 40.' } } },
  },
  {
    name: 'remove_part_definition',
    description: 'Remove a part that was added with define_part (a wrong or unused definition). Built-in parts and parts that are placed in the schematic cannot be removed.',
    input_schema: { type: 'object', properties: { id: { type: 'string', description: 'The id given to define_part, without the "x:".' } }, required: ['id'] },
  },
  {
    name: 'simulate_dc',
    description: 'Solve the DC operating point of the schematic and return the voltage at every pin and the current through each part. Microcontroller firmware is not run. Use it to check that a design works.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pcb_update',
    description: 'Create or update the PCB from the schematic: new parts get footprints, nets are refreshed. Existing placement is kept.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pcb_settings',
    description: 'Board and rule settings: sides (1 = single-sided with copper on the bottom, 2 = double-sided), board size and the design rules, all in millimetres. Switching to single-sided removes top-side tracks and vias.',
    input_schema: { type: 'object', properties: { sides: { type: 'integer', enum: [1, 2] }, board_width: { type: 'number' }, board_height: { type: 'number' }, track_width: { type: 'number' }, clearance: { type: 'number' }, via_diameter: { type: 'number' }, via_drill: { type: 'number' }, edge_clearance: { type: 'number' } } },
  },
  {
    name: 'pcb_place',
    description: 'Position a footprint on the board (millimetres, board origin top left) and optionally rotate it. The footprint is locked there: pcb_autolayout and pcb_autoplace leave it alone (pcb_lock unlocks it).',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, rotation: { type: 'integer', enum: [0, 90, 180, 270] } }, required: ['ref', 'x', 'y'] },
  },
  {
    name: 'pcb_lock',
    description: 'Lock or unlock the position of footprints. Locked footprints stay where they are when the board is arranged automatically; the others are arranged around them. Give "refs" for some parts or leave it out for all.',
    input_schema: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' } }, locked: { type: 'boolean', description: 'Default true.' } } },
  },
  {
    name: 'pcb_autolayout',
    description: 'The one-step way to a finished board: syncs the PCB with the schematic, arranges all parts so that nets are short and (on a single-sided board) air wires do not cross, sizes the board, picks track widths (power and ground wider, narrower where space is tight) and routes everything. Tries several arrangements and keeps the best. Replaces any existing placement and tracks. Returns how many connections were routed and which failed; on a single-sided board a failed connection needs a wire link (jumper).',
    input_schema: { type: 'object', properties: { sides: { type: 'integer', enum: [1, 2], description: '1 = single-sided (copper on the bottom), 2 = double-sided. Default: as set now.' }, keep_board: { type: 'boolean', description: 'Keep the current board size unless the parts do not fit. Default: size the board to the parts.' }, place_only: { type: 'boolean', description: 'Only arrange the parts; route later with pcb_autoroute.' } } },
  },
  {
    name: 'pcb_autoplace',
    description: 'Arrange the footprints automatically (short nets, no overlaps, connectors at the edge, no crossing air wires on a single-sided board) and size the board. Removes existing tracks. Same as pcb_autolayout with place_only.',
    input_schema: { type: 'object', properties: { keep_board: { type: 'boolean' } } },
  },
  {
    name: 'pcb_autoroute',
    description: 'Route all unconnected nets automatically (two layers with vias, or the bottom layer only on a single-sided board). Track widths are chosen per net: power and ground wider, signals at the board rule, narrower where space is tight. Returns how many connections were routed and which failed.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pcb_clear_routes',
    description: 'Remove all tracks and vias.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'pcb_add_pour',
    description: 'Add a copper pour (ground plane) of one net on one layer. Pads of that net connect to it directly.',
    input_schema: { type: 'object', properties: { net: { type: 'string', description: 'Usually "GND".' }, layer: { type: 'string', enum: ['top', 'bottom'] } }, required: ['net', 'layer'] },
  },
  {
    name: 'pcb_status',
    description: 'State of the PCB: footprint count, open connections (air wires), tracks, vias, pours, and the design rule check result.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'show_view',
    description: 'Switch the editor between the schematic and the PCB view so the user sees the result.',
    input_schema: { type: 'object', properties: { view: { type: 'string', enum: ['schematic', 'pcb'] } }, required: ['view'] },
  },
];

const MAX_RESULT = 14000;
const json = (value: unknown): string => {
  const text = JSON.stringify(value);
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}…(truncated)` : text;
};
const fail = (message: string): string => `Error: ${message}`;
const eq = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;
const isRot = (v: unknown): v is Rot => v === 0 || v === 90 || v === 180 || v === 270;

const labelOf = (type: string): string => {
  const def = PART_DEFS[type];
  return def.labelText?.en ?? (en as Record<string, string>)[def.label] ?? type;
};

function findPart(doc: Doc, ref: unknown): Part | undefined {
  const key = String(ref);
  return doc.parts.find((p) => p.ref === key || p.id === key);
}

function pinIndex(part: Part, pin: unknown): number {
  const def = PART_DEFS[part.type];
  const text = String(pin);
  const byName = def.pinNames.findIndex((n) => n.toLowerCase() === text.toLowerCase());
  if (byName >= 0) return byName;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n < def.pins.length ? n : -1;
}

const pinsOf = (part: Part): Array<{ name: string; x: number; y: number }> => pinPositions(part).map((p, i) => ({ name: PART_DEFS[part.type].pinNames[i], x: p.x, y: p.y }));
const pinLabel = (p: Part, i: number): string => `${p.ref}.${PART_DEFS[p.type].pinNames[i]}`;

/** A free spot for a new part: to the right of everything, wrapping to a new row when the row gets long. */
function freeSpot(doc: Doc, type: string): Pt {
  const def = PART_DEFS[type];
  const minX = Math.min(...def.pins.map((p) => p.x));
  const maxX = Math.max(...def.pins.map((p) => p.x));
  const minY = Math.min(...def.pins.map((p) => p.y));
  if (doc.parts.length === 0) return { x: 10 - minX, y: 10 - minY };
  const all = doc.parts.flatMap((p) => pinPositions(p));
  const right = Math.max(...all.map((p) => p.x));
  const bottom = Math.max(...all.map((p) => p.y));
  const left = Math.min(...all.map((p) => p.x));
  const top = Math.min(...all.map((p) => p.y));
  const x = right + 7 - minX;
  if (x + maxX > left + 70) return { x: left + 4 - minX, y: bottom + 8 - minY };
  return { x, y: top - minY };
}

function netsOf(doc: Doc): { groups: string[][]; ground: boolean } {
  const x = extractNetlist(doc);
  const byNode = new Map<number, string[]>();
  for (const part of doc.parts) {
    PART_DEFS[part.type].pinNames.forEach((_, i) => {
      const node = x.nodeOfPin.get(`${part.id}:${i}`);
      if (node === undefined) return;
      const list = byNode.get(node) ?? [];
      list.push(pinLabel(part, i));
      byNode.set(node, list);
    });
  }
  return { groups: [...byNode.values()].filter((g) => g.length > 1), ground: x.error !== 'noGround' };
}

const trimParams = (p: Part['params']): Record<string, unknown> => Object.fromEntries(Object.entries(p).filter(([k, v]) => !(typeof v === 'string' && (k === 'source' || k === 'hex' || v.length > 80))));

const pcbOf = (ws: Workspace): PcbDoc => ws.doc.pcb ?? emptyPcb();
const setPcb = (ws: Workspace, pcb: PcbDoc): void => {
  ws.doc = { ...ws.doc, pcb };
};

function pcbState(ws: Workspace) {
  const x = extractNetlist(ws.doc);
  const pcb = pcbOf(ws);
  const pads = padsWithNets(pcb, padNets(ws.doc, x), ws.doc);
  return { x, pcb, pads };
}

export function executeTool(ws: Workspace, name: string, input: Record<string, unknown>): string {
  try {
    return run(ws, name, input ?? {});
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

const isLayout = (name: string): boolean => name === 'pcb_autolayout' || name === 'pcb_autoplace';

function layoutOptions(name: string, input: Record<string, unknown>): LayoutOptions {
  const sides = input.sides === 1 ? 1 : input.sides === 2 ? 2 : undefined;
  return { ...(sides ? { sides } : {}), keepBoard: input.keep_board === true, placeOnly: name === 'pcb_autoplace' || input.place_only === true };
}

/** Puts a finished layout on the board and describes it. */
function applyLayout(ws: Workspace, name: string, input: Record<string, unknown>, r: LayoutResult): string {
  setPcb(ws, r.pcb);
  const placeOnly = name === 'pcb_autoplace' || input.place_only === true;
  return json({
    board_mm: [r.pcb.board.w, r.pcb.board.h],
    sides: r.pcb.sides === 1 ? 1 : 2,
    footprints: r.pcb.fps.length,
    locked: r.pcb.fps.filter((f) => f.locked).length,
    ...(placeOnly ? { crossing_air_wires: r.crossings } : { routed: r.routed, failed: r.failed.length, failed_connections: r.failed.slice(0, 10).map((f) => `${f.net}: ${f.from} -> ${f.to}`), track_widths_mm: r.widthsUsed, tracks: r.pcb.tracks.length, vias: r.pcb.vias.length }),
    ...(r.failed.length && r.pcb.sides === 1 ? { note: 'On a single-sided board the failed connections cross other tracks: add wire links (jumpers) for them.' } : {}),
  });
}

/**
 * Like executeTool, but a layout runs through `ws.layoutAsync` (a worker), so the page stays responsive while it works.
 * Everything else is quick and runs inline.
 */
export async function executeToolAsync(ws: Workspace, name: string, input: Record<string, unknown>): Promise<string> {
  if (!isLayout(name) || !ws.layoutAsync || ws.doc.parts.length === 0) return executeTool(ws, name, input);
  try {
    const args = input ?? {};
    return applyLayout(ws, name, args, await ws.layoutAsync(ws.doc, pcbOf(ws), layoutOptions(name, args)));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function run(ws: Workspace, name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'search_parts': {
      const words = String(input.query ?? '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const category = input.category === undefined ? undefined : String(input.category);
      const limit = Math.min(Number(input.limit) || 25, 60);
      const hits = PART_ORDER.filter((type) => {
        const def = PART_DEFS[type];
        if (category && def.category !== category) return false;
        const hay = `${type} ${labelOf(type)} ${def.category}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      }).slice(0, limit);
      return json(hits.map((type) => ({ type, label: labelOf(type), category: PART_DEFS[type].category, pins: PART_DEFS[type].pinNames.length > 24 ? `${PART_DEFS[type].pinNames.length} pins` : PART_DEFS[type].pinNames, params: PART_DEFS[type].params.map((p) => p.name) })));
    }
    case 'describe_part': {
      const type = String(input.type);
      const def = PART_DEFS[type];
      if (!def) return fail(`no part type "${type}". Use search_parts.`);
      return json({ type, label: labelOf(type), category: def.category, prefix: def.prefix, pins: def.pinNames.map((n, i) => ({ name: n, dx: def.pins[i].x, dy: def.pins[i].y })), params: def.params.map((p) => ({ name: p.name, default: p.default, label: p.labelText?.en ?? (en as Record<string, string>)[p.label] ?? p.name })) });
    }
    case 'get_circuit': {
      const { groups, ground } = netsOf(ws.doc);
      return json({
        parts: ws.doc.parts.map((p) => ({ ref: p.ref, id: p.id, type: p.type, label: labelOf(p.type), x: p.x, y: p.y, rotation: p.rot, params: trimParams(p.params), pins: pinsOf(p) })),
        wires: ws.doc.wires.length,
        nets: groups,
        hasGround: ground,
      });
    }
    case 'add_part': {
      const type = String(input.type);
      if (!PART_DEFS[type]) return fail(`no part type "${type}". Use search_parts.`);
      const rot = isRot(input.rotation) ? input.rotation : 0;
      const spot = Number.isInteger(input.x) && Number.isInteger(input.y) ? { x: Number(input.x), y: Number(input.y) } : freeSpot(ws.doc, type);
      let doc = addPart(ws.doc, type, spot.x, spot.y, rot);
      const part = doc.parts[doc.parts.length - 1];
      const given = (input.params ?? {}) as Record<string, number | boolean | string>;
      const known = new Set(PART_DEFS[type].params.map((p) => p.name));
      const unknown = Object.keys(given).filter((k) => !known.has(k));
      const accepted = Object.fromEntries(Object.entries(given).filter(([k]) => known.has(k)));
      doc = { ...doc, parts: doc.parts.map((p) => (p.id === part.id ? { ...p, params: { ...p.params, ...accepted } } : p)) };
      ws.doc = doc;
      const placed = doc.parts[doc.parts.length - 1];
      return json({ ref: placed.ref, id: placed.id, x: placed.x, y: placed.y, pins: pinsOf(placed), ...(unknown.length ? { ignoredParams: unknown } : {}) });
    }
    case 'set_params': {
      const part = findPart(ws.doc, input.ref);
      if (!part) return fail(`no part "${String(input.ref)}".`);
      const known = new Set(PART_DEFS[part.type].params.map((p) => p.name));
      const given = (input.params ?? {}) as Record<string, number | boolean | string>;
      const bad = Object.keys(given).filter((k) => !known.has(k));
      if (bad.length) return fail(`${part.ref} has no parameter ${bad.join(', ')}. It has: ${[...known].join(', ') || 'none'}.`);
      ws.doc = { ...ws.doc, parts: ws.doc.parts.map((p) => (p.id === part.id ? { ...p, params: { ...p.params, ...given } } : p)) };
      return json({ ref: part.ref, params: trimParams({ ...part.params, ...given }) });
    }
    case 'move_part': {
      const part = findPart(ws.doc, input.ref);
      if (!part) return fail(`no part "${String(input.ref)}".`);
      ws.doc = movePartWithWires(ws.doc, part.id, Number(input.x) - part.x, Number(input.y) - part.y);
      const moved = findPart(ws.doc, part.id)!;
      return json({ ref: moved.ref, x: moved.x, y: moved.y, pins: pinsOf(moved) });
    }
    case 'rotate_part': {
      const part = findPart(ws.doc, input.ref);
      if (!part) return fail(`no part "${String(input.ref)}".`);
      const rot = input.rotation;
      if (!isRot(rot)) return fail('rotation must be 0, 90, 180 or 270.');
      ws.doc = transformPartWithWires(ws.doc, part.id, typeof input.mirror === 'boolean' ? { rot, mirror: input.mirror } : { rot });
      return json({ ref: part.ref, rotation: rot, mirror: findPart(ws.doc, part.id)!.mirror === true, pins: pinsOf(findPart(ws.doc, part.id)!) });
    }
    case 'delete_part': {
      const part = findPart(ws.doc, input.ref);
      if (!part) return fail(`no part "${String(input.ref)}".`);
      ws.doc = { ...ws.doc, parts: ws.doc.parts.filter((p) => p.id !== part.id) };
      return `Deleted ${part.ref}.`;
    }
    case 'connect': {
      const ends = [input.a, input.b] as Array<{ ref: unknown; pin: unknown }>;
      const parts = ends.map((e) => findPart(ws.doc, e.ref));
      const missing = parts.findIndex((p) => !p);
      if (missing >= 0) return fail(`no part "${String(ends[missing].ref)}".`);
      const [pa, pb] = parts as [Part, Part];
      const ia = pinIndex(pa, ends[0].pin);
      const ib = pinIndex(pb, ends[1].pin);
      if (ia < 0) return fail(`unknown pin "${String(ends[0].pin)}" on ${pa.ref}; its pins are ${PART_DEFS[pa.type].pinNames.join(', ')}.`);
      if (ib < 0) return fail(`unknown pin "${String(ends[1].pin)}" on ${pb.ref}; its pins are ${PART_DEFS[pb.type].pinNames.join(', ')}.`);
      const a = pinPositions(pa)[ia];
      const b = pinPositions(pb)[ib];
      if (eq(a, b)) return 'Those pins are at the same point, so they are already connected.';
      const { path, clean } = routeWire(ws.doc, a, b);
      let doc = ws.doc;
      for (let i = 1; i < path.length; i++) doc = addWire(doc, path[i - 1], path[i]);
      ws.doc = doc;
      const net = netsOf(ws.doc).groups.find((g) => g.includes(pinLabel(pa, ia)));
      return json({ connected: [pinLabel(pa, ia), pinLabel(pb, ib)], via: path.map(ptKey), cleanRoute: clean, net, ...(clean ? {} : { warning: 'Could not find a route that avoids other pins and wires; check the nets with get_circuit.' }) });
    }
    case 'add_wire': {
      const a = { x: Number(input.x1), y: Number(input.y1) };
      const b = { x: Number(input.x2), y: Number(input.y2) };
      if (a.x !== b.x && a.y !== b.y) return fail('a wire must be horizontal or vertical.');
      ws.doc = addWire(ws.doc, a, b);
      return 'Wire added.';
    }
    case 'disconnect_pin': {
      const part = findPart(ws.doc, input.ref);
      if (!part) return fail(`no part "${String(input.ref)}".`);
      const i = pinIndex(part, input.pin);
      if (i < 0) return fail(`unknown pin "${String(input.pin)}".`);
      const at = pinPositions(part)[i];
      const before = ws.doc.wires.length;
      ws.doc = { ...ws.doc, wires: ws.doc.wires.filter((w) => !eq(w.a, at) && !eq(w.b, at)) };
      return `Removed ${before - ws.doc.wires.length} wire(s).`;
    }
    case 'clear_circuit':
      ws.doc = { ...ws.doc, parts: [], wires: [], pcb: undefined };
      return 'The schematic is empty.';
    case 'define_part': {
      const r = importLibraryText(JSON.stringify(input.spec));
      if (r.added.length) ws.onLibraryChanged();
      return r.errors.length ? fail(r.errors.join(' ')) : json({ added: r.added, note: 'Use add_part with type "x:<id>".' });
    }
    case 'simulate_dc': {
      const x = extractNetlist(ws.doc);
      if (!x.netlist) return fail(x.error === 'noGround' ? 'The circuit has no ground: add a GND symbol (type GND) and connect it.' : 'The schematic is empty.');
      const s = new Simulator(x.netlist).operatingPoint();
      const volts: Record<string, number> = {};
      for (const part of ws.doc.parts) {
        if (part.type === 'GND') continue;
        PART_DEFS[part.type].pinNames.forEach((_, i) => {
          const node = x.nodeOfPin.get(`${part.id}:${i}`);
          if (node !== undefined && Object.keys(volts).length < 120) volts[pinLabel(part, i)] = Number(s.v[node].toFixed(4));
        });
      }
      const amps: Record<string, number> = {};
      for (const part of ws.doc.parts) {
        const id = x.primary.get(part.id) ?? (x.elementIds.has(part.id) ? part.id : undefined);
        if (id !== undefined && s.i[id] !== undefined) amps[part.ref] = Number(s.i[id].toPrecision(5));
      }
      return json({ converged: s.converged, volts, amps_through_parts: amps, note: 'DC operating point; capacitors open, inductors short, firmware not run.' });
    }
    case 'pcb_update': {
      const x = extractNetlist(ws.doc);
      setPcb(ws, syncPcb(ws.doc, x, pcbOf(ws)));
      const pcb = pcbOf(ws);
      return json({ footprints: pcb.fps.length, board_mm: [pcb.board.w, pcb.board.h] });
    }
    case 'pcb_settings': {
      let pcb = pcbOf(ws);
      if (input.sides === 1) pcb = { ...pcb, sides: 1, tracks: pcb.tracks.filter((t) => t.layer === 'bottom'), vias: [] };
      else if (input.sides === 2) pcb = { ...pcb, sides: 2 };
      const board = { ...pcb.board };
      if (Number(input.board_width) > 5) board.w = Number(input.board_width);
      if (Number(input.board_height) > 5) board.h = Number(input.board_height);
      const rules = { ...pcb.rules };
      const rule = (key: keyof PcbDoc['rules'], v: unknown): void => {
        if (Number(v) > 0) rules[key] = Number(v);
      };
      rule('trackWidth', input.track_width);
      rule('clearance', input.clearance);
      rule('viaDia', input.via_diameter);
      rule('viaDrill', input.via_drill);
      rule('edgeClearance', input.edge_clearance);
      setPcb(ws, { ...pcb, board, rules });
      const now = pcbOf(ws);
      return json({ sides: now.sides === 1 ? 1 : 2, board_mm: [now.board.w, now.board.h], rules: now.rules });
    }
    case 'pcb_place': {
      const part = findPart(ws.doc, input.ref);
      const pcb = pcbOf(ws);
      const fp = part && pcb.fps.find((f) => f.partId === part.id);
      if (!part || !fp) return fail(`no footprint for "${String(input.ref)}"; run pcb_update first.`);
      const rot = isRot(input.rotation) ? input.rotation : fp.rot;
      setPcb(ws, { ...pcb, fps: pcb.fps.map((f) => (f.partId === part.id ? { ...f, x: Number(input.x), y: Number(input.y), rot, locked: true } : f)) });
      return `Placed ${part.ref} at (${Number(input.x)}, ${Number(input.y)}) mm and locked it there.`;
    }
    case 'pcb_lock': {
      const pcb = pcbOf(ws);
      const refs = Array.isArray(input.refs) ? input.refs.map(String) : null;
      const ids = refs ? new Set(refs.map((r) => findPart(ws.doc, r)?.id).filter((id): id is string => id !== undefined)) : null;
      if (refs && ids!.size !== refs.length) return fail(`unknown part in ${refs.join(', ')}.`);
      const locked = input.locked !== false;
      setPcb(ws, { ...pcb, fps: pcb.fps.map((f) => (ids === null || ids.has(f.partId) ? { ...f, locked } : f)) });
      return `${locked ? 'Locked' : 'Unlocked'} ${ids === null ? pcb.fps.length : ids.size} footprint(s).`;
    }
    case 'list_library': {
      const words = String(input.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const limit = Math.min(Number(input.limit) || 40, 200);
      const hits = allCustomSpecs().filter((s) => {
        if (input.user_only === true && s.builtin) return false;
        const hay = `${s.id} ${s.label.en} ${s.label.tr ?? ''} ${s.category}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      return json({
        total: hits.length,
        parts: hits.slice(0, limit).map((s) => ({ type: customType(s.id), label: s.label.en, category: s.category, pins: PART_DEFS[customType(s.id)]?.pinNames, footprint: s.footprint ?? null, user_defined: s.builtin !== true })),
      });
    }
    case 'remove_part_definition': {
      const id = String(input.id ?? '').replace(/^x:/, '');
      const spec = customSpec(customType(id));
      if (!spec) return fail(`no library part "${id}".`);
      if (spec.builtin) return fail(`"${id}" is a built-in part and cannot be removed.`);
      if (ws.doc.parts.some((p) => p.type === customType(id) && isCustomType(p.type))) return fail(`"${id}" is placed in the schematic; delete those parts first.`);
      removeUserPart(id);
      ws.onLibraryChanged();
      return `Removed the library part "${id}".`;
    }
    case 'pcb_autoroute': {
      const { x, pcb, pads } = pcbState(ws);
      if (pcb.fps.length === 0) return fail('the PCB has no footprints yet; run pcb_update first.');
      const widths = netWidths(ws.doc, x, pcb, padNets(ws.doc, x));
      const r = autoroute(pcb, pads, { netWidths: widths, ...(pcb.sides === 1 ? { onlyLayer: 'bottom' as const } : {}) });
      const used = [...r.tracks.map((t) => t.id), ...r.vias.map((v) => v.id)].map((id) => Number(id.slice(1)));
      setPcb(ws, { ...pcb, tracks: [...pcb.tracks, ...r.tracks], vias: [...pcb.vias, ...r.vias], nextId: Math.max(pcb.nextId, ...used, 0) + 1 });
      return json({ routed: r.routed, failed: r.failed.length, failed_connections: r.failed.slice(0, 10).map((f) => `${f.net}: ${f.from} -> ${f.to}`), tracks: r.tracks.length, vias: r.vias.length });
    }
    case 'pcb_autolayout':
    case 'pcb_autoplace': {
      if (ws.doc.parts.length === 0) return fail('the schematic is empty.');
      return applyLayout(ws, name, input, autoLayout(ws.doc, pcbOf(ws), layoutOptions(name, input)));
    }
    case 'pcb_clear_routes':
      setPcb(ws, { ...pcbOf(ws), tracks: [], vias: [] });
      return 'Tracks and vias removed.';
    case 'pcb_add_pour': {
      const pcb = pcbOf(ws);
      const layer: Layer = pcb.sides === 1 ? 'bottom' : input.layer === 'top' ? 'top' : 'bottom';
      const net = String(input.net);
      const nets = new Set(padNets(ws.doc, extractNetlist(ws.doc)).values());
      if (!nets.has(net)) return fail(`no net "${net}". Nets: ${[...nets].join(', ')}.`);
      if ((pcb.pours ?? []).some((p) => p.net === net && p.layer === layer)) return 'That pour already exists.';
      setPcb(ws, { ...pcb, pours: [...(pcb.pours ?? []), { id: `p${pcb.nextId}`, layer, net }], nextId: pcb.nextId + 1 });
      return `Added a ${net} pour on the ${layer} layer.`;
    }
    case 'pcb_status': {
      const { pcb, pads } = pcbState(ws);
      const air = ratsnest(pcb, pads);
      const issues = runDrc(pcb, pads).filter((i) => i.kind !== 'unrouted');
      return json({ footprints: pcb.fps.length, sides: pcb.sides === 1 ? 1 : 2, board_mm: [pcb.board.w, pcb.board.h], open_connections: air.length, open_nets: [...new Set(air.map((w) => w.net))].slice(0, 20), tracks: pcb.tracks.length, vias: pcb.vias.length, pours: (pcb.pours ?? []).map((p) => `${p.net}/${p.layer}`), drc_issues: issues.length, drc_first: issues.slice(0, 8).map((i) => i.message) });
    }
    case 'show_view':
      ws.showView(input.view === 'pcb' ? 'pcb' : 'schematic');
      return `Showing the ${input.view === 'pcb' ? 'PCB' : 'schematic'}.`;
    default:
      return fail(`unknown tool "${name}".`);
  }
}
