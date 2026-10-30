// What the wires carry while the circuit runs: the voltage on every stretch of wire and the current along it, with the
// direction. It is only read from the simulation result, nothing here changes the circuit or the solver.

import type { Solution } from '../../core/sim/solver';
import { PART_DEFS, isMcu, onSegment, pinPositions, ptKey, type Doc, type Pt } from './model';
import type { Extracted } from './netlist';

/** One stretch of wire between two neighbouring points (pins, ends, junctions). */
export interface FlowSeg {
  wireId: string;
  a: Pt;
  b: Pt;
  /** Voltage of the net the stretch belongs to, against ground. */
  volts: number;
  /** Solver node of the net; 0 is ground. */
  node: number | undefined;
  /** Conventional current from a to b in amps: positive flows a -> b, negative b -> a. `null` when it cannot be told. */
  amps: number | null;
}

export interface Flow {
  segs: FlowSeg[];
  /** Largest voltage magnitude in the circuit, the scale for the colours. */
  vmax: number;
  /** The voltages the sources hold their terminals at (and 0 V): a wire at one of them is live even when no current flows. */
  rails: number[];
}

/** Currents below this (0.1 uA) are the leak of an open switch or rounding noise of the solver, not a flow. */
export const NO_CURRENT = 1e-7;

/**
 * Current that each pin of a part pushes into the wire net it is connected to, in amps (positive = into the wire).
 * `null` for a pin whose current is not known (a microcontroller ground, the inside of a data-defined part).
 */
function pinInjections(doc: Doc, s: Solution, x: Extracted): Map<string, number | null> {
  const inj = new Map<string, number | null>();
  for (const part of doc.parts) {
    const pins = pinPositions(part);
    const set = (i: number, v: number | null) => inj.set(`${part.id}:${i}`, v);
    if (part.type === 'GND') {
      pins.forEach((_, i) => set(i, null));
    } else if (isMcu(part.type)) {
      PART_DEFS[part.type].pinNames.forEach((name, i) => {
        const direct = s.i[`${part.id}:${name}`];
        if (direct !== undefined) return set(i, -direct);
        const supply = s.i[`${part.id}:${name}@${i}`];
        set(i, supply === undefined ? null : -supply);
      });
    } else if (x.elementIds.has(part.id)) {
      const term = s.terminals[part.id];
      if (pins.length === 2) {
        const i = s.i[part.id];
        if (i === undefined) pins.forEach((_, k) => set(k, null));
        else {
          set(0, -i);
          set(1, i);
        }
      } else pins.forEach((_, k) => set(k, term ? -(term[k] ?? 0) : null));
    } else {
      const id = x.primary.get(part.id);
      const i = id === undefined ? undefined : s.i[id];
      if (pins.length === 2 && i !== undefined) {
        set(0, -i);
        set(1, i);
      } else pins.forEach((_, k) => set(k, null));
    }
  }
  return inj;
}

/** Splits every wire at the points that lie on it, so a branch leaves from the right place. */
function splitWires(doc: Doc): { wireId: string; a: Pt; b: Pt }[] {
  const points = new Map<string, Pt>();
  for (const w of doc.wires) {
    points.set(ptKey(w.a), w.a);
    points.set(ptKey(w.b), w.b);
  }
  for (const part of doc.parts) for (const p of pinPositions(part)) points.set(ptKey(p), p);
  const out: { wireId: string; a: Pt; b: Pt }[] = [];
  for (const w of doc.wires) {
    if (w.a.x === w.b.x && w.a.y === w.b.y) continue;
    const vertical = w.a.x === w.b.x;
    // Distance from the a end along the wire, so the points can be put in order.
    const along = (p: Pt): number => (vertical ? (p.y - w.a.y) * Math.sign(w.b.y - w.a.y) : (p.x - w.a.x) * Math.sign(w.b.x - w.a.x));
    const on = [...points.values()].filter((p) => onSegment(p, w.a, w.b)).sort((p, q) => along(p) - along(q));
    for (let i = 1; i < on.length; i++) out.push({ wireId: w.id, a: on[i - 1], b: on[i] });
  }
  return out;
}

export function computeFlow(doc: Doc, s: Solution, x: Extracted): Flow {
  const raw = splitWires(doc);
  const inj = pinInjections(doc, s, x);

  // The wire network: points are vertices, stretches are edges. Wires that touch form one cluster.
  const adj = new Map<string, { to: string; seg: number }[]>();
  raw.forEach((e, k) => {
    const ka = ptKey(e.a);
    const kb = ptKey(e.b);
    (adj.get(ka) ?? adj.set(ka, []).get(ka)!).push({ to: kb, seg: k });
    (adj.get(kb) ?? adj.set(kb, []).get(kb)!).push({ to: ka, seg: k });
  });

  // What flows into each vertex from the parts whose pins sit on it.
  const known = new Map<string, number>();
  const unknown = new Set<string>();
  for (const part of doc.parts) {
    pinPositions(part).forEach((p, i) => {
      const k = ptKey(p);
      if (!adj.has(k)) return;
      const v = inj.get(`${part.id}:${i}`);
      if (v === null || v === undefined) unknown.add(k);
      else known.set(k, (known.get(k) ?? 0) + v);
    });
  }

  const amps: (number | null)[] = raw.map(() => null);
  const seen = new Set<string>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    // Spanning tree of the cluster by depth-first search; `order` lists parents before their children.
    const order: string[] = [];
    const parent = new Map<string, { from: string; seg: number }>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const u = stack.pop()!;
      order.push(u);
      for (const { to, seg } of adj.get(u)!) {
        if (seen.has(to)) continue;
        seen.add(to);
        parent.set(to, { from: u, seg });
        stack.push(to);
      }
    }
    const open = order.filter((k) => unknown.has(k));
    // One unknown pin takes whatever the others leave over; with more of them the split is not known.
    if (open.length > 1) continue;
    const rest = order.reduce((sum, k) => sum + (known.get(k) ?? 0), 0);
    const net = new Map<string, number>();
    for (const k of order) net.set(k, (known.get(k) ?? 0) + (open[0] === k ? -rest : 0));
    // Leaves first: the current that leaves a subtree towards its parent is what the subtree took in.
    for (let n = order.length - 1; n > 0; n--) {
      const k = order[n];
      const p = parent.get(k)!;
      const out = net.get(k) ?? 0;
      net.set(p.from, (net.get(p.from) ?? 0) + out);
      // `out` flows from k to its parent; measured a -> b it is positive when k is the a end.
      amps[p.seg] = ptKey(raw[p.seg].a) === k ? out : -out;
    }
    // Stretches that only close a loop of plain wire carry nothing that can be told.
    for (const k of order) for (const { seg } of adj.get(k)!) if (amps[seg] === null) amps[seg] = 0;
  }

  const segs: FlowSeg[] = raw.map((e, k) => {
    const node = x.nodeAt(e.a);
    return { wireId: e.wireId, a: e.a, b: e.b, volts: node === undefined ? 0 : s.v[node] ?? 0, node, amps: amps[k] };
  });
  let vmax = 0;
  for (const g of segs) vmax = Math.max(vmax, Math.abs(g.volts));
  const rails = [0];
  for (const e of x.netlist?.elements ?? []) if (e.type === 'V') rails.push(s.v[e.a] ?? 0, s.v[e.b] ?? 0);
  return { segs, vmax: Math.max(vmax, 1e-3), rails };
}

/**
 * Colour of a wire at a voltage: ground is blue, the highest positive voltage is red, with cyan, green, yellow and
 * orange between; negative voltages run towards purple. Returns an `hsl()` string that works on dark and light sheets.
 */
export function voltColor(volts: number, vmax: number): string {
  const t = Math.max(-1, Math.min(1, volts / vmax));
  if (Math.abs(volts) < vmax * 0.004) return 'hsl(215 55% 52%)';
  const hue = t >= 0 ? 215 * (1 - t) : 215 + 85 * -t;
  return `hsl(${hue.toFixed(0)} 85% ${t >= 0 ? 50 : 58}%)`;
}

/** Red for a live wire, blue for the 0 V (ground) side; `null` for a wire that is not powered, which keeps the sheet's own wire colour. */
export type WireState = 'live' | 'zero' | null;

/** A wire counts as live within this fraction of the highest voltage of a source rail (and never closer than 50 mV). */
const LIVE_FRACTION = 0.02;

/**
 * A wire that carries a current is live. One that carries none is live only while it sits at a voltage a source holds:
 * the rail in front of an open switch. Behind the open switch the net just floats at whatever the leakage of the
 * switch and the parts after it make of it (a volt or so), and that is not live.
 */
export function wireState(g: FlowSeg, vmax: number, rails: number[]): WireState {
  if (g.node === 0) return 'zero';
  const tol = Math.max(0.05, vmax * LIVE_FRACTION);
  if (Math.abs(g.volts) < tol) return null;
  if (g.amps !== null && Math.abs(g.amps) >= NO_CURRENT) return 'live';
  return rails.some((r) => Math.abs(g.volts - r) <= tol) ? 'live' : null;
}

/** How fast the dashes move for a current, in a handful of steps so the animation does not jitter with every frame. */
export function flowSpeed(amps: number): number {
  const a = Math.abs(amps);
  if (a < NO_CURRENT) return 0;
  // Decades from 1 uA to 1 A map to levels 1..6.
  return Math.max(1, Math.min(6, Math.round(Math.log10(a / 1e-6) + 1)));
}
