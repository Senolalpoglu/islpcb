import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Element } from '../core/sim/solver';
import { loadBuiltinLibrary } from '../src/editor/library';
import { addPart, addWire, emptyDoc, pinPositions, type Doc } from '../src/editor/model';
import { motionOf } from '../src/editor/motion';
import { extractNetlist } from '../src/editor/netlist';
import { customSpec, customType, expandModel } from '../src/editor/customParts';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** A DC source across one part (two pins), ground on the minus side. `pins` are the part's pin indexes for + and -. */
function across(id: string, volts: number, params: Record<string, number | boolean> = {}, pins: [number, number] = [0, 1]): { doc: Doc; part: Doc['parts'][number] } {
  let d = addPart(emptyDoc(), 'VDC', 4, 10);
  d = { ...d, parts: d.parts.map((p) => ({ ...p, params: { ...p.params, v: volts } })) };
  d = addPart(d, customType(id), 16, 10);
  d = addPart(d, 'GND', 4, 20);
  d = { ...d, parts: d.parts.map((p) => (p.type === customType(id) ? { ...p, params: { ...p.params, ...params } } : p)) };
  const [vp, vm] = pinPositions(d.parts[0]);
  const pp = pinPositions(d.parts[1]);
  const g = pinPositions(d.parts[2])[0];
  const w = (a: { x: number; y: number }, b: { x: number; y: number }) => (d = addWire(d, a, b));
  w(vp, { x: vp.x, y: pp[pins[0]].y });
  w({ x: vp.x, y: pp[pins[0]].y }, pp[pins[0]]);
  w(vm, { x: vm.x, y: g.y });
  w({ x: vm.x, y: g.y }, g);
  w(pp[pins[1]], { x: pp[pins[1]].x, y: g.y });
  w({ x: pp[pins[1]].x, y: g.y }, g);
  return { doc: d, part: d.parts[1] };
}

const motion = (id: string, volts: number, params: Record<string, number | boolean> = {}) => {
  const { doc, part } = across(id, volts, params);
  const x = extractNetlist(doc);
  const s = new Simulator(x.netlist!).operatingPoint();
  return { m: motionOf(doc.parts[1], s, x)!, s, x, part };
};

describe('what moves while the circuit runs', () => {
  it('a 12 V fan stands still without power, turns faster as the voltage rises and its current follows', () => {
    expect(motion('fan-12v-80mm', 0).m.spin).toBe(0);
    expect(motion('fan-12v-80mm', 1.5).m.spin).toBe(0); // below a fifth of the rating
    const half = motion('fan-12v-80mm', 6).m.spin;
    const full = motion('fan-12v-80mm', 12).m.spin;
    expect(half).toBeGreaterThan(0);
    expect(full).toBeGreaterThan(half);
    const run = motion('fan-12v-80mm', 12);
    expect(run.s.i[run.x.primary.get(run.part.id) ?? run.part.id]).toBeCloseTo(0.15, 3); // rated current
  });

  it('the rated voltage is a parameter: a 24 V fan on 12 V turns at half speed', () => {
    const slow = motion('fan-24v-80mm', 12).m.spin;
    const fast = motion('fan-24v-80mm', 24).m.spin;
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow * 1.5);
  });

  it('a relay pulls in at its pull-in voltage, not before', () => {
    expect(motion('relay-srd-12v-c', 5).m.pulled).toBe(false);
    expect(motion('relay-srd-12v-c', 8).m.pulled).toBe(false); // pull-in is 75 % of 12 V = 9 V
    expect(motion('relay-srd-12v-c', 12).m.pulled).toBe(true);
    expect(motion('relay-srd-24v-a', 12).m.pulled).toBe(false);
    expect(motion('relay-srd-24v-a', 24).m.pulled).toBe(true);
  });

  it('the picture agrees with the contacts: the relay closes COM-NO at the voltage where it is drawn pulled in', () => {
    const contact = (coil: number): number => {
      const spec = customSpec(customType('relay-srd-12v-c'))!;
      let next = 100;
      const pins = new Map([['COIL+', 1], ['COIL-', 0], ['COM', 2], ['NO', 3], ['NC', 4]]);
      const els: Element[] = [
        { type: 'V', id: 'Vc', a: 1, b: 0, wave: { kind: 'dc', value: coil } },
        { type: 'V', id: 'Vx', a: 5, b: 0, wave: { kind: 'dc', value: 12 } },
        { type: 'R', id: 'R1', a: 5, b: 2, r: 100 },
        { type: 'R', id: 'R2', a: 3, b: 0, r: 100 },
        { type: 'R', id: 'R3', a: 4, b: 0, r: 100 },
        ...expandModel(spec, 'K', {}, pins, () => next++),
      ];
      return new Simulator({ nodeCount: 101, elements: els }).operatingPoint().v[3];
    };
    expect(contact(8)).toBeLessThan(0.5); // open at 8 V ...
    expect(motion('relay-srd-12v-c', 8).m.pulled).toBe(false); // ... and drawn released
    expect(contact(10)).toBeGreaterThan(5); // closed at 10 V ...
    expect(motion('relay-srd-12v-c', 10).m.pulled).toBe(true); // ... and drawn pulled in
  });

  it('a flow sensor turns only when powered and spins faster with more flow', () => {
    // VCC is pin 0 and GND pin 1: the sensor is powered from the source.
    expect(motion('flow-yfs201', 0).m.spin).toBe(0);
    const some = motion('flow-yfs201', 5, { flow: 4 }).m.spin;
    const more = motion('flow-yfs201', 5, { flow: 8 }).m.spin;
    expect(some).toBeGreaterThan(0);
    expect(more).toBeGreaterThan(some);
    expect(motion('flow-yfs201', 5, { flow: 0 }).m.spin).toBe(0);
  });

  it('a solenoid valve opens at its opening voltage', () => {
    expect(motion('valve-12v', 5).m.pulled).toBe(false);
    expect(motion('valve-12v', 12).m.pulled).toBe(true);
  });

  it('a part without a "visual" has no motion', () => {
    const { doc } = across('lm35', 5, {}, [0, 2]);
    const x = extractNetlist(doc);
    const s = new Simulator(x.netlist!).operatingPoint();
    expect(motionOf(doc.parts[1], s, x)).toBeNull();
  });
});

