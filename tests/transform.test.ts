import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator } from '../core/sim/solver';
import { loadBuiltinLibrary } from '../src/editor/library';
import { addPart, addWire, emptyDoc, pinPositions, transformPartWithWires, type Doc } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';
import { PartSymbol } from '../src/editor/symbols';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** 10 V source and two 1 k resistors in a loop with ground, drawn with clear space around every wire: the middle node is at 5 V. */
function divider(): Doc {
  let d = addPart(emptyDoc(), 'VDC', 4, 10); // pins (4, 8) and (4, 12)
  d = { ...d, parts: d.parts.map((p) => ({ ...p, params: { ...p.params, v: 10 } })) };
  d = addPart(d, 'R', 14, 6, 90); // pins (14, 4) and (14, 8)
  d = addPart(d, 'R', 14, 14, 90); // pins (14, 12) and (14, 16)
  d = addPart(d, 'GND', 4, 20);
  const line = (a: [number, number], b: [number, number]) => (d = addWire(d, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }));
  line([4, 8], [4, 4]);
  line([4, 4], [14, 4]); // source + to the top of R1
  line([14, 8], [14, 12]); // R1 to R2
  line([14, 16], [14, 18]);
  line([14, 18], [4, 18]); // bottom of R2 to the ground rail
  line([4, 12], [4, 18]);
  line([4, 18], [4, 20]); // source - and the ground symbol
  return d;
}

const nodeOf = (d: Doc, part: number, pin: number) => extractNetlist(d).nodeOfPin.get(`${d.parts[part].id}:${pin}`);
const joined = (d: Doc) => [nodeOf(d, 0, 0) === nodeOf(d, 1, 0), nodeOf(d, 1, 1) === nodeOf(d, 2, 0), nodeOf(d, 2, 1) === nodeOf(d, 3, 0), nodeOf(d, 0, 1) === nodeOf(d, 3, 0)];

describe('rotating and mirroring parts', () => {
  it('mirror flips the pins left to right before the rotation', () => {
    const d = addPart(emptyDoc(), 'QNPN', 10, 10); // collector (2,-2), base (-2,0), emitter (2,2)
    const part = d.parts[0];
    expect(pinPositions({ ...part, mirror: true }).map((p) => p.x - 10)).toEqual([-2, 2, -2]);
    expect(pinPositions({ ...part, mirror: true, rot: 90 })[0]).toEqual({ x: 12, y: 8 }); // (2,-2) -> mirrored (-2,-2) -> turned 90
  });

  it('the test circuit is a real divider before anything is turned', () => {
    const d = divider();
    expect(joined(d)).toEqual([true, true, true, true]);
    const x = extractNetlist(d);
    const s = new Simulator(x.netlist!).operatingPoint();
    expect(s.v[nodeOf(d, 1, 1)!]).toBeCloseTo(5, 3);
  });

  it('keeps every wire connected, and nothing shorted, when a part is rotated or mirrored', () => {
    let d = divider();
    for (const patch of [{ rot: 0 as const }, { rot: 180 as const }, { mirror: true }, { rot: 270 as const, mirror: false }]) {
      d = transformPartWithWires(d, d.parts[1].id, patch);
      expect(joined(d), JSON.stringify(patch)).toEqual([true, true, true, true]);
      expect(nodeOf(d, 1, 0)).not.toBe(nodeOf(d, 1, 1));
    }
  });

  it('the circuit still computes the same after turning parts', () => {
    let d = divider();
    d = transformPartWithWires(d, d.parts[2].id, { rot: 0 });
    d = transformPartWithWires(d, d.parts[1].id, { mirror: true });
    const x = extractNetlist(d);
    const s = new Simulator(x.netlist!).operatingPoint();
    expect(s.v[nodeOf(d, 1, 1)!]).toBeCloseTo(5, 3);
  });
});

describe('pin names stay readable', () => {
  const svg = (rot: number, mirror = false) => renderToStaticMarkup(createElement('svg', null, createElement(PartSymbol, { type: 'ARDUINO_UNO', rot, mirror })));
  /** The transform and anchor of the text element that holds a pin name. */
  const label = (markup: string, name: string): { transform: string; anchor: string } => {
    const tag = [...markup.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)].find((m) => m[2] === name)![1];
    return { transform: /transform="([^"]*)"/.exec(tag)![1], anchor: /text-anchor="(\w+)"/.exec(tag)![1] };
  };

  it('is upright when the part is not turned, and counter-turned when it is', () => {
    expect(label(svg(0), 'D0').transform).toContain('rotate(0)');
    expect(label(svg(180), 'D0').transform).toContain('rotate(-180)'); // the half turn of the part is cancelled: not upside down
    expect(label(svg(90), 'D0').transform).toContain('rotate(-180)'); // runs upwards on the page: -90 - 90
    expect(label(svg(0, true), 'D0').transform).toContain('scale(-1 1)'); // not mirrored on the page
  });

  it('keeps the text beside its pin: it starts at the pin when it runs inwards and ends there when it runs outwards', () => {
    expect(label(svg(0), 'D0').anchor).toBe('start');
    expect(label(svg(180), 'D0').anchor).toBe('end');
    expect(label(svg(0, true), 'D0').anchor).toBe('end');
  });
});
