// Autorouter: grid-based A* on two layers with vias, 45-degree moves and a small penalty for turning.
//
// Every copper object is painted into a per-layer occupancy grid, inflated by the clearance plus half a track
// width, so a track centre may only run through cells that are free or that belong to its own net. Connections
// come from the ratsnest (pad to pad), shortest first; several orderings are tried and the best one is kept.
//
// A connection grows the copper of its own net like a tree: it starts from any copper the net already has at
// the pad it leaves and ends on any copper at the pad it reaches, so a net never gets two tracks side by side.
// Each net has a preferred track width (power nets are wider); when a connection does not fit at that width the
// router tries narrower tracks, down to a minimum, before giving up.

import { copperItems } from './copper';
import { pointBoxDist, pointSegDist } from './geom';
import { ratsnest, type AirWire } from './ratsnest';
import type { AbsPad, Layer, PcbDoc, Pt, Track, Via } from './types';

export interface RouteOptions {
  /** Grid pitch in mm. Smaller finds tighter routes but searches more cells. */
  grid?: number;
  /** Extra cost of a via, in grid steps. */
  viaCost?: number;
  /** Cost of changing direction, in grid steps. */
  turnCost?: number;
  /** Route on this layer only, without vias (single-sided boards). */
  onlyLayer?: Layer;
  /** Orderings to try. */
  attempts?: number;
  /** Preferred track width per net in mm; nets that are not listed use the board's track width. */
  netWidths?: Map<string, number>;
  /** Narrowest track the router may fall back to, in mm. Default: 0.2 or the board's track width if that is smaller. */
  minWidth?: number;
  /** Receives a short explanation whenever a connection cannot be routed. */
  debug?: (message: string) => void;
}

export interface RouteResult {
  tracks: Track[];
  vias: Via[];
  routed: number;
  failed: Array<{ net: string; from: string; to: string }>;
}

const FREE = 0;
const BLOCKED = -1;
const DIRS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** Cost per cell of running inside the band around copper the net already has: it discourages tracks side by side. */
const BAND_COST = 0.6;
const MAX_EXPANDED = 900_000;

class Heap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size(): number {
    return this.keys.length;
  }
  push(key: number, val: number): void {
    const k = this.keys;
    const v = this.vals;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.keys;
    const v = this.vals;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Routes every open connection. With a copper pour on the board the work is done in passes: tracks laid across a
 * plane can cut it into pieces, which leaves some pads of its net cut off, so after each pass the connections that
 * the real shape of the plane no longer provides are routed too.
 */
export function autoroute(pcb: PcbDoc, pads: AbsPad[], opts: RouteOptions = {}): RouteResult {
  let current = pcb;
  const tracks: Track[] = [];
  const vias: Via[] = [];
  let routed = 0;
  let failed: RouteResult['failed'] = [];
  for (let pass = 0; pass < 4; pass++) {
    const r = routeOnce(current, pads, opts);
    tracks.push(...r.tracks);
    vias.push(...r.vias);
    routed += r.routed;
    failed = r.failed;
    if (!(pcb.pours?.length) || r.routed === 0) break;
    const used = [...r.tracks.map((t) => t.id), ...r.vias.map((v) => v.id)].map((id) => Number(id.slice(1)));
    current = { ...current, tracks: [...current.tracks, ...r.tracks], vias: [...current.vias, ...r.vias], nextId: Math.max(current.nextId, ...used, 0) + 1 };
    if (ratsnest(current, pads).length === 0) {
      failed = [];
      break;
    }
  }
  return { tracks, vias, routed, failed };
}

function routeOnce(pcb: PcbDoc, pads: AbsPad[], opts: RouteOptions): RouteResult {
  const { clearance, trackWidth, viaDia, viaDrill, edgeClearance } = pcb.rules;
  const minWidth = Math.min(trackWidth, opts.minWidth ?? 0.2);
  const b = pcb.board;
  let g = opts.grid ?? 0.1;
  while (((b.w / g + 2) * (b.h / g + 2)) > 1_500_000) g *= 1.25; // keep the grid a manageable size on big boards
  const nx = Math.ceil(b.w / g) + 1;
  const ny = Math.ceil(b.h / g) + 1;
  const cells = nx * ny;
  const viaCost = opts.viaCost ?? 12;
  const turnCost = opts.turnCost ?? 0.6;
  // A layer that carries a plane is the worst place for a track: it cuts the plane. Routes prefer the other layer.
  const poured = [false, false];
  if (pcb.sides !== 1) for (const p of pcb.pours ?? []) poured[p.layer === 'top' ? 0 : 1] = true;

  const netIndex = new Map<string, number>();
  const idx = (net: string | null): number => {
    if (net === null) return BLOCKED;
    let i = netIndex.get(net);
    if (i === undefined) {
      i = netIndex.size + 1;
      netIndex.set(net, i);
    }
    return i;
  };

  const cx = (i: number): number => b.x + i * g;
  const cy = (j: number): number => b.y + j * g;
  const ix = (x: number): number => Math.round((x - b.x) / g);
  const iy = (y: number): number => Math.round((y - b.y) / g);

  /** Obstacle inflation seen by the centre of a track of width `w`. */
  const reachOf = (w: number): number => clearance + w / 2;
  /** A via needs this much more room than a track of width `w`. */
  const viaExtraOf = (w: number): number => Math.max(0, viaDia / 2 - w / 2);
  const wkey = (w: number): number => Math.round(w * 1000);

  /** Cells whose centre is inside the shape, as a callback per cell. */
  const paint = (layer: number, own: Int16Array, owner: number, bounds: { x0: number; y0: number; x1: number; y1: number }, inside: (p: Pt) => boolean): void => {
    const i0 = Math.max(0, ix(bounds.x0) - 1);
    const i1 = Math.min(nx - 1, ix(bounds.x1) + 1);
    const j0 = Math.max(0, iy(bounds.y0) - 1);
    const j1 = Math.min(ny - 1, iy(bounds.y1) + 1);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!inside({ x: cx(i), y: cy(j) })) continue;
        const c = layer * cells + j * nx + i;
        const cur = own[c];
        own[c] = cur === FREE || cur === owner ? owner : BLOCKED;
      }
    }
  };

  const only = opts.onlyLayer === undefined ? -1 : opts.onlyLayer === 'top' ? 0 : 1;

  const buildBase = (w: number): Int16Array => {
    const reach = reachOf(w);
    const own = new Int16Array(cells * 2);
    // Board edge margin.
    const m = edgeClearance + w / 2;
    for (let l = 0; l < 2; l++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = cx(i);
          const y = cy(j);
          if (x < b.x + m || x > b.x + b.w - m || y < b.y + m || y > b.y + b.h - m) own[l * cells + j * nx + i] = BLOCKED;
        }
      }
    }
    for (const it of copperItems(pcb, pads)) {
      const owner = idx(it.net);
      for (const layerName of it.layers) {
        const l = layerName === 'top' ? 0 : 1;
        if (it.c) {
          const r = it.r! + reach;
          paint(l, own, owner, { x0: it.c.x - r, y0: it.c.y - r, x1: it.c.x + r, y1: it.c.y + r }, (p) => Math.hypot(p.x - it.c!.x, p.y - it.c!.y) <= r);
        } else if (it.box) {
          paint(l, own, owner, { x0: it.box.x0 - reach, y0: it.box.y0 - reach, x1: it.box.x1 + reach, y1: it.box.y1 + reach }, (p) => pointBoxDist(p, it.box!) <= reach);
        } else if (it.a && it.b) {
          const r = it.halfWidth! + reach;
          paint(l, own, owner, { x0: Math.min(it.a.x, it.b.x) - r, y0: Math.min(it.a.y, it.b.y) - r, x1: Math.max(it.a.x, it.b.x) + r, y1: Math.max(it.a.y, it.b.y) + r }, (p) => pointSegDist(p, it.a!, it.b!) <= r);
        }
      }
    }
    if (only >= 0) own.fill(BLOCKED, (1 - only) * cells, (2 - only) * cells); // the other side carries no copper
    return own;
  };
  const bases = new Map<number, Int16Array>();
  const baseFor = (w: number): Int16Array => {
    let base = bases.get(wkey(w));
    if (!base) {
      base = buildBase(w);
      bases.set(wkey(w), base);
    }
    return base;
  };

  const padMap = new Map(pads.map((p) => [p.key, p]));
  const padCells = (p: AbsPad): number[] => {
    const out: number[] = [];
    const layers = only >= 0 ? [only] : p.smd ? [0] : [0, 1];
    const hw = p.w / 2;
    const hh = p.h / 2;
    for (let j = Math.max(0, iy(p.y - hh) - 1); j <= Math.min(ny - 1, iy(p.y + hh) + 1); j++) {
      for (let i = Math.max(0, ix(p.x - hw) - 1); i <= Math.min(nx - 1, ix(p.x + hw) + 1); i++) {
        const dx = Math.abs(cx(i) - p.x);
        const dy = Math.abs(cy(j) - p.y);
        const inside = p.shape === 'round' ? Math.hypot(dx, dy) <= hw : dx <= hw && dy <= hh;
        if (inside) for (const l of layers) out.push(l * cells + j * nx + i);
      }
    }
    if (out.length === 0) for (const l of layers) out.push(l * cells + Math.min(ny - 1, Math.max(0, iy(p.y))) * nx + Math.min(nx - 1, Math.max(0, ix(p.x))));
    return out;
  };

  // Search state, reused between connections.
  const gScore = new Float32Array(cells * 2);
  const stamp = new Uint32Array(cells * 2);
  const parent = new Int32Array(cells * 2);
  const dirOf = new Int8Array(cells * 2);
  const goalMark = new Uint32Array(cells * 2);
  const closed = new Uint32Array(cells * 2);
  let gen = 0;

  const viaOk = (own: Int16Array, owner: number, w: number, i: number, j: number): boolean => {
    const k = Math.ceil(viaExtraOf(w) / g);
    for (let dj = -k; dj <= k; dj++) {
      for (let di = -k; di <= k; di++) {
        const ci = i + di;
        const cj = j + dj;
        if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) return false;
        for (let l = 0; l < 2; l++) {
          const v = own[l * cells + cj * nx + ci];
          if (v !== FREE && v !== owner) return false;
        }
      }
    }
    return true;
  };

  /** One connection from any of the `sources` to any of the `targets` with a track of width `w`. Returns the cell path (start first) or null. */
  const search = (own: Int16Array, band: Int16Array, owner: number, w: number, sources: number[], targets: number[], to: AbsPad): number[] | null => {
    gen++;
    for (const c of targets) goalMark[c] = gen;
    const gx = ix(to.x);
    const gy = iy(to.y);
    const h = (c: number): number => {
      const cell = c % cells;
      const dx = Math.abs((cell % nx) - gx);
      const dy = Math.abs(Math.floor(cell / nx) - gy);
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const open = new Heap();
    for (const c of sources) {
      stamp[c] = gen;
      gScore[c] = 0;
      parent[c] = -1;
      dirOf[c] = -1;
      open.push(h(c), c);
    }
    let found = -1;
    let expanded = 0;
    while (open.size) {
      const c = open.pop();
      if (closed[c] === gen) continue; // stale heap entry: a cheaper way to this cell was already expanded
      closed[c] = gen;
      if (goalMark[c] === gen) {
        found = c;
        break;
      }
      if (++expanded > MAX_EXPANDED) break;
      const layer = c >= cells ? 1 : 0;
      const cell = c - layer * cells;
      const i = cell % nx;
      const j = (cell - i) / nx;
      const gc = gScore[c];
      const relax = (n: number, cost: number, d: number): void => {
        const ng = gc + cost + (dirOf[c] >= 0 && d >= 0 && d !== dirOf[c] ? turnCost : 0);
        if (stamp[n] === gen && gScore[n] <= ng) return;
        stamp[n] = gen;
        gScore[n] = ng;
        parent[n] = c;
        dirOf[n] = d;
        open.push(ng + h(n), n);
      };
      for (let d = 0; d < 8; d++) {
        const ni = i + DIRS[d][0];
        const nj = j + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        const n = layer * cells + nj * nx + ni;
        const o = own[n];
        if (o !== FREE && o !== owner) continue;
        const diagonal = d >= 4;
        if (diagonal) {
          // No cutting corners through another net's copper.
          const o1 = own[layer * cells + j * nx + ni];
          const o2 = own[layer * cells + nj * nx + i];
          if ((o1 !== FREE && o1 !== owner) || (o2 !== FREE && o2 !== owner)) continue;
        }
        // Each layer prefers one direction (top: horizontal, bottom: vertical) to keep routing orderly.
        const horizontal = d < 2;
        const vertical = d >= 2 && d < 4;
        const penalty = (only < 0 && ((layer === 0 && vertical) || (layer === 1 && horizontal)) ? 0.25 : 0) + (poured[layer] ? 0.7 : 0) + (band[n] === owner ? BAND_COST : 0);
        relax(n, (diagonal ? Math.SQRT2 : 1) + penalty, d);
      }
      // Via to the other layer at the same cell.
      const other = (1 - layer) * cells + cell;
      const oo = own[other];
      if ((oo === FREE || oo === owner) && viaOk(own, owner, w, i, j)) relax(other, viaCost, -1);
    }
    if (found < 0) {
      if (opts.debug) {
        const stat = (list: number[]): string => {
          let free = 0;
          let mine = 0;
          let blocked = 0;
          for (const c of list) {
            const v = own[c];
            if (v === FREE) free++;
            else if (v === owner) mine++;
            else blocked++;
          }
          return `${list.length} cells (${free} free, ${mine} own, ${blocked} blocked)`;
        };
        opts.debug(`no path at ${w} mm to ${to.key}: expanded ${expanded}; start ${stat(sources)}; goal ${stat(targets)}`);
      }
      return null;
    }
    const path: number[] = [];
    for (let c = found; c >= 0; c = parent[c]) path.push(c);
    return path.reverse();
  };

  const wires = ratsnest(pcb, pads);
  const len = (w: AirWire): number => Math.hypot(w.a.x - w.b.x, w.a.y - w.b.y);
  const prefOf = (net: string): number => Math.max(opts.netWidths?.get(net) ?? trackWidth, minWidth);
  /** Widths to try for a net, widest first: its preferred width, the board's track width, then the minimum. */
  const candidatesOf = (net: string): number[] => {
    const pref = prefOf(net);
    const list = [pref];
    for (const w of [trackWidth, minWidth]) if (w < list[list.length - 1] - 1e-9) list.push(w);
    return list;
  };
  const orderings: Array<(a: AirWire, c: AirWire) => number> = [
    (a, c) => len(a) - len(c), // short connections first
    (a, c) => len(c) - len(a), // long ones first
    (a, c) => a.net.localeCompare(c.net) || len(a) - len(c),
  ];
  const attempts = Math.min(opts.attempts ?? 3, orderings.length);

  let best: { result: RouteResult; score: number } | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const out = { tracks: [] as Track[], vias: [] as Via[], nextId: pcb.nextId };
    const failed: RouteResult['failed'] = [];
    const grids = new Map<number, Int16Array>();
    const band = new Int16Array(cells * 2);
    // Copper of this attempt by pad: pads joined by routes made so far share a group and the cells of its tracks.
    const groupOf = new Map<string, number>();
    const groupCells = new Map<number, Set<number>>();
    let nextGroup = 1;
    let routed = 0;

    const paintTrack = (own: Int16Array, w: number, owner: number, t: Track): void => {
      const l = t.layer === 'top' ? 0 : 1;
      const r = t.width / 2 + reachOf(w);
      for (let s = 1; s < t.pts.length; s++) {
        const a = t.pts[s - 1];
        const c = t.pts[s];
        paint(l, own, owner, { x0: Math.min(a.x, c.x) - r, y0: Math.min(a.y, c.y) - r, x1: Math.max(a.x, c.x) + r, y1: Math.max(a.y, c.y) + r }, (p) => pointSegDist(p, a, c) <= r);
      }
    };
    const paintVia = (own: Int16Array, w: number, owner: number, v: Via): void => {
      const r = v.dia / 2 + reachOf(w);
      for (let l = 0; l < 2; l++) paint(l, own, owner, { x0: v.x - r, y0: v.y - r, x1: v.x + r, y1: v.y + r }, (p) => Math.hypot(p.x - v.x, p.y - v.y) <= r);
    };
    /** Marks the cells close to a track of the net: running there is discouraged. */
    const markBand = (owner: number, t: Track): void => {
      const l = t.layer === 'top' ? 0 : 1;
      const r = t.width * 1.25;
      for (let s = 1; s < t.pts.length; s++) {
        const a = t.pts[s - 1];
        const c = t.pts[s];
        const i0 = Math.max(0, ix(Math.min(a.x, c.x) - r) - 1);
        const i1 = Math.min(nx - 1, ix(Math.max(a.x, c.x) + r) + 1);
        const j0 = Math.max(0, iy(Math.min(a.y, c.y) - r) - 1);
        const j1 = Math.min(ny - 1, iy(Math.max(a.y, c.y) + r) + 1);
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (pointSegDist({ x: cx(i), y: cy(j) }, a, c) <= r) band[l * cells + j * nx + i] = owner;
      }
    };
    /** The occupancy grid for tracks of width `w`, with everything routed so far painted in. */
    const gridFor = (w: number): Int16Array => {
      let own = grids.get(wkey(w));
      if (!own) {
        own = baseFor(w).slice();
        for (const t of out.tracks) paintTrack(own, w, idx(t.net), t);
        for (const v of out.vias) paintVia(own, w, idx(v.net), v);
        grids.set(wkey(w), own);
      }
      return own;
    };

    /** Turns a cell path into tracks and vias, paints them into every grid and joins the groups of both pads. */
    const commit = (owner: number, net: string, width: number, from: AbsPad, to: AbsPad, path: number[], startOnPad: boolean, endOnPad: boolean): void => {
      const point = (c: number): { l: Layer; p: Pt } => {
        const layer = c >= cells ? 1 : 0;
        const cell = c - layer * cells;
        const i = cell % nx;
        return { l: layer === 0 ? 'top' : 'bottom', p: { x: cx(i), y: cy((cell - i) / nx) } };
      };
      const newVias: Via[] = [];
      const newTracks: Track[] = [];
      const runs: Array<{ layer: Layer; pts: Pt[] }> = [];
      const first = point(path[0]);
      let cur = { layer: first.l, pts: startOnPad ? [{ x: from.x, y: from.y }, first.p] : [first.p] };
      for (let k = 1; k < path.length; k++) {
        const q = point(path[k]);
        if (q.l !== cur.layer) {
          // Layer change: the via sits at the shared cell.
          const at = cur.pts[cur.pts.length - 1];
          newVias.push({ id: `v${out.nextId++}`, x: at.x, y: at.y, dia: viaDia, drill: viaDrill, net });
          runs.push(cur);
          cur = { layer: q.l, pts: [q.p] };
        } else cur.pts.push(q.p);
      }
      if (endOnPad) cur.pts.push({ x: to.x, y: to.y });
      runs.push(cur);
      for (const run of runs) {
        const pts = simplify(run.pts);
        if (pts.length < 2) continue;
        newTracks.push({ id: `t${out.nextId++}`, layer: run.layer, width, pts, net });
      }
      for (const t of newTracks) {
        out.tracks.push(t);
        markBand(owner, t);
        for (const [k, own] of grids) paintTrack(own, k / 1000, owner, t);
      }
      for (const v of newVias) {
        out.vias.push(v);
        for (const [k, own] of grids) paintVia(own, k / 1000, owner, v);
      }
      // Join the groups of both pads and add the cells of this path to the result.
      const gf = groupOf.get(from.key) ?? nextGroup++;
      const gt = groupOf.get(to.key);
      const cellsOfGroup = groupCells.get(gf) ?? new Set<number>();
      if (gt !== undefined && gt !== gf) {
        for (const c of groupCells.get(gt) ?? []) cellsOfGroup.add(c);
        groupCells.delete(gt);
        for (const [key, gid] of groupOf) if (gid === gt) groupOf.set(key, gf);
      }
      for (const c of path) cellsOfGroup.add(c);
      groupCells.set(gf, cellsOfGroup);
      groupOf.set(from.key, gf);
      groupOf.set(to.key, gf);
    };

    const sorted = [...wires].sort((a, c) => prefOf(c.net) - prefOf(a.net) || orderings[attempt](a, c));
    for (const w of sorted) {
      const from = padMap.get(w.aKey);
      const to = padMap.get(w.bKey);
      if (!from || !to) continue;
      const gf = groupOf.get(from.key);
      const gt = groupOf.get(to.key);
      if (gf !== undefined && gf === gt) {
        routed++; // an earlier route of this net already joined them
        continue;
      }
      const owner = idx(w.net);
      const fromCells = padCells(from);
      const toCells = padCells(to);
      const sources = [...new Set([...fromCells, ...(gf !== undefined ? groupCells.get(gf)! : [])])];
      const targets = [...new Set([...toCells, ...(gt !== undefined ? groupCells.get(gt)! : [])])];
      let path: number[] | null = null;
      let used = trackWidth;
      for (const width of candidatesOf(w.net)) {
        path = search(gridFor(width), band, owner, width, sources, targets, to);
        if (path) {
          used = width;
          break;
        }
      }
      if (!path) {
        failed.push({ net: w.net, from: w.aKey, to: w.bKey });
        continue;
      }
      commit(owner, w.net, used, from, to, path, new Set(fromCells).has(path[0]), new Set(toCells).has(path[path.length - 1]));
      routed++;
    }
    const result = { tracks: out.tracks, vias: out.vias, routed, failed };
    const copper = out.tracks.reduce((s, t) => s + t.pts.slice(1).reduce((u, p, k) => u + Math.hypot(p.x - t.pts[k].x, p.y - t.pts[k].y), 0), 0);
    const score = failed.length * 1e6 + copper + out.vias.length * 20;
    if (!best || score < best.score) best = { result, score };
    if (failed.length === 0 && attempt === 0) break; // a complete first attempt is shortest-first: good enough
  }
  return best?.result ?? { tracks: [], vias: [], routed: 0, failed: [] };
}

/** Drops duplicate points and points on a straight line between their neighbours. */
export function simplify(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push(p);
    while (out.length >= 3) {
      const a = out[out.length - 3];
      const m = out[out.length - 2];
      const c = out[out.length - 1];
      const cross = (m.x - a.x) * (c.y - m.y) - (m.y - a.y) * (c.x - m.x);
      const dot = (m.x - a.x) * (c.x - m.x) + (m.y - a.y) * (c.y - m.y);
      if (Math.abs(cross) < 1e-9 && dot > 0) out.splice(out.length - 2, 1);
      else break;
    }
  }
  return out;
}
