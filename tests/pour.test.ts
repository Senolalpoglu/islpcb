import { describe, expect, it } from 'vitest';
import { exportFabrication } from '../core/pcb/gerber';
import { analyzePour, deadIslandRuns, pourContacts, pourCutouts, pourOutline } from '../core/pcb/pour';
import { autoroute } from '../core/pcb/router';
import { ratsnest } from '../core/pcb/ratsnest';
import { emptyPcb, type AbsPad, type PcbDoc } from '../core/pcb/types';

const pad = (key: string, x: number, y: number, net: string | null, extra: Partial<AbsPad> = {}): AbsPad => ({
  key,
  partId: key.split(':')[0],
  name: key,
  x,
  y,
  w: 1.8,
  h: 1.8,
  shape: 'round',
  drill: 1,
  smd: false,
  net,
  ...extra,
});

const pads: AbsPad[] = [pad('a:0', 10, 10, 'GND'), pad('b:0', 40, 30, 'GND'), pad('c:0', 25, 10, 'SIG'), pad('d:0', 25, 30, 'SIG'), pad('e:0', 5, 35, null)];
const board = (extra: Partial<PcbDoc> = {}): PcbDoc => ({ ...emptyPcb(), board: { x: 0, y: 0, w: 50, h: 40 }, ...extra });

describe('copper pour', () => {
  it('a ground plane connects the ground pads without any track', () => {
    const without = ratsnest(board(), pads).filter((w) => w.net === 'GND');
    expect(without).toHaveLength(1);
    const withPour = ratsnest(board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }] }), pads);
    expect(withPour.filter((w) => w.net === 'GND')).toHaveLength(0);
    expect(withPour.filter((w) => w.net === 'SIG')).toHaveLength(1); // other nets still need routing
  });

  it('a surface-mount pad is not joined by a pour on the other side', () => {
    const smd = [pad('a:0', 10, 10, 'GND', { smd: true, drill: 0 }), pad('b:0', 40, 30, 'GND', { smd: true, drill: 0 })];
    expect(ratsnest(board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }] }), smd)).toHaveLength(1);
    expect(ratsnest(board({ pours: [{ id: 'p1', layer: 'top', net: 'GND' }] }), smd)).toHaveLength(0);
  });

  it('clears a gap around other nets and unconnected pads but not around its own net', () => {
    const pcb = board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }] });
    const cuts = pourCutouts(pcb, pads, pcb.pours![0]);
    expect(cuts).toHaveLength(3); // two SIG pads and the pad without a net
    const first = cuts[0];
    expect(first.kind === 'round' && first.d).toBeCloseTo(1.8 + 2 * pcb.rules.clearance, 6);
  });

  it('keeps the plane away from the board edge', () => {
    const o = pourOutline(board());
    expect(o[0].x).toBeCloseTo(0.5, 6);
    expect(o[2].y).toBeCloseTo(39.5, 6);
  });

  it('writes the plane, its clearance halos and then the copper, in the Gerber file', () => {
    const pcb = board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }], tracks: [{ id: 't1', layer: 'bottom', width: 0.3, pts: [{ x: 25, y: 10 }, { x: 25, y: 30 }], net: 'SIG' }] });
    const files = exportFabrication(pcb, pads, 'x');
    const bottom = files.find((f) => f.name.endsWith('B_Cu.gbl'))!.content;
    const region = bottom.indexOf('G36*');
    const clear = bottom.indexOf('%LPC*%');
    const dark = bottom.indexOf('%LPD*%', clear);
    expect(region).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(region);
    expect(dark).toBeGreaterThan(clear);
    expect(bottom.indexOf('D01*', dark)).toBeGreaterThan(dark); // the track is drawn after the halos
    // The top layer has no pour.
    expect(files.find((f) => f.name.endsWith('F_Cu.gtl'))!.content).not.toContain('G36*');
  });

  it('a single-sided board has the plane on the bottom only and no via halos', () => {
    const pcb = board({ sides: 1, pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }], vias: [{ id: 'v1', x: 20, y: 20, dia: 0.8, drill: 0.4, net: 'SIG' }] });
    expect(pourCutouts(pcb, pads, pcb.pours![0])).toHaveLength(3);
    const files = exportFabrication(pcb, pads, 'x');
    expect(files.some((f) => f.name.endsWith('F_Cu.gtl'))).toBe(false);
  });
});

describe('copper pour with tracks across it', () => {
  const gndPads = [pad('a:0', 10, 10, 'GND'), pad('b:0', 40, 30, 'GND')];
  const track = (id: string, ys: [number, number], x = 25): PcbDoc['tracks'][number] => ({ id, layer: 'bottom', width: 0.3, pts: [{ x, y: ys[0] }, { x, y: ys[1] }], net: 'SIG' });
  const withTrack = (ys: [number, number]): PcbDoc => board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }], tracks: [track('t1', ys)] });

  it('a track that runs from edge to edge cuts the plane in two, and the pads on the far side are not connected', () => {
    expect(ratsnest(withTrack([0.6, 39.4]), gndPads).filter((w) => w.net === 'GND')).toHaveLength(1);
  });

  it('a track that stops short leaves the plane in one piece', () => {
    expect(ratsnest(withTrack([5, 30]), gndPads).filter((w) => w.net === 'GND')).toHaveLength(0);
  });

  it('clears the piece of the plane that nothing connects to', () => {
    // Only the left half has a ground pad: the right half is dead copper.
    const pcb = withTrack([0.6, 39.4]);
    const pour = pcb.pours![0];
    const an = analyzePour(pcb, [pad('a:0', 10, 10, 'GND')], pour);
    expect(an.islands).toBeGreaterThanOrEqual(2);
    const dead = deadIslandRuns(an, pourContacts(pcb, [pad('a:0', 10, 10, 'GND')], pour, an));
    expect(dead.length).toBeGreaterThan(0);
    expect(Math.min(...dead.map((r) => r.x0))).toBeGreaterThan(25); // on the far side of the track
  });

  it('autoroute keeps the plane connected: it goes round on the other layer and every ground pad stays joined', () => {
    const sig = [pad('c:0', 25, 1.5, 'SIG'), pad('d:0', 25, 38.5, 'SIG')];
    const all = [...gndPads, ...sig];
    const pcb = board({ pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }] });
    const r = autoroute(pcb, all);
    expect(r.failed).toEqual([]);
    const routed: PcbDoc = { ...pcb, tracks: r.tracks, vias: r.vias };
    expect(ratsnest(routed, all)).toEqual([]); // nothing open, with the plane as it really is
    // The signal went on the top layer, so it did not cut the bottom plane.
    expect(r.tracks.filter((t) => t.net === 'SIG').every((t) => t.layer === 'top')).toBe(true);
  });

  it('on a single-sided board autoroute never claims success while the plane is split', () => {
    const sig = [pad('c:0', 25, 1.5, 'SIG'), pad('d:0', 25, 38.5, 'SIG')];
    const all = [...gndPads, ...sig];
    const pcb = board({ sides: 1, pours: [{ id: 'p1', layer: 'bottom', net: 'GND' }] });
    const r = autoroute(pcb, all, { onlyLayer: 'bottom' });
    const routed: PcbDoc = { ...pcb, tracks: r.tracks, vias: r.vias };
    if (r.failed.length === 0) expect(ratsnest(routed, all)).toEqual([]);
    else expect(ratsnest(routed, all).length).toBeGreaterThan(0);
  });
});
