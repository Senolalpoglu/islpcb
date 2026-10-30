// AVR boards on top of avr8js: ATmega328P (Arduino Uno / Nano / Pro Mini) and ATmega2560 (Mega 2560).
// The board knows nothing about the circuit: it exposes what each pin is driving and accepts
// the voltage the circuit puts on each pin. The co-simulation loop (src/sim) joins the two.

import {
  ADCMuxInputType,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portAConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  portEConfig,
  portFConfig,
  portGConfig,
  portHConfig,
  portJConfig,
  portKConfig,
  portLConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  usart0Config,
  type ADCConfig,
  type AVRPortConfig,
  type AVRTimerConfig,
} from 'avr8js';
import type { McuBoard, PinDrive } from './board';
import { parseIntelHex } from './ihex';

export type { PinDrive };
export type AvrVariant = 'atmega328p' | 'atmega2560';

interface PinLoc {
  port: string;
  bit: number;
  /** ADC channel when the pin is an analog input. */
  adc?: number;
}

const PORT_CONFIGS: Record<string, AVRPortConfig> = {
  A: portAConfig, B: portBConfig, C: portCConfig, D: portDConfig, E: portEConfig, F: portFConfig,
  G: portGConfig, H: portHConfig, J: portJConfig, K: portKConfig, L: portLConfig,
};

// ---- ATmega328P ----------------------------------------------------------------------------
const PINS_328: Record<string, PinLoc> = {};
for (let i = 0; i <= 7; i++) PINS_328[`D${i}`] = { port: 'D', bit: i };
for (let i = 8; i <= 13; i++) PINS_328[`D${i}`] = { port: 'B', bit: i - 8 };
for (let i = 0; i <= 5; i++) PINS_328[`A${i}`] = { port: 'C', bit: i, adc: i };

// ---- ATmega2560 (Arduino Mega pin names) -------------------------------------------------------
const PINS_2560: Record<string, PinLoc> = {};
{
  const digital: Array<[number, string, number]> = [
    [0, 'E', 0], [1, 'E', 1], [2, 'E', 4], [3, 'E', 5], [4, 'G', 5], [5, 'E', 3], [6, 'H', 3], [7, 'H', 4],
    [8, 'H', 5], [9, 'H', 6], [10, 'B', 4], [11, 'B', 5], [12, 'B', 6], [13, 'B', 7], [14, 'J', 1], [15, 'J', 0],
    [16, 'H', 1], [17, 'H', 0], [18, 'D', 3], [19, 'D', 2], [20, 'D', 1], [21, 'D', 0],
    [38, 'D', 7], [39, 'G', 2], [40, 'G', 1], [41, 'G', 0],
    [50, 'B', 3], [51, 'B', 2], [52, 'B', 1], [53, 'B', 0],
  ];
  for (const [n, port, bit] of digital) PINS_2560[`D${n}`] = { port, bit };
  for (let i = 0; i < 8; i++) PINS_2560[`D${22 + i}`] = { port: 'A', bit: i }; // D22-D29: PA0-PA7
  for (let i = 0; i < 8; i++) PINS_2560[`D${30 + i}`] = { port: 'C', bit: 7 - i }; // D30-D37: PC7-PC0
  for (let i = 0; i < 8; i++) PINS_2560[`D${42 + i}`] = { port: 'L', bit: 7 - i }; // D42-D49: PL7-PL0
  for (let i = 0; i < 8; i++) PINS_2560[`A${i}`] = { port: 'F', bit: i, adc: i };
  for (let i = 0; i < 8; i++) PINS_2560[`A${8 + i}`] = { port: 'K', bit: i, adc: 8 + i };
}

const PIN_TABLES: Record<AvrVariant, Record<string, PinLoc>> = { atmega328p: PINS_328, atmega2560: PINS_2560 };

export const avrPins = (variant: AvrVariant): readonly string[] => Object.keys(PIN_TABLES[variant]);

// ATmega2560 interrupt vectors are word addresses 2 * (vector number - 1); the timers and USART0 move
// relative to the ATmega328P, and timers 3, 4 and 5 only exist on this chip.
const mega16bit = (base: number, tifr: number, timsk: number, vec: number, pa: [string, number], pb: [string, number], pc: [string, number]): AVRTimerConfig => ({
  ...timer1Config,
  captureInterrupt: vec,
  compAInterrupt: vec + 2,
  compBInterrupt: vec + 4,
  compCInterrupt: vec + 6,
  ovfInterrupt: vec + 8,
  TIFR: tifr,
  TIMSK: timsk,
  TCCRA: base,
  TCCRB: base + 1,
  TCCRC: base + 2,
  TCNT: base + 4,
  ICR: base + 6,
  OCRA: base + 8,
  OCRB: base + 10,
  OCRC: base + 12,
  OCFC: 8,
  OCIEC: 8,
  compPortA: PORT_CONFIGS[pa[0]].PORT,
  compPinA: pa[1],
  compPortB: PORT_CONFIGS[pb[0]].PORT,
  compPinB: pb[1],
  compPortC: PORT_CONFIGS[pc[0]].PORT,
  compPinC: pc[1],
  externalClockPort: 0,
  externalClockPin: 0,
});

const MEGA_TIMERS: AVRTimerConfig[] = [
  { ...timer0Config, compAInterrupt: 0x2a, compBInterrupt: 0x2c, ovfInterrupt: 0x2e, compPortA: portBConfig.PORT, compPinA: 7, compPortB: portGConfig.PORT, compPinB: 5, externalClockPort: 0, externalClockPin: 0 },
  mega16bit(0x80, 0x36, 0x6f, 0x20, ['B', 5], ['B', 6], ['B', 7]), // timer 1
  { ...timer2Config, compAInterrupt: 0x1a, compBInterrupt: 0x1c, ovfInterrupt: 0x1e, compPortA: portBConfig.PORT, compPinA: 4, compPortB: portHConfig.PORT, compPinB: 6 },
  mega16bit(0x90, 0x38, 0x71, 0x3e, ['E', 3], ['E', 4], ['E', 5]), // timer 3
  mega16bit(0xa0, 0x39, 0x72, 0x52, ['H', 3], ['H', 4], ['H', 5]), // timer 4
  mega16bit(0x120, 0x3a, 0x73, 0x5c, ['L', 3], ['L', 4], ['L', 5]), // timer 5
];

const MEGA_ADC: ADCConfig = {
  ...adcConfig,
  adcInterrupt: 0x3a,
  numChannels: 16,
  muxInputMask: 0x3f,
  muxChannels: {
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { type: ADCMuxInputType.SingleEnded, channel: i }])),
    ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [0x20 + i, { type: ADCMuxInputType.SingleEnded, channel: 8 + i }])),
  },
};

const MEGA_USART0 = { ...usart0Config, rxCompleteInterrupt: 0x32, dataRegisterEmptyInterrupt: 0x34, txCompleteInterrupt: 0x36 };

const OUTPUT_R = 25; // typical AVR pin output resistance
const PULLUP_R = 35e3; // internal pull-up, 20-50 k in the datasheet

export class AvrBoard implements McuBoard {
  readonly cpu: CPU;
  readonly vcc: number;
  readonly variant: AvrVariant;
  private readonly pins: Record<string, PinLoc>;
  private readonly clockHz: number;
  private readonly ports = new Map<string, AVRIOPort>();
  private readonly adc: AVRADC;
  private readonly usart: AVRUSART;
  private readonly levels = new Map<string, boolean>();
  private carry = 0;
  /** Called with every byte the sketch writes to Serial. */
  onSerial: (byte: number) => void = () => {};

  constructor(hex: string, opts: { clockHz?: number; vcc?: number; variant?: AvrVariant } = {}) {
    this.variant = opts.variant ?? 'atmega328p';
    this.clockHz = opts.clockHz ?? 16e6;
    this.vcc = opts.vcc ?? 5;
    this.pins = PIN_TABLES[this.variant];
    const mega = this.variant === 'atmega2560';

    const program = new Uint16Array(mega ? 0x20000 : 0x4000); // 256 KB / 32 KB of flash
    const bytes = new Uint8Array(program.buffer);
    for (const [addr, data] of parseIntelHex(hex)) {
      if (addr < bytes.length) bytes[addr] = data;
    }
    // The Mega's I/O space is 0x200 bytes (avr8js reserves 0x100), so give it extra data memory.
    this.cpu = new CPU(program, mega ? 0x2200 : 8192);

    for (const cfg of mega ? MEGA_TIMERS : [timer0Config, timer1Config, timer2Config]) new AVRTimer(this.cpu, cfg);
    const letters = mega ? ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L'] : ['B', 'C', 'D'];
    for (const l of letters) this.ports.set(l, new AVRIOPort(this.cpu, PORT_CONFIGS[l]));

    this.adc = new AVRADC(this.cpu, mega ? MEGA_ADC : adcConfig);
    this.adc.avcc = this.vcc;
    this.usart = new AVRUSART(this.cpu, mega ? MEGA_USART0 : usart0Config, this.clockHz);
    this.usart.onByteTransmit = (b) => this.onSerial(b);
  }

  /** Pin names this board understands. */
  get pinNames(): readonly string[] {
    return Object.keys(this.pins);
  }

  /** Runs the CPU for `seconds` of simulated time. */
  run(seconds: number): void {
    const want = this.carry + seconds * this.clockHz;
    const whole = Math.floor(want);
    this.carry = want - whole;
    const end = this.cpu.cycles + whole;
    const cpu = this.cpu;
    while (cpu.cycles < end) {
      avrInstruction(cpu);
      cpu.tick();
    }
    this.feedSerial();
  }

  /** What the pin currently drives, or null when it is an input without pull-up. */
  drive(pin: string): PinDrive | null {
    const loc = this.pins[pin];
    const port = loc && this.ports.get(loc.port);
    if (!loc || !port) return null;
    switch (port.pinState(loc.bit)) {
      case PinState.High:
        return { v: this.vcc, r: OUTPUT_R };
      case PinState.Low:
        return { v: 0, r: OUTPUT_R };
      case PinState.InputPullUp:
        return { v: this.vcc, r: PULLUP_R };
      default:
        return null;
    }
  }

  /** Tells the board what voltage the circuit presents on a pin (digital threshold + ADC). */
  setInput(pin: string, volts: number): void {
    const loc = this.pins[pin];
    const port = loc && this.ports.get(loc.port);
    if (!loc || !port) return;
    // Schmitt-trigger style thresholds around 0.3 / 0.6 of Vcc.
    const prev = this.levels.get(pin) ?? false;
    const high = volts > 0.6 * this.vcc ? true : volts < 0.3 * this.vcc ? false : prev;
    if (high !== prev || !this.levels.has(pin)) {
      this.levels.set(pin, high);
      port.setPin(loc.bit, high);
    }
    if (loc.adc !== undefined) this.adc.channelValues[loc.adc] = Math.min(Math.max(volts, 0), this.vcc);
  }

  /** Bytes waiting to be received: the USART takes one at a time, one frame time apart. */
  private readonly rxQueue: number[] = [];

  /** Sends a byte to the sketch's Serial.read(). Bytes sent faster than the baud rate wait in a queue (up to 4 KB). */
  serialWrite(byte: number): void {
    if (this.rxQueue.length < 4096) this.rxQueue.push(byte & 0xff);
    this.feedSerial();
  }

  private feedSerial(): void {
    while (this.rxQueue.length > 0 && !this.usart.rxBusy) {
      if (this.usart.writeByte(this.rxQueue[0]) === false) break; // the receiver is off (Serial.begin has not run) or full
      this.rxQueue.shift();
    }
  }
}
