import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { addPart, emptyDoc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';
import { McuRig } from '../src/sim/rig';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** The Nextion example, running: the board, its serial wires to the virtual display, and the display's touch screen. */
function setup() {
  const ex = EXAMPLES.find((e) => e.id === 'ino-nextion')!;
  const doc = ex.build();
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const sim = new Simulator(x.netlist!);
  const rig = new McuRig(doc, x, x.netlist!);
  let last: Solution = sim.beginTransient(ex.dt, true);
  rig.prime(last);
  const led = doc.parts.find((p) => p.type === 'LED')!.id;
  return {
    rig,
    runTo(t: number) {
      while (last.time < t - ex.dt / 2) {
        last = rig.step(sim, ex.dt);
        expect(last.converged).toBe(true);
      }
    },
    /** A tap on a component of the screen: press, a moment later let go. */
    tap(component: number) {
      rig.touch(0, component, true);
      this.runTo(last.time + 0.05);
      rig.touch(0, component, false);
      this.runTo(last.time + 0.25);
    },
    get time() {
      return last.time;
    },
    ledCurrent: () => last.i[led],
    screen: () => rig.displays[0].display,
  };
}

const text = (t: ReturnType<typeof setup>, name: string) => t.screen().current.components.find((c) => c.name === name)!;

describe('virtual Nextion display in the circuit', () => {
  it('is wired both ways to the board and powered from its own supply', () => {
    const t = setup();
    t.runTo(0.1);
    const d = t.screen();
    expect(d.linkedRx).toBe(true); // board TX -> display RX
    expect(d.linkedTx).toBe(true); // display TX -> board RX
    expect(d.powered).toBe(true);
  });

  it('the sketch draws its screen: LED state and counter', () => {
    const t = setup();
    t.runTo(1.2);
    expect(text(t, 't1').txt).toBe('LED: OFF');
    expect(text(t, 'n0').val).toBe(0);
    expect(t.screen().history).toContain('page 0');
  });

  it('touching b0 toggles the LED on the board, and the screen follows', () => {
    const t = setup();
    t.runTo(1.2);
    expect(Math.abs(t.ledCurrent())).toBeLessThan(1e-6);
    t.tap(4);
    expect(t.ledCurrent()).toBeGreaterThan(7e-3);
    expect(text(t, 't1').txt).toBe('LED: ON');
    t.tap(4);
    expect(Math.abs(t.ledCurrent())).toBeLessThan(1e-6);
    expect(text(t, 't1').txt).toBe('LED: OFF');
  });

  it('touching b1 counts up on the screen', () => {
    const t = setup();
    t.runTo(1.2);
    t.tap(5);
    t.tap(5);
    t.tap(5);
    expect(text(t, 'n0').val).toBe(3);
  });

  it('does nothing without power, and says so', () => {
    const ex = EXAMPLES.find((e) => e.id === 'ino-nextion')!;
    const doc = ex.build();
    // Take the 5 V source out: the display has no supply.
    const source = doc.parts.find((p) => p.type === 'VDC')!;
    const noPower = { ...doc, parts: doc.parts.filter((p) => p.id !== source.id) };
    const x = extractNetlist(noPower);
    expect(x.error).toBeNull();
    const sim = new Simulator(x.netlist!);
    const rig = new McuRig(noPower, x, x.netlist!);
    let last = sim.beginTransient(ex.dt, true);
    rig.prime(last);
    while (last.time < 0.5) last = rig.step(sim, ex.dt);
    const d = rig.displays[0].display;
    expect(d.powered).toBe(false);
    expect(d.history).toHaveLength(0);
  });

  it('an unwired display is shown as such (no link to a board)', () => {
    const doc = addPart(emptyDoc(), 'x:nextion-display', 10, 10, 0, false);
    const x = extractNetlist(addPart(doc, 'GND', 4, 4, 0, false));
    // No board at all: the rig has nothing to run, but the display part still exists in the circuit.
    const rig = new McuRig(doc, x, x.netlist ?? { nodeCount: 1, elements: [] });
    expect(rig.displays).toHaveLength(1);
    expect(rig.displays[0].display.linkedRx || rig.displays[0].display.linkedTx).toBe(false);
  });
});
