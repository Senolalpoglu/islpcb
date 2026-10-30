import { beforeAll, describe, expect, it } from 'vitest';
import { runDrc } from '../core/pcb/drc';
import { footprintById, footprintExtent } from '../core/pcb/footprints';
import { autoPlace } from '../core/pcb/place';
import { ratsnest } from '../core/pcb/ratsnest';
import { autoroute } from '../core/pcb/router';
import { emptyPcb, type PcbDoc, type Track } from '../core/pcb/types';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { emptyDoc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';
import { executeTool, type Workspace } from '../src/operator/tools';
import { autoLayout, netWidths } from '../src/pcb/layout';
import { padNets, padsWithNets, syncPcb } from '../src/pcb/sync';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.build();

/** Pairs of tracks of one net that run side by side on one layer, so that their copper lies on top of each other. */
function stackedTracks(tracks: Track[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i];
      const b = tracks[j];
      if (a.net !== b.net || a.layer !== b.layer) continue;
      for (let s = 1; s < a.pts.length; s++) {
        for (let u = 1; u < b.pts.length; u++) {
          const p = a.pts[s - 1];
          const q = a.pts[s];
          const m = b.pts[u - 1];
          const n = b.pts[u];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const len = Math.hypot(dx, dy);
          if (len < 1e-9) continue;
          const ux = dx / len;
          const uy = dy / len;
          const side = (v: { x: number; y: number }): number => (v.x - p.x) * -uy + (v.y - p.y) * ux;
          const along = (v: { x: number; y: number }): number => (v.x - p.x) * ux + (v.y - p.y) * uy;
          if (Math.abs(side(m) - side(n)) > 1e-3) continue; // not parallel
          if (Math.abs(side(m)) >= Math.max(a.width, b.width)) continue; // far enough apart
          const overlap = Math.min(len, Math.max(along(m), along(n))) - Math.max(0, Math.min(along(m), along(n)));
          if (overlap > 0.3) out.push(`${a.id}/${b.id} on ${a.net}`);
        }
      }
    }
  }
  return out;
}

describe('router keeps the copper of a net in one tree', () => {
  it.each(['us-driver', 'inverter', 'fm-tx'])('%s has no tracks laid on top of each other', (id) => {
    const doc = example(id);
    const x = extractNetlist(doc);
    for (const sides of [1, 2] as const) {
      const pcb: PcbDoc = { ...syncPcb(doc, x, emptyPcb()), sides };
      const placed = autoPlace(pcb, padNets(doc, x), { seed: 2, board: 'auto' }).pcb;
      const pads = padsWithNets(placed, padNets(doc, x), doc);
      const r = autoroute(placed, pads, { attempts: 1, ...(sides === 1 ? { onlyLayer: 'bottom' as const } : {}) });
      expect(stackedTracks(r.tracks), `${id} sides=${sides}`).toEqual([]);
      expect(runDrc({ ...placed, tracks: r.tracks, vias: r.vias }, pads).filter((i) => i.kind !== 'unrouted')).toEqual([]);
    }
  }, 120000);
});

describe('automatic placement', () => {
  it('leaves no parts overlapping and keeps them on the board', () => {
    const doc = example('us-driver');
    const x = extractNetlist(doc);
    const pcb: PcbDoc = { ...syncPcb(doc, x, emptyPcb()), sides: 1 };
    const r = autoPlace(pcb, padNets(doc, x), { seed: 3, board: 'auto' });
    expect(r.overlaps).toBe(0);
    const boxes = r.pcb.fps.map((f) => {
      const e = footprintExtent(f, footprintById(f.footprint)!);
      return { x0: f.x - e.w / 2, x1: f.x + e.w / 2, y0: f.y - e.h / 2, y1: f.y + e.h / 2 };
    });
    for (const b of boxes) {
      expect(b.x0).toBeGreaterThanOrEqual(r.pcb.board.x);
      expect(b.y0).toBeGreaterThanOrEqual(r.pcb.board.y);
      expect(b.x1).toBeLessThanOrEqual(r.pcb.board.x + r.pcb.board.w);
      expect(b.y1).toBeLessThanOrEqual(r.pcb.board.y + r.pcb.board.h);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1, `parts ${i} and ${j} overlap`).toBe(false);
    }
  });

  it('is deterministic for a seed and shorter than the row layout it starts from', () => {
    const doc = example('fm-tx');
    const x = extractNetlist(doc);
    const pcb = syncPcb(doc, x, emptyPcb());
    const nets = padNets(doc, x);
    const a = autoPlace(pcb, nets, { seed: 5 });
    const b = autoPlace(pcb, nets, { seed: 5 });
    expect(a.pcb.fps.map((f) => [f.x, f.y, f.rot])).toEqual(b.pcb.fps.map((f) => [f.x, f.y, f.rot]));
    const rows = autoPlace(pcb, nets, { seed: 5, iterations: 1, board: 'keep' });
    expect(a.wirelength).toBeLessThan(rows.wirelength);
  });
});

describe('auto layout of the transducer driver on a single-sided board', () => {
  it('arranges, sizes and routes the board with only the bottom copper', () => {
    const doc = example('us-driver');
    const r = autoLayout(doc, emptyPcb(), { sides: 1 });
    expect(r.pcb.sides).toBe(1);
    expect(r.pcb.vias).toEqual([]);
    expect(r.pcb.tracks.every((t) => t.layer === 'bottom')).toBe(true);
    // Only connections that truly cross another net are left, and they are reported.
    expect(r.failed.length).toBeLessThanOrEqual(3);
    expect(r.routed).toBeGreaterThan(35);
    const x = extractNetlist(doc);
    const pads = padsWithNets(r.pcb, padNets(doc, x), doc);
    expect(runDrc(r.pcb, pads).filter((i) => i.kind !== 'unrouted')).toEqual([]);
    expect(ratsnest(r.pcb, pads).length).toBe(r.failed.length);
    expect(stackedTracks(r.pcb.tracks)).toEqual([]);
  }, 180000);

  it('routes a small circuit completely', () => {
    const r = autoLayout(example('fm-tx'), emptyPcb(), { sides: 1 });
    expect(r.failed).toEqual([]);
  }, 120000);
});

describe('track widths', () => {
  it('makes ground and supply nets wider than signals', () => {
    const doc = example('fm-tx');
    const x = extractNetlist(doc);
    const pcb = syncPcb(doc, x, emptyPcb());
    const nets = padNets(doc, x);
    const widths = netWidths(doc, x, pcb, nets);
    expect(widths.get('GND')!).toBeGreaterThan(pcb.rules.trackWidth);
    expect(Math.min(...widths.values())).toBe(pcb.rules.trackWidth);
  });

  it('falls back to narrower tracks where a wide one does not fit', () => {
    const doc = example('us-driver');
    const x = extractNetlist(doc);
    const pcb: PcbDoc = { ...syncPcb(doc, x, emptyPcb()), sides: 1 };
    const nets = padNets(doc, x);
    const placed = autoPlace(pcb, nets, { seed: 1, board: 'auto' }).pcb;
    const pads = padsWithNets(placed, nets, doc);
    const wide = new Map([...new Set(nets.values())].map((n) => [n, 1.2]));
    const r = autoroute(placed, pads, { onlyLayer: 'bottom', attempts: 1, netWidths: wide });
    const widths = new Set(r.tracks.map((t) => t.width));
    expect(Math.max(...widths)).toBeGreaterThan(pcb.rules.trackWidth);
    expect(Math.min(...widths)).toBeLessThan(1.2);
    expect(runDrc({ ...placed, tracks: r.tracks, vias: r.vias }, pads).filter((i) => i.kind === 'clearance')).toEqual([]);
  }, 120000);
});

describe('operator tools', () => {
  it('pcb_autolayout builds a routed board from a schematic', () => {
    const ws: Workspace = { doc: example('fm-tx'), onLibraryChanged: () => {}, showView: () => {} };
    const out = JSON.parse(executeTool(ws, 'pcb_autolayout', { sides: 1 })) as { routed: number; failed: number; sides: number };
    expect(out.sides).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.routed).toBeGreaterThan(0);
    expect(ws.doc.pcb!.tracks.length).toBeGreaterThan(0);
    const placeOnly = JSON.parse(executeTool(ws, 'pcb_autoplace', {})) as { crossing_air_wires: number };
    expect(placeOnly.crossing_air_wires).toBeGreaterThanOrEqual(0);
    expect(ws.doc.pcb!.tracks).toEqual([]);
  }, 120000);

  it('refuses an empty schematic', () => {
    const ws: Workspace = { doc: emptyDoc(), onLibraryChanged: () => {}, showView: () => {} };
    expect(executeTool(ws, 'pcb_autolayout', {})).toMatch(/^Error:/);
  });
});
