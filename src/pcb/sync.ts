// Schematic -> PCB: assigns footprints, derives the nets and places new footprints on the board.

import { absolutePads, baseKey, footprintById, footprintExtent, padLabelsOf, wireFootprint } from '../../core/pcb/footprints';
import type { FootprintInst, PcbDoc } from '../../core/pcb/types';
import { PART_DEFS, type Doc, type Part, type PartType } from '../editor/model';
import type { Extracted } from '../editor/netlist';

/** Footprints a part can use, the first being the default. Parts that are missing here are virtual. */
export const FOOTPRINT_CHOICES: Partial<Record<PartType, string[]>> = {
  R: ['AXIAL_10.16', 'AXIAL_7.62', 'AXIAL_12.7', 'SMD_0805', 'SMD_1206', 'SMD_0603'],
  C: ['CAP_RADIAL_5.08', 'CAP_RADIAL_2.54', 'SMD_0805', 'SMD_1206', 'SMD_0603'],
  L: ['AXIAL_7.62', 'AXIAL_10.16', 'SMD_1206'],
  D: ['AXIAL_7.62', 'AXIAL_10.16', 'SMD_0805'],
  LED: ['LED_5MM', 'LED_3MM', 'LED_10MM', 'SMD_0805', 'SMD_1206'],
  SW: ['HDR_1X2', 'TERM_5.08'],
  VDC: ['TERM_5.08', 'HDR_1X2'],
  VAC: ['TERM_5.08', 'HDR_1X2'],
  VPULSE: ['TERM_5.08', 'HDR_1X2'],
  IDC: ['TERM_5.08', 'HDR_1X2'],
  QNPN: ['TO92_BJT'],
  QPNP: ['TO92_BJT'],
  NMOS: ['TO92_MOS'],
  PMOS: ['TO92_MOS'],
  OPAMP: ['OPAMP_DIP8'],
  ARDUINO_UNO: ['BOARD_UNO'],
  ARDUINO_NANO: ['BOARD_NANO'],
  ARDUINO_MEGA: ['BOARD_MEGA'],
  PICO: ['BOARD_PICO'],
  PICO_W: ['BOARD_PICO'],
  PIC16F84A: ['DIP18'],
  PIC16F628A: ['DIP18'],
  PIC16F877A: ['DIP40'],
};

/** Header strip sized to the pin count for parts that do not name a footprint. */
const autoFootprint = (pins: number): string => (pins === 2 ? 'HDR_1X2' : `SIP_${pins}`);

/**
 * A footprint id ready to use for a part: development boards and parts with a `padMap` get their pads wired to the
 * symbol pins by name, so the pad that is printed "D13" on the board is the one connected to pin D13.
 */
export function fitFootprint(base: string, type: PartType): string {
  const def = PART_DEFS[type];
  if (!def) return base;
  const labels = def.custom?.padMap ?? (base.startsWith('BOARD_') || base.startsWith('MOD_') ? padLabelsOf(base) : null);
  if (!labels) return base;
  const baseDef = footprintById(base);
  if (!baseDef || baseDef.pads.length !== labels.length) return base;
  return wireFootprint(base, labels, def.pinNames);
}

/** The footprints offered for a part (in the panel), already wired to its pins. */
export function footprintChoices(type: PartType): string[] {
  const own = PART_DEFS[type]?.custom;
  if (!own) return (FOOTPRINT_CHOICES[type] ?? []).map((id) => fitFootprint(id, type));
  const first = defaultFootprint({ type });
  // The alternatives a part lists count only if they have a pad for every pin, like its main footprint.
  const pins = PART_DEFS[type].pins.length;
  const others = (own.footprints ?? []).map((id) => fitFootprint(id, type)).filter((id) => {
    const def = footprintById(id);
    return def !== undefined && new Set(def.pads.filter((p) => p.pin !== null).map((p) => p.pin)).size >= pins;
  });
  return [...new Set([...(first ? [first] : []), ...others])];
}

export function defaultFootprint(part: Pick<Part, 'type'>): string | null {
  const custom = PART_DEFS[part.type]?.custom;
  if (custom?.virtual) return null; // no package: it exists only in the simulation
  if (custom) {
    const id = custom.footprint;
    // A named footprint only counts if it has a pad for every symbol pin; otherwise fall back to a header strip.
    const pins = PART_DEFS[part.type].pins.length;
    if (id) {
      const fitted = fitFootprint(id, part.type);
      const def = footprintById(fitted);
      if (def && new Set(def.pads.filter((p) => p.pin !== null).map((p) => p.pin)).size >= pins) return fitted;
    }
    return autoFootprint(pins);
  }
  const first = FOOTPRINT_CHOICES[part.type]?.[0];
  return first ? fitFootprint(first, part.type) : null;
}

/** Net of every pad key (`${partId}:${pin}`). Node 0 is called GND; others take the name of their first pin. */
export function padNets(doc: Doc, x: Extracted): Map<string, string> {
  const labels = new Map<number, string[]>();
  for (const part of doc.parts) {
    if (!defaultFootprint(part)) continue;
    PART_DEFS[part.type].pins.forEach((_, i) => {
      const node = x.nodeOfPin.get(`${part.id}:${i}`);
      if (node === undefined) return;
      const list = labels.get(node) ?? [];
      list.push(`${part.ref}.${PART_DEFS[part.type].pinNames[i]}`);
      labels.set(node, list);
    });
  }
  const name = new Map<number, string>();
  for (const [node, list] of labels) {
    name.set(node, node === 0 && !x.error ? 'GND' : `Net-${list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]}`);
  }
  const out = new Map<string, string>();
  for (const part of doc.parts) {
    if (!defaultFootprint(part)) continue;
    PART_DEFS[part.type].pins.forEach((_, i) => {
      const node = x.nodeOfPin.get(`${part.id}:${i}`);
      if (node !== undefined) out.set(`${part.id}:${i}`, name.get(node)!);
    });
  }
  return out;
}

const GAP = 3;

/**
 * Brings the PCB in line with the schematic: new parts get footprints placed on free space, parts that
 * disappeared lose theirs, and tracks of nets that no longer exist are dropped. Existing placement stays.
 */
export function syncPcb(doc: Doc, x: Extracted, prev: PcbDoc): PcbDoc {
  const nets = new Set(padNets(doc, x).values());
  const have = new Map(prev.fps.map((f) => [f.partId, f]));
  const fps: FootprintInst[] = [];
  const fresh: FootprintInst[] = [];
  for (const part of doc.parts) {
    const fp = defaultFootprint(part);
    if (!fp) continue;
    const kept = have.get(part.id);
    // Keep an existing footprint (and its position) as long as it is still a valid choice for the part.
    if (kept && footprintById(kept.footprint)) fps.push(kept);
    else {
      const inst: FootprintInst = { partId: part.id, footprint: fp, x: 0, y: 0, rot: 0 };
      fresh.push(inst);
    }
  }

  const sized = (inst: FootprintInst): { inst: FootprintInst; w: number; h: number } => ({ inst, ...footprintExtent(inst, footprintById(inst.footprint)!) });
  const items = fresh.map(sized).sort((a, b) => b.h - a.h);
  const board = { ...prev.board };
  const firstTime = fps.length === 0;
  let startY = board.y + 3;
  if (!firstTime) {
    for (const f of fps) {
      const e = footprintExtent(f, footprintById(f.footprint)!);
      startY = Math.max(startY, f.y + e.h / 2 + GAP);
    }
  }
  const area = items.reduce((s, i) => s + (i.w + GAP) * (i.h + GAP), 0);
  const rowWidth = firstTime ? Math.max(50, Math.sqrt(area) * 1.5, ...items.map((i) => i.w + 2 * GAP)) : board.w - 2 * GAP;
  let cx = board.x + GAP;
  let cy = startY;
  let rowH = 0;
  for (const it of items) {
    if (cx + it.w > board.x + GAP + rowWidth && rowH > 0) {
      cx = board.x + GAP;
      cy += rowH + GAP;
      rowH = 0;
    }
    fps.push({ ...it.inst, x: cx + it.w / 2, y: cy + it.h / 2 });
    cx += it.w + GAP;
    rowH = Math.max(rowH, it.h);
  }

  // The board grows to hold everything; a new board is sized to its contents.
  let maxX = 0;
  let maxY = 0;
  for (const f of fps) {
    const e = footprintExtent(f, footprintById(f.footprint)!);
    maxX = Math.max(maxX, f.x + e.w / 2);
    maxY = Math.max(maxY, f.y + e.h / 2);
  }
  const ceil5 = (v: number): number => Math.ceil(v / 5) * 5;
  if (firstTime && fps.length > 0) {
    board.w = ceil5(maxX - board.x + GAP);
    board.h = ceil5(maxY - board.y + GAP);
  } else {
    board.w = Math.max(board.w, ceil5(maxX - board.x + GAP));
    board.h = Math.max(board.h, ceil5(maxY - board.y + GAP));
  }

  // Always in schematic order, so repeated synchronisation returns the same list.
  const order = new Map(doc.parts.map((p, i) => [p.id, i]));
  fps.sort((a, b) => order.get(a.partId)! - order.get(b.partId)!);

  return {
    ...prev,
    board,
    fps,
    tracks: prev.tracks.filter((t) => nets.has(t.net)),
    vias: prev.vias.filter((v) => nets.has(v.net)),
    pours: (prev.pours ?? []).filter((p) => nets.has(p.net)),
  };
}

/**
 * Which pins of a part are polarised: "+" pins (and the anode of a diode or LED) are positive, the cathode is "K".
 * A part with a positive pin has exactly that pad square on the board; its other pads are round.
 */
export function pinPolarity(type: PartType): { positive: Set<number>; cathode: Set<number>; plus: Set<number> } {
  const names = PART_DEFS[type]?.pinNames ?? [];
  const diode = names.includes('A') && names.includes('K');
  const positive = new Set<number>();
  const cathode = new Set<number>();
  const plus = new Set<number>();
  names.forEach((n, i) => {
    if (/^\+/.test(n) || /\+$/.test(n)) {
      positive.add(i);
      plus.add(i);
    } else if (diode && n === 'A') positive.add(i);
    else if (diode && n === 'K') cathode.add(i);
  });
  return { positive, cathode, plus };
}

/** Pads of a PCB with their nets, ready for DRC, ratsnest and export. With the schematic, polarity is marked on them. */
export function padsWithNets(pcb: PcbDoc, nets: Map<string, string>, doc?: Doc) {
  const typeOf = new Map(doc?.parts.map((p) => [p.id, p.type]) ?? []);
  return pcb.fps.flatMap((fp) => {
    const def = footprintById(fp.footprint);
    if (!def) return [];
    const polar = typeOf.has(fp.partId) ? pinPolarity(typeOf.get(fp.partId)!) : null;
    const hasPositive = polar !== null && polar.positive.size > 0;
    return absolutePads(fp, def).map((p) => {
      const pin = /:(\d+)(?:#\d+)?$/.exec(p.key);
      const idx = pin ? Number(pin[1]) : -1;
      const positive = polar?.positive.has(idx) === true;
      // The square pad marks the positive pin. Other pads of a polarised part must not be square as well.
      const shape = positive ? 'rect' : hasPositive && p.shape === 'rect' && !p.smd ? 'round' : p.shape;
      return {
        ...p,
        shape,
        ...(positive ? { w: Math.max(p.w, p.h), h: Math.max(p.w, p.h) } : {}), // a square, not a rectangle
        // On a single-sided board every pad is soldered on the copper (bottom) side, surface-mount ones included.
        smd: pcb.sides === 1 ? false : p.smd,
        net: nets.get(baseKey(p.key)) ?? null,
        ...(positive ? { positive: true } : {}),
        ...(polar?.cathode.has(idx) ? { cathode: true } : {}),
        ...(polar?.plus.has(idx) ? { plus: true } : {}),
      };
    });
  });
}
