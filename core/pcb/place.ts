// Automatic placement: simulated annealing over the position and rotation of every footprint.
//
// The cost is the total length of the nets (half-perimeter of each net's pads), plus a penalty for every pair of
// air wires of different nets that cross (on a single-sided board a crossing cannot be routed at all), plus a
// heavy penalty for overlapping parts or parts outside the board. Connectors are drawn towards the board edge.
// The result is deterministic for a given seed, so several seeds can be tried and the best routed one kept.

import { absolutePads, baseKey, footprintById, footprintExtent } from './footprints';
import type { FootprintInst, PcbDoc, Rot } from './types';

export interface PlaceOptions {
  seed?: number;
  /** Annealing steps. */
  iterations?: number;
  /** Space kept between parts for tracks to pass, in mm. */
  gap?: number;
  /** Part ids that must stay where they are. */
  fixed?: Set<string>;
  /** `auto` sizes the board to the parts; `keep` leaves it unless the parts do not fit. */
  board?: 'auto' | 'keep';
}

export interface PlaceResult {
  pcb: PcbDoc;
  cost: number;
  /** Total net length (half-perimeter), mm. */
  wirelength: number;
  /** Pairs of air wires of different nets that cross. */
  crossings: number;
  /** Pairs of parts that still overlap after placing (0 unless the board is far too small). */
  overlaps: number;
}

const ROTS: Rot[] = [0, 90, 180, 270];
const SNAP = 0.5;
const W_OVERLAP = 40;
const W_OUTSIDE = 40;

const mulberry = (seed: number): (() => number) => {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Info {
  fp: FootprintInst;
  /** Per rotation: offsets of the pads that belong to a net, from the footprint centre. */
  pads: Array<Array<{ dx: number; dy: number }>>;
  ext: Array<{ w: number; h: number }>;
  connector: boolean;
  fixed: boolean;
}

/** `netOfPad` maps pad keys (`${partId}:${pin}`) to net names, as `padNets` returns. */
export function autoPlace(pcb: PcbDoc, netOfPad: Map<string, string>, opts: PlaceOptions = {}): PlaceResult {
  const gap = opts.gap ?? 1.6;
  const rand = mulberry(opts.seed ?? 1);
  const crossW = pcb.sides === 1 ? 10 : 2;
  const margin = pcb.rules.edgeClearance + 0.4;

  const netId = new Map<string, number>();
  const infos: Info[] = [];
  const pinsOfNet: Array<Array<[number, number]>> = [];
  for (const fp of pcb.fps) {
    const def = footprintById(fp.footprint);
    if (!def) continue;
    const part = infos.length;
    const pads: Info['pads'] = [];
    const ext: Info['ext'] = [];
    for (const rot of ROTS) {
      const inst = { ...fp, x: 0, y: 0, rot };
      const list: Array<{ dx: number; dy: number }> = [];
      for (const p of absolutePads(inst, def)) {
        const net = netOfPad.get(baseKey(p.key));
        if (net === undefined) continue;
        list.push({ dx: p.x, dy: p.y });
        if (rot === 0) {
          let id = netId.get(net);
          if (id === undefined) {
            id = netId.size;
            netId.set(net, id);
            pinsOfNet.push([]);
          }
          pinsOfNet[id].push([part, list.length - 1]);
        }
      }
      pads.push(list);
      ext.push(footprintExtent(inst, def));
    }
    infos.push({ fp, pads, ext, connector: /^(TERM|HDR|BOARD_)/.test(fp.footprint), fixed: opts.fixed?.has(fp.partId) === true });
  }
  const n = infos.length;
  if (n === 0) return { pcb, cost: 0, wirelength: 0, crossings: 0, overlaps: 0 };
  const nets = pinsOfNet.filter((p) => p.length >= 2);
  // Big nets (ground, supply) tie everything together; they should not dominate the arrangement.
  const weight = nets.map((p) => (p.length > 8 ? 0.4 : 1));

  // Board: sized to the parts, or grown when they do not fit with room left for tracks.
  const board = { ...pcb.board };
  const need = infos.reduce((s, i) => s + (i.ext[0].w + gap) * (i.ext[0].h + gap), 0);
  const util = pcb.sides === 1 ? 0.3 : 0.4;
  const widest = Math.max(...infos.map((i) => Math.max(i.ext[0].w, i.ext[0].h))) + 2 * margin;
  const ceil5 = (v: number): number => Math.ceil(v / 5) * 5;
  if (opts.board === 'auto' || board.w * board.h * util * 1.5 < need) {
    const side = Math.sqrt(need / util);
    const aspect = Math.min(2.2, Math.max(1, board.w / board.h));
    board.w = Math.max(ceil5(side * Math.sqrt(aspect)), ceil5(widest));
    board.h = Math.max(ceil5(side / Math.sqrt(aspect)), ceil5(widest));
  }

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const r = new Int8Array(n);

  const initial = (): void => {
    // Shelf packing, tallest parts first, then annealed from there.
    const order = [...infos.keys()].sort((a, c) => infos[c].ext[0].h - infos[a].ext[0].h);
    let cxp = board.x + margin;
    let cyp = board.y + margin;
    let rowH = 0;
    for (const i of order) {
      const e = infos[i].ext[0];
      if (cxp + e.w > board.x + board.w - margin && rowH > 0) {
        cxp = board.x + margin;
        cyp += rowH + gap;
        rowH = 0;
      }
      x[i] = cxp + e.w / 2;
      y[i] = cyp + e.h / 2;
      r[i] = 0;
      cxp += e.w + gap;
      rowH = Math.max(rowH, e.h);
    }
    for (let i = 0; i < n; i++) {
      if (!infos[i].fixed) continue;
      x[i] = infos[i].fp.x;
      y[i] = infos[i].fp.y;
      r[i] = Math.max(0, ROTS.indexOf(infos[i].fp.rot));
    }
  };
  initial();

  // Scratch space for one evaluation.
  const maxPins = Math.max(2, ...nets.map((p) => p.length));
  const px = new Float64Array(maxPins);
  const py = new Float64Array(maxPins);
  const segs: number[] = []; // x1, y1, x2, y2, net

  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean => {
    const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
    const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
    const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
    return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
  };

  const stats = { wl: 0, cr: 0, ov: 0 };
  const evaluate = (): number => {
    let wl = 0;
    segs.length = 0;
    for (let k = 0; k < nets.length; k++) {
      const pins = nets[k];
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let q = 0; q < pins.length; q++) {
        const [part, pad] = pins[q];
        const o = infos[part].pads[r[part]][pad];
        px[q] = x[part] + o.dx;
        py[q] = y[part] + o.dy;
        if (px[q] < x0) x0 = px[q];
        if (px[q] > x1) x1 = px[q];
        if (py[q] < y0) y0 = py[q];
        if (py[q] > y1) y1 = py[q];
      }
      wl += weight[k] * (x1 - x0 + (y1 - y0));
      if (crossW > 0 && pins.length <= 24) {
        // Prim's spanning tree: the air wires the router will have to lay.
        const done = new Uint8Array(pins.length);
        const best = new Float64Array(pins.length).fill(Infinity);
        const from = new Int32Array(pins.length).fill(-1);
        let cur = 0;
        done[0] = 1;
        for (let step = 1; step < pins.length; step++) {
          for (let q = 0; q < pins.length; q++) {
            if (done[q]) continue;
            const d = Math.hypot(px[q] - px[cur], py[q] - py[cur]);
            if (d < best[q]) {
              best[q] = d;
              from[q] = cur;
            }
          }
          let next = -1;
          for (let q = 0; q < pins.length; q++) if (!done[q] && (next < 0 || best[q] < best[next])) next = q;
          done[next] = 1;
          segs.push(px[from[next]], py[from[next]], px[next], py[next], k);
          cur = next;
        }
      }
    }
    let cr = 0;
    for (let a = 0; a < segs.length; a += 5) {
      for (let c = a + 5; c < segs.length; c += 5) {
        if (segs[a + 4] === segs[c + 4]) continue;
        if (cross(segs[a], segs[a + 1], segs[a + 2], segs[a + 3], segs[c], segs[c + 1], segs[c + 2], segs[c + 3])) cr++;
      }
    }
    let ov = 0;
    let pen = 0;
    for (let i = 0; i < n; i++) {
      const ei = infos[i].ext[r[i]];
      const hw = ei.w / 2;
      const hh = ei.h / 2;
      const out = Math.max(0, board.x + margin - (x[i] - hw)) + Math.max(0, x[i] + hw - (board.x + board.w - margin)) + Math.max(0, board.y + margin - (y[i] - hh)) + Math.max(0, y[i] + hh - (board.y + board.h - margin));
      pen += out * W_OUTSIDE;
      if (infos[i].connector) {
        const d = Math.min(x[i] - hw - board.x, board.x + board.w - (x[i] + hw), y[i] - hh - board.y, board.y + board.h - (y[i] + hh));
        pen += Math.max(0, d) * 0.5;
      }
      for (let j = i + 1; j < n; j++) {
        const ej = infos[j].ext[r[j]];
        const ox = (ei.w + ej.w) / 2 + gap - Math.abs(x[i] - x[j]);
        if (ox <= 0) continue;
        const oy = (ei.h + ej.h) / 2 + gap - Math.abs(y[i] - y[j]);
        if (oy <= 0) continue;
        ov++;
        pen += Math.min(ox, oy) * W_OVERLAP + ox * oy;
      }
    }
    stats.wl = wl;
    stats.cr = cr;
    stats.ov = ov;
    return wl + cr * crossW + pen;
  };

  const movable = [...infos.keys()].filter((i) => !infos[i].fixed);
  const iterations = opts.iterations ?? Math.min(60000, 4000 + n * 1800);
  const span = Math.max(board.w, board.h);
  const t0 = span * 0.12;
  const tEnd = 0.02;
  let cost = evaluate();
  let bestCost = cost;
  let bestState = { x: Float64Array.from(x), y: Float64Array.from(y), r: Int8Array.from(r) };
  const snap = (v: number): number => Math.round(v / SNAP) * SNAP;

  for (let it = 0; it < iterations && movable.length > 0; it++) {
    const f = it / iterations;
    const temp = t0 * Math.pow(tEnd / t0, f);
    const step = Math.max(SNAP, span * 0.35 * (1 - f) * (1 - f));
    const a = movable[Math.floor(rand() * movable.length)];
    const kind = rand();
    const ox = x[a];
    const oy = y[a];
    const orot = r[a];
    let b = -1;
    let bx = 0;
    let by = 0;
    if (kind < 0.62) {
      x[a] = snap(ox + (rand() - 0.5) * 2 * step);
      y[a] = snap(oy + (rand() - 0.5) * 2 * step);
    } else if (kind < 0.8 && movable.length > 1) {
      b = movable[Math.floor(rand() * movable.length)];
      if (b === a) continue;
      bx = x[b];
      by = y[b];
      x[a] = bx;
      y[a] = by;
      x[b] = ox;
      y[b] = oy;
    } else {
      r[a] = (orot + 1 + Math.floor(rand() * 3)) % 4;
    }
    const next = evaluate();
    const delta = next - cost;
    if (delta <= 0 || rand() < Math.exp(-delta / temp)) {
      cost = next;
      if (cost < bestCost) {
        bestCost = cost;
        bestState = { x: Float64Array.from(x), y: Float64Array.from(y), r: Int8Array.from(r) };
      }
    } else {
      x[a] = ox;
      y[a] = oy;
      r[a] = orot;
      if (b >= 0) {
        x[b] = bx;
        y[b] = by;
      }
    }
  }
  x.set(bestState.x);
  y.set(bestState.y);
  r.set(bestState.r);

  // Legalise: push overlapping parts apart and pull everything inside the board.
  for (let pass = 0; pass < 400; pass++) {
    let moved = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ei = infos[i].ext[r[i]];
        const ej = infos[j].ext[r[j]];
        const ox = (ei.w + ej.w) / 2 + gap - Math.abs(x[i] - x[j]);
        const oy = (ei.h + ej.h) / 2 + gap - Math.abs(y[i] - y[j]);
        if (ox <= 1e-6 || oy <= 1e-6) continue;
        moved = true;
        const wi = infos[i].fixed ? 0 : infos[j].fixed ? 1 : 0.5;
        const wj = 1 - wi;
        if (ox < oy) {
          const s = x[i] < x[j] ? -1 : 1;
          x[i] += s * ox * wi;
          x[j] -= s * ox * wj;
        } else {
          const s = y[i] < y[j] ? -1 : 1;
          y[i] += s * oy * wi;
          y[j] -= s * oy * wj;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (infos[i].fixed) continue;
      const e = infos[i].ext[r[i]];
      const nx = Math.min(board.x + board.w - margin - e.w / 2, Math.max(board.x + margin + e.w / 2, x[i]));
      const ny = Math.min(board.y + board.h - margin - e.h / 2, Math.max(board.y + margin + e.h / 2, y[i]));
      if (Math.abs(nx - x[i]) > 1e-9 || Math.abs(ny - y[i]) > 1e-9) moved = true;
      x[i] = nx;
      y[i] = ny;
    }
    if (!moved) break;
  }
  for (let i = 0; i < n; i++) {
    if (infos[i].fixed) continue;
    x[i] = Math.round(x[i] * 10) / 10;
    y[i] = Math.round(y[i] * 10) / 10;
  }
  const final = evaluate();

  const placed = new Map(infos.map((info, i) => [info.fp.partId, { ...info.fp, x: x[i], y: y[i], rot: ROTS[r[i]] }]));
  return {
    pcb: { ...pcb, board, fps: pcb.fps.map((f) => placed.get(f.partId) ?? f), tracks: [], vias: [] },
    cost: final,
    wirelength: stats.wl,
    crossings: stats.cr,
    overlaps: stats.ov,
  };
}
