import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { extractNetlist } from '../src/editor/netlist';
import { McuRig } from '../src/sim/rig';

// Some examples use parts of the shipped library (the relay module of the serial-control example).
beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** Builds an example the way the app does and returns helpers to run it. */
function setup(id: string) {
  const ex = EXAMPLES.find((e) => e.id === id)!;
  const doc = ex.build();
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const sim = new Simulator(x.netlist!);
  const rig = new McuRig(doc, x, x.netlist!);
  const first = sim.beginTransient(ex.dt, true);
  rig.prime(first);
  let last: Solution = first;
  return {
    doc,
    x,
    rig,
    sim,
    get last() {
      return last;
    },
    /** Advances to simulated time t (seconds), calling `each` after every step. */
    runTo(t: number, each: (s: Solution) => void = () => {}) {
      while (last.time < t - ex.dt / 2) {
        last = rig.step(sim, ex.dt);
        expect(last.converged).toBe(true);
        each(last);
      }
    },
    led: doc.parts.find((p) => p.type === 'LED')!.id,
    node: (partType: string, pin: number) => x.nodeOfPin.get(`${doc.parts.find((p) => p.type === partType)!.id}:${pin}`)!,
  };
}

describe('Arduino + circuit co-simulation', () => {
  it('lights the LED for half a second, then switches it off (Blink)', () => {
    const t = setup('ino-blink');
    t.runTo(0.25);
    // 5 V through 25 ohm pin + 330 ohm + LED drop of about 1.9 V.
    expect(t.last.i[t.led]).toBeGreaterThan(7e-3);
    expect(t.last.i[t.led]).toBeLessThan(10e-3);
    t.runTo(0.75);
    expect(Math.abs(t.last.i[t.led])).toBeLessThan(1e-6);
    t.runTo(1.25);
    expect(t.last.i[t.led]).toBeGreaterThan(7e-3);
  });

  it('loads the pin: the output voltage sags under the LED current', () => {
    const t = setup('ino-blink');
    t.runTo(0.25);
    const d13 = t.x.mcuPins.find((m) => m.pin === 'D13')!;
    const node = t.sim.netlist.elements.find((e) => e.id === d13.elementId)!.a;
    const v = t.last.v[node];
    expect(v).toBeLessThan(5);
    expect(v).toBeGreaterThan(4.5); // 25 ohm * ~9 mA = 0.2 V
  });

  it('reads the button through the pull-up and lights the LED while it is pressed', () => {
    const t = setup('ino-button');
    const sw = t.sim.netlist.elements.find((e) => e.type === 'SW')!;
    t.runTo(0.05);
    expect(Math.abs(t.last.i[t.led])).toBeLessThan(1e-6); // open: D2 pulled high, LED off
    if (sw.type === 'SW') sw.closed = true;
    t.runTo(0.1);
    expect(t.last.i[t.led]).toBeGreaterThan(7e-3); // closed: D2 pulled low, LED on
    if (sw.type === 'SW') sw.closed = false;
    t.runTo(0.15);
    expect(Math.abs(t.last.i[t.led])).toBeLessThan(1e-6);
  });

  it('digitises the divider on A0 and prints it', () => {
    const t = setup('ino-analog');
    t.runTo(0.6);
    const reading = Number(/A0 = (\d+)/.exec(t.rig.serial)![1]);
    expect(reading).toBeGreaterThan(505);
    expect(reading).toBeLessThan(518); // 2.5 V of 5 V -> ~511
  });

  it('prints the greeting and a counter over Serial', () => {
    const t = setup('ino-serial');
    t.runTo(1.3);
    expect(t.rig.serial.startsWith('Hello from ISL PCB!')).toBe(true);
    expect(t.rig.serial).toContain('count = 1');
  });

  it('runs the same sketches on the Mega: blink, button and analog read', () => {
    const blink = setup('mega-blink');
    blink.runTo(0.25);
    expect(blink.last.i[blink.led]).toBeGreaterThan(7e-3);
    blink.runTo(0.75);
    expect(Math.abs(blink.last.i[blink.led])).toBeLessThan(1e-6);

    const button = setup('mega-button');
    const sw = button.sim.netlist.elements.find((e) => e.type === 'SW')!;
    button.runTo(0.05);
    expect(Math.abs(button.last.i[button.led])).toBeLessThan(1e-6);
    if (sw.type === 'SW') sw.closed = true;
    button.runTo(0.1);
    expect(button.last.i[button.led]).toBeGreaterThan(7e-3);

    const analog = setup('mega-analog');
    analog.runTo(0.6);
    const reading = Number(/A0 = (\d+)/.exec(analog.rig.serial)![1]);
    expect(reading).toBeGreaterThan(505);
    expect(reading).toBeLessThan(518);
  });

  it('runs on the Raspberry Pi Pico: blink, button, analog read and PWM', () => {
    const blink = setup('pico-blink');
    blink.runTo(0.3);
    // 3.3 V through 50 ohm + 330 ohm + a ~1.9 V LED.
    expect(blink.last.i[blink.led]).toBeGreaterThan(2.5e-3);
    expect(blink.last.i[blink.led]).toBeLessThan(5e-3);
    blink.runTo(0.8);
    expect(Math.abs(blink.last.i[blink.led])).toBeLessThan(1e-6);

    const button = setup('pico-button');
    const sw = button.sim.netlist.elements.find((e) => e.type === 'SW')!;
    button.runTo(0.15);
    expect(Math.abs(button.last.i[button.led])).toBeLessThan(1e-6);
    if (sw.type === 'SW') sw.closed = true;
    button.runTo(0.25);
    expect(button.last.i[button.led]).toBeGreaterThan(2.5e-3);

    const analog = setup('pico-analog');
    analog.runTo(1);
    const reading = Number(/A0 = (\d+)/.exec(analog.rig.serial)![1]);
    expect(reading).toBeGreaterThan(505); // 1.65 V of 3.3 V, 10-bit
    expect(reading).toBeLessThan(518);

    const fade = setup('pico-fade');
    const means: number[] = [];
    let acc = 0;
    let n = 0;
    fade.runTo(2.4, (s) => {
      acc += s.i[fade.led];
      if (++n === 6000) {
        means.push(acc / n);
        acc = 0;
        n = 0;
      }
    });
    expect(Math.max(...means)).toBeGreaterThan(2 * Math.min(...means) + 1e-4); // brightness changes over time
  });

  it('runs PIC programs in circuit: blink, button, ADC to PWM and serial text', () => {
    for (const id of ['pic877-blink', 'pic628-blink', 'pic84-blink']) {
      const t = setup(id);
      const seen: number[] = [];
      t.runTo(0.05);
      for (let k = 0; k < 14; k++) {
        t.runTo(0.05 + (k + 1) * 0.1);
        seen.push(t.last.i[t.led]);
      }
      // 5 V through 40 ohm + 330 ohm + a ~1.9 V LED.
      expect(seen.filter((i) => i > 6e-3 && i < 10e-3).length, id).toBeGreaterThan(3);
      expect(seen.filter((i) => Math.abs(i) < 1e-6).length, id).toBeGreaterThan(3);
    }

    const button = setup('pic877-button');
    const sw = button.sim.netlist.elements.find((e) => e.type === 'SW')!;
    button.runTo(0.05);
    expect(Math.abs(button.last.i[button.led])).toBeLessThan(1e-6);
    if (sw.type === 'SW') sw.closed = true;
    button.runTo(0.1);
    expect(button.last.i[button.led]).toBeGreaterThan(6e-3);

    const adc = setup('pic877-adc');
    adc.runTo(0.1);
    let sum = 0;
    let n = 0;
    adc.runTo(0.2, (s) => {
      sum += s.i[adc.led];
      n++;
    });
    // About half duty from 2.5 V on AN0: the mean LED current is roughly half the on-current.
    expect(sum / n).toBeGreaterThan(2e-3);
    expect(sum / n).toBeLessThan(6e-3);

    const serial = setup('pic877-serial');
    serial.runTo(1.2);
    expect(serial.rig.serial.startsWith('HELLO FROM PIC 0')).toBe(true);
    expect(serial.rig.serial).toContain('HELLO FROM PIC 1');
  });

  it('keeps every example solvable with no firmware at all', () => {
    for (const ex of EXAMPLES.filter((e) => /^(ino|mega|pico|pic)/.test(e.id))) {
      const doc = ex.build();
      for (const p of doc.parts) if (p.type === 'ARDUINO_UNO' || p.type === 'ARDUINO_MEGA' || p.type === 'PICO' || p.type.startsWith('PIC')) p.params.hex = '';
      const x = extractNetlist(doc);
      const s = new Simulator(x.netlist!).operatingPoint();
      expect(s.converged, ex.id).toBe(true);
    }
  });
});
