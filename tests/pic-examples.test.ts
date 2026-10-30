import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Pic16, type PicChipId } from '../core/mcu/pic16';
import { assemblePic } from '../core/mcu/picasm';

const source = (name: string): string => readFileSync(resolve(__dirname, '..', 'library', 'pic', `${name}.asm`), 'utf8');
function boot(name: string, chip: PicChipId): Pic16 {
  const r = assemblePic(source(name), chip);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  return new Pic16(chip, r.hex);
}
const level = (p: Pic16, pin: string): number => p.drive(pin)?.v ?? -1;

describe('PIC example programs', () => {
  it.each([
    ['pic16f877a-blink', 'PIC16F877A', 'RB0'],
    ['pic16f628a-blink', 'PIC16F628A', 'RB4'],
    ['pic16f84a-blink', 'PIC16F84A', 'RB4'],
  ] as const)('%s blinks %s every ~0.4 s', (name, chip, pin) => {
    const p = boot(name, chip);
    const seen: number[] = [];
    for (let t = 0; t < 1.3; t += 0.1) {
      p.run(0.1);
      seen.push(level(p, pin));
    }
    expect(seen.filter((v) => v === 5).length).toBeGreaterThan(3);
    expect(seen.filter((v) => v === 0).length).toBeGreaterThan(3);
  });

  it('button example lights RD0 while RB4 is pulled low', () => {
    const p = boot('pic16f877a-button', 'PIC16F877A');
    p.run(1e-3);
    expect(p.drive('RB4')).toEqual({ v: 5, r: 50e3 }); // weak pull-up
    p.setInput('RB4', 5);
    p.run(1e-3);
    expect(level(p, 'RD0')).toBe(0);
    p.setInput('RB4', 0);
    p.run(1e-3);
    expect(level(p, 'RD0')).toBe(5);
  });

  it('ADC-to-PWM example follows the input voltage', () => {
    const p = boot('pic16f877a-adc-pwm', 'PIC16F877A');
    const duty = (volts: number): number => {
      p.setInput('RA0', volts);
      p.run(20e-3);
      let high = 0;
      for (let i = 0; i < 4000; i++) {
        p.run(1e-6 * 3);
        if (level(p, 'RC2') === 5) high++;
      }
      return high / 4000;
    };
    const low = duty(1.25);
    const mid = duty(2.5);
    const hi = duty(3.75);
    expect(low).toBeGreaterThan(0.2);
    expect(low).toBeLessThan(0.3);
    expect(mid).toBeGreaterThan(0.45);
    expect(mid).toBeLessThan(0.55);
    expect(hi).toBeGreaterThan(0.7);
    expect(hi).toBeLessThan(0.8);
  });

  it('serial example prints its greeting and counts', () => {
    const p = boot('pic16f877a-serial', 'PIC16F877A');
    let text = '';
    p.onSerial = (c) => (text += String.fromCharCode(c));
    p.run(1.2);
    expect(text.startsWith('HELLO FROM PIC 0\r\n')).toBe(true);
    expect(text).toContain('HELLO FROM PIC 1\r\n');
    expect(text).toContain('HELLO FROM PIC 2\r\n');
  });
});
