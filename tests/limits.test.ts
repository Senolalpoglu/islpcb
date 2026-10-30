import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator } from '../core/sim/solver';
import { LimitTracker, ratingsOf } from '../src/editor/limits';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, addPart, addWire, emptyDoc, pinPositions, type Doc, type Part, type PartType, type Pt } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** A small circuit builder: parts at grid points, wires routed through the points given. */
class Bench {
  doc: Doc = emptyDoc();
  put(type: PartType, x: number, y: number, params: Record<string, number | boolean | string> = {}, rot: 0 | 90 | 180 | 270 = 0): Part {
    this.doc = addPart(this.doc, type, x, y, rot);
    const part = this.doc.parts[this.doc.parts.length - 1];
    part.params = { ...part.params, ...params };
    return part;
  }
  pin(part: Part, name: string): Pt {
    return pinPositions(part)[PART_DEFS[part.type].pinNames.indexOf(name)];
  }
  /** Draws wires through the points one after another (straight segments only). */
  route(...pts: Pt[]): this {
    for (let i = 1; i < pts.length; i++) this.doc = addWire(this.doc, pts[i - 1], pts[i]);
    return this;
  }
}

const P = (x: number, y: number): Pt => ({ x, y });

/** The issues found in the operating point of a circuit. */
function check(doc: Doc) {
  const x = extractNetlist(doc);
  expect(x.error).toBeNull();
  const s = new Simulator(x.netlist!).operatingPoint();
  expect(s.converged).toBe(true);
  return new LimitTracker().update(doc, x, s);
}

describe('operating limits', () => {
  it('stays quiet for a sensible circuit: 5 V, 330 ohm, LED', () => {
    const b = new Bench();
    b.put('VDC', 0, 4, { v: 5 });
    b.put('R', 6, 0, { r: 330 });
    b.put('LED', 12, 4, {}, 90);
    b.put('GND', 4, 10);
    b.route(P(0, 2), P(4, 2), P(4, 0)).route(P(8, 0), P(12, 0), P(12, 2)).route(P(12, 6), P(0, 6)).route(P(4, 6), P(4, 10));
    expect(check(b.doc)).toEqual([]);
  });

  it('flags an LED without a resistor: far too much current', () => {
    const b = new Bench();
    b.put('VDC', 0, 4, { v: 5 });
    const led = b.put('LED', 8, 4, {}, 90);
    b.put('GND', 4, 10);
    b.route(P(0, 2), P(8, 2)).route(P(8, 6), P(0, 6)).route(P(4, 6), P(4, 10));
    const found = check(b.doc);
    const issue = found.find((i) => i.partId === led.id && i.kind === 'overcurrent');
    expect(issue, JSON.stringify(found)).toBeDefined();
    expect(issue!.value).toBeGreaterThan(0.03);
    expect(issue!.limit).toBe(0.03);
  });

  it('flags an LED and a polarised capacitor connected backwards as wrong polarity', () => {
    // The source turned round: its + is at the bottom, grounded; the top is at -9 V.
    const b = new Bench();
    b.put('VDC', 0, 4, { v: 9 }, 180);
    b.put('R', 6, 0, { r: 1000 });
    const led = b.put('LED', 12, 4, {}, 90);
    b.put('GND', 4, 10);
    b.route(P(0, 2), P(4, 2), P(4, 0)).route(P(8, 0), P(12, 0), P(12, 2)).route(P(12, 6), P(0, 6)).route(P(4, 6), P(4, 10));
    const found = check(b.doc);
    expect(found.some((i) => i.partId === led.id && i.kind === 'polarity' && i.value < -5), JSON.stringify(found)).toBe(true);

    const c = new Bench();
    c.put('VDC', 0, 4, { v: 10 }, 180);
    const cap = c.put('x:cap-electrolytic', 8, 4, {}, 90);
    c.put('GND', 4, 10);
    c.route(P(0, 2), P(8, 2)).route(P(8, 6), P(0, 6)).route(P(4, 6), P(4, 10));
    const reversed = check(c.doc).find((i) => i.partId === cap.id);
    expect(reversed?.kind).toBe('polarity');
  });

  it('flags a capacitor over its voltage rating', () => {
    const b = new Bench();
    b.put('VDC', 0, 4, { v: 30 });
    const cap = b.put('x:cap-electrolytic', 8, 4, { v: 16 }, 90);
    b.put('GND', 4, 10);
    b.route(P(0, 2), P(8, 2)).route(P(8, 6), P(0, 6)).route(P(4, 6), P(4, 10));
    const found = check(b.doc).find((i) => i.partId === cap.id);
    expect(found?.kind).toBe('overvoltage');
    expect(found?.limit).toBe(16);
  });

  it('flags a 5 V line wired straight to the RXD pin of an HC-05 (3.3 V logic)', () => {
    const b = new Bench();
    b.put('VDC', 0, 4, { v: 5 });
    const hc = b.put('x:hc-05', 14, 4);
    b.put('GND', 4, 10);
    // + to RXD (11,2) and VCC (11,5); - to GND (11,4)
    b.route(P(0, 2), P(6, 2), P(11, 2)).route(P(6, 2), P(6, 5), P(11, 5)).route(P(0, 6), P(8, 6), P(8, 4), P(11, 4)).route(P(4, 6), P(4, 10));
    const found = check(b.doc).filter((i) => i.partId === hc.id);
    expect(found.some((i) => i.kind === 'overvoltage' && i.a === 'RXD' && i.limit === 3.6), JSON.stringify(found)).toBe(true);
    expect(found.some((i) => i.a === 'VCC')).toBe(false); // 5 V is fine for the supply pin
  });

  it('reports an overloaded resistor only after it has been hot for a while, using its power rating', () => {
    const build = (prated?: number): Doc => {
      const b = new Bench();
      b.put('VDC', 0, 4, { v: 12 });
      b.put('R', 8, 4, prated === undefined ? { r: 100 } : { r: 100, prated }, 90);
      b.put('GND', 4, 10);
      b.route(P(0, 2), P(8, 2)).route(P(8, 6), P(0, 6)).route(P(4, 6), P(4, 10));
      return b.doc;
    };
    const run = (doc: Doc) => {
      const x = extractNetlist(doc);
      const sim = new Simulator(x.netlist!);
      sim.beginTransient(1e-4, true);
      const tracker = new LimitTracker();
      const first = tracker.update(doc, x, sim.step());
      let issues = first;
      for (let k = 0; k < 40; k++) {
        for (let i = 0; i < 20; i++) sim.step();
        issues = tracker.update(doc, x, sim.step());
      }
      return { first, issues };
    };
    const hot = run(build());
    expect(hot.first).toEqual([]); // the first frame alone is not enough
    expect(hot.issues[0]?.kind).toBe('overpower');
    expect(hot.issues[0]?.value).toBeCloseTo(1.44, 1);
    expect(run(build(2)).issues).toEqual([]); // a 2 W resistor takes it
  });

  it('has ratings for the parts of the examples', () => {
    for (const type of ['R', 'C', 'LED', 'QNPN', 'NMOS', 'ARDUINO_UNO', 'PICO', 'x:irf540', 'x:bc547', 'x:lm7805', 'x:hc-05', 'x:cap-electrolytic', 'x:lamp-220v-ac-60w', 'x:langevin-28k-50w', 'x:trafo-inverter-12v-230v']) {
      const p = { id: 'p1', type, ref: 'X1', x: 0, y: 0, rot: 0 as const, params: {} };
      expect(ratingsOf(p), type).toBeDefined();
    }
  });
});
