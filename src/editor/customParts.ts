// Data-defined parts: a JSON description with pins, parameters and an internal circuit (a "sub-circuit")
// built from the simulator's primitives. Registered at run time next to the built-in parts, so a new
// component is a file, not a code change.

import type { Element, Waveform } from '../../core/sim/solver';
import { evalExpression, resolve, ExprError, type Value } from './expr';
import { PART_DEFS, PART_ORDER, type Category, type LocalText, type ParamDef, type PartDef, type Pt, type SymbolSpec } from './model';
import { BBOX, PICTURE_HEIGHT } from './symbols';
import { GLYPHS } from './glyphs';
import { registerFootprint } from '../../core/pcb/footprints';
import type { FootprintDef } from '../../core/pcb/types';

export type ModelType = 'R' | 'C' | 'L' | 'V' | 'I' | 'D' | 'SW' | 'Q' | 'M' | 'OA' | 'VSW' | 'G' | 'THY';

export interface WaveSpec {
  /** `am` is an amplitude-modulated carrier: amp * (1 + depth * sin(2 pi mod t)) * sin(2 pi freq t). */
  kind: 'dc' | 'sin' | 'pulse' | 'tri' | 'am';
  value?: Value;
  offset?: Value;
  amp?: Value;
  freq?: Value;
  /** Modulation frequency and depth (0-1) of an `am` wave. */
  mod?: Value;
  depth?: Value;
  low?: Value;
  high?: Value;
  duty?: Value;
}

/** One primitive inside a part. Node names are pin names, internal names of your choosing, or "0" for ground. */
export interface ModelElement {
  type: ModelType;
  /**
   * Terminals in the order of the simulator element: R, C, L, V, I, D, SW: [a, b]; Q: [collector, emitter, base];
   * M: [drain, source, gate]; OA: [out, in-, in+]; VSW and G: [a, b, control+, control-]; THY (thyristor, or triac with props.bidir): [anode, cathode, gate].
   */
  nodes: string[];
  /** R ohms, C farads, L henries, G siemens, dc volts / amps for V and I. */
  value?: Value;
  wave?: WaveSpec;
  /** Positive and negative supply of an OA, by node name. */
  p?: string;
  n?: string;
  /** Extra values: is, n, bv, ibv, bf, br, beta, vth, lambda, gain, headroom, headroomLo, vmax, rout, vhys, ron, roff, ic, closed, inv, npn, nmos, vgt, ih, bidir. */
  props?: Record<string, Value | boolean>;
}

export interface CustomParamSpec {
  name: string;
  label: LocalText;
  default: number | boolean | string;
  /** `text` parameters (such as the layout of a display) are not numbers and do not enter expressions. */
  kind?: 'number' | 'bool' | 'text';
}

export type CustomSymbol =
  | { kind: 'box'; left: string[]; right: string[]; title?: string }
  | { kind: 'like'; like: string; pins?: string[] }
  | { kind: 'opamp5' }
  /** One of the drawn symbols listed in glyphs.ts, with its own pin layout. `pins` renames its pins. */
  | { kind: 'glyph'; glyph: string; pins?: string[] };

/**
 * What a part is rated for. The schematic compares these limits with the simulation and puts a warning next to a part that
 * goes beyond them. Voltages and currents are instantaneous peaks; `p` is the average power (watts) turned into heat.
 * Numbers, or expressions over the part's parameters ("$vrated * 1.2").
 */
export interface Ratings {
  /** The voltage from pin `a` to pin `b` ("0" is the circuit ground) must stay between `min` and `max`. `polar` says which bound being crossed means the part is connected the wrong way round. */
  v?: Array<{ a: string; b: string; max?: Value; min?: Value; polar?: 'min' | 'max' }>;
  /** The current into a pin, in either direction, must stay below `max` amperes. */
  i?: Array<{ pin: string; max: Value }>;
  p?: Value;
}

export interface CustomPartSpec {
  id: string;
  label: LocalText;
  category: Category;
  prefix: string;
  symbol: CustomSymbol;
  params?: CustomParamSpec[];
  model?: { elements: ModelElement[] };
  /** Footprint id for the PCB; a header or DIP is chosen from the pin count when absent. */
  footprint?: string;
  /** Other packages the part can be built in (the PCB panel offers them next to `footprint`), e.g. the sizes of an electrolytic. */
  footprints?: string[];
  /**
   * For each pad of `footprint`, in the footprint's own order, the symbol pin it connects to. Needed when the
   * physical pin order differs from the order of the symbol (a potentiometer is A-W-B on its pins, not A-B-W).
   */
  padMap?: string[];
  /**
   * The package of a part that is not in the program's footprint list: pad positions in millimetres from the centre
   * of the part (x to the right, y down), copied from the maker's drawing. `footprint` then names this id.
   */
  footprintDef?: { id: string; label?: string; body: { w: number; h: number }; pads: Array<{ name: string; x: number; y: number; w: number; h?: number; shape?: 'round' | 'rect' | 'oval'; drill?: number }> };
  /** The part has no package (an idealised gate): it takes part in the simulation but is left off the PCB. */
  virtual?: boolean;
  /**
   * Something that moves while the circuit runs, drawn on the symbol: a fan, motor or turbine turns, a relay pulls
   * in its armature, a valve opens. `pins` are the two pins whose voltage drives it (default the first two) and
   * `threshold` the voltage where it starts (a number, or the name of a parameter); `rated` the voltage at which a
   * fan or motor reaches full speed (a number or a parameter name); `speed` a parameter that scales a turbine.
   */
  visual?: { kind: 'fan' | 'motor' | 'relay' | 'turbine' | 'valve' | 'lamp'; pins?: [number, number]; threshold?: number | string; rated?: number | string; speed?: string };
  /** A meter shows its reading on the schematic while the circuit runs. */
  meter?: 'voltage' | 'current';
  /** Operating limits; see `Ratings`. */
  ratings?: Ratings;
  /** Parts that ship with the program are not saved into project files. */
  builtin?: boolean;
}

export const customType = (id: string): string => `x:${id}`;
export const isCustomType = (type: string): boolean => type.startsWith('x:');

const SPECS = new Map<string, CustomPartSpec>();

export const customSpec = (type: string): CustomPartSpec | undefined => SPECS.get(type);
export const allCustomSpecs = (): CustomPartSpec[] => [...SPECS.values()];

const CATEGORIES: Category[] = ['passive', 'source', 'semi', 'ic', 'logic', 'mcu', 'switch', 'electromech', 'meter', 'power', 'sensor', 'module', 'connector', 'misc'];
const TYPES: ModelType[] = ['R', 'C', 'L', 'V', 'I', 'D', 'SW', 'Q', 'M', 'OA', 'VSW', 'G', 'THY'];
const NODE_COUNT: Record<ModelType, number> = { R: 2, C: 2, L: 2, V: 2, I: 2, D: 2, SW: 2, Q: 3, M: 3, OA: 3, VSW: 4, G: 4, THY: 3 };

/** Pin positions (grid units, rotation 0) and names for a symbol. */
export function symbolPins(spec: CustomPartSpec): { pins: Pt[]; names: string[] } {
  const sym = spec.symbol;
  if (sym.kind === 'like') {
    const base = PART_DEFS[sym.like];
    return { pins: base.pins.map((p) => ({ ...p })), names: sym.pins ?? [...base.pinNames] };
  }
  if (sym.kind === 'glyph') {
    const g = GLYPHS[sym.glyph];
    return { pins: g.pins.map((p) => ({ ...p })), names: sym.pins ?? [...g.names] };
  }
  if (sym.kind === 'opamp5') {
    return { pins: [{ x: 3, y: 0 }, { x: -3, y: -1 }, { x: -3, y: 1 }, { x: 0, y: -2 }, { x: 0, y: 2 }], names: ['OUT', '-', '+', 'V+', 'V-'] };
  }
  const rows = Math.max(sym.left.length, sym.right.length);
  const top = -Math.floor(rows / 2);
  return {
    pins: [...sym.left.map((_, i) => ({ x: -3, y: top + i })), ...sym.right.map((_, i) => ({ x: 3, y: top + i }))],
    names: [...sym.left, ...sym.right],
  };
}

/** Checks a part description and returns what is wrong with it, in plain words. */
export function validateSpec(raw: unknown): { spec?: CustomPartSpec; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { errors: ['A part must be a JSON object.'] };
  const s = raw as Partial<CustomPartSpec>;
  const where = `Part "${String(s.id ?? '?')}"`;
  if (typeof s.id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/.test(s.id)) errors.push(`${where}: "id" must be lowercase letters, digits, - or _.`);
  if (!s.label || typeof s.label.en !== 'string') errors.push(`${where}: "label.en" is required.`);
  if (!CATEGORIES.includes(s.category as Category)) errors.push(`${where}: "category" must be one of ${CATEGORIES.join(', ')}.`);
  if (typeof s.prefix !== 'string' || !/^[A-Z]{1,3}$/.test(s.prefix)) errors.push(`${where}: "prefix" must be 1-3 capital letters, like "U" or "Q".`);
  const sym = s.symbol;
  if (!sym || !['box', 'like', 'opamp5', 'glyph'].includes(sym.kind)) errors.push(`${where}: "symbol.kind" must be box, like, glyph or opamp5.`);
  else if (sym.kind === 'glyph' && !GLYPHS[sym.glyph]) errors.push(`${where}: unknown glyph "${sym.glyph}" (known: ${Object.keys(GLYPHS).join(', ')}).`);
  else if (sym.kind === 'box' && (!Array.isArray(sym.left) || !Array.isArray(sym.right) || sym.left.length + sym.right.length < 1)) errors.push(`${where}: a box symbol needs "left" and "right" pin name lists.`);
  else if (sym.kind === 'like' && !PART_DEFS[sym.like]) errors.push(`${where}: symbol.like "${sym.like}" is not a known part.`);
  if (errors.length) return { errors };

  const spec = s as CustomPartSpec;
  const { names } = symbolPins(spec);
  if (new Set(names).size !== names.length) errors.push(`${where}: pin names must be unique.`);
  const fd = spec.footprintDef;
  if (fd) {
    const num = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
    if (typeof fd.id !== 'string' || !/^[A-Za-z0-9_.+-]{1,40}$/.test(fd.id)) errors.push(`${where}: footprintDef.id must be letters, digits or _ . + - (up to 40).`);
    else if (!spec.footprint) spec.footprint = fd.id;
    if (!fd.body || !num(fd.body.w) || !num(fd.body.h) || fd.body.w <= 0 || fd.body.h <= 0) errors.push(`${where}: footprintDef.body needs w and h in mm.`);
    if (!Array.isArray(fd.pads) || fd.pads.length === 0 || fd.pads.length > 200) errors.push(`${where}: footprintDef.pads needs 1 to 200 pads.`);
    else
      fd.pads.forEach((p, i) => {
        if (typeof p.name !== 'string' || !num(p.x) || !num(p.y) || !num(p.w) || p.w <= 0) errors.push(`${where}: footprintDef pad ${i + 1} needs name, x, y and w (mm).`);
        else if (p.h !== undefined && (!num(p.h) || p.h <= 0)) errors.push(`${where}: footprintDef pad ${i + 1}: h must be a positive number.`);
        else if (p.drill !== undefined && (!num(p.drill) || p.drill < 0)) errors.push(`${where}: footprintDef pad ${i + 1}: drill must be 0 or more.`);
        else if (p.shape !== undefined && !['round', 'rect', 'oval'].includes(p.shape)) errors.push(`${where}: footprintDef pad ${i + 1}: shape must be round, rect or oval.`);
      });
  }
  if (spec.visual && !['fan', 'motor', 'relay', 'turbine', 'valve', 'lamp'].includes(spec.visual.kind)) errors.push(`${where}: unknown visual "${spec.visual.kind}".`);
  for (const n of spec.padMap ?? []) if (n !== '-' && !/^NC\d*$/.test(n) && !(n.startsWith('@') && Number(n.slice(1)) < names.length) && !names.includes(n)) errors.push(`${where}: padMap names the pin "${n}", which the symbol does not have.`);
  const paramNames = new Set((spec.params ?? []).map((p) => p.name));
  const limitText: Value[] = [];
  const pinKnown = (n: string, at: string): void => {
    if (n !== '0' && !names.includes(n)) errors.push(`${where}: ratings ${at} names the pin "${n}", which the symbol does not have.`);
  };
  for (const r of spec.ratings?.v ?? []) {
    pinKnown(r.a, 'v');
    pinKnown(r.b, 'v');
    limitText.push(...([r.max, r.min].filter((x) => x !== undefined) as Value[]));
  }
  for (const r of spec.ratings?.i ?? []) {
    pinKnown(r.pin, 'i');
    limitText.push(r.max);
  }
  if (spec.ratings?.p !== undefined) limitText.push(spec.ratings.p);
  for (const v of limitText) {
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) if (!paramNames.has(m[1])) errors.push(`${where}: ratings use the unknown parameter $${m[1]}.`);
  }
  const env =Object.fromEntries((spec.params ?? []).map((p) => [p.name, p.kind === 'text' ? 0 : Number(p.default)]));
  const known = new Set(['0', ...names]);
  (spec.model?.elements ?? []).forEach((el, i) => {
    const at = `${where}, element ${i + 1} (${el.type})`;
    if (!TYPES.includes(el.type)) return void errors.push(`${at}: unknown type.`);
    if (!Array.isArray(el.nodes) || el.nodes.length !== NODE_COUNT[el.type]) return void errors.push(`${at}: needs ${NODE_COUNT[el.type]} nodes.`);
    for (const n of el.nodes) if (typeof n !== 'string') errors.push(`${at}: node names must be text.`);
    for (const ref of [el.p, el.n]) if (ref !== undefined) known.add(ref);
    for (const n of el.nodes) known.add(n); // internal nodes are created on first use
    const values = [el.value, el.wave?.value, el.wave?.offset, el.wave?.amp, el.wave?.freq, el.wave?.mod, el.wave?.depth, el.wave?.low, el.wave?.high, el.wave?.duty, ...Object.values(el.props ?? {})];
    for (const v of values) {
      if (typeof v !== 'string') continue;
      for (const m of v.matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)/g)) if (!paramNames.has(m[1])) errors.push(`${at}: unknown parameter $${m[1]}.`);
      try {
        evalExpression(v, new Proxy(env, { get: (t, k) => (k in t ? t[k as string] : 1) }));
      } catch (e: unknown) {
        if (e instanceof ExprError) errors.push(`${at}: ${e.message}`);
      }
    }
  });
  return errors.length ? { errors } : { spec, errors };
}

/** Adds (or replaces) a part in the library so it shows up in the part list and can be placed. */
export function registerCustomPart(spec: CustomPartSpec): void {
  const type = customType(spec.id);
  const { pins, names } = symbolPins(spec);
  const def: PartDef = {
    type,
    prefix: spec.prefix,
    category: spec.category,
    label: 'part.R',
    labelText: spec.label,
    pins,
    pinNames: names,
    params: (spec.params ?? []).map<ParamDef>((p) => ({ name: p.name, label: 'param.label', labelText: p.label, default: p.default, kind: p.kind ?? 'number' })),
    custom: {
      symbol: (spec.symbol.kind === 'like' ? { kind: 'like', like: spec.symbol.like } : spec.symbol.kind === 'opamp5' ? { kind: 'opamp5' } : spec.symbol.kind === 'glyph' ? { kind: 'glyph', glyph: spec.symbol.glyph } : { kind: 'box' }) as SymbolSpec,
      title: spec.symbol.kind === 'box' ? spec.symbol.title ?? spec.label.en : spec.label.en,
      meter: spec.meter,
      visual: spec.visual,
      footprint: spec.footprint,
      footprints: spec.footprints,
      padMap: spec.padMap,
      virtual: spec.virtual,
      builtin: spec.builtin === true,
    },
  };
  if (spec.footprintDef) {
    const d = spec.footprintDef;
    const fp: FootprintDef = {
      id: d.id,
      label: d.label ?? d.id,
      body: d.body,
      pads: d.pads.map((p) => ({ name: p.name, x: p.x, y: p.y, w: p.w, h: p.h ?? p.w, shape: p.shape ?? 'round', drill: p.drill ?? 0, pin: null })),
    };
    registerFootprint(fp);
  }
  SPECS.set(type, spec);
  PART_DEFS[type] = def;
  if (!PART_ORDER.includes(type)) PART_ORDER.push(type);
  const xs = pins.map((p) => p.x);
  const ys = pins.map((p) => p.y);
  const picture = spec.visual !== undefined && spec.visual.kind !== 'fan' && spec.visual.kind !== 'motor' && spec.symbol.kind === 'box';
  const reach = spec.symbol.kind === 'glyph' ? GLYPHS[spec.symbol.glyph].bbox : undefined;
  BBOX[type] = reach ?? { x0: Math.min(...xs) - 0.8, y0: Math.min(...ys) - 0.9, x1: Math.max(...xs) + 0.8, y1: Math.max(Math.max(...ys) + 0.9, picture ? Math.min(...ys) - 1.5 + PICTURE_HEIGHT / 20 : -Infinity) };
}

export function unregisterCustomPart(type: string): void {
  SPECS.delete(type);
  delete PART_DEFS[type];
  delete BBOX[type];
  const i = PART_ORDER.indexOf(type);
  if (i >= 0) PART_ORDER.splice(i, 1);
}

/** Parameter values of a placed part as numbers, ready for expressions. */
export function numericParams(spec: CustomPartSpec, params: Record<string, number | boolean | string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of spec.params ?? []) {
    const v = params[p.name];
    out[p.name] = typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : p.kind === 'text' ? 0 : Number(p.default);
  }
  return out;
}

/**
 * Turns the internal circuit of a placed part into solver elements. `pinNodes` maps pin names to solver nodes,
 * `alloc` hands out a fresh node for each internal net. Element ids are `${partId}.${index}`.
 */
export function expandModel(spec: CustomPartSpec, partId: string, params: Record<string, number | boolean | string>, pinNodes: Map<string, number>, alloc: () => number): Element[] {
  const env = numericParams(spec, params);
  const nodes = new Map(pinNodes);
  const node = (name: string): number => {
    if (name === '0') return 0;
    let n = nodes.get(name);
    if (n === undefined) {
      n = alloc();
      nodes.set(name, n);
    }
    return n;
  };
  const out: Element[] = [];
  (spec.model?.elements ?? []).forEach((el, i) => {
    const id = `${partId}.${i}`;
    const v = (x: Value | undefined, fallback: number): number => (x === undefined ? fallback : resolve(x, env));
    const prop = (k: string): Value | boolean | undefined => el.props?.[k];
    const num = (k: string): number | undefined => {
      const x = prop(k);
      return typeof x === 'boolean' || x === undefined ? undefined : resolve(x, env);
    };
    const flag = (k: string): boolean => {
      const x = prop(k);
      return typeof x === 'boolean' ? x : x === undefined ? false : resolve(x, env) !== 0;
    };
    const [a, b, c, d] = el.nodes.map(node);
    const wave = (): Waveform => {
      const w = el.wave;
      if (!w) return { kind: 'dc', value: v(el.value, 0) };
      switch (w.kind) {
        case 'sin':
          return { kind: 'sin', offset: v(w.offset, 0), amp: v(w.amp, 1), freq: v(w.freq, 1000) };
        case 'pulse':
          return { kind: 'pulse', low: v(w.low, 0), high: v(w.high, 5), period: 1 / Math.max(v(w.freq, 1000), 1e-9), duty: v(w.duty, 0.5) };
        case 'tri':
          return { kind: 'tri', low: v(w.low, 0), high: v(w.high, 5), period: 1 / Math.max(v(w.freq, 1000), 1e-9) };
        case 'am':
          return { kind: 'am', amp: v(w.amp, 1), freq: v(w.freq, 1e6), mod: v(w.mod, 1000), depth: v(w.depth, 0.5) };
        default:
          return { kind: 'dc', value: v(w.value, 0) };
      }
    };
    switch (el.type) {
      case 'R':
        out.push({ type: 'R', id, a, b, r: Math.max(v(el.value, 1000), 1e-6) });
        break;
      case 'C':
        out.push({ type: 'C', id, a, b, c: Math.max(v(el.value, 1e-6), 1e-18), ic: num('ic') ?? 0 });
        break;
      case 'L':
        out.push({ type: 'L', id, a, b, l: Math.max(v(el.value, 1e-3), 1e-12) });
        break;
      case 'V':
        out.push({ type: 'V', id, a, b, wave: wave() });
        break;
      case 'I':
        out.push({ type: 'I', id, a, b, wave: wave() });
        break;
      case 'D':
        out.push({ type: 'D', id, a, b, is: num('is'), n: num('n'), bv: num('bv'), ibv: num('ibv') });
        break;
      case 'SW':
        out.push({ type: 'SW', id, a, b, closed: flag('closed'), ron: num('ron'), roff: num('roff') });
        break;
      case 'Q':
        out.push({ type: 'Q', id, a, b, c, npn: prop('npn') !== false, is: num('is'), bf: num('bf'), br: num('br') });
        break;
      case 'M':
        out.push({ type: 'M', id, a, b, c, nmos: prop('nmos') !== false, beta: num('beta'), vth: num('vth'), lambda: num('lambda') });
        break;
      case 'OA':
        out.push({ type: 'OA', id, a, b, c, gain: num('gain'), vmax: num('vmax'), rout: num('rout'), p: el.p === undefined ? undefined : node(el.p), n: el.n === undefined ? undefined : node(el.n), headroom: num('headroom'), headroomLo: num('headroomLo') });
        break;
      case 'VSW':
        out.push({ type: 'VSW', id, a, b, c, d, vth: num('vth'), vhys: num('vhys'), ron: num('ron'), roff: num('roff'), inv: flag('inv') });
        break;
      case 'THY':
        out.push({ type: 'THY', id, a, b, c, vgt: num('vgt'), ih: num('ih'), ron: num('ron'), roff: num('roff'), bidir: flag('bidir') });
        break;
      case 'G':
        out.push({ type: 'G', id, a, b, c, d, gm: v(el.value, 1e-3) });
        break;
    }
  });
  return out;
}
