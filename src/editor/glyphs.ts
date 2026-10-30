// Pin layouts of the drawn symbols that data-defined parts can pick with `"symbol": { "kind": "glyph", "glyph": "..." }`.
// The drawing of each glyph is in symbols.tsx; the pins (grid units, rotation 0) and their default names are here.

import type { Pt } from './model';

export interface GlyphPins {
  pins: Pt[];
  names: string[];
  /** Hit-test box in grid units when the drawing reaches further than the pins do (an antenna rod). */
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

const two = (a: string, b: string): GlyphPins => ({ pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], names: [a, b] });
const vertical = (a: string, b: string): GlyphPins => ({ pins: [{ x: 0, y: -2 }, { x: 0, y: 2 }], names: [a, b] });
const three = (top: string, gate: string, bottom: string): GlyphPins => ({ pins: [{ x: 2, y: -2 }, { x: -2, y: 0 }, { x: 2, y: 2 }], names: [top, gate, bottom] });

export const GLYPHS: Record<string, GlyphPins> = {
  scr: three('A', 'G', 'K'),
  triac: three('MT2', 'G', 'MT1'),
  diac: two('A1', 'A2'),
  transformer: { pins: [{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: -2 }, { x: 2, y: 2 }], names: ['P1', 'P2', 'S1', 'S2'] },
  // Transformers with taps: the pin names say which winding (P primary, S secondary) and which end (C centre tap).
  'transformer-pct': { pins: [{ x: -2, y: -3 }, { x: -2, y: 0 }, { x: -2, y: 3 }, { x: 2, y: -2 }, { x: 2, y: 2 }], names: ['P1', 'PC', 'P2', 'S1', 'S2'] },
  'transformer-sct': { pins: [{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: -3 }, { x: 2, y: 0 }, { x: 2, y: 3 }], names: ['P1', 'P2', 'S1', 'SC', 'S2'] },
  'transformer-ct': { pins: [{ x: -2, y: -3 }, { x: -2, y: 0 }, { x: -2, y: 3 }, { x: 2, y: -3 }, { x: 2, y: 0 }, { x: 2, y: 3 }], names: ['P1', 'PC', 'P2', 'S1', 'SC', 'S2'] },
  /** Ferrite rod antenna: the tuned winding and a small coupling winding on one rod. */
  loopstick: { pins: [{ x: -2, y: -2 }, { x: -2, y: 2 }, { x: 2, y: -2 }, { x: 2, y: 2 }], names: ['L1', 'L2', 'C1', 'C2'] },
  lamp: two('1', '2'),
  neon: two('1', '2'),
  piezo: two('+', '-'),
  mic: vertical('+', '-'),
  'cap-var': two('1', '2'),
  'cap-trim': two('1', '2'),
  varicap: two('A', 'K'),
  antenna: { pins: [{ x: 0, y: 2 }], names: ['ANT'], bbox: { x0: -1, y0: -3, x1: 1, y1: 2.9 } },
  pushbutton: two('1', '2'),
  spdt: { pins: [{ x: -2, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 }], names: ['COM', 'NO', 'NC'] },
  pot: { pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 0, y: -2 }], names: ['A', 'B', 'W'] },
  ldr: two('1', '2'),
  ntc: two('1', '2'),
  ptc: two('1', '2'),
  varistor: two('1', '2'),
  fuse: two('1', '2'),
  'cap-polar': two('+', '-'),
  cell: vertical('+', '-'),
  zener: two('A', 'K'),
  schottky: two('A', 'K'),
  speaker: { pins: [{ x: -2, y: -1 }, { x: -2, y: 1 }], names: ['+', '-'] },
  motor: vertical('A', 'B'),
  fan: vertical('+', '-'),
  'ind-core': two('1', '2'),
};
