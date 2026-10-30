// PIC example programs (assembly source in library/pic) and the in-app assembler entry point.

import type { Key } from '../i18n';
import { assemblePic, type AsmResult } from '../../core/mcu/picasm';
import type { PicChipId } from '../../core/mcu/pic16';
import adc877 from '../../library/pic/pic16f877a-adc-pwm.asm?raw';
import blink628 from '../../library/pic/pic16f628a-blink.asm?raw';
import blink84 from '../../library/pic/pic16f84a-blink.asm?raw';
import blink877 from '../../library/pic/pic16f877a-blink.asm?raw';
import button877 from '../../library/pic/pic16f877a-button.asm?raw';
import serial877 from '../../library/pic/pic16f877a-serial.asm?raw';

export interface PicProgram {
  id: string;
  label: Key;
  source: string;
}

export const PIC_PROGRAMS: Record<PicChipId, PicProgram[]> = {
  PIC16F84A: [{ id: 'blink', label: 'pic.blink', source: blink84 }],
  PIC16F628A: [{ id: 'blink', label: 'pic.blink', source: blink628 }],
  PIC16F877A: [
    { id: 'blink', label: 'pic.blink', source: blink877 },
    { id: 'button', label: 'pic.button', source: button877 },
    { id: 'adc-pwm', label: 'pic.adcpwm', source: adc877 },
    { id: 'serial', label: 'pic.serial', source: serial877 },
  ],
};

export const picProgramById = (chip: PicChipId, id: string): PicProgram => PIC_PROGRAMS[chip].find((p) => p.id === id) ?? PIC_PROGRAMS[chip][0];

const cache = new Map<string, AsmResult>();

/** Assembles a program, remembering the result: examples are assembled once per session. */
export function assembleCached(chip: PicChipId, source: string): AsmResult {
  const key = `${chip}\n${source}`;
  let r = cache.get(key);
  if (!r) {
    r = assemblePic(source, chip);
    cache.set(key, r);
  }
  return r;
}
