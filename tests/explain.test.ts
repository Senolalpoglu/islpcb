import { describe, expect, it } from 'vitest';
import { Simulator } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { explainPart, partState } from '../src/editor/explain';
import type { Doc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

/** The shipped LED example (source, switch, resistor, LED) with the switch closed or open. */
function ledDoc(closed: boolean): Doc {
  const d = EXAMPLES.find((e) => e.id === 'led')!.build();
  return { ...d, parts: d.parts.map((p) => (p.type === 'SW' ? { ...p, params: { ...p.params, closed } } : p)) };
}

const solve = (d: Doc) => {
  const x = extractNetlist(d);
  return { x, s: new Simulator(x.netlist!).operatingPoint() };
};

describe('why a part is on or off', () => {
  it('says the LED is on and where the current goes while the switch is closed', () => {
    const d = ledDoc(true);
    const { x, s } = solve(d);
    const led = d.parts.find((p) => p.type === 'LED')!;
    const e = explainPart(led, d, s, x);
    expect(e.on).toBe(true);
    expect(e.lines.map((l) => l.key)).toContain('why.flows');
    expect(e.lines.map((l) => l.key)).not.toContain('why.blockers');
  });

  it('blames the open switch when the LED is dark', () => {
    const d = ledDoc(false);
    const { x, s } = solve(d);
    const led = d.parts.find((p) => p.type === 'LED')!;
    const sw = d.parts.find((p) => p.type === 'SW')!;
    const e = explainPart(led, d, s, x);
    expect(e.on).toBe(false);
    const blame = e.lines.find((l) => l.key === 'why.blockers');
    expect(blame?.vars?.list).toBe(sw.ref);
  });

  it('reports a switch by its position and lets it be clicked', () => {
    for (const closed of [true, false]) {
      const d = ledDoc(closed);
      const { x, s } = solve(d);
      const sw = d.parts.find((p) => p.type === 'SW')!;
      const e = explainPart(sw, d, s, x);
      expect(e.on).toBe(closed);
      expect(e.clickable).toBe(true);
      expect(e.lines.map((l) => l.key)).toContain(closed ? 'why.sw.closed' : 'why.sw.open');
    }
  });

  it('has no on/off for a ground symbol', () => {
    const d = ledDoc(true);
    const { x, s } = solve(d);
    const gnd = d.parts.find((p) => p.type === 'GND')!;
    expect(partState(gnd, s, x).on).toBeNull();
  });
});
