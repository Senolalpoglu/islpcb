// The complete manufacturing package: Gerber + drill files, a bill of materials and a position list, as a ZIP.

import { exportFabrication } from '../../core/pcb/gerber';
import { footprintById } from '../../core/pcb/footprints';
import { makeZip } from '../../core/pcb/zip';
import type { PcbDoc } from '../../core/pcb/types';
import type { Doc } from '../editor/model';
import { partValueText } from '../editor/values';
import { padNets, padsWithNets } from './sync';
import type { Extracted } from '../editor/netlist';

const csv = (rows: string[][]): string => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n';

/** Bill of materials: identical parts (same value and footprint) share a line. */
export function billOfMaterials(doc: Doc, pcb: PcbDoc): string {
  const groups = new Map<string, { refs: string[]; value: string; footprint: string }>();
  for (const fp of pcb.fps) {
    const part = doc.parts.find((p) => p.id === fp.partId);
    if (!part) continue;
    const value = partValueText(part) || part.type;
    const key = `${value}|${fp.footprint}`;
    const g = groups.get(key) ?? { refs: [], value, footprint: footprintById(fp.footprint)?.label ?? fp.footprint };
    g.refs.push(part.ref);
    groups.set(key, g);
  }
  const rows = [...groups.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0], undefined, { numeric: true }));
  return csv([['Reference', 'Value', 'Footprint', 'Quantity'], ...rows.map((g) => [g.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(' '), g.value, g.footprint, String(g.refs.length)])]);
}

/** Centre positions in mm and rotation, as pick-and-place machines expect them. */
export function positionList(doc: Doc, pcb: PcbDoc): string {
  return csv([
    ['Ref', 'Val', 'Package', 'PosX', 'PosY', 'Rot', 'Side'],
    ...pcb.fps.flatMap((fp) => {
      const part = doc.parts.find((p) => p.id === fp.partId);
      return part ? [[part.ref, partValueText(part), fp.footprint, (fp.x - pcb.board.x).toFixed(3), (pcb.board.y + pcb.board.h - fp.y).toFixed(3), String(fp.rot), 'top']] : [];
    }),
  ]);
}

/** Everything a board house needs in a single ZIP. */
export function manufacturingZip(doc: Doc, x: Extracted, pcb: PcbDoc, name: string): Uint8Array {
  const pads = padsWithNets(pcb, padNets(doc, x), doc);
  const files = exportFabrication(pcb, pads, name, new Map(doc.parts.map((p) => [p.id, p.ref])));
  return makeZip([
    ...files.map((f) => ({ name: f.name, data: f.content })),
    { name: `${name}-BOM.csv`, data: billOfMaterials(doc, pcb) },
    { name: `${name}-positions.csv`, data: positionList(doc, pcb) },
  ]);
}
