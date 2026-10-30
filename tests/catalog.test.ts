import { describe, expect, it } from 'vitest';
import { BOARDS, boardById, boardSimLevel } from '../core/mcu/boards';
import { MCUS, mcuById } from '../core/mcu/mcus';

describe('MCU catalog', () => {
  it('has unique ids', () => {
    expect(new Set(MCUS.map((m) => m.id)).size).toBe(MCUS.length);
  });

  it('covers the PIC families', () => {
    const cores = new Set(MCUS.map((m) => m.core));
    for (const c of ['pic-baseline12', 'pic-midrange14', 'pic-enhanced14', 'pic18', 'pic24', 'pic32'] as const) {
      expect(cores.has(c)).toBe(true);
    }
    const pics = MCUS.filter((m) => m.id.toUpperCase().includes('PIC'));
    expect(pics.length).toBeGreaterThanOrEqual(80);
  });

  it('describes sane memory sizes and pin counts', () => {
    for (const m of MCUS) {
      expect(m.ram, m.id).toBeGreaterThan(0);
      expect(m.pins, m.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Board catalog', () => {
  it('has unique ids and every board points at a known MCU', () => {
    expect(new Set(BOARDS.map((b) => b.id)).size).toBe(BOARDS.length);
    for (const b of BOARDS) expect(mcuById(b.mcu), `${b.id} -> ${b.mcu}`).toBeDefined();
  });

  it('includes the boards that were asked for explicitly', () => {
    expect(boardById('mega-2560-pro')?.mcu).toBe('ATmega2560');
    expect(boardById('rpi-pico-w')?.mcu).toBe('RP2040');
    expect(boardById('rpi-pico-2-w')?.mcu).toBe('RP2350');
    expect(BOARDS.length).toBeGreaterThanOrEqual(50);
  });

  it('only lets boards with an emulator core run code', () => {
    expect(boardSimLevel(boardById('arduino-uno-r3')!)).toBe('p2');
    expect(boardSimLevel(boardById('rpi-pico-w')!)).toBe('p2');
    expect(boardSimLevel(boardById('arduino-portenta-h7')!)).toBe('pinout');
    expect(boardSimLevel(boardById('rpi-zero-2-w')!)).toBe('pinout');
  });
});
