// Microchip mid-range PIC (14-bit instruction word) emulator: PIC16F84A, PIC16F628A and PIC16F877A.
//
// Modelled: the full 35-instruction set with cycle counts, banked data memory and indirect addressing,
// the 8-level call stack, interrupts, Timer0/1/2, CCP1 PWM, the 10-bit ADC (877A), the USART (628A, 877A),
// data EEPROM and the I/O ports with TRIS, weak pull-ups, open-drain RA4 and RB/INT interrupts.
// Not modelled: watchdog, brown-out, capture/compare modes, SPI/I2C, the parallel slave port and
// oscillator start-up. The configuration word is ignored; the clock comes from the part's parameter.

import type { McuBoard, PinDrive } from './board';
import { parseIntelHex } from './ihex';

export type PicChipId = 'PIC16F84A' | 'PIC16F628A' | 'PIC16F877A';

interface PortDef {
  letter: 'A' | 'B' | 'C' | 'D' | 'E';
  port: number;
  tris: number;
  /** Bits that exist on this chip. */
  mask: number;
}

interface ChipDef {
  id: PicChipId;
  flashWords: number;
  eeprom: number;
  ports: PortDef[];
  /** Address mirrors across banks beyond the always-visible core registers. */
  mirrors: Record<number, number>;
  /** GPR addresses visible from every bank (0x70-0x7F on the larger chips). */
  sharedGpr: boolean;
  /** 16F84A: bank 1 shows the same GPRs as bank 0. */
  mirrorGpr1: boolean;
  has: { tmr1: boolean; tmr2: boolean; usart: boolean; adc: boolean; ccp1: boolean; cmcon: boolean };
  /** Where the CCP1 and USART pins live. */
  ccp1Pin?: string;
  txPin?: string;
  eeAddrs: { data: number; adr: number; con1: number; con2: number };
  valid: Array<[number, number]>; // implemented data memory ranges [first, last]
}

const portsFor = (letters: Array<[PortDef['letter'], number]>): PortDef[] =>
  letters.map(([letter, mask]) => {
    const i = 'ABCDE'.indexOf(letter);
    return { letter, port: 5 + i, tris: 0x85 + i, mask };
  });

export const PIC_CHIPS: Record<PicChipId, ChipDef> = {
  PIC16F84A: {
    id: 'PIC16F84A',
    flashWords: 1024,
    eeprom: 64,
    ports: portsFor([['A', 0x1f], ['B', 0xff]]),
    mirrors: {},
    sharedGpr: false,
    mirrorGpr1: true,
    has: { tmr1: false, tmr2: false, usart: false, adc: false, ccp1: false, cmcon: false },
    eeAddrs: { data: 0x08, adr: 0x09, con1: 0x88, con2: 0x89 },
    valid: [[0x0c, 0x4f]],
  },
  PIC16F628A: {
    id: 'PIC16F628A',
    flashWords: 2048,
    eeprom: 128,
    ports: portsFor([['A', 0xff], ['B', 0xff]]),
    mirrors: { 0x101: 0x01, 0x106: 0x06, 0x181: 0x81, 0x186: 0x86 },
    sharedGpr: true,
    mirrorGpr1: false,
    has: { tmr1: true, tmr2: true, usart: true, adc: false, ccp1: true, cmcon: true },
    ccp1Pin: 'RB3',
    txPin: 'RB2',
    eeAddrs: { data: 0x9a, adr: 0x9b, con1: 0x9c, con2: 0x9d },
    valid: [[0x20, 0x7f], [0xa0, 0xef], [0x120, 0x14f]],
  },
  PIC16F877A: {
    id: 'PIC16F877A',
    flashWords: 8192,
    eeprom: 256,
    ports: portsFor([['A', 0x3f], ['B', 0xff], ['C', 0xff], ['D', 0xff], ['E', 0x07]]),
    mirrors: { 0x101: 0x01, 0x106: 0x06, 0x181: 0x81, 0x186: 0x86 },
    sharedGpr: true,
    mirrorGpr1: false,
    has: { tmr1: true, tmr2: true, usart: true, adc: true, ccp1: true, cmcon: false },
    ccp1Pin: 'RC2',
    txPin: 'RC6',
    eeAddrs: { data: 0x10c, adr: 0x10d, con1: 0x18c, con2: 0x18d },
    valid: [[0x20, 0x7f], [0xa0, 0xef], [0x110, 0x16f], [0x190, 0x1ef]],
  },
};

/** Pin names of each chip (RA0 ... RE2). */
export const picPins = (id: PicChipId): string[] =>
  PIC_CHIPS[id].ports.flatMap((p) => Array.from({ length: 8 }, (_, b) => b).filter((b) => p.mask & (1 << b)).map((b) => `R${p.letter}${b}`));

// Special function register addresses shared by the family.
const TMR0 = 0x01;
const PCL = 0x02;
const STATUS = 0x03;
const FSR = 0x04;
const PCLATH = 0x0a;
const INTCON = 0x0b;
const OPTION = 0x81;
const PIR1 = 0x0c;
const PIR2 = 0x0d;
const TMR1L = 0x0e;
const TMR1H = 0x0f;
const T1CON = 0x10;
const TMR2 = 0x11;
const T2CON = 0x12;
const CCPR1L = 0x15;
const CCP1CON = 0x17;
const RCSTA = 0x18;
const TXREG = 0x19;
const RCREG = 0x1a;
const ADRESH = 0x1e;
const ADCON0 = 0x1f;
const CMCON = 0x1f;
const PIE1 = 0x8c;
const PIE2 = 0x8d;
const PR2 = 0x92;
const TXSTA = 0x98;
const SPBRG = 0x99;
const ADRESL = 0x9e;
const ADCON1 = 0x9f;

// STATUS bits
const C = 1;
const DC = 2;
const Z = 4;

// ADC channel -> pin, and which of AN0-AN7 are analog for each PCFG setting (bit n = ANn), VREF+/VREF- use.
const ADC_PINS = ['RA0', 'RA1', 'RA2', 'RA3', 'RA5', 'RE0', 'RE1', 'RE2'];
const PCFG: Array<{ analog: number; vrefP: boolean; vrefM: boolean }> = [
  { analog: 0xff, vrefP: false, vrefM: false },
  { analog: 0xf7, vrefP: true, vrefM: false },
  { analog: 0x1f, vrefP: false, vrefM: false },
  { analog: 0x17, vrefP: true, vrefM: false },
  { analog: 0x0b, vrefP: false, vrefM: false },
  { analog: 0x03, vrefP: true, vrefM: false },
  { analog: 0x00, vrefP: false, vrefM: false },
  { analog: 0x00, vrefP: false, vrefM: false },
  { analog: 0xf3, vrefP: true, vrefM: true },
  { analog: 0x3f, vrefP: false, vrefM: false },
  { analog: 0x3f, vrefP: true, vrefM: false },
  { analog: 0x33, vrefP: true, vrefM: true },
  { analog: 0x1b, vrefP: true, vrefM: true },
  { analog: 0x03, vrefP: true, vrefM: true },
  { analog: 0x01, vrefP: false, vrefM: false },
  { analog: 0x01, vrefP: true, vrefM: true },
];

const OUTPUT_R = 40;
const PULLUP_R = 50e3;

export class Pic16 implements McuBoard {
  readonly chip: ChipDef;
  readonly vdd: number;
  readonly clockHz: number;
  /** Executed instruction cycles since reset. */
  cycles = 0;
  onSerial: (byte: number) => void = () => {};

  private readonly flash: Uint16Array;
  private readonly ram = new Uint8Array(0x200);
  private readonly ee: Uint8Array;
  private readonly pinLoc = new Map<string, { port: PortDef; bit: number }>();
  private readonly latch = new Map<string, number>(); // PORTx output latches by letter
  private readonly level = new Map<string, boolean>(); // digital level seen on each input pin
  private readonly volts = new Map<string, number>();
  private readonly stack: number[] = [];
  private pc = 0;
  private w = 0;
  private sleeping = false;
  private carry = 0;
  private pclWrite = false;
  private rbInit = false;

  // Timer0
  private t0Inhibit = 0;
  private t0Prescale = 0;
  // Timer1 / Timer2
  private tmr1 = 0;
  private t1Sub = 0;
  private t2Sub = 0;
  private t2Post = 0;
  // PORTB change / INT edge tracking
  private rbLatch = 0;
  // ADC
  private adCountdown = 0;
  private adVolts = 0;
  // USART
  private txFrame = 0;
  private txStart = -1;
  private txBitCycles = 0;
  private txHolding = -1; // byte waiting in TXREG while the shifter is busy
  private txLastByte = 0;
  private readonly rxQueue: Array<{ at: number; byte: number }> = [];
  private readonly rxFifo: number[] = [];
  // EEPROM
  private eeWriteDone = false;

  constructor(chipId: PicChipId, hex: string, opts: { clockHz?: number; vdd?: number } = {}) {
    this.chip = PIC_CHIPS[chipId];
    this.clockHz = opts.clockHz ?? 4e6;
    this.vdd = opts.vdd ?? 5;
    this.flash = new Uint16Array(this.chip.flashWords).fill(0x3fff);
    this.ee = new Uint8Array(this.chip.eeprom).fill(0xff);
    for (const [addr, byte] of parseIntelHex(hex)) {
      if (addr < this.chip.flashWords * 2) this.flash[addr >> 1] = (this.flash[addr >> 1] & ~(0xff << ((addr & 1) * 8))) | (byte << ((addr & 1) * 8));
      else if (addr >= 0x4200 && addr < 0x4200 + this.chip.eeprom * 2 && (addr & 1) === 0) this.ee[(addr - 0x4200) >> 1] = byte;
    }
    for (let i = 0; i < this.flash.length; i++) this.flash[i] &= 0x3fff;
    for (const port of this.chip.ports) {
      for (let b = 0; b < 8; b++) if (port.mask & (1 << b)) this.pinLoc.set(`R${port.letter}${b}`, { port, bit: b });
      this.latch.set(port.letter, 0);
    }
    this.reset();
  }

  reset(): void {
    this.ram.fill(0);
    this.pc = 0;
    this.w = 0;
    this.stack.length = 0;
    this.sleeping = false;
    this.ram[STATUS] = 0x18;
    this.ram[OPTION] = 0xff;
    for (const p of this.chip.ports) this.ram[p.tris] = p.mask;
    this.ram[PR2] = 0xff;
    this.ram[TXSTA] = 0x02;
    if (this.chip.has.adc) this.ram[ADCON1] = 0x00; // every ANx pin is analog out of reset
    this.tmr1 = 0;
    this.txStart = -1;
    this.txHolding = -1;
    this.rxFifo.length = 0;
    this.rxQueue.length = 0;
  }

  // ---- data memory ---------------------------------------------------------------------------------

  /** Maps a file register address and bank to the physical location. */
  private phys(f: number, bank: number): number {
    f &= 0x7f;
    if (f === 0 || f === 2 || f === 3 || f === 4 || f === 0x0a || f === 0x0b) return f;
    if (this.chip.sharedGpr && f >= 0x70) return f;
    if (this.chip.mirrorGpr1 && bank === 1 && f >= 0x0c) return f;
    const a = bank * 0x80 + f;
    return this.chip.mirrors[a] ?? a;
  }

  private bank(): number {
    return (this.ram[STATUS] >> 5) & 3;
  }

  /** True for the pins of PORTA/PORTE that the ADC or comparators currently configure as analog. */
  private analogPin(name: string): boolean {
    if (this.chip.has.adc) {
      const ch = ADC_PINS.indexOf(name);
      return ch >= 0 && (PCFG[this.ram[ADCON1] & 15].analog & (1 << ch)) !== 0;
    }
    if (this.chip.has.cmcon && /^RA[0-3]$/.test(name)) return (this.ram[CMCON] & 7) !== 7;
    return false;
  }

  private readPort(port: PortDef): number {
    const tris = this.ram[port.tris];
    const lat = this.latch.get(port.letter) ?? 0;
    let v = 0;
    for (let b = 0; b < 8; b++) {
      if (!(port.mask & (1 << b))) continue;
      const name = `R${port.letter}${b}`;
      const bit = tris & (1 << b) ? (!this.analogPin(name) && this.pinLevel(name) ? 1 : 0) : (lat >> b) & 1;
      v |= bit << b;
    }
    if (port.letter === 'B') this.rbLatch = v & 0xf0; // reading PORTB ends the mismatch condition
    return v;
  }

  private pinLevel(name: string): boolean {
    if (this.level.has(name)) return this.level.get(name)!;
    // An undriven input floats; weak pull-ups on PORTB read high.
    return /^RB/.test(name) && this.pullupsOn();
  }

  private pullupsOn(): boolean {
    return (this.ram[OPTION] & 0x80) === 0;
  }

  private read(f: number): number {
    const bank = this.bank();
    if ((f & 0x7f) === 0) return this.readAbs(this.indirect());
    return this.readAbs(this.phys(f, bank));
  }

  private indirect(): number {
    const a9 = ((this.ram[STATUS] & 0x80) << 1) | this.ram[FSR];
    return this.phys(a9 & 0x7f, a9 >> 7);
  }

  private write(f: number, v: number): void {
    if ((f & 0x7f) === 0) this.writeAbs(this.indirect(), v);
    else this.writeAbs(this.phys(f, this.bank()), v);
  }

  private readAbs(a: number): number {
    for (const p of this.chip.ports) if (a === p.port) return this.readPort(p);
    const c = this.chip;
    switch (a) {
      case 0:
        return 0; // INDF through FSR 0 reads 0
      case PCL:
        return this.pc & 0xff;
      case TMR1L:
        if (c.has.tmr1) return this.tmr1 & 0xff;
        break;
      case TMR1H:
        if (c.has.tmr1) return this.tmr1 >> 8;
        break;
      case PIR1:
        if (c.has.tmr1) return (this.ram[PIR1] & ~0x30) | (this.txReady() ? 0x10 : 0) | (this.rxFifo.length ? 0x20 : 0);
        break;
      case RCREG:
        if (c.has.usart) return this.readRcreg();
        break;
      case TXSTA:
        if (c.has.usart) return (this.ram[TXSTA] & ~2) | (this.txStart < 0 && this.txHolding < 0 ? 2 : 0);
        break;
    }
    return this.ram[a];
  }

  private writeAbs(a: number, v: number): void {
    v &= 0xff;
    for (const p of this.chip.ports) {
      if (a === p.port) {
        this.latch.set(p.letter, v & p.mask);
        return;
      }
      if (a === p.tris) {
        this.ram[a] = v & p.mask;
        return;
      }
    }
    const c = this.chip;
    switch (a) {
      case 0:
        return;
      case PCL:
        this.pc = ((this.ram[PCLATH] & 0x1f) << 8) | v;
        this.pclWrite = true;
        return;
      case STATUS:
        this.ram[STATUS] = (this.ram[STATUS] & 0x18) | (v & 0xe7);
        return;
      case TMR0:
        this.ram[TMR0] = v;
        this.t0Inhibit = 2;
        this.t0Prescale = 0;
        return;
      case INTCON:
        this.ram[INTCON] = v;
        return;
      case TMR1L:
        if (c.has.tmr1) {
          this.tmr1 = (this.tmr1 & 0xff00) | v;
          this.t1Sub = 0;
          return;
        }
        break;
      case TMR1H:
        if (c.has.tmr1) {
          this.tmr1 = (this.tmr1 & 0xff) | (v << 8);
          return;
        }
        break;
      case TMR2:
        if (c.has.tmr2) {
          this.ram[TMR2] = v;
          this.t2Sub = 0;
          return;
        }
        break;
      case TXREG:
        if (c.has.usart) {
          this.txWrite(v);
          return;
        }
        break;
      case ADCON0:
        if (c.has.adc) {
          const goBefore = this.ram[ADCON0] & 4;
          this.ram[ADCON0] = v;
          if (v & 4 && !goBefore && v & 1) this.startAdc();
          return;
        }
        break;
      case ADRESH:
      case ADRESL:
        if (c.has.adc) return;
        break;
      default:
        if (a === c.eeAddrs.con1) {
          this.ram[a] = v & ~0x03; // RD and WR clear themselves: the access completes instantly
          if (v & 1) this.eeRead();
          if (v & 2 && v & 4) this.eeWrite(); // WR only counts while WREN is set
          return;
        }
    }
    this.ram[a] = v;
  }

  // ---- EEPROM --------------------------------------------------------------------------------------

  private eeRead(): void {
    const { adr, data, con1 } = this.chip.eeAddrs;
    this.ram[data] = this.ee[this.ram[adr] % this.ee.length];
    this.ram[con1] &= ~1;
  }

  private eeWrite(): void {
    const { adr, data, con1 } = this.chip.eeAddrs;
    this.ee[this.ram[adr] % this.ee.length] = this.ram[data];
    this.ram[con1] &= ~2;
    this.eeWriteDone = true; // EEIF is raised on the next peripheral update
  }

  /** The data EEPROM contents (for tests and the UI). */
  get eeprom(): Uint8Array {
    return this.ee;
  }

  // ---- instruction execution -----------------------------------------------------------------------

  private setZ(v: number): void {
    this.ram[STATUS] = (this.ram[STATUS] & ~Z) | (v === 0 ? Z : 0);
  }

  private setAdd(a: number, b: number, carryIn = 0): number {
    const r = a + b + carryIn;
    const flags = (r > 0xff ? C : 0) | ((a & 0xf) + (b & 0xf) + carryIn > 0xf ? DC : 0) | ((r & 0xff) === 0 ? Z : 0);
    this.ram[STATUS] = (this.ram[STATUS] & ~(C | DC | Z)) | flags;
    return r & 0xff;
  }

  /** a - b with the PIC's carry meaning "no borrow". */
  private setSub(a: number, b: number): number {
    return this.setAdd(a, (~b & 0xff), 1);
  }

  private push(): void {
    if (this.stack.length >= 8) this.stack.shift();
    this.stack.push(this.pc);
  }

  /** Executes one instruction (or services an interrupt) and returns the cycles it took. */
  step(): number {
    let cyc = 1;
    if (this.sleeping) {
      this.updateRbIf();
      if (this.wakePending()) this.sleeping = false;
      else return 1;
    }
    if (this.interruptPending() && (this.ram[INTCON] & 0x80)) {
      this.push();
      this.pc = 4;
      this.ram[INTCON] &= 0x7f;
      this.advance(2);
      return 2;
    }
    const op = this.flash[this.pc % this.flash.length];
    this.pc = (this.pc + 1) & 0x1fff;
    const f = op & 0x7f;
    const d = (op & 0x80) !== 0;
    const k8 = op & 0xff;
    const store = (v: number): void => {
      if (d) this.write(f, v);
      else this.w = v;
    };

    switch (op >> 12) {
      case 0x0: {
        switch (op >> 8) {
          case 0x00: {
            if ((op & 0xff80) === 0x0080) this.write(f, this.w); // MOVWF
            else if (op === 0x0008) {
              this.pc = this.stack.pop() ?? 0; // RETURN
              cyc = 2;
            } else if (op === 0x0009) {
              this.pc = this.stack.pop() ?? 0; // RETFIE
              this.ram[INTCON] |= 0x80;
              cyc = 2;
            } else if (op === 0x0063) {
              this.sleeping = true; // SLEEP
              this.ram[STATUS] = (this.ram[STATUS] & ~0x18) | 0x10;
            } else if (op === 0x0064) {
              this.ram[STATUS] |= 0x18; // CLRWDT
            }
            break;
          }
          case 0x01: {
            if (d) {
              this.write(f, 0); // CLRF
              this.ram[STATUS] |= Z;
            } else {
              this.w = 0; // CLRW
              this.ram[STATUS] |= Z;
            }
            break;
          }
          case 0x02: {
            store(this.setSub(this.read(f), this.w)); // SUBWF
            break;
          }
          case 0x03: {
            const r = (this.read(f) - 1) & 0xff; // DECF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x04: {
            const r = this.read(f) | this.w; // IORWF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x05: {
            const r = this.read(f) & this.w; // ANDWF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x06: {
            const r = this.read(f) ^ this.w; // XORWF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x07: {
            store(this.setAdd(this.read(f), this.w)); // ADDWF
            break;
          }
          case 0x08: {
            const r = this.read(f); // MOVF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x09: {
            const r = ~this.read(f) & 0xff; // COMF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x0a: {
            const r = (this.read(f) + 1) & 0xff; // INCF
            this.setZ(r);
            store(r);
            break;
          }
          case 0x0b: {
            const r = (this.read(f) - 1) & 0xff; // DECFSZ
            store(r);
            if (r === 0) {
              cyc = 2; // the skipped instruction becomes a NOP
              this.pc = (this.pc + 1) & 0x1fff;
            }
            break;
          }
          case 0x0c: {
            const v = this.read(f); // RRF
            const r = ((v >> 1) | ((this.ram[STATUS] & C) << 7)) & 0xff;
            this.ram[STATUS] = (this.ram[STATUS] & ~C) | (v & 1);
            store(r);
            break;
          }
          case 0x0d: {
            const v = this.read(f); // RLF
            const r = ((v << 1) | (this.ram[STATUS] & C)) & 0xff;
            this.ram[STATUS] = (this.ram[STATUS] & ~C) | (v >> 7);
            store(r);
            break;
          }
          case 0x0e: {
            const v = this.read(f); // SWAPF
            store(((v << 4) | (v >> 4)) & 0xff);
            break;
          }
          case 0x0f: {
            const r = (this.read(f) + 1) & 0xff; // INCFSZ
            store(r);
            if (r === 0) {
              cyc = 2;
              this.pc = (this.pc + 1) & 0x1fff;
            }
            break;
          }
        }
        break;
      }
      case 0x1: {
        const bit = (op >> 7) & 7;
        const mask = 1 << bit;
        switch ((op >> 10) & 3) {
          case 0:
            this.write(f, this.read(f) & ~mask); // BCF
            break;
          case 1:
            this.write(f, this.read(f) | mask); // BSF
            break;
          case 2:
            if (!(this.read(f) & mask)) {
              cyc = 2; // BTFSC skips when clear
              this.pc = (this.pc + 1) & 0x1fff;
            }
            break;
          default:
            if (this.read(f) & mask) {
              cyc = 2; // BTFSS skips when set
              this.pc = (this.pc + 1) & 0x1fff;
            }
        }
        break;
      }
      case 0x2: {
        const k = op & 0x7ff;
        if (op & 0x800) {
          this.pc = ((this.ram[PCLATH] & 0x18) << 8) | k; // GOTO
        } else {
          this.push(); // CALL
          this.pc = ((this.ram[PCLATH] & 0x18) << 8) | k;
        }
        cyc = 2;
        break;
      }
      case 0x3: {
        switch ((op >> 8) & 0xf) {
          case 0x0:
          case 0x1:
          case 0x2:
          case 0x3:
            this.w = k8; // MOVLW
            break;
          case 0x4:
          case 0x5:
          case 0x6:
          case 0x7:
            this.w = k8; // RETLW
            this.pc = this.stack.pop() ?? 0;
            cyc = 2;
            break;
          case 0x8:
            this.w |= k8; // IORLW
            this.setZ(this.w);
            break;
          case 0x9:
            this.w &= k8; // ANDLW
            this.setZ(this.w);
            break;
          case 0xa:
            this.w ^= k8; // XORLW
            this.setZ(this.w);
            break;
          case 0xc:
          case 0xd:
            this.w = this.setSub(k8, this.w); // SUBLW
            break;
          case 0xe:
          case 0xf:
            this.w = this.setAdd(k8, this.w); // ADDLW
            break;
        }
        break;
      }
    }
    if (this.pclWrite) {
      this.pclWrite = false;
      cyc = 2; // a write to PCL costs an extra cycle
    }
    this.advance(cyc);
    return cyc;
  }

  // ---- interrupts ----------------------------------------------------------------------------------

  private interruptPending(): boolean {
    const i = this.ram[INTCON];
    if (i & 0x20 && i & 0x04) return true; // T0IE & T0IF
    if (i & 0x10 && i & 0x02) return true; // INTE & INTF
    if (i & 0x08 && i & 0x01) return true; // RBIE & RBIF
    if (i & 0x40) {
      if (this.chip.has.tmr1) {
        if ((this.readAbs(PIR1) & this.ram[PIE1]) !== 0) return true;
        if (this.chip.has.adc && (this.ram[PIR2] & this.ram[PIE2]) !== 0) return true;
      } else if (this.ram[this.chip.eeAddrs.con1] & 0x10) {
        return true; // 16F84A: EEIE is INTCON<6>, EEIF is EECON1<4>
      }
    }
    return false;
  }

  /** SLEEP ends on any enabled interrupt source, even with GIE clear. */
  private wakePending(): boolean {
    return this.interruptPending();
  }

  // ---- peripherals ---------------------------------------------------------------------------------

  /** Moves the peripherals forward by `n` instruction cycles. */
  private advance(n: number): void {
    this.cycles += n;
    const opt = this.ram[OPTION];
    // Timer0 on the internal clock.
    if (!(opt & 0x20)) this.tickTimer0(n, opt);
    if (this.chip.has.tmr1) this.tickTimers12(n);
    if (this.chip.has.adc && this.adCountdown > 0 && (this.adCountdown -= n) <= 0) this.finishAdc();
    if (this.chip.has.usart) this.tickUsart();
    if (this.eeWriteDone) {
      this.eeWriteDone = false;
      if (this.chip.has.tmr1) {
        if (this.chip.has.adc) this.ram[PIR2] |= 0x10;
        else this.ram[PIR1] |= 0x80;
      } else this.ram[this.chip.eeAddrs.con1] |= 0x10;
    }
    this.updateRbIf();
  }

  private tickTimer0(n: number, opt: number): void {
    for (let i = 0; i < n; i++) {
      if (this.t0Inhibit > 0) {
        this.t0Inhibit--;
        continue;
      }
      const ratio = opt & 0x08 ? 1 : 2 << (opt & 7);
      if (++this.t0Prescale < ratio) continue;
      this.t0Prescale = 0;
      this.ram[TMR0] = (this.ram[TMR0] + 1) & 0xff;
      if (this.ram[TMR0] === 0) this.ram[INTCON] |= 0x04;
    }
  }

  private tickTimers12(n: number): void {
    // Timer1: internal clock only.
    const t1 = this.ram[T1CON];
    if (t1 & 1 && !(t1 & 2)) {
      const ratio = 1 << ((t1 >> 4) & 3);
      this.t1Sub += n;
      while (this.t1Sub >= ratio) {
        this.t1Sub -= ratio;
        this.tmr1 = (this.tmr1 + 1) & 0xffff;
        if (this.tmr1 === 0) this.ram[PIR1] |= 0x01;
      }
    }
    // Timer2 with prescaler, PR2 match and postscaler.
    const t2 = this.ram[T2CON];
    if (t2 & 4) {
      const pre = [1, 4, 16, 16][t2 & 3];
      this.t2Sub += n;
      while (this.t2Sub >= pre) {
        this.t2Sub -= pre;
        if (this.ram[TMR2] === this.ram[PR2]) {
          this.ram[TMR2] = 0;
          if (++this.t2Post > ((t2 >> 3) & 0xf)) {
            this.t2Post = 0;
            this.ram[PIR1] |= 0x02;
          }
        } else this.ram[TMR2] = (this.ram[TMR2] + 1) & 0xff;
      }
    }
  }

  private startAdc(): void {
    const ch = (this.ram[ADCON0] >> 3) & 7;
    const name = ADC_PINS[ch];
    const cfg = PCFG[this.ram[ADCON1] & 15];
    const hi = cfg.vrefP ? (this.volts.get('RA3') ?? this.vdd) : this.vdd;
    const lo = cfg.vrefM ? (this.volts.get('RA2') ?? 0) : 0;
    const v = this.volts.get(name) ?? 0;
    this.adVolts = hi > lo ? Math.min(Math.max((v - lo) / (hi - lo), 0), 1) : 0;
    // 11-12 TAD, TAD = 2, 8 or 32 Tosc (or about 4 us for the RC oscillator), in instruction cycles.
    const sel = ((this.ram[ADCON0] >> 6) & 3) | ((this.ram[ADCON1] >> 4) & 4);
    const tosc = [2, 8, 32, 0, 4, 16, 64, 0][sel];
    this.adCountdown = tosc === 0 ? Math.ceil((12 * 4e-6) * (this.clockHz / 4)) : Math.ceil((12 * tosc) / 4);
  }

  private finishAdc(): void {
    this.adCountdown = 0;
    const raw = Math.min(1023, Math.round(this.adVolts * 1023));
    if (this.ram[ADCON1] & 0x80) {
      this.ram[ADRESH] = raw >> 8;
      this.ram[ADRESL] = raw & 0xff;
    } else {
      this.ram[ADRESH] = raw >> 2;
      this.ram[ADRESL] = (raw & 3) << 6;
    }
    this.ram[ADCON0] &= ~4; // GO/DONE
    this.ram[PIR1] |= 0x40; // ADIF
  }

  // ---- USART ---------------------------------------------------------------------------------------

  /** Cycles per bit: 16 (BRGH = 0) or 4 (BRGH = 1) times SPBRG + 1, in instruction cycles. */
  private bitCycles(): number {
    return (this.ram[TXSTA] & 4 ? 4 : 16) * (this.ram[SPBRG] + 1);
  }

  private txReady(): boolean {
    return this.txHolding < 0;
  }

  private txWrite(v: number): void {
    if (!(this.ram[TXSTA] & 0x20)) return; // TXEN
    if (this.txStart < 0 && this.txHolding < 0) this.beginTx(v);
    else this.txHolding = v;
  }

  private beginTx(byte: number): void {
    this.txLastByte = byte;
    this.txFrame = (1 << 9) | (byte << 1); // start bit 0, 8 data bits LSB first, stop bit 1
    this.txStart = this.cycles;
    this.txBitCycles = this.bitCycles();
  }

  private tickUsart(): void {
    if (this.txStart >= 0 && this.cycles - this.txStart >= this.txBitCycles * 10) {
      this.onSerial(this.txLastByte);
      this.txStart = -1;
      if (this.txHolding >= 0) {
        const next = this.txHolding;
        this.txHolding = -1;
        this.beginTx(next);
      }
    }
    // Receiver: bytes scheduled by serialWrite arrive after their frame time.
    while (this.rxQueue.length && this.rxQueue[0].at <= this.cycles) {
      const { byte } = this.rxQueue.shift()!;
      if ((this.ram[RCSTA] & 0x90) !== 0x90) continue; // needs SPEN and CREN
      if (this.rxFifo.length < 2) this.rxFifo.push(byte);
      else this.ram[RCSTA] |= 2; // OERR
    }
  }

  private readRcreg(): number {
    return this.rxFifo.length ? this.rxFifo.shift()! : 0;
  }

  // ---- pin interface -------------------------------------------------------------------------------

  /** Level of the pin while the USART transmitter owns it. */
  private txLine(): boolean {
    if (this.txStart < 0) return true;
    const bit = Math.min(9, Math.floor((this.cycles - this.txStart) / this.txBitCycles));
    return ((this.txFrame >> bit) & 1) === 1;
  }

  private pwmHigh(): boolean {
    const duty = (this.ram[CCPR1L] << 2) | ((this.ram[CCP1CON] >> 4) & 3);
    if (duty === 0) return false;
    const pre = [1, 4, 16, 16][this.ram[T2CON] & 3];
    const pos = this.ram[TMR2] * 4 + Math.floor((this.t2Sub * 4) / pre);
    return pos < duty;
  }

  run(seconds: number): void {
    const want = this.carry + seconds * (this.clockHz / 4);
    let budget = Math.floor(want);
    this.carry = want - budget;
    while (budget > 0) budget -= this.step();
  }

  drive(pin: string): PinDrive | null {
    const loc = this.pinLoc.get(pin);
    if (!loc) return null;
    const { port, bit } = loc;
    const c = this.chip;
    // The USART and PWM modules take over their pins.
    if (c.has.usart && pin === c.txPin && this.ram[RCSTA] & 0x80 && this.ram[TXSTA] & 0x20) {
      return { v: this.txLine() ? this.vdd : 0, r: OUTPUT_R };
    }
    const tris = this.ram[port.tris];
    if (tris & (1 << bit)) {
      if (port.letter === 'B' && this.pullupsOn()) return { v: this.vdd, r: PULLUP_R };
      return null;
    }
    let high = ((this.latch.get(port.letter) ?? 0) >> bit) & 1 ? true : false;
    if (c.has.ccp1 && pin === c.ccp1Pin && (this.ram[CCP1CON] & 0x0c) === 0x0c) high = this.pwmHigh();
    if (pin === 'RA4') return high ? null : { v: 0, r: OUTPUT_R }; // RA4 is open-drain: it can only pull low
    return { v: high ? this.vdd : 0, r: OUTPUT_R };
  }

  setInput(pin: string, volts: number): void {
    const loc = this.pinLoc.get(pin);
    if (!loc) return;
    this.volts.set(pin, volts);
    const prev = this.level.get(pin);
    const now = volts > 0.4 * this.vdd ? true : volts < 0.16 * this.vdd ? false : (prev ?? false);
    if (now === prev) return;
    this.level.set(pin, now);
    if (prev === undefined) return; // first observation is not an edge
    if (pin === 'RB0') {
      const rising = (this.ram[OPTION] & 0x40) !== 0;
      if (now === rising && (this.ram[loc.port.tris] & 1)) this.ram[INTCON] |= 0x02; // INTF
    }
    if (pin === 'RA4' && this.ram[OPTION] & 0x20) {
      // Timer0 counts T0CKI edges (T0SE selects falling).
      const falling = (this.ram[OPTION] & 0x10) !== 0;
      if (now === !falling) this.tickTimer0External();
    }
  }

  private tickTimer0External(): void {
    const opt = this.ram[OPTION];
    const ratio = opt & 0x08 ? 1 : 2 << (opt & 7);
    if (++this.t0Prescale < ratio) return;
    this.t0Prescale = 0;
    this.ram[TMR0] = (this.ram[TMR0] + 1) & 0xff;
    if (this.ram[TMR0] === 0) this.ram[INTCON] |= 0x04;
  }

  /** RBIF: RB4-RB7 inputs differ from the value read last. */
  private updateRbIf(): void {
    const port = this.chip.ports.find((p) => p.letter === 'B');
    if (!port) return;
    const tris = this.ram[port.tris];
    let cur = 0;
    for (let b = 4; b < 8; b++) if (tris & (1 << b) && this.pinLevel(`RB${b}`)) cur |= 1 << b;
    if (!this.rbInit) {
      this.rbInit = true; // the latch starts out equal to the pins
      this.rbLatch = cur;
      return;
    }
    if ((cur ^ this.rbLatch) & (tris & 0xf0)) this.ram[INTCON] |= 0x01;
  }

  serialWrite(byte: number): void {
    if (!this.chip.has.usart) return;
    const last = this.rxQueue[this.rxQueue.length - 1];
    const start = Math.max(this.cycles, last ? last.at : 0);
    this.rxQueue.push({ at: start + this.bitCycles() * 10, byte: byte & 0xff });
  }

  // ---- test / debug access -------------------------------------------------------------------------

  get programCounter(): number {
    return this.pc;
  }

  get workingRegister(): number {
    return this.w;
  }

  /** Raw physical data memory byte (bank * 0x80 + f). */
  peek(addr: number): number {
    return this.readAbs(addr);
  }

  /** Output latch of a port letter, for tests. */
  portLatch(letter: string): number {
    return this.latch.get(letter) ?? 0;
  }
}
