// Why a part is on or off while the circuit runs: the state of one part, read from the simulation result, and a short
// explanation for the person looking at it. Nothing here changes the circuit.

import type { Solution } from '../../core/sim/solver';
import type { Key } from '../i18n';
import { NO_CURRENT } from './flow';
import { PART_DEFS, type Doc, type Part } from './model';
import { motionOf } from './motion';
import type { Extracted } from './netlist';
import { eng } from './units';

export interface PartState {
  /** On / off in the sense that fits the part (a switch closed, a lamp lit, a relay pulled in); null when that has no meaning. */
  on: boolean | null;
  /** Voltage from pin 0 to pin 1 of the part. */
  volts: number | null;
  /** Current from pin 0 to pin 1, in amps. */
  amps: number | null;
}

export interface Line {
  key: Key;
  vars?: Record<string, string | number>;
}

export interface Explain extends PartState {
  /** The sentences that say why, most important first. */
  lines: Line[];
  /** A click flips this part. */
  clickable: boolean;
}

/** An LED conducts visibly above this current (the same limit the glow on the sheet starts at). */
const LED_ON = 2e-5;
/** A part that carries more than this is counted as conducting. */
const CONDUCTS = 1e-6;

export const isSwitchPart = (p: Part): boolean => p.type === 'SW' || (PART_DEFS[p.type]?.params.some((q) => q.name === 'closed' && q.kind === 'bool') ?? false);
const isLed = (p: Part): boolean => p.type === 'LED' || p.type.startsWith('x:led');

export function partState(p: Part, s: Solution, x: Extracted): PartState {
  const na = x.nodeOfPin.get(`${p.id}:0`);
  const nb = x.nodeOfPin.get(`${p.id}:1`);
  const volts = na === undefined || nb === undefined ? null : s.v[na] - s.v[nb];
  const id = x.primary.get(p.id) ?? (x.elementIds.has(p.id) ? p.id : undefined);
  const amps = id === undefined ? null : (s.i[id] ?? null);
  if (isSwitchPart(p)) return { on: p.params.closed === true, volts, amps };
  const m = motionOf(p, s, x);
  if (m) return { on: m.pulled || m.spin > 0, volts, amps };
  if (isLed(p)) return { on: (amps ?? 0) > LED_ON, volts, amps };
  if (amps === null) return { on: null, volts, amps };
  return { on: Math.abs(amps) >= CONDUCTS, volts, amps };
}

/** The references of the switches that are open, which are the usual reason a part further on gets nothing. */
function openSwitches(doc: Doc, except: string): string[] {
  return doc.parts.filter((q) => q.id !== except && isSwitchPart(q) && q.params.closed !== true && q.params.momentary !== true).map((q) => q.ref);
}

export function explainPart(p: Part, doc: Doc, s: Solution, x: Extracted): Explain {
  const st = partState(p, s, x);
  const lines: Line[] = [];
  const names = PART_DEFS[p.type].pinNames;
  const v = st.volts ?? 0;
  const i = st.amps ?? 0;
  if (st.volts !== null) lines.push({ key: 'why.volts', vars: { v: eng(st.volts, 'V') } });
  if (st.amps !== null) lines.push({ key: 'why.amps', vars: { i: eng(Math.abs(i), 'A') } });

  if (isSwitchPart(p)) {
    if (p.params.closed === true) lines.push({ key: 'why.sw.closed' });
    else lines.push({ key: 'why.sw.open', vars: { v: eng(Math.abs(v), 'V') } });
  } else if (st.on === true) {
    if (st.amps !== null && Math.abs(i) >= NO_CURRENT) {
      const from = i >= 0 ? names[0] : names[1];
      const to = i >= 0 ? names[1] : names[0];
      lines.push({ key: 'why.flows', vars: { from: `${p.ref}.${from}`, to: `${p.ref}.${to}` } });
    }
  } else if (st.on === false) {
    // An open switch in the circuit is the first thing to say: the leakage past it leaves a volt or so on the parts
    // behind it, which would otherwise read as "too little voltage".
    const blockers = openSwitches(doc, p.id);
    if (blockers.length) lines.push({ key: 'why.blockers', vars: { list: blockers.join(', ') } });
    if (isLed(p) && v < -0.1) lines.push({ key: 'why.reverse', vars: { v: eng(-v, 'V') } });
    else if (Math.abs(v) < 1e-3) lines.push({ key: 'why.noVolt' });
    else if (!blockers.length && isLed(p) && v < 1.5) lines.push({ key: 'why.below', vars: { v: eng(v, 'V') } });
    else if (!blockers.length && st.amps !== null) lines.push({ key: 'why.noPath', vars: { v: eng(Math.abs(v), 'V') } });
  }
  return { ...st, lines, clickable: isSwitchPart(p) };
}
