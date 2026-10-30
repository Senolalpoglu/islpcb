// What a part that moves is doing at the moment: how fast a fan, motor or turbine turns, and whether a relay's
// armature or a valve is pulled in. It follows from the simulation result and the part's "visual" entry
// (see CustomPartSpec.visual), so the schematic can animate it.

import type { Solution } from '../../core/sim/solver';
import { PART_DEFS, type Part } from './model';
import type { Extracted } from './netlist';

export interface Motion {
  /** Revolutions per second to show; 0 when it stands still. */
  spin: number;
  pulled: boolean;
}

/** The largest speed shown for a fan or motor at (a little over) its rated voltage, in turns per second. */
const FULL_SPEED = 3;

/** How bright each lamp is being drawn, per part id: a filament does not follow a 50 Hz wave, so the brightness is smoothed. */
const glow = new Map<string, number>();

/**
 * A lamp: `spin` carries the brightness (0-1) and `pulled` says it is lit. With a `threshold` (a neon lamp strikes at a
 * fixed voltage) it is simply on or off; without one the brightness follows the power, (V / rated)^2.
 */
function lampGlow(id: string, volts: number, rated: number, threshold: number): Motion {
  const u = Math.abs(volts);
  const target = threshold > 0 ? (u >= threshold ? 1 : 0) : Math.min(1, (u / rated) ** 2);
  const now = (glow.get(id) ?? 0) + (target - (glow.get(id) ?? 0)) * 0.2;
  glow.set(id, now);
  return { spin: now, pulled: now > 0.04 };
}

export function motionOf(p: Part, s: Solution, x: Extracted): Motion | null {
  const visual = PART_DEFS[p.type]?.custom?.visual;
  if (!visual) return null;
  const [ia, ib] = visual.pins ?? [0, 1];
  const na = x.nodeOfPin.get(`${p.id}:${ia}`);
  const nb = x.nodeOfPin.get(`${p.id}:${ib}`);
  if (na === undefined || nb === undefined) return { spin: 0, pulled: false };
  const volts = s.v[na] - s.v[nb];
  /** A number, or the value of a parameter of the part. */
  const value = (v: number | string | undefined, fallback: number): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(p.params[v]) || fallback : fallback);
  if (visual.kind === 'relay' || visual.kind === 'valve') {
    const threshold = value(visual.threshold, visual.kind === 'relay' ? 3.5 : 0.5 * value(visual.rated, 12));
    return { spin: 0, pulled: Math.abs(volts) >= threshold };
  }
  if (visual.kind === 'lamp') return lampGlow(p.id, volts, value(visual.rated, 12), value(visual.threshold, 0));
  if (visual.kind === 'turbine') {
    const flow = Number(p.params[visual.speed ?? 'flow']) || 0;
    const powered = Math.abs(volts) >= value(visual.threshold, 3);
    return { spin: powered ? Math.min(8, flow * 0.5) : 0, pulled: powered };
  }
  // Fan or motor: stands still below a fifth of its rated voltage, then speeds up with the voltage.
  const u = Math.abs(volts) / value(visual.rated, 12);
  return { spin: u < 0.2 ? 0 : Math.min(1.3, (u - 0.1) / 0.9) * FULL_SPEED, pulled: false };
}
