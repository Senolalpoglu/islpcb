import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { carExample, carPairExample, clockExample, esp01Example, nrf24Example, remoteExample } from '../src/editor/commExamples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, type Doc } from '../src/editor/model';
import { extractNetlist, type Extracted } from '../src/editor/netlist';
import { McuRig } from '../src/sim/rig';
import { SegmentMeter } from '../src/sim/segments';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** The solver node of "REF:PIN" (a pin of the part with that reference). */
function nodeOf(doc: Doc, x: Extracted, at: string): number {
  const [ref, pin] = at.split(':');
  const part = doc.parts.find((q) => q.ref === ref);
  if (!part) throw new Error(`no part ${ref}`);
  const i = PART_DEFS[part.type].pinNames.indexOf(pin);
  if (i < 0) throw new Error(`${ref} has no pin ${pin}`);
  return x.nodeOfPin.get(`${part.id}:${i}`)!;
}

/** Every group is one net, and no two groups share a net. */
function expectNets(doc: Doc, x: Extracted, groups: string[][]): void {
  const seen = new Map<number, string>();
  for (const g of groups) {
    const nodes = g.map((at) => nodeOf(doc, x, at));
    for (const n of nodes) expect(n, `${g.join(' = ')} must be one net`).toBe(nodes[0]);
    expect(seen.get(nodes[0]), `${g[0]} is on the same net as ${seen.get(nodes[0])}`).toBeUndefined();
    seen.set(nodes[0], g[0]);
  }
}

const build = (doc: Doc) => {
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  return x;
};

/** The solver element a part's current is read from. */
const primaryOf = (doc: Doc, x: Extracted, ref: string): string => x.primary.get(doc.parts.find((q) => q.ref === ref)!.id)!;

describe('the clock circuit', () => {
  let doc: Doc;
  let x: Extracted;
  beforeAll(() => {
    doc = clockExample();
    x = build(doc);
  });

  it('wires every segment, digit and ground line to its own net', () => {
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups: string[][] = segs.map((_, k) => [`A1:D${2 + k}`, `R${k + 1}:1`]);
    segs.forEach((s, k) => groups.push([`R${k + 1}:2`, `DS1:${s}`]));
    groups.push(['A1:A1', 'R8:1'], ['R8:2', 'DS1:dp']);
    ['D9', 'D10', 'D11', 'D12', 'D13', 'A0'].forEach((d, k) => groups.push([`A1:${d}`, `U1:${k + 1}B`]));
    for (let k = 1; k <= 6; k++) groups.push([`U1:${k}C`, `DS1:D${k}`]);
    expectNets(doc, x, groups);
    expect(nodeOf(doc, x, 'U1:GND')).toBe(0);
  });

  it('shows 12:34:5x on the six digits while it runs', () => {
    const sim = new Simulator(x.netlist!);
    const rig = new McuRig(doc, x, x.netlist!);
    const meter = new SegmentMeter(doc);
    const dt = 100e-6;
    let last: Solution = sim.beginTransient(dt, true);
    rig.prime(last);
    const disp = doc.parts.find((q) => q.ref === 'DS1')!;
    // 1.25 s of simulated time: the clock started at 12:34:50, so the seconds show 1.
    while (last.time < 1.25) {
      last = rig.step(sim, dt);
      if (last.time > 1.1) meter.add(last);
    }
    const levels = meter.take().get(disp.id)!;
    // Segments a..g of each digit, and the font of the sketch for 0..9.
    const FONT = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
    const shown = Array.from({ length: 6 }, (_, d) => {
      let bits = 0;
      for (let k = 0; k < 7; k++) if (levels[d * 8 + k] > 0.3) bits |= 1 << k;
      return FONT.indexOf(bits);
    });
    expect(shown.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(shown[5]).toBe(1);
    expect(rig.serial).toContain('12:34:51');
  }, 180_000);
});

describe('the Bluetooth car', () => {
  let doc: Doc;
  let x: Extracted;
  beforeAll(() => {
    doc = carExample();
    x = build(doc);
  });

  it('wires the controls to both L298N modules, the motors to their outputs and the supply to every 12 V pin', () => {
    expectNets(doc, x, [
      ['A1:D5', 'U11:ENA', 'U12:ENA'],
      ['A1:D6', 'U11:ENB', 'U12:ENB'],
      ['A1:D2', 'U11:IN1', 'U12:IN1'],
      ['A1:D4', 'U11:IN2', 'U12:IN2'],
      ['A1:D7', 'U11:IN3', 'U12:IN3'],
      ['A1:D8', 'U11:IN4', 'U12:IN4'],
      ['M11:A', 'U11:OUT1'],
      ['M11:B', 'U11:OUT2'],
      ['M12:A', 'U11:OUT3'],
      ['M12:B', 'U11:OUT4'],
      ['M13:A', 'U12:OUT1'],
      ['M13:B', 'U12:OUT2'],
      ['M14:A', 'U12:OUT3'],
      ['M14:B', 'U12:OUT4'],
      ['BT1:+', 'U11:12V', 'U12:12V'],
      ['A1:D1', 'R11:1'],
      ['R11:2', 'R12:1', 'U1:RXD'],
      ['A1:D0', 'U1:TXD'],
      ['A1:5V', 'U1:VCC'],
    ]);
    for (const at of ['U11:GND', 'U12:GND', 'BT1:-', 'U1:GND']) expect(nodeOf(doc, x, at), at).toBe(0);
  });

  it('drives all four motors forward, back, round and to a stop from the serial monitor', () => {
    const sim = new Simulator(x.netlist!);
    const rig = new McuRig(doc, x, x.netlist!);
    const dt = 100e-6;
    let last = sim.beginTransient(dt, true);
    rig.prime(last);
    const motors = ['M11', 'M12', 'M13', 'M14'];
    const ids = Object.fromEntries(motors.map((r) => [r, primaryOf(doc, x, r)]));
    // Sends a command, runs 0.25 s and averages the motor currents of the last 0.1 s.
    const run = (cmd: string): Record<string, number> => {
      rig.sendSerial(cmd);
      const start = last.time;
      const sum = Object.fromEntries(motors.map((r) => [r, 0]));
      let n = 0;
      while (last.time < start + 0.25) {
        last = rig.step(sim, dt);
        if (last.time >= start + 0.15) {
          n++;
          for (const r of motors) sum[r] += last.i[ids[r]];
        }
      }
      return Object.fromEntries(motors.map((r) => [r, sum[r] / n]));
    };
    run('S');
    const fwd = run('F');
    for (const r of motors) expect(fwd[r], `${r} forward`).toBeGreaterThan(0.2);
    const back = run('B');
    for (const r of motors) expect(back[r], `${r} back`).toBeLessThan(-0.2);
    const left = run('L');
    expect(left.M11).toBeLessThan(-0.2);
    expect(left.M13).toBeLessThan(-0.2);
    expect(left.M12).toBeGreaterThan(0.2);
    expect(left.M14).toBeGreaterThan(0.2);
    const stop = run('S');
    for (const r of motors) expect(Math.abs(stop[r]), `${r} stopped`).toBeLessThan(0.02);
    expect(rig.serial).toContain('#CAR F v=7');
    expect(rig.serial).toContain('#CAR B v=7');
  }, 180_000);
});

describe('the remote control', () => {
  let doc: Doc;
  let x: Extracted;
  beforeAll(() => {
    doc = remoteExample();
    x = build(doc);
  });

  it('wires the five buttons, the knob, the LED and the radio', () => {
    expectNets(doc, x, [
      ['A1:D3', 'S11:1'],
      ['A1:D4', 'S12:1'],
      ['A1:D5', 'S13:1'],
      ['A1:D6', 'S14:1'],
      ['A1:D9', 'S15:1'],
      ['A1:A0', 'RV1:W'],
      ['A1:D7', 'R13:1'],
      ['R13:2', 'D1:A'],
      ['A1:D1', 'R11:1'],
      ['R11:2', 'R12:1', 'U1:RXD'],
      ['A1:D0', 'U1:TXD'],
      ['A1:5V', 'U1:VCC', 'RV1:A'],
    ]);
    for (const at of ['S11:2', 'S12:2', 'S13:2', 'S14:2', 'S15:2', 'RV1:B', 'D1:K', 'U1:GND']) expect(nodeOf(doc, x, at), at).toBe(0);
  });
});

describe('remote control and car talking over Bluetooth', () => {
  let doc: Doc;
  let x: Extracted;
  beforeAll(() => {
    doc = carPairExample();
    x = build(doc);
  });

  it('passes what is typed to the car, which drives its motors and answers', () => {
    const sim = new Simulator(x.netlist!);
    const rig = new McuRig(doc, x, x.netlist!);
    expect(rig.count).toBe(2);
    const dt = 100e-6;
    let last = sim.beginTransient(dt, true);
    rig.prime(last);
    while (last.time < 0.05) last = rig.step(sim, dt);
    rig.sendSerial('F');
    const ids = ['M21', 'M22', 'M23', 'M24'].map((r) => primaryOf(doc, x, r));
    let sum = 0;
    let n = 0;
    while (last.time < 0.45) {
      last = rig.step(sim, dt);
      if (last.time > 0.3) {
        n++;
        sum += ids.reduce((s, id) => s + last.i[id], 0) / ids.length;
      }
    }
    // Each board's lines are written whole, with the board's reference in front.
    expect(rig.serial).toContain('[A1] #REMOTE READY');
    expect(rig.serial).toContain('[A2] #CAR READY');
    expect(rig.serial).toContain('[A1] F');
    expect(rig.serial).toContain('[A2] #CAR F v=7');
    expect(sum / n).toBeGreaterThan(0.2);
  }, 180_000);
});

describe('the radio module wiring examples', () => {
  it('feeds the nRF24L01 from 3.3 V and wires the SPI lines', () => {
    const doc = nrf24Example();
    const x = build(doc);
    expectNets(doc, x, [
      ['A1:D13', 'U1:SCK'],
      ['A1:D11', 'U1:MOSI'],
      ['A1:D12', 'U1:MISO'],
      ['A1:D10', 'U1:CSN'],
      ['A1:D9', 'U1:CE'],
      ['U2:OUT', 'U1:VCC'],
    ]);
    // The output capacitor hangs from the 3.3 V net.
    expect([nodeOf(doc, x, 'C2:1'), nodeOf(doc, x, 'C2:2')]).toContain(nodeOf(doc, x, 'U2:OUT'));
    const s = new Simulator(x.netlist!).operatingPoint();
    const vcc = s.v[nodeOf(doc, x, 'U1:VCC')];
    expect(vcc).toBeGreaterThan(3.1);
    expect(vcc).toBeLessThan(3.5);
  });

  it('feeds the ESP-01 from 3.3 V, pulls CH_PD and RST up and divides the TX line', () => {
    const doc = esp01Example();
    const x = build(doc);
    const s = new Simulator(x.netlist!).operatingPoint();
    for (const pin of ['VCC', 'CH_PD', 'RST']) {
      const v = s.v[nodeOf(doc, x, `U1:${pin}`)];
      expect(v, pin).toBeGreaterThan(3.1);
      expect(v, pin).toBeLessThan(3.5);
    }
    expect(nodeOf(doc, x, 'A1:D0')).toBe(nodeOf(doc, x, 'U1:TXD'));
    expect([nodeOf(doc, x, 'R2:1'), nodeOf(doc, x, 'R2:2')]).toContain(nodeOf(doc, x, 'U1:RXD'));
  });
});
