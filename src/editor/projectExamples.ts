// Project examples: complete circuits with the library's real parts, from a power inverter to an FM transmitter, an AM
// radio, Arduino boards with Bluetooth and sensor modules, and a 28 kHz ultrasonic transducer driver. They are drawn
// in code like the other examples (see examples.ts); the parts are the library's `x:` parts (see library/parts/projects.json).

import type { PartType, Doc, Pt } from './model';
import { PART_DEFS } from './model';
import { Builder } from './builder';
import { hexFor, sketchById } from './arduinoExamples';

const p = (x: number, y: number): Pt => ({ x, y });
const UNO: PartType = 'ARDUINO_UNO';

/** The firmware of a sketch for the Uno, as the board's parameters. */
const sketchParams = (id: string): Record<string, string> => {
  const s = sketchById(id);
  return { source: s.source, hex: hexFor(s, PART_DEFS[UNO].mcu!.engine) };
};

/**
 * 12 V DC to 220 V AC inverter: a CD4047 makes two complementary 50 Hz square waves, two IRF540 power MOSFETs pull the two
 * halves of a centre-tapped 12-0-12 V transformer alternately to ground, and a 220 V lamp is the load.
 * The 1 M resistor only gives the isolated secondary a reference to ground so the scope can show the output.
 */
export function inverter(): Doc {
  const b = new Builder();
  const RAIL = 6;
  // Supply: battery, fuse, switch, a reservoir capacitor.
  const bt = b.add('x:cell-lead-acid', 4, 11, 0, { v: 12, rint: 0.005 }, 'BT1');
  const f1 = b.add('x:fuse', 10, RAIL, 0, { r: 0.001 }, 'F1');
  const s1 = b.add('x:toggle-spst', 16, RAIL, 0, { closed: true }, 'S1');
  b.poly(b.pin(bt, '+'), p(4, RAIL), b.pin(f1, '1')).poly(b.pin(f1, '2'), b.pin(s1, '1')).gnd(b.pin(bt, '-'));
  b.rail(RAIL, 18, 76);
  const c1 = b.add('x:cap-electrolytic', 22, 10, 90, { c: 2200e-6, v: 25, ic: 12, esr: 0.005 }, 'C1');
  b.tap(b.pin(c1, '+'), RAIL).gnd(b.pin(c1, '-'));

  // The oscillator: f = 1 / (4.4 R C) = 52 Hz.
  const u1 = b.add('x:cd4047', 40, 16, 0, {}, 'U1');
  const pu = (n: string): Pt => b.pin(u1, n);
  b.tap(pu('VDD'), RAIL);
  // Free-running: /ASTABLE, ASTABLE and -TRIG to VDD; VSS, +TRIG, RESET and RETRIG to ground.
  b.poly(pu('/ASTABLE'), p(35, 16), p(35, 18), pu('-TRIG')).poly(pu('ASTABLE'), p(35, 17)).poly(p(35, 17), p(24, 17), p(24, RAIL));
  b.gnd(pu('VSS'));
  b.poly(pu('RESET'), p(45, 18), p(45, 19), pu('+TRIG')).poly(p(45, 15), p(45, 19), p(45, 21)).poly(pu('RETRIG'), p(45, 15)).put('GND', 45, 21);
  const r1 = b.add('R', 32, 14, 0, { r: 200e3 }, 'R1');
  const c2 = b.add('C', 31, 11, 0, { c: 22e-9 }, 'C2');
  b.poly(pu('R'), b.pin(r1, '2')).poly(b.pin(r1, '1'), p(29, 14)).poly(pu('RC'), p(29, 15));
  b.poly(p(29, 11), p(29, 15)).poly(b.pin(c2, '1'), p(29, 11)).poly(pu('C'), p(35, 13), p(35, 11), b.pin(c2, '2'));

  // Gate drive: 47 ohm in series, 10 k pull-downs.
  const q1 = b.add('x:irf540', 62, 12, 0, {}, 'Q1');
  const q2 = b.add('x:irf540', 62, 28, 0, {}, 'Q2');
  const r3 = b.add('R', 52, 12, 0, { r: 47 }, 'R3');
  const r4 = b.add('R', 52, 28, 0, { r: 47 }, 'R4');
  b.route(pu('/Q'), b.pin(r3, '1')).route(pu('Q'), b.pin(r4, '1'));
  b.poly(b.pin(r3, '2'), b.pin(q1, 'G')).poly(b.pin(r4, '2'), b.pin(q2, 'G'));
  const r5 = b.add('R', 57, 15, 90, { r: 10e3 }, 'R5');
  const r6 = b.add('R', 57, 31, 90, { r: 10e3 }, 'R6');
  b.poly(b.pin(r5, '1'), p(57, 12)).gnd(b.pin(r5, '2'));
  b.poly(b.pin(r6, '1'), p(57, 28)).gnd(b.pin(r6, '2'));
  b.gnd(b.pin(q1, 'S')).gnd(b.pin(q2, 'S'));

  // Transformer and load.
  const t1 = b.add('x:trafo-inverter-12v-230v', 76, 19, 0, {}, 'T1');
  b.route(b.pin(q1, 'D'), b.pin(t1, 'P1')).route(b.pin(q2, 'D'), b.pin(t1, 'P2'));
  b.poly(b.pin(t1, 'PC'), p(72, 19), p(72, RAIL));
  const lamp = b.add('x:lamp-220v-ac-60w', 88, 19, 90, {}, 'E1');
  b.poly(b.pin(t1, 'S1'), b.pin(lamp, '1')).poly(b.pin(t1, 'S2'), b.pin(lamp, '2'));
  const r7 = b.add('R', 84, 25, 90, { r: 1e6 }, 'R7');
  b.poly(p(84, 21), b.pin(r7, '1')).gnd(b.pin(r7, '2'));
  b.probe(b.pin(q1, 'D'), 'Q1 drain', 0, -2).probe(p(84, 17), 'Vout', 0, -3);
  return b.doc;
}

/**
 * FM transmitter for the 88-108 MHz band: an electret microphone and a common-emitter BC547 stage amplify the sound; a second
 * BC547 is a Colpitts oscillator at about 100 MHz (L = 0.12 uH with a 12 pF trimmer) whose bias the sound modulates. The
 * antenna is a short wire coupled through 3 pF.
 */
export function fmTransmitter(): Doc {
  const b = new Builder();
  const RAIL = 6;
  const bt = b.add('x:cell-9v', 4, 12, 0, { v: 9 }, 'BT1');
  const s1 = b.add('x:toggle-spst', 10, RAIL, 0, { closed: true }, 'S1');
  b.poly(b.pin(bt, '+'), p(4, RAIL), b.pin(s1, '1')).gnd(b.pin(bt, '-'));
  b.rail(RAIL, 12, 76);
  const c7 = b.add('C', 16, 10, 90, { c: 100e-9 }, 'C7');
  b.tap(b.pin(c7, '1'), RAIL).gnd(b.pin(c7, '2'));

  // Microphone and the first stage.
  const r1 = b.add('R', 22, 10, 90, { r: 4.7e3 }, 'R1');
  const mic = b.add('x:mic-electret', 22, 16, 0, {}, 'MK1');
  b.tap(b.pin(r1, '1'), RAIL).poly(b.pin(r1, '2'), b.pin(mic, '+')).gnd(b.pin(mic, '-'));
  const c1 = b.add('C', 28, 14, 0, { c: 100e-9 }, 'C1');
  b.poly(b.pin(c1, '1'), b.pin(mic, '+'));
  const q1 = b.add('x:bc547', 36, 18, 0, {}, 'Q1');
  b.route(b.pin(c1, '2'), b.pin(q1, 'B'));
  const r2 = b.add('R', 34, 11, 0, { r: 470e3 }, 'R2');
  const r3 = b.add('R', 42, 10, 90, { r: 10e3 }, 'R3');
  b.tap(b.pin(r3, '1'), RAIL).route(b.pin(r3, '2'), b.pin(q1, 'C'));
  b.route(b.pin(r2, '2'), b.pin(r3, '2')).route(b.pin(r2, '1'), b.pin(q1, 'B'));
  const r7 = b.add('R', 38, 24, 90, { r: 470 }, 'R7');
  b.poly(b.pin(q1, 'E'), b.pin(r7, '1')).gnd(b.pin(r7, '2'));
  const c2 = b.add('C', 47, 17, 0, { c: 1e-6 }, 'C2');
  const r4 = b.add('R', 56, 17, 0, { r: 22e3 }, 'R4');
  b.route(b.pin(c2, '1'), b.pin(q1, 'C')).poly(b.pin(c2, '2'), b.pin(r4, '1'));

  // The oscillator: a Colpitts with the tank L1 + C3 in the collector and the feedback from C5 and C6.
  const q2 = b.add('x:bc547', 68, 19, 0, {}, 'Q2');
  const r5 = b.add('R', 62, 9, 90, { r: 22e3 }, 'R5');
  const r6 = b.add('R', 62, 26, 90, { r: 10e3 }, 'R6');
  const c4 = b.add('C', 65, 26, 90, { c: 1e-9 }, 'C4');
  b.tap(b.pin(r5, '1'), RAIL).poly(b.pin(r5, '2'), p(62, 23)).poly(p(62, 23), b.pin(r6, '1')).poly(p(62, 19), b.pin(q2, 'B'));
  b.poly(b.pin(r4, '2'), p(62, 17)).poly(b.pin(c4, '1'), p(65, 23), p(62, 23));
  b.gnd(b.pin(r6, '2')).gnd(b.pin(c4, '2'));
  const l1 = b.add('L', 70, 9, 90, { l: 0.12e-6 }, 'L1');
  const c3 = b.add('x:cap-trimmer', 74, 9, 90, { c: 12e-12 }, 'C3');
  b.tap(b.pin(l1, '1'), RAIL).tap(b.pin(c3, '1'), RAIL).poly(b.pin(l1, '2'), b.pin(q2, 'C')).poly(b.pin(c3, '2'), p(74, 13), p(70, 13));
  const cf = b.add('C', 74, 19, 90, { c: 10e-12 }, 'C5');
  const ce = b.add('C', 74, 25, 90, { c: 47e-12 }, 'C6');
  const re = b.add('R', 70, 25, 90, { r: 1e3 }, 'R8');
  b.poly(b.pin(cf, '1'), b.pin(q2, 'C')).poly(b.pin(cf, '2'), b.pin(q2, 'E'));
  b.poly(b.pin(q2, 'E'), b.pin(re, '1')).poly(b.pin(ce, '1'), p(70, 23)).gnd(b.pin(re, '2')).gnd(b.pin(ce, '2'));
  const c8 = b.add('C', 79, 15, 0, { c: 3e-12 }, 'C8');
  const ant = b.add('x:antenna', 87, 13, 0, {}, 'ANT1');
  b.poly(p(70, 15), b.pin(c8, '1')).poly(b.pin(c8, '2'), b.pin(ant, 'ANT'));
  b.probe(b.pin(q2, 'C'), 'RF', -3, -1).probe(b.pin(q1, 'C'), 'audio', 4, 0);
  return b.doc;
}

/**
 * AM radio: a ferrite rod antenna and a tuning capacitor pick the station (f = 1 / (2 pi sqrt(L C)), 600 kHz at 293 pF),
 * a ZN414 radio chip detects it, a volume control and an LM386 amplify it for the speaker. The station is in the antenna:
 * set its carrier and tone in its properties.
 */
export function amRadio(): Doc {
  const b = new Builder();
  // Antenna turned so its tuned winding faces the chip: L2 is the hot end, L1 goes to ground, the tuning capacitor across both.
  const ant = b.add('x:ferrite-antenna', 8, 18, 180, { fc: 600e3, l: 240e-6 }, 'L1');
  const cv = b.add('x:cap-variable', 14, 19, 90, { c: 293e-12 }, 'CV1');
  b.gnd(b.pin(ant, 'L1'));
  b.poly(b.pin(ant, 'L2'), p(14, 16), b.pin(cv, '1')).gnd(b.pin(cv, '2'), 2);
  // ZN414 and its supply: 1.5 V through 1 k into the output pin.
  const bt1 = b.add('x:cell-aa', 14, 8, 0, {}, 'BT1');
  const r1 = b.add('R', 19, 10, 90, { r: 1e3 }, 'R1');
  const u1 = b.add('x:zn414', 26, 18, 0, { gain: 12 }, 'U1');
  b.poly(b.pin(bt1, '+'), p(19, 6), b.pin(r1, '1')).gnd(b.pin(bt1, '-'));
  b.poly(b.pin(r1, '2'), p(19, 17), b.pin(u1, 'OUT'));
  b.gndLeft(b.pin(u1, 'GND'), 2);
  b.poly(p(14, 16), p(17, 16), p(17, 19), b.pin(u1, 'IN'));
  // Audio: coupling capacitor, volume control, LM386.
  const c3 = b.add('C', 34, 15, 0, { c: 1e-6 }, 'C3');
  const rv1 = b.add('x:trimpot', 40, 18, 90, { r: 10e3, pos: 0.7 }, 'RV1');
  b.poly(p(19, 15), b.pin(c3, '1')).poly(b.pin(c3, '2'), p(40, 15), b.pin(rv1, 'A')).gnd(b.pin(rv1, 'B'));
  const u2 = b.add('x:lm386', 54, 18, 0, {}, 'U2');
  b.poly(b.pin(rv1, 'W'), b.pin(u2, 'IN+'));
  b.gndLeft(b.pin(u2, 'IN-'), 2).gnd(b.pin(u2, 'GND'));
  const c4 = b.add('x:cap-electrolytic', 60, 13, 270, { c: 10e-6, v: 16 }, 'C4');
  b.poly(b.pin(u2, 'BYPASS'), p(60, 17), b.pin(c4, '+')).gndUp(b.pin(c4, '-'), 2);
  const bt2 = b.add('x:cell-9v', 72, 10, 0, { v: 9 }, 'BT2');
  const c5 = b.add('x:cap-electrolytic', 66, 10, 90, { c: 47e-6, v: 25 }, 'C5');
  b.poly(b.pin(u2, 'VS'), p(63, 18), p(63, 6), p(72, 6), b.pin(bt2, '+')).gnd(b.pin(bt2, '-'));
  b.tap(b.pin(c5, '+'), 6).gnd(b.pin(c5, '-'));
  const c6 = b.add('x:cap-electrolytic', 60, 19, 0, { c: 220e-6, v: 16 }, 'C6');
  const sp = b.add('x:speaker', 68, 21, 0, { r: 8 }, 'LS1');
  b.poly(b.pin(u2, 'OUT'), b.pin(c6, '+')).poly(b.pin(c6, '-'), p(62, 21), b.pin(sp, '+')).gnd(b.pin(sp, '-'));
  b.probe(b.pin(c3, '1'), 'audio', 0, -2).probe(p(14, 16), 'RF', 0, -2).probe(b.pin(u2, 'OUT'), 'out', 0, 3);
  return b.doc;
}

/**
 * 220 V mains: an inlet with fuse and switch feeds a 60 W lamp with a neon indicator, and a transformer with a rectifier
 * and a capacitor makes 12 V DC for a DC lamp.
 */
export function mainsLamps(): Doc {
  const b = new Builder();
  const L = 4;
  const N = 24;
  const j1 = b.add('x:mains-inlet-220v', 8, 14, 0, {}, 'J1');
  b.poly(b.pin(j1, 'L'), p(14, 13), p(14, L)).rail(L, 14, 56);
  b.poly(b.pin(j1, 'N'), p(16, 14), p(16, N)).rail(N, 16, 56);
  b.gndRight(b.pin(j1, 'PE'), 2);
  // AC lamp and neon indicator across the mains.
  const e1 = b.add('x:lamp-220v-ac-60w', 30, 14, 90, {}, 'E1');
  const n1 = b.add('x:neon-indicator-220v', 38, 14, 90, {}, 'N1');
  b.tap(b.pin(e1, '1'), L).tap(b.pin(e1, '2'), N).tap(b.pin(n1, '1'), L).tap(b.pin(n1, '2'), N);
  // Transformer 220 V to 12-0-12 V, full-wave rectifier on the two halves, smoothing, DC lamp.
  const t1 = b.add('x:trafo-220v-2x12v', 50, 14, 0, {}, 'T1');
  b.tap(b.pin(t1, 'P1'), L).tap(b.pin(t1, 'P2'), N);
  const d1 = b.add('x:1n4007', 60, 11, 0, {}, 'D1');
  const d2 = b.add('x:1n4007', 60, 17, 0, {}, 'D2');
  b.poly(b.pin(t1, 'S1'), b.pin(d1, 'A')).poly(b.pin(t1, 'S2'), b.pin(d2, 'A'));
  b.poly(b.pin(d1, 'K'), p(66, 11), p(66, 17), b.pin(d2, 'K'));
  b.gndRight(b.pin(t1, 'SC'), 2);
  const c1 = b.add('x:cap-electrolytic', 72, 18, 90, { c: 2200e-6, v: 25, ic: 12, esr: 0.005 }, 'C1');
  const e2 = b.add('x:lamp-12v-dc-5w', 80, 18, 90, {}, 'E2');
  b.poly(p(66, 14), p(72, 14), b.pin(c1, '+')).poly(p(72, 14), p(80, 14), b.pin(e2, '1')).gnd(b.pin(c1, '-')).gnd(b.pin(e2, '2'));
  b.probe(p(69, 14), 'DC', 0, -2).probe(p(25, L), 'AC', 0, -2);
  return b.doc;
}

/**
 * Arduino Uno and an HC-05 Bluetooth module on the hardware serial port. The module's RXD takes 3.3 V logic, so the Uno's 5 V
 * TX is divided down with 1 k and 2 k. The phone's letters switch an LED on D8, dim an LED on D9 (PWM) and a relay module on D12
 * that switches a 220 V lamp. (The simulator does not emulate the radio link: type the letters in the serial monitor, which
 * takes the phone's place.)
 */
export function arduinoBluetooth(): Doc {
  const b = new Builder();
  const uno = b.add(UNO, 60, 28, 0, sketchParams('bluetooth'), 'A1');
  const pn = (n: string): Pt => b.pin(uno, n);
  // HC-05 on the right, its pins facing the board. TX (D1) goes through a 1 k / 2 k divider to RXD, TXD goes to RX (D0).
  const hc = b.add('x:hc-05', 80, 16, 0, {}, 'U1');
  const r1 = b.add('R', 62, 8, 0, { r: 1e3 }, 'R1');
  const r2 = b.add('R', 66, 5, 90, { r: 2e3 }, 'R2');
  b.poly(pn('D1'), p(52, 22), p(52, 8), b.pin(r1, '1'));
  b.poly(b.pin(r1, '2'), p(75, 8), p(75, 14), b.pin(hc, 'RXD')).poly(p(66, 8), b.pin(r2, '2')).gndUp(b.pin(r2, '1'), 2);
  b.poly(pn('D0'), p(54, 21), p(54, 11), p(74, 11), p(74, 15), b.pin(hc, 'TXD'));
  b.gndLeft(b.pin(hc, 'GND'), 2);
  b.poly(pn('5V'), p(70, 28), p(70, 17), b.pin(hc, 'VCC'));
  // Two LEDs: D8 on/off, D9 dimmed.
  const r3 = b.add('R', 47, 34, 0, { r: 330 }, 'R3');
  const led1 = b.add('LED', 41, 34, 180, {}, 'D1');
  b.poly(pn('D8'), p(52, 29), p(52, 34), b.pin(r3, '2')).poly(b.pin(r3, '1'), b.pin(led1, 'A')).gndLeft(b.pin(led1, 'K'), 2);
  const r4 = b.add('R', 47, 37, 0, { r: 330 }, 'R4');
  const led2 = b.add('x:led-green', 41, 37, 180, {}, 'D2');
  b.poly(pn('D9'), p(53, 30), p(53, 37), b.pin(r4, '2')).poly(b.pin(r4, '1'), b.pin(led2, 'A')).gndLeft(b.pin(led2, 'K'), 2);
  // Relay module on D12 with its coil on the board's 5 V, and a 220 V lamp on its contacts.
  const rl = b.add('x:relay-module-1ch', 76, 32, 0, {}, 'K1');
  b.poly(p(70, 28), p(70, 31), b.pin(rl, 'DC+')).poly(p(64, 32), b.pin(rl, 'DC-'));
  b.poly(pn('D12'), p(54, 33), p(54, 40), p(70, 40), p(70, 33), b.pin(rl, 'IN'));
  const ac = b.add('x:mains-220v', 92, 38, 0, {}, 'V1');
  const lamp = b.add('x:lamp-220v-ac-60w', 86, 38, 90, {}, 'E1');
  b.poly(b.pin(rl, 'COM'), p(92, 32), b.pin(ac, '+')).poly(b.pin(rl, 'NO'), p(86, 33), b.pin(lamp, '1'));
  b.poly(b.pin(lamp, '2'), b.pin(ac, '-')).gnd(p(89, 40), 2);
  b.probe(p(70, 8), 'D1 TX', 0, -2);
  return b.doc;
}

/**
 * Arduino sensor station: an LM35 temperature sensor, an LDR light module and an MQ-2 gas module on A0-A2, a set-point knob
 * on A3. A 12 V fan on a logic-level MOSFET (PWM on D9) follows the temperature, a night-light LED comes on in the dark, and
 * a buzzer and a red LED sound when the gas level is high. Set what the sensors sense in their properties.
 */
export function arduinoSensorStation(): Doc {
  const b = new Builder();
  const uno = b.add(UNO, 60, 24, 0, sketchParams('sensor-station'), 'A1');
  const pn = (n: string): Pt => b.pin(uno, n);
  // Sensors on the right: each analog pin goes to its own lane, the 5 V bus runs in front of the modules.
  const lm35 = b.add('x:lm35', 82, 12, 0, { temp: 31 }, 'U1');
  const ldr = b.add('x:ldr-module', 82, 20, 0, { level: 0.6 }, 'U2');
  const mq2 = b.add('x:mq2-module', 82, 28, 0, { level: 0.2 }, 'U3');
  const pot = b.add('x:trimpot', 82, 36, 0, { r: 10e3, pos: 0.6 }, 'RV1');
  b.poly(pn('A3'), p(66, 20), p(66, 32), p(82, 32), b.pin(pot, 'W'));
  b.poly(pn('A2'), p(68, 19), p(68, 29), b.pin(mq2, 'AO'));
  b.poly(pn('A1'), p(70, 18), p(70, 21), b.pin(ldr, 'AO'));
  b.poly(pn('A0'), p(72, 17), p(72, 12), b.pin(lm35, 'VOUT'));
  b.poly(pn('5V'), p(65, 24), p(65, 40), p(75, 40), p(75, 11), b.pin(lm35, '+VS'));
  b.poly(p(75, 18), b.pin(ldr, 'VCC')).poly(p(75, 26), b.pin(mq2, 'VCC')).poly(p(75, 36), b.pin(pot, 'A'));
  b.gndLeft(b.pin(lm35, 'GND'), 2).gndLeft(b.pin(ldr, 'GND'), 2).gndLeft(b.pin(mq2, 'GND'), 2).gnd(b.pin(pot, 'B'));
  // Night light (D5) and buzzer (D8) above, fan (D9) in the middle, alarm and heartbeat LEDs below.
  const r3 = b.add('R', 46, 8, 0, { r: 330 }, 'R3');
  const led = b.add('x:led-yellow', 40, 8, 180, {}, 'D1');
  b.poly(pn('D5'), p(52, 22), p(52, 8), b.pin(r3, '2')).poly(b.pin(r3, '1'), b.pin(led, 'A')).gndLeft(b.pin(led, 'K'), 2);
  const bz = b.add('x:speaker', 46, 14, 180, { r: 150 }, 'BZ1');
  b.poly(pn('D8'), p(50, 25), p(50, 14), b.pin(bz, '+')).gndLeft(b.pin(bz, '-'), 2);
  const r1 = b.add('R', 48, 26, 0, { r: 100 }, 'R1');
  const r2 = b.add('R', 43, 29, 90, { r: 10e3 }, 'R2');
  const q1 = b.add('x:irlz44n', 38, 26, 0, {}, 'Q1', true);
  b.poly(pn('D9'), b.pin(r1, '2')).poly(b.pin(r1, '1'), b.pin(q1, 'G')).poly(p(43, 26), b.pin(r2, '1')).gnd(b.pin(r2, '2')).gnd(b.pin(q1, 'S'));
  const fan = b.add('x:fan-12v-80mm', 36, 17, 0, {}, 'M1');
  const v1 = b.add('VDC', 28, 17, 0, { v: 12 }, 'V1');
  const dfl = b.add('x:1n4007', 32, 17, 270, {}, 'D3');
  b.poly(b.pin(fan, '-'), b.pin(q1, 'D')).poly(b.pin(dfl, 'A'), p(32, 20), p(36, 20)).poly(b.pin(v1, '+'), p(28, 12), p(36, 12), b.pin(fan, '+')).poly(p(32, 12), b.pin(dfl, 'K')).gnd(b.pin(v1, '-'));
  const r4 = b.add('R', 42, 36, 0, { r: 330 }, 'R4');
  const led2 = b.add('LED', 36, 36, 180, {}, 'D2');
  b.poly(pn('D12'), p(46, 29), p(46, 36), b.pin(r4, '2')).poly(b.pin(r4, '1'), b.pin(led2, 'A')).gndLeft(b.pin(led2, 'K'), 2);
  const r5 = b.add('R', 44, 42, 0, { r: 330 }, 'R5');
  const led3 = b.add('x:led-green', 38, 42, 180, {}, 'D4');
  b.poly(pn('D13'), p(48, 30), p(48, 42), b.pin(r5, '2')).poly(b.pin(r5, '1'), b.pin(led3, 'A')).gndLeft(b.pin(led3, 'K'), 2);
  b.probe(p(68, 17), 'temp', 0, -2);
  return b.doc;
}

/**
 * Ultrasonic transducer driver, a 28 kHz educational model of the drive electronics of a lithotripsy probe (not a medical
 * device): Timer1 of an Arduino Nano makes two complementary 28 kHz waves with dead time, a TC4427 drives two IRF540 in
 * push-pull, a 1:5 centre-tapped ferrite transformer steps 12 V up, and a 7 mH inductor tunes out the transducer's clamped
 * capacitance so the Langevin transducer sees a resistive load. A knob sets the power, a button is the dead-man's FIRE switch,
 * two LEDs show ready and firing. The fuse is the overcurrent protection; the transducer's drive can be watched on the scope.
 */
export function ultrasonicDriver(): Doc {
  const b = new Builder();
  const RAIL = 6;
  const nano = b.add('ARDUINO_NANO', 24, 34, 0, sketchParams('ultrasonic'), 'A1');
  const pn = (n: string): Pt => b.pin(nano, n);
  // 12 V supply with fuse and reservoir capacitors.
  const bt = b.add('x:cell-lead-acid', 6, 12, 0, { v: 12, rint: 0.005 }, 'BT1');
  const f1 = b.add('x:fuse', 12, RAIL, 0, { r: 0.001 }, 'F1');
  b.poly(b.pin(bt, '+'), p(6, RAIL), b.pin(f1, '1')).gnd(b.pin(bt, '-'));
  b.rail(RAIL, 14, 76);
  const c1 = b.add('x:cap-electrolytic', 20, 10, 90, { c: 2200e-6, v: 25, ic: 12, esr: 0.005 }, 'C1');
  const c2 = b.add('C', 25, 10, 90, { c: 100e-9 }, 'C2');
  b.tap(b.pin(c1, '+'), RAIL).gnd(b.pin(c1, '-')).tap(b.pin(c2, '1'), RAIL).gnd(b.pin(c2, '2'));
  // Power knob on A0.
  const pot = b.add('x:trimpot', 12, 34, 90, { r: 10e3, pos: 0.6 }, 'RV1');
  b.poly(pn('A0'), p(16, 30), p(16, 34), b.pin(pot, 'W')).poly(pn('5V'), p(8, 38), p(8, 32), b.pin(pot, 'A')).gndLeft(b.pin(pot, 'B'), 2);
  b.gndLeft(pn('GND'), 2);
  // FIRE button and the two indicator LEDs, on D4, D5 and D6, each on its own lane.
  const fire = b.add('x:pushbutton', 35, 18, 0, { momentary: true }, 'S1');
  b.poly(pn('D4'), p(30, 33), p(30, 18), b.pin(fire, '1')).gndRight(b.pin(fire, '2'), 1);
  const r8 = b.add('R', 35, 22, 0, { r: 330 }, 'R8');
  const led1 = b.add('x:led-green', 41, 22, 0, {}, 'D1');
  b.poly(pn('D5'), p(31, 34), p(31, 22), b.pin(r8, '1')).poly(b.pin(r8, '2'), b.pin(led1, 'A')).gndRight(b.pin(led1, 'K'), 1);
  const r9 = b.add('R', 35, 26, 0, { r: 330 }, 'R9');
  const led2 = b.add('LED', 41, 26, 0, {}, 'D2');
  b.poly(pn('D6'), p(32, 35), p(32, 26), b.pin(r9, '1')).poly(b.pin(r9, '2'), b.pin(led2, 'A')).gndRight(b.pin(led2, 'K'), 1);
  // Gate driver: inputs from D9 / D10, outputs through 10 ohm to the gates.
  const u2 = b.add('x:tc4427', 40, 38, 0, {}, 'U2');
  b.poly(pn('D9'), p(32, 38), p(32, 37), b.pin(u2, 'INA')).poly(pn('D10'), b.pin(u2, 'INB')).gndLeft(b.pin(u2, 'GND'), 2);
  const ga = b.add('R', 52, 28, 0, { r: 10 }, 'R1');
  const gb = b.add('R', 52, 48, 0, { r: 10 }, 'R2');
  b.poly(b.pin(u2, 'OUTA'), p(46, 37), p(46, 28), b.pin(ga, '1')).poly(b.pin(u2, 'OUTB'), p(46, 39), p(46, 48), b.pin(gb, '1'));
  b.poly(b.pin(u2, 'VDD'), p(48, 38), p(48, RAIL));
  // Power stage: Q1 on top, Q2 turned over below it so their sources meet in the middle, at ground.
  const q1 = b.add('x:irf540', 62, 28, 0, {}, 'Q1');
  const q2 = b.add('x:irf540', 62, 48, 180, {}, 'Q2', true);
  b.poly(b.pin(ga, '2'), b.pin(q1, 'G')).poly(b.pin(gb, '2'), b.pin(q2, 'G'));
  const r3 = b.add('R', 57, 25, 90, { r: 10e3 }, 'R3');
  const r4 = b.add('R', 57, 51, 90, { r: 10e3 }, 'R4');
  b.poly(p(57, 28), b.pin(r3, '2')).gndUp(b.pin(r3, '1'), 2);
  b.poly(p(57, 48), b.pin(r4, '1')).gnd(b.pin(r4, '2'));
  b.poly(b.pin(q1, 'S'), p(66, 30), p(66, 46), b.pin(q2, 'S')).gnd(p(66, 38), 2);
  // Transformer: drains to the two ends of the primary, the centre tap to the rail.
  const t1 = b.add('x:trafo-ultrasonic-1-5', 82, 38, 0, {}, 'T1');
  b.poly(b.pin(q1, 'D'), p(78, 26), p(78, 35), b.pin(t1, 'P1'));
  b.poly(b.pin(q2, 'D'), p(78, 50), p(78, 41), b.pin(t1, 'P2'));
  b.poly(b.pin(t1, 'PC'), p(74, 38), p(74, RAIL));
  // Transducer with its tuning inductor, and a reference to ground for the isolated secondary.
  const l1 = b.add('L', 94, 38, 90, { l: 7.2e-3 }, 'L1');
  const tr = b.add('x:langevin-28k-50w', 102, 38, 90, {}, 'TR1');
  b.poly(b.pin(t1, 'S1'), b.pin(l1, '1'), b.pin(tr, '+')).poly(b.pin(t1, 'S2'), b.pin(l1, '2'), b.pin(tr, '-'));
  const rg = b.add('R', 90, 43, 90, { r: 1e6 }, 'R5');
  b.poly(p(90, 40), b.pin(rg, '1')).gnd(b.pin(rg, '2'));
  b.probe(b.pin(q1, 'D'), 'Q1 drain', 0, -2).probe(p(88, 36), 'drive', 0, -2);
  return b.doc;
}
