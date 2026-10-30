import { describe, expect, it } from 'vitest';
import { Simulator, waveValue, type Element } from '../core/sim/solver';

const op = (nodeCount: number, elements: Element[]) => new Simulator({ nodeCount, elements }).operatingPoint();
const dc = (id: string, a: number, b: number, value: number): Element => ({ type: 'V', id, a, b, wave: { kind: 'dc', value } });

describe('bipolar transistor', () => {
  // Nodes: 1 = Vcc, 2 = base, 3 = collector.
  const ce = (rb: number, rc: number, npn = true): Element[] =>
    npn
      ? [
          dc('V1', 1, 0, 5),
          { type: 'R', id: 'Rb', a: 1, b: 2, r: rb },
          { type: 'R', id: 'Rc', a: 1, b: 3, r: rc },
          { type: 'Q', id: 'Q1', a: 3, b: 0, c: 2, npn: true },
        ]
      : [
          // PNP: emitter at Vcc, collector and base pulled down to ground through resistors.
          dc('V1', 1, 0, 5),
          { type: 'R', id: 'Rb', a: 2, b: 0, r: rb },
          { type: 'R', id: 'Rc', a: 3, b: 0, r: rc },
          { type: 'Q', id: 'Q1', a: 3, b: 1, c: 2, npn: false },
        ];

  it('amplifies base current by beta in the active region (NPN)', () => {
    const s = op(4, ce(43e3, 220));
    expect(s.converged).toBe(true);
    const ib = s.terminals.Q1[1];
    expect(s.i.Q1 / ib).toBeCloseTo(100, 0);
    expect(s.i.Q1).toBeGreaterThan(9e-3);
    expect(s.i.Q1).toBeLessThan(10.5e-3);
    expect(s.v[3]).toBeGreaterThan(2);
  });

  it('saturates when the base drive is too strong', () => {
    const s = op(4, ce(10e3, 220));
    expect(s.converged).toBe(true);
    expect(s.v[3]).toBeLessThan(0.3); // Vce(sat)
    expect(s.i.Q1 / s.terminals.Q1[1]).toBeLessThan(100);
  });

  it('works mirrored with a PNP', () => {
    const s = op(4, ce(43e3, 220, false));
    expect(s.converged).toBe(true);
    expect(s.i.Q1).toBeLessThan(0); // current flows out of the collector terminal into Rc
    expect(Math.abs(s.i.Q1)).toBeGreaterThan(9e-3);
    expect(s.v[3]).toBeGreaterThan(2);
  });

  it('conserves current: terminal currents sum to zero', () => {
    const s = op(4, ce(43e3, 220));
    const [c, b, e] = s.terminals.Q1;
    expect(c + b + e).toBeCloseTo(0, 12);
  });
});

describe('MOSFET', () => {
  // Nodes: 1 = Vdd, 2 = gate, 3 = drain.
  const nm = (vg: number): Element[] => [
    dc('V1', 1, 0, 10),
    dc('V2', 2, 0, vg),
    { type: 'R', id: 'Rd', a: 1, b: 3, r: 1000 },
    { type: 'M', id: 'M1', a: 3, b: 0, c: 2, nmos: true, beta: 2e-3, vth: 2 },
  ];

  it('is off below threshold', () => {
    const s = op(4, nm(1));
    expect(s.i.M1).toBeCloseTo(0, 9);
    expect(s.v[3]).toBeCloseTo(10, 3);
  });

  it('follows the square law in saturation', () => {
    const s = op(4, nm(3)); // vov = 1 -> Id = beta/2 * vov^2 = 1 mA
    expect(s.converged).toBe(true);
    expect(s.i.M1).toBeCloseTo(1e-3, 5);
    expect(s.v[3]).toBeCloseTo(9, 2);
  });

  it('enters the triode region when the load pulls the drain low', () => {
    const s = op(4, nm(5)); // solves vds^2 - 7 vds + 10 = 0 -> vds = 2
    expect(s.converged).toBe(true);
    expect(s.v[3]).toBeCloseTo(2, 2);
  });

  it('conducts as a PMOS high-side switch', () => {
    const s = op(4, [
      dc('V1', 1, 0, 10),
      dc('V2', 2, 0, 7), // gate 3 V below the source -> vov = 1
      { type: 'R', id: 'Rd', a: 3, b: 0, r: 1000 },
      { type: 'M', id: 'M1', a: 3, b: 1, c: 2, nmos: false, beta: 2e-3, vth: 2 },
    ]);
    expect(s.converged).toBe(true);
    expect(s.v[3]).toBeCloseTo(1, 2); // 1 mA through 1 k
  });
});

describe('op-amp', () => {
  // Nodes: 1 = Vin, 2 = inverting input, 3 = output.
  it('gives -Rf/Rin gain as an inverting amplifier', () => {
    const s = op(4, [
      dc('V1', 1, 0, 1),
      { type: 'R', id: 'Rin', a: 1, b: 2, r: 1000 },
      { type: 'R', id: 'Rf', a: 2, b: 3, r: 10e3 },
      { type: 'OA', id: 'U1', a: 3, b: 2, c: 0 },
    ]);
    expect(s.converged).toBe(true);
    expect(s.v[3]).toBeCloseTo(-10, 2);
  });

  it('follows its input as a buffer', () => {
    const s = op(3, [dc('V1', 1, 0, 3.3), { type: 'OA', id: 'U1', a: 2, b: 2, c: 1 }]);
    expect(s.converged).toBe(true);
    expect(s.v[2]).toBeCloseTo(3.3, 3);
  });

  it('saturates at the rail as a comparator', () => {
    const hi = op(3, [dc('V1', 1, 0, 1), { type: 'OA', id: 'U1', a: 2, b: 0, c: 1, vmax: 12 }]);
    expect(hi.v[2]).toBeCloseTo(12, 3);
    const lo = op(3, [dc('V1', 1, 0, -1), { type: 'OA', id: 'U1', a: 2, b: 0, c: 1, vmax: 12 }]);
    expect(lo.v[2]).toBeCloseTo(-12, 3);
  });
});

describe('Zener diode', () => {
  // Nodes: 1 = source, 2 = Zener cathode (anode at ground).
  const zener = (vin: number): Element[] => [
    dc('V1', 1, 0, vin),
    { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 },
    { type: 'D', id: 'Z1', a: 0, b: 2, bv: 5.1 },
  ];

  it('clamps at its breakdown voltage', () => {
    const s = op(3, zener(12));
    expect(s.converged).toBe(true);
    expect(s.v[2]).toBeGreaterThan(5.1);
    expect(s.v[2]).toBeLessThan(5.3);
    expect(s.i.Z1).toBeLessThan(-6e-3); // about 6.8 mA flows from cathode to anode
  });

  it('does not conduct below the breakdown voltage', () => {
    const s = op(3, zener(3));
    expect(s.v[2]).toBeCloseTo(3, 2);
  });

  it('still acts as an ordinary diode in the forward direction', () => {
    const s = op(3, [dc('V1', 1, 0, 5), { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 }, { type: 'D', id: 'Z1', a: 2, b: 0, bv: 5.1 }]);
    expect(s.v[2]).toBeGreaterThan(0.6);
    expect(s.v[2]).toBeLessThan(0.8);
  });
});

describe('op-amp with supply rails', () => {
  // Nodes: 1 = +5 V, 2 = in+, 3 = in-, 4 = out.
  const amp = (vp: number, vn: number, headroom = 0, tie?: 'follower'): Element[] => [
    dc('Vcc', 1, 0, 5),
    dc('Vp', 2, 0, vp),
    ...(tie === 'follower' ? [] : [dc('Vn', 3, 0, vn)]),
    { type: 'OA', id: 'U1', a: 4, b: tie === 'follower' ? 4 : 3, c: 2, p: 1, n: 0, headroom },
  ];

  it('swings from ground to the positive rail as a comparator', () => {
    const hi = op(5, amp(2, 1));
    expect(hi.v[4]).toBeCloseTo(5, 2);
    const lo = op(5, amp(1, 2));
    expect(lo.v[4]).toBeCloseTo(0, 2);
  });

  it('clips a follower at the rail minus the headroom', () => {
    const s = op(5, [dc('Vcc', 1, 0, 5), dc('Vin', 2, 0, 6), { type: 'OA', id: 'U1', a: 4, b: 4, c: 2, p: 1, n: 0, headroom: 1.5 }]);
    expect(s.v[4]).toBeCloseTo(3.5, 2);
  });

  it('follows a signal inside the rails', () => {
    const s = op(5, [dc('Vcc', 1, 0, 5), dc('Vin', 2, 0, 2.2), { type: 'OA', id: 'U1', a: 4, b: 4, c: 2, p: 1, n: 0 }]);
    expect(s.v[4]).toBeCloseTo(2.2, 2);
  });

  it('collapses with its supply', () => {
    const s = op(5, [dc('Vcc', 1, 0, 0.0001), dc('Vin', 2, 0, 2), { type: 'OA', id: 'U1', a: 4, b: 3, c: 2, p: 1, n: 0 }, { type: 'R', id: 'R', a: 4, b: 0, r: 1000 }, { type: 'R', id: 'Rb', a: 3, b: 0, r: 1000 }]);
    expect(Math.abs(s.v[4])).toBeLessThan(0.01);
  });
});

describe('voltage-controlled switch and current source', () => {
  it('closes when the control voltage rises and opens when it falls (relay behaviour)', () => {
    // Nodes: 1 = control, 2 = 10 V, 3 = load.
    const sim = new Simulator({
      nodeCount: 4,
      elements: [
        { type: 'V', id: 'Vc', a: 1, b: 0, wave: { kind: 'pulse', low: 0, high: 5, period: 2e-3, duty: 0.5, delay: 0.1e-3 } },
        dc('Vs', 2, 0, 10),
        { type: 'VSW', id: 'K1', a: 2, b: 3, c: 1, d: 0, vth: 2.5 },
        { type: 'R', id: 'Rl', a: 3, b: 0, r: 1000 },
      ],
    });
    sim.beginTransient(10e-6, true);
    let s = sim.step();
    const at = (t: number): number => {
      while (s.time < t) s = sim.step();
      return s.v[3];
    };
    expect(at(0.5e-3)).toBeGreaterThan(9.5); // control high: closed
    expect(at(1.5e-3)).toBeLessThan(0.1); // control low: open
    expect(at(2.5e-3)).toBeGreaterThan(9.5); // and again
  });

  it('delivers gm times the control voltage', () => {
    const s = op(3, [dc('Vc', 1, 0, 2), { type: 'R', id: 'Rl', a: 2, b: 0, r: 1000 }, { type: 'G', id: 'G1', a: 0, b: 2, c: 1, d: 0, gm: 1e-3 }]);
    expect(s.v[2]).toBeCloseTo(2, 4);
  });

  it('generates a triangle wave between its levels', () => {
    const w = { kind: 'tri' as const, low: -1, high: 3, period: 1e-3 };
    expect(waveValue(w, 0)).toBeCloseTo(-1, 6);
    expect(waveValue(w, 0.25e-3)).toBeCloseTo(1, 6);
    expect(waveValue(w, 0.5e-3)).toBeCloseTo(3, 6);
    expect(waveValue(w, 0.75e-3)).toBeCloseTo(1, 6);
  });
});
