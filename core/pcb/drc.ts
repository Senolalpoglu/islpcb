// Design rule check: clearance between different nets, annular ring, board edge, and open connections.

import { copperItems, gap, shareLayer } from './copper';
import { ratsnest } from './ratsnest';
import type { AbsPad, PcbDoc } from './types';

export type DrcKind = 'clearance' | 'annular' | 'edge' | 'unrouted';

export interface DrcIssue {
  kind: DrcKind;
  message: string;
  x: number;
  y: number;
}

const MIN_ANNULAR = 0.15;

export function runDrc(pcb: PcbDoc, pads: AbsPad[]): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const { clearance, edgeClearance } = pcb.rules;
  const items = copperItems(pcb, pads);

  // Different nets must keep their distance. Items of the same track or the same net are skipped.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const p = items[i];
      const q = items[j];
      if (p.net !== null && p.net === q.net) continue;
      if (p.kind === 'track' && q.kind === 'track' && p.id === q.id) continue;
      if (p.kind === 'pad' && q.kind === 'pad' && p.partId === q.partId && (p.net === null || q.net === null)) continue; // mechanical pads of one part
      if (!shareLayer(p, q)) continue;
      const g = gap(p, q);
      if (g < clearance - 1e-6) {
        const at = p.c ?? (p.box ? { x: (p.box.x0 + p.box.x1) / 2, y: (p.box.y0 + p.box.y1) / 2 } : p.a!);
        issues.push({
          kind: 'clearance',
          message: `${describe(p)} and ${describe(q)}: ${Math.max(g, 0).toFixed(2)} mm apart, ${clearance} mm required`,
          x: at.x,
          y: at.y,
        });
      }
    }
  }

  for (const p of pads) {
    if (p.drill > 0 && (Math.min(p.w, p.h) - p.drill) / 2 < MIN_ANNULAR - 1e-6) {
      issues.push({ kind: 'annular', message: `Pad ${p.key} (${p.name}): annular ring ${((Math.min(p.w, p.h) - p.drill) / 2).toFixed(2)} mm is below ${MIN_ANNULAR} mm`, x: p.x, y: p.y });
    }
  }
  for (const v of pcb.vias) {
    if ((v.dia - v.drill) / 2 < MIN_ANNULAR - 1e-6) issues.push({ kind: 'annular', message: `Via ${v.id}: annular ring ${((v.dia - v.drill) / 2).toFixed(2)} mm is below ${MIN_ANNULAR} mm`, x: v.x, y: v.y });
  }

  // Copper must stay inside the board outline with some margin.
  const b = pcb.board;
  const inside = (x: number, y: number, r: number): boolean => x - r >= b.x + edgeClearance - 1e-6 && x + r <= b.x + b.w - edgeClearance + 1e-6 && y - r >= b.y + edgeClearance - 1e-6 && y + r <= b.y + b.h - edgeClearance + 1e-6;
  for (const p of pads) if (!inside(p.x, p.y, Math.max(p.w, p.h) / 2)) issues.push({ kind: 'edge', message: `Pad ${p.key} is closer than ${edgeClearance} mm to the board edge or outside it`, x: p.x, y: p.y });
  for (const t of pcb.tracks) for (const pt of t.pts) if (!inside(pt.x, pt.y, t.width / 2)) issues.push({ kind: 'edge', message: `Track ${t.id} reaches the board edge`, x: pt.x, y: pt.y });
  for (const v of pcb.vias) if (!inside(v.x, v.y, v.dia / 2)) issues.push({ kind: 'edge', message: `Via ${v.id} reaches the board edge`, x: v.x, y: v.y });

  for (const w of ratsnest(pcb, pads)) {
    issues.push({ kind: 'unrouted', message: `Net ${w.net}: ${w.aKey} is not connected to ${w.bKey}`, x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 });
  }
  return issues;
}

function describe(i: ReturnType<typeof copperItems>[number]): string {
  return i.kind === 'pad' ? `pad ${i.id}` : i.kind === 'via' ? `via ${i.id}` : `track ${i.id}`;
}
