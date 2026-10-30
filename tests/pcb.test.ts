import { describe, expect, it } from 'vitest';
import { runDrc } from '../core/pcb/drc';
import { exportFabrication } from '../core/pcb/gerber';
import { crc32 } from '../core/pcb/zip';
import { absolutePads, footprintById } from '../core/pcb/footprints';
import { ratsnest } from '../core/pcb/ratsnest';
import { autoroute } from '../core/pcb/router';
import { emptyPcb, type PcbDoc } from '../core/pcb/types';
import { EXAMPLES } from '../src/editor/examples';
import { addPart, emptyDoc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';
import { billOfMaterials, manufacturingZip, positionList } from '../src/pcb/export';
import { padNets, padsWithNets, syncPcb } from '../src/pcb/sync';

function pcbOf(exampleId: string): { pcb: PcbDoc; nets: Map<string, string>; doc: ReturnType<(typeof EXAMPLES)[number]['build']> } {
  const doc = EXAMPLES.find((e) => e.id === exampleId)!.build();
  const x = extractNetlist(doc);
  return { pcb: syncPcb(doc, x, emptyPcb()), nets: padNets(doc, x), doc };
}

describe('footprints', () => {
  it('numbers DIP pins down the left and back up the right', () => {
    const dip = footprintById('DIP18')!;
    expect(dip.pads.map((p) => p.name)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '18', '17', '16', '15', '14', '13', '12', '11', '10']);
    const pads = absolutePads({ partId: 'u', footprint: 'DIP18', x: 50, y: 40, rot: 0 }, dip);
    expect(pads[0].x).toBeCloseTo(50 - 3.81, 6);
    expect(pads[9].x).toBeCloseTo(50 + 3.81, 6);
    expect(pads[9].y).toBeCloseTo(pads[0].y, 6); // pin 18 faces pin 1
    expect(pads[9].name).toBe('18');
  });

  it('rotates pads and applies pad size and drill overrides', () => {
    const def = footprintById('AXIAL_10.16')!;
    const r0 = absolutePads({ partId: 'r', footprint: 'AXIAL_10.16', x: 0, y: 0, rot: 0 }, def);
    const r90 = absolutePads({ partId: 'r', footprint: 'AXIAL_10.16', x: 0, y: 0, rot: 90 }, def);
    expect(r0[0].x).toBeCloseTo(-5.08, 6);
    expect(r90[0].x).toBeCloseTo(0, 6);
    expect(r90[0].y).toBeCloseTo(-5.08, 6);
    const big = absolutePads({ partId: 'r', footprint: 'AXIAL_10.16', x: 0, y: 0, rot: 0, padSize: 2.4, drill: 1.1 }, def);
    expect(big[0].w).toBeCloseTo(2.4, 6);
    expect(big[0].drill).toBeCloseTo(1.1, 6);
  });

  it('maps transistor and op-amp pads to the schematic pins', () => {
    const q = footprintById('TO92_BJT')!;
    expect(q.pads.map((p) => [p.name, p.pin])).toEqual([['E', 2], ['B', 1], ['C', 0]]);
    const op = footprintById('OPAMP_DIP8')!;
    expect(op.pads.filter((p) => p.pin !== null).map((p) => [p.name, p.pin])).toEqual([['2', 1], ['3', 2], ['6', 0]]);
  });
});

describe('schematic to PCB', () => {
  it('creates footprints for real parts only and names the nets', () => {
    const { pcb, nets, doc } = pcbOf('rc');
    const types = pcb.fps.map((f) => doc.parts.find((p) => p.id === f.partId)!.type).sort();
    expect(types).toEqual(['C', 'R', 'VPULSE']); // GND and probes are virtual
    const names = new Set(nets.values());
    expect(names.has('GND')).toBe(true);
    expect(names.size).toBe(3);
    // The board is sized around the footprints.
    expect(pcb.board.w).toBeGreaterThan(10);
    for (const f of pcb.fps) expect(f.x).toBeGreaterThan(0);
  });

  it('keeps placement when synchronised again and drops removed parts', () => {
    const doc = EXAMPLES.find((e) => e.id === 'rc')!.build();
    const x = extractNetlist(doc);
    const first = syncPcb(doc, x, emptyPcb());
    first.fps[0].x += 7;
    const again = syncPcb(doc, x, first);
    expect(again.fps.map((f) => [f.partId, f.x, f.y])).toEqual(first.fps.map((f) => [f.partId, f.x, f.y]));
    const smaller = { ...doc, parts: doc.parts.filter((p) => p.type !== 'C') };
    const x2 = extractNetlist(smaller);
    expect(syncPcb(smaller, x2, first).fps.length).toBe(2);
  });

  it('works before a ground symbol exists', () => {
    let doc = addPart(emptyDoc(), 'R', 4, 4);
    doc = addPart(doc, 'R', 12, 4);
    const x = extractNetlist(doc);
    expect(x.error).toBe('noGround');
    const nets = padNets(doc, x);
    expect(nets.size).toBe(4);
    expect(syncPcb(doc, x, emptyPcb()).fps.length).toBe(2);
  });
});

describe('ratsnest and DRC', () => {
  it('lists one air wire per missing connection and none after routing', () => {
    const { pcb, nets } = pcbOf('rc');
    const pads = padsWithNets(pcb, nets);
    expect(ratsnest(pcb, pads).length).toBe(3);
    const r = autoroute(pcb, pads);
    expect(r.failed).toEqual([]);
    const routed = { ...pcb, tracks: r.tracks, vias: r.vias };
    expect(ratsnest(routed, pads)).toEqual([]);
  });

  it('reports a clearance violation between different nets and an edge violation', () => {
    const { pcb, nets } = pcbOf('rc');
    const pads = padsWithNets(pcb, nets);
    const bad: PcbDoc = {
      ...pcb,
      tracks: [
        { id: 'a', layer: 'top', width: 0.3, pts: [{ x: 20, y: 20 }, { x: 30, y: 20 }], net: 'X' },
        { id: 'b', layer: 'top', width: 0.3, pts: [{ x: 20, y: 20.35 }, { x: 30, y: 20.35 }], net: 'Y' }, // 0.05 mm gap
        { id: 'c', layer: 'top', width: 0.3, pts: [{ x: 0.1, y: 5 }, { x: 4, y: 5 }], net: 'Z' },
      ],
    };
    const kinds = runDrc(bad, pads).map((i) => i.kind);
    expect(kinds).toContain('clearance');
    expect(kinds).toContain('edge');
    expect(runDrc({ ...bad, tracks: [bad.tracks[0]] }, pads).filter((i) => i.kind === 'clearance')).toEqual([]);
  });
});

describe('autorouter', () => {
  it.each(['rc', 'led', 'bjt', 'opamp', 'pic877-blink', 'pic628-blink', 'ino-blink', 'pico-blink'])('routes the %s example without clearance or edge violations', (id) => {
    const { pcb, nets } = pcbOf(id);
    const pads = padsWithNets(pcb, nets);
    const r = autoroute(pcb, pads);
    expect(r.failed, JSON.stringify(r.failed)).toEqual([]);
    const routed = { ...pcb, tracks: r.tracks, vias: r.vias };
    const bad = runDrc(routed, pads).filter((i) => i.kind !== 'unrouted' || true);
    expect(bad.map((i) => `${i.kind}: ${i.message}`)).toEqual([]);
  });
});

describe('fabrication output', () => {
  const routedExample = (id: string) => {
    const { pcb, nets, doc } = pcbOf(id);
    const pads = padsWithNets(pcb, nets);
    const r = autoroute(pcb, pads);
    return { pcb: { ...pcb, tracks: r.tracks, vias: r.vias }, pads, doc };
  };

  it('writes Gerber layers with matching flash counts and a drill file', () => {
    const { pcb, pads } = routedExample('rc');
    const files = exportFabrication(pcb, pads, 'demo');
    expect(files.map((f) => f.name)).toEqual([
      'demo-F_Cu.gtl', 'demo-B_Cu.gbl', 'demo-F_Mask.gts', 'demo-B_Mask.gbs', 'demo-F_Silkscreen.gto', 'demo-B_Silkscreen.gbo', 'demo-Edge_Cuts.gm1', 'demo-PTH.drl', 'demo-F_Paste.gtp', 'demo-B_Paste.gbp',
    ]);
    const top = files[0].content;
    expect(top).toContain('%FSLAX46Y46*%');
    expect(top).toContain('%MOMM*%');
    expect(top.trim().endsWith('M02*')).toBe(true);
    const flashes = (text: string): number => (text.match(/D03\*/g) ?? []).length;
    expect(flashes(top)).toBe(pads.length + pcb.vias.length); // all pads are through-hole in this example
    expect(flashes(files[2].content)).toBe(pads.length); // mask openings for pads only
    const drl = files[7].content;
    expect(drl.startsWith('M48')).toBe(true);
    expect((drl.match(/^X/gm) ?? []).length).toBe(pads.filter((p) => p.drill > 0).length + pcb.vias.length);
    expect(drl.trim().endsWith('M30')).toBe(true);
  });

  it('draws every routed track in the copper layers', () => {
    const { pcb, pads } = routedExample('led');
    const files = exportFabrication(pcb, pads, 'demo');
    const draws = (text: string): number => (text.match(/D01\*/g) ?? []).length;
    const segments = (layer: 'top' | 'bottom'): number => pcb.tracks.filter((t) => t.layer === layer).reduce((s, t) => s + t.pts.length - 1, 0);
    expect(draws(files[0].content)).toBe(segments('top'));
    expect(draws(files[1].content)).toBe(segments('bottom'));
    expect(draws(files[6].content)).toBe(4); // board outline: four sides
  });

  it('packs everything into a valid ZIP with BOM and positions', () => {
    const { pcb, doc } = routedExample('rc');
    const x = extractNetlist(doc);
    const zip = manufacturingZip(doc, x, pcb, 'demo');
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // End of central directory record is the last 22 bytes.
    const eocd = zip.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(12); // 10 fabrication files + BOM + positions
    // Walk the local headers and verify every CRC.
    let pos = 0;
    const names: string[] = [];
    while (view.getUint32(pos, true) === 0x04034b50) {
      const crc = view.getUint32(pos + 14, true);
      const size = view.getUint32(pos + 18, true);
      const nameLen = view.getUint16(pos + 26, true);
      names.push(new TextDecoder().decode(zip.slice(pos + 30, pos + 30 + nameLen)));
      const data = zip.slice(pos + 30 + nameLen, pos + 30 + nameLen + size);
      expect(crc32(data), names[names.length - 1]).toBe(crc);
      pos += 30 + nameLen + size;
    }
    expect(names).toContain('demo-BOM.csv');
    const bom = billOfMaterials(doc, pcb);
    expect(bom.split('\n')[0]).toBe('Reference,Value,Footprint,Quantity');
    expect(bom).toContain('R1,1 kΩ,Axial 10.16 mm,1');
    expect(positionList(doc, pcb).split('\n').length).toBe(5); // header + 3 parts + trailing newline
  });
});
