// Operating limits: compares what the simulation says about each part (voltage across its pins, current through them,
// the heat it turns the power into) with what the part is rated for, and reports the parts that go beyond. The schematic
// puts an exclamation mark next to each of them. Ratings come from the part's data (`ratings`) or, for the parts built
// into the program, from the table below.

import type { Element, Solution } from '../../core/sim/solver';
import { customSpec, type Ratings } from './customParts';
import { evalExpression } from './expr';
import { PART_DEFS, isMcu, type Doc, type Part } from './model';
import type { Extracted } from './netlist';

export type IssueKind = 'overvoltage' | 'polarity' | 'overcurrent' | 'overpower';

export interface Issue {
  partId: string;
  kind: IssueKind;
  /** The worst value seen (volts, amperes or watts, with its sign for a voltage). */
  value: number;
  /** The limit that was crossed. */
  limit: number;
  /** For a voltage: the two pins it is measured between. For a current: the pin. */
  a?: string;
  b?: string;
}

const num = (p: Part, k: string, fallback: number): number => {
  const v = p.params[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** The pins of a microcontroller board that are signals (not supply, ground or unused). */
const signalPins = (type: string): string[] => {
  const info = PART_DEFS[type].mcu!;
  return PART_DEFS[type].pinNames.filter((n) => !(n in info.supply) && !info.ground.includes(n) && !info.passive.includes(n));
};

/** What a board's pins can take: (maximum voltage, maximum current) by engine. */
const MCU_PIN_LIMITS: Record<string, [number, number]> = {
  avr328: [5.5, 0.04],
  avr2560: [5.5, 0.04],
  rp2040: [3.6, 0.025],
  pic16f84a: [5.5, 0.025],
  pic16f628a: [5.5, 0.025],
  pic16f877a: [5.5, 0.025],
};

/** The limits of the parts built into the program; library parts carry their own in `ratings`. */
function builtinRatings(p: Part): Ratings | undefined {
  switch (p.type) {
    case 'R':
      return { p: num(p, 'prated', 0.25) };
    case 'C': {
      const v = num(p, 'vrated', 50);
      return { v: [{ a: '1', b: '2', max: v, min: -v }] };
    }
    case 'LED':
      return { v: [{ a: 'A', b: 'K', min: -5, polar: 'min' }], i: [{ pin: 'A', max: 0.03 }] };
    case 'D':
      return { v: [{ a: 'A', b: 'K', min: -100 }], i: [{ pin: 'A', max: 1 }] };
    case 'QNPN':
      return { v: [{ a: 'C', b: 'E', max: 60 }, { a: 'B', b: 'E', min: -6 }], i: [{ pin: 'C', max: 0.5 }], p: 0.6 };
    case 'QPNP':
      return { v: [{ a: 'E', b: 'C', max: 60 }, { a: 'E', b: 'B', min: -6 }], i: [{ pin: 'C', max: 0.5 }], p: 0.6 };
    case 'NMOS':
      return { v: [{ a: 'D', b: 'S', max: 60 }, { a: 'G', b: 'S', max: 20, min: -20 }], i: [{ pin: 'D', max: 2 }], p: 1 };
    case 'PMOS':
      return { v: [{ a: 'S', b: 'D', max: 60 }, { a: 'S', b: 'G', max: 20, min: -20 }], i: [{ pin: 'D', max: 2 }], p: 1 };
    default:
      break;
  }
  const mcu = PART_DEFS[p.type]?.mcu;
  if (mcu) {
    const [vmax, imax] = MCU_PIN_LIMITS[mcu.engine] ?? [5.5, 0.025];
    const pins = signalPins(p.type);
    return { v: pins.map((a) => ({ a, b: '0', max: vmax, min: -0.5 })), i: pins.map((pin) => ({ pin, max: imax })) };
  }
  return undefined;
}

export const ratingsOf = (p: Part): Ratings | undefined => customSpec(p.type)?.ratings ?? builtinRatings(p);

/** A limit written as a number or as an expression over the part's parameters. */
function limit(v: number | string | undefined, p: Part): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'number') return v;
  const env: Record<string, number> = {};
  for (const d of PART_DEFS[p.type].params) env[d.name] = num(p, d.name, typeof d.default === 'number' ? d.default : 0);
  try {
    return evalExpression(v, env);
  } catch {
    return undefined;
  }
}

/** Solver elements by the part that owns them (data-defined parts expand into several). */
function elementsByPart(extracted: Extracted): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  for (const e of extracted.netlist?.elements ?? []) {
    const dot = e.id.indexOf('.');
    if (dot < 0) continue;
    const id = e.id.slice(0, dot);
    const list = out.get(id);
    if (list) list.push(e);
    else out.set(id, [e]);
  }
  return out;
}

/** Current flowing into the part at one pin, in amperes (positive into the part). */
function pinCurrent(part: Part, pin: string, s: Solution, x: Extracted, byPart: Map<string, Element[]>): number {
  const names = PART_DEFS[part.type].pinNames;
  const index = names.indexOf(pin);
  if (index < 0) return 0;
  if (isMcu(part.type)) {
    const i = s.i[`${part.id}:${pin}`];
    return i === undefined ? 0 : i;
  }
  if (!customSpec(part.type)) {
    const t = s.terminals[part.id];
    if (t) return t[index] ?? 0;
    const i = s.i[part.id];
    if (i === undefined) return 0;
    return index === 0 ? i : index === 1 ? -i : 0;
  }
  const node = x.nodeOfPin.get(`${part.id}:${index}`);
  if (node === undefined || node === 0) return 0; // a pin on ground: what flows there is the sum of the others
  let sum = 0;
  for (const e of byPart.get(part.id) ?? []) {
    const t = s.terminals[e.id];
    if (t && (e.type === 'Q' || e.type === 'M')) {
      // terminals: Q [collector, base, emitter] = [a, c, b]; M [drain, gate, source] = [a, c, b]
      if (e.a === node) sum += t[0];
      if (e.c === node) sum += t[1];
      if (e.b === node) sum += t[2];
    } else if (t && e.type === 'OA') {
      if (e.a === node) sum += t[0];
      if (e.b === node) sum += t[1];
      if (e.c === node) sum += t[2];
    } else {
      const i = s.i[e.id] ?? 0;
      if (e.a === node) sum += i;
      if (e.b === node) sum -= i;
    }
  }
  return sum;
}

/** Power the part turns into heat right now, in watts. */
function partPower(part: Part, s: Solution, byPart: Map<string, Element[]>): number {
  if (isMcu(part.type)) return 0;
  if (!customSpec(part.type)) return s.p[part.id] ?? 0;
  let sum = 0;
  for (const e of byPart.get(part.id) ?? []) sum += s.p[e.id] ?? 0;
  return Math.max(sum, 0);
}

interface Hit {
  frames: number;
  issue: Issue;
}

/** Frames a limit has to be crossed in before it is reported, so that the first instant of a switch-on does not count. */
const FRAMES_TO_REPORT = 3;
/** How fast the average power follows the instantaneous one, per frame. */
const POWER_AVERAGE = 0.08;

/**
 * Watches a running simulation. Call `update` with every new solution: the parts that stayed beyond a limit are kept,
 * with the worst value seen, until the simulation is restarted.
 */
export class LimitTracker {
  private hits = new Map<string, Hit>();
  private power = new Map<string, number>();
  private netlist: unknown = null;
  private time = -1;
  private cache: Issue[] = [];

  reset(): void {
    this.hits.clear();
    this.power.clear();
    this.time = -1;
    this.cache = [];
  }

  update(doc: Doc, x: Extracted, s: Solution | null): Issue[] {
    if (!s || !x.netlist) {
      this.reset();
      this.netlist = null;
      return this.cache;
    }
    if (x.netlist !== this.netlist || s.time < this.time) {
      this.reset();
      this.netlist = x.netlist;
    }
    if (s.time === this.time) return this.cache;
    // An operating point (time 0) is one answer, not a stream of them: report it straight away.
    const need = s.time === 0 ? 1 : FRAMES_TO_REPORT;
    this.time = s.time;
    const byPart = elementsByPart(x);
    const note = (key: string, issue: Issue): void => {
      const hit = this.hits.get(key);
      if (!hit) this.hits.set(key, { frames: 1, issue });
      else {
        hit.frames++;
        if (Math.abs(issue.value) > Math.abs(hit.issue.value)) hit.issue = issue;
      }
    };
    for (const part of doc.parts) {
      const r = ratingsOf(part);
      if (!r) continue;
      const names = PART_DEFS[part.type].pinNames;
      const volts = (pin: string): number | undefined => {
        if (pin === '0') return 0;
        const at = names.indexOf(pin);
        const node = at < 0 ? undefined : x.nodeOfPin.get(`${part.id}:${at}`);
        return node === undefined ? undefined : s.v[node];
      };
      (r.v ?? []).forEach((rule, k) => {
        const va = volts(rule.a);
        const vb = volts(rule.b);
        if (va === undefined || vb === undefined) return;
        const v = va - vb;
        const max = limit(rule.max, part);
        const min = limit(rule.min, part);
        const key = `${part.id}|v${k}`;
        if (max !== undefined && v > max) note(key, { partId: part.id, kind: rule.polar === 'max' ? 'polarity' : 'overvoltage', value: v, limit: max, a: rule.a, b: rule.b });
        else if (min !== undefined && v < min) note(key, { partId: part.id, kind: rule.polar === 'min' ? 'polarity' : 'overvoltage', value: v, limit: min, a: rule.a, b: rule.b });
      });
      (r.i ?? []).forEach((rule, k) => {
        const max = limit(rule.max, part);
        if (max === undefined) return;
        const i = Math.abs(pinCurrent(part, rule.pin, s, x, byPart));
        if (i > max) note(`${part.id}|i${k}`, { partId: part.id, kind: 'overcurrent', value: i, limit: max, a: rule.pin });
      });
      const pmax = limit(r.p, part);
      if (pmax !== undefined) {
        const now = partPower(part, s, byPart);
        const avg = (this.power.get(part.id) ?? now) * (1 - POWER_AVERAGE) + now * POWER_AVERAGE;
        this.power.set(part.id, avg);
        if (avg > pmax) note(`${part.id}|p`, { partId: part.id, kind: 'overpower', value: avg, limit: pmax });
      }
    }
    this.cache = [...this.hits.values()].filter((h) => h.frames >= need).map((h) => h.issue);
    return this.cache;
  }
}
