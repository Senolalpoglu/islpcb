// Example circuits that go with the Arduino sketches clock, car and remote (library/arduino): a six-digit 7-segment clock,
// a four-motor Bluetooth car, its remote control, the two together, and wiring examples of two radio modules.
// Positions are in grid units; the wires are laid on lanes of their own so that no two of them meet by accident
// (tests/comm-examples.test.ts checks every net).

import { hexFor, sketchById } from './arduinoExamples';
import { Builder } from './builder';
import { PART_DEFS, type Doc, type Part, type PartType, type Pt } from './model';

const NANO: PartType = 'ARDUINO_NANO';
const p = (x: number, y: number): Pt => ({ x, y });
const lib = (id: string): PartType => `x:${id}`;

/** The program of a ready-made sketch, as the parameters of the board that runs it. */
function sketch(id: string): Record<string, string> {
  const s = sketchById(id);
  return { source: s.source, hex: hexFor(s, PART_DEFS[NANO].mcu!.engine) };
}

/**
 * An HC-05 on the hardware serial port of a Nano: TX (D1) goes through a 1 k / 2 k divider to RXD (the module's logic is 3.3 V),
 * TXD goes straight to RX (D0), the module's supply comes from the board's 5 V pin along the vertical lane at `lane`.
 * Everything is placed relative to the board's D1 pin. `ref` numbers the parts (U<ref>, R<ref>1, R<ref>2).
 */
function bluetooth(b: Builder, nano: Part, ref: number, link: string, lane: number): Part {
  const t = b.pin(nano, 'D1');
  const r = b.pin(nano, 'D0');
  const v = b.pin(nano, '5V');
  const hc = b.add(lib('hc-05'), t.x + 21, t.y - 11, 0, link ? { link } : {}, `U${ref}`);
  const ra = b.add('R', t.x + 8, t.y - 5, 0, { r: 1e3 }, `R${ref}1`);
  const rb = b.add('R', t.x + 14, t.y - 2, 90, { r: 2e3 }, `R${ref}2`);
  // TX through the divider to RXD.
  b.poly(t, p(t.x + 3, t.y), p(t.x + 3, t.y - 5), b.pin(ra, '1'));
  b.poly(b.pin(ra, '2'), p(t.x + 14, t.y - 5), p(t.x + 14, t.y - 13), b.pin(hc, 'RXD'));
  const [top, bottom] = [b.pin(rb, '1'), b.pin(rb, '2')].sort((m, n) => m.y - n.y);
  b.poly(p(t.x + 14, t.y - 5), top);
  b.gnd(bottom, 1);
  // TXD to RX.
  b.poly(r, p(t.x + 12, r.y), p(t.x + 12, t.y - 12), b.pin(hc, 'TXD'));
  b.gndLeft(b.pin(hc, 'GND'), 2);
  // 5 V along a lane to the supply pin.
  const vcc = b.pin(hc, 'VCC');
  b.poly(v, p(lane, v.y), p(lane, vcc.y), vcc);
  return hc;
}

/**
 * Six digits of a 7-segment display on an Arduino Nano. The seven segment lines come from D2..D8 through 330 ohm
 * resistors, the decimal points (the colons) from A1; the six digit lines D9..D13 and A0 switch the digits' common
 * cathodes to ground through a ULN2003 (one digit is lit at a time, several hundred times a second).
 */
export function clockExample(): Doc {
  const b = new Builder();
  const nano = b.add(NANO, 20, 30, 0, sketch('clock'), 'A1');
  const disp = b.add(lib('7seg-6digit-cc'), 84, 30, 0, {}, 'DS1');
  const uln = b.add(lib('uln2003'), 112, 30, 0, {}, 'U1', true);
  const pin = (name: string): Pt => b.pin(nano, name);
  // Segments a..g: pin, resistor (in alternate columns so that the labels do not touch), a lane of its own to the display.
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach((s, k) => {
    const r = b.add('R', 32 + (k % 2) * 8, 27 + k, 0, { r: 330 }, `R${k + 1}`);
    b.poly(pin(`D${2 + k}`), b.pin(r, '1'));
    const out = b.pin(r, '2');
    const to = b.pin(disp, s);
    b.poly(out, p(56 + k, out.y), p(56 + k, to.y), to);
  });
  // Decimal points: A1 down the left side, a resistor underneath, up to the display.
  const a1 = pin('A1');
  const rdp = b.add('R', 60, 58, 0, { r: 330 }, 'R8');
  b.poly(a1, p(8, a1.y), p(8, 58), b.pin(rdp, '1'));
  const dp = b.pin(disp, 'dp');
  b.poly(b.pin(rdp, '2'), p(72, 58), p(72, dp.y), dp);
  // Digit lines to the ULN2003 inputs (on its right side: the part is mirrored). Each has its own lane and its own row below the display.
  ['D9', 'D10', 'D11', 'D12', 'D13', 'A0'].forEach((name, k) => {
    const src = pin(name);
    const to = b.pin(uln, `${k + 1}B`);
    const col = k < 4 ? 26 + k : k === 4 ? 14 : 12;
    const row = k < 4 ? 46 + k : 50 + (k - 4);
    b.poly(src, p(col, src.y), p(col, row), p(118 + k, row), p(118 + k, to.y), to);
  });
  // ULN2003 outputs straight across to the digits' common cathodes.
  for (let k = 1; k <= 6; k++) b.poly(b.pin(uln, `${k}C`), b.pin(disp, `D${k}`));
  b.gnd(b.pin(uln, 'GND'), 2);
  return b.doc;
}

/**
 * One 4WD car: an Arduino Nano with an HC-05 and two L298N modules that take the same control lines (ENA D5, ENB D6, IN1 D2,
 * IN2 D4, IN3 D7, IN4 D8), so the two motors of a side turn together. A 7.4 V pack feeds both modules. `id` numbers the parts
 * (1 for a single car), `at` moves the whole drawing.
 */
function car(b: Builder, id: number, at: Pt, link: string, program: boolean): Part {
  const X = (x: number): number => x + at.x;
  const Y = (y: number): number => y + at.y;
  const nano = b.add(NANO, X(20), Y(30), 0, program ? sketch('car') : {}, `A${id}`);
  bluetooth(b, nano, id, link, X(10));
  // The two L298N modules, turned round so that their control inputs face the board.
  const la = b.add(lib('l298n'), X(70), Y(20), 0, {}, `U${10 * id + 1}`, true);
  const lb = b.add(lib('l298n'), X(70), Y(48), 0, {}, `U${10 * id + 2}`, true);
  [['D5', 'ENA'], ['D6', 'ENB'], ['D2', 'IN1'], ['D4', 'IN2'], ['D7', 'IN3'], ['D8', 'IN4']].forEach(([from, to], i) => {
    const s = b.pin(nano, from);
    const lane = X(40 + 2 * i);
    const a = b.pin(la, to);
    const c = b.pin(lb, to);
    b.poly(s, p(lane, s.y), p(lane, a.y), a);
    b.poly(p(lane, s.y), p(lane, c.y), c);
  });
  // Motors: OUT1 / OUT2 to the right of a module, OUT3 / OUT4 to its left.
  let m = 0;
  [la, lb].forEach((mod) => {
    const o1 = b.pin(mod, 'OUT1');
    const o2 = b.pin(mod, 'OUT2');
    const right = b.add(lib('dc-motor'), X(88), o1.y + 1, 0, {}, `M${id}${++m}`);
    b.poly(o1, p(o1.x + 3, o1.y), p(o1.x + 3, b.pin(right, 'A').y), b.pin(right, 'A'));
    b.poly(o2, p(o2.x + 5, o2.y), p(o2.x + 5, b.pin(right, 'B').y), b.pin(right, 'B'));
    const o3 = b.pin(mod, 'OUT3');
    const o4 = b.pin(mod, 'OUT4');
    const left = b.add(lib('dc-motor'), X(58), o3.y - 2, 0, {}, `M${id}${++m}`);
    b.poly(o3, p(o3.x - 3, o3.y), p(o3.x - 3, b.pin(left, 'A').y), b.pin(left, 'A'));
    b.poly(o4, p(o4.x - 6, o4.y), p(o4.x - 6, b.pin(left, 'B').y), b.pin(left, 'B'));
    b.gndRight(b.pin(mod, 'GND'), 2);
  });
  // Battery: its plus pole along a lane at x = 84 to both 12 V pins, its minus pole to ground.
  const bt = b.add('VDC', X(96), Y(32), 0, { v: 7.4 }, `BT${id}`);
  const plus = b.pin(bt, '+');
  b.poly(plus, p(X(84), plus.y));
  b.poly(b.pin(la, '12V'), p(X(84), b.pin(la, '12V').y), p(X(84), b.pin(lb, '12V').y), b.pin(lb, '12V'));
  b.gnd(b.pin(bt, '-'), 2);
  return nano;
}

/** The four-motor Bluetooth car on its own; the serial monitor stands in for the phone (F B L R S, 0-9). */
export function carExample(): Doc {
  const b = new Builder();
  car(b, 1, p(0, 0), '', true);
  return b.doc;
}

/**
 * The remote control: five push buttons (F B L R S) and a speed knob on a Nano with an HC-05. Letters typed in the serial
 * monitor are passed on as if a button had been pressed. `id` numbers the parts, `at` moves the drawing.
 */
function remote(b: Builder, id: number, at: Pt, link: string, program: boolean): Part {
  const X = (x: number): number => x + at.x;
  const Y = (y: number): number => y + at.y;
  const nano = b.add(NANO, X(30), Y(30), 0, program ? sketch('remote') : {}, `A${id}`);
  const pin = (name: string): Pt => b.pin(nano, name);
  bluetooth(b, nano, id, link, X(20));
  // Buttons on D3 D4 D5 D6 D9 to ground, standing in a row under the board; each has a lane and a row of its own.
  ['D3', 'D4', 'D5', 'D6', 'D9'].forEach((name, k) => {
    const src = pin(name);
    const btn = b.add(lib('pushbutton'), X(44 + 6 * k), Y(46), 90, { momentary: true }, `S${id}${k + 1}`);
    const [top, bottom] = [b.pin(btn, '1'), b.pin(btn, '2')].sort((m, n) => m.y - n.y);
    b.poly(src, p(src.x + 2 + k, src.y), p(src.x + 2 + k, top.y - 6 + k), p(top.x, top.y - 6 + k), top);
    b.gnd(bottom, 1);
  });
  // Speed knob on A0: wiper to the pin, ends to 5 V and ground.
  const knob = b.add(lib('trimpot'), X(12), Y(30), 0, { pos: 0.5 }, `RV${id}`);
  const a0 = pin('A0');
  const w = b.pin(knob, 'W');
  b.poly(w, p(w.x, a0.y), a0);
  const five = pin('5V');
  const ka = b.pin(knob, 'A');
  b.poly(ka, p(ka.x, five.y), p(X(20), five.y));
  b.gnd(b.pin(knob, 'B'), 2);
  // Green LED on D7: lights up when the car answers.
  const d7 = pin('D7');
  const rl = b.add('R', X(46), d7.y, 0, { r: 330 }, `R${id}3`);
  const led = b.add('x:led-green', X(52), d7.y, 0, {}, `D${id}`);
  b.poly(d7, b.pin(rl, '1'));
  b.poly(b.pin(rl, '2'), b.pin(led, 'A'));
  b.gndRight(b.pin(led, 'K'), 2);
  return nano;
}

/** The remote control on its own. */
export function remoteExample(): Doc {
  const b = new Builder();
  remote(b, 1, p(0, 0), '', true);
  return b.doc;
}

/**
 * Remote control and car in one drawing, linked by name like a paired Bluetooth couple: what is typed in the serial monitor goes
 * to the remote (the first board), over the "radio" to the car, and the car's answer comes back.
 */
export function carPairExample(): Doc {
  const b = new Builder();
  remote(b, 1, p(0, 0), 'car', true);
  car(b, 2, p(0, 62), 'car', true);
  return b.doc;
}

/**
 * A 3.3 V supply from the board's 5 V pin: an AMS1117-3.3 (IN and GND on its left, OUT on its right) with a capacitor on each side.
 * The 5 V comes along a lane at x = 10 and row 5; the 3.3 V leaves the output pin along row 9, which the caller carries on to its
 * load (the output capacitor hangs from that row at x = 60). Returns the output pin.
 */
function supply33(b: Builder, nano: Part): Pt {
  const reg = b.add(lib('ams1117-3v3'), 50, 10, 0, {}, 'U2');
  const v = b.pin(nano, '5V');
  const inn = b.pin(reg, 'IN');
  const out = b.pin(reg, 'OUT');
  b.poly(v, p(10, v.y), p(10, 5), p(inn.x - 3, 5), p(inn.x - 3, inn.y), inn);
  b.gnd(b.pin(reg, 'GND'), 2);
  const cin = b.add('C', 30, 9, 90, { c: 10e-6 }, 'C1');
  const [inTop, inBottom] = [b.pin(cin, '1'), b.pin(cin, '2')].sort((m, n) => m.y - n.y);
  b.poly(p(inTop.x, 5), inTop);
  b.gnd(inBottom, 1);
  const cout = b.add('C', 60, 16, 90, { c: 10e-6 }, 'C2');
  const [outTop, outBottom] = [b.pin(cout, '1'), b.pin(cout, '2')].sort((m, n) => m.y - n.y);
  b.poly(outTop, p(outTop.x, out.y));
  b.gnd(outBottom, 1);
  return out;
}

/**
 * An nRF24L01+ radio on a Nano: the module wants 3.3 V (not the board's 5 V) with a capacitor close to its supply pin, and
 * takes the SPI lines D13 (SCK), D11 (MOSI), D12 (MISO), D10 (CSN) and D9 (CE). The radio itself is not simulated.
 */
export function nrf24Example(): Doc {
  const b = new Builder();
  const nano = b.add(NANO, 20, 30, 0, {}, 'A1');
  const pin = (name: string): Pt => b.pin(nano, name);
  const out = supply33(b, nano);
  const rf = b.add(lib('nrf24l01'), 96, 36, 0, {}, 'U1');
  const vcc = b.pin(rf, 'VCC');
  b.poly(out, p(112, out.y), p(112, vcc.y), vcc);
  b.gndLeft(b.pin(rf, 'GND'), 2);
  // Each SPI line runs down its own lane beside the board and along a row of its own under the module.
  const ce = b.pin(rf, 'CE');
  const sck = b.pin(rf, 'SCK');
  const miso = b.pin(rf, 'MISO');
  const csn = b.pin(rf, 'CSN');
  const mosi = b.pin(rf, 'MOSI');
  b.poly(pin('D9'), p(26, pin('D9').y), p(26, 44), p(88, 44), p(88, ce.y), ce);
  b.poly(pin('D12'), p(29, pin('D12').y), p(29, 47), p(90, 47), p(90, miso.y), miso);
  b.poly(pin('D13'), p(14, pin('D13').y), p(14, 52), p(92, 52), p(92, sck.y), sck);
  b.poly(pin('D10'), p(27, pin('D10').y), p(27, 56), p(104, 56), p(104, csn.y), csn);
  b.poly(pin('D11'), p(28, pin('D11').y), p(28, 58), p(106, 58), p(106, mosi.y), mosi);
  return b.doc;
}

/**
 * An ESP-01 on a Nano: 3.3 V from a regulator (the module draws up to 300 mA, more than the board's 3.3 V pin gives), CH_PD and RST
 * pulled up to 3.3 V, and the board's TX through a divider to the module's RXD (its TXD goes straight to RX: 3.3 V reads as high).
 * The Wi-Fi is not simulated.
 */
export function esp01Example(): Doc {
  const b = new Builder();
  const nano = b.add(NANO, 20, 30, 0, {}, 'A1');
  const out = supply33(b, nano);
  const esp = b.add(lib('esp-01'), 96, 36, 0, {}, 'U1');
  const vcc = b.pin(esp, 'VCC');
  b.poly(out, p(112, out.y), p(112, vcc.y), vcc);
  b.gndLeft(b.pin(esp, 'GND'), 2);
  // Pull-ups on CH_PD and RST: a resistor from the pin to the 3.3 V lane.
  [['CH_PD', 105, 35, 'R3'], ['RST', 109, 36, 'R4']].forEach(([name, x, y, ref]) => {
    const r = b.add('R', x as number, y as number, 0, { r: 1e4 }, ref as string);
    const pn = b.pin(esp, name as string);
    b.poly(pn, b.pin(r, '1'));
    b.poly(b.pin(r, '2'), p(112, y as number));
  });
  // TX (D1) -> 1 k -> RXD, with 2 k from RXD to ground.
  const d1 = b.pin(nano, 'D1');
  const ra = b.add('R', 40, 22, 0, { r: 1e3 }, 'R1');
  const rb = b.add('R', 90, 41, 90, { r: 2e3 }, 'R2');
  const rxd = b.pin(esp, 'RXD');
  b.poly(d1, p(30, d1.y), p(30, 22), b.pin(ra, '1'));
  b.poly(b.pin(ra, '2'), p(46, 22), p(46, 38), p(90, 38), p(90, rxd.y), rxd);
  const [top, bottom] = [b.pin(rb, '1'), b.pin(rb, '2')].sort((m, n) => m.y - n.y);
  b.poly(p(90, 38), top);
  b.gnd(bottom, 1);
  // TXD round the top of the drawing to RX (D0).
  const d0 = b.pin(nano, 'D0');
  b.poly(b.pin(esp, 'TXD'), p(116, b.pin(esp, 'TXD').y), p(116, 3), p(28, 3), p(28, d0.y), d0);
  return b.doc;
}
