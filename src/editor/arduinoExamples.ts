// Ready-made sketches with their precompiled hex (built by scripts/build-arduino-examples.cjs),
// so the Arduino examples run without any toolchain installed.

import type { Key } from '../i18n';
import analogHex from '../../library/arduino/analog/analog.hex?raw';
import analogMegaHex from '../../library/arduino/analog/analog.mega.hex?raw';
import analogPicoB64 from '../../library/arduino/analog/analog.pico.b64?raw';
import analogIno from '../../library/arduino/analog/analog.ino?raw';
import blinkHex from '../../library/arduino/blink/blink.hex?raw';
import blinkMegaHex from '../../library/arduino/blink/blink.mega.hex?raw';
import blinkPicoB64 from '../../library/arduino/blink/blink.pico.b64?raw';
import blinkIno from '../../library/arduino/blink/blink.ino?raw';
import buttonHex from '../../library/arduino/button/button.hex?raw';
import buttonMegaHex from '../../library/arduino/button/button.mega.hex?raw';
import buttonPicoB64 from '../../library/arduino/button/button.pico.b64?raw';
import buttonIno from '../../library/arduino/button/button.ino?raw';
import fadeHex from '../../library/arduino/fade/fade.hex?raw';
import fadeMegaHex from '../../library/arduino/fade/fade.mega.hex?raw';
import fadePicoB64 from '../../library/arduino/fade/fade.pico.b64?raw';
import fadeIno from '../../library/arduino/fade/fade.ino?raw';
import serialHex from '../../library/arduino/serial/serial.hex?raw';
import serialMegaHex from '../../library/arduino/serial/serial.mega.hex?raw';
import serialPicoB64 from '../../library/arduino/serial/serial.pico.b64?raw';
import serialIno from '../../library/arduino/serial/serial.ino?raw';
import serialControlHex from '../../library/arduino/serial-control/serial-control.hex?raw';
import serialControlMegaHex from '../../library/arduino/serial-control/serial-control.mega.hex?raw';
import serialControlIno from '../../library/arduino/serial-control/serial-control.ino?raw';
import nextionDemoHex from '../../library/arduino/nextion-demo/nextion-demo.hex?raw';
import nextionDemoMegaHex from '../../library/arduino/nextion-demo/nextion-demo.mega.hex?raw';
import nextionDemoIno from '../../library/arduino/nextion-demo/nextion-demo.ino?raw';

import bluetoothHex from '../../library/arduino/bluetooth/bluetooth.hex?raw';
import bluetoothMegaHex from '../../library/arduino/bluetooth/bluetooth.mega.hex?raw';
import bluetoothIno from '../../library/arduino/bluetooth/bluetooth.ino?raw';
import sensorStationHex from '../../library/arduino/sensor-station/sensor-station.hex?raw';
import sensorStationMegaHex from '../../library/arduino/sensor-station/sensor-station.mega.hex?raw';
import sensorStationIno from '../../library/arduino/sensor-station/sensor-station.ino?raw';
import ultrasonicHex from '../../library/arduino/ultrasonic/ultrasonic.hex?raw';
import ultrasonicMegaHex from '../../library/arduino/ultrasonic/ultrasonic.mega.hex?raw';
import ultrasonicIno from '../../library/arduino/ultrasonic/ultrasonic.ino?raw';
import clockHex from '../../library/arduino/clock/clock.hex?raw';
import clockMegaHex from '../../library/arduino/clock/clock.mega.hex?raw';
import clockIno from '../../library/arduino/clock/clock.ino?raw';
import carHex from '../../library/arduino/car/car.hex?raw';
import carMegaHex from '../../library/arduino/car/car.mega.hex?raw';
import carIno from '../../library/arduino/car/car.ino?raw';
import remoteHex from '../../library/arduino/remote/remote.hex?raw';
import remoteMegaHex from '../../library/arduino/remote/remote.mega.hex?raw';
import remoteIno from '../../library/arduino/remote/remote.ino?raw';

export interface Sketch {
  id: string;
  label: Key;
  source: string;
  /** Compiled for the ATmega328P (Uno / Nano). */
  hex: string;
  /** Compiled for the ATmega2560 (Mega). */
  hexMega: string;
  /** Compiled for the RP2040 (Pico): base64 of the flash image; empty when there is no Pico build of the sketch. */
  b64Pico: string;
}

export const SKETCHES: Sketch[] = [
  { id: 'blink', label: 'ino.blink', source: blinkIno, hex: blinkHex, hexMega: blinkMegaHex, b64Pico: blinkPicoB64 },
  { id: 'fade', label: 'ino.fade', source: fadeIno, hex: fadeHex, hexMega: fadeMegaHex, b64Pico: fadePicoB64 },
  { id: 'analog', label: 'ino.analog', source: analogIno, hex: analogHex, hexMega: analogMegaHex, b64Pico: analogPicoB64 },
  { id: 'serial', label: 'ino.serial', source: serialIno, hex: serialHex, hexMega: serialMegaHex, b64Pico: serialPicoB64 },
  { id: 'serial-control', label: 'ino.serialControl', source: serialControlIno, hex: serialControlHex, hexMega: serialControlMegaHex, b64Pico: '' },
  { id: 'nextion-demo', label: 'ino.nextion', source: nextionDemoIno, hex: nextionDemoHex, hexMega: nextionDemoMegaHex, b64Pico: '' },
  { id: 'bluetooth', label: 'ino.bluetooth', source: bluetoothIno, hex: bluetoothHex, hexMega: bluetoothMegaHex, b64Pico: '' },
  { id: 'sensor-station', label: 'ino.sensorStation', source: sensorStationIno, hex: sensorStationHex, hexMega: sensorStationMegaHex, b64Pico: '' },
  { id: 'ultrasonic', label: 'ino.ultrasonic', source: ultrasonicIno, hex: ultrasonicHex, hexMega: ultrasonicMegaHex, b64Pico: '' },
  { id: 'button', label: 'ino.button', source: buttonIno, hex: buttonHex, hexMega: buttonMegaHex, b64Pico: buttonPicoB64 },
  { id: 'clock', label: 'ino.clock', source: clockIno, hex: clockHex, hexMega: clockMegaHex, b64Pico: '' },
  { id: 'car', label: 'ino.car', source: carIno, hex: carHex, hexMega: carMegaHex, b64Pico: '' },
  { id: 'remote', label: 'ino.remote', source: remoteIno, hex: remoteHex, hexMega: remoteMegaHex, b64Pico: '' },
];

export const sketchById = (id: string): Sketch => SKETCHES.find((s) => s.id === id) ?? SKETCHES[0];

/** Whether the sketch has a compiled image for a microcontroller engine. */
export const hasImage = (s: Sketch, engine: string): boolean => hexFor(s, engine) !== '';

/** Which compiled image a microcontroller engine needs. */
export const hexFor = (s: Sketch, engine: string): string => (engine === 'avr2560' ? s.hexMega : engine === 'rp2040' ? s.b64Pico.trim() : s.hex);
