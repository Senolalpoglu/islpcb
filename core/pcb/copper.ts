// Copper items on a board (pads, track segments, vias) with distance and connectivity queries.
// Both the design-rule check and the ratsnest are built on these.

import { absolutePads, baseKey, footprintById } from './footprints';
import { boxBoxDist, pointBoxDist, pointSegDist, segBoxDist, segSegDist, dist, type Box } from './geom';
import type { AbsPad, Layer, PcbDoc, Pt } from './types';

export type ItemKind = 'pad' | 'track' | 'via';

export interface CopperItem {
  kind: ItemKind;
  /** Pad key, track id or via id. */
  id: string;
  net: string | null;
  /** Layers the copper exists on. */
  layers: Layer[];
  /** Round pads, vias: centre and radius. */
  c?: Pt;
  r?: number;
  /** Rectangular / oval pads. */
  box?: Box;
  /** Track segment. */
  a?: Pt;
  b?: Pt;
  halfWidth?: number;
  /** Owning part, for pads. */
  partId?: string;
}

/** All pads of the board with their nets filled in from `netOfPad` (pad key -> net name). */
export function boardPads(pcb: PcbDoc, netOfPad: Map<string, string>): AbsPad[] {
  const out: AbsPad[] = [];
  for (const fp of pcb.fps) {
    const def = footprintById(fp.footprint);
    if (!def) continue;
    for (const p of absolutePads(fp, def)) out.push({ ...p, net: netOfPad.get(baseKey(p.key)) ?? null });
  }
  return out;
}

export function copperItems(pcb: PcbDoc, pads: AbsPad[]): CopperItem[] {
  const items: CopperItem[] = [];
  for (const p of pads) {
    const layers: Layer[] = p.smd ? ['top'] : ['top', 'bottom'];
    if (p.shape === 'round') items.push({ kind: 'pad', id: p.key, net: p.net, layers, c: { x: p.x, y: p.y }, r: p.w / 2, partId: p.partId });
    else items.push({ kind: 'pad', id: p.key, net: p.net, layers, box: { x0: p.x - p.w / 2, y0: p.y - p.h / 2, x1: p.x + p.w / 2, y1: p.y + p.h / 2 }, partId: p.partId });
  }
  for (const t of pcb.tracks) {
    for (let i = 1; i < t.pts.length; i++) {
      items.push({ kind: 'track', id: t.id, net: t.net, layers: [t.layer], a: t.pts[i - 1], b: t.pts[i], halfWidth: t.width / 2 });
    }
  }
  for (const v of pcb.vias) items.push({ kind: 'via', id: v.id, net: v.net, layers: ['top', 'bottom'], c: { x: v.x, y: v.y }, r: v.dia / 2 });
  return items;
}

/** Edge-to-edge gap between two copper items (negative or zero when they touch or overlap). */
export function gap(p: CopperItem, q: CopperItem): number {
  const round = (i: CopperItem): boolean => i.c !== undefined;
  const seg = (i: CopperItem): boolean => i.a !== undefined;
  if (round(p) && round(q)) return dist(p.c!, q.c!) - p.r! - q.r!;
  if (round(p) && q.box) return pointBoxDist(p.c!, q.box) - p.r!;
  if (round(q) && p.box) return pointBoxDist(q.c!, p.box) - q.r!;
  if (p.box && q.box) return boxBoxDist(p.box, q.box);
  if (seg(p) && round(q)) return pointSegDist(q.c!, p.a!, p.b!) - p.halfWidth! - q.r!;
  if (seg(q) && round(p)) return pointSegDist(p.c!, q.a!, q.b!) - q.halfWidth! - p.r!;
  if (seg(p) && q.box) return segBoxDist(p.a!, p.b!, q.box) - p.halfWidth!;
  if (seg(q) && p.box) return segBoxDist(q.a!, q.b!, p.box) - q.halfWidth!;
  if (seg(p) && seg(q)) return segSegDist(p.a!, p.b!, q.a!, q.b!) - p.halfWidth! - q.halfWidth!;
  return Infinity;
}

export const shareLayer = (p: CopperItem, q: CopperItem): boolean => p.layers.some((l) => q.layers.includes(l));

/** True when two items are electrically joined: same net, a common layer and overlapping copper. */
export function touches(p: CopperItem, q: CopperItem): boolean {
  return p.net !== null && p.net === q.net && shareLayer(p, q) && gap(p, q) <= 1e-6;
}
