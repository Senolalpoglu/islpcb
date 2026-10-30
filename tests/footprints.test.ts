import { beforeAll, describe, expect, it } from 'vitest';
import { absolutePads, footprintById } from '../core/pcb/footprints';
import { importLibraryText, loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, PART_ORDER } from '../src/editor/model';
import { defaultFootprint } from '../src/pcb/sync';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

describe('footprints follow the schematic pins', () => {
  it('every part with a footprint reaches each of its pins through exactly one pad', () => {
    for (const type of PART_ORDER) {
      const fp = defaultFootprint({ type });
      if (!fp) continue; // virtual parts: ground, probe
      const def = footprintById(fp);
      expect(def, `${type}: footprint ${fp} exists`).toBeDefined();
      const used = def!.pads.filter((p) => p.pin !== null).map((p) => p.pin!);
      expect(used.length, `${type}: pads without a pin`).toBeGreaterThan(0);
      for (let i = 0; i < PART_DEFS[type].pins.length; i++) expect(used, `${type}: pin ${PART_DEFS[type].pinNames[i]} has no pad`).toContain(i);
    }
  });

  it('development boards put each signal on the pad that carries its name', () => {
    for (const type of ['ARDUINO_UNO', 'ARDUINO_NANO', 'ARDUINO_MEGA', 'PICO', 'PICO_W']) {
      const def = footprintById(defaultFootprint({ type })!)!;
      for (const pad of def.pads) if (pad.pin !== null) expect(PART_DEFS[type].pinNames[pad.pin], `${type} pad ${pad.name}`).toBe(pad.name);
    }
  });

  it('the Uno header has the real shape: 18 + 8 + 6 pads on a 68.6 x 53.3 mm board', () => {
    const def = footprintById(defaultFootprint({ type: 'ARDUINO_UNO' })!)!;
    expect(def.pads.length).toBe(32);
    expect(def.body.w).toBeCloseTo(68.58, 2);
    const d13 = def.pads.find((p) => p.name === 'D13')!;
    const d8 = def.pads.find((p) => p.name === 'D8')!;
    const d7 = def.pads.find((p) => p.name === 'D7')!;
    expect(d13.x - d8.x).toBeCloseTo(-12.7, 1); // five pins at 2.54 mm, D13 is further left than D8
    expect(d7.x - d8.x).toBeCloseTo(4.064, 2); // the 0.16 inch gap in the header
  });

  it('wires specific physical pins: a 2N3904 is E-B-C, a BC547 is C-B-E, a potentiometer is A-W-B', () => {
    const pinAtPad = (type: string, pad: string): string => {
      const def = footprintById(defaultFootprint({ type })!)!;
      return PART_DEFS[type].pinNames[def.pads.find((p) => p.name === pad)!.pin!];
    };
    expect([1, 2, 3].map((n) => pinAtPad('x:2n3904', String(n)))).toEqual(['E', 'B', 'C']);
    expect([1, 2, 3].map((n) => pinAtPad('x:bc547', String(n)))).toEqual(['C', 'B', 'E']);
    expect([1, 2, 3].map((n) => pinAtPad('x:potentiometer', String(n)))).toEqual(['A', 'W', 'B']);
    expect([1, 2, 3].map((n) => pinAtPad('x:lm7805', String(n)))).toEqual(['IN', 'GND', 'OUT']);
    expect([1, 2, 3].map((n) => pinAtPad('x:lm7905', String(n)))).toEqual(['GND', 'IN', 'OUT']);
  });
});

describe('footprints that were wrong before the review', () => {
  it('parts without a package stay off the PCB: the idealised gates and the flip-flop', () => {
    for (const t of ['x:gate-nand', 'x:gate-nor', 'x:gate-xor', 'x:gate-inv', 'x:dff']) expect(defaultFootprint({ type: t }), t).toBeNull();
    expect(defaultFootprint({ type: 'x:74hc00' })).not.toBeNull(); // a real chip does get one
  });

  it('a regulator is a TO-220, and the SOT-223 tab is joined to the output pin', () => {
    const pinsOf = (t: string, pad: string) => {
      const def = footprintById(defaultFootprint({ type: t })!)!;
      const idx = def.pads.find((p) => p.name === pad)!.pin;
      return idx === null ? null : PART_DEFS[t].pinNames[idx];
    };
    expect(footprintById(defaultFootprint({ type: 'x:regulator' })!)!.label).toMatch(/TO-220/);
    expect(pinsOf('x:lm1117-3v3', 'TAB')).toBe('OUT');
    expect(pinsOf('x:lm1117-3v3', '2')).toBe('OUT');
  });

  it('the op-amp with supply pins follows the 741 pinout in a DIP-8', () => {
    const def = footprintById(defaultFootprint({ type: 'x:opamp-supply' })!)!;
    const at = (pad: string) => PART_DEFS['x:opamp-supply'].pinNames[def.pads.find((p) => p.name === pad)!.pin!];
    expect([at('6'), at('2'), at('3'), at('7'), at('4')]).toEqual(['OUT', '-', '+', 'V+', 'V-']);
  });

  it('relay holes are where the maker puts them: 12.2 mm between the columns and 12 mm between the rows', () => {
    const def = footprintById('RELAY_SRD_C')!;
    const p = (n: string) => def.pads.find((q) => q.name === n)!;
    expect(p('3').x - p('2').x).toBeCloseTo(12.2, 1);
    expect(p('2').y - p('5').y).toBeCloseTo(12, 1);
    expect(p('2').x - p('1').x).toBeCloseTo(1.95, 2); // the "2 +- 0.05" of the drawing
    expect(p('1').y).toBeCloseTo(0, 6); // common sits on the centre line
    expect(def.pads.length).toBe(5);
    expect(footprintById('RELAY_SRD_A')!.pads.length).toBe(4); // no normally-closed pin
  });

  it('a relay that is the mirror image can be flipped, and its pads keep their nets', () => {
    const def = footprintById(defaultFootprint({ type: 'x:relay-srd-12v-c' })!)!;
    const inst = { partId: 'p1', footprint: 'x', x: 0, y: 0, rot: 0 as const };
    const plain = absolutePads(inst, def).find((p) => p.name === '1')!;
    const flipped = absolutePads({ ...inst, mirror: true }, def).find((p) => p.name === '1')!;
    expect(flipped.x).toBeCloseTo(-plain.x, 6);
    expect(flipped.key).toBe(plain.key);
  });

  it('a part can bring its own footprint from the datasheet', () => {
    const r = importLibraryText(JSON.stringify({ id: 'my-relay', label: { en: 'My relay' }, category: 'electromech', prefix: 'K', symbol: { kind: 'box', left: ['A1', 'A2'], right: ['COM', 'NO'], title: 'K' }, footprintDef: { id: 'MY_RELAY', body: { w: 20, h: 15 }, pads: [{ name: '1', x: -7, y: -5, w: 2.4, drill: 1.2 }, { name: '2', x: -7, y: 5, w: 2.4, drill: 1.2 }, { name: '3', x: 7, y: -5, w: 2.4, drill: 1.2 }, { name: '4', x: 7, y: 5, w: 2.4, drill: 1.2 }] }, padMap: ['A1', 'A2', 'COM', 'NO'], model: { elements: [] } }));
    expect(r.errors).toEqual([]);
    const def = footprintById(defaultFootprint({ type: 'x:my-relay' })!)!;
    expect(def.pads.map((p) => PART_DEFS['x:my-relay'].pinNames[p.pin!])).toEqual(['A1', 'A2', 'COM', 'NO']);
    expect(def.pads[2].x).toBe(7);
    expect(importLibraryText(JSON.stringify({ id: 'bad-fp', label: { en: 'x' }, category: 'misc', prefix: 'U', symbol: { kind: 'box', left: ['A'], right: [] }, footprintDef: { id: 'X', body: { w: 1, h: 1 }, pads: [{ name: '1', x: 'left' }] } })).errors.join(' ')).toMatch(/footprintDef pad 1/);
  });
});

/** Pin numbers of well-known chips, from their datasheets: pin number -> pin name in our symbol. */
const KNOWN: Record<string, Record<string, string>> = {
  'x:ne555': { 1: 'GND', 2: 'TRIG', 3: 'OUT', 4: 'RESET', 5: 'CTRL', 6: 'THR', 7: 'DISCH', 8: 'VCC' },
  'x:lm358': { 1: 'OUT1', 2: 'IN1-', 3: 'IN1+', 4: 'GND', 5: 'IN2+', 6: 'IN2-', 7: 'OUT2', 8: 'VCC' },
  'x:tl072': { 1: 'OUT1', 2: 'IN1-', 3: 'IN1+', 4: 'V-', 5: 'IN2+', 6: 'IN2-', 7: 'OUT2', 8: 'V+' },
  'x:lm741': { 2: 'IN-', 3: 'IN+', 4: 'V-', 6: 'OUT', 7: 'V+' },
  'x:lm324': { 1: '1OUT', 2: '1IN-', 3: '1IN+', 4: 'VCC', 5: '2IN+', 6: '2IN-', 7: '2OUT', 8: '3OUT', 9: '3IN-', 10: '3IN+', 11: 'GND', 12: '4IN+', 13: '4IN-', 14: '4OUT' },
  'x:74hc00': { 1: '1A', 2: '1B', 3: '1Y', 4: '2A', 5: '2B', 6: '2Y', 7: 'GND', 8: '3Y', 9: '3A', 10: '3B', 11: '4Y', 12: '4A', 13: '4B', 14: 'VCC' },
  'x:74hc02': { 1: '1Y', 2: '1A', 3: '1B', 4: '2Y', 5: '2A', 6: '2B', 7: 'GND', 8: '3A', 9: '3B', 10: '3Y', 11: '4A', 12: '4B', 13: '4Y', 14: 'VCC' },
  'x:74hc04': { 1: '1A', 2: '1Y', 3: '2A', 4: '2Y', 5: '3A', 6: '3Y', 7: 'GND', 8: '4Y', 9: '4A', 10: '5Y', 11: '5A', 12: '6Y', 13: '6A', 14: 'VCC' },
  'x:uln2003': { 1: '1B', 7: '7B', 8: 'GND', 9: 'COM', 10: '7C', 16: '1C' },
  'x:optocoupler': { 1: 'A', 2: 'K', 3: 'E', 4: 'C' },
  PIC16F84A: { 1: 'RA2', 4: 'MCLR', 5: 'VSS', 6: 'RB0', 13: 'RB7', 14: 'VDD', 15: 'OSC2', 16: 'OSC1', 17: 'RA0', 18: 'RA1' },
  PIC16F877A: { 1: 'MCLR', 11: 'VDD', 12: 'VSS', 13: 'OSC1', 14: 'OSC2', 19: 'RD0', 20: 'RD1', 21: 'RD2', 26: 'RC7', 31: 'VSS', 32: 'VDD', 33: 'RB0', 40: 'RB7' },
};

describe('chip pin numbers match the datasheets', () => {
  it.each(Object.keys(KNOWN))('%s', (type) => {
    const def = footprintById(defaultFootprint({ type })!)!;
    for (const [pad, name] of Object.entries(KNOWN[type])) {
      const p = def.pads.find((q) => q.name === pad);
      expect(p, `${type}: no pad ${pad}`).toBeDefined();
      expect(p!.pin === null ? null : PART_DEFS[type].pinNames[p!.pin], `${type} pin ${pad}`).toBe(name);
    }
  });
});

describe('Raspberry Pi Pico pins sit where the board has them', () => {
  it('pin 1 (GP0) is top left, pin 20 (GP15) bottom left, pin 21 (GP16) bottom right, pin 40 (VBUS) top right, 17.78 mm apart', () => {
    const def = footprintById(defaultFootprint({ type: 'PICO' })!)!;
    const at = (n: string) => def.pads.find((p) => p.name === n)!;
    expect(at('GP0').x).toBeLessThan(0);
    expect(at('GP0').y).toBeCloseTo(-24.13, 2);
    expect(at('GP15').y).toBeCloseTo(24.13, 2);
    expect(at('GP16').x).toBeGreaterThan(0);
    expect(at('GP16').y).toBeCloseTo(24.13, 2);
    expect(at('VBUS').y).toBeCloseTo(-24.13, 2);
    expect(at('VBUS').x - at('GP0').x).toBeCloseTo(17.78, 2);
    // Pin 3 is a ground, pin 36 is 3V3: counted along the left column (pin n at y = -24.13 + 2.54 (n - 1)).
    expect(def.pads.filter((p) => p.name === 'GND' && Math.abs(p.x + 8.89) < 0.01).map((p) => Math.round((p.y + 24.13) / 2.54) + 1)).toEqual([3, 8, 13, 18]);
  });
});
