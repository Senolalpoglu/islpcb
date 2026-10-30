// Microcontroller catalog. Specs were compiled by hand and are approximate: the planned
// Microchip DFP / PlatformIO importers should replace them with datasheet-exact values.

export type McuCore =
  | 'avr8' // ATmega / ATtiny / AVR Dx
  | 'pic-baseline12' // PIC10/12/16 12-bit core
  | 'pic-midrange14' // PIC12/16 14-bit core
  | 'pic-enhanced14' // PIC12/16F1xxx enhanced mid-range
  | 'pic18'
  | 'pic24' // PIC24 / dsPIC (16-bit)
  | 'pic32' // MIPS32
  | 'cortex-m0+'
  | 'cortex-m3'
  | 'cortex-m4'
  | 'cortex-m33'
  | 'cortex-m7'
  | 'cortex-a53' // application processors running Linux (Raspberry Pi Zero 2 W, UNO Q)
  | 'xtensa-lx7'
  | 'riscv';

/**
 * How far the simulator can take this part:
 *  - 'p2'     firmware runs in the emulator today (ATmega328P, ATmega2560, RP2040, PIC16F84A/628A/877A)
 *  - 'p4'     the part exists in the catalog but its emulator core is still to be written
 *  - 'pinout' symbol, footprint and behavioural GPIO only; firmware does not execute
 */
export type SimLevel = 'p2' | 'p4' | 'pinout';

export interface Mcu {
  id: string;
  vendor:
    | 'Microchip'
    | 'Microchip/Atmel'
    | 'Raspberry Pi'
    | 'Renesas'
    | 'Espressif'
    | 'Nordic'
    | 'ST'
    | 'Silicon Labs'
    | 'Broadcom'
    | 'Qualcomm';
  family: string;
  core: McuCore;
  /** Maximum clock: MHz for 8/32-bit parts, MIPS for PIC24/dsPIC. */
  maxSpeed: number;
  /** Program memory; words for 12/14-bit PICs, otherwise bytes. */
  flash: number;
  flashUnit: 'words' | 'bytes';
  /** Data RAM in bytes. */
  ram: number;
  pins: number;
  sim: SimLevel;
}

const KB = 1024;
const MB = 1024 * KB;

const mcu = (
  id: string,
  vendor: Mcu['vendor'],
  family: string,
  core: McuCore,
  maxSpeed: number,
  flash: number,
  flashUnit: Mcu['flashUnit'],
  ram: number,
  pins: number,
  sim: SimLevel,
): Mcu => ({ id, vendor, family, core, maxSpeed, flash, flashUnit, ram, pins, sim });

const avr = (id: string, family: string, mhz: number, flashKb: number, ram: number, pins: number, sim: SimLevel): Mcu =>
  mcu(id, 'Microchip/Atmel', family, 'avr8', mhz, flashKb * KB, 'bytes', ram, pins, sim);

const pic = (
  id: string,
  family: string,
  core: McuCore,
  mhz: number,
  flash: number,
  unit: Mcu['flashUnit'],
  ram: number,
  pins: number,
  sim: SimLevel = 'p4',
): Mcu => mcu(id, 'Microchip', family, core, mhz, flash, unit, ram, pins, sim);

const AVR: Mcu[] = [
  avr('ATmega328P', 'ATmega', 20, 32, 2 * KB, 28, 'p2'),
  avr('ATmega328PB', 'ATmega', 20, 32, 2 * KB, 32, 'p4'),
  avr('ATmega168', 'ATmega', 20, 16, 1 * KB, 28, 'p4'),
  avr('ATmega8', 'ATmega', 16, 8, 1 * KB, 28, 'p4'),
  avr('ATmega16', 'ATmega', 16, 16, 1 * KB, 40, 'p4'),
  avr('ATmega32', 'ATmega', 16, 32, 2 * KB, 40, 'p4'),
  avr('ATmega644P', 'ATmega', 20, 64, 4 * KB, 40, 'p4'),
  avr('ATmega1284P', 'ATmega', 20, 128, 16 * KB, 40, 'p4'),
  avr('ATmega128', 'ATmega', 16, 128, 4 * KB, 64, 'p4'),
  avr('ATmega1280', 'ATmega', 16, 128, 8 * KB, 100, 'p4'),
  avr('ATmega2560', 'ATmega', 16, 256, 8 * KB, 100, 'p2'),
  avr('ATmega32U4', 'ATmega', 16, 32, 2560, 44, 'p4'),
  avr('ATmega4809', 'megaAVR 0', 20, 48, 6 * KB, 48, 'p4'),
  avr('ATtiny13A', 'ATtiny', 20, 1, 64, 8, 'p4'),
  avr('ATtiny45', 'ATtiny', 20, 4, 256, 8, 'p4'),
  avr('ATtiny85', 'ATtiny', 20, 8, 512, 8, 'p4'),
  avr('ATtiny84', 'ATtiny', 20, 8, 512, 14, 'p4'),
  avr('ATtiny2313', 'ATtiny', 20, 2, 128, 20, 'p4'),
];

const ARM: Mcu[] = [
  mcu('RP2040', 'Raspberry Pi', 'RP2', 'cortex-m0+', 133, 2 * MB, 'bytes', 264 * KB, 56, 'p2'),
  mcu('RP2350', 'Raspberry Pi', 'RP2', 'cortex-m33', 150, 4 * MB, 'bytes', 520 * KB, 60, 'p4'),
  mcu('SAMD21G18', 'Microchip', 'SAM D', 'cortex-m0+', 48, 256 * KB, 'bytes', 32 * KB, 48, 'p4'),
  mcu('SAM3X8E', 'Microchip', 'SAM3', 'cortex-m3', 84, 512 * KB, 'bytes', 96 * KB, 144, 'p4'),
  mcu('RA4M1', 'Renesas', 'RA4', 'cortex-m4', 48, 256 * KB, 'bytes', 32 * KB, 64, 'p4'),
  mcu('RA6M5', 'Renesas', 'RA6', 'cortex-m33', 200, 2 * MB, 'bytes', 512 * KB, 144, 'pinout'),
  mcu('nRF52840', 'Nordic', 'nRF52', 'cortex-m4', 64, 1 * MB, 'bytes', 256 * KB, 73, 'p4'),
  mcu('STM32H747', 'ST', 'STM32H7', 'cortex-m7', 480, 2 * MB, 'bytes', 1 * MB, 240, 'pinout'),
  mcu('STM32U585', 'ST', 'STM32U5', 'cortex-m33', 160, 2 * MB, 'bytes', 786 * KB, 169, 'pinout'),
  mcu('MGM240S', 'Silicon Labs', 'EFR32MG24', 'cortex-m33', 78, 1536 * KB, 'bytes', 256 * KB, 32, 'pinout'),
  mcu('ESP32-S3', 'Espressif', 'ESP32', 'xtensa-lx7', 240, 16 * MB, 'bytes', 512 * KB, 56, 'pinout'),
  // Application processors: no on-chip flash, run Linux, so only the GPIO header is modelled.
  mcu('BCM2710A1', 'Broadcom', 'Raspberry Pi Zero 2 W', 'cortex-a53', 1000, 0, 'bytes', 512 * MB, 40, 'pinout'),
  mcu('QRB2210', 'Qualcomm', 'Arduino UNO Q', 'cortex-a53', 2000, 0, 'bytes', 2048 * MB, 0, 'pinout'),
];

// Core families that share an instruction set, so one emulator covers dozens of devices.
const PIC_BASELINE: Mcu[] = [
  pic('PIC10F200', 'PIC10', 'pic-baseline12', 4, 256, 'words', 16, 6),
  pic('PIC10F202', 'PIC10', 'pic-baseline12', 4, 512, 'words', 24, 6),
  pic('PIC12F508', 'PIC12', 'pic-baseline12', 4, 512, 'words', 25, 8),
  pic('PIC12F509', 'PIC12', 'pic-baseline12', 4, 1024, 'words', 41, 8),
  pic('PIC16F54', 'PIC16', 'pic-baseline12', 20, 512, 'words', 25, 18),
  pic('PIC16F57', 'PIC16', 'pic-baseline12', 20, 2048, 'words', 72, 28),
  pic('PIC16F505', 'PIC16', 'pic-baseline12', 20, 1024, 'words', 72, 14),
];

const PIC_MID: Mcu[] = [
  pic('PIC12F629', 'PIC12', 'pic-midrange14', 20, 1024, 'words', 64, 8),
  pic('PIC12F675', 'PIC12', 'pic-midrange14', 20, 1024, 'words', 64, 8),
  pic('PIC12F683', 'PIC12', 'pic-midrange14', 20, 2048, 'words', 128, 8),
  pic('PIC16F84A', 'PIC16', 'pic-midrange14', 20, 1024, 'words', 68, 18, 'p2'),
  pic('PIC16F627A', 'PIC16', 'pic-midrange14', 20, 1024, 'words', 224, 18),
  pic('PIC16F628A', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 224, 18, 'p2'),
  pic('PIC16F648A', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 256, 18),
  pic('PIC16F630', 'PIC16', 'pic-midrange14', 20, 1024, 'words', 64, 14),
  pic('PIC16F676', 'PIC16', 'pic-midrange14', 20, 1024, 'words', 64, 14),
  pic('PIC16F684', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 14),
  pic('PIC16F688', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 256, 14),
  pic('PIC16F690', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 256, 20),
  pic('PIC16F716', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 18),
  pic('PIC16F72', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 28),
  pic('PIC16F73', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 192, 28),
  pic('PIC16F74', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 192, 40),
  pic('PIC16F76', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 28),
  pic('PIC16F77', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 40),
  pic('PIC16F818', 'PIC16', 'pic-midrange14', 20, 1024, 'words', 128, 18),
  pic('PIC16F819', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 256, 18),
  pic('PIC16F87', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 368, 18),
  pic('PIC16F88', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 368, 18),
  pic('PIC16F870', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 28),
  pic('PIC16F871', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 40),
  pic('PIC16F872', 'PIC16', 'pic-midrange14', 20, 2048, 'words', 128, 28),
  pic('PIC16F873A', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 192, 28),
  pic('PIC16F874A', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 192, 40),
  pic('PIC16F876A', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 28),
  pic('PIC16F877A', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 40, 'p2'),
  pic('PIC16F883', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 256, 28),
  pic('PIC16F884', 'PIC16', 'pic-midrange14', 20, 4096, 'words', 256, 40),
  pic('PIC16F886', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 28),
  pic('PIC16F887', 'PIC16', 'pic-midrange14', 20, 8192, 'words', 368, 40),
];

const PIC_ENH: Mcu[] = [
  pic('PIC12F1822', 'PIC12', 'pic-enhanced14', 32, 2048, 'words', 128, 8),
  pic('PIC16F1503', 'PIC16', 'pic-enhanced14', 20, 2048, 'words', 128, 14),
  pic('PIC16F1507', 'PIC16', 'pic-enhanced14', 20, 2048, 'words', 128, 20),
  pic('PIC16F1508', 'PIC16', 'pic-enhanced14', 20, 4096, 'words', 256, 20),
  pic('PIC16F1509', 'PIC16', 'pic-enhanced14', 20, 8192, 'words', 512, 20),
  pic('PIC16F1823', 'PIC16', 'pic-enhanced14', 32, 2048, 'words', 128, 14),
  pic('PIC16F1825', 'PIC16', 'pic-enhanced14', 32, 8192, 'words', 1024, 14),
  pic('PIC16F1826', 'PIC16', 'pic-enhanced14', 32, 2048, 'words', 256, 18),
  pic('PIC16F1827', 'PIC16', 'pic-enhanced14', 32, 4096, 'words', 384, 18),
  pic('PIC16F1829', 'PIC16', 'pic-enhanced14', 32, 8192, 'words', 1024, 20),
  pic('PIC16F1933', 'PIC16', 'pic-enhanced14', 32, 4096, 'words', 256, 28),
  pic('PIC16F1936', 'PIC16', 'pic-enhanced14', 32, 8192, 'words', 512, 28),
  pic('PIC16F1937', 'PIC16', 'pic-enhanced14', 32, 8192, 'words', 512, 40),
  pic('PIC16F1938', 'PIC16', 'pic-enhanced14', 32, 16384, 'words', 1024, 28),
  pic('PIC16F1939', 'PIC16', 'pic-enhanced14', 32, 16384, 'words', 1024, 40),
  pic('PIC16F1947', 'PIC16', 'pic-enhanced14', 32, 16384, 'words', 1024, 64),
];

const PIC_18: Mcu[] = [
  pic('PIC18F1220', 'PIC18', 'pic18', 40, 4 * KB, 'bytes', 256, 18),
  pic('PIC18F1320', 'PIC18', 'pic18', 40, 8 * KB, 'bytes', 256, 18),
  pic('PIC18F242', 'PIC18', 'pic18', 40, 16 * KB, 'bytes', 768, 28),
  pic('PIC18F252', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 28),
  pic('PIC18F442', 'PIC18', 'pic18', 40, 16 * KB, 'bytes', 768, 40),
  pic('PIC18F452', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 40),
  pic('PIC18F2420', 'PIC18', 'pic18', 40, 16 * KB, 'bytes', 768, 28),
  pic('PIC18F2520', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 28),
  pic('PIC18F4420', 'PIC18', 'pic18', 40, 16 * KB, 'bytes', 768, 40),
  pic('PIC18F4520', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 40),
  pic('PIC18F2455', 'PIC18', 'pic18', 48, 24 * KB, 'bytes', 2048, 28),
  pic('PIC18F4455', 'PIC18', 'pic18', 48, 24 * KB, 'bytes', 2048, 40),
  pic('PIC18F2550', 'PIC18', 'pic18', 48, 32 * KB, 'bytes', 2048, 28),
  pic('PIC18F4550', 'PIC18', 'pic18', 48, 32 * KB, 'bytes', 2048, 40),
  pic('PIC18F2580', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 28),
  pic('PIC18F4580', 'PIC18', 'pic18', 40, 32 * KB, 'bytes', 1536, 40),
  pic('PIC18F2620', 'PIC18', 'pic18', 40, 64 * KB, 'bytes', 3968, 28),
  pic('PIC18F4620', 'PIC18', 'pic18', 40, 64 * KB, 'bytes', 3968, 40),
  pic('PIC18F13K50', 'PIC18', 'pic18', 48, 8 * KB, 'bytes', 512, 20),
  pic('PIC18F14K50', 'PIC18', 'pic18', 48, 16 * KB, 'bytes', 768, 20),
  pic('PIC18F25K22', 'PIC18', 'pic18', 64, 32 * KB, 'bytes', 1536, 28),
  pic('PIC18F45K22', 'PIC18', 'pic18', 64, 32 * KB, 'bytes', 1536, 40),
  pic('PIC18F26K22', 'PIC18', 'pic18', 64, 64 * KB, 'bytes', 3896, 28),
  pic('PIC18F46K22', 'PIC18', 'pic18', 64, 64 * KB, 'bytes', 3896, 40),
];

// 16/32-bit parts: symbol, footprint and behavioural GPIO only for now.
const PIC_WIDE: Mcu[] = [
  pic('PIC24FJ64GA002', 'PIC24', 'pic24', 16, 64 * KB, 'bytes', 8 * KB, 28, 'pinout'),
  pic('PIC24FJ128GA010', 'PIC24', 'pic24', 16, 128 * KB, 'bytes', 8 * KB, 100, 'pinout'),
  pic('dsPIC30F4013', 'dsPIC30', 'pic24', 30, 48 * KB, 'bytes', 2 * KB, 40, 'pinout'),
  pic('dsPIC33FJ128GP802', 'dsPIC33', 'pic24', 40, 128 * KB, 'bytes', 16 * KB, 28, 'pinout'),
  pic('dsPIC33EP512MU810', 'dsPIC33', 'pic24', 70, 512 * KB, 'bytes', 52 * KB, 100, 'pinout'),
  pic('PIC32MX150F128B', 'PIC32', 'pic32', 40, 128 * KB, 'bytes', 32 * KB, 28, 'pinout'),
  pic('PIC32MX250F128B', 'PIC32', 'pic32', 40, 128 * KB, 'bytes', 32 * KB, 28, 'pinout'),
  pic('PIC32MX795F512L', 'PIC32', 'pic32', 80, 512 * KB, 'bytes', 128 * KB, 100, 'pinout'),
];

export const MCUS: readonly Mcu[] = [
  ...AVR,
  ...ARM,
  ...PIC_BASELINE,
  ...PIC_MID,
  ...PIC_ENH,
  ...PIC_18,
  ...PIC_WIDE,
];

export const mcuById = (id: string): Mcu | undefined => MCUS.find((m) => m.id === id);
