// Turns a schematic document into a solver netlist by merging grid points that touch.

import type { Element, Netlist, Waveform } from '../../core/sim/solver';
import { customSpec, expandModel } from './customParts';
import { PART_DEFS, isMcu, onSegment, pinPositions, ptKey, type Doc, type Part, type Pt } from './model';

export type NetlistError = 'empty' | 'noGround';

/** A microcontroller I/O pin and the solver element that represents it. */
export interface McuPin {
  partId: string;
  pin: string;
  elementId: string;
}

export interface Extracted {
  /** Microcontroller I/O pins in the netlist, in part order. */
  mcuPins: McuPin[];
  /** First solver element of each data-defined part, which a meter reads its current from. */
  primary: Map<string, string>;
  netlist: Netlist | null;
  error: NetlistError | null;
  /** Solver node of each pin: `${partId}:${pinIndex}`. Undefined while there is an error. */
  nodeOfPin: Map<string, number>;
  /** Parts that became solver elements, by part id. */
  elementIds: Set<string>;
  /** Solver node at a grid point that lies on a pin or wire; undefined elsewhere. */
  nodeAt: (p: Pt) => number | undefined;
}

const nowhere = (): undefined => undefined;

class UnionFind {
  private parent = new Map<string, string>();
  find(k: string): string {
    if (!this.parent.has(k)) this.parent.set(k, k);
    let root = k;
    for (let p = this.parent.get(root); p !== undefined && p !== root; p = this.parent.get(root)) root = p;
    // Path compression.
    for (let cur = k; cur !== root; ) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

const num = (p: Part, k: string, fallback: number): number => {
  const v = p.params[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

function element(p: Part, a: number, b: number): Element | null {
  switch (p.type) {
    case 'R':
      return { type: 'R', id: p.id, a, b, r: Math.max(num(p, 'r', 1000), 1e-6) };
    case 'C':
      return { type: 'C', id: p.id, a, b, c: Math.max(num(p, 'c', 1e-6), 1e-18), ic: num(p, 'ic', 0) };
    case 'L':
      return { type: 'L', id: p.id, a, b, l: Math.max(num(p, 'l', 1e-3), 1e-12) };
    case 'VDC':
      return { type: 'V', id: p.id, a, b, wave: { kind: 'dc', value: num(p, 'v', 5) } };
    case 'VAC':
      return { type: 'V', id: p.id, a, b, wave: { kind: 'sin', offset: num(p, 'offset', 0), amp: num(p, 'amp', 5), freq: num(p, 'freq', 1000) } };
    case 'VPULSE': {
      const freq = Math.max(num(p, 'freq', 1000), 1e-9);
      const wave: Waveform = { kind: 'pulse', low: num(p, 'low', 0), high: num(p, 'high', 5), period: 1 / freq, duty: Math.min(Math.max(num(p, 'duty', 0.5), 0), 1) };
      return { type: 'V', id: p.id, a, b, wave };
    }
    case 'IDC':
      return { type: 'I', id: p.id, a, b, wave: { kind: 'dc', value: num(p, 'i', 0.001) } };
    case 'D':
    case 'LED':
      return { type: 'D', id: p.id, a, b, is: num(p, 'is', 1e-14), n: num(p, 'n', 1) };
    case 'SW':
      return { type: 'SW', id: p.id, a, b, closed: p.params.closed === true };
    default:
      return null;
  }
}

/** Three-terminal parts. Pins arrive in the part's own order (C,B,E / D,G,S / OUT,-,+). */
function element3(p: Part, n0: number, n1: number, n2: number): Element | null {
  switch (p.type) {
    case 'QNPN':
    case 'QPNP':
      return { type: 'Q', id: p.id, a: n0, c: n1, b: n2, npn: p.type === 'QNPN', is: num(p, 'is', 1e-14), bf: Math.max(num(p, 'bf', 100), 1e-3), br: Math.max(num(p, 'br', 1), 1e-3) };
    case 'NMOS':
    case 'PMOS':
      return { type: 'M', id: p.id, a: n0, c: n1, b: n2, nmos: p.type === 'NMOS', beta: num(p, 'beta', 0.1), vth: num(p, 'vth', 2), lambda: num(p, 'lambda', 0) };
    case 'OPAMP':
      return { type: 'OA', id: p.id, a: n0, b: n1, c: n2, gain: num(p, 'gain', 1e5), vmax: Math.max(num(p, 'vmax', 12), 1e-3) };
    default:
      return null;
  }
}

export function extractNetlist(doc: Doc): Extracted {
  const nodeOfPin = new Map<string, number>();
  const elementIds = new Set<string>();
  const mcuPins: McuPin[] = [];
  const primary = new Map<string, string>();
  if (doc.parts.length === 0) return { netlist: null, error: 'empty', nodeOfPin, elementIds, nodeAt: nowhere, mcuPins, primary };

  const uf = new UnionFind();
  const points = new Map<string, Pt>();
  const touch = (p: Pt): string => {
    const k = ptKey(p);
    points.set(k, p);
    uf.find(k);
    return k;
  };

  for (const w of doc.wires) uf.union(touch(w.a), touch(w.b));
  const pinsOf = new Map<string, Pt[]>();
  for (const part of doc.parts) {
    const pins = pinPositions(part);
    pinsOf.set(part.id, pins);
    for (const p of pins) touch(p);
  }
  // A pin or wire end that sits on the middle of another wire joins that wire.
  for (const [k, p] of points) {
    for (const w of doc.wires) if (onSegment(p, w.a, w.b)) uf.union(k, ptKey(w.a));
  }

  // Ground symbols and the GND pins of microcontroller boards all tie into node 0.
  const groundPts: Pt[] = [];
  for (const part of doc.parts) {
    if (part.type === 'GND') groundPts.push(pinsOf.get(part.id)![0]);
    else if (isMcu(part.type)) {
      const info = PART_DEFS[part.type].mcu!;
      PART_DEFS[part.type].pinNames.forEach((name, i) => {
        if (info.ground.includes(name)) groundPts.push(pinsOf.get(part.id)![i]);
      });
    }
  }
  if (groundPts.length === 0) {
    // Without ground the circuit cannot be simulated, but the connectivity is still what the PCB needs.
    const index = new Map<string, number>();
    for (const part of doc.parts) {
      pinsOf.get(part.id)!.forEach((p, i) => {
        const root = uf.find(ptKey(p));
        let n = index.get(root);
        if (n === undefined) {
          n = index.size + 1;
          index.set(root, n);
        }
        nodeOfPin.set(`${part.id}:${i}`, n);
      });
    }
    return { netlist: null, error: 'noGround', nodeOfPin, elementIds, nodeAt: nowhere, mcuPins, primary };
  }

  const nodeIndex = new Map<string, number>();
  const groundRoot = uf.find(ptKey(groundPts[0]));
  nodeIndex.set(groundRoot, 0);
  for (const g of groundPts) uf.union(ptKey(g), groundRoot);
  const root0 = uf.find(groundRoot);
  nodeIndex.clear();
  nodeIndex.set(root0, 0);
  let next = 1;
  const nodeOf = (p: Pt): number => {
    const r = uf.find(ptKey(p));
    let n = nodeIndex.get(r);
    if (n === undefined) {
      n = next++;
      nodeIndex.set(r, n);
    }
    return n;
  };

  const elements: Element[] = [];
  const poweredNets = new Set<string>();
  for (const part of doc.parts) {
    const pins = pinsOf.get(part.id)!;
    pins.forEach((p, i) => nodeOfPin.set(`${part.id}:${i}`, nodeOf(p)));
    const spec = customSpec(part.type);
    if (spec) {
      // A data-defined part: its internal circuit becomes elements, internal nets get fresh nodes.
      const pinNodes = new Map<string, number>();
      PART_DEFS[part.type].pinNames.forEach((name, i) => pinNodes.set(name, nodeOfPin.get(`${part.id}:${i}`)!));
      const inner = expandModel(spec, part.id, part.params, pinNodes, () => next++);
      elements.push(...inner);
      if (inner.length) primary.set(part.id, inner[0].id);
    } else if (isMcu(part.type)) {
      const info = PART_DEFS[part.type].mcu!;
      PART_DEFS[part.type].pinNames.forEach((name, i) => {
        const node = nodeOfPin.get(`${part.id}:${i}`)!;
        if (info.ground.includes(name) || info.passive.includes(name)) return;
        const id = `${part.id}:${name}`;
        if (name in info.supply) {
          // One source per net: a board with several pins of the same rail must not get ideal sources in parallel.
          const key = `${part.id}|${node}|${info.supply[name]}`;
          if (poweredNets.has(key)) return;
          poweredNets.add(key);
          elements.push({ type: 'V', id: `${id}@${i}`, a: node, b: 0, wave: { kind: 'dc', value: info.supply[name] } });
        } else {
          elements.push({ type: 'PIN', id, a: node, b: 0, v: 0, g: 0 });
          mcuPins.push({ partId: part.id, pin: name, elementId: id });
        }
      });
    } else if (pins.length === 2) {
      const e = element(part, nodeOfPin.get(`${part.id}:0`)!, nodeOfPin.get(`${part.id}:1`)!);
      if (e) {
        elements.push(e);
        elementIds.add(part.id);
      }
    } else if (pins.length === 3) {
      const e = element3(part, nodeOfPin.get(`${part.id}:0`)!, nodeOfPin.get(`${part.id}:1`)!, nodeOfPin.get(`${part.id}:2`)!);
      if (e) {
        elements.push(e);
        elementIds.add(part.id);
      }
    }
  }
  const nodeAt = (p: Pt): number | undefined => {
    const onWire = doc.wires.find((w) => onSegment(p, w.a, w.b));
    if (onWire) return nodeOf(onWire.a);
    return points.has(ptKey(p)) ? nodeOf(p) : undefined;
  };
  return { netlist: { nodeCount: next, elements }, error: null, nodeOfPin, elementIds, nodeAt, mcuPins, primary };
}
