import { beforeAll, describe, expect, it } from 'vitest';
import { footprintById } from '../core/pcb/footprints';
import { Simulator, type Element } from '../core/sim/solver';
import { customSpec, customType, expandModel } from '../src/editor/customParts';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, type PartType } from '../src/editor/model';
import { defaultFootprint } from '../src/pcb/sync';

// The parts taken from direnc.net must behave like their datasheets say, not just exist: these tests read the
// numbers a datasheet quotes (hFE, Rds(on), Vf, Vz, VT, gain, thresholds, sensitivity) off the simulation.

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
const amps = (id: string, a: number, b: number, value: number): Element => ({ type: 'I', id, a, b, wave: { kind: 'dc', value } });
const op = (els: Element[]) => {
  const s = new Simulator({ nodeCount: nodeCountOf(els), elements: els }).operatingPoint();
  expect(s.converged).toBe(true);
  return s;
};
const within = (value: number, target: number, tol: number, what = ''): void => {
  expect(Math.abs(value - target), `${what}: ${value} vs ${target}`).toBeLessThanOrEqual(tol);
};

describe('MOSFETs follow Rds(on) and have a body diode', () => {
  /** Nodes: 1 supply, 2 drain, 3 gate, 4 source. The load sits on the drain side (n-channel) or the source side (p-channel). */
  const measure = (id: string, vg: number, pchannel: boolean, rl: number, vdd: number): { vds: number; id: number } => {
    const els: Element[] = [dc('Vdd', 1, 0, vdd), dc('Vg', 3, 0, vg)];
    if (pchannel) els.push(res('Rs', 4, 1, 1e-6), res('RL', 2, 0, rl), ...inst(id, { D: 2, G: 3, S: 4 }));
    else els.push(res('RL', 1, 2, rl), res('Rs', 4, 0, 1e-6), ...inst(id, { D: 2, G: 3, S: 4 }));
    const s = op(els);
    return pchannel ? { vds: s.v[4] - s.v[2], id: s.v[2] / rl } : { vds: s.v[2] - s.v[4], id: (vdd - s.v[2]) / rl };
  };
  // Rds(on) and the drain current of the datasheet's test point (Vgs = 10 V).
  const cases: Array<[string, number, number]> = [['irf510', 0.54, 3.4], ['irf530', 0.16, 8.4], ['irf540', 0.077, 17], ['irf630', 0.4, 5.4], ['6n60', 1.2, 3], ['12n65', 0.7, 6]];
  it.each(cases)('%s has the datasheet Rds(on) at its test current, Vgs = 10 V', (id, r, i) => {
    const m = measure(id, 10, false, (12 - r * i) / i, 12);
    within(m.id, i, i * 0.03, `${id} current`);
    within(m.vds / m.id, r, r * 0.04, id);
  });
  it('and a lower current sees a lower Rds (the channel is not a fixed resistor)', () => {
    const m = measure('irf510', 10, false, 12, 12);
    expect(m.vds / m.id).toBeLessThan(0.54);
    expect(m.vds / m.id).toBeGreaterThan(0.4);
  });
  it('P-channel IRF9Z24N and IRF5210 conduct with the gate 10 V below the source', () => {
    const a = measure('irf9z24n', 2, true, (12 - 0.175 * 7.2) / 7.2, 12);
    within(a.vds / a.id, 0.175, 0.007, 'irf9z24n');
    const b = measure('irf5210', 2, true, (12 - 0.06 * 21) / 21, 12);
    within(b.vds / b.id, 0.06, 0.003, 'irf5210');
  });
  it('2N7002 is about 2 ohm at 10 V and blocks at 0 V', () => {
    const on = measure('2n7002', 10, false, 22, 12);
    within(on.vds / on.id, 2.0, 0.1, '2n7002');
    expect(measure('2n7002', 0, false, 100, 12).vds).toBeGreaterThan(11.99);
  });
  it('the body diode conducts from source to drain with the gate off', () => {
    const s = op([dc('V', 1, 0, 5), res('R', 1, 2, 5), ...inst('irf540', { D: 0, G: 0, S: 2 })]);
    expect(s.v[2]).toBeGreaterThan(0.6);
    expect(s.v[2]).toBeLessThan(1.1);
  });
});

describe('bipolar transistors have the datasheet hFE and Vbe', () => {
  it.each([['bc107', 250, 8e-6, 4700], ['bc108', 300, 8e-6, 4700], ['bc140', 100, 50e-6, 4700], ['tip29c', 40, 5e-3, 100]] as Array<[string, number, number, number]>)('%s: Ic / Ib = hFE', (id, hfe, ib, rc) => {
    // Emitter at ground. Ib is set by a resistor from a 5 V source; Rc from 30 V keeps the transistor active.
    const rb = (5 - 0.7) / ib;
    const pins = id === 'tip29c' ? { B: 4, C: 2, E: 0 } : { B: 4, C: 2, E: 0 };
    const s = op([dc('Vcc', 1, 0, 30), res('Rc', 1, 2, rc), dc('Vb', 3, 0, 5), res('Rb', 3, 4, rb), ...inst(id, pins)]);
    const base = (s.v[3] - s.v[4]) / rb;
    const col = (30 - s.v[2]) / rc;
    expect(s.v[2], 'active region').toBeGreaterThan(3);
    within(col / base, hfe, hfe * 0.15, id);
  });
  it('BC107 has Vbe 0.65 V at 2 mA', () => {
    const s = op([dc('Vcc', 1, 0, 20), res('Rc', 1, 2, 4700), dc('Vb', 3, 0, 5), res('Rb', 3, 4, 4.35 / 8e-6), ...inst('bc107', { E: 0, B: 4, C: 2 })]);
    within(s.v[4], 0.65, 0.04, 'vbe');
  });
  it('PNP BC856B and MMBT2907A amplify with their hFE', () => {
    for (const [id, hfe] of [['bc856b', 330], ['mmbt2907a', 150]] as Array<[string, number]>) {
      // Emitter 10 V; the base current flows out of the base through Rb to a 5 V source; the collector load goes to ground.
      const ib = id === 'bc856b' ? 5e-6 : 20e-6;
      const rb = 4.4 / ib;
      const rc = id === 'bc856b' ? 2200 : 1000;
      const s = op([dc('Ve', 1, 0, 10), dc('Vb', 5, 0, 5), res('Rb', 3, 5, rb), res('Rc', 2, 0, rc), ...inst(id, { B: 3, E: 1, C: 2 })]);
      const base = (s.v[3] - 5) / rb;
      within(s.v[2] / rc / base, hfe, hfe * 0.15, id);
    }
  });
});

describe('diodes follow their forward curves', () => {
  const forward = (id: string, r: number): { v: number; i: number } => {
    const s = op([dc('V', 1, 0, 5), res('R', 1, 2, r), ...inst(id, { A: 2, K: 0 })]);
    return { v: s.v[2], i: (5 - s.v[2]) / r };
  };
  it.each([
    ['1n5817', 0.34, 1.0, 4.66], ['1n5817', 0.55, 3.0, 1.48], ['1n5822', 0.35, 1.0, 4.65], ['1n5822', 0.46, 3.0, 1.51],
    ['1n4001', 0.88, 1.0, 4.12], ['1n4001', 1.05, 3.0, 1.32], ['1n4004', 0.88, 1.0, 4.12], ['1n5408', 0.85, 1.0, 4.15], ['1n5408', 1.0, 3.0, 1.33],
    ['ba159', 1.0, 1.0, 4.0], ['uf4007', 1.25, 1.0, 3.75], ['bas16', 0.9, 0.05, 82],
  ] as Array<[string, number, number, number]>)('%s: %s V at %s A', (id, vf, i, r) => {
    const m = forward(id, r);
    within(m.i, i, i * 0.1, 'current');
    within(m.v, vf, 0.04, id);
  });
  it('a 1N4001 breaks down in reverse near its rating', () => {
    const s = op([dc('V', 1, 0, 100), res('R', 1, 2, 10000), ...inst('1n4001', { A: 0, K: 2 })]);
    within(s.v[2], 55, 1, 'breakdown');
  });
  it('the dual SOT-23 diodes use their own legs', () => {
    // BAW56: common anode. K2 held high is reverse biased, so the current goes through D1 only.
    const s = op([dc('V', 1, 0, 5), res('R', 1, 2, 82), dc('Vk2', 3, 0, 5), ...inst('baw56', { K1: 0, K2: 3, A: 2 })]);
    within(s.v[2], 0.9, 0.06, 'baw56');
    const t = op([dc('V', 1, 0, 5), res('R', 1, 2, 82), ...inst('bav70', { A1: 2, A2: 0, K: 0 })]);
    within(t.v[2], 0.9, 0.06, 'bav70');
  });
});

describe('the 1N47xx zener series', () => {
  const series = [[4727, 3.0, 85, 10], [4730, 3.9, 64, 9], [4733, 5.1, 49, 7], [4735, 6.2, 41, 2], [4739, 9.1, 28, 5], [4742, 12, 21, 9], [4747, 20, 12.5, 22], [4752, 33, 7.5, 45], [4757, 51, 5, 95]] as Array<[number, number, number, number]>;
  const at = (id: string, vz: number, current: number): number => {
    const vs = vz + 10;
    return op([dc('V', 1, 0, vs), res('R', 1, 2, (vs - vz) / current), ...inst(id, { A: 0, K: 2 })]).v[2];
  };
  it.each(series)('1N%s: Vz at the test current, and the dynamic impedance', (num, vz, izt, zzt) => {
    const id = `1n${num}`;
    const i = izt * 1e-3;
    within(at(id, vz, i), vz, vz * 0.015, `${id} at Izt`);
    // The slope between half and one and a half times the test current is Zzt (within the logarithmic knee).
    const slope = (at(id, vz, 1.5 * i) - at(id, vz, 0.5 * i)) / i;
    within(slope, zzt, Math.max(zzt * 0.3, 1), `${id} impedance`);
  });
  it('conducts forwards like a diode', () => {
    const s = op([dc('V', 1, 0, 5), res('R', 1, 2, 100), ...inst('1n4733', { A: 2, K: 0 })]);
    expect(s.v[2]).toBeGreaterThan(0.55);
    expect(s.v[2]).toBeLessThan(1.15); // 0.75 V junction plus the 7 ohm impedance
  });
  it('the whole series exists: 1N4727 to 1N4757', () => {
    for (let n = 4727; n <= 4757; n++) expect(PART_DEFS[`x:1n${n}` as PartType], `1n${n}`).toBeDefined();
  });
});

describe('thyristors and triacs of the BT series', () => {
  const triacCircuit = (id: string, vsrc: number, gate: number, rl = 10) => op([dc('V', 1, 0, vsrc), res('RL', 1, 2, rl), dc('Vg', 3, 0, gate), ...inst(id, { MT1: 0, MT2: 2, G: 3 })]);
  it.each(['triac-bt137', 'triac-bt138', 'triac-bt139'])('%s blocks without a gate drive and conducts with it, on both polarities', (id) => {
    expect(triacCircuit(id, 12, 0).v[2]).toBeGreaterThan(11.9);
    const on = triacCircuit(id, 12, 3);
    expect(on.v[2]).toBeLessThan(1.3);
    expect(on.v[2]).toBeGreaterThan(0.5); // the 0.85 V knee is there
    const neg = triacCircuit(id, -12, 3);
    expect(neg.v[2]).toBeGreaterThan(-1.3);
    expect(neg.v[2]).toBeLessThan(-0.5);
  });
  it('the on-state voltage matches VT at IT: BT139 1.65 V at 20 A', () => {
    const s = op([dc('V', 1, 0, 12), res('RL', 1, 2, 0.5), dc('Vg', 3, 0, 3), ...inst('triac-bt139', { MT1: 0, MT2: 2, G: 3 })]);
    expect((12 - s.v[2]) / 0.5).toBeGreaterThan(18);
    within(s.v[2], 1.65, 0.1, 'VT');
  });
  it('the BT169 triggers from a 0.5 V gate; the BT152 carries 13 A', () => {
    const fire = (g: number) => op([dc('V', 1, 0, 12), res('RL', 1, 2, 100), dc('Vg', 3, 0, g), ...inst('scr-bt169', { K: 0, G: 3, A: 2 })]).v[2];
    expect(fire(0.3)).toBeGreaterThan(11.9);
    expect(fire(0.7)).toBeLessThan(1.5);
    const big = op([dc('V', 1, 0, 24), res('RL', 1, 2, 1.7), dc('Vg', 3, 0, 3), ...inst('scr-bt152', { K: 0, A: 2, G: 3 })]);
    within(big.v[2], 1.5, 0.3, 'bt152 on-state');
  });
});

describe('regulators', () => {
  const out = (id: string, vin: number, pins: Record<string, number>, load = 100): number => op([dc('Vin', 1, 0, vin), ...inst(id, pins), res('RL', pins.OUT, 0, load)]).v[pins.OUT];
  it('78xx and 78Mxx outputs', () => {
    for (const [id, v] of [['lm7806', 6], ['lm7808', 8], ['lm7818', 18], ['lm7824', 24], ['lm78m05', 5], ['lm78m12', 12], ['ka78t05', 5]] as Array<[string, number]>) {
      within(out(id, v + 4, { IN: 1, GND: 0, OUT: 2 }), v, 0.05, id);
    }
  });
  it('below the dropout voltage the output follows the input down', () => {
    expect(out('lm7806', 7, { IN: 1, GND: 0, OUT: 2 })).toBeLessThan(5.2);
  });
  it('AMS1117 fixed versions', () => {
    for (const [id, v] of [['ams1117-5v', 5], ['ams1117-2v5', 2.5], ['ams1117-1v8', 1.8], ['ams1117-1v2', 1.2]] as Array<[string, number]>) {
      within(out(id, v + 2, { GND: 0, OUT: 2, IN: 1 }), v, 0.05, id);
    }
  });
  it('they draw their quiescent current from the input', () => {
    const s = op([dc('Vin', 1, 0, 9), res('Rin', 1, 5, 1), ...inst('lm7806', { IN: 5, GND: 0, OUT: 2 })]);
    expect(9 - s.v[5]).toBeGreaterThan(0.002); // a few mA through the 1 ohm resistor with no load at all
  });
  it('LM337 sets Vout = -1.25 V (1 + R2 / R1)', () => {
    const els = [dc('Vin', 1, 0, -12), ...inst('lm337', { ADJ: 3, IN: 1, OUT: 2 }), res('R1', 2, 3, 240), res('R2', 3, 0, 720), res('RL', 2, 0, 100)];
    within(op(els).v[2], -5, 0.1, 'lm337');
  });
});

describe('operational amplifiers', () => {
  const follower = (id: string, pins: Record<string, number>, vin: number, supply: number): number =>
    op([dc('Vp', 1, 0, supply), dc('Vn', 2, 0, -supply), dc('Vin', 3, 0, vin), ...inst(id, { ...pins, 'V+': 1, 'V-': 2, 'IN+': 3, 'IN-': 4, OUT: 4 })]).v[4];
  it('CA3140, CA3130 and LM833 follow the input and clip at their output swing', () => {
    within(follower('ca3140', {}, 2, 15), 2, 0.01, 'ca3140 linear');
    within(follower('ca3140', {}, 14.5, 15), 13, 0.15, 'ca3140 high');
    within(follower('ca3140', {}, -14.9, 15), -14.4, 0.15, 'ca3140 low');
    within(follower('ca3130', {}, 14.9, 15), 13.3, 0.15, 'ca3130 high');
    within(follower('lm833', { OUT1: 4, 'IN1-': 4, 'IN1+': 3 }, 2, 15), 2, 0.01, 'lm833');
  });
  it('the dual op-amps work: CA3240 and LM258', () => {
    const els = [dc('Vp', 1, 0, 12), dc('Vin', 3, 0, 2), ...inst('ca3240', { OUT1: 4, 'IN1-': 4, 'IN1+': 3, 'V-': 0, 'V+': 1, OUT2: 5, 'IN2-': 5, 'IN2+': 3 })];
    within(op(els).v[4], 2, 0.01, 'ca3240');
    const els2 = [dc('Vp', 1, 0, 5), dc('Vin', 3, 0, 1.5), ...inst('lm258', { OUT1: 4, 'IN1-': 4, 'IN1+': 3, GND: 0, VCC: 1 })];
    within(op(els2).v[4], 1.5, 0.01, 'lm258');
  });
  it('AD620 gain is 1 + 49.4 k / Rg and the output is referenced to REF', () => {
    const run = (rg: number | null, vd: number, ref: number, common = 0) => {
      const els = [dc('Vp', 1, 0, 5), dc('Vn', 2, 0, -5), dc('Vpin', 3, 0, common + vd / 2), dc('Vnin', 4, 0, common - vd / 2), dc('Vref', 7, 0, ref), ...inst('ad620', { RG1: 5, RG2: 6, 'IN+': 3, 'IN-': 4, 'V+': 1, 'V-': 2, REF: 7, OUT: 8 })];
      if (rg !== null) els.push(res('Rg', 5, 6, rg));
      els.push(res('RL', 8, 0, 10000));
      return op(els).v[8];
    };
    within(run(499, 0.01, 0), 1.0, 0.012, 'G = 100');
    within(run(49400, 0.1, 0), 0.2, 0.004, 'G = 2');
    within(run(null, 0.5, 0), 0.5, 0.01, 'G = 1');
    within(run(499, 0.01, 1), 2.0, 0.02, 'with REF');
    within(run(499, 0, 0, 1.5), 0, 0.02, 'common mode rejected');
  });
});

describe('comparators have open-collector outputs', () => {
  const lm393 = (inMinus: number, inPlus: number): number => op([dc('Vcc', 1, 0, 5), dc('Vm', 2, 0, inMinus), dc('Vpl', 3, 0, inPlus), res('Rp', 1, 4, 10000), ...inst('lm393', { VCC: 1, GND: 0, 'IN1-': 2, 'IN1+': 3, OUT1: 4 })]).v[4];
  it('the output is pulled low while IN- is above IN+, and released otherwise', () => {
    expect(lm393(2, 1)).toBeLessThan(0.05);
    within(lm393(1, 2), 5, 0.01, 'released');
  });
  it('all four channels of the LM339 work', () => {
    const els = [dc('Vcc', 1, 0, 5), dc('Vlo', 2, 0, 1), dc('Vhi', 3, 0, 3)];
    const pins: Record<string, number> = { VCC: 1, GND: 0 };
    [1, 2, 3, 4].forEach((k) => {
      // The even channels have IN- above IN+ (output low), the odd ones the other way round (released).
      pins[`${k}IN-`] = k % 2 === 0 ? 3 : 2;
      pins[`${k}IN+`] = k % 2 === 0 ? 2 : 3;
      pins[`${k}OUT`] = 10 + k;
      els.push(res(`Rp${k}`, 1, 10 + k, 10000));
    });
    const s = op([...els, ...inst('lm339', pins)]);
    expect(s.v[11]).toBeGreaterThan(4.9);
    expect(s.v[12]).toBeLessThan(0.05);
    expect(s.v[13]).toBeGreaterThan(4.9);
    expect(s.v[14]).toBeLessThan(0.05);
  });
  it('LM311: strobe to ground switches the output off', () => {
    const run = (strobe: number | null) => {
      const els = [dc('Vcc', 1, 0, 5), dc('Vm', 2, 0, 2), dc('Vpl', 3, 0, 1), res('Rp', 1, 4, 10000), ...inst('lm311', { 'V+': 1, 'V-': 0, GND: 0, 'IN-': 2, 'IN+': 3, OUT: 4, STROBE: 5 })];
      if (strobe !== null) els.push(dc('Vs', 5, 0, strobe));
      return op(els).v[4];
    };
    expect(run(null)).toBeLessThan(0.05);
    within(run(0), 5, 0.01, 'strobed');
  });
});

describe('CMOS gates and timers', () => {
  const gate = (id: string, a: number, b: number, vdd = 5): number => op([dc('Vdd', 1, 0, vdd), dc('Va', 2, 0, a ? vdd : 0), dc('Vb', 3, 0, b ? vdd : 0), ...inst(id, { VDD: 1, VSS: 0, A: 2, B: 3, J: 4 })]).v[4];
  it.each([
    ['cd4001', [1, 0, 0, 0]], ['cd4011', [1, 1, 1, 0]], ['cd4071', [0, 1, 1, 1]], ['cd4081', [0, 0, 0, 1]], ['cd4070', [0, 1, 1, 0]],
  ] as Array<[string, number[]]>)('%s truth table at 5 V and 12 V', (id, table) => {
    [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([a, b], k) => {
      for (const vdd of [5, 12]) {
        const v = gate(id, a, b, vdd);
        if (table[k]) expect(v, `${id} ${a}${b} at ${vdd} V`).toBeGreaterThan(vdd - 0.1);
        else expect(v, `${id} ${a}${b} at ${vdd} V`).toBeLessThan(0.1);
      }
    });
  });
  it('the last gate (G, H -> M) is wired, too', () => {
    const v = op([dc('Vdd', 1, 0, 5), dc('Vg', 2, 0, 0), dc('Vh', 3, 0, 5), ...inst('cd4011', { VDD: 1, VSS: 0, G: 2, H: 3, M: 4 })]).v[4];
    expect(v).toBeGreaterThan(4.9);
  });
  const astable = (id: string, pins: Record<string, number>, outNode: number, vcc: number): number => {
    const els: Element[] = [dc('Vcc', 1, 0, vcc), res('R1', 1, 4, 1000), res('R2', 4, 2, 10000), { type: 'C', id: 'C1', a: 2, b: 0, c: 100e-9 }, ...inst(id, pins), res('RL', outNode, 0, 10000)];
    const sim = new Simulator({ nodeCount: nodeCountOf(els), elements: els });
    sim.beginTransient(5e-6, true);
    const rises: number[] = [];
    let prev = 0;
    for (let k = 0; k < 3000; k++) {
      const s = sim.step();
      expect(s.converged, `step ${k}`).toBe(true);
      if (prev < vcc / 2 && s.v[outNode] >= vcc / 2) rises.push(s.time);
      prev = s.v[outNode];
    }
    expect(rises.length).toBeGreaterThanOrEqual(6);
    const gaps = rises.slice(1).map((t, i) => t - rises[i]).slice(1);
    return gaps.reduce((a, b) => a + b, 0) / gaps.length;
  };
  const period = 0.693 * (1000 + 2 * 10000) * 100e-9;
  it('LM555 oscillates at 0.693 (R1 + 2 R2) C', () => {
    within(astable('lm555', { GND: 0, TRIG: 2, OUT: 3, RESET: 1, CTRL: 5, THR: 2, DISCH: 4, VCC: 1 }, 3, 5), period, period * 0.07, 'lm555');
  });
  it('both halves of the LM556 oscillate', () => {
    within(astable('lm556', { GND: 0, TRIG1: 2, OUT1: 3, RESET1: 1, CTRL1: 5, THR1: 2, DISCH1: 4, VCC: 1 }, 3, 5), period, period * 0.07, 'timer 1');
    within(astable('lm556', { GND: 0, TRIG2: 2, OUT2: 3, RESET2: 1, CTRL2: 5, THR2: 2, DISCH2: 4, VCC: 1 }, 3, 5), period, period * 0.07, 'timer 2');
  });
});

describe('optocouplers', () => {
  /** The LED is fed from 5 V through a resistor for the given current; the collector load goes to 10 V. */
  const ledCurrent = (id: string, ma: number, params: Record<string, number> = {}) => {
    const r = (5 - 1.2) / (ma * 1e-3);
    const s = op([dc('V5', 1, 0, 5), res('Rl', 1, 2, r), dc('V10', 3, 0, 10), res('Rc', 3, 4, 1000), ...inst(id, { A: 2, K: 0, C: 4, E: 0 }, params)]);
    return (10 - s.v[4]) / 1000;
  };
  it('4N25, 4N35 and EL817: collector current = CTR x LED current', () => {
    within(ledCurrent('4n25', 10), 0.005, 0.0006, '4n25');
    within(ledCurrent('4n35', 5), 0.005, 0.0006, '4n35');
    within(ledCurrent('el817', 2.5), 0.0025, 0.0004, 'el817');
    within(ledCurrent('el817', 2.5, { ctr: 2 }), 0.005, 0.0006, 'el817 ctr 2');
  });
  it('PC814 works with either input polarity', () => {
    const run = (vin: number) => {
      const s = op([dc('Vin', 1, 0, vin), res('Rl', 1, 2, 380), dc('V10', 3, 0, 10), res('Rc', 3, 4, 1000), ...inst('pc814', { A: 2, K: 0, C: 4, E: 0 })]);
      return (10 - s.v[4]) / 1000;
    };
    expect(run(5)).toBeGreaterThan(0.007);
    expect(run(-5)).toBeGreaterThan(0.007);
  });
  it('MOC302x fire an AC load above their trigger current only', () => {
    const run = (id: string, ma: number) => {
      const r = (5 - 1.2) / (ma * 1e-3);
      return op([dc('V5', 1, 0, 5), res('Rl', 1, 2, r), dc('Vac', 3, 0, 12), res('Rload', 3, 4, 100), ...inst(id, { A: 2, K: 0, T2: 4, T1: 0 })]).v[4];
    };
    expect(run('moc3023', 3)).toBeGreaterThan(11.9);
    expect(run('moc3023', 8)).toBeLessThan(5);
    expect(run('moc3010', 10)).toBeGreaterThan(11.9);
    expect(run('moc3010', 20)).toBeLessThan(5);
    expect(run('moc3020', 20)).toBeGreaterThan(11.9);
    expect(run('moc3020', 40)).toBeLessThan(5);
  });
  it('6N137 pulls its output low while the LED is on, unless VE is low', () => {
    const run = (ma: number, ve: number | null) => {
      const els = [dc('V5', 1, 0, 5), res('Rl', 1, 2, ma > 0 ? (5 - 1.2) / (ma * 1e-3) : 1e9), res('Rp', 1, 4, 330), ...inst('6n137', { A: 2, K: 0, VCC: 1, GND: 0, VO: 4, VE: 5 })];
      if (ve !== null) els.push(dc('Ve', 5, 0, ve));
      return op(els).v[4];
    };
    expect(run(10, null)).toBeLessThan(0.7);
    within(run(0, null), 5, 0.05, 'led off');
    within(run(10, 0), 5, 0.05, 've low');
  });
  it('TLP250 / TLP251 drive their output to VCC or GND with the LED current', () => {
    for (const id of ['tlp250', 'tlp251']) {
      const run = (ma: number) => {
        const r = ma > 0 ? (5 - 1.2) / (ma * 1e-3) : 1e9;
        return op([dc('V5', 1, 0, 5), res('Rl', 1, 2, r), dc('Vcc', 3, 0, 15), res('Rload', 4, 0, 1000), ...inst(id, { A: 2, K: 0, VCC: 3, GND: 0, VO1: 4, VO2: 4 })]).v[4];
      };
      expect(run(10), id).toBeGreaterThan(14.5);
      expect(run(0), id).toBeLessThan(0.1);
    }
  });
});

describe('sensor modules', () => {
  it('ACS712 outputs Vcc / 2 + sensitivity x current, in both directions', () => {
    for (const [id, sens] of [['acs712-5a', 0.185], ['acs712-20a', 0.1], ['acs712-30a', 0.066]] as Array<[string, number]>) {
      const read = (i: number, vcc = 5): number => op([dc('Vcc', 1, 0, vcc), amps('I', 0, 2, i), ...inst(id, { VCC: 1, GND: 0, OUT: 3, 'IP+': 2, 'IP-': 0 })]).v[3];
      within(read(0), 2.5, 0.005, `${id} zero`);
      within(read(3), 2.5 + 3 * sens, 0.02, `${id} +3 A`);
      within(read(-3), 2.5 - 3 * sens, 0.02, `${id} -3 A`);
      within(read(0, 3.3), 1.65, 0.005, `${id} ratiometric`);
    }
  });
  it('MQ modules: AO follows the level, DO trips at the trimmer threshold, the heater draws 150 mA', () => {
    const read = (level: number, thr = 0.5) => {
      const s = op([dc('Vcc', 1, 0, 5), res('Rs', 1, 2, 1), ...inst('mq135-module', { VCC: 2, GND: 0, AO: 3, DO: 4 }, { level, thr })]);
      return { ao: s.v[3], dout: s.v[4], vcc: s.v[2] };
    };
    within(read(0.5).ao, 2.5, 0.1, 'level 0.5');
    expect(read(0.7).dout).toBeGreaterThan(4);
    expect(read(0.2).dout).toBeLessThan(0.5);
    expect(read(0.5).vcc, 'heater load').toBeLessThan(4.9);
    expect(read(0.5).vcc).toBeGreaterThan(4.7);
    for (const id of ['mq3-module', 'mq4-module', 'mq5-module', 'mq7-module', 'mq9-module']) expect(PART_DEFS[`x:${id}` as PartType], id).toBeDefined();
  });
  it('E18-D80NK pulls its output low when an object is detected', () => {
    const read = (detected: boolean) => op([dc('Vcc', 1, 0, 5), res('Rp', 1, 2, 10000), ...inst('e18-d80nk', { VCC: 1, GND: 0, OUT: 2 }, { detected })]).v[2];
    expect(read(true)).toBeLessThan(0.05);
    within(read(false), 5, 0.01, 'idle');
  });
});

describe('passives', () => {
  it('a crystal resonates in series at its marked frequency', () => {
    for (const mhz of [4, 8, 12, 16, 20]) {
      const els = inst(`xtal-${mhz}mhz`, { 1: 1, 2: 2 });
      const l = els.find((e) => e.type === 'L') as Extract<Element, { type: 'L' }>;
      const c = els.filter((e) => e.type === 'C').map((e) => (e as Extract<Element, { type: 'C' }>).c).sort((a, b) => a - b)[0];
      within(1 / (2 * Math.PI * Math.sqrt(l.l * c)), mhz * 1e6, mhz * 1e6 * 0.001, `${mhz} MHz`);
    }
  });
  it('a crystal blocks DC', () => {
    within(op([dc('V', 1, 0, 5), res('R', 1, 2, 1000), ...inst('xtal-16mhz', { 1: 2, 2: 0 })]).v[2], 5, 0.01, 'dc');
  });
  it('the SIL resistor network joins the common pin to each pin through r', () => {
    const s = op([dc('V', 1, 0, 5), ...inst('rnet-sil-9', { COM: 1, R3: 2 }, { r: 10000 }), res('Rl', 2, 0, 10000)]);
    within(s.v[2], 2.5, 0.01, 'divider');
  });
  it('the DIP switch closes pin k to pin 2n + 1 - k', () => {
    const run = (on: boolean) => op([dc('V', 1, 0, 5), ...inst('dip-switch-4', { 2: 1, 7: 2 }, { s2: on }), res('Rl', 2, 0, 1000)]).v[2];
    within(run(true), 5, 0.01, 'closed');
    expect(run(false)).toBeLessThan(0.01);
  });
  it('the tantalum capacitor has + and - pins', () => {
    expect(PART_DEFS['x:cap-tantalum' as PartType].pinNames).toEqual(['+', '-']);
  });
});

describe('Tunik headers', () => {
  it('2 to 12 poles at 2.5, 2.54 and 3.96 mm, the first pad square', () => {
    for (const [tag, pitch] of [['250', 2.5], ['254', 2.54], ['396', 3.96]] as Array<[string, number]>) {
      for (let n = 2; n <= 12; n++) {
        const type = `x:tunik-${tag}-${n}` as PartType;
        expect(PART_DEFS[type], type).toBeDefined();
        const def = footprintById(defaultFootprint({ type })!)!;
        expect(def.pads.length, type).toBe(n);
        within(def.pads[1].x - def.pads[0].x, pitch, 1e-6, type);
        expect(def.pads[0].shape).toBe('rect');
      }
    }
  });
});

describe('new packages', () => {
  it('TO-18, TO-39, SOT-23 and TO-247 have their pads where the KiCad library has them', () => {
    expect(footprintById('TO18')!.pads.map((p) => [p.x, p.y])).toEqual([[-1.27, 0], [0, 1.27], [1.27, 0]]);
    expect(footprintById('TO39')!.pads.map((p) => [p.x, p.y])).toEqual([[-2.54, 0], [0, 2.54], [2.54, 0]]);
    expect(footprintById('SOT23')!.pads.map((p) => [p.x, p.y])).toEqual([[-0.9375, -0.95], [-0.9375, 0.95], [0.9375, 0]]);
    expect(footprintById('TO247')!.pads.map((p) => p.x)).toEqual([-5.45, 0, 5.45]);
  });
});
