import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AvrBoard } from '../core/mcu/avr';
import { parseIntelHex } from '../core/mcu/ihex';

const hex = (name: string): string => readFileSync(resolve(__dirname, '..', 'library', 'arduino', name, `${name}.hex`), 'utf8');

/** Runs the board in 100 us slices like the co-simulation does, with a callback after each slice. */
function runFor(board: AvrBoard, seconds: number, each: (t: number) => void = () => {}): void {
  const dt = 100e-6;
  for (let t = 0; t < seconds; t += dt) {
    board.run(dt);
    each(t + dt);
  }
}

const megaHex = (name: string): string => readFileSync(resolve(__dirname, '..', 'library', 'arduino', name, `${name}.mega.hex`), 'utf8');
const mega = (name: string): AvrBoard => new AvrBoard(megaHex(name), { variant: 'atmega2560' });

describe('ATmega2560 emulation (Arduino Mega)', () => {
  it('blinks D13 (PB7) once a second', () => {
    const b = mega('blink');
    const seen: Array<number | undefined> = [];
    runFor(b, 1.3, (t) => {
      if ([0.25, 0.75, 1.25].some((s) => Math.abs(t - s) < 50e-6)) seen.push(b.drive('D13')?.v);
    });
    expect(seen).toEqual([5, 0, 5]);
  });

  it('reads the button on D2 (PE4) through the pull-up', () => {
    const b = mega('button');
    runFor(b, 0.01);
    expect(b.drive('D2')).toEqual({ v: 5, r: 35e3 });
    b.setInput('D2', 5);
    runFor(b, 0.005);
    expect(b.drive('D13')?.v).toBe(0);
    b.setInput('D2', 0);
    runFor(b, 0.005);
    expect(b.drive('D13')?.v).toBe(5);
  });

  it('prints on Serial (USART0, relocated interrupt vectors)', () => {
    const b = mega('serial');
    let text = '';
    b.onSerial = (c) => (text += String.fromCharCode(c));
    runFor(b, 1.2);
    expect(text.startsWith('Hello from ISL PCB!\r\n')).toBe(true);
    expect(text).toContain('count = 1\r\n');
  });

  it('digitises A0 (PF0) and mirrors it as PWM on D9 (PH6, timer 2B)', () => {
    const b = mega('analog');
    let text = '';
    b.onSerial = (c) => (text += String.fromCharCode(c));
    b.setInput('A0', 2.5);
    let sum = 0;
    let n = 0;
    runFor(b, 1, (t) => {
      if (t > 0.5) {
        sum += b.drive('D9')?.v ?? 0;
        n++;
      }
    });
    const reading = Number(/A0 = (\d+)/.exec(text)![1]);
    expect(reading).toBeGreaterThan(508);
    expect(reading).toBeLessThan(516);
    expect(sum / n).toBeGreaterThan(2.3);
    expect(sum / n).toBeLessThan(2.7);
  });

  it('reads the upper analog bank (A9 uses MUX5)', () => {
    const b = mega('analog');
    expect(b.pinNames).toContain('A15');
    expect(b.pinNames).toContain('D53');
    expect(b.pinNames.length).toBe(54 + 16);
  });
});

describe('Intel HEX', () => {
  it('rejects a corrupted record', () => {
    expect(() => parseIntelHex(':0100000000FF\n')).not.toThrow(); // valid: 00 + checksum FF
    expect(() => parseIntelHex(':0100000000FE\n')).toThrow(/Checksum/);
  });
});

describe('ATmega328P emulation', () => {
  it('blinks D13 once a second (500 ms high, 500 ms low)', () => {
    const b = new AvrBoard(hex('blink'));
    const samples: Array<[number, number | undefined]> = [];
    runFor(b, 1.3, (t) => {
      if ([0.25, 0.75, 1.25].some((s) => Math.abs(t - s) < 50e-6)) samples.push([t, b.drive('D13')?.v]);
    });
    expect(samples.map((s) => s[1])).toEqual([5, 0, 5]);
  });

  it('leaves a pin high-impedance until the sketch makes it an output', () => {
    const b = new AvrBoard(hex('blink'));
    expect(b.drive('D13')).toBeNull();
    expect(b.drive('D2')).toBeNull();
  });

  it('reads a button through the internal pull-up', () => {
    const b = new AvrBoard(hex('button'));
    runFor(b, 0.01);
    expect(b.drive('D2')).toEqual({ v: 5, r: 35e3 }); // pull-up enabled
    b.setInput('D2', 5); // released
    runFor(b, 0.005);
    expect(b.drive('D13')?.v).toBe(0);
    b.setInput('D2', 0); // pressed: the switch pulls the pin to ground
    runFor(b, 0.005);
    expect(b.drive('D13')?.v).toBe(5);
    b.setInput('D2', 5);
    runFor(b, 0.005);
    expect(b.drive('D13')?.v).toBe(0);
  });

  it('prints to Serial at 9600 baud', () => {
    const b = new AvrBoard(hex('serial'));
    let text = '';
    b.onSerial = (c) => (text += String.fromCharCode(c));
    runFor(b, 1.2);
    expect(text.startsWith('Hello from ISL PCB!\r\n')).toBe(true);
    expect(text).toContain('count = 0\r\n');
    expect(text).toContain('count = 1\r\n');
  });

  it('converts A0 with the ADC and mirrors it as a PWM duty cycle', () => {
    const b = new AvrBoard(hex('analog'));
    let text = '';
    b.onSerial = (c) => (text += String.fromCharCode(c));
    b.setInput('A0', 2.5);
    let sum = 0;
    let n = 0;
    runFor(b, 1, (t) => {
      if (t > 0.5) {
        sum += b.drive('D9')?.v ?? 0;
        n++;
      }
    });
    const reading = Number(/A0 = (\d+)/.exec(text)![1]);
    expect(reading).toBeGreaterThan(508);
    expect(reading).toBeLessThan(516); // 2.5 V / 5 V * 1023 = 511.5
    expect(sum / n).toBeGreaterThan(2.3); // average of the PWM output ~ 2.5 V
    expect(sum / n).toBeLessThan(2.7);
  });

  it('fades D9 with a changing duty cycle', () => {
    const b = new AvrBoard(hex('fade'));
    const duty: number[] = [];
    let acc = 0;
    let n = 0;
    runFor(b, 1.6, () => {
      acc += b.drive('D9')?.v ?? 0;
      n++;
      if (n === 1000) {
        duty.push(acc / n);
        acc = 0;
        n = 0;
      }
    });
    expect(Math.max(...duty) - Math.min(...duty)).toBeGreaterThan(2); // ramps through most of 0..5 V
  });
});
