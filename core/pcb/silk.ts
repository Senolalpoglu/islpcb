// Polarity marks for the silkscreen: a bar at the cathode end of a diode or LED, and a plus sign beside every "+" pin.
// They are returned as polylines in board coordinates, so the screen and the Gerber file draw the same thing.

import { footprintById } from './footprints';
import type { AbsPad, PcbDoc, Pt } from './types';

const PLUS_ARM = 0.7; // half the length of the plus sign, mm
const PLUS_GAP = 0.9; // from the edge of the pad to the middle of the sign, mm

export function polarityMarks(pcb: PcbDoc, pads: AbsPad[]): Pt[][] {
  const out: Pt[][] = [];
  for (const fp of pcb.fps) {
    const def = footprintById(fp.footprint);
    if (!def) continue;
    const swap = fp.rot === 90 || fp.rot === 270;
    const hw = (swap ? def.body.h : def.body.w) / 2;
    const hh = (swap ? def.body.w : def.body.h) / 2;
    for (const p of pads) {
      if (p.partId !== fp.partId) continue;
      const dx = p.x - fp.x;
      const dy = p.y - fp.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const sx = Math.sign(dx) || 1;
      const sy = Math.sign(dy) || 1;
      if (p.cathode) {
        // A bar across the body, just inside the edge that the cathode pad is on.
        if (horizontal) out.push([{ x: fp.x + sx * hw * 0.82, y: fp.y - hh * 0.85 }, { x: fp.x + sx * hw * 0.82, y: fp.y + hh * 0.85 }]);
        else out.push([{ x: fp.x - hw * 0.85, y: fp.y + sy * hh * 0.82 }, { x: fp.x + hw * 0.85, y: fp.y + sy * hh * 0.82 }]);
      }
      if (p.plus) {
        // The sign goes on the outer side of the pad, away from the middle of the part.
        const cx = horizontal ? p.x + sx * (p.w / 2 + PLUS_GAP) : p.x;
        const cy = horizontal ? p.y : p.y + sy * (p.h / 2 + PLUS_GAP);
        out.push([{ x: cx - PLUS_ARM, y: cy }, { x: cx + PLUS_ARM, y: cy }], [{ x: cx, y: cy - PLUS_ARM }, { x: cx, y: cy + PLUS_ARM }]);
      }
    }
  }
  return out;
}
