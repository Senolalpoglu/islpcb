import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { extractNetlist } from '../src/editor/netlist';
import { McuRig } from '../src/sim/rig';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** The serial-control example, running: type a command with `send`, then let the simulation run on. */
function setup() {
  const ex = EXAMPLES.find((e) => e.id === 'ino-serial-control')!;
  const doc = ex.build();
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const sim = new Simulator(x.netlist!);
  const rig = new McuRig(doc, x, x.netlist!);
  let last: Solution = sim.beginTransient(ex.dt, true);
  rig.prime(last);
  const relay = doc.parts.find((p) => p.type === 'x:relay-module-1ch')!;
  const names = ['DC+', 'DC-', 'IN', 'NC', 'COM', 'NO'];
  const led = doc.parts.find((p) => p.type === 'LED')!.id;
  return {
    doc,
    x,
    rig,
    runTo(t: number) {
      while (last.time < t - ex.dt / 2) {
        last = rig.step(sim, ex.dt);
        expect(last.converged).toBe(true);
      }
    },
    /** Types a line like the serial monitor does and lets the board answer. */
    send(line: string, wait = 0.35) {
      rig.sendSerial(`${line}\n`);
      this.runTo(last.time + wait);
    },
    get time() {
      return last.time;
    },
    ledCurrent: () => last.i[led],
    node: (pin: string) => x.nodeOfPin.get(`${relay.id}:${names.indexOf(pin)}`)!,
    volts: (n: number) => last.v[n],
  };
}

describe('LED and relay controlled over serial', () => {
  it('greets, then obeys LED ON and LED OFF', () => {
    const t = setup();
    t.runTo(0.3);
    expect(t.rig.serial).toContain('Ready:');
    expect(Math.abs(t.ledCurrent())).toBeLessThan(1e-6);
    t.send('LED ON');
    expect(t.ledCurrent()).toBeGreaterThan(7e-3);
    expect(t.rig.serial).toContain('OK LED=1 RELAY=0');
    t.send('led off'); // lower case works as well
    expect(Math.abs(t.ledCurrent())).toBeLessThan(1e-6);
    expect(t.rig.serial).toContain('OK LED=0 RELAY=0');
  });

  it('RELAY ON closes the relay and the lamp gets 12 V; RELAY OFF lets it go', () => {
    const t = setup();
    t.runTo(0.3);
    const lamp = t.node('NO');
    expect(t.volts(lamp)).toBeLessThan(0.5); // open: the lamp is at 0 V
    t.send('RELAY ON');
    expect(t.rig.serial).toContain('OK LED=0 RELAY=1');
    expect(t.volts(lamp)).toBeGreaterThan(11);
    t.send('RELAY OFF');
    expect(t.volts(lamp)).toBeLessThan(0.5);
  });

  it('the relay module is driven active low from D7 and has its own supply', () => {
    const t = setup();
    t.runTo(0.3);
    const idle = t.volts(t.node('IN'));
    expect(idle).toBeGreaterThan(4.5); // D7 high: IN high, the relay stays off
    t.send('RELAY ON');
    expect(t.volts(t.node('IN'))).toBeLessThan(0.5); // D7 low: IN low, the coil is energised
    expect(t.volts(t.node('DC+'))).toBeGreaterThan(4.5);
  });

  it('answers STATUS and reports unknown commands, and the two outputs are independent', () => {
    const t = setup();
    t.runTo(0.3);
    t.send('LED ON');
    t.send('RELAY ON');
    expect(t.ledCurrent()).toBeGreaterThan(7e-3);
    t.send('status');
    expect(t.rig.serial.trimEnd().endsWith('OK LED=1 RELAY=1')).toBe(true);
    t.send('FAN ON');
    expect(t.rig.serial).toContain('ERR unknown command');
    expect(t.ledCurrent()).toBeGreaterThan(7e-3); // an unknown command changes nothing
  });
});
