// How brightly each segment of a 7-segment display is lit. A multiplexed display lights one digit at a time, many
// times a second, so the current at the instant a frame is drawn says nothing: like the eye, the meter averages the
// current of every solver step since the last frame.

import type { Solution } from '../../core/sim/solver';
import type { Doc } from '../editor/model';

/** The display parts of the library and how many digits each has (single digits, common cathode and anode, and the six-digit module). */
const DIGITS: Record<string, number> = { 'x:7seg-cc': 1, 'x:7seg-ca': 1, 'x:7seg-6digit-cc': 6 };
export const isSevenSeg = (type: string): boolean => type in DIGITS;
export const digitsOf = (type: string): number => DIGITS[type] ?? 1;

/** Average segment current that counts as fully lit (a multiplexed digit sees about 1/6 of its peak current). */
const FULL = 1.5e-3;

/** Segments a b c d e f g dp of one digit, in the order of the part's model; a part with several digits lists them one after the other. */
export const SEGMENT_COUNT = 8;

export class SegmentMeter {
  /** Per display the summed currents, `SEGMENT_COUNT` per digit: the solver element of entry `k` is `${partId}.${k}`. */
  private readonly sums = new Map<string, number[]>();
  private steps = 0;

  constructor(doc: Doc) {
    for (const p of doc.parts) if (isSevenSeg(p.type)) this.sums.set(p.id, new Array(SEGMENT_COUNT * digitsOf(p.type)).fill(0));
  }

  get empty(): boolean {
    return this.sums.size === 0;
  }

  /** Adds the currents of one solver step. */
  add(s: Solution): void {
    if (this.empty) return;
    this.steps++;
    for (const [id, sum] of this.sums) {
      for (let k = 0; k < sum.length; k++) {
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
