import type { Key } from '../i18n';
import type { PicChipId } from '../../core/mcu/pic16';
import { hexFor, sketchById } from './arduinoExamples';
import { assembleCached, picProgramById } from './picExamples';
import { Builder } from './builder';
import { amRadio, arduinoBluetooth, arduinoSensorStation, fmTransmitter, inverter, mainsLamps, ultrasonicDriver } from './projectExamples';
import { carExample, carPairExample, clockExample, esp01Example, nrf24Example, remoteExample } from './commExamples';
import { PART_DEFS, pinPositions, type Doc, type PartType, type Pt } from './model';

const p = (x: number, y: number): Pt => ({ x, y });

/** Pulse source -> R -> C to ground, with probes on input and output. */
function rcLowPass(): Doc {
  return new Builder()
    .put('VPULSE', 4, 8, 0, { low: 0, high: 5, freq: 200, duty: 0.5 })
    .put('R', 10, 4)
    .put('C', 16, 8, 90, { c: 1e-6 })
    .put('GND', 10, 14)
    .put('PROBE', 6, 2)
    .put('PROBE', 16, 2)
    .wire(p(4, 6), p(4, 4))
    .wire(p(4, 4), p(8, 4))
    .wire(p(12, 4), p(16, 4))
    .wire(p(16, 4), p(16, 6))
    .wire(p(16, 10), p(16, 12))
    .wire(p(4, 10), p(4, 12))
    .wire(p(4, 12), p(16, 12))
    .wire(p(10, 12), p(10, 14))
    .wire(p(6, 2), p(6, 4))
    .wire(p(16, 2), p(16, 4)).doc;
}

/** 5 V -> 330 R -> LED -> GND with a switch. */
function ledCircuit(): Doc {
  return new Builder()
    .put('VDC', 4, 8, 0, { v: 5 })
    .put('SW', 10, 4, 0, { closed: true })
    .put('R', 16, 4, 0, { r: 330 })
    .put('LED', 20, 8, 90)
    .put('GND', 12, 14)
    .wire(p(4, 6), p(4, 4))
    .wire(p(4, 4), p(8, 4))
    .wire(p(12, 4), p(14, 4))
    .wire(p(18, 4), p(20, 4))
    .wire(p(20, 4), p(20, 6))
    .wire(p(20, 10), p(20, 12))
    .wire(p(4, 10), p(4, 12))
    .wire(p(4, 12), p(20, 12))
    .wire(p(12, 12), p(12, 14)).doc;
}

/** AC source -> diode -> load resistor, a half-wave rectifier. */
function rectifier(): Doc {
  return new Builder()
    .put('VAC', 4, 8, 0, { amp: 5, freq: 50 })
    .put('D', 10, 4)
    .put('R', 16, 8, 90, { r: 1000 })
    .put('GND', 10, 14)
    .put('PROBE', 6, 2)
    .put('PROBE', 16, 2)
    .wire(p(4, 6), p(4, 4))
    .wire(p(4, 4), p(8, 4))
    .wire(p(12, 4), p(16, 4))
    .wire(p(16, 4), p(16, 6))
    .wire(p(16, 10), p(16, 12))
    .wire(p(4, 10), p(4, 12))
    .wire(p(4, 12), p(16, 12))
    .wire(p(10, 12), p(10, 14))
    .wire(p(6, 2), p(6, 4))
    .wire(p(16, 2), p(16, 4)).doc;
}

/** Series RLC driven by a pulse; f0 = 1/(2 pi sqrt(LC)) is about 1.6 kHz. */
function rlc(): Doc {
  return new Builder()
    .put('VPULSE', 4, 8, 0, { low: 0, high: 5, freq: 200, duty: 0.5 })
    .put('R', 10, 4, 0, { r: 20 })
    .put('L', 16, 4, 0, { l: 10e-3 })
    .put('C', 22, 8, 90, { c: 1e-6 })
    .put('GND', 12, 14)
    .put('PROBE', 22, 2)
    .wire(p(4, 6), p(4, 4))
    .wire(p(4, 4), p(8, 4))
    .wire(p(12, 4), p(14, 4))
    .wire(p(18, 4), p(22, 4))
    .wire(p(22, 4), p(22, 6))
    .wire(p(22, 10), p(22, 12))
    .wire(p(4, 10), p(4, 12))
    .wire(p(4, 12), p(22, 12))
    .wire(p(12, 12), p(12, 14))
    .wire(p(22, 2), p(22, 4)).doc;
}

/** 100 Hz pulse drives an NPN through 10 k; the transistor switches a 330 ohm + LED load from 5 V. */
function bjtSwitch(): Doc {
  return new Builder()
    .put('VDC', 2, 8, 0, { v: 5 })
    .put('VPULSE', 6, 12, 0, { low: 0, high: 5, freq: 100, duty: 0.5 })
    .put('R', 10, 10, 0, { r: 10e3 })
    .put('R', 12, 4, 0, { r: 330 })
    .put('LED', 18, 6, 90)
    .put('QNPN', 16, 10)
    .put('GND', 10, 16)
    .put('PROBE', 14, 8)
    .put('PROBE', 22, 8)
    .wire(p(2, 6), p(2, 4))
    .wire(p(2, 4), p(10, 4))
    .wire(p(14, 4), p(18, 4))
    .wire(p(6, 10), p(8, 10))
    .wire(p(12, 10), p(14, 10))
    .wire(p(2, 10), p(2, 16))
    .wire(p(6, 14), p(6, 16))
    .wire(p(2, 16), p(18, 16))
    .wire(p(18, 12), p(18, 16))
    .wire(p(14, 8), p(14, 10))
    .wire(p(18, 8), p(22, 8)).doc;
}

/** Gain of -Rf/Rin = -10: a 0.5 V, 1 kHz input becomes a 5 V inverted output. */
function invertingAmp(): Doc {
  return new Builder()
    .put('VAC', 4, 10, 0, { offset: 0, amp: 0.5, freq: 1000 })
    .put('R', 8, 8, 0, { r: 1000 })
    .put('R', 16, 3, 0, { r: 10e3 })
    .put('OPAMP', 16, 8)
    .put('GND', 13, 14)
    .put('PROBE', 6, 6)
    .put('PROBE', 24, 8)
    .wire(p(4, 8), p(6, 8))
    .wire(p(10, 8), p(13, 8))
    .wire(p(13, 8), p(13, 7))
    .wire(p(13, 7), p(13, 3))
    .wire(p(13, 3), p(14, 3))
    .wire(p(18, 3), p(22, 3))
    .wire(p(22, 3), p(22, 8))
    .wire(p(19, 8), p(24, 8))
    .wire(p(13, 9), p(13, 14))
    .wire(p(4, 12), p(4, 14))
    .wire(p(4, 14), p(13, 14))
    .wire(p(6, 6), p(6, 8)).doc;
}

// ---- Arduino examples -------------------------------------------------------------------
// Positions come from the part definition, so the same builders serve every board.

function sketchParams(id: string, type: PartType): Record<string, string> {
  const s = sketchById(id);
  return { source: s.source, hex: hexFor(s, PART_DEFS[type].mcu!.engine) };
}

/** Grid position of a named pin of a board placed at (bx, by). */
function pinAt(type: PartType, bx: number, by: number, name: string): Pt {
  const def = PART_DEFS[type];
  // The Pico has several GND pins; the last one sits on the right edge, away from the signal pins used here.
  const i = name === 'GND' ? def.pinNames.lastIndexOf(name) : def.pinNames.indexOf(name);
  const p = def.pins[i];
  return { x: bx + p.x, y: by + p.y };
}

/** Arduino numbers pins D13, the Pico GP13: the sketches use the same numbers on both. */
const isPico = (type: PartType): boolean => type === 'PICO' || type === 'PICO_W';
const dpin = (type: PartType, n: number): string => (isPico(type) ? `GP${n}` : `D${n}`);
const analogPin = (type: PartType): string => (isPico(type) ? 'GP26' : 'A0');
const supplyPin = (type: PartType): string => (isPico(type) ? '3V3' : '5V');

/**
 * Board, a ground rail under it and a probe-able LED branch (330 ohm + LED) on a pin of the left edge.
 * Returns the builder and where the rail and the board's GND pin are, so callers can extend the circuit.
 */
function boardBase(type: PartType, bx: number, by: number, program: Record<string, string>, ledPin: string, groundName: string) {
  const def = PART_DEFS[type];
  const pin = pinAt(type, bx, by, ledPin);
  const s = pin.x > bx ? 1 : -1; // which edge of the board the LED branch hangs from
  // Ground comes from the opposite edge when the board has a ground pin there; the lowest such pin is the last.
  const grounds = def.pinNames.flatMap((n, i) => (n === groundName ? [i] : []));
  const opposite = grounds.filter((i) => Math.sign(def.pins[i].x) === -s);
  const gi = (opposite.length ? opposite : grounds).slice(-1)[0];
  const gnd = { x: bx + def.pins[gi].x, y: by + def.pins[gi].y };
  const sg = Math.sign(def.pins[gi].x);
  const railY = by + Math.max(...def.pins.map((q) => q.y)) + 8;
  const ledK = { x: pin.x + 12 * s, y: pin.y };
  const b = new Builder()
    .put(type, bx, by, 0, program)
    .put('R', pin.x + 6 * s, pin.y, 0, { r: 330 })
    .put('LED', pin.x + 10 * s, pin.y, s > 0 ? 0 : 180)
    .put('GND', ledK.x, railY)
    .put('PROBE', pin.x + 2 * s, pin.y - 2)
    .wire(p(pin.x + 4 * s, pin.y), p(pin.x, pin.y))
    .wire(p(ledK.x, ledK.y), p(ledK.x, railY))
    .wire(p(pin.x + 2 * s, pin.y - 2), p(pin.x + 2 * s, pin.y))
    .wire(p(gnd.x, gnd.y), p(gnd.x + 4 * sg, gnd.y))
    .wire(p(gnd.x + 4 * sg, gnd.y), p(gnd.x + 4 * sg, railY))
    .wire(p(gnd.x + 4 * sg, railY), p(ledK.x, railY));
  return { b, pin, gnd, railY, ledK, s, sg };
}

const arduinoBase = (type: PartType, bx: number, by: number, sketch: string, ledPin: string) =>
  boardBase(type, bx, by, sketchParams(sketch, type), ledPin, 'GND');

const UNO: PartType = 'ARDUINO_UNO';
const MEGA: PartType = 'ARDUINO_MEGA';
const PICO: PartType = 'PICO';

const arduinoBlink = (): Doc => arduinoBase(UNO, 10, 10, 'blink', 'D13').b.doc;
const arduinoFade = (): Doc => arduinoBase(UNO, 10, 10, 'fade', 'D9').b.doc;
const arduinoSerial = (): Doc => arduinoBase(UNO, 10, 10, 'serial', 'D13').b.doc;

/**
 * The serial-control sketch: the D13 LED and, on D7, a relay module that switches a 12 V lamp. Commands typed in the
 * serial monitor (LED ON, RELAY OFF ...) drive them. The module sits left of the board turned round, so its inputs face
 * the board; it has its own 5 V supply and the 12 V source feeds the contacts.
 */
function arduinoSerialControl(): Doc {
  const { b } = arduinoBase(UNO, 10, 10, 'serial-control', 'D13');
  const relay = 'x:relay-module-1ch' as PartType;
  const d7 = pinAt(UNO, 10, 10, 'D7');
  b.put(relay, d7.x - 28, d7.y - 12, 180);
  const mod = b.doc.parts[b.doc.parts.length - 1];
  const names = PART_DEFS[relay].pinNames;
  const at = (n: string): Pt => pinPositions(mod)[names.indexOf(n)];
  const IN = at('IN');
  const dcp = at('DC+');
  const dcm = at('DC-');
  const com = at('COM');
  const no = at('NO');
  // Control: D7 runs left, then up to the IN pin.
  const xin = Math.max(IN.x, dcp.x, dcm.x) + 9;
  b.wire(p(d7.x, d7.y), p(xin, d7.y)).wire(p(xin, d7.y), p(xin, IN.y)).wire(p(xin, IN.y), p(IN.x, IN.y));
  // Coil supply: a 5 V source below the pins, the DC- pin to the common ground.
  const x1 = dcp.x + 3;
  const x2 = dcp.x + 6;
  const gy = dcp.y + 8;
  b.put('VDC', x1, dcp.y + 4, 0, { v: 5 }).put('GND', x1, gy);
  b.wire(p(dcp.x, dcp.y), p(x1, dcp.y)).wire(p(x1, dcp.y), p(x1, dcp.y + 2));
  b.wire(p(x1, dcp.y + 6), p(x1, gy));
  b.wire(p(dcm.x, dcm.y), p(x2, dcm.y)).wire(p(x2, dcm.y), p(x2, gy)).wire(p(x2, gy), p(x1, gy));
  // Contacts: 12 V on COM, a 100 ohm lamp from NO to ground.
  const y1 = com.x - 3;
  const y2 = com.x - 7;
  b.put('VDC', y1, com.y + 4, 0, { v: 12 }).put('GND', y1, com.y + 8);
  b.wire(p(com.x, com.y), p(y1, com.y)).wire(p(y1, com.y), p(y1, com.y + 2));
  b.wire(p(y1, com.y + 6), p(y1, com.y + 8));
  b.put('R', y2, no.y + 2, 90, { r: 100, prated: 2 }).put('GND', y2, no.y + 6).put('PROBE', y2 - 2, no.y - 2);
  b.wire(p(no.x, no.y), p(y2, no.y)).wire(p(y2, no.y + 4), p(y2, no.y + 6));
  b.wire(p(y2 - 2, no.y - 2), p(y2 - 2, no.y)).wire(p(y2 - 2, no.y), p(y2, no.y));
  return b.doc;
}

/**
 * The Nextion demo: the board's serial port (D1 = TX, D0 = RX) is wired to a virtual Nextion display with its own 5 V
 * supply. The display shows the LED state and a counter; its buttons toggle the D13 LED and count.
 */
function arduinoNextion(): Doc {
  const { b } = arduinoBase(UNO, 10, 10, 'nextion-demo', 'D13');
  const nx = 'x:nextion-display' as PartType;
  const d0 = pinAt(UNO, 10, 10, 'D0');
  const d1 = pinAt(UNO, 10, 10, 'D1');
  b.put(nx, d0.x - 34, d0.y + 8, 180);
  const mod = b.doc.parts[b.doc.parts.length - 1];
  const names = PART_DEFS[nx].pinNames;
  const at = (n: string): Pt => pinPositions(mod)[names.indexOf(n)];
  const rx = at('RX');
  const tx = at('TX');
  const vcc = at('5V');
  const gnd = at('GND');
  // Serial: the board's TX (D1) goes to the display's RX, the display's TX to the board's RX (D0).
  const xa = rx.x + 4;
  const xb = rx.x + 7;
  b.wire(p(d1.x, d1.y), p(xa, d1.y)).wire(p(xa, d1.y), p(xa, rx.y)).wire(p(xa, rx.y), p(rx.x, rx.y));
  b.wire(p(d0.x, d0.y), p(xb, d0.y)).wire(p(xb, d0.y), p(xb, tx.y)).wire(p(xb, tx.y), p(tx.x, tx.y));
  // Supply: 5 V source under the 5V pin, ground at the GND pin.
  const x5 = vcc.x + 10;
  b.put('VDC', x5, vcc.y + 4, 0, { v: 5 }).put('GND', x5, vcc.y + 8);
  b.wire(p(vcc.x, vcc.y), p(x5, vcc.y)).wire(p(x5, vcc.y), p(x5, vcc.y + 2)).wire(p(x5, vcc.y + 6), p(x5, vcc.y + 8));
  b.put('GND', gnd.x + 3, gnd.y).wire(p(gnd.x, gnd.y), p(gnd.x + 3, gnd.y));
  return b.doc;
}

/** A switch from D2 to GND; the sketch lights the D13 LED while the switch is closed. */
function arduinoButton(type: PartType = UNO, bx = 10, by = 10): Doc {
  const { b, ledK, railY } = arduinoBase(type, bx, by, 'button', dpin(type, 13));
  const d2 = pinAt(type, bx, by, dpin(type, 2));
  return b
    .put('SW', d2.x - 4, d2.y, 0, { closed: false })
    .wire(p(d2.x - 2, d2.y), p(d2.x, d2.y))
    .wire(p(d2.x - 6, d2.y), p(ledK.x - 3, d2.y))
    .wire(p(ledK.x - 3, d2.y), p(ledK.x - 3, railY))
    .wire(p(ledK.x - 3, railY), p(ledK.x, railY)).doc;
}

/** A0 reads a 10 k / 10 k divider from the 5 V pin (2.5 V); the sketch mirrors it as PWM on D9. */
function arduinoAnalog(type: PartType = UNO, bx = 10, by = 10): Doc {
  const { b, gnd } = arduinoBase(type, bx, by, 'analog', dpin(type, 9));
  const a0 = pinAt(type, bx, by, analogPin(type));
  const v5 = pinAt(type, bx, by, supplyPin(type));
  const x = a0.x + 4;
  const top = a0.y - 4;
  return b
    .put('R', x, a0.y - 2, 90, { r: 10e3 }) // pins (x, a0.y - 4) and (x, a0.y)
    .put('R', x, a0.y + 2, 90, { r: 10e3 }) // pins (x, a0.y) and (x, a0.y + 4)
    .put('PROBE', x + 2, a0.y)
    .wire(p(a0.x, a0.y), p(x + 2, a0.y))
    .wire(p(x, top), p(x + 4, top))
    .wire(p(x + 4, top), p(x + 4, v5.y))
    .wire(p(x + 4, v5.y), p(v5.x, v5.y))
    .wire(p(x, a0.y + 4), p(x, gnd.y))
    .wire(p(x, gnd.y), p(gnd.x + 4, gnd.y)).doc;
}

const picoBlink = (): Doc => arduinoBase(PICO, 10, 14, 'blink', 'GP13').b.doc;
const picoSerial = (): Doc => arduinoBase(PICO, 10, 14, 'serial', 'GP13').b.doc;
const picoFade = (): Doc => arduinoBase(PICO, 10, 14, 'fade', 'GP9').b.doc;

const megaBlink = (): Doc => arduinoBase(MEGA, 10, 22, 'blink', 'D13').b.doc;
const megaSerial = (): Doc => arduinoBase(MEGA, 10, 22, 'serial', 'D13').b.doc;

// ---- PIC examples -----------------------------------------------------------------------

function picParams(chip: PicChipId, id: string): Record<string, string> {
  const prog = picProgramById(chip, id);
  return { source: prog.source, hex: assembleCached(chip, prog.source).hex };
}

const P877: PartType = 'PIC16F877A';

const pic877Blink = (): Doc => boardBase(P877, 20, 14, picParams('PIC16F877A', 'blink'), 'RB0', 'VSS').b.doc;
const pic877Serial = (): Doc => boardBase(P877, 20, 14, picParams('PIC16F877A', 'serial'), 'RB0', 'VSS').b.doc;
const pic628Blink = (): Doc => boardBase('PIC16F628A', 20, 10, picParams('PIC16F628A', 'blink'), 'RB4', 'VSS').b.doc;
const pic84Blink = (): Doc => boardBase('PIC16F84A', 20, 10, picParams('PIC16F84A', 'blink'), 'RB4', 'VSS').b.doc;

/** A switch from RB4 (weak pull-up) to ground; the program lights the RD0 LED while it is closed. */
function pic877Button(): Doc {
  const bx = 20;
  const by = 14;
  const { b, railY } = boardBase(P877, bx, by, picParams('PIC16F877A', 'button'), 'RD0', 'VSS');
  const rb4 = pinAt(P877, bx, by, 'RB4');
  return b
    .put('SW', rb4.x + 4, rb4.y, 0, { closed: false })
    .wire(p(rb4.x, rb4.y), p(rb4.x + 2, rb4.y))
    .wire(p(rb4.x + 6, rb4.y), p(rb4.x + 6, railY))
    .wire(p(rb4.x + 6, railY), p(rb4.x + 4, railY)).doc;
}

/** A 10 k / 10 k divider from a 5 V source feeds AN0; the program mirrors it as PWM on RC2 (the LED). */
function pic877Adc(): Doc {
  const bx = 20;
  const by = 14;
  const { b, ledK, railY } = boardBase(P877, bx, by, picParams('PIC16F877A', 'adc-pwm'), 'RC2', 'VSS');
  const ra0 = pinAt(P877, bx, by, 'RA0');
  const nx = ra0.x - 4; // divider column
  const vx = ra0.x - 16; // 5 V source column
  return b
    .put('R', nx, ra0.y - 2, 90, { r: 10e3 })
    .put('R', nx, ra0.y + 2, 90, { r: 10e3 })
    .put('VDC', vx, ra0.y - 2, 0, { v: 5 }) // + at (vx, ra0.y - 4), - at (vx, ra0.y)
    .put('PROBE', nx + 2, ra0.y - 2)
    .wire(p(ra0.x, ra0.y), p(nx, ra0.y))
    .wire(p(vx, ra0.y - 4), p(nx, ra0.y - 4))
    .wire(p(nx + 2, ra0.y - 2), p(nx + 2, ra0.y))
    .wire(p(nx, ra0.y + 4), p(vx, ra0.y + 4))
    .wire(p(vx, ra0.y), p(vx, railY))
    .wire(p(ledK.x, railY), p(vx, railY)).doc;
}

export interface Example {
  id: string;
  label: Key;
  build: () => Doc;
  /** Suggested simulation time step in seconds. */
  dt: number;
  /** Suggested scope window in seconds (default: 1000 steps). */
  window?: number;
  /** Suggested solver steps per animation frame. */
  steps?: number;
}

export const EXAMPLES: Example[] = [
  { id: 'rc', label: 'ex.rc', build: rcLowPass, dt: 10e-6 },
  { id: 'led', label: 'ex.led', build: ledCircuit, dt: 10e-6 },
  { id: 'rectifier', label: 'ex.rectifier', build: rectifier, dt: 50e-6 },
  { id: 'rlc', label: 'ex.rlc', build: rlc, dt: 5e-6 },
  { id: 'bjt', label: 'ex.bjt', build: bjtSwitch, dt: 20e-6 },
  { id: 'opamp', label: 'ex.opamp', build: invertingAmp, dt: 5e-6 },
  { id: 'inverter', label: 'ex.inverter', build: inverter, dt: 40e-6, window: 0.06, steps: 100 },
  { id: 'mains-lamps', label: 'ex.mains', build: mainsLamps, dt: 100e-6, window: 0.06, steps: 100 },
  { id: 'fm-tx', label: 'ex.fmtx', build: fmTransmitter, dt: 0.2e-9, window: 0.4e-6, steps: 400 },
  { id: 'am-radio', label: 'ex.amradio', build: amRadio, dt: 100e-9, window: 4e-3, steps: 400 },
  { id: 'us-driver', label: 'exa.ultrasonic', build: ultrasonicDriver, dt: 1e-6, window: 0.06, steps: 100 },
  { id: 'ino-bluetooth', label: 'exa.bluetooth', build: arduinoBluetooth, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-clock', label: 'exa.clock', build: clockExample, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-car', label: 'exa.car', build: carExample, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-remote', label: 'exa.remote', build: remoteExample, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-car-pair', label: 'exa.carPair', build: carPairExample, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-nrf24', label: 'exa.nrf24', build: nrf24Example, dt: 100e-6, window: 0.02, steps: 100 },
  { id: 'ino-esp01', label: 'exa.esp01', build: esp01Example, dt: 100e-6, window: 0.02, steps: 100 },
  { id: 'ino-sensors', label: 'exa.sensors', build: arduinoSensorStation, dt: 100e-6, window: 4, steps: 200 },
  { id: 'ino-blink', label: 'exa.blink', build: arduinoBlink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-fade', label: 'exa.fade', build: arduinoFade, dt: 50e-6, window: 0.02, steps: 200 },
  { id: 'ino-analog', label: 'exa.analog', build: () => arduinoAnalog(), dt: 50e-6, window: 0.02, steps: 200 },
  { id: 'ino-serial', label: 'exa.serial', build: arduinoSerial, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-serial-control', label: 'exa.serialControl', build: arduinoSerialControl, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-nextion', label: 'exa.nextion', build: arduinoNextion, dt: 100e-6, window: 2, steps: 200 },
  { id: 'ino-button', label: 'exa.button', build: () => arduinoButton(), dt: 100e-6, window: 1, steps: 200 },
  { id: 'pico-blink', label: 'exp.blink', build: picoBlink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'pico-serial', label: 'exp.serial', build: picoSerial, dt: 100e-6, window: 2, steps: 200 },
  { id: 'pico-button', label: 'exp.button', build: () => arduinoButton(PICO, 10, 14), dt: 100e-6, window: 1, steps: 200 },
  { id: 'pico-analog', label: 'exp.analog', build: () => arduinoAnalog(PICO, 10, 14), dt: 50e-6, window: 0.02, steps: 200 },
  { id: 'pico-fade', label: 'exp.fade', build: picoFade, dt: 50e-6, window: 0.02, steps: 200 },
  { id: 'pic877-blink', label: 'exi.blink877', build: pic877Blink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'pic877-button', label: 'exi.button877', build: pic877Button, dt: 100e-6, window: 1, steps: 200 },
  { id: 'pic877-adc', label: 'exi.adc877', build: pic877Adc, dt: 50e-6, window: 0.02, steps: 200 },
  { id: 'pic877-serial', label: 'exi.serial877', build: pic877Serial, dt: 100e-6, window: 2, steps: 200 },
  { id: 'pic628-blink', label: 'exi.blink628', build: pic628Blink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'pic84-blink', label: 'exi.blink84', build: pic84Blink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'mega-blink', label: 'exm.blink', build: megaBlink, dt: 100e-6, window: 2, steps: 200 },
  { id: 'mega-serial', label: 'exm.serial', build: megaSerial, dt: 100e-6, window: 2, steps: 200 },
  { id: 'mega-button', label: 'exm.button', build: () => arduinoButton(MEGA, 10, 22), dt: 100e-6, window: 1, steps: 200 },
  { id: 'mega-analog', label: 'exm.analog', build: () => arduinoAnalog(MEGA, 10, 22), dt: 50e-6, window: 0.02, steps: 200 },
];
