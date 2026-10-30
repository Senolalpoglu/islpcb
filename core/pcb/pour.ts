// Copper pours (ground planes). A pour fills the board area of one layer with the copper of one net. Instead of
// computing the filled polygon, we describe it the way a Gerber file does: the full region, minus a clearance
// "halo" around every piece of copper that belongs to another net, then the real copper drawn on top again.
// Pads, tracks and vias of the pour's own net touch the plane directly (a solid connection, no thermal relief).

import type { AbsPad, Pour, PcbDoc, Pt } from './types';

/** One halo around foreign copper: the shape of the copper grown by the clearance on every side. */
export type Cutout =
  | { kind: 'round'; c: Pt; d: number }
  | { kind: 'rect'; c: Pt; w: number; h: number }
  | { kind: 'oval'; c: Pt; w: number; h: number }
  | { kind: 'stroke'; pts: Pt[]; width: number };

export const pourClearance = (pcb: PcbDoc, pour: Pour): number => pour.clearance ?? pcb.rules.clearance;

/** The area the plane may cover: the board outline pulled in by the edge clearance. */
export function pourOutline(pcb: PcbDoc): Pt[] {
  const b = pcb.board;
  const m = pcb.rules.edgeClearance;
  return [
    { x: b.x + m, y: b.y + m },
    { x: b.x + b.w - m, y: b.y + m },
    { x: b.x + b.w - m, y: b.y + b.h - m },
    { x: b.x + m, y: b.y + b.h - m },
    { x: b.x + m, y: b.y + m },
  ];
}

/** Whether a pad has copper on the layer (surface-mount pads are on the top side only, unless the board is single-sided). */
const padOnLayer = (p: AbsPad, layer: Pour['layer']): boolean => !p.smd || layer === 'top';

/** Halos of everything on the pour's layer that is not on the pour's net (pads without a net count as foreign). */
export function pourCutouts(pcb: PcbDoc, pads: AbsPad[], pour: Pour): Cutout[] {
  const clr = pourClearance(pcb, pour);
  const out: Cutout[] = [];
  for (const p of pads) {
    if (p.net === pour.net || !padOnLayer(p, pour.layer)) continue;
    const c = { x: p.x, y: p.y };
    if (p.shape === 'round') out.push({ kind: 'round', c, d: p.w + 2 * clr });
    else if (p.shape === 'rect') out.push({ kind: 'rect', c, w: p.w + 2 * clr, h: p.h + 2 * clr });
    else out.push({ kind: 'oval', c, w: p.w + 2 * clr, h: p.h + 2 * clr });
  }
  for (const t of pcb.tracks) if (t.layer === pour.layer && t.net !== pour.net) out.push({ kind: 'stroke', pts: t.pts, width: t.width + 2 * clr });
  for (const v of pcb.vias) if (v.net !== pour.net && pcb.sides !== 1) out.push({ kind: 'round', c: { x: v.x, y: v.y }, d: v.dia + 2 * clr });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Islands. Tracks of other nets can cut a plane into pieces. Only the piece a pad sits in is connected to it, and a
// piece that no pad, via or track of the net touches is dead copper. The plane is rasterised to find out.

export interface PourAnalysis {
  /** Cell size in mm and the position of cell (0, 0). */
  g: number;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  /** 0 where there is no copper (outside, or inside a clearance halo), otherwise the island number from 1. */
  label: Int32Array;
  islands: number;
}

const MAX_CELLS = 450_000;

export function analyzePour(pcb: PcbDoc, pads: AbsPad[], pour: Pour): PourAnalysis {
  const o = pourOutline(pcb);
  const x0 = o[0].x;
  const y0 = o[0].y;
  const w = o[2].x - x0;
  const h = o[2].y - y0;
  let g = 0.15;
  while ((w / g + 1) * (h / g + 1) > MAX_CELLS) g *= 1.25;
  const nx = Math.max(1, Math.floor(w / g) + 1);
  const ny = Math.max(1, Math.floor(h / g) + 1);
  const label = new Int32Array(nx * ny).fill(-1); // -1: copper, not labelled yet

  const stamp = (x1: number, y1: number, x2: number, y2: number, inside: (x: number, y: number) => boolean): void => {
    const i0 = Math.max(0, Math.floor((x1 - x0) / g));
    const i1 = Math.min(nx - 1, Math.ceil((x2 - x0) / g));
    const j0 = Math.max(0, Math.floor((y1 - y0) / g));
    const j1 = Math.min(ny - 1, Math.ceil((y2 - y0) / g));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (inside(x0 + i * g, y0 + j * g)) label[j * nx + i] = 0;
  };
  for (const c of pourCutouts(pcb, pads, pour)) {
    if (c.kind === 'round') {
      const r = c.d / 2;
      stamp(c.c.x - r, c.c.y - r, c.c.x + r, c.c.y + r, (x, y) => Math.hypot(x - c.c.x, y - c.c.y) <= r);
    } else if (c.kind === 'stroke') {
      const r = c.width / 2;
      for (let s = 1; s < c.pts.length; s++) {
        const a = c.pts[s - 1];
        const b = c.pts[s];
        stamp(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r, (x, y) => segDist(x, y, a, b) <= r);
      }
    } else {
      stamp(c.c.x - c.w / 2, c.c.y - c.h / 2, c.c.x + c.w / 2, c.c.y + c.h / 2, () => true);
    }
  }

  // Label the connected pieces (4-neighbourhood, so two pieces touching only at a corner stay apart).
  let islands = 0;
  const stack: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (label[start] !== -1) continue;
    islands++;
    label[start] = islands;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      const i = c % nx;
      const j = (c - i) / nx;
      const visit = (n: number): void => {
        if (label[n] === -1) {
          label[n] = islands;
          stack.push(n);
        }
      };
      if (i > 0) visit(c - 1);
      if (i < nx - 1) visit(c + 1);
      if (j > 0) visit(c - nx);
      if (j < ny - 1) visit(c + nx);
    }
  }
  return { g, x0, y0, nx, ny, label, islands };
}

function segDist(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

/** Island numbers of the cells inside a box (0 entries dropped). */
function labelsIn(an: PourAnalysis, xa: number, ya: number, xb: number, yb: number): Set<number> {
  const out = new Set<number>();
  const i0 = Math.max(0, Math.floor((xa - an.x0) / an.g));
  const i1 = Math.min(an.nx - 1, Math.ceil((xb - an.x0) / an.g));
  const j0 = Math.max(0, Math.floor((ya - an.y0) / an.g));
  const j1 = Math.min(an.ny - 1, Math.ceil((yb - an.y0) / an.g));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const l = an.label[j * an.nx + i];
    if (l > 0) out.add(l);
  }
  return out;
}

/**
 * The islands touched by each piece of copper of the pour's own net on its layer, keyed `pad:<key>`, `track:<id>`
 * or `via:<id>`. A piece that touches none of them is not connected to the plane.
 */
export function pourContacts(pcb: PcbDoc, pads: AbsPad[], pour: Pour, an: PourAnalysis): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  const add = (key: string, labels: Set<number>): void => {
    const have = out.get(key);
    if (have) labels.forEach((l) => have.add(l));
    else out.set(key, labels);
  };
  for (const p of pads) if (p.net === pour.net && padOnLayer(p, pour.layer)) add(`pad:${p.key}`, labelsIn(an, p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2));
  for (const v of pcb.vias) if (v.net === pour.net && pcb.sides !== 1) add(`via:${v.id}`, labelsIn(an, v.x - v.dia / 2, v.y - v.dia / 2, v.x + v.dia / 2, v.y + v.dia / 2));
  for (const t of pcb.tracks) {
    if (t.net !== pour.net || t.layer !== pour.layer) continue;
    const hw = t.width / 2;
    for (let s = 1; s < t.pts.length; s++) {
      const a = t.pts[s - 1];
      const b = t.pts[s];
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / an.g));
      for (let k = 0; k <= steps; k++) {
        const x = a.x + ((b.x - a.x) * k) / steps;
        const y = a.y + ((b.y - a.y) * k) / steps;
        add(`track:${t.id}`, labelsIn(an, x - hw, y - hw, x + hw, y + hw));
      }
    }
  }
  return out;
}

/** Row-wise rectangles that cover the dead islands (islands no copper of the net touches), for clearing them. */
export function deadIslandRuns(an: PourAnalysis, contacts: Map<string, Set<number>>): Array<{ x0: number; x1: number; y: number }> {
  const live = new Set<number>();
  for (const set of contacts.values()) set.forEach((l) => live.add(l));
  const out: Array<{ x0: number; x1: number; y: number }> = [];
  for (let j = 0; j < an.ny; j++) {
    let start = -1;
    for (let i = 0; i <= an.nx; i++) {
      const l = i < an.nx ? an.label[j * an.nx + i] : 0;
      const dead = l > 0 && !live.has(l);
      if (dead && start < 0) start = i;
      if (!dead && start >= 0) {
        out.push({ x0: an.x0 + (start - 0.5) * an.g, x1: an.x0 + (i - 0.5) * an.g, y: an.y0 + j * an.g });
        start = -1;
      }
    }
  }
  return out;
}
