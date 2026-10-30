import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { addPart, addWire, emptyDoc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

// Some examples use parts of the shipped library (the relay module of the serial-control example).
beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

describe('netlist extraction', () => {
  it('reports an empty circuit and a missing ground', () => {
    expect(extractNetlist(emptyDoc()).error).toBe('empty');
    expect(extractNetlist(addPart(emptyDoc(), 'R', 5, 5)).error).toBe('noGround');
  });

  it('joins a pin that touches the middle of a wire', () => {
    let d = addPart(emptyDoc(), 'GND', 0, 0);
    d = addPart(d, 'R', 6, 0); // pins at (4,0) and (8,0)
    d = addPart(d, 'R', 6, 4, 90); // pin 0 at (6,2), pin 1 at (6,6)
    d = addWire(d, { x: 0, y: 0 }, { x: 8, y: 0 }); // runs through (4,0) and (8,0)
    const x = extractNetlist(d);
    expect(x.error).toBeNull();
    // Both ends of the horizontal resistor sit on the ground wire.
    expect(x.nodeOfPin.get('p2:0')).toBe(0);
    expect(x.nodeOfPin.get('p2:1')).toBe(0);
    // The vertical resistor touches nothing.
    expect(x.nodeOfPin.get('p3:0')).not.toBe(0);
  });

  it('builds a solvable circuit from every example', () => {
    for (const ex of EXAMPLES) {
      const x = extractNetlist(ex.build());
      expect(x.error, ex.id).toBeNull();
      const op = new Simulator(x.netlist!).operatingPoint();
      expect(op.converged, ex.id).toBe(true);
    }
  });

  it('puts about 10 mA through the LED example (5 V, 330 ohm, ~1.9 V LED)', () => {
    const ex = EXAMPLES.find((e) => e.id === 'led')!;
    const doc = ex.build();
    const x = extractNetlist(doc);
    const op = new Simulator(x.netlist!).operatingPoint();
    const led = doc.parts.find((p) => p.type === 'LED')!;
    expect(op.i[led.id]).toBeGreaterThan(8e-3);
    expect(op.i[led.id]).toBeLessThan(12e-3);
  });

  it('turns the BJT driver on and off with its base pulse', () => {
    const ex = EXAMPLES.find((e) => e.id === 'bjt')!;
    const doc = ex.build();
    const x = extractNetlist(doc);
    expect(x.error).toBeNull();
    const q = doc.parts.find((p) => p.type === 'QNPN')!;
    const sim = new Simulator(x.netlist!);
    sim.beginTransient(ex.dt, true);
    let s = sim.step();
    while (s.time < 2e-3) s = sim.step(); // pulse is high for the first 5 ms
    expect(s.converged).toBe(true);
    expect(s.i[q.id]).toBeGreaterThan(5e-3); // saturated, LED lit
    while (s.time < 8e-3) s = sim.step(); // low phase
    expect(Math.abs(s.i[q.id])).toBeLessThan(1e-6);
  });

  it('amplifies by -10 in the op-amp example', () => {
    const ex = EXAMPLES.find((e) => e.id === 'opamp')!;
    const doc = ex.build();
    const x = extractNetlist(doc);
    expect(x.error).toBeNull();
    const probes = doc.parts.filter((p) => p.type === 'PROBE');
    const nIn = x.nodeOfPin.get(`${probes[0].id}:0`)!;
    const nOut = x.nodeOfPin.get(`${probes[1].id}:0`)!;
    const sim = new Simulator(x.netlist!);
    sim.beginTransient(ex.dt, true);
    let worst = 0;
    let peakIn = 0;
    let peakOut = 0;
    for (let k = 0; k < 400; k++) {
      const s = sim.step();
      expect(s.converged).toBe(true);
      worst = Math.max(worst, Math.abs(s.v[nOut] + 10 * s.v[nIn]));
      peakIn = Math.max(peakIn, Math.abs(s.v[nIn]));
      peakOut = Math.max(peakOut, Math.abs(s.v[nOut]));
    }
    expect(peakIn).toBeGreaterThan(0.45); // the input really swings (0.5 V peak)
    expect(peakOut).toBeGreaterThan(4.5); // and the output follows, inverted and 10x larger
    expect(worst).toBeLessThan(0.01);
  });

  it('settles the RC example to the right level at the end of a high phase', () => {
    const ex = EXAMPLES.find((e) => e.id === 'rc')!;
    const doc = ex.build();
    const x = extractNetlist(doc);
    const sim = new Simulator(x.netlist!);
    sim.beginTransient(ex.dt, true); // power-up: capacitors start at their initial voltage
    let s = sim.step();
    // 200 Hz pulse: high for 2.5 ms; tau = 1 ms, so the cap reaches 5 * (1 - e^-2.5).
    while (s.time < 2.5e-3 - ex.dt / 2) s = sim.step();
    const c = doc.parts.find((p) => p.type === 'C')!;
    const out = s.v[x.nodeOfPin.get(`${c.id}:0`)!];
    expect(out).toBeCloseTo(5 * (1 - Math.exp(-2.5)), 1);
  });
});
