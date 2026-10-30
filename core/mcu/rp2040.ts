// Raspberry Pi Pico (RP2040) board on top of rp2040js: dual-core is not modelled, one Cortex-M0+ core
// runs the firmware image (Arduino-Pico, Pico SDK or MicroPython) from flash.

import { GPIOPinState, Simulator, USBCDC, type Logger } from 'rp2040js';
import { BOOTROM_B1_BASE64 } from './bootrom';
import { base64ToBytes, type McuBoard, type PinDrive } from './board';

const FLASH_BASE = 0x10000000;
const VCC = 3.3;
const OUTPUT_R = 50; // pad drive strength: a few tens of ohms at the default 4 mA setting
const PULL_R = 50e3; // internal pull-up / pull-down, about 50-80 k

/** Pico header names that carry a GPIO. GP26-GP28 are also ADC inputs 0-2. */
export const PICO_GPIOS: readonly string[] = [...Array.from({ length: 23 }, (_, i) => `GP${i}`), 'GP26', 'GP27', 'GP28'];

/** The emulator logs every unimplemented register the boot code touches; none of that is useful to a user. */
const SILENT: Logger = { debug() {}, warn() {}, error() {}, info() {} };

const gpioIndex = (pin: string): number => {
  const m = /^GP(\d+)$/.exec(pin);
  return m ? Number(m[1]) : -1;
};

function bootrom(): Uint32Array {
  const bytes = base64ToBytes(BOOTROM_B1_BASE64);
  const words = new Uint32Array(bytes.length / 4);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < words.length; i++) words[i] = v.getUint32(i * 4, true);
  return words;
}

export class RpBoard implements McuBoard {
  readonly vcc = VCC;
  onSerial: (byte: number) => void = () => {};
  private readonly sim = new Simulator();
  private readonly cdc: USBCDC;
  private readonly levels = new Map<string, boolean>();

  /** `image` is the flat flash contents starting at 0x10000000 (what a .bin file holds). */
  constructor(image: Uint8Array) {
    const mcu = this.sim.rp2040;
    mcu.logger = SILENT;
    mcu.loadBootrom(bootrom()); // also resets the chip, so the flash must be loaded afterwards
    mcu.flash.set(image.subarray(0, mcu.flash.length));

    mcu.uart[0].onByte = (b) => this.onSerial(b);
    this.cdc = new USBCDC(mcu.usbCtrl);
    this.cdc.onSerialData = (buf) => {
      for (const b of buf) this.onSerial(b);
    };

    // Skip the boot ROM's flash boot sequence (it needs real QSPI hardware) and start at the second-stage
    // loader in flash, with the stack pointer the vector table asks for.
    const sp = new DataView(mcu.flash.buffer, mcu.flash.byteOffset, mcu.flash.byteLength).getUint32(0x100, true);
    if (sp) mcu.core.SP = sp;
    mcu.core.PC = FLASH_BASE;
  }

  run(seconds: number): void {
    const { clock, rp2040: mcu } = this.sim;
    const core = mcu.core;
    const end = clock.nanos + seconds * 1e9;
    const cycleNanos = 1e9 / (mcu.clkSys > 0 ? mcu.clkSys : 125e6);
    while (clock.nanos < end) {
      if (core.waiting) {
        // Sleeping in WFI/WFE: jump straight to the next timer event instead of burning cycles.
        clock.tick(Math.max(1, Math.min(clock.nanosToNextAlarm, end - clock.nanos)));
      } else {
        clock.tick(core.executeInstruction() * cycleNanos);
      }
    }
  }

  drive(pin: string): PinDrive | null {
    const n = gpioIndex(pin);
    const g = n >= 0 ? this.sim.rp2040.gpio[n] : undefined;
    if (!g) return null;
    switch (g.value) {
      case GPIOPinState.High:
        return { v: VCC, r: OUTPUT_R };
      case GPIOPinState.Low:
        return { v: 0, r: OUTPUT_R };
      case GPIOPinState.InputPullUp:
        return { v: VCC, r: PULL_R };
      case GPIOPinState.InputPullDown:
        return { v: 0, r: PULL_R };
      default:
        return null;
    }
  }

  setInput(pin: string, volts: number): void {
    const n = gpioIndex(pin);
    const mcu = this.sim.rp2040;
    const g = n >= 0 ? mcu.gpio[n] : undefined;
    if (!g) return;
    const prev = this.levels.get(pin) ?? false;
    const high = volts > 0.6 * VCC ? true : volts < 0.3 * VCC ? false : prev;
    if (high !== prev || !this.levels.has(pin)) {
      this.levels.set(pin, high);
      g.setInputValue(high);
    }
    if (n >= 26 && n <= 28) mcu.adc.channelValues[n - 26] = Math.round(Math.min(Math.max(volts / VCC, 0), 1) * 4095);
  }

  serialWrite(byte: number): void {
    this.sim.rp2040.uart[0].feedByte(byte);
    try {
      this.cdc.sendSerialByte(byte);
    } catch {
      /* USB not enumerated yet */
    }
  }
}
