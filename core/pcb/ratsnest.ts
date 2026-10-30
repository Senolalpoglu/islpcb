// Ratsnest: for every net, the shortest set of straight "air wires" that still has to be routed.

import { copperItems, touches, type CopperItem } from './copper';
import { dist } from './geom';
import { analyzePour, pourContacts } from './pour';
import type { AbsPad, PcbDoc, Pt } from './types';

export interface AirWire {
  net: string;
  a: Pt;
  b: Pt;
  aKey: string;
  bKey: string;
}

class UF {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    this.p[this.find(a)] = this.find(b);
  }
}

/** Groups the pads of each net into copper-connected islands. Returns island index per pad key and island count per net. */
export function connectivity(pcb: PcbDoc, pads: AbsPad[]): { island: Map<string, number>; items: CopperItem[] } {
  const items = copperItems(pcb, pads);
  // A pour joins the copper of its net that touches the same piece of the plane. Tracks of other nets can cut the
  // plane apart, so this is worked out on the actual shape, not assumed for the whole net.
  const pours = (pcb.pours ?? []).map((pour) => ({ pour, contacts: pourContacts(pcb, pads, pour, analyzePour(pcb, pads, pour)) }));
  const pieceNode = new Map<string, number>();
  for (const [k, { contacts }] of pours.entries()) for (const set of contacts.values()) for (const l of set) if (!pieceNode.has(`${k}:${l}`)) pieceNode.set(`${k}:${l}`, items.length + pieceNode.size);
  const uf = new UF(items.length + pieceNode.size);
  // Items are few enough (hundreds to a few thousand) for a net-wise pairwise sweep.
  const byNet = new Map<string, number[]>();
  items.forEach((it, i) => {
    if (it.net === null) return;
    const list = byNet.get(it.net) ?? [];
    list.push(i);
    byNet.set(it.net, list);
  });
  for (const list of byNet.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (touches(items[list[a]], items[list[b]])) uf.union(list[a], list[b]);
  }
  for (const [k, { contacts }] of pours.entries()) {
    items.forEach((it, i) => {
      const labels = contacts.get(`${it.kind}:${it.id}`);
      if (labels) for (const l of labels) uf.union(i, pieceNode.get(`${k}:${l}`)!);
    });
  }
  // Segments of one track are joined end to end.
  const firstOfTrack = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind !== 'track') return;
    const f = firstOfTrack.get(it.id);
    if (f === undefined) firstOfTrack.set(it.id, i);
    else uf.union(f, i);
  });
  const island = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.kind === 'pad') island.set(it.id, uf.find(i));
  });
  return { island, items };
}

/** Minimum spanning set of air wires between the unconnected islands of each net. */
export function ratsnest(pcb: PcbDoc, pads: AbsPad[]): AirWire[] {
  const { island } = connectivity(pcb, pads);
  const byNet = new Map<string, AbsPad[]>();
  for (const p of pads) {
    if (p.net === null) continue;
    const list = byNet.get(p.net) ?? [];
    list.push(p);
    byNet.set(p.net, list);
  }
  const wires: AirWire[] = [];
  for (const [net, list] of byNet) {
    if (list.length < 2) continue;
    // Prim over islands, using the closest pad pair between two islands as the edge.
    const islands = [...new Set(list.map((p) => island.get(p.key)!))];
    if (islands.length < 2) continue;
    const members = new Map<number, AbsPad[]>(islands.map((i) => [i, list.filter((p) => island.get(p.key) === i)]));
    const inTree = new Set<number>([islands[0]]);
    while (inTree.size < islands.length) {
      let best: { a: AbsPad; b: AbsPad; d: number } | null = null;
      for (const i of inTree) {
        for (const j of islands) {
          if (inTree.has(j)) continue;
          for (const a of members.get(i)!) for (const b of members.get(j)!) {
            const d = dist(a, b);
            if (!best || d < best.d) best = { a, b, d };
          }
        }
      }
      if (!best) break;
      wires.push({ net, a: { x: best.a.x, y: best.a.y }, b: { x: best.b.x, y: best.b.y }, aKey: best.a.key, bKey: best.b.key });
      inTree.add(island.get(best.b.key)!);
    }
  }
  return wires;
}
