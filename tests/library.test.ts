import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Element, type Solution } from '../core/sim/solver';
import { customSpec, customType, expandModel, validateSpec } from '../src/editor/customParts';
import { evalExpression } from '../src/editor/expr';
import { importLibraryText, loadBuiltinLibrary, registerEmbedded, usedUserSpecs } from '../src/editor/library';
import { PART_DEFS, PART_ORDER, addPart, addWire, emptyDoc, pinPositions } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** Instantiates a library part inside a hand-built netlist. `pins` maps pin names to node numbers. */
function inst(id: string, pins: Record<string, number>, params: Record<string, number | boolean> = {}, start = 100): Element[] {
  const spec = customSpec(customType(id))!;
  let next = start;
  return expandModel(spec, `U_${id}`, params, new Map(Object.entries(pins)), () => next++);
}
/** One more than the highest node an element touches. Only op-amps use `p` and `n` as nodes (a diode's `n` is a number). */
const nodeCountOf = (els: Element[]): number =>
  1 +
  Math.max(
    ...els.flatMap((e) => {
      const nodes = [e.a, e.b];
      if ('c' in e && e.type !== 'C') nodes.push(e.c);
      if ('d' in e && typeof e.d === 'number') nodes.push(e.d);
      if (e.type === 'OA') nodes.push(e.p ?? 0, e.n ?? 0);
      return nodes;
    }),
  );
const dc = (id: string, a: number, b: number, value: number): Element => ({ type: 'V', id, a, b, wave: { kind: 'dc', value } });
const op = (els: Element[]): Solution => new Simulator({ nodeCount: nodeCountOf(els), elements: els }).operatingPoint();

describe('expression evaluator', () => {
  it('handles arithmetic, parameters, comparisons and functions', () => {
    const env = { r: 10000, pos: 0.25 };
    expect(evalExpression('$r * (1 - $pos)', env)).toBe(7500);
    expect(evalExpression('$pos > 0.5', env)).toBe(0);
    expect(evalExpression('$pos <= 0.5', env)).toBe(1);
    expect(evalExpression('max($r*$pos, 1) + 2^3', env)).toBe(2508);
    expect(evalExpression('4.7k + 1u', env)).toBeCloseTo(4700.000001, 6);
    expect(evalExpression('!0', env)).toBe(1);
  });

  it('rejects unknown parameters, bad syntax and anything that is not a number', () => {
    expect(() => evalExpression('$nope', {})).toThrow(/Unknown parameter/);
    expect(() => evalExpression('1 +', {})).toThrow();
    expect(() => evalExpression('process.exit()', {})).toThrow(/Unknown function|Unexpected/);
    expect(() => evalExpression('1 / 0', {})).toThrow(/Division/);
  });
});

describe('part library', () => {
  it('ships a large library of valid parts', () => {
    const custom = PART_ORDER.filter((t) => t.startsWith('x:'));
    expect(custom.length).toBeGreaterThanOrEqual(45);
    for (const t of custom) {
      const def = PART_DEFS[t];
      expect(def.pins.length, t).toBe(def.pinNames.length);
      expect(new Set(def.pinNames).size, t).toBe(def.pinNames.length);
    }
  });

  it('validates imported parts and explains what is wrong', () => {
    expect(validateSpec({ id: 'Bad Id' }).errors.join('\n')).toMatch(/lowercase/);
    const noParam = validateSpec({
      id: 'oops', label: { en: 'Oops' }, category: 'passive', prefix: 'R',
      symbol: { kind: 'like', like: 'R' }, model: { elements: [{ type: 'R', nodes: ['1', '2'], value: '$missing' }] },
    });
    expect(noParam.errors.join('\n')).toMatch(/unknown parameter \$missing/);
    const wrongNodes = validateSpec({
      id: 'oops2', label: { en: 'Oops' }, category: 'passive', prefix: 'R',
      symbol: { kind: 'like', like: 'R' }, model: { elements: [{ type: 'R', nodes: ['1'] }] },
    });
    expect(wrongNodes.errors.join('\n')).toMatch(/needs 2 nodes/);
  });

  it('imports a user part from JSON text and makes it usable', () => {
    const r = importLibraryText(
      JSON.stringify({
        parts: [
          {
            id: 'test-divider', label: { en: 'Divider 1:2', tr: 'Bölücü 1:2' }, category: 'passive', prefix: 'RD',
            symbol: { kind: 'box', left: ['IN', 'GND'], right: ['MID'] },
            model: { elements: [{ type: 'R', nodes: ['IN', 'MID'], value: 1000 }, { type: 'R', nodes: ['MID', 'GND'], value: 1000 }] },
          },
        ],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual(['test-divider']);
    const s = op([dc('V1', 1, 0, 8), ...inst('test-divider', { IN: 1, GND: 0, MID: 2 })]);
    expect(s.v[2]).toBeCloseTo(4, 6);
    expect(importLibraryText('not json').errors[0]).toMatch(/Not valid JSON/);
    expect(importLibraryText(JSON.stringify({ id: 'zener', label: { en: 'x' }, category: 'passive', prefix: 'R', symbol: { kind: 'like', like: 'R' } })).errors[0]).toMatch(/built-in/);
  });

  it('carries user parts inside the project document', () => {
    let doc = addPart(emptyDoc(), customType('test-divider'), 4, 4);
    doc = addPart(doc, 'R', 12, 4);
    expect(usedUserSpecs(doc).map((s) => s.id)).toEqual(['test-divider']);
    expect(registerEmbedded(usedUserSpecs(doc))).toEqual([]);
  });
});

describe('analog parts', () => {
  it('clamps with the Zener at the chosen voltage', () => {
    const s = op([dc('V1', 1, 0, 12), { type: 'R', id: 'R1', a: 1, b: 2, r: 1000 }, ...inst('zener', { A: 0, K: 2 }, { vz: 6.8 })]);
    expect(s.v[2]).toBeGreaterThan(6.8);
    expect(s.v[2]).toBeLessThan(7.0);
  });

  it('has a Schottky drop well below a silicon diode', () => {
    const s = op([dc('V1', 1, 0, 5), { type: 'R', id: 'R1', a: 1, b: 2, r: 470 }, ...inst('schottky', { A: 2, K: 0 })]);
    expect(s.v[2]).toBeGreaterThan(0.2);
    expect(s.v[2]).toBeLessThan(0.45);
  });

  it('drops different voltages across LED colours', () => {
    const drop = (id: string): number => op([dc('V1', 1, 0, 9), { type: 'R', id: 'R1', a: 1, b: 2, r: 660 }, ...inst(id, { A: 2, K: 0 })]).v[2];
    const [green, blue] = [drop('led-green'), drop('led-blue')];
    expect(green).toBeGreaterThan(1.8);
    expect(green).toBeLessThan(2.3);
    expect(blue).toBeGreaterThan(2.6);
    expect(blue).toBeLessThan(3.3);
  });

  it('divides with the potentiometer according to the wiper position', () => {
    const w = (pos: number): number => op([dc('V1', 1, 0, 10), ...inst('potentiometer', { A: 1, B: 0, W: 2 }, { r: 10000, pos }), { type: 'R', id: 'RL', a: 2, b: 0, r: 1e9 }]).v[2];
    expect(w(0.25)).toBeCloseTo(7.5, 2);
    expect(w(1)).toBeLessThan(0.01);
    expect(w(0)).toBeGreaterThan(9.99);
  });

  it('rectifies with the bridge', () => {
    const els: Element[] = [
      { type: 'V', id: 'Vac', a: 1, b: 2, wave: { kind: 'sin', offset: 0, amp: 10, freq: 50 } },
      ...inst('bridge', { AC1: 1, AC2: 2, 'DC+': 3, 'DC-': 4 }),
      { type: 'R', id: 'RL', a: 3, b: 4, r: 1000 },
      { type: 'R', id: 'Rg', a: 4, b: 0, r: 1 },
    ];
    const sim = new Simulator({ nodeCount: nodeCountOf(els), elements: els });
    sim.beginTransient(100e-6, true);
    let peak = -Infinity;
    let minimum = Infinity;
    for (let k = 0; k < 400; k++) {
      const s = sim.step();
      expect(s.converged).toBe(true);
      peak = Math.max(peak, s.v[3] - s.v[4]);
      minimum = Math.min(minimum, s.v[3] - s.v[4]);
    }
    expect(peak).toBeGreaterThan(8);
    expect(peak).toBeLessThan(9.2); // 10 V minus two diode drops
    expect(minimum).toBeGreaterThan(-0.1); // never negative: full-wave rectified
  });

  it('switches a relay contact when the coil is energised', () => {
    const run = (coil: number): number => {
      const els: Element[] = [dc('Vc', 1, 0, coil), dc('Vs', 2, 0, 10), ...inst('relay', { 'COIL+': 1, 'COIL-': 0, COM: 2, NO: 3, NC: 4 }), { type: 'R', id: 'Rno', a: 3, b: 0, r: 1000 }, { type: 'R', id: 'Rnc', a: 4, b: 0, r: 1000 }];
      const sim = new Simulator({ nodeCount: nodeCountOf(els), elements: els });
      sim.beginTransient(20e-6, true);
      let s = sim.step();
      while (s.time < 20e-3) s = sim.step();
      return s.v[3] - s.v[4]; // positive when NO is connected, negative when NC is
    };
    expect(run(5)).toBeGreaterThan(9);
    expect(run(0)).toBeLessThan(-9);
  });

  it('regulates 9 V down to 5 V and drops out when the input is low', () => {
    const out = (vin: number): number => op([dc('V1', 1, 0, vin), ...inst('regulator', { IN: 1, GND: 0, OUT: 2 }, { vout: 5 }), { type: 'R', id: 'RL', a: 2, b: 0, r: 100 }]).v[2];
    expect(out(9)).toBeGreaterThan(4.9);
    expect(out(9)).toBeLessThan(5.1);
    expect(out(12)).toBeGreaterThan(4.9);
    expect(out(5.5)).toBeLessThan(4);
  });

  it('keeps a single-supply op-amp inside 0..Vcc (LM358 buffer)', () => {
    const buffer = (vin: number): number => op([dc('Vcc', 1, 0, 5), dc('Vin', 2, 0, vin), ...inst('lm358', { VCC: 1, GND: 0, 'IN1+': 2, 'IN1-': 3, OUT1: 3, 'IN2+': 0, 'IN2-': 5, OUT2: 5 })]).v[3];
    expect(buffer(2.5)).toBeCloseTo(2.5, 2);
    expect(buffer(4.9)).toBeLessThan(3.6); // output cannot reach the rail
  });

  it('reads voltage and current with the meters', () => {
    expect(customSpec(customType('voltmeter'))!.meter).toBe('voltage');
    expect(customSpec(customType('ammeter'))!.meter).toBe('current');
    const els: Element[] = [dc('V1', 1, 0, 5), ...inst('ammeter', { '+': 1, '-': 2 }), { type: 'R', id: 'RL', a: 2, b: 0, r: 500 }];
    const s = op(els);
    expect(s.i[els[1].id]).toBeCloseTo(0.01, 4);
  });
});

describe('logic parts', () => {
  const truth: Record<string, (a: number, b: number) => number> = {
    nand: (a, b) => (a && b ? 0 : 1),
    nor: (a, b) => (a || b ? 0 : 1),
    and: (a, b) => (a && b ? 1 : 0),
    or: (a, b) => (a || b ? 1 : 0),
    xor: (a, b) => (a !== b ? 1 : 0),
    xnor: (a, b) => (a === b ? 1 : 0),
  };
  it.each(Object.keys(truth))('the %s gate follows its truth table at 5 V', (name) => {
    for (const a of [0, 1]) {
      for (const b of [0, 1]) {
        const s = op([dc('Va', 1, 0, a * 5), dc('Vb', 2, 0, b * 5), ...inst(`gate-${name}`, { A: 1, B: 2, Y: 3 }), { type: 'R', id: 'RL', a: 3, b: 0, r: 100000 }]);
        expect(s.converged, `${name} ${a}${b}`).toBe(true);
        expect(s.v[3] > 2.5 ? 1 : 0, `${name}(${a},${b}) = ${s.v[3].toFixed(2)} V`).toBe(truth[name](a, b));
        expect(s.v[3] < 0.2 || s.v[3] > 4.8, 'output reaches a rail').toBe(true);
      }
    }
  });

  it('inverts and buffers', () => {
    const level = (id: string, vin: number): number => op([dc('Va', 1, 0, vin), ...inst(id, { A: 1, Y: 2 }), { type: 'R', id: 'RL', a: 2, b: 0, r: 1e5 }]).v[2];
    expect(level('gate-inv', 0)).toBeGreaterThan(4.8);
    expect(level('gate-inv', 5)).toBeLessThan(0.2);
    expect(level('gate-buf', 5)).toBeGreaterThan(4.8);
  });

  it('a 74HC00 powered by its own pins works like four NAND gates', () => {
    const run = (a: number, b: number): number =>
      op([dc('Vcc', 1, 0, 5), dc('Va', 2, 0, a * 5), dc('Vb', 3, 0, b * 5), ...inst('74hc00', { VCC: 1, GND: 0, '3A': 2, '3B': 3, '3Y': 4, '1A': 0, '1B': 0, '2A': 0, '2B': 0, '4A': 0, '4B': 0 }), { type: 'R', id: 'RL', a: 4, b: 0, r: 1e5 }]).v[4];
    expect(run(1, 1)).toBeLessThan(0.2);
    expect(run(1, 0)).toBeGreaterThan(4.8);
  });

  it('the D flip-flop captures D on the rising clock edge only', () => {
    const els: Element[] = [
      { type: 'V', id: 'Vd', a: 1, b: 0, wave: { kind: 'pulse', low: 0, high: 5, period: 4e-3, duty: 0.5 } }, // high 0-2 ms, low 2-4 ms
      { type: 'V', id: 'Vclk', a: 2, b: 0, wave: { kind: 'pulse', low: 0, high: 5, period: 2e-3, duty: 0.5, delay: 1e-3 } }, // rising edges at 1 ms and 3 ms
      ...inst('dff', { D: 1, CLK: 2, Q: 3, QN: 4 }),
      { type: 'R', id: 'RL', a: 3, b: 0, r: 1e5 },
    ];
    const sim = new Simulator({ nodeCount: nodeCountOf(els), elements: els });
    sim.beginTransient(10e-6, true);
    let s = sim.step();
    const q = (t: number): number => {
      while (s.time < t) {
        s = sim.step();
        expect(s.converged).toBe(true);
      }
      return s.v[3];
    };
    expect(q(1.5e-3)).toBeGreaterThan(4.5); // captured D = 1 at the first edge
    expect(q(2.5e-3)).toBeGreaterThan(4.5); // D fell, the clock is low: unchanged
    expect(q(3.5e-3)).toBeLessThan(0.5); // second edge captured D = 0
  });
});

describe('555 timer', () => {
  it('oscillates in the astable circuit at 1.44 / ((R1 + 2 R2) C)', () => {
    // Nodes: 1 = Vcc, 2 = THR/TRIG, 3 = OUT, 4 = DISCH.
    const els: Element[] = [
      dc('Vcc', 1, 0, 5),
      { type: 'R', id: 'R1', a: 1, b: 4, r: 1000 },
      { type: 'R', id: 'R2', a: 4, b: 2, r: 10000 },
      { type: 'C', id: 'C1', a: 2, b: 0, c: 100e-9 },
      ...inst('ne555', { GND: 0, TRIG: 2, OUT: 3, RESET: 1, CTRL: 5, THR: 2, DISCH: 4, VCC: 1 }),
      { type: 'R', id: 'RL', a: 3, b: 0, r: 10000 },
    ];
    const sim = new Simulator({ nodeCount: nodeCountOf(els), elements: els });
    const dt = 5e-6;
    sim.beginTransient(dt, true);
    const rises: number[] = [];
    let prev = 0;
    let high = 0;
    let n = 0;
    for (let k = 0; k < 4000; k++) {
      const s = sim.step();
      expect(s.converged, `step ${k}`).toBe(true);
      const v = s.v[3];
      if (prev < 2.5 && v >= 2.5) rises.push(s.time);
      if (s.time > 4e-3) {
        n++;
        if (v > 2.5) high++;
      }
      prev = v;
    }
    expect(rises.length).toBeGreaterThanOrEqual(8);
    const periods = rises.slice(2).map((t, i) => t - rises.slice(2)[i - 1]).slice(1);
    const mean = periods.reduce((a, b) => a + b, 0) / periods.length;
    const expected = (0.693 * (1000 + 2 * 10000) * 100e-9);
    expect(mean).toBeGreaterThan(expected * 0.93);
    expect(mean).toBeLessThan(expected * 1.07);
    // Duty cycle = (R1 + R2) / (R1 + 2 R2) = 52 %.
    expect(high / n).toBeGreaterThan(0.47);
    expect(high / n).toBeLessThan(0.57);
  });
});

describe('library parts in a schematic', () => {
  it('expands a placed part inside the extracted netlist', () => {
    // 10 V source -> Zener (reverse) chain via a resistor, built from schematic parts and wires.
    let doc = addPart(emptyDoc(), 'VDC', 0, 4);
    doc = { ...doc, parts: doc.parts.map((p) => ({ ...p, params: { ...p.params, v: 10 } })) };
    doc = addPart(doc, 'R', 8, 0);
    doc = addPart(doc, customType('zener'), 14, 4, 90); // A at the top (14, 2), K at the bottom (14, 6)... rotated: see pins below
    doc = addPart(doc, 'GND', 0, 10);
    const [vPlus, vMinus] = pinPositions(doc.parts[0]);
    const [r1, r2] = pinPositions(doc.parts[1]);
    const [zA, zK] = pinPositions(doc.parts[2]);
    const wire = (d: typeof doc, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const corner = { x: b.x, y: a.y };
      return addWire(addWire(d, a, corner), corner, b);
    };
    // Rotating the symbol by 90 degrees puts A on top; the Zener must have K towards the resistor to regulate, so use K on top.
    const top = zA.y < zK.y ? zA : zK;
    const bottom = zA.y < zK.y ? zK : zA;
    doc = wire(doc, vPlus, { x: vPlus.x, y: r1.y });
    doc = wire(doc, vPlus, r1);
    doc = wire(doc, r2, top);
    doc = wire(doc, bottom, { x: bottom.x, y: 12 });
    doc = wire(doc, vMinus, { x: vMinus.x, y: 12 });
    doc = wire(doc, { x: vMinus.x, y: 12 }, { x: bottom.x, y: 12 });
    const x = extractNetlist(doc);
    expect(x.error).toBeNull();
    expect(x.netlist!.elements.some((e) => e.type === 'D' && e.id.startsWith(doc.parts[2].id))).toBe(true);
    const s = new Simulator(x.netlist!).operatingPoint();
    expect(s.converged).toBe(true);
  });
});

describe('documentation example', () => {
  it('library/examples/rc-filter.json imports and behaves as a low-pass filter', async () => {
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(new URL('../library/examples/rc-filter.json', import.meta.url), 'utf-8');
    const r = importLibraryText(text);
    expect(r.errors).toEqual([]);
    expect(r.added).toEqual(['rc-lowpass']);
    const els = [dc('V1', 1, 0, 5), ...inst('rc-lowpass', { IN: 1, GND: 0, OUT: 2 }), { type: 'R', id: 'RL', a: 2, b: 0, r: 1000 } as Element];
    expect(op(els).v[2]).toBeCloseTo(2.5, 2); // DC: R and the load form a divider; the capacitor is open
  });
});
