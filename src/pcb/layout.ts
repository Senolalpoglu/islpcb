// One-step PCB layout: arrange the parts, choose track widths and route, trying several arrangements and keeping the best.

import { autoPlace, type PlaceResult } from '../../core/pcb/place';
import { autoroute, type RouteResult } from '../../core/pcb/router';
import { Simulator } from '../../core/sim/solver';
import type { PcbDoc } from '../../core/pcb/types';
import { PART_DEFS, type Doc } from '../editor/model';
import { extractNetlist, type Extracted } from '../editor/netlist';
import { padNets, padsWithNets, syncPcb } from './sync';

/** Pin names that mean a supply or ground rail. */
const POWER_PIN = /^(GND|AGND|DGND|VSS|VCC|VDD|VEE|VBUS|VIN|VOUT|VBAT|V\+|V-|\+?\d+V\d*|\+)$/i;

/**
 * Preferred track width of every net, in mm. A net that carries current gets the width its current needs
 * (about 0.5 mm per ampere on 1 oz copper); supply and ground nets are at least twice the signal width.
 */
export function netWidths(doc: Doc, x: Extracted, pcb: PcbDoc, nets: Map<string, string>): Map<string, number> {
  const base = pcb.rules.trackWidth;
  const out = new Map<string, number>();
  const raise = (net: string, w: number): void => {
    out.set(net, Math.max(out.get(net) ?? base, Math.min(w, 3)));
  };
  for (const net of new Set(nets.values())) out.set(net, base);

  for (const part of doc.parts) {
    PART_DEFS[part.type]?.pinNames.forEach((name, i) => {
      const net = nets.get(`${part.id}:${i}`);
      if (net !== undefined && (POWER_PIN.test(name) || net === 'GND')) raise(net, Math.min(base * 2, 0.8));
    });
  }

  if (x.netlist) {
    try {
      const s = new Simulator(x.netlist).operatingPoint();
      for (const part of doc.parts) {
        const id = x.primary.get(part.id) ?? (x.elementIds.has(part.id) ? part.id : undefined);
        const amps = id !== undefined ? Math.abs(s.i[id] ?? 0) : 0;
        if (!(amps > 0.3)) continue;
        PART_DEFS[part.type]?.pins.forEach((_, i) => {
          const net = nets.get(`${part.id}:${i}`);
          if (net !== undefined) raise(net, amps * 0.5);
        });
      }
    } catch {
      // A circuit that does not solve still gets the name-based widths.
    }
  }
  return out;
}

export interface LayoutOptions {
  /** 1: single-sided board (copper on the bottom, no vias); 2: double-sided. Default: as the board is now. */
  sides?: 1 | 2;
  /** Arrangements to try. */
  tries?: number;
  /** Keep the board size unless the parts do not fit (default: size the board to the parts). */
  keepBoard?: boolean;
  /** Only arrange the parts, do not route. */
  placeOnly?: boolean;
  /** Part ids that must stay where they are. */
  fixed?: Set<string>;
}

export interface LayoutResult {
  pcb: PcbDoc;
  routed: number;
  failed: RouteResult['failed'];
  /** Air wires of different nets that cross in the chosen arrangement. */
  crossings: number;
  /** The distinct track widths in the result, narrowest first. */
  widthsUsed: number[];
}

/** Brings the PCB in line with the schematic, then places the parts and routes the board. */
export function autoLayout(doc: Doc, pcb: PcbDoc, opts: LayoutOptions = {}): LayoutResult {
  const x = extractNetlist(doc);
  const sides = opts.sides ?? pcb.sides ?? 2;
  const synced = syncPcb(doc, x, pcb);
  const base: PcbDoc = { ...synced, sides, tracks: [], vias: [] };
  const nets = padNets(doc, x);
  const widths = netWidths(doc, x, base, nets);
  const tries = Math.max(1, opts.tries ?? (base.fps.length > 25 ? 3 : 4));
  // Footprints placed by hand stay put; the board is not resized around them unless the rest does not fit.
  const fixed = new Set([...(opts.fixed ?? []), ...base.fps.filter((f) => f.locked).map((f) => f.partId)]);
  const keepBoard = opts.keepBoard === true || fixed.size > 0;
  const route = (p: PcbDoc, attempts: number): RouteResult => autoroute(p, padsWithNets(p, nets, doc), { netWidths: widths, attempts, ...(sides === 1 ? { onlyLayer: 'bottom' as const } : {}) });

  let best: { placed: PlaceResult; routed: RouteResult | null } | null = null;
  for (let seed = 1; seed <= tries; seed++) {
    const placed = autoPlace(base, nets, { seed, board: keepBoard ? 'keep' : 'auto', ...(fixed.size ? { fixed } : {}) });
    if (opts.placeOnly) {
      if (!best || placed.cost < best.placed.cost) best = { placed, routed: null };
      continue;
    }
    const routed = route(placed.pcb, 1);
    const better = !best || routed.failed.length < best.routed!.failed.length || (routed.failed.length === best.routed!.failed.length && placed.wirelength < best.placed.wirelength);
    if (better) best = { placed, routed };
    if (routed.failed.length === 0) break;
  }
  if (!best) return { pcb: base, routed: 0, failed: [], crossings: 0, widthsUsed: [] };
  if (!best.routed) return { pcb: best.placed.pcb, routed: 0, failed: [], crossings: best.placed.crossings, widthsUsed: [] };

  // The winner gets the thorough routing: all orderings, keeping the best.
  let result = best.routed;
  if (result.failed.length > 0) {
    const again = route(best.placed.pcb, 3);
    if (again.failed.length < result.failed.length) result = again;
  }
  const ids = [...result.tracks.map((t) => t.id), ...result.vias.map((v) => v.id)].map((id) => Number(id.slice(1)));
  const routedPcb: PcbDoc = { ...best.placed.pcb, tracks: result.tracks, vias: result.vias, nextId: Math.max(best.placed.pcb.nextId, ...ids, 0) + 1 };
  const widthsUsed = [...new Set(result.tracks.map((t) => t.width))].sort((a, b) => a - b);
  return { pcb: routedPcb, routed: result.routed, failed: result.failed, crossings: best.placed.crossings, widthsUsed };
}
