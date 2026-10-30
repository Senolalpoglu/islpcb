import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { base64ToBytes } from '../core/mcu/board';
import { RpBoard } from '../core/mcu/rp2040';
import { isUf2, parseUf2 } from '../core/mcu/uf2';

const image = (name: string): Uint8Array => base64ToBytes(readFileSync(resolve(__dirname, '..', 'library', 'arduino', name, `${name}.pico.b64`), 'utf8'));
const pico = (name: string): RpBoard => new RpBoard(image(name));

function runFor(board: RpBoard, seconds: number, each: (t: number) => void = () => {}): void {
  const dt = 100e-6;
  for (let t = 0; t < seconds; t += dt) {
    board.run(dt);
    each(t + dt);
  }
}

describe('UF2', () => {
  it('flattens blocks into a flash image and rejects other data', () => {
    const block = new Uint8Array(512);
    const v = new DataView(block.buffer);
    v.setUint32(0, 0x0a324655, true);
    v.setUint32(4, 0x9e5d5157, true);
    v.setUint32(12, 0x10000100, true); // target address
    v.setUint32(16, 4, true); // payload size
    block.set([1, 2, 3, 4], 32);
    v.setUint32(508, 0x0ab16f30, true);
    expect(isUf2(block)).toBe(true);
    const img = parseUf2(block);
    expect(img.length).toBe(0x104);
    expect(Array.from(img.subarray(0x100))).toEqual([1, 2, 3, 4]);
    expect(isUf2(new Uint8Array(512))).toBe(false);
  });
});

describe('RP2040 emulation (Raspberry Pi Pico)', () => {
  it('blinks GP13 once a second with the Arduino-Pico firmware', () => {
    const b = pico('blink');
    const seen: Array<number | undefined> = [];
    runFor(b, 1.35, (t) => {
      if ([0.3, 0.8, 1.3].some((s) => Math.abs(t - s) < 50e-6)) seen.push(b.drive('GP13')?.v);
    });
    // 3.3 V when high; the first reading may see the boot still in progress, the toggling is what matters.
    expect(seen.map((v) => (v ?? 0) > 1.6)).toEqual([true, false, true]);
  });

  it('reads the button on GP2 through the internal pull-up', () => {
    const b = pico('button');
    runFor(b, 0.1);
    expect(b.drive('GP2')).toEqual({ v: 3.3, r: 50e3 });
    b.setInput('GP2', 3.3);
    runFor(b, 0.02);
    expect(b.drive('GP13')?.v).toBe(0);
    b.setInput('GP2', 0);
    runFor(b, 0.02);
    expect(b.drive('GP13')?.v).toBe(3.3);
  });

  it('prints over USB serial', () => {
    const b = pico('serial');
    let text = '';
    b.onSerial = (c) => (text += String.fromCharCode(c));
    runFor(b, 2.5);
    expect(text).toContain('count = 1');
  });
});
