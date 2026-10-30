import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { LimitTracker } from '../src/editor/limits';
import { loadBuiltinLibrary } from '../src/editor/library';
import { motionOf } from '../src/editor/motion';
import { PART_DEFS, addPart, addWire, emptyDoc, type Doc, type Part } from '../src/editor/model';
import { extractNetlist, type Extracted } from '../src/editor/netlist';
import { McuRig } from '../src/sim/rig';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!;
const part = (doc: Doc, ref: string): Part => doc.parts.find((p) => p.ref === ref)!;
/** Solver node of a pin of a part, by reference and pin name. */
const nodeOf = (doc: Doc, x: Extracted, ref: string, pin: string): number => {
  const p = part(doc, ref);
  return x.nodeOfPin.get(`${p.id}:${PART_DEFS[p.type].pinNames.indexOf(pin)}`)!;
};

/** A circuit without a microcontroller, stepping with the example's own time step. */
function run(id: string, mutate: (doc: Doc) => Doc = (d) => d) {
  const ex = example(id);
  const doc = mutate(ex.build());
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const sim = new Simulator(x.netlist!);
  let last: Solution = sim.beginTransient(ex.dt, true);
  const tracker = new LimitTracker();
  return {
    doc,
    x,
    ex,
    /** Runs to time t, calling `each` after every step. */
    to(t: number, each?: (s: Solution) => void) {
      let k = 0;
      while (last.time < t - ex.dt / 2) {
        last = sim.step();
        expect(last.converged, `${id} diverged at ${last.time}`).toBe(true);
        each?.(last);
        if (++k % 100 === 0) tracker.update(doc, x, last);
      }
    },
    get now() {
      return last;
    },
    issues: () => tracker.update(doc, x, last),
  };
}

/** The same with the microcontroller's firmware running; `send` types to the serial port like the serial monitor. */
function runBoard(id: string, mutate: (doc: Doc) => Doc = (d) => d) {
  const ex = example(id);
  const doc = mutate(ex.build());
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const sim = new Simulator(x.netlist!);
  const rig = new McuRig(doc, x, x.netlist!);
  let last: Solution = sim.beginTransient(ex.dt, true);
  rig.prime(last);
  const tracker = new LimitTracker();
  return {
    doc,
    x,
    rig,
    to(t: number, each?: (s: Solution) => void) {
      let k = 0;
      while (last.time < t - ex.dt / 2) {
        last = rig.step(sim, ex.dt);
        expect(last.converged, `${id} diverged at ${last.time}`).toBe(true);
        each?.(last);
        if (++k % 200 === 0) tracker.update(doc, x, last);
      }
    },
    send(text: string, wait = 0.15) {
      rig.sendSerial(text);
      this.to(last.time + wait);
    },
    get now() {
      return last;
    },
    issues: () => tracker.update(doc, x, last),
  };
}

describe('project examples: every one builds', () => {
  const IDS = ['inverter', 'mains-lamps', 'fm-tx', 'am-radio', 'us-driver', 'ino-bluetooth', 'ino-sensors'];
  for (const id of IDS) {
    it(`${id} has a ground, uses only library parts and leaves no wire unconnected`, () => {
      const doc = example(id).build();
      const x = extractNetlist(doc);
      expect(x.error).toBeNull();
      for (const p of doc.parts) expect(PART_DEFS[p.type], `${id}: ${p.type}`).toBeDefined();
      // Every pin shares its net with another pin, except a few that really are left open.
      const nets = new Map<number, string[]>();
      for (const p of doc.parts) PART_DEFS[p.type].pinNames.forEach((n, i) => nets.set(x.nodeOfPin.get(`${p.id}:${i}`)!, [...(nets.get(x.nodeOfPin.get(`${p.id}:${i}`)!) ?? []), `${p.ref}.${n}`]));
      const open = [...nets.values()].filter((l) => l.length === 1).map((l) => l[0]);
      const allowed: Record<string, RegExp> = {
        inverter: /^U1\.OSC$/,
        'mains-lamps': /^$/,
        'fm-tx': /^$/,
        'am-radio': /^(L1\.C1|L1\.C2|U2\.GAIN1|U2\.GAIN8)$/,
        'us-driver': /^(A1\.(D13|3V3|AREF|A[1-7]|RST|VIN|D0|D1|D2|D3|D7|D8|D11|D12)|U2\.NC[18])$/,
        'ino-bluetooth': /^(A1\.(D2|D3|D4|D5|D6|D7|D10|D11|D13|AREF|A[0-5]|3V3|VIN|RESET|IOREF|GND)|U1\.(STATE|EN)|K1\.NC)$/,
        'ino-sensors': /^(A1\.(D0|D1|D2|D3|D4|D6|D7|D10|D11|AREF|A4|A5|3V3|VIN|RESET|IOREF|GND)|U2\.DO|U3\.DO)$/,
      };
      expect(open.filter((n) => !allowed[id].test(n)), `${id}: pins connected to nothing`).toEqual([]);
      // A supply is never tied to ground by an accidental junction.
      const ground = nets.get(0) ?? [];
      expect(ground.filter((n) => /\.(5V|VCC|VDD|\+VS|VS|DC\+|3V3)$/.test(n) || /^(V\d|BT\d)\.\+$/.test(n)), `${id}: a supply pin is on the ground net`).toEqual([]);
    });
  }
});

describe('inverter', () => {
  it('turns 12 V DC into a 50 Hz square wave of about 220 V across the lamp', () => {
    const t = run('inverter');
    const { doc, x } = t;
    const out1 = nodeOf(doc, x, 'T1', 'S1');
    const out2 = nodeOf(doc, x, 'T1', 'S2');
    const q = nodeOf(doc, x, 'U1', 'Q');
    let hi = -1e9;
    let lo = 1e9;
    let edges = 0;
    let prev = 0;
    t.to(0.14, (s) => {
      if (s.time > 0.06) {
        const v = s.v[out1] - s.v[out2];
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
        const level = s.v[q] > 6 ? 1 : 0;
        if (level && !prev) edges++;
        prev = level;
      }
    });
    expect(hi).toBeGreaterThan(190);
    expect(lo).toBeLessThan(-190);
    expect(edges).toBeGreaterThanOrEqual(3); // 80 ms at about 50 Hz
    expect(edges).toBeLessThanOrEqual(5);
    // The lamp takes about 60 W from 230 V: the battery gives about 5 A.
    expect(Math.abs(t.now.i[`${part(doc, 'BT1').id}.0`] ?? 0)).toBeLessThan(20);
    expect(t.issues(), 'nothing in the inverter is over its ratings').toEqual([]);
  });
});

describe('220 V lamps', () => {
  it('the AC lamp takes its rated 60 W, the neon indicator a milliamp, and the 12 V supply holds up', () => {
    const t = run('mains-lamps');
    const { doc, x } = t;
    const lampIds = x.netlist!.elements.filter((e) => e.id.startsWith(part(doc, 'E1').id + '.'));
    let ip = 0;
    let n = 0;
    let dcMin = 1e9;
    let dcMax = -1e9;
    const dc = nodeOf(doc, x, 'C1', '+');
    t.to(0.12, (s) => {
      if (s.time > 0.06) {
        const i = s.i[lampIds[0].id];
        ip += i * i;
        n++;
        dcMin = Math.min(dcMin, s.v[dc]);
        dcMax = Math.max(dcMax, s.v[dc]);
      }
    });
    expect(Math.sqrt(ip / n)).toBeCloseTo(0.273, 1); // 60 W / 220 V
    expect(dcMin).toBeGreaterThan(9);
    expect(dcMax).toBeLessThan(17);
    expect(t.issues()).toEqual([]);
  });
});

describe('FM transmitter', () => {
  it('the BC547 Colpitts oscillator runs near 100 MHz with a large swing', () => {
    const t = run('fm-tx');
    const { doc, x } = t;
    const collector = nodeOf(doc, x, 'Q2', 'C');
    let min = 1e9;
    let max = -1e9;
    let rises = 0;
    let prev = 0;
    t.to(3.5e-6, (s) => {
      if (s.time > 3e-6) {
        min = Math.min(min, s.v[collector]);
        max = Math.max(max, s.v[collector]);
        const above = s.v[collector] > 9 ? 1 : 0;
        if (above && !prev) rises++;
        prev = above;
      }
    });
    const mhz = rises / 0.5;
    expect(max - min).toBeGreaterThan(5);
    expect(mhz).toBeGreaterThan(85);
    expect(mhz).toBeLessThan(115);
    expect(t.issues(), 'the oscillator stays inside the transistor ratings').toEqual([]);
  });
});

describe('AM radio', () => {
  it('the tuned circuit peaks, the ZN414 sits near 1 V and the audio comes out of the LM386', () => {
    const t = run('am-radio');
    const { doc, x } = t;
    const hot = nodeOf(doc, x, 'L1', 'L2');
    const zn = nodeOf(doc, x, 'U1', 'OUT');
    const out = nodeOf(doc, x, 'U2', 'OUT');
    let rf = 0;
    let znMin = 9;
    let znMax = -9;
    let outMin = 99;
    let outMax = -99;
    t.to(0.005, (s) => {
      if (s.time > 0.003) {
        rf = Math.max(rf, Math.abs(s.v[hot]));
        znMin = Math.min(znMin, s.v[zn]);
        znMax = Math.max(znMax, s.v[zn]);
        outMin = Math.min(outMin, s.v[out]);
        outMax = Math.max(outMax, s.v[out]);
      }
    });
    expect(rf).toBeGreaterThan(0.2); // 5 mV in, a Q of about 90
    expect(znMin).toBeGreaterThan(0.5);
    expect(znMax).toBeLessThan(1.6);
    expect(znMax - znMin).toBeGreaterThan(0.01); // the 1 kHz tone is detected
    expect(outMax - outMin).toBeGreaterThan(0.05); // and amplified
    expect(t.issues()).toEqual([]);
  }, 120_000);
});

describe('Arduino and HC-05 Bluetooth', () => {
  it('the phone switches the LED, dims the second one and closes the relay that lights a 220 V lamp', () => {
    const t = runBoard('ino-bluetooth');
    t.to(0.4);
    expect(t.rig.serial).toContain('READY');
    const led1 = part(t.doc, 'D1').id;
    expect(Math.abs(t.now.i[led1])).toBeLessThan(1e-6);
    t.send('1');
    expect(t.now.i[led1]).toBeGreaterThan(5e-3);
    expect(t.rig.serial).toContain('LED=1');
    t.send('0');
    expect(Math.abs(t.now.i[led1])).toBeLessThan(1e-6);
    // The lamp: dark first, then the full mains voltage across it once the relay closes.
    const lampTop = nodeOf(t.doc, t.x, 'E1', '1');
    const lampBottom = nodeOf(t.doc, t.x, 'E1', '2');
    let before = 0;
    t.to(t.now.time + 0.03, (s) => (before = Math.max(before, Math.abs(s.v[lampTop] - s.v[lampBottom]))));
    expect(before).toBeLessThan(1);
    t.send('A', 0.02);
    let after = 0;
    t.to(t.now.time + 0.03, (s) => (after = Math.max(after, Math.abs(s.v[lampTop] - s.v[lampBottom]))));
    expect(after).toBeGreaterThan(300);
    expect(t.rig.serial).toContain('LAMP=ON');
    // Nothing in the circuit is overstressed: the 1 k / 2 k divider keeps RXD at 3.3 V.
    expect(t.issues().filter((i) => i.partId === part(t.doc, 'U1').id)).toEqual([]);
  }, 120_000);
});

describe('Arduino sensor station', () => {
  it('reads the sensors, runs the fan with the temperature and reports on the serial port', () => {
    const t = runBoard('ino-sensors');
    let fanMax = 0;
    t.to(2.2, (sol) => {
      if (sol.time > 1.5) fanMax = Math.max(fanMax, sol.v[nodeOf(t.doc, t.x, 'M1', '+')] - sol.v[nodeOf(t.doc, t.x, 'M1', '-')]);
    });
    expect(fanMax).toBeGreaterThan(10); // the PWM switches the fan fully on in its on-time
    expect(t.issues()).toEqual([]);
    expect(t.rig.serial).toMatch(/T=30\.8C SET=28\.\dC FAN=5\d% LIGHT=6\d\d GAS=2\d\d/);
  }, 120_000);

  it('a gas alarm sounds the buzzer and lights the red LED; the dark switches the night light on', () => {
    const t = runBoard('ino-sensors', (doc) => ({
      ...doc,
      parts: doc.parts.map((p) => (p.ref === 'U3' ? { ...p, params: { ...p.params, level: 0.9 } } : p.ref === 'U2' ? { ...p, params: { ...p.params, level: 0.1 } } : p)),
    }));
    t.to(1.2);
    expect(t.rig.serial).toContain('ALARM');
    expect(t.rig.serial).toContain('(dark)');
    const red = part(t.doc, 'D2').id;
    const night = part(t.doc, 'D1').id;
    expect(t.now.i[red]).toBeGreaterThan(5e-3);
    expect(t.now.i[`${night}.0`]).toBeGreaterThan(5e-3);
  }, 120_000);
});

describe('ultrasonic transducer driver', () => {
  it('drives the Langevin transducer with a 28 kHz burst while FIRE is held, and is silent otherwise', () => {
    const fire = (doc: Doc): Doc => ({ ...doc, parts: doc.parts.map((p) => (p.ref === 'S1' ? { ...p, params: { ...p.params, closed: true } } : p)) });
    const quiet = runBoard('us-driver');
    const nodes = (t: ReturnType<typeof runBoard>) => [nodeOf(t.doc, t.x, 'TR1', '+'), nodeOf(t.doc, t.x, 'TR1', '-')];
    let peak = 0;
    quiet.to(0.03, (s) => {
      const [a, b] = nodes(quiet);
      peak = Math.max(peak, Math.abs(s.v[a] - s.v[b]));
    });
    expect(peak).toBeLessThan(1); // not firing: nothing across the transducer
    expect(quiet.rig.serial).toContain('ULTRASONIC DRIVER');

    const t = runBoard('us-driver', fire);
    let drive = 0;
    let crossings = 0;
    let prev = 0;
    let t0 = 0;
    t.to(0.058, (s) => {
      const [a, b] = nodes(t);
      const v = s.v[a] - s.v[b];
      drive = Math.max(drive, Math.abs(v));
      if (!t0 && Math.abs(v) > 20) t0 = s.time;
      // Count the cycles over the first 4 ms of the burst.
      if (t0 && s.time < t0 + 4e-3 && v > 0 && prev <= 0) crossings++;
      prev = v;
    });
    expect(drive).toBeGreaterThan(100);
    expect(drive).toBeLessThan(400);
    const hz = crossings / 4e-3;
    expect(hz).toBeGreaterThan(26000);
    expect(hz).toBeLessThan(30000);
    expect(t.issues(), 'the driver, the transformer and the transducer are within their ratings').toEqual([]);
  }, 600_000);
});

describe('lamps glow with their power', () => {
  const lit = (type: string, volts: number): { spin: number; pulled: boolean } => {
    let doc = addPart(emptyDoc(), 'VDC', 0, 4);
    doc = addPart(doc, type, 8, 4, 90);
    doc = addPart(doc, 'GND', 4, 10);
    doc = { ...doc, parts: doc.parts.map((p) => (p.type === 'VDC' ? { ...p, params: { ...p.params, v: volts } } : p)) };
    const lamp = doc.parts[1];
    doc = addWire(addWire(addWire(addWire(doc, { x: 0, y: 2 }, { x: 8, y: 2 }), { x: 8, y: 6 }, { x: 0, y: 6 }), { x: 4, y: 6 }, { x: 4, y: 10 }), { x: 0, y: 2 }, { x: 0, y: 2 });
    const x = extractNetlist(doc);
    const sol = new Simulator(x.netlist!).operatingPoint();
    let m = motionOf(lamp, sol, x)!;
    for (let k = 0; k < 40; k++) m = motionOf(lamp, sol, x)!; // the glow settles over a few frames
    return m;
  };
  it('a 12 V lamp is dark without power, bright at its rating', () => {
    expect(lit('x:lamp-12v-dc-5w', 0).pulled).toBe(false);
    const full = lit('x:lamp-12v-dc-5w', 12);
    expect(full.pulled).toBe(true);
    expect(full.spin).toBeGreaterThan(0.95);
    const dim = lit('x:lamp-12v-dc-5w', 6);
    expect(dim.spin).toBeGreaterThan(0.2);
    expect(dim.spin).toBeLessThan(0.3); // (6 / 12)^2
  });
});
