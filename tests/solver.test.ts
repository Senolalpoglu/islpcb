import { describe, expect, it } from 'vitest';
import { Simulator, type Netlist } from '../core/sim/solver';

describe('MNA solver', () => {
  it('solves a resistive divider and reports source current', () => {
    const nl: Netlist = {
      nodeCount: 3,
      elements: [
        { type: 'V', id: 'V1', a: 1, b: 0, wave: { kind: 'dc', value: 10 } },
        { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 },
        { type: 'R', id: 'R2', a: 2, b: 0, r: 1000 },
      ],
    };
    const s = new Simulator(nl).operatingPoint();
    expect(s.converged).toBe(true);
    expect(s.v[2]).toBeCloseTo(5, 6);
    expect(s.i.R1).toBeCloseTo(5e-3, 9);
    // A source delivering power has negative current (a -> b) and negative absorbed power.
    expect(s.i.V1).toBeCloseTo(-5e-3, 9);
    expect(s.p.V1).toBeCloseTo(-0.05, 9);
  });

  it('charges an RC circuit along 1 - exp(-t/tau)', () => {
    const nl: Netlist = {
      nodeCount: 3,
      elements: [
        { type: 'V', id: 'V1', a: 1, b: 0, wave: { kind: 'dc', value: 5 } },
        { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 },
        { type: 'C', id: 'C1', a: 2, b: 0, c: 1e-6, ic: 0 },
      ],
    };
    const sim = new Simulator(nl);
    sim.beginTransient(1e-6, true);
    let s = sim.step();
    for (let k = 1; k < 1000; k++) s = sim.step();
    expect(s.time).toBeCloseTo(1e-3, 9);
    expect(s.v[2]).toBeCloseTo(5 * (1 - Math.exp(-1)), 2);
  });

  it('finds the forward drop of a silicon diode', () => {
    const nl: Netlist = {
      nodeCount: 3,
      elements: [
        { type: 'V', id: 'V1', a: 1, b: 0, wave: { kind: 'dc', value: 5 } },
        { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 },
        { type: 'D', id: 'D1', a: 2, b: 0 },
      ],
    };
    const s = new Simulator(nl).operatingPoint();
    expect(s.converged).toBe(true);
    expect(s.v[2]).toBeGreaterThan(0.6);
    expect(s.v[2]).toBeLessThan(0.8);
    expect(s.i.R1).toBeCloseTo((5 - s.v[2]) / 1000, 6);
  });

  it('keeps an LC tank oscillating at 1 / (2 pi sqrt(LC))', () => {
    const nl: Netlist = {
      nodeCount: 2,
      elements: [
        { type: 'C', id: 'C1', a: 1, b: 0, c: 1e-6, ic: 1 },
        { type: 'L', id: 'L1', a: 1, b: 0, l: 1e-3 },
      ],
    };
    const sim = new Simulator(nl);
    sim.beginTransient(1e-7, true);
    let s = sim.step();
    for (let k = 1; k < 497; k++) s = sim.step();
    expect(Math.abs(s.v[1])).toBeLessThan(0.05); // quarter period: capacitor discharged
    for (let k = 497; k < 1987; k++) s = sim.step();
    expect(s.v[1]).toBeGreaterThan(0.98); // full period: back at +1 V
  });
});
