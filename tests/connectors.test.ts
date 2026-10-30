import { beforeAll, describe, expect, it } from 'vitest';
import { footprintById } from '../core/pcb/footprints';
import { exportFabrication } from '../core/pcb/gerber';
import { polarityMarks } from '../core/pcb/silk';
import { emptyPcb, type PcbDoc } from '../core/pcb/types';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, emptyDoc, type Doc, type PartType } from '../src/editor/model';
import { defaultFootprint, padsWithNets } from '../src/pcb/sync';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** A board with one part on it, and the schematic that holds the part. */
function one(type: string, rot: 0 | 90 = 0): { pcb: PcbDoc; doc: Doc } {
  const t = type as PartType;
  const pcb: PcbDoc = { ...emptyPcb(), fps: [{ partId: 'p1', footprint: defaultFootprint({ type: t })!, x: 20, y: 20, rot }] };
  const doc: Doc = { ...emptyDoc(), parts: [{ id: 'p1', type: t, ref: 'X1', x: 0, y: 0, rot: 0, params: {} }] };
  return { pcb, doc };
}
const padsOf = (type: string, rot: 0 | 90 = 0) => {
  const { pcb, doc } = one(type, rot);
  return { pcb, doc, pads: padsWithNets(pcb, new Map(), doc) };
};
const pinOf = (key: string): number => Number(/:(\d+)/.exec(key)![1]);

describe('connectors', () => {
  it('every connector has one pad per pole at the usual pitch, the first pole square', () => {
    for (const [id, pitch] of [['term-508-4', 5.08], ['term-350-3', 3.5], ['hdr-f-6', 2.54], ['jst-xh-4', 2.5]] as const) {
      const def = footprintById(defaultFootprint({ type: `x:${id}` as PartType })!)!;
      expect(def.pads.length, id).toBe(Number(id.split('-').pop()));
      expect(def.pads[1].x - def.pads[0].x, id).toBeCloseTo(pitch, 6);
      expect(def.pads[0].shape, id).toBe('rect');
    }
  });

  it('a 2x3 header has the odd pins on the left, the even on the right, rows 2.54 mm apart, and pad n carries pin n', () => {
    const idc = footprintById(defaultFootprint({ type: 'x:hdr2-m-6' as PartType })!)!;
    expect(idc.pads[1].x - idc.pads[0].x).toBeCloseTo(2.54, 6);
    expect(Math.abs(idc.pads[2].y - idc.pads[0].y)).toBeCloseTo(2.54, 6);
    const names = PART_DEFS['x:hdr2-m-6' as PartType].pinNames;
    expect(names).toEqual(['1', '3', '5', '2', '4', '6']); // the symbol lists the left column, then the right one
  });

  it('row sockets and pin headers come in every size from 2 to 10, pluggable terminal blocks from 2 to 12', () => {
    for (let n = 2; n <= 10; n++) for (const kind of ['hdr-m', 'hdr-f']) expect(PART_DEFS[`x:${kind}-${n}` as PartType], `${kind}-${n}`).toBeDefined();
    for (let n = 2; n <= 12; n++) {
      const def = footprintById(defaultFootprint({ type: `x:plug-508-${n}` as PartType })!)!;
      expect(def.pads.length, `plug-508-${n}`).toBe(n);
      expect(def.pads[1].x - def.pads[0].x).toBeCloseTo(5.08, 6);
    }
  });

  it('a 2-pole connector has + and - pins, 3 or more are numbered', () => {
    expect(PART_DEFS['x:term-508-2' as PartType].pinNames).toEqual(['+', '-']);
    expect(PART_DEFS['x:term-508-4' as PartType].pinNames).toEqual(['1', '2', '3', '4']);
  });
});

describe('polarity on the board', () => {
  it('the positive pad is always the square one: a 2-pole terminal, a battery, a diode anode, an LED', () => {
    for (const type of ['x:term-508-2', 'x:cell-9v', 'x:1n4007', 'x:led-green']) {
      const { pads } = padsOf(type);
      const names = PART_DEFS[type as PartType].pinNames;
      const square = pads.filter((p) => p.shape === 'rect');
      expect(square.length, type).toBe(1);
      expect(['+', 'A'], type).toContain(names[pinOf(square[0].key)]);
      expect(square[0].w, type).toBe(square[0].h);
      expect(pads.filter((p) => p.positive).length, type).toBe(1);
    }
  });

  it('prints a bar at the cathode end of a diode', () => {
    const d = padsOf('x:1n4007');
    const bars = polarityMarks(d.pcb, d.pads).filter((m) => m.length === 2);
    expect(bars).toHaveLength(1);
    expect(bars[0][0].x).toBeCloseTo(bars[0][1].x, 6); // a bar across the body
    const turned = padsOf('x:1n4007', 90);
    const bar = polarityMarks(turned.pcb, turned.pads)[0];
    expect(bar[0].y).toBeCloseTo(bar[1].y, 6); // the part is turned, so the bar lies the other way
  });

  it('puts the marks into the silkscreen file', () => {
    const d = padsOf('x:1n4007');
    const silk = exportFabrication(d.pcb, d.pads, 'x').find((f) => f.name.endsWith('F_Silkscreen.gto'))!;
    expect(silk.content.split('\n').filter((l) => l.endsWith('D01*')).length).toBeGreaterThanOrEqual(1);
  });

  it('prints the reference designator on the top silkscreen when the names are given', () => {
    const d = padsOf('x:1n4007');
    const draws = (refs?: Map<string, string>): number =>
      (exportFabrication(d.pcb, d.pads, 'x', refs).find((f) => f.name.endsWith('.gto'))!.content.match(/D01\*/g) ?? []).length;
    expect(draws(new Map([['p1', 'D12']]))).toBeGreaterThan(draws());
  });

  it('writes empty paste files for a through-hole board', () => {
    const d = padsOf('x:1n4007');
    const files = exportFabrication(d.pcb, d.pads, 'x');
    for (const ext of ['.gtp', '.gbp']) expect(files.find((f) => f.name.endsWith(ext))!.content).not.toContain('D03*');
  });
});
