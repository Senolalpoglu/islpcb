import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Element } from '../core/sim/solver';
import { customSpec, customType, expandModel } from '../src/editor/customParts';
import { loadBuiltinLibrary } from '../src/editor/library';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

function inst(id: string, pins: Record<string, number>, params: Record<string, number | boolean> = {}, start = 100): Element[] {
  const spec = customSpec(customType(id));
  if (!spec) throw new Error(`no part ${id}`);
  let next = start;
  return expandModel(spec, `U_${id}`, params, new Map(Object.entries(pins)), () => next++);
}
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
const res = (id: string, a: number, b: number, r: number): Element => ({ type: 'R', id, a, b, r });
const sim = (els: Element[]): Simulator => new Simulator({ nodeCount: nodeCountOf(els), elements: els });
const op = (els: Element[]) => {
  const s = sim(els).operatingPoint();
  expect(s.converged).toBe(true);
  return s;
};

describe('regulators', () => {
  const out = (id: string, vin: number, pins: Record<string, number>, load = 100): number => {
    const els = [dc('Vin', 1, 0, vin), ...inst(id, pins), res('RL', pins.OUT, 0, load)];
    return op(els).v[pins.OUT];
  };
  it('78xx family regulates to its voltage', () => {
    expect(out('lm7805', 9, { IN: 1, GND: 0, OUT: 2 })).toBeCloseTo(5, 1);
    expect(out('lm7809', 12, { IN: 1, GND: 0, OUT: 2 })).toBeCloseTo(9, 1);
    expect(out('lm7812', 15, { IN: 1, GND: 0, OUT: 2 })).toBeCloseTo(12, 1);
    expect(out('lm7805', 6, { IN: 1, GND: 0, OUT: 2 })).toBeLessThan(4.6); // below dropout it follows the input down
  });
  it('79xx family regulates a negative rail', () => {
    expect(out('lm7905', -9, { GND: 0, IN: 1, OUT: 2 })).toBeCloseTo(-5, 1);
    expect(out('lm7912', -15, { GND: 0, IN: 1, OUT: 2 })).toBeCloseTo(-12, 1);
  });
  it('LDO regulators need less headroom', () => {
    expect(out('lm1117-3v3', 5, { GND: 0, OUT: 2, IN: 1 })).toBeCloseTo(3.3, 1);
    expect(out('ams1117-3v3', 4.6, { GND: 0, OUT: 2, IN: 1 })).toBeCloseTo(3.3, 1);
    expect(out('lm2940-5', 5.8, { IN: 1, GND: 0, OUT: 2 })).toBeGreaterThan(4.9);
  });
  it('LM317 sets Vout = 1.25 V (1 + R2 / R1)', () => {
    // R1 = 240 from OUT to ADJ, R2 = 720 from ADJ to ground: 5 V.
    const els = [dc('Vin', 1, 0, 12), ...inst('lm317', { ADJ: 3, IN: 1, OUT: 2 }), res('R1', 2, 3, 240), res('R2', 3, 0, 720), res('RL', 2, 0, 100)];
    expect(op(els).v[2]).toBeCloseTo(5, 1);
  });
});

describe('thyristors', () => {
  it('an SCR latches on after a gate pulse and stays on without the gate', () => {
    // 12 V -> 100 ohm -> anode; the gate sees a 1 ms pulse through 1 k.
    const gate: Element = { type: 'V', id: 'Vg', a: 3, b: 0, wave: { kind: 'pulse', low: 0, high: 5, period: 1, duty: 0.001 } };
    const els = [dc('Vcc', 1, 0, 12), res('RL', 1, 2, 100), res('Rg', 3, 4, 1000), gate, ...inst('scr-bt151', { A: 2, K: 0, G: 4 })];
    const s = sim(els);
    s.beginTransient(1e-4, true);
    let last = s.step();
    while (last.time < 3e-3) last = s.step();
    expect(last.v[2]).toBeLessThan(1.5); // on: the load carries almost all of the 12 V
    while (last.time < 20e-3) last = s.step();
    expect(last.v[2]).toBeLessThan(1.5); // still on, the gate is long gone
  });
  it('an SCR without a gate pulse blocks', () => {
    const els = [dc('Vcc', 1, 0, 12), res('RL', 1, 2, 100), ...inst('scr-bt151', { A: 2, K: 0, G: 0 })];
    expect(op(els).v[2]).toBeGreaterThan(11.9);
  });
  it('a triac with the gate held conducts on both half-cycles', () => {
    const ac: Element = { type: 'V', id: 'Vac', a: 1, b: 0, wave: { kind: 'sin', offset: 0, amp: 30, freq: 50 } };
    const els = [ac, res('RL', 1, 2, 100), dc('Vg', 4, 0, 5), res('Rg', 4, 3, 220), ...inst('triac-bt136', { MT2: 2, MT1: 0, G: 3 })];
    const s = sim(els);
    s.beginTransient(1e-4, true);
    let hi = -Infinity;
    let lo = Infinity;
    for (let k = 0; k < 400; k++) {
      const r = s.step();
      if (r.time > 5e-3) {
        const iload = (r.v[1] - r.v[2]) / 100;
        hi = Math.max(hi, iload);
        lo = Math.min(lo, iload);
      }
    }
    expect(hi).toBeGreaterThan(0.2);
    expect(lo).toBeLessThan(-0.2);
  });
});

describe('transistors', () => {
  it('2N3904 saturates as a switch, a BC557 conducts with its base low', () => {
    const npn = op([dc('Vcc', 1, 0, 5), res('Rb', 1, 2, 10000), res('Rc', 1, 3, 1000), ...inst('2n3904', { C: 3, B: 2, E: 0 })]);
    expect(npn.v[3]).toBeLessThan(0.4);
    const pnp = op([dc('Vcc', 1, 0, 5), res('Rb', 2, 0, 10000), res('Rc', 3, 0, 1000), ...inst('bc557', { C: 3, B: 2, E: 1 })]);
    expect(pnp.v[3]).toBeGreaterThan(4.3);
  });
  it('TIP120 Darlington needs about two diode drops at the base', () => {
    const els = [dc('Vcc', 1, 0, 12), res('Rl', 1, 3, 10), dc('Vb', 4, 0, 5), res('Rb', 4, 2, 1000), ...inst('tip120', { C: 3, B: 2, E: 0 })];
    const s = op(els);
    expect(s.v[2]).toBeGreaterThan(1.0); // base sits at roughly 1.2-1.5 V
    expect(s.v[3]).toBeLessThan(1.5);
  });
  it('IRF540N turns a 12 V / 10 ohm load on with a 5 V gate and IRLZ44N with 3 V', () => {
    const fet = (id: string, vg: number): number => op([dc('Vcc', 1, 0, 12), res('Rl', 1, 2, 10), dc('Vg', 3, 0, vg), ...inst(id, { D: 2, G: 3, S: 0 })]).v[2];
    expect(fet('irf540n', 5)).toBeLessThan(1);
    expect(fet('irf540n', 2)).toBeGreaterThan(11.9);
    expect(fet('irlz44n', 3)).toBeLessThan(1);
  });
});

describe('relays and switches', () => {
  const coilOn = (v: number) => dc('Vc', 1, 0, v);
  it('DPDT relay switches both contacts together', () => {
    const pins = { 'COIL+': 1, 'COIL-': 0, COM1: 2, NC1: 3, NO1: 4, COM2: 5, NC2: 6, NO2: 7 };
    const wiring = [dc('Vx', 8, 0, 12), res('Ra', 8, 2, 100), res('Rb', 8, 5, 100), res('N1', 3, 0, 100), res('O1', 4, 0, 100), res('N2', 6, 0, 100), res('O2', 7, 0, 100)];
    const off = op([coilOn(0), ...wiring, ...inst('relay-dpdt', pins)]);
    expect(off.v[3]).toBeGreaterThan(5);
    expect(off.v[4]).toBeLessThan(0.5);
    expect(off.v[6]).toBeGreaterThan(5);
    const on = op([coilOn(5), ...wiring, ...inst('relay-dpdt', pins)]);
    expect(on.v[4]).toBeGreaterThan(5);
    expect(on.v[3]).toBeLessThan(0.5);
    expect(on.v[7]).toBeGreaterThan(5);
    expect(on.v[6]).toBeLessThan(0.5);
  });
  it('SPST-NO and 3PDT relays follow their coil', () => {
    const no = (v: number) => op([coilOn(v), dc('Vx', 4, 0, 12), res('R', 4, 2, 100), res('L', 3, 0, 100), ...inst('relay-spst-no', { 'COIL+': 1, 'COIL-': 0, COM: 2, NO: 3 })]).v[3];
    expect(no(0)).toBeLessThan(0.5);
    expect(no(5)).toBeGreaterThan(5);
    const pins = { 'COIL+': 1, 'COIL-': 0, COM1: 2, NC1: 10, NO1: 3, COM2: 4, NC2: 11, NO2: 5, COM3: 6, NC3: 12, NO3: 7 };
    const on = op([coilOn(5), dc('Vx', 8, 0, 12), res('R1', 8, 2, 100), res('R2', 8, 4, 100), res('R3', 8, 6, 100), res('L1', 3, 0, 100), res('L2', 5, 0, 100), res('L3', 7, 0, 100), ...inst('relay-3pdt', pins)]);
    expect([3, 5, 7].every((n) => on.v[n] > 5)).toBe(true);
  });
  it('SSR closes its output when the input is driven', () => {
    const out = (vin: number) => op([dc('Vin', 1, 0, vin), dc('Vx', 4, 0, 12), res('R', 4, 3, 100), res('L', 2, 0, 100), ...inst('ssr-dc', { 'IN+': 1, 'IN-': 0, 'OUT+': 3, 'OUT-': 2 })]).v[2];
    expect(out(0)).toBeLessThan(0.1);
    expect(out(5)).toBeGreaterThan(5);
  });
  it('a push button follows its pressed state', () => {
    const v = (id: string, closed: boolean) => op([dc('V', 1, 0, 5), ...inst(id, { '1': 1, '2': 2 }, { closed }), res('R', 2, 0, 1000)]).v[2];
    expect(v('pushbutton', false)).toBeLessThan(0.1);
    expect(v('pushbutton', true)).toBeGreaterThan(4.9);
    expect(v('pushbutton-nc', false)).toBeGreaterThan(4.9);
    expect(v('pushbutton-nc', true)).toBeLessThan(0.1);
  });
});

describe('magnetics and sources', () => {
  it('a transformer scales an AC voltage by its turns ratio', () => {
    const ac: Element = { type: 'V', id: 'Vac', a: 1, b: 0, wave: { kind: 'sin', offset: 0, amp: 10, freq: 50 } };
    const els = [ac, ...inst('transformer', { P1: 1, P2: 0, S1: 2, S2: 3 }, { n: 2 }), res('RL', 2, 3, 1000), res('Rg', 3, 0, 1)];
    const s = sim(els);
    s.beginTransient(1e-4, true);
    let peak = 0;
    for (let k = 0; k < 600; k++) {
      const r = s.step();
      if (r.time > 0.02) peak = Math.max(peak, Math.abs(r.v[2] - r.v[3]));
    }
    expect(peak).toBeGreaterThan(18);
    expect(peak).toBeLessThan(21);
  });
  it('a cell sags with its internal resistance', () => {
    const s = op([...inst('cell-aa', { '+': 1, '-': 0 }), res('RL', 1, 0, 1.3)]);
    expect(s.v[1]).toBeCloseTo(1.3, 2); // 1.5 V across 0.2 + 1.3 ohm
  });
  it('an 1N4733 clamps at 5.1 V in reverse (at its 49 mA test current, a little less at 21 mA)', () => {
    const at = (r: number) => op([dc('V', 1, 0, 12), res('R', 1, 2, r), ...inst('1n4733', { A: 0, K: 2 })]).v[2];
    expect(at(140.8)).toBeCloseTo(5.1, 1); // (12 - 5.1) / 49 mA
    expect(at(330)).toBeGreaterThan(4.8); // 7 ohm dynamic impedance: 28 mA less current, about 0.2 V less
    expect(at(330)).toBeLessThan(5.1);
  });
});

describe('sensors and modules', () => {
  it('LM35 reads 10 mV per degree and TMP36 adds 0.5 V', () => {
    expect(op([dc('V', 1, 0, 5), ...inst('lm35', { '+VS': 1, VOUT: 2, GND: 0 }, { temp: 30 })]).v[2]).toBeCloseTo(0.3, 3);
    expect(op([dc('V', 1, 0, 5), ...inst('tmp36', { '+VS': 1, VOUT: 2, GND: 0 }, { temp: 25 })]).v[2]).toBeCloseTo(0.75, 3);
  });
  it('an analog sensor module moves AO with its level and trips DO', () => {
    const at = (level: number) => op([dc('V', 1, 0, 5), ...inst('ldr-module', { VCC: 1, GND: 0, DO: 3, AO: 2 }, { level })]);
    expect(at(0.5).v[2]).toBeCloseTo(2.5, 1);
    expect(at(0.1).v[2]).toBeLessThan(0.7);
    expect(at(0.9).v[3]).toBeGreaterThan(4.5);
    expect(at(0.1).v[3]).toBeLessThan(0.5);
  });
  it('a pinout-only module draws its supply current', () => {
    const s = op([dc('V', 1, 0, 5), ...inst('hc-05', { VCC: 1, GND: 0, STATE: 2, RXD: 3, TXD: 4, EN: 5 })]);
    expect(Math.abs(s.i['V'])).toBeCloseTo(0.03, 3);
  });
  it('the relay module is active low', () => {
    const at = (vin: number) => op([dc('V', 1, 0, 5), dc('Vin', 2, 0, vin), dc('Vx', 6, 0, 12), res('R', 6, 3, 100), res('Ln', 4, 0, 100), res('Lo', 5, 0, 100), ...inst('relay-module-1ch', { 'DC+': 1, 'DC-': 0, IN: 2, NC: 4, COM: 3, NO: 5 })]);
    expect(at(0).v[5]).toBeGreaterThan(5);
    expect(at(5).v[4]).toBeGreaterThan(5);
  });
  it('L298N drives a motor in either direction', () => {
    const at = (in1: number, in2: number) => {
      const els = [dc('Vm', 1, 0, 12), dc('Ven', 2, 0, 5), dc('Vi1', 3, 0, in1), dc('Vi2', 4, 0, in2), res('Rm', 5, 6, 12), ...inst('l298n', { OUT1: 5, OUT2: 6, '12V': 1, GND: 0, '5V': 7, OUT3: 8, OUT4: 9, ENA: 2, IN1: 3, IN2: 4, IN3: 0, IN4: 0, ENB: 0 })];
      const s = op(els);
      return s.v[5] - s.v[6];
    };
    expect(at(5, 0)).toBeGreaterThan(9);
    expect(at(0, 5)).toBeLessThan(-9);
    expect(Math.abs(at(0, 0))).toBeLessThan(0.1);
  });
  it('ULN2003 pulls its output low when the input is high', () => {
    const idle = { '2B': 0, '3B': 0, '4B': 0, '5B': 0, '6B': 0, '7B': 0, '2C': 8, '3C': 8, '4C': 8, '5C': 8, '6C': 8, '7C': 8 };
    const at = (vin: number) => op([dc('V', 1, 0, 5), dc('Vin', 2, 0, vin), res('RL', 1, 3, 1000), ...inst('uln2003', { '1B': 2, '1C': 3, GND: 0, COM: 1, ...idle })]).v[3];
    expect(at(0)).toBeGreaterThan(4.9);
    expect(at(5)).toBeLessThan(1.6);
  });
});
