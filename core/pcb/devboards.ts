// Footprints of real development boards. The pads sit where the header holes of the physical board are and are
// named like the silkscreen on the board, so a shield or a socket made from one of these fits the real thing.
// Dimensions follow the manufacturers' public drawings (to about half a millimetre); check a board against its
// datasheet before sending a design to fabrication.

import type { FootprintDef, PadDef } from './types';

/** A header pin: plated through-hole. It gets wired to its schematic pin by name (see wireFootprint). */
const hdr = (name: string, x: number, y: number, first = false): PadDef => ({ name, x, y, shape: first ? 'rect' : 'round', w: 1.8, h: 1.8, drill: 1.0, pin: null });

const UNO_W = 68.58;
const UNO_H = 53.34;
const MEGA_W = 101.6;

/** Pads from the Eagle-style drawing coordinates (origin lower left, y up) to footprint coordinates (centre, y down). */
const at = (w: number, h: number, name: string, x: number, yUp: number): PadDef => hdr(name, x - w / 2, h / 2 - yUp);

function unoHeaders(w: number, h: number): PadDef[] {
  const p = (name: string, x: number, yUp: number): PadDef => at(w, h, name, x, yUp);
  const pads: PadDef[] = [];
  // Top header, left to right on the board: SCL SDA AREF GND D13..D8, a gap, then D7..D0.
  ['SCL', 'SDA', 'AREF', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'].forEach((n, i) => pads.push(p(n, 20.066 + i * 2.54, 50.8)));
  for (let i = 0; i < 8; i++) pads.push(p(`D${7 - i}`, 46.99 + i * 2.54, 50.8));
  // Bottom: the power header.
  ['NC', 'IOREF', 'RESET', '3V3', '5V', 'GND', 'GND', 'VIN'].forEach((n, i) => pads.push(p(n, 27.94 + i * 2.54, 2.54)));
  return pads;
}

function arduinoUno(): FootprintDef {
  const pads = unoHeaders(UNO_W, UNO_H);
  for (let i = 0; i < 6; i++) pads.push(at(UNO_W, UNO_H, `A${i}`, 50.8 + i * 2.54, 2.54));
  return { id: 'BOARD_UNO', label: 'Arduino UNO R3 (68.6 x 53.3 mm)', pads, body: { w: UNO_W, h: UNO_H } };
}

function arduinoMega(): FootprintDef {
  const pads = unoHeaders(MEGA_W, UNO_H);
  const p = (name: string, x: number, yUp: number): PadDef => at(MEGA_W, UNO_H, name, x, yUp);
  for (let i = 0; i < 8; i++) pads.push(p(`D${14 + i}`, 69.85 + i * 2.54, 50.8));
  for (let i = 0; i < 16; i++) pads.push(p(`A${i}`, 50.8 + i * 2.54 + (i >= 8 ? 2.54 : 0), 2.54));
  // The two long columns at the end of the board: 5V on top, D22..D53 in pairs, GND at the bottom.
  const rows: Array<[string, string]> = [['5V', '5V'], ...Array.from({ length: 16 }, (_, i): [string, string] => [`D${22 + 2 * i}`, `D${23 + 2 * i}`]), ['GND', 'GND']];
  rows.forEach(([l, r], i) => {
    pads.push(p(l, 96.52, 48.26 - i * 2.54));
    pads.push(p(r, 99.06, 48.26 - i * 2.54));
  });
  return { id: 'BOARD_MEGA', label: 'Arduino Mega 2560 R3 (101.6 x 53.3 mm)', pads, body: { w: MEGA_W, h: UNO_H } };
}

function arduinoNano(): FootprintDef {
  const left = ['D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST', 'GND', 'VIN'];
  const right = ['D1', 'D0', 'RST', 'GND', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12'];
  const y0 = -(14 * 2.54) / 2;
  const pads = [...left.map((n, i) => hdr(n, -7.62, y0 + i * 2.54, i === 0)), ...right.map((n, i) => hdr(n, 7.62, y0 + i * 2.54))];
  return { id: 'BOARD_NANO', label: 'Arduino Nano (43.2 x 17.8 mm)', pads, body: { w: 17.78, h: 43.18 } };
}

/** Raspberry Pi Pico and Pico W: 40 pins at 2.54 mm, rows 17.78 mm apart; pin 1 is top left, USB connector up. */
function pico(): FootprintDef {
  const left = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
  const right = ['VBUS', 'VSYS', 'GND', '3V3_EN', '3V3', 'ADC_VREF', 'GP28', 'AGND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'];
  const y0 = -(19 * 2.54) / 2;
  const pads = [...left.map((n, i) => hdr(n, -8.89, y0 + i * 2.54, i === 0)), ...right.map((n, i) => hdr(n, 8.89, y0 + i * 2.54))];
  return { id: 'BOARD_PICO', label: 'Raspberry Pi Pico / Pico W (51 x 21 mm)', pads, body: { w: 21, h: 51 } };
}

export const DEV_BOARD_FOOTPRINTS: FootprintDef[] = [arduinoUno(), arduinoMega(), arduinoNano(), pico()];
