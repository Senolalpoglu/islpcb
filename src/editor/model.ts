// Schematic document model and the built-in part library.
// All coordinates are integer grid units; one unit is GRID pixels on screen.

import type { SheetSettings } from './sheet';
import type { PcbDoc } from '../../core/pcb/types';
import type { Key } from '../i18n';
import type { PicChipId } from '../../core/mcu/pic16';
import { hexFor, sketchById } from './arduinoExamples';
import { PIC_PROGRAMS, assembleCached } from './picExamples';

export const GRID = 20;

export type Rot = 0 | 90 | 180 | 270;

/** The texts drawn next to a part: its reference (R1), its value (1 kΩ) and the name of its type (2N3904 NPN). */
export type LabelKind = 'ref' | 'val' | 'name';

export interface Pt {
  x: number;
  y: number;
}

export interface Part {
  id: string;
  type: PartType;
  ref: string;
  x: number;
  y: number;
  rot: Rot;
  /** Flipped left to right (before the rotation is applied). */
  mirror?: boolean;
  /** Where the user dragged the texts next to the part, as offsets in pixels from their usual place. */
  labels?: Partial<Record<LabelKind, Pt>>;
  params: Record<string, number | boolean | string>;
}

/** Straight orthogonal wire segment between two grid points. */
export interface Wire {
  id: string;
  a: Pt;
  b: Pt;
}

export interface Doc {
  version: 1;
  parts: Part[];
  wires: Wire[];
  nextId: number;
  /** The board layout derived from this schematic; absent until the PCB view is first opened. */
  pcb?: PcbDoc;
  /** Definitions of the user-imported parts this schematic uses, so the file opens anywhere. */
  customParts?: unknown[];
  /** The drawing sheet: paper, title block and whether it is drawn in the editor. */
  sheet?: Partial<SheetSettings>;
}

export const emptyDoc = (): Doc => ({ version: 1, parts: [], wires: [], nextId: 1 });

/** The parts that ship with the program. User and library parts add their own `x:<id>` types at run time. */
export type BuiltinPartType =
  | 'R' | 'C' | 'L' | 'VDC' | 'VAC' | 'VPULSE' | 'IDC' | 'D' | 'LED' | 'SW' | 'GND' | 'PROBE'
  | 'QNPN' | 'QPNP' | 'NMOS' | 'PMOS' | 'OPAMP'
  | 'ARDUINO_UNO' | 'ARDUINO_MEGA' | 'ARDUINO_NANO' | 'PICO' | 'PICO_W' | 'PIC16F84A' | 'PIC16F628A' | 'PIC16F877A';

export type PartType = string;

export type Category = 'passive' | 'source' | 'semi' | 'ic' | 'logic' | 'mcu' | 'switch' | 'electromech' | 'meter' | 'power' | 'sensor' | 'module' | 'connector' | 'misc';

/** Text that exists in more than one language; `tr` falls back to `en`. */
export interface LocalText {
  en: string;
  tr?: string;
}

export interface ParamDef {
  name: string;
  label: Key;
  /** Replaces `label` for parts defined in data files. */
  labelText?: LocalText;
  default: number | boolean | string;
  kind: 'number' | 'bool' | 'text';
}

/** How a part is drawn: a box listing its pins, the symbol of another part, or a five-pin op-amp triangle. */
export type SymbolSpec = { kind: 'box' } | { kind: 'like'; like: string } | { kind: 'opamp5' } | { kind: 'glyph'; glyph: string };

/** Microcontroller boards: which emulator runs them and how their power pins behave. */
export interface McuInfo {
  title: string;
  engine: 'avr328' | 'avr2560' | 'rp2040' | 'pic16f84a' | 'pic16f628a' | 'pic16f877a';
  /** Board id for arduino-cli. */
  fqbn: string;
  /** Pins that are voltage sources, with their voltage (e.g. 5V). */
  supply: Record<string, number>;
  /** Pins that connect to the circuit ground. */
  ground: string[];
  /** Pins that exist on the symbol but do nothing in the simulation. */
  passive: string[];
}

export interface PartDef {
  mcu?: McuInfo;
  type: PartType;
  prefix: string;
  category: Category;
  label: Key;
  /** Name shown instead of `label` for data-defined parts. */
  labelText?: LocalText;
  /** Set for data-defined parts. */
  custom?: { symbol: SymbolSpec; title: string; meter?: 'voltage' | 'current'; visual?: { kind: 'fan' | 'motor' | 'relay' | 'turbine' | 'valve' | 'lamp'; pins?: [number, number]; threshold?: number | string; rated?: number | string; speed?: string }; footprint?: string; footprints?: string[]; padMap?: string[]; virtual?: boolean; builtin: boolean };
  /** Pin offsets in grid units at rotation 0. Pin order defines element terminals a, b. */
  pins: Pt[];
  pinNames: string[];
  params: ParamDef[];
}

const num = (name: string, label: Key, def: number): ParamDef => ({ name, label, default: def, kind: 'number' });
/** A rating the warnings compare the simulation with (see limits.ts); it has no effect on the solver. */
const rating = (name: string, en: string, tr: string, def: number): ParamDef => ({ name, label: 'param.label', labelText: { en, tr }, default: def, kind: 'number' });

/**
 * Arduino UNO R3 as it is on the board: the digital header (D0-D13, AREF, GND) down the left edge, the analog
 * inputs and the power header down the right. The two SDA/SCL pads next to AREF are the same pins as A4/A5.
 */
const UNO_LEFT = [...Array.from({ length: 14 }, (_, i) => `D${i}`), 'AREF', 'GND'];
const UNO_RIGHT = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', '5V', '3V3', 'VIN', 'GND', 'GND', 'RESET', 'IOREF'];
const UNO_RIGHT_Y = [-7, -6, -5, -4, -3, -2, 0, 1, 2, 3, 4, 5, 6];

/** Arduino Mega 2560: every digital pin D0-D53 down the left edge; analog inputs and the power pins on the right. */
const MEGA_LEFT = Array.from({ length: 54 }, (_, i) => `D${i}`);
const MEGA_RIGHT = [...Array.from({ length: 16 }, (_, i) => `A${i}`), '5V', '5V', '5V', '3V3', 'VIN', 'GND', 'GND', 'GND', 'GND', 'GND', 'RESET', 'IOREF', 'AREF'];
const MEGA_RIGHT_Y = [...Array.from({ length: 16 }, (_, i) => -27 + i), ...Array.from({ length: 13 }, (_, i) => -9 + i)];
/** Arduino Nano: the two header rows as printed on the board, seen from above with the USB connector at the top. */
const NANO_LEFT = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'];
const NANO_RIGHT = ['D1', 'D0', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'];
/** Raspberry Pi Pico header: physical pins 1-20 down the left edge, 40-21 down the right. */
const PICO_LEFT = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
const PICO_RIGHT = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'];

/** PIC DIPs: pins 1..n/2 down the left edge, the rest up the right edge (listed top to bottom). */
const PIC18_A_LEFT = ['RA2', 'RA3', 'RA4', 'MCLR', 'VSS', 'RB0', 'RB1', 'RB2', 'RB3'];
const PIC18_A_RIGHT = ['RA1', 'RA0', 'OSC1', 'OSC2', 'VDD', 'RB7', 'RB6', 'RB5', 'RB4'];
const PIC18_628_LEFT = ['RA2', 'RA3', 'RA4', 'RA5', 'VSS', 'RB0', 'RB1', 'RB2', 'RB3'];
const PIC18_628_RIGHT = ['RA1', 'RA0', 'RA7', 'RA6', 'VDD', 'RB7', 'RB6', 'RB5', 'RB4'];
const PIC40_LEFT = ['MCLR', 'RA0', 'RA1', 'RA2', 'RA3', 'RA4', 'RA5', 'RE0', 'RE1', 'RE2', 'VDD', 'VSS', 'OSC1', 'OSC2', 'RC0', 'RC1', 'RC2', 'RC3', 'RD0', 'RD1'];
const PIC40_RIGHT = ['RB7', 'RB6', 'RB5', 'RB4', 'RB3', 'RB2', 'RB1', 'RB0', 'VDD', 'VSS', 'RD7', 'RD6', 'RD5', 'RD4', 'RC7', 'RC6', 'RC5', 'RC4', 'RD3', 'RD2'];

const dip = (left: string[], right: string[]): Pick<PartDef, 'pins' | 'pinNames'> => {
  const top = -Math.floor(left.length / 2);
  return {
    pins: [...left.map((_, i) => ({ x: -4, y: top + i })), ...right.map((_, i) => ({ x: 4, y: top + i }))],
    pinNames: [...left, ...right],
  };
};

const picInfo = (title: string, engine: McuInfo['engine'], passive: string[]): McuInfo => ({ title, engine, fqbn: '', supply: {}, ground: ['VSS'], passive });


export const PART_DEFS: Record<string, PartDef> = {
  R: { type: 'R', prefix: 'R', category: 'passive', label: 'part.R', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['1', '2'], params: [num('r', 'param.r', 1000), rating('prated', 'Power rating (W)', 'Güç değeri (W)', 0.25)] },
  C: { type: 'C', prefix: 'C', category: 'passive', label: 'part.C', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['1', '2'], params: [num('c', 'param.c', 1e-6), num('ic', 'param.ic', 0), rating('vrated', 'Voltage rating (V)', 'Anma gerilimi (V)', 50)] },
  L: { type: 'L', prefix: 'L', category: 'passive', label: 'part.L', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['1', '2'], params: [num('l', 'param.l', 1e-3)] },
  VDC: { type: 'VDC', prefix: 'V', category: 'source', label: 'part.VDC', pins: [{ x: 0, y: -2 }, { x: 0, y: 2 }], pinNames: ['+', '-'], params: [num('v', 'param.v', 5)] },
  VAC: { type: 'VAC', prefix: 'V', category: 'source', label: 'part.VAC', pins: [{ x: 0, y: -2 }, { x: 0, y: 2 }], pinNames: ['+', '-'], params: [num('offset', 'param.offset', 0), num('amp', 'param.amp', 5), num('freq', 'param.freq', 1000)] },
  VPULSE: { type: 'VPULSE', prefix: 'V', category: 'source', label: 'part.VPULSE', pins: [{ x: 0, y: -2 }, { x: 0, y: 2 }], pinNames: ['+', '-'], params: [num('low', 'param.low', 0), num('high', 'param.high', 5), num('freq', 'param.freq', 1000), num('duty', 'param.duty', 0.5)] },
  IDC: { type: 'IDC', prefix: 'I', category: 'source', label: 'part.IDC', pins: [{ x: 0, y: 2 }, { x: 0, y: -2 }], pinNames: ['-', '+'], params: [num('i', 'param.i', 0.001)] },
  D: { type: 'D', prefix: 'D', category: 'semi', label: 'part.D', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['A', 'K'], params: [num('is', 'param.is', 1e-14), num('n', 'param.n', 1)] },
  LED: { type: 'LED', prefix: 'D', category: 'semi', label: 'part.LED', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['A', 'K'], params: [num('is', 'param.is', 1e-18), num('n', 'param.n', 2)] },
  SW: { type: 'SW', prefix: 'S', category: 'switch', label: 'part.SW', pins: [{ x: -2, y: 0 }, { x: 2, y: 0 }], pinNames: ['1', '2'], params: [{ name: 'closed', label: 'prop.closed', default: false, kind: 'bool' }] },
  GND: { type: 'GND', prefix: 'GND', category: 'misc', label: 'part.GND', pins: [{ x: 0, y: 0 }], pinNames: ['GND'], params: [] },
  PROBE: { type: 'PROBE', prefix: 'P', category: 'misc', label: 'part.PROBE', pins: [{ x: 0, y: 0 }], pinNames: ['P'], params: [{ name: 'label', label: 'param.label', default: '', kind: 'text' }] },
  // Three-terminal parts: pin order is [a, c, b] of the solver element (see netlist.ts).
  QNPN: { type: 'QNPN', prefix: 'Q', category: 'semi', label: 'part.QNPN', pins: [{ x: 2, y: -2 }, { x: -2, y: 0 }, { x: 2, y: 2 }], pinNames: ['C', 'B', 'E'], params: [num('is', 'param.is', 1e-14), num('bf', 'param.bf', 100), num('br', 'param.br', 1)] },
  QPNP: { type: 'QPNP', prefix: 'Q', category: 'semi', label: 'part.QPNP', pins: [{ x: 2, y: -2 }, { x: -2, y: 0 }, { x: 2, y: 2 }], pinNames: ['C', 'B', 'E'], params: [num('is', 'param.is', 1e-14), num('bf', 'param.bf', 100), num('br', 'param.br', 1)] },
  NMOS: { type: 'NMOS', prefix: 'M', category: 'semi', label: 'part.NMOS', pins: [{ x: 2, y: -2 }, { x: -2, y: 0 }, { x: 2, y: 2 }], pinNames: ['D', 'G', 'S'], params: [num('beta', 'param.beta', 0.1), num('vth', 'param.vth', 2), num('lambda', 'param.lambda', 0)] },
  PMOS: { type: 'PMOS', prefix: 'M', category: 'semi', label: 'part.PMOS', pins: [{ x: 2, y: -2 }, { x: -2, y: 0 }, { x: 2, y: 2 }], pinNames: ['D', 'G', 'S'], params: [num('beta', 'param.beta', 0.1), num('vth', 'param.vth', 2), num('lambda', 'param.lambda', 0)] },
  ARDUINO_UNO: {
    type: 'ARDUINO_UNO',
    prefix: 'A',
    category: 'mcu',
    label: 'part.ARDUINO_UNO',
    pins: [...UNO_LEFT.map((_, i) => ({ x: -4, y: -7 + i })), ...UNO_RIGHT_Y.map((y) => ({ x: 4, y }))],
    pinNames: [...UNO_LEFT, ...UNO_RIGHT],
    params: [],
    mcu: { title: 'ARDUINO UNO', engine: 'avr328', fqbn: 'arduino:avr:uno', supply: { '5V': 5 }, ground: ['GND'], passive: ['AREF', '3V3', 'VIN', 'RESET', 'IOREF'] },
  },
  ARDUINO_MEGA: {
    type: 'ARDUINO_MEGA',
    prefix: 'A',
    category: 'mcu',
    label: 'part.ARDUINO_MEGA',
    pins: [...MEGA_LEFT.map((_, i) => ({ x: -4, y: -27 + i })), ...MEGA_RIGHT_Y.map((y) => ({ x: 4, y }))],
    pinNames: [...MEGA_LEFT, ...MEGA_RIGHT],
    params: [],
    mcu: { title: 'ARDUINO MEGA 2560', engine: 'avr2560', fqbn: 'arduino:avr:mega:cpu=atmega2560', supply: { '5V': 5 }, ground: ['GND'], passive: ['AREF', '3V3', 'VIN', 'RESET', 'IOREF'] },
  },
  ARDUINO_NANO: {
    type: 'ARDUINO_NANO',
    prefix: 'A',
    category: 'mcu',
    label: 'part.ARDUINO_NANO',
    pins: [...NANO_LEFT.map((_, i) => ({ x: -4, y: -7 + i })), ...NANO_RIGHT.map((_, i) => ({ x: 4, y: -7 + i }))],
    pinNames: [...NANO_LEFT, ...NANO_RIGHT],
    params: [],
    mcu: { title: 'ARDUINO NANO', engine: 'avr328', fqbn: 'arduino:avr:nano:cpu=atmega328', supply: { '5V': 5 }, ground: ['GND'], passive: ['AREF', '3V3', 'VIN', 'RST', 'A6', 'A7'] },
  },
  PICO: {
    type: 'PICO',
    prefix: 'A',
    category: 'mcu',
    label: 'part.PICO',
    pins: [...PICO_LEFT.map((_, i) => ({ x: -4, y: -10 + i })), ...PICO_RIGHT.map((_, i) => ({ x: 4, y: -10 + i }))],
    pinNames: [...PICO_LEFT, ...PICO_RIGHT],
    params: [],
    mcu: {
      title: 'RASPBERRY PI PICO',
      engine: 'rp2040',
      fqbn: 'rp2040:rp2040:rpipico',
      supply: { '3V3': 3.3, VBUS: 5 },
      ground: ['GND', 'AGND'],
      passive: ['VSYS', '3V3_EN', 'ADC_VREF', 'RUN'],
    },
  },
  PICO_W: {
    type: 'PICO_W',
    prefix: 'A',
    category: 'mcu',
    label: 'part.PICO_W',
    pins: [...PICO_LEFT.map((_, i) => ({ x: -4, y: -10 + i })), ...PICO_RIGHT.map((_, i) => ({ x: 4, y: -10 + i }))],
    pinNames: [...PICO_LEFT, ...PICO_RIGHT],
    params: [],
    mcu: {
      title: 'RASPBERRY PI PICO W',
      engine: 'rp2040',
      fqbn: 'rp2040:rp2040:rpipicow',
      supply: { '3V3': 3.3, VBUS: 5 },
      ground: ['GND', 'AGND'],
      passive: ['VSYS', '3V3_EN', 'ADC_VREF', 'RUN'],
    },
  },
  PIC16F84A: { type: 'PIC16F84A', prefix: 'U', category: 'mcu', label: 'part.PIC16F84A', ...dip(PIC18_A_LEFT, PIC18_A_RIGHT), params: [num('clock', 'param.clock', 4)], mcu: picInfo('PIC16F84A', 'pic16f84a', ['MCLR', 'OSC1', 'OSC2', 'VDD']) },
  PIC16F628A: { type: 'PIC16F628A', prefix: 'U', category: 'mcu', label: 'part.PIC16F628A', ...dip(PIC18_628_LEFT, PIC18_628_RIGHT), params: [num('clock', 'param.clock', 4)], mcu: picInfo('PIC16F628A', 'pic16f628a', ['VDD']) },
  PIC16F877A: { type: 'PIC16F877A', prefix: 'U', category: 'mcu', label: 'part.PIC16F877A', ...dip(PIC40_LEFT, PIC40_RIGHT), params: [num('clock', 'param.clock', 4)], mcu: picInfo('PIC16F877A', 'pic16f877a', ['MCLR', 'OSC1', 'OSC2', 'VDD']) },
  OPAMP: { type: 'OPAMP', prefix: 'U', category: 'ic', label: 'part.OPAMP', pins: [{ x: 3, y: 0 }, { x: -3, y: -1 }, { x: -3, y: 1 }], pinNames: ['OUT', '-', '+'], params: [num('gain', 'param.gain', 1e5), num('vmax', 'param.vmax', 12)] },
};

export const PART_ORDER: PartType[] = [
  'R', 'C', 'L', 'VDC', 'VAC', 'VPULSE', 'IDC', 'D', 'LED', 'QNPN', 'QPNP', 'NMOS', 'PMOS', 'OPAMP', 'ARDUINO_UNO', 'ARDUINO_NANO', 'ARDUINO_MEGA', 'PICO', 'PICO_W', 'PIC16F84A', 'PIC16F628A', 'PIC16F877A', 'SW', 'GND', 'PROBE',
];

export const isMcu = (type: PartType): boolean => PART_DEFS[type].mcu !== undefined;

/** The name of a part in the current language. */
export function partLabel(def: PartDef, t: (key: Key) => string, lang: string): string {
  return def.labelText ? (lang === 'tr' ? def.labelText.tr ?? def.labelText.en : def.labelText.en) : t(def.label);
}

export function paramLabel(def: ParamDef, t: (key: Key) => string, lang: string): string {
  return def.labelText ? (lang === 'tr' ? def.labelText.tr ?? def.labelText.en : def.labelText.en) : t(def.label);
}

export const CATEGORY_LABEL: Record<Category, Key> = {
  logic: 'cat.logic',
  electromech: 'cat.electromech',
  meter: 'cat.meter',
  power: 'cat.power',
  sensor: 'cat.sensor',
  module: 'cat.module',
  connector: 'cat.connector',
  passive: 'cat.passive',
  source: 'cat.source',
  semi: 'cat.semi',
  ic: 'cat.ic',
  mcu: 'cat.mcu',
  switch: 'cat.switch',
  misc: 'cat.misc',
};

export function rotate(p: Pt, rot: Rot): Pt {
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
}

/** World grid position of each pin of a part. */
export function pinPositions(part: Pick<Part, 'type' | 'x' | 'y' | 'rot' | 'mirror'>): Pt[] {
  return PART_DEFS[part.type].pins.map((p) => {
    const r = rotate(part.mirror ? { x: -p.x, y: p.y } : p, part.rot);
    // "+ 0" turns -0 into 0 so keys like "-0,3" never appear.
    return { x: part.x + r.x + 0, y: part.y + r.y + 0 };
  });
}

export function defaultParams(type: PartType): Part['params'] {
  const out: Part['params'] = {};
  for (const p of PART_DEFS[type].params) out[p.name] = p.default;
  // Microcontrollers carry their program with them; new boards start with Blink.
  const mcu = PART_DEFS[type].mcu;
  if (mcu?.engine.startsWith('pic16')) {
    const blink = PIC_PROGRAMS[type as PicChipId][0];
    out.source = blink.source;
    out.hex = assembleCached(type as PicChipId, blink.source).hex;
  } else if (mcu) {
    const blink = sketchById('blink');
    out.source = blink.source;
    out.hex = hexFor(blink, mcu.engine);
  }
  return out;
}

/** Adds a new part to a document, assigning a unique id and the next reference designator. */
export function addPart(doc: Doc, type: PartType, x: number, y: number, rot: Rot = 0, mirror = false): Doc {
  const def = PART_DEFS[type];
  const refs = new Set(doc.parts.map((p) => p.ref));
  let n = 1;
  while (refs.has(def.prefix + n)) n++;
  const part: Part = {
    id: `p${doc.nextId}`,
    type,
    ref: type === 'GND' ? 'GND' : def.prefix + n,
    x,
    y,
    rot,
    ...(mirror ? { mirror: true } : {}),
    params: defaultParams(type),
  };
  return { ...doc, parts: [...doc.parts, part], nextId: doc.nextId + 1 };
}

export function addWire(doc: Doc, a: Pt, b: Pt): Doc {
  if (a.x === b.x && a.y === b.y) return doc;
  return { ...doc, wires: [...doc.wires, { id: `w${doc.nextId}`, a, b }], nextId: doc.nextId + 1 };
}

export const ptKey = (p: Pt): string => `${p.x},${p.y}`;

/** True if p lies on segment a-b (endpoints included). Segments are axis-aligned. */
export function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  if (a.x === b.x) return p.x === a.x && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  if (a.y === b.y) return p.y === a.y && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x);
  return false;
}

/**
 * Moves a part by (dx, dy) and drags the wires attached to its pins along. A wire end that moves off its
 * axis gets an extra corner so every segment stays horizontal or vertical.
 */
export function movePartWithWires(doc: Doc, partId: string, dx: number, dy: number): Doc {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part || (dx === 0 && dy === 0)) return doc;
  const pinKeys = new Set(pinPositions(part).map(ptKey));
  const moved = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  let nextId = doc.nextId;
  const wires: Doc['wires'] = [];
  const emit = (a: Pt, b: Pt): void => {
    if (a.x !== b.x || a.y !== b.y) wires.push({ id: `w${nextId++}`, a, b });
  };
  for (const w of doc.wires) {
    const aMoves = pinKeys.has(ptKey(w.a));
    const bMoves = pinKeys.has(ptKey(w.b));
    if (aMoves && bMoves) {
      emit(moved(w.a), moved(w.b));
    } else if (aMoves || bMoves) {
      const fixed = aMoves ? w.b : w.a;
      const old = aMoves ? w.a : w.b;
      const now = moved(old);
      const horizontal = w.a.y === w.b.y;
      const corner = horizontal ? { x: now.x, y: fixed.y } : { x: fixed.x, y: now.y };
      emit(fixed, corner);
      emit(corner, now);
    } else {
      wires.push(w);
    }
  }
  return {
    ...doc,
    wires,
    nextId,
    parts: doc.parts.map((p) => (p.id === partId ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
  };
}

/**
 * Moves the chosen parts and wires by (dx, dy) as one block. A wire that is not chosen but is attached to the block
 * (to a pin of a moved part or the end of a moved wire) is stretched, with a corner so every segment stays straight.
 * Chosen wires keep their ids, so the selection survives the move.
 */
export function moveSelectionWithWires(doc: Doc, partIds: ReadonlySet<string>, wireIds: ReadonlySet<string>, dx: number, dy: number): Doc {
  if ((dx === 0 && dy === 0) || (partIds.size === 0 && wireIds.size === 0)) return doc;
  const moving = new Set<string>();
  for (const p of doc.parts) if (partIds.has(p.id)) for (const q of pinPositions(p)) moving.add(ptKey(q));
  for (const w of doc.wires) if (wireIds.has(w.id)) moving.add(ptKey(w.a)), moving.add(ptKey(w.b));
  const moved = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  let nextId = doc.nextId;
  const wires: Doc['wires'] = [];
  const emit = (a: Pt, b: Pt): void => {
    if (a.x !== b.x || a.y !== b.y) wires.push({ id: `w${nextId++}`, a, b });
  };
  for (const w of doc.wires) {
    if (wireIds.has(w.id)) {
      wires.push({ ...w, a: moved(w.a), b: moved(w.b) });
      continue;
    }
    const aMoves = moving.has(ptKey(w.a));
    const bMoves = moving.has(ptKey(w.b));
    if (aMoves && bMoves) emit(moved(w.a), moved(w.b));
    else if (aMoves || bMoves) {
      const fixed = aMoves ? w.b : w.a;
      const now = moved(aMoves ? w.a : w.b);
      const corner = w.a.y === w.b.y ? { x: now.x, y: fixed.y } : { x: fixed.x, y: now.y };
      emit(fixed, corner);
      emit(corner, now);
    } else wires.push(w);
  }
  return { ...doc, wires, nextId, parts: doc.parts.map((p) => (partIds.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)) };
}

/** Moves the whole drawing by whole grid steps. */
export const translateDoc = (doc: Doc, dx: number, dy: number): Doc =>
  dx === 0 && dy === 0
    ? doc
    : {
        ...doc,
        parts: doc.parts.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })),
        wires: doc.wires.map((w) => ({ ...w, a: { x: w.a.x + dx, y: w.a.y + dy }, b: { x: w.b.x + dx, y: w.b.y + dy } })),
      };

/** Removes the chosen parts and wires. */
export const removeSelected = (doc: Doc, partIds: ReadonlySet<string>, wireIds: ReadonlySet<string>): Doc => ({
  ...doc,
  parts: doc.parts.filter((p) => !partIds.has(p.id)),
  wires: doc.wires.filter((w) => !wireIds.has(w.id)),
});

/**
 * Rotates and/or mirrors a part in place and carries the wires attached to its pins along: each wire end on a pin
 * moves to where that pin now is, with a corner added so every segment stays horizontal or vertical.
 */
export function transformPartWithWires(doc: Doc, partId: string, patch: { rot?: Rot; mirror?: boolean }): Doc {
  const part = doc.parts.find((p) => p.id === partId);
  if (!part) return doc;
  const next: Part = { ...part, ...patch };
  if (!next.mirror) delete next.mirror;
  const was = pinPositions(part);
  const now = pinPositions(next);
  const target = new Map<string, Pt>();
  was.forEach((p, i) => target.set(ptKey(p), now[i]));
  let nextId = doc.nextId;
  const parts = doc.parts.map((p) => (p.id === partId ? next : p));
  const oldPins = doc.parts.flatMap((p) => pinPositions(p));
  const atPoint = (list: Doc['wires'], pt: Pt, skip: Set<string>) => list.filter((w) => !skip.has(w.id) && eq(w.a, pt) !== eq(w.b, pt)); // one end here (a zero-length wire does not count)

  // Each wire attached to a moving pin is followed back, through plain bends, to the point where it meets something
  // (another pin, a junction): that whole run is replaced by one fresh route from there to the pin's new place. Old
  // bends left behind would otherwise lie across the new pin positions.
  const gone = new Set<string>();
  const routes: Array<{ from: Pt; to: Pt }> = [];
  for (const [key, to] of target) {
    const start = { x: Number(key.split(',')[0]), y: Number(key.split(',')[1]) };
    for (const first of atPoint(doc.wires, start, new Set())) {
      if (gone.has(first.id)) continue;
      const run = new Set<string>([first.id]);
      let cur = eq(first.a, start) ? first.b : first.a;
      for (;;) {
        const here = atPoint(doc.wires, cur, run);
        const isPin = oldPins.some((q) => eq(q, cur));
        const onMiddle = doc.wires.some((w) => !run.has(w.id) && onSegment(cur, w.a, w.b) && !eq(cur, w.a) && !eq(cur, w.b));
        if (here.length !== 1 || isPin || onMiddle) break;
        run.add(here[0].id);
        cur = eq(here[0].a, cur) ? here[0].b : here[0].a;
      }
      run.forEach((id) => gone.add(id));
      routes.push({ from: cur, to });
    }
  }
  const wires: Doc['wires'] = doc.wires.filter((w) => !gone.has(w.id));
  for (const r of routes) {
    if (eq(r.from, r.to)) continue;
    const { path } = routeWire({ ...doc, parts, wires }, r.from, r.to);
    for (let i = 1; i < path.length; i++) if (!eq(path[i - 1], path[i])) wires.push({ id: `w${nextId++}`, a: path[i - 1], b: path[i] });
  }
  return { ...doc, wires, nextId, parts };
}

// ---- orthogonal routing of one wire ----
const eq = (a: Pt, b: Pt): boolean => a.x === b.x && a.y === b.y;

/** Whether wire segment p-q would touch something it should not: a foreign pin, the end of another wire, or overlap one. */
function segmentClean(doc: Doc, allPins: Pt[], p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const own = (c: Pt): boolean => eq(c, a) || eq(c, b);
  for (const pin of allPins) if (!own(pin) && onSegment(pin, p, q)) return false;
  for (const w of doc.wires) {
    for (const e of [w.a, w.b]) if (!own(e) && onSegment(e, p, q)) return false;
    for (const c of [p, q]) if (!own(c) && onSegment(c, w.a, w.b)) return false;
    const horizontal = p.y === q.y && w.a.y === w.b.y && p.y === w.a.y;
    const vertical = p.x === q.x && w.a.x === w.b.x && p.x === w.a.x;
    if (horizontal && Math.min(Math.max(p.x, q.x), Math.max(w.a.x, w.b.x)) > Math.max(Math.min(p.x, q.x), Math.min(w.a.x, w.b.x))) return false;
    if (vertical && Math.min(Math.max(p.y, q.y), Math.max(w.a.y, w.b.y)) > Math.max(Math.min(p.y, q.y), Math.min(w.a.y, w.b.y))) return false;
  }
  return true;
}

function candidatePaths(a: Pt, b: Pt): Pt[][] {
  const out: Pt[][] = [];
  if (a.x === b.x || a.y === b.y) out.push([a, b]);
  out.push([a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]);
  const mid = (u: number, v: number): number => Math.round((u + v) / 2);
  for (let k = 0; k <= 14; k++) {
    for (const s of k === 0 ? [0] : [1, -1]) {
      for (const mx of [mid(a.x, b.x) + k * s, a.x + (k + 1) * s, b.x + (k + 1) * s]) out.push([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]);
      for (const my of [mid(a.y, b.y) + k * s, a.y + (k + 1) * s, b.y + (k + 1) * s]) out.push([a, { x: a.x, y: my }, { x: b.x, y: my }, b]);
    }
  }
  return out;
}

const dedupe = (path: Pt[]): Pt[] => path.filter((p, i) => i === 0 || !eq(p, path[i - 1]));

/** An orthogonal path between two points that avoids other pins and wires where it can; `clean` says whether it did. */
export function routeWire(doc: Doc, a: Pt, b: Pt): { path: Pt[]; clean: boolean } {
  const allPins = doc.parts.flatMap((p) => pinPositions(p));
  for (const candidate of candidatePaths(a, b)) {
    const path = dedupe(candidate);
    let ok = path.length >= 2;
    for (let i = 1; ok && i < path.length; i++) ok = segmentClean(doc, allPins, path[i - 1], path[i], a, b);
    if (ok) return { path, clean: true };
  }
  return { path: dedupe([a, { x: b.x, y: a.y }, b]), clean: false };
}



/** Moves one of a part's texts; `null` puts it back where it belongs. */
export function setLabelOffset(doc: Doc, partId: string, kind: LabelKind, off: Pt | null): Doc {
  return {
    ...doc,
    parts: doc.parts.map((p) => {
      if (p.id !== partId) return p;
      const labels = { ...p.labels };
      if (off && (off.x !== 0 || off.y !== 0)) labels[kind] = off;
      else delete labels[kind];
      const { labels: _old, ...rest } = p;
      return Object.keys(labels).length ? { ...rest, labels } : rest;
    }),
  };
}
