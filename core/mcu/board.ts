/** What the co-simulation needs from any emulated microcontroller board. */

/** What a pin does to its net: a voltage behind a series resistance, or nothing (high impedance). */
export interface PinDrive {
  v: number;
  r: number;
}

export interface McuBoard {
  /** Runs the firmware for `seconds` of simulated time. */
  run(seconds: number): void;
  /** What the pin currently drives, or null when it is a plain input. */
  drive(pin: string): PinDrive | null;
  /** Tells the board the voltage the circuit presents on a pin. */
  setInput(pin: string, volts: number): void;
  /** Sends a byte to the firmware's serial input. */
  serialWrite(byte: number): void;
  /** Called with every byte the firmware prints on its serial port. */
  onSerial: (byte: number) => void;
}

/** Binary <-> base64 for firmware images stored inside a project file. */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(text: string): Uint8Array {
  const s = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
