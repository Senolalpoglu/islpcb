import { describe, expect, it } from 'vitest';
import { Simulator } from '../core/sim/solver';
import { NO_CURRENT, computeFlow, flowSpeed, voltColor, wireState } from '../src/editor/flow';
import { EXAMPLES } from '../src/editor/examples';
import { addPart, addWire, emptyDoc, pinPositions, type Doc, type Pt } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

/** A 5 V source across a resistor (or a switch), ground on the minus side. Returns the document and the wires in drawing order. */
function loop(part: 'R' | 'SW', closed = true): Doc {
  let d = addPart(emptyDoc(), 'VDC', 4, 10);
  d = addPart(d, part, 16, 10);
  d = addPart(d, 'GND', 4, 20);
  if (part === 'SW') d = { ...d, parts: d.parts.map((p) => (p.type === 'SW' ? { ...p, params: { ...p.params, closed } } : p)) };
  const [vp, vm] = pinPositions(d.parts[0]);
  const rp = pinPositions(d.parts[1]);
  const g = pinPositions(d.parts[2])[0];
  const w = (a: Pt, b: Pt) => (d = addWire(d, a, b));
  w(vp, { x: vp.x, y: rp[0].y });
  w({ x: vp.x, y: rp[0].y }, rp[0]);
  w(vm, { x: vm.x, y: g.y });
  w({ x: vm.x, y: g.y }, g);
  w(rp[1], { x: rp[1].x, y: g.y });
  w({ x: rp[1].x, y: g.y }, g);
  return d;
}

const flowOf = (d: Doc) => {
  const x = extractNetlist(d);
  const s = new Simulator(x.netlist!).operatingPoint();
  return computeFlow(d, s, x);
};

describe('what flows on the wires', () => {
  it('shows the source voltage and the current leaving the plus pin', () => {
    const d = loop('R');
    const f = flowOf(d);
    const plus = f.segs.filter((g) => g.wireId === d.wires[0].id);
    expect(plus.length).toBeGreaterThan(0);
    for (const g of plus) {
      expect(g.volts).toBeCloseTo(5, 3);
      // The wire runs from the source's plus pin: current leaving the source is positive along it.
      expect(g.amps).toBeCloseTo(0.005, 5);
    }
    expect(f.vmax).toBeCloseTo(5, 3);
  });

  it('returns the same current into the minus pin, against the direction the wire was drawn', () => {
    const d = loop('R');
    const f = flowOf(d);
    const back = f.segs.filter((g) => g.wireId === d.wires[2].id);
    for (const g of back) {
      expect(g.volts).toBeCloseTo(0, 6);
      expect(g.amps).toBeCloseTo(-0.005, 5);
    }
  });

  it('carries no current through an open switch, and some through a closed one', () => {
    const open = flowOf(loop('SW', false));
    expect(open.segs.every((g) => g.amps === null || Math.abs(g.amps) < NO_CURRENT)).toBe(true);
    const shut = flowOf(loop('SW', true));
    expect(shut.segs.some((g) => g.amps !== null && Math.abs(g.amps) > 1e-3)).toBe(true);
  });
});

describe('red and blue wires', () => {
  it('marks the source side live (red) and the ground side zero (blue)', () => {
    const d = loop('R');
    const f = flowOf(d);
    const plus = f.segs.filter((g) => g.wireId === d.wires[0].id);
    const back = f.segs.filter((g) => g.wireId === d.wires[2].id);
    expect(plus.every((g) => wireState(g, f.vmax, f.rails) === 'live')).toBe(true);
    expect(back.every((g) => wireState(g, f.vmax, f.rails) === 'zero')).toBe(true);
  });

  it('leaves a wire without voltage in the sheet colour', () => {
    // The shipped LED circuit (source, switch, resistor, LED) with the switch open.
    const d = EXAMPLES.find((e) => e.id === 'led')!.build();
    const open: Doc = { ...d, parts: d.parts.map((p) => (p.type === 'SW' ? { ...p, params: { ...p.params, closed: false } } : p)) };
    const f = flowOf(open);
    // Behind the open switch the nets float at about a volt from leakage: not ground, not a source rail, so no colour.
    const beyond = f.segs.filter((g) => g.node !== 0 && g.volts > 0.5 && g.volts < 2);
    expect(beyond.length).toBeGreaterThan(0);
    expect(beyond.every((g) => wireState(g, f.vmax, f.rails) === null)).toBe(true);
    // Before the switch the wire is at the source rail and live; the ground rail is zero.
    expect(f.segs.filter((g) => Math.abs(g.volts - 5) < 0.01).every((g) => wireState(g, f.vmax, f.rails) === 'live')).toBe(true);
    expect(f.segs.some((g) => wireState(g, f.vmax, f.rails) === 'zero')).toBe(true);
  });
});

describe('how it is drawn', () => {
  it('maps ground to blue and the top voltage to red', () => {
    expect(voltColor(0, 5)).toMatch(/^hsl\(215/);
    expect(voltColor(5, 5)).toMatch(/^hsl\(0 /);
    expect(voltColor(-5, 5)).toMatch(/^hsl\(300 /);
  });

  it('speeds the dashes up with the current, in steps', () => {
    expect(flowSpeed(0)).toBe(0);
    expect(flowSpeed(NO_CURRENT / 10)).toBe(0);
    expect(flowSpeed(1e-6)).toBe(1);
    expect(flowSpeed(5e-3)).toBeGreaterThan(flowSpeed(1e-5));
    expect(flowSpeed(100)).toBe(6);
  });
});
