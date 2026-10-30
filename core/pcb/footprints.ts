// Footprint library. Dimensions follow the usual through-hole and SMD conventions.

import { DEV_BOARD_FOOTPRINTS } from './devboards';
import { MODULE_FOOTPRINTS } from './modules';
import type { AbsPad, FootprintDef, FootprintInst, PadDef, PadShape, Pt, Rot } from './types';

const round = (name: string, x: number, y: number, dia: number, drill: number, pin: number | null, shape: PadShape = 'round'): PadDef => ({
  name, x, y, shape, w: dia, h: dia, drill, pin,
});
const smd = (name: string, x: number, y: number, w: number, h: number, pin: number | null): PadDef => ({ name, x, y, shape: 'rect', w, h, drill: 0, pin });

function axial(pitch: number): FootprintDef {
  return {
    id: `AXIAL_${pitch}`,
    label: `Axial ${pitch} mm`,
    pads: [round('1', -pitch / 2, 0, 1.8, 0.8, 0, 'rect'), round('2', pitch / 2, 0, 1.8, 0.8, 1)],
    body: { w: Math.max(pitch - 3, 3), h: 2.6 },
  };
}

function radial(pitch: number): FootprintDef {
  return {
    id: `CAP_RADIAL_${pitch}`,
    label: `Capacitor radial ${pitch} mm`,
    pads: [round('1', -pitch / 2, 0, 1.8, 0.8, 0, 'rect'), round('2', pitch / 2, 0, 1.8, 0.8, 1)],
    body: { w: pitch + 1.5, h: pitch + 1.5 },
  };
}

/**
 * Radial aluminium electrolytic of a given can diameter and lead spacing (the usual pairs: 5 mm / 2, 6.3 / 2.5,
 * 8 / 3.5, 10 / 5, 12.5 / 5, 16 / 7.5). The first pad (square) is the "+" lead; the body is drawn at the can's size.
 */
function elco(dia: number, pitch: number): FootprintDef {
  const pad = pitch < 2.5 ? 1.5 : pitch < 5 ? 1.8 : 2.0;
  const drill = dia <= 10 ? 0.8 : 1.0;
  return {
    id: `CAP_RADIAL_D${dia}_P${pitch}`,
    label: `Electrolytic Ø${dia} mm, leads ${pitch} mm`,
    pads: [round('+', -pitch / 2, 0, pad, drill, 0, 'rect'), round('-', pitch / 2, 0, pad, drill, 1)],
    body: { w: dia, h: dia },
  };
}

function smdTwo(id: string, label: string, centre: number, w: number, h: number): FootprintDef {
  return { id, label, pads: [smd('1', -centre, 0, w, h, 0), smd('2', centre, 0, w, h, 1)], body: { w: centre * 2 + w, h: h + 0.2 } };
}

/**
 * A two-row part: pads are listed in schematic-symbol order, left column first (top to bottom) and then the
 * right column (top to bottom). `labels` gives each pad its printed name.
 */
function twoRow(id: string, label: string, left: number, right: number, rowSpacing: number, labels: string[], dia = 1.7, drill = 0.9): FootprintDef {
  const pads: PadDef[] = [];
  const rows = Math.max(left, right);
  const y0 = (-(rows - 1) / 2) * 2.54;
  for (let i = 0; i < left; i++) pads.push(round(labels[i] ?? String(i + 1), -rowSpacing / 2, y0 + i * 2.54, dia, drill, i, i === 0 ? 'rect' : 'oval'));
  for (let j = 0; j < right; j++) pads.push(round(labels[left + j] ?? String(left + j + 1), rowSpacing / 2, y0 + j * 2.54, dia, drill, left + j, 'oval'));
  for (const p of pads) if (p.shape === 'oval') p.h = p.w * 1.2;
  return { id, label, pads, body: { w: rowSpacing - 1.5, h: rows * 2.54 } };
}

/** Standard DIP-n: physical pin numbers run down the left and back up the right. */
function dip(n: number, rowSpacing: number): FootprintDef {
  const half = n / 2;
  const labels = [...Array.from({ length: half }, (_, i) => String(i + 1)), ...Array.from({ length: half }, (_, j) => String(n - j))];
  return twoRow(`DIP${n}`, `DIP-${n} (${rowSpacing} mm)`, half, half, rowSpacing, labels);
}

const to92 = (id: string, label: string, pinOfPad: [number, number, number], names: [string, string, string]): FootprintDef => ({
  id,
  label,
  pads: [round(names[0], -2.54, 0, 1.6, 0.8, pinOfPad[0], 'oval'), round(names[1], 0, 0, 1.6, 0.8, pinOfPad[1], 'oval'), round(names[2], 2.54, 0, 1.6, 0.8, pinOfPad[2], 'oval')].map((p) => ({ ...p, h: 2.0 })),
  body: { w: 5.2, h: 4.2 },
});

/** Plain through-hole pad of a package, wired to its schematic pin later (see wireFootprint). */
const through = (name: string, x: number, y: number, dia: number, drill: number, first = false): PadDef => ({ name, x, y, shape: first ? 'rect' : 'oval', w: dia, h: dia * 1.15, drill, pin: null });

/** Three in-line leads: TO-92 (2.54 mm), TO-126 (2.29 mm) and TO-220 (2.54 mm). Pads are named 1, 2, 3 as in the package drawing. */
function threeLead(id: string, label: string, pitch: number, dia: number, drill: number, body: { w: number; h: number }): FootprintDef {
  return { id, label, pads: [-1, 0, 1].map((k, i) => through(String(i + 1), k * pitch, 0, dia, drill, i === 0)), body };
}

/** SOT-223: three 1.5 x 2 mm pads at 2.3 mm pitch and the 3 x 2 mm tab opposite. */
const sot223 = (): FootprintDef => ({
  id: 'SOT223',
  label: 'SOT-223 (3 pins + tab)',
  pads: [
    ...[-2.3, 0, 2.3].map((x, i) => smd(String(i + 1), x, 3.15, 1.5, 2.0, null)),
    smd('TAB', 0, -3.15, 3.0, 2.0, null),
  ],
  body: { w: 6.5, h: 3.5 },
});

/** TO-3 metal can: base and emitter pins 10.92 mm apart, two mounting holes 30.15 mm apart; the case is the collector. */
const to3 = (): FootprintDef => ({
  id: 'TO3',
  label: 'TO-3 metal can (2 pins + mounting holes)',
  pads: [
    through('B', -5.46, 0, 2.4, 1.3, true),
    through('E', 5.46, 0, 2.4, 1.3),
    { name: 'C', x: 0, y: 15.08, shape: 'round', w: 6.5, h: 6.5, drill: 4.1, pin: null },
    { name: 'M', x: 0, y: -15.08, shape: 'round', w: 6.5, h: 6.5, drill: 4.1, pin: null },
  ],
  body: { w: 26.2, h: 39.9 },
});

/**
 * Metal-can transistors, pad positions as in the KiCad library (TO-18-3, TO-39-3): emitter, base, collector, the base
 * lead in the middle and set back. The origin is the middle of the can.
 */
const metalCan = (id: string, label: string, r: number, dia: number, can: number): FootprintDef => ({
  id,
  label,
  pads: [through('1', -r, 0, dia, 0.7, true), through('2', 0, r, dia, 0.7), through('3', r, 0, dia, 0.7)],
  body: { w: can, h: can },
});

/** SOT-23 (KiCad SOT-23): pins 1 and 2 on the left, pin 3 on the right, 1.9 mm apart across. */
const sot23 = (): FootprintDef => ({
  id: 'SOT23',
  label: 'SOT-23 (3 pins)',
  pads: [smd('1', -0.9375, -0.95, 1.475, 0.6, null), smd('2', -0.9375, 0.95, 1.475, 0.6, null), smd('3', 0.9375, 0, 1.475, 0.6, null)],
  body: { w: 3.0, h: 2.6 },
});

/** TO-247: three flat leads at 5.45 mm, 2.5 x 4.5 mm pads (KiCad TO-247-3_Vertical). */
const to247 = (): FootprintDef => ({
  id: 'TO247',
  label: 'TO-247 (1 2 3)',
  pads: [-1, 0, 1].map((k, i) => ({ name: String(i + 1), x: k * 5.45, y: 0, shape: i === 0 ? ('rect' as const) : ('oval' as const), w: 2.5, h: 4.5, drill: 1.5, pin: null })),
  body: { w: 15.9, h: 5.0 },
});

/** HC-49 crystal: two leads 4.88 mm apart. */
const hc49 = (): FootprintDef => ({
  id: 'HC49',
  label: 'Crystal HC-49 (4.88 mm)',
  pads: [through('1', -2.44, 0, 1.6, 0.8, true), through('2', 2.44, 0, 1.6, 0.8)],
  body: { w: 11, h: 4.7 },
});

/** Tunik (Molex KK type) male header of n poles at `pitch`: one row of pads, the first one square. */
function tunikHeader(n: number, pitch: number): FootprintDef {
  const wide = pitch > 3;
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * pitch, 0, wide ? 2.6 : 1.9, wide ? 1.4 : 1.1, i, i === 0 ? 'rect' : 'round'));
  const tag = wide ? '396' : '254';
  return { id: `TUNIK${tag}_${n}`, label: `Tunik header ${n} poles (${pitch} mm)`, pads, body: { w: n * pitch + 1.5, h: wide ? 8.4 : 6.2 } };
}

/** 6 x 6 mm tactile switch with 4 legs (6.5 x 4.5 mm); legs on the same side are joined inside the switch. */
const tactile = (): FootprintDef => ({
  id: 'PUSH_6MM',
  label: 'Tactile switch 6 x 6 mm',
  pads: [through('1', -3.25, -2.25, 1.8, 1.0, true), through('1b', -3.25, 2.25, 1.8, 1.0), through('2', 3.25, -2.25, 1.8, 1.0), through('2b', 3.25, 2.25, 1.8, 1.0)],
  body: { w: 6, h: 6 },
});

/**
 * Relays and small transformers differ from maker to maker: these are generic grids with the usual pin spacing.
 * Check the pin positions against the datasheet of the part you buy.
 */
/** A through-hole pad with its own size, for the relay packages below. */
const rpad = (name: string, x: number, y: number, dia: number, drill: number, first = false): PadDef => ({ name, x, y, shape: first ? 'rect' : 'round', w: dia, h: dia, drill, pin: null });

/**
 * Songle SRD-xxVDC-SL (10 A power relays, 19 x 15.5 x 15.3 mm). Holes 12.2 mm and 12 mm apart as in the maker's
 * drawing; positions to the tenth of a millimetre follow the KiCad library footprint of the same relay.
 * Pad names are the pin numbers of the package: 1 common, 2 and 5 coil, 3 normally open, 4 normally closed.
 */
const srd = (form: 'A' | 'C'): FootprintDef => ({
  id: form === 'C' ? 'RELAY_SRD_C' : 'RELAY_SRD_A',
  label: form === 'C' ? 'Relay SRD-xxVDC-SL-C (SPDT, 19 x 15.6 mm)' : 'Relay SRD-xxVDC-SL-A (SPST-NO, 19 x 15.6 mm)',
  pads: [
    rpad('1', -8.5, 0, 3, 1.3, true),
    rpad('2', -6.55, 6.05, 2.5, 1),
    rpad('3', 5.65, 6.05, 3, 1.3),
    ...(form === 'C' ? [rpad('4', 5.7, -6, 3, 1.3)] : []),
    rpad('5', -6.55, -5.95, 2.5, 1),
  ],
  body: { w: 19.8, h: 15.6 },
});

/** Omron G2RL-2 (DPDT, 8 A, 29 x 12.7 mm): pins 1-4 along one side at 0, 15, 20, 25 mm, 8-5 along the other, 7.5 mm away. */
const g2rl2 = (): FootprintDef => ({
  id: 'RELAY_G2RL_2',
  label: 'Relay Omron G2RL-2 (DPDT, 8 pins, 28.8 x 12.5 mm)',
  pads: [
    rpad('1', -12.1, 3.75, 2.5, 1.5, true),
    rpad('2', 2.9, 3.75, 2.5, 1.5),
    rpad('3', 7.9, 3.75, 2.5, 1.5),
    rpad('4', 12.9, 3.75, 2.5, 1.5),
    rpad('5', 12.9, -3.75, 2.5, 1.5),
    rpad('6', 7.9, -3.75, 2.5, 1.5),
    rpad('7', 2.9, -3.75, 2.5, 1.5),
    rpad('8', -12.1, -3.75, 2.5, 1.5),
  ],
  body: { w: 28.8, h: 12.5 },
});

const relay4 = (): FootprintDef => ({
  id: 'RELAY_4',
  label: 'Relay 4 pins (generic, 7.5 mm square)',
  pads: [through('1', -3.75, -3.75, 2.4, 1.3, true), through('2', -3.75, 3.75, 2.4, 1.3), through('3', 3.75, -3.75, 2.4, 1.3), through('4', 3.75, 3.75, 2.4, 1.3)],
  body: { w: 19, h: 15.5 },
});
const trafo4 = (): FootprintDef => ({
  id: 'TRAFO_4',
  label: 'PCB transformer 4 pins (generic, 20 x 10 mm)',
  pads: [through('P1', -10, -5, 2.2, 1.2, true), through('P2', -10, 5, 2.2, 1.2), through('S1', 10, -5, 2.2, 1.2), through('S2', 10, 5, 2.2, 1.2)],
  body: { w: 30, h: 25 },
});

const LIST: FootprintDef[] = [
  threeLead('TO92', 'TO-92 (1 2 3)', 2.54, 1.6, 0.9, { w: 5.2, h: 4.2 }),
  threeLead('TO126', 'TO-126 (1 2 3)', 2.29, 1.9, 1.0, { w: 8, h: 3.4 }),
  threeLead('TO220', 'TO-220 (1 2 3)', 2.54, 2.0, 1.1, { w: 10.2, h: 4.6 }),
  sot223(),
  to3(),
  metalCan('TO18', 'TO-18 metal can (E B C)', 1.27, 1.4, 5.3),
  metalCan('TO39', 'TO-39 metal can (E B C)', 2.54, 1.5, 9.0),
  sot23(),
  to247(),
  hc49(),
  tactile(),
  srd('C'),
  srd('A'),
  g2rl2(),
  relay4(),
  trafo4(),
  axial(22.5),
  axial(7.62),
  axial(10.16),
  axial(12.7),
  radial(2.54),
  radial(5.08),
  elco(5, 2),
  elco(6.3, 2.5),
  elco(8, 3.5),
  elco(10, 5),
  elco(12.5, 5),
  elco(16, 7.5),
  smdTwo('SMD_0603', 'SMD 0603', 0.8, 0.9, 1.0),
  smdTwo('SMD_0805', 'SMD 0805', 1.0, 1.2, 1.4),
  smdTwo('SMD_1206', 'SMD 1206', 1.5, 1.5, 1.8),
  {
    id: 'LED_5MM',
    label: 'LED 5 mm',
    pads: [round('A', -1.27, 0, 1.8, 0.9, 0, 'rect'), round('K', 1.27, 0, 1.8, 0.9, 1)],
    body: { w: 5.4, h: 5.4 },
  },
  {
    id: 'LED_3MM',
    label: 'LED 3 mm',
    pads: [round('A', -1.27, 0, 1.6, 0.8, 0, 'rect'), round('K', 1.27, 0, 1.6, 0.8, 1)],
    body: { w: 3.4, h: 3.4 },
  },
  {
    id: 'LED_10MM',
    label: 'LED 10 mm',
    pads: [round('A', -1.27, 0, 1.8, 0.9, 0, 'rect'), round('K', 1.27, 0, 1.8, 0.9, 1)],
    body: { w: 10.4, h: 10.4 },
  },
  { id: 'HDR_1X2', label: 'Pin header 1x2 (2.54 mm)', pads: [round('1', -1.27, 0, 1.8, 1.0, 0, 'rect'), round('2', 1.27, 0, 1.8, 1.0, 1)], body: { w: 5.2, h: 2.6 } },
  { id: 'TERM_5.08', label: 'Screw terminal 2-pin (5.08 mm)', pads: [round('1', -2.54, 0, 2.4, 1.3, 0, 'rect'), round('2', 2.54, 0, 2.4, 1.3, 1)], body: { w: 10.2, h: 7.5 } },
  // Transistors: the pad order of a TO-92 is E-B-C (bipolar) or S-G-D (MOSFET); symbol pins are C,B,E / D,G,S.
  to92('TO92_BJT', 'TO-92 (E B C)', [2, 1, 0], ['E', 'B', 'C']),
  to92('TO92_MOS', 'TO-92 (S G D)', [2, 1, 0], ['S', 'G', 'D']),
  dip(4, 7.62),
  dip(6, 7.62),
  // 10-pin 7-segment digit (0.56 inch): two rows of five, 15.24 mm apart; pads 1-5 left, 10-6 right.
  twoRow('SEG7', '7-segment display 10 pins (15.24 mm rows)', 5, 5, 15.24, ['1', '2', '3', '4', '5', '10', '9', '8', '7', '6']),
  dip(8, 7.62),
  dip(14, 7.62),
  dip(16, 7.62),
  dip(18, 7.62),
  dip(28, 7.62),
  dip(40, 15.24),
  twoRow('RELAY_8', 'Relay 8 pins DIL (generic, 7.62 mm rows)', 4, 4, 7.62, ['1', '2', '3', '4', '8', '7', '6', '5'], 2.0, 1.1),
  twoRow('RELAY_11', 'Relay 3PDT 11 pins (generic)', 6, 5, 10.16, ['1', '2', '3', '4', '5', '6', '11', '10', '9', '8', '7'], 2.2, 1.2),
  // Op-amp in a DIP-8 (741 pinout): OUT = 6, IN- = 2, IN+ = 3. The supply pins are not modelled in the schematic.
  (() => {
    const d = dip(8, 7.62);
    const pinOf: Record<string, number> = { '6': 0, '2': 1, '3': 2 };
    return { ...d, id: 'OPAMP_DIP8', label: 'Op-amp DIP-8', pads: d.pads.map((p) => ({ ...p, pin: pinOf[p.name] ?? null })) };
  })(),
];

export const FOOTPRINTS: Record<string, FootprintDef> = Object.fromEntries(LIST.map((f) => [f.id, f]));

// Development boards sit on the PCB the way the physical board does: header holes where the real ones are.
for (const b of [...DEV_BOARD_FOOTPRINTS, ...MODULE_FOOTPRINTS]) FOOTPRINTS[b.id] = b;

/** Screw terminal block of n poles: pads in one row at `pitch`, the first one square. */
function terminalBlock(n: number, pitch: number): FootprintDef {
  const big = pitch >= 5;
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * pitch, 0, big ? 2.6 : 2.0, big ? 1.3 : 1.2, i, i === 0 ? 'rect' : 'round'));
  return { id: `TB${big ? '508' : '350'}_${n}`, label: `Screw terminal ${n} poles (${pitch} mm)`, pads, body: { w: n * pitch, h: big ? 10.2 : 7.2 } };
}

/** Pluggable terminal block, male header side: the same holes as a 5.08 mm screw terminal, a lower open body. */
function pluggableHeader(n: number): FootprintDef {
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * 5.08, 0, 2.6, 1.3, i, i === 0 ? 'rect' : 'round'));
  return { id: `PLUG508_${n}`, label: `Pluggable terminal ${n} poles, male (5.08 mm)`, pads, body: { w: n * 5.08, h: 9.0 } };
}

/** Female (socket) header of n pins, 2.54 mm: the same holes as a pin header, a taller body. */
function femaleHeader(n: number): FootprintDef {
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * 2.54, 0, 1.8, 1.0, i, i === 0 ? 'rect' : 'round'));
  return { id: `FHDR_${n}`, label: `Female header 1x${n} (socket, 2.54 mm)`, pads, body: { w: n * 2.54, h: 4.2 } };
}

/** JST XH connector of n pins at 2.5 mm. */
function jstXh(n: number): FootprintDef {
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * 2.5, 0, 1.7, 0.95, i, i === 0 ? 'rect' : 'round'));
  return { id: `JSTXH_${n}`, label: `JST XH ${n} pins (2.5 mm)`, pads, body: { w: (n - 1) * 2.5 + 4.9, h: 5.75 } };
}

/** Two-row pin header with `rows` rows of 2 pins (2 x rows), 2.54 mm: pin 1 top left, odd pins on the left, even on the right. */
function doubleHeader(rows: number): FootprintDef {
  const pads = Array.from({ length: rows * 2 }, (_, k) => round(String(k + 1), ((k % 2) - 0.5) * 2.54, (Math.floor(k / 2) - (rows - 1) / 2) * 2.54, 1.8, 1.0, k, k === 0 ? 'rect' : 'round'));
  return { id: `HDR2X${rows}`, label: `Pin header 2x${rows} (2.54 mm)`, pads, body: { w: 5.08 + 0.4, h: rows * 2.54 } };
}

/** A single-row header of n pins, generated the first time it is asked for (SIP_3, SIP_5, ...). */
function sip(n: number): FootprintDef {
  const pads = Array.from({ length: n }, (_, i) => round(String(i + 1), (i - (n - 1) / 2) * 2.54, 0, 1.8, 1.0, i, i === 0 ? 'rect' : 'round'));
  return { id: `SIP_${n}`, label: `Pin header 1x${n} (2.54 mm)`, pads, body: { w: n * 2.54, h: 2.6 } };
}

/**
 * Wires a footprint's pads to a part's symbol pins. `padLabels[i]` is the name of the symbol pin that pad i
 * connects to (a pad whose label is no pin stays unconnected); a name that occurs several times (GND) is matched
 * in order. The result is an id that `footprintById` rebuilds: `BASE|3,0,-,1` (the pin index of each pad).
 */
export function wireFootprint(baseId: string, padLabels: string[], pinNames: string[]): string {
  const seenCount = new Map<string, number>();
  const map = padLabels.map((label) => {
    const nth = seenCount.get(label) ?? 0;
    seenCount.set(label, nth + 1);
    if (label.startsWith('@')) {
      // "@3": the pin with this index, for symbols whose pin names ("-", "+") cannot be told apart from "no pin".
      const n = Number(label.slice(1));
      return Number.isInteger(n) && n >= 0 && n < pinNames.length ? String(n) : '-';
    }
    let found = -1;
    let first = -1;
    let k = 0;
    for (let i = 0; i < pinNames.length && found < 0; i++) {
      if (pinNames[i] !== label) continue;
      if (first < 0) first = i;
      if (k++ === nth) found = i;
    }
    // More pads than pins of that name (a regulator's tab is its output pin): the extra pads share the first pin.
    return found >= 0 ? String(found) : first >= 0 ? String(first) : '-';
  });
  return `${baseId}|${map.join(',')}`;
}

/** The key of the pad that carries the net, for a pad key that may have a numbered suffix (`p3:2#1` -> `p3:2`). */
export const baseKey = (key: string): string => key.replace(/^(.*:\d+)#\d+$/, '$1');

/** Adds (or replaces) a footprint that a part brings with it, so a part can describe its own package. */
export function registerFootprint(def: FootprintDef): void {
  for (const id of Object.keys(FOOTPRINTS)) if (id.startsWith(`${def.id}|`)) delete FOOTPRINTS[id]; // wired variants of an older version
  FOOTPRINTS[def.id] = def;
}

/** The names printed on a footprint's pads, in order. */
export const padLabelsOf = (id: string): string[] => footprintById(id)?.pads.map((p) => p.name) ?? [];

export function footprintById(id: string): FootprintDef | undefined {
  const known = FOOTPRINTS[id];
  if (known) return known;
  const bar = id.indexOf('|');
  if (bar > 0) {
    const base = footprintById(id.slice(0, bar));
    const map = id.slice(bar + 1).split(',');
    if (!base || map.length !== base.pads.length) return undefined;
    return (FOOTPRINTS[id] = { ...base, id, pads: base.pads.map((p, i) => ({ ...p, pin: map[i] === '-' ? null : Number(map[i]) })) });
  }
  const fixed: Array<[RegExp, (n: number) => FootprintDef, number, number]> = [
    [/^TB508_(\d+)$/, (n) => terminalBlock(n, 5.08), 2, 12],
    [/^TB350_(\d+)$/, (n) => terminalBlock(n, 3.5), 2, 12],
    [/^PLUG508_(\d+)$/, pluggableHeader, 2, 12],
    [/^FHDR_(\d+)$/, femaleHeader, 1, 40],
    [/^TUNIK254_(\d+)$/, (n) => tunikHeader(n, 2.54), 2, 12],
    [/^TUNIK396_(\d+)$/, (n) => tunikHeader(n, 3.96), 2, 12],
    [/^JSTXH_(\d+)$/, jstXh, 2, 12],
    [/^HDR2X(\d+)$/, doubleHeader, 2, 20],
  ];
  for (const [re, make, lo, hi] of fixed) {
    const hit = re.exec(id);
    if (hit && Number(hit[1]) >= lo && Number(hit[1]) <= hi) return (FOOTPRINTS[id] = make(Number(hit[1])));
  }
  const m = /^SIP_(\d+)$/.exec(id);
  if (!m || Number(m[1]) < 1 || Number(m[1]) > 64) return undefined;
  return (FOOTPRINTS[id] = sip(Number(m[1])));
}

const rotate = (p: Pt, rot: Rot): Pt => {
  switch (rot) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
};

/** Pads of a placed footprint in board coordinates. Net names are filled in by the caller. */
export function absolutePads(inst: FootprintInst, def: FootprintDef): AbsPad[] {
  const seen = new Map<number, number>();
  return def.pads.map((p) => {
    const c = rotate(inst.mirror ? { x: -p.x, y: p.y } : { x: p.x, y: p.y }, inst.rot);
    // Several pads may serve one pin (the tab of a regulator, two ground pins): the later ones get a numbered key.
    const nth = p.pin === null ? 0 : (seen.get(p.pin) ?? 0);
    if (p.pin !== null) seen.set(p.pin, nth + 1);
    const swap = inst.rot === 90 || inst.rot === 270;
    let w = swap ? p.h : p.w;
    let h = swap ? p.w : p.h;
    if (inst.padSize !== undefined && inst.padSize > 0) {
      const k = inst.padSize / Math.min(p.w, p.h);
      w *= k;
      h *= k;
    }
    const smdPad = p.drill === 0;
    return {
      key: p.pin === null ? `${inst.partId}#${p.name}` : `${inst.partId}:${p.pin}${nth > 0 ? `#${nth}` : ''}`,
      partId: inst.partId,
      name: p.name,
      x: inst.x + c.x + 0,
      y: inst.y + c.y + 0,
      w,
      h,
      shape: p.shape,
      drill: smdPad ? 0 : inst.drill !== undefined && inst.drill > 0 ? inst.drill : p.drill,
      smd: smdPad,
      net: null,
    };
  });
}

/** Footprint outline half-extents including pads, for placement and bounds. */
export function footprintExtent(inst: FootprintInst, def: FootprintDef): { w: number; h: number } {
  const pads = absolutePads({ ...inst, x: 0, y: 0 }, def);
  let w = 0;
  let h = 0;
  for (const p of pads) {
    w = Math.max(w, Math.abs(p.x) + p.w / 2);
    h = Math.max(h, Math.abs(p.y) + p.h / 2);
  }
  const swap = inst.rot === 90 || inst.rot === 270;
  w = Math.max(w, (swap ? def.body.h : def.body.w) / 2);
  h = Math.max(h, (swap ? def.body.w : def.body.h) / 2);
  return { w: w * 2, h: h * 2 };
}
