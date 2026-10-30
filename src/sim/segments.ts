// How brightly each segment of a 7-segment display is lit. A multiplexed display lights one digit at a time, many
// times a second, so the current at the instant a frame is drawn says nothing: like the eye, the meter averages the
// current of every solver step since the last frame.

import type { Solution } from '../../core/sim/solver';
import type { Doc } from '../editor/model';

/** The display parts of the library (common cathode and common anode). */
export const SEVEN_SEG_TYPES = ['x:7seg-cc', 'x:7seg-ca'];
export const isSevenSeg = (type: string): boolean => SEVEN_SEG_TYPES.includes(type);

/** Average segment current that counts as fully lit (a multiplexed digit sees about 1/6 of its peak current). */
const FULL = 1.5e-3;

/** Segments a b c d e f g dp, in the order of the part's model: the solver element of each is `${partId}.${index}`. */
export const SEGMENT_COUNT = 8;

export class SegmentMeter {
  private readonly sums = new Map<string, number[]>();
  private steps = 0;

  constructor(doc: Doc) {
    for (const p of doc.parts) if (isSevenSeg(p.type)) this.sums.set(p.id, new Array(SEGMENT_COUNT).fill(0));
  }

  get empty(): boolean {
    return this.sums.size === 0;
  }

  /** Adds the currents of one solver step. */
  add(s: Solution): void {
    if (this.empty) return;
    this.steps++;
    for (const [id, sum] of this.sums) {
      for (let k = 0; k < SEGMENT_COUNT; k++) {
        const i = s.i[`${id}.${k}`] ?? 0;
        if (i > 0) sum[k] += i;
      }
    }
  }

  /** Brightness 0..1 of each segment of each display since the last call, then starts over. */
  take(): Map<string, number[]> {
    const out = new Map<string, number[]>();
    const n = Math.max(this.steps, 1);
    for (const [id, sum] of this.sums) {
      out.set(id, sum.map((v) => Math.min(1, v / n / FULL)));
      sum.fill(0);
    }
    this.steps = 0;
    return out;
  }
}
