// Development board catalog. Every board points at an entry in mcus.ts; the board adds
// the clock, logic level and form factor that the schematic symbol and footprint need.

import { mcuById, type SimLevel } from './mcus';

export type BoardMaker = 'Arduino' | 'Raspberry Pi' | 'Third-party';
export type BoardKind = 'mcu-board' | 'sbc';

export interface Board {
  id: string;
  name: string;
  maker: BoardMaker;
  mcu: string;
  /** Clock the board actually runs the MCU at, in MHz. */
  clockMHz: number;
  /** I/O logic level in volts. */
  logicV: number;
  official: boolean;
  kind: BoardKind;
  formFactor: string;
  /** Hardware that the emulator does not model, or other caveats shown in the library panel. */
  note?: string;
  /** Overrides the MCU's simulation level when the board has extra hardware in the way. */
  sim?: SimLevel;
}

const board = (
  id: string,
  name: string,
  maker: BoardMaker,
  mcu: string,
  clockMHz: number,
  logicV: number,
  formFactor: string,
  extra: Partial<Pick<Board, 'official' | 'kind' | 'note' | 'sim'>> = {},
): Board => ({
  id,
  name,
  maker,
  mcu,
  clockMHz,
  logicV,
  formFactor,
  official: extra.official ?? maker !== 'Third-party',
  kind: extra.kind ?? 'mcu-board',
  note: extra.note,
  sim: extra.sim,
});

const AVR_BOARDS: Board[] = [
  board('arduino-uno-r3', 'Arduino UNO R3', 'Arduino', 'ATmega328P', 16, 5, 'UNO'),
  board('arduino-uno-mini', 'Arduino UNO Mini', 'Arduino', 'ATmega328P', 16, 5, 'DIP-like mini'),
  board('arduino-duemilanove', 'Arduino Duemilanove', 'Arduino', 'ATmega328P', 16, 5, 'UNO'),
  board('arduino-nano', 'Arduino Nano', 'Arduino', 'ATmega328P', 16, 5, 'Nano'),
  board('arduino-pro-mini-5v', 'Arduino Pro Mini 5V/16MHz', 'Arduino', 'ATmega328P', 16, 5, 'Pro Mini'),
  board('arduino-pro-mini-3v3', 'Arduino Pro Mini 3.3V/8MHz', 'Arduino', 'ATmega328P', 8, 3.3, 'Pro Mini'),
  board('arduino-mini', 'Arduino Mini', 'Arduino', 'ATmega328P', 16, 5, 'Mini'),
  board('arduino-mega-2560-r3', 'Arduino Mega 2560 Rev3', 'Arduino', 'ATmega2560', 16, 5, 'Mega'),
  board('arduino-mega-adk', 'Arduino Mega ADK', 'Arduino', 'ATmega2560', 16, 5, 'Mega'),
  board('arduino-leonardo', 'Arduino Leonardo', 'Arduino', 'ATmega32U4', 16, 5, 'UNO'),
  board('arduino-micro', 'Arduino Micro', 'Arduino', 'ATmega32U4', 16, 5, 'Micro'),
  board('arduino-esplora', 'Arduino Esplora', 'Arduino', 'ATmega32U4', 16, 5, 'Esplora'),
  board('arduino-yun-rev2', 'Arduino Yún Rev2', 'Arduino', 'ATmega32U4', 16, 5, 'Yún', {
    note: 'The on-board Linux processor is not emulated; only the AVR side runs.',
  }),
  board('arduino-uno-wifi-rev2', 'Arduino UNO WiFi Rev2', 'Arduino', 'ATmega4809', 16, 5, 'UNO', {
    note: 'The u-blox NINA WiFi module is not emulated.',
  }),
  board('arduino-nano-every', 'Arduino Nano Every', 'Arduino', 'ATmega4809', 20, 5, 'Nano'),
  board('arduino-lilypad', 'Arduino LilyPad', 'Arduino', 'ATmega328P', 8, 3.3, 'LilyPad'),
  // Popular third-party and clone boards.
  board('mega-2560-pro', 'Mega 2560 Pro (CH340G)', 'Third-party', 'ATmega2560', 16, 5, 'Mega Pro Mini', {
    note: 'Compact clone with a CH340G USB-serial chip; same pin names as the Mega 2560.',
  }),
  board('mega-2560-pro-embed', 'Mega 2560 Pro Embed', 'Third-party', 'ATmega2560', 16, 5, 'Mega Pro Embed'),
  board('nano-clone-ch340', 'Nano (CH340 clone)', 'Third-party', 'ATmega328P', 16, 5, 'Nano'),
  board('sparkfun-pro-micro-5v', 'Pro Micro 5V/16MHz', 'Third-party', 'ATmega32U4', 16, 5, 'Pro Micro'),
  board('sparkfun-pro-micro-3v3', 'Pro Micro 3.3V/8MHz', 'Third-party', 'ATmega32U4', 8, 3.3, 'Pro Micro'),
  board('digispark-attiny85', 'Digispark ATtiny85', 'Third-party', 'ATtiny85', 16.5, 5, 'Digispark'),
  board('attiny85-dip8', 'ATtiny85 (bare DIP-8)', 'Third-party', 'ATtiny85', 8, 5, 'DIP-8'),
  board('mightycore-1284p', 'Mighty 1284P', 'Third-party', 'ATmega1284P', 16, 5, 'DIP-40'),
];

const ARM_ARDUINO: Board[] = [
  board('arduino-uno-r4-minima', 'Arduino UNO R4 Minima', 'Arduino', 'RA4M1', 48, 5, 'UNO'),
  board('arduino-uno-r4-wifi', 'Arduino UNO R4 WiFi', 'Arduino', 'RA4M1', 48, 5, 'UNO', {
    note: 'The ESP32-S3 WiFi/BLE module and LED matrix are not emulated.',
  }),
  board('arduino-nano-r4', 'Arduino Nano R4', 'Arduino', 'RA4M1', 48, 5, 'Nano'),
  board('arduino-due', 'Arduino Due', 'Arduino', 'SAM3X8E', 84, 3.3, 'Mega'),
  board('arduino-zero', 'Arduino Zero', 'Arduino', 'SAMD21G18', 48, 3.3, 'UNO'),
  board('arduino-mkr-zero', 'Arduino MKR ZERO', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-1000', 'Arduino MKR WiFi 1000', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-wifi-1010', 'Arduino MKR WiFi 1010', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-wan-1310', 'Arduino MKR WAN 1310', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-gsm-1400', 'Arduino MKR GSM 1400', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-nb-1500', 'Arduino MKR NB 1500', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR'),
  board('arduino-mkr-vidor-4000', 'Arduino MKR Vidor 4000', 'Arduino', 'SAMD21G18', 48, 3.3, 'MKR', {
    note: 'The on-board FPGA is not emulated.',
  }),
  board('arduino-nano-33-iot', 'Arduino Nano 33 IoT', 'Arduino', 'SAMD21G18', 48, 3.3, 'Nano'),
  board('arduino-nano-33-ble', 'Arduino Nano 33 BLE', 'Arduino', 'nRF52840', 64, 3.3, 'Nano'),
  board('arduino-nano-33-ble-sense-rev2', 'Arduino Nano 33 BLE Sense Rev2', 'Arduino', 'nRF52840', 64, 3.3, 'Nano', {
    note: 'On-board IMU, environmental and light sensors are not emulated.',
  }),
  board('arduino-nano-rp2040-connect', 'Arduino Nano RP2040 Connect', 'Arduino', 'RP2040', 133, 3.3, 'Nano', {
    note: 'The u-blox NINA WiFi/BLE module and IMU are not emulated.',
  }),
  board('arduino-nano-esp32', 'Arduino Nano ESP32', 'Arduino', 'ESP32-S3', 240, 3.3, 'Nano'),
  board('arduino-nano-matter', 'Arduino Nano Matter', 'Arduino', 'MGM240S', 78, 3.3, 'Nano'),
  board('arduino-portenta-h7', 'Arduino Portenta H7', 'Arduino', 'STM32H747', 480, 3.3, 'Portenta'),
  board('arduino-portenta-c33', 'Arduino Portenta C33', 'Arduino', 'RA6M5', 200, 3.3, 'Portenta'),
  board('arduino-giga-r1-wifi', 'Arduino GIGA R1 WiFi', 'Arduino', 'STM32H747', 480, 3.3, 'Mega'),
  board('arduino-opta', 'Arduino Opta', 'Arduino', 'STM32H747', 480, 3.3, 'DIN rail'),
  board('arduino-uno-q', 'Arduino UNO Q', 'Arduino', 'STM32U585', 160, 3.3, 'UNO', {
    note: 'The Qualcomm QRB2210 Linux side is not emulated; only the STM32 MCU is modelled.',
  }),
];

const RASPBERRY: Board[] = [
  board('rpi-pico', 'Raspberry Pi Pico', 'Raspberry Pi', 'RP2040', 125, 3.3, 'Pico'),
  board('rpi-pico-h', 'Raspberry Pi Pico H', 'Raspberry Pi', 'RP2040', 125, 3.3, 'Pico'),
  board('rpi-pico-w', 'Raspberry Pi Pico W', 'Raspberry Pi', 'RP2040', 125, 3.3, 'Pico', {
    note: 'The CYW43439 WiFi/BLE chip is not emulated. The on-board LED hangs off that chip, not an RP2040 pin.',
  }),
  board('rpi-pico-wh', 'Raspberry Pi Pico WH', 'Raspberry Pi', 'RP2040', 125, 3.3, 'Pico', {
    note: 'The CYW43439 WiFi/BLE chip is not emulated. The on-board LED hangs off that chip, not an RP2040 pin.',
  }),
  board('rpi-pico-2', 'Raspberry Pi Pico 2', 'Raspberry Pi', 'RP2350', 150, 3.3, 'Pico'),
  board('rpi-pico-2-w', 'Raspberry Pi Pico 2 W', 'Raspberry Pi', 'RP2350', 150, 3.3, 'Pico', {
    note: 'The CYW43439 WiFi/BLE chip is not emulated.',
  }),
  board('adafruit-feather-rp2040', 'Adafruit Feather RP2040', 'Third-party', 'RP2040', 125, 3.3, 'Feather'),
  board('seeed-xiao-rp2040', 'Seeed XIAO RP2040', 'Third-party', 'RP2040', 133, 3.3, 'XIAO'),
  board('waveshare-rp2040-zero', 'Waveshare RP2040-Zero', 'Third-party', 'RP2040', 125, 3.3, 'Zero'),
  board('sparkfun-pro-micro-rp2040', 'SparkFun Pro Micro RP2040', 'Third-party', 'RP2040', 125, 3.3, 'Pro Micro'),
  // Single-board computers run Linux, so only their GPIO header can be wired into a circuit.
  board('rpi-zero-2-w', 'Raspberry Pi Zero 2 W', 'Raspberry Pi', 'BCM2710A1', 1000, 3.3, '40-pin header', {
    kind: 'sbc',
    note: 'Runs Linux: firmware cannot execute. Use it as a GPIO source/sink with scripted pin behaviour.',
  }),
];

export const BOARDS: readonly Board[] = [...AVR_BOARDS, ...ARM_ARDUINO, ...RASPBERRY];

export const boardById = (id: string): Board | undefined => BOARDS.find((b) => b.id === id);

/** Effective simulation level: a board can only run code as far as its MCU can. */
export const boardSimLevel = (b: Board): SimLevel => b.sim ?? mcuById(b.mcu)?.sim ?? 'pinout';
