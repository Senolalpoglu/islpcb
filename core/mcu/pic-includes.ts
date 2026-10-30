// Register and bit names that MPASM programs get from `#include <p16f877a.inc>` and friends, so source
// written for MPLAB assembles unchanged. Names are case-insensitive in this assembler.

import type { PicChipId } from './pic16';

type Equates = Record<string, number>;

const CORE: Equates = {
  W: 0, F: 1,
  INDF: 0x00, TMR0: 0x01, PCL: 0x02, STATUS: 0x03, FSR: 0x04, PCLATH: 0x0a, INTCON: 0x0b, OPTION_REG: 0x81,
  // STATUS
  C: 0, DC: 1, Z: 2, NOT_PD: 3, NOT_TO: 4, RP0: 5, RP1: 6, IRP: 7,
  // INTCON
  RBIF: 0, INTF: 1, T0IF: 2, TMR0IF: 2, RBIE: 3, INTE: 4, T0IE: 5, TMR0IE: 5, PEIE: 6, GIE: 7,
  // OPTION_REG
  PS0: 0, PS1: 1, PS2: 2, PSA: 3, T0SE: 4, T0CS: 5, INTEDG: 6, NOT_RBPU: 7, RBPU: 7,
};

const portBits = (letter: string, count: number): Equates => Object.fromEntries(Array.from({ length: count }, (_, i) => [`R${letter}${i}`, i]));

const PERIPHERALS: Equates = {
  PIR1: 0x0c, TMR1L: 0x0e, TMR1H: 0x0f, T1CON: 0x10, TMR2: 0x11, T2CON: 0x12, CCPR1L: 0x15, CCPR1H: 0x16, CCP1CON: 0x17,
  RCSTA: 0x18, TXREG: 0x19, RCREG: 0x1a, PIE1: 0x8c, PCON: 0x8e, PR2: 0x92, TXSTA: 0x98, SPBRG: 0x99,
  // PIR1 / PIE1 (shared names, bit positions of the 877A and 628A)
  TMR1IF: 0, TMR2IF: 1, CCP1IF: 2, SSPIF: 3, TXIF: 4, RCIF: 5, ADIF: 6, PSPIF: 7, CMIF: 6, EEIF: 7,
  TMR1IE: 0, TMR2IE: 1, CCP1IE: 2, SSPIE: 3, TXIE: 4, RCIE: 5, ADIE: 6, PSPIE: 7, CMIE: 6, EEIE: 7,
  // T1CON, T2CON
  TMR1ON: 0, TMR1CS: 1, NOT_T1SYNC: 2, T1OSCEN: 3, T1CKPS0: 4, T1CKPS1: 5,
  T2CKPS0: 0, T2CKPS1: 1, TMR2ON: 2, TOUTPS0: 3, TOUTPS1: 4, TOUTPS2: 5, TOUTPS3: 6,
  // CCP1CON
  CCP1M0: 0, CCP1M1: 1, CCP1M2: 2, CCP1M3: 3, CCP1Y: 4, CCP1X: 5,
  // RCSTA, TXSTA
  RX9D: 0, OERR: 1, FERR: 2, ADDEN: 3, CREN: 4, SREN: 5, RX9: 6, SPEN: 7,
  TX9D: 0, TRMT: 1, BRGH: 2, SYNC: 4, TXEN: 5, TX9: 6, CSRC: 7,
};

const ADC: Equates = {
  PIR2: 0x0d, ADRESH: 0x1e, ADCON0: 0x1f, PIE2: 0x8d, ADRESL: 0x9e, ADCON1: 0x9f,
  CCPR2L: 0x1b, CCPR2H: 0x1c, CCP2CON: 0x1d, SSPBUF: 0x13, SSPCON: 0x14, SSPCON2: 0x91, SSPADD: 0x93, SSPSTAT: 0x94,
  ADON: 0, GO: 2, GO_DONE: 2, NOT_DONE: 2, CHS0: 3, CHS1: 4, CHS2: 5, ADCS0: 6, ADCS1: 7,
  PCFG0: 0, PCFG1: 1, PCFG2: 2, PCFG3: 3, ADCS2: 6, ADFM: 7,
};

const EEPROM = (data: number, adr: number, con1: number, con2: number): Equates => ({
  EEDATA: data, EEADR: adr, EECON1: con1, EECON2: con2, RD: 0, WR: 1, WREN: 2, WRERR: 3, EEPGD: 7,
});

const TRIS = (letters: string): Equates => Object.fromEntries([...letters].map((l) => [`TRIS${l}`, 0x85 + 'ABCDE'.indexOf(l)]));
const PORT = (letters: string): Equates => Object.fromEntries([...letters].map((l) => [`PORT${l}`, 5 + 'ABCDE'.indexOf(l)]));

export const PIC_INCLUDES: Record<PicChipId, Equates> = {
  PIC16F84A: {
    ...CORE, ...PORT('AB'), ...TRIS('AB'), ...EEPROM(0x08, 0x09, 0x88, 0x89),
    ...portBits('A', 5), ...portBits('B', 8),
    EEIE: 6, EEIF: 4,
  },
  PIC16F628A: {
    ...CORE, ...PORT('AB'), ...TRIS('AB'), ...PERIPHERALS, ...EEPROM(0x9a, 0x9b, 0x9c, 0x9d),
    CMCON: 0x1f, VRCON: 0x9f, ...portBits('A', 8), ...portBits('B', 8),
  },
  PIC16F877A: {
    ...CORE, ...PORT('ABCDE'), ...TRIS('ABCDE'), ...PERIPHERALS, ...ADC, ...EEPROM(0x10c, 0x10d, 0x18c, 0x18d),
    EEDATH: 0x10e, EEADRH: 0x10f,
    ...portBits('A', 6), ...portBits('B', 8), ...portBits('C', 8), ...portBits('D', 8), ...portBits('E', 3),
    EEIF: 4,
  },
};

/** Include file names accepted by `#include` / `include`, mapped to the chip whose names they provide. */
export const INCLUDE_FILES: Record<string, PicChipId> = {
  'p16f84a.inc': 'PIC16F84A',
  'p16f628a.inc': 'PIC16F628A',
  'p16f877a.inc': 'PIC16F877A',
};
