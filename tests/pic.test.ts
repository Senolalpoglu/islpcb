import { describe, expect, it } from 'vitest';
import { Pic16, type PicChipId } from '../core/mcu/pic16';
import { assemblePic } from '../core/mcu/picasm';

/** Assembles for a chip and returns the emulator, failing the test on assembler errors. */
function boot(chip: PicChipId, source: string, opts: { clockHz?: number } = {}): Pic16 {
  const r = assemblePic(source, chip);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  return new Pic16(chip, r.hex, opts);
}

const words = (source: string, chip: PicChipId = 'PIC16F877A'): number[] => {
  const r = assemblePic(source, chip);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  const out: number[] = [];
  for (const line of r.hex.trim().split('\n')) {
    if (line.slice(7, 9) !== '00') continue;
    const n = parseInt(line.slice(1, 3), 16);
    for (let i = 0; i < n; i += 2) out.push(parseInt(line.slice(9 + i * 2, 11 + i * 2), 16) | (parseInt(line.slice(11 + i * 2, 13 + i * 2), 16) << 8));
  }
  return out;
};

describe('PIC assembler', () => {
  it('encodes the instruction set like MPASM', () => {
    expect(
      words(`
        org 0
        movlw 0x55
        movwf PORTB
        bsf STATUS,RP0
        bcf STATUS,RP0
        addwf 0x20,w
        decfsz 0x20,f
        retlw 5
        clrf 0x21
        clrw
        goto $
        call 3
        btfsc STATUS,Z
        sublw 1
        swapf 0x22,w
        xorwf 0x23
        nop
        return
        retfie
        sleep
        clrwdt
      `),
    ).toEqual([
      0x3055, 0x0086, 0x1683, 0x1283, 0x0720, 0x0ba0, 0x3405, 0x01a1, 0x0100, 0x2809, 0x2003, 0x1903, 0x3c01, 0x0e22, 0x06a3,
      0x0000, 0x0008, 0x0009, 0x0063, 0x0064,
    ]);
  });

  it('resolves labels, EQU, CBLOCK, #define, expressions and number forms', () => {
    const w = words(`
        #include <p16f877a.inc>
        radix dec
LED     equ 3
        #define BUTTON PORTB,1
        cblock 0x20
          count
          temp:2
          last
        endc
        org 0
start   movlw D'10'
        movwf count
        movlw H'FF' & ~B'00001111'
        movlw high start
        movlw low (start + .2)
        bsf PORTB,LED
        btfss BUTTON
        movlw 'A'
        goto start
        dt "OK"
        dw 0x1234
    `);
    expect(w[0]).toBe(0x300a);
    expect(w[1]).toBe(0x00a0); // movwf count (0x20)
    expect(w[2]).toBe(0x30f0);
    expect(w[3]).toBe(0x3000);
    expect(w[4]).toBe(0x3002);
    expect(w[5]).toBe(0x1586); // bsf PORTB,3
    expect(w[6]).toBe(0x1c86 | (1 << 7)); // btfss PORTB,1
    expect(w[7]).toBe(0x3041);
    expect(w[8]).toBe(0x2800);
    expect(w.slice(9)).toEqual([0x344f, 0x344b, 0x1234]);
  });

  it('treats bare numbers as hexadecimal until RADIX DEC, like MPASM', () => {
    expect(words('movlw 20\n radix dec\n movlw 20')).toEqual([0x3020, 0x3014]);
  });

  it('reports errors with line numbers', () => {
    const r = assemblePic('  movlw 0x100\n  frobnicate 3\n  goto nowhere\n  bsf STATUS,9\n', 'PIC16F877A');
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.line)).toEqual([1, 2, 3, 4]);
    expect(r.errors[2].message).toMatch(/nowhere/);
  });
});

describe('PIC16 core', () => {
  it('runs a loop and computes a sum (flags, DECFSZ, GOTO, RAM)', () => {
    const p = boot(
      'PIC16F877A',
      `
        cblock 0x20
          sum
          n
        endc
        org 0
        clrf sum
        movlw .10
        movwf n
loop    movf n,w
        addwf sum,f
        decfsz n,f
        goto loop
done    goto done
      `,
    );
    p.run(1e-3);
    expect(p.peek(0x20)).toBe(55);
    expect(p.peek(0x21)).toBe(0);
  });

  it('sets C, DC and Z like the datasheet for add and subtract', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        movlw 0xFF
        addlw 1          ; 0xFF + 1 = 0x00: C, DC, Z set
        movwf 0x20
        movf STATUS,w
        movwf 0x21
        movlw 5
        sublw 3          ; 3 - 5: borrow, so C = 0
        movf STATUS,w
        movwf 0x22
done    goto done
      `,
    );
    p.run(1e-3);
    expect(p.peek(0x20)).toBe(0);
    expect(p.peek(0x21) & 7).toBe(7);
    expect(p.peek(0x22) & 1).toBe(0);
  });

  it('drives PORTB through TRISB and reads inputs, with weak pull-ups', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw 0xF0
        movwf TRISB      ; RB0-3 outputs, RB4-7 inputs
        bcf OPTION_REG,NOT_RBPU
        bcf STATUS,RP0
        movlw 0x05
        movwf PORTB
loop    movf PORTB,w
        movwf 0x20
        goto loop
      `,
    );
    p.run(1e-3);
    expect(p.drive('RB0')).toEqual({ v: 5, r: 40 });
    expect(p.drive('RB1')).toEqual({ v: 0, r: 40 });
    expect(p.drive('RB2')).toEqual({ v: 5, r: 40 });
    expect(p.drive('RB4')).toEqual({ v: 5, r: 50e3 }); // weak pull-up
    p.setInput('RB4', 0);
    p.run(1e-3);
    expect(p.peek(0x20) >> 4).toBe(0b1110);
  });

  it('services a Timer0 overflow interrupt and returns with RETFIE', () => {
    const p = boot(
      'PIC16F877A',
      `
        cblock 0x20
          ticks
          wsave
          ssave
        endc
        org 0
        goto main
        org 4
        movwf wsave
        swapf STATUS,w
        movwf ssave
        incf ticks,f
        bcf INTCON,T0IF
        swapf ssave,w
        movwf STATUS
        swapf wsave,f
        swapf wsave,w
        retfie
main    bsf STATUS,RP0
        movlw B'00000111'  ; internal clock, prescaler 1:256 on Timer0
        movwf OPTION_REG
        bcf STATUS,RP0
        movlw B'10100000'  ; GIE, T0IE
        movwf INTCON
spin    goto spin
      `,
    );
    p.run(1); // 1 s at 4 MHz: one overflow every 256 * 256 us = 65.536 ms
    expect(p.peek(0x20)).toBe(15);
  });

  it('converts the ADC with left-justified result and raises ADIF', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw 0x0E          ; AN0 analog only, left justified
        movwf ADCON1
        bcf STATUS,RP0
        movlw B'01000001'   ; Fosc/8, channel 0, ADC on
        movwf ADCON0
        bsf ADCON0,GO
wait    btfsc ADCON0,GO
        goto wait
        movf ADRESH,w
        movwf 0x20
        btfsc PIR1,ADIF
        bsf 0x21,0
done    goto done
      `,
    );
    p.setInput('RA0', 2.5);
    p.run(2e-3);
    expect(p.peek(0x20)).toBeGreaterThanOrEqual(127);
    expect(p.peek(0x20)).toBeLessThanOrEqual(128);
    expect(p.peek(0x21) & 1).toBe(1);
  });

  it('reads analog pins as 0 until ADCON1 makes them digital', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        movf PORTA,w
        movwf 0x20          ; PCFG = 0 after reset: RA0 is analog
        bsf STATUS,RP0
        movlw 0x06
        movwf ADCON1
        bcf STATUS,RP0
        movf PORTA,w
        movwf 0x21
done    goto done
      `,
    );
    p.setInput('RA0', 5);
    p.setInput('RA0', 5);
    p.run(1e-3);
    expect(p.peek(0x20) & 1).toBe(0);
    expect(p.peek(0x21) & 1).toBe(1);
  });

  it('transmits bytes on the USART at 9600 baud', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw .25           ; 4 MHz, BRGH = 1: 9615 baud
        movwf SPBRG
        movlw B'00100100'   ; TXEN, BRGH
        movwf TXSTA
        bcf STATUS,RP0
        bsf RCSTA,SPEN
        movlw 'H'
        movwf TXREG
        movlw 'i'
        movwf TXREG
done    goto done
      `,
    );
    let text = '';
    p.onSerial = (c) => (text += String.fromCharCode(c));
    p.run(5e-3);
    expect(text).toBe('Hi');
  });

  it('shows the serial frame on the TX pin: start bit, data and stop bit', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw .25
        movwf SPBRG
        movlw B'00100100'
        movwf TXSTA
        bcf STATUS,RP0
        bsf RCSTA,SPEN
        movlw 0x55
        movwf TXREG
done    goto done
      `,
    );
    const levels: number[] = [];
    for (let i = 0; i < 12; i++) {
      p.run(1 / 9615 / 2); // sample twice per bit
      levels.push(p.drive('RC6')?.v === 5 ? 1 : 0);
    }
    expect(levels[1]).toBe(0); // start bit
    expect(levels[3]).toBe(1); // bit 0 of 0x55
    expect(levels[5]).toBe(0);
    expect(levels[7]).toBe(1);
  });

  it('receives bytes into RCREG', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw .25
        movwf SPBRG
        movlw B'00000100'
        movwf TXSTA
        bcf STATUS,RP0
        movlw B'10010000'   ; SPEN, CREN
        movwf RCSTA
wait    btfss PIR1,RCIF
        goto wait
        movf RCREG,w
        movwf 0x20
done    goto done
      `,
    );
    p.run(1e-3);
    p.serialWrite(0x42);
    p.run(5e-3);
    expect(p.peek(0x20)).toBe(0x42);
  });

  it('generates PWM on CCP1 with the requested duty cycle', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        bcf TRISC,2
        movlw .249          ; PR2 = 249: 1 kHz at 4 MHz with 1:4 prescaler
        movwf PR2
        bcf STATUS,RP0
        movlw .62           ; duty 62.5 / 250 = 25 % (CCPR1L = 62, DC1B = 10b)
        movwf CCPR1L
        movlw B'00101100'
        movwf CCP1CON
        movlw B'00000101'   ; Timer2 on, prescaler 4
        movwf T2CON
done    goto done
      `,
    );
    p.run(5e-3);
    let high = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      p.run(1e-6 * 2.5);
      if ((p.drive('RC2')?.v ?? 0) > 2.5) high++;
    }
    expect(high / n).toBeGreaterThan(0.2);
    expect(high / n).toBeLessThan(0.3);
  });

  it('keeps RA4 open-drain and reads/writes data EEPROM', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        bcf TRISA,4
        bcf STATUS,RP0
        bsf PORTA,4
        movlw 0x07
        bsf STATUS,RP1
        movwf EEADR
        movlw 0xA5
        movwf EEDATA
        bsf STATUS,RP0
        bsf EECON1,WREN
        bsf EECON1,WR
        bcf STATUS,RP0
        clrf EEDATA
        bsf STATUS,RP0
        bsf EECON1,RD
        bcf STATUS,RP0
        movf EEDATA,w
        bcf STATUS,RP1
        movwf 0x20
done    goto done
      `,
    );
    p.run(1e-3);
    expect(p.drive('RA4')).toBeNull(); // high on an open-drain pin is released
    expect(p.peek(0x20)).toBe(0xa5);
    expect(p.eeprom[7]).toBe(0xa5);
  });

  it('computes a jump with ADDWF PCL and returns values with RETLW', () => {
    const p = boot(
      'PIC16F628A',
      `
        org 0
        movlw 2
        call table
        movwf 0x20
done    goto done
table   addwf PCL,f
        retlw 0x10
        retlw 0x20
        retlw 0x30
      `,
    );
    p.run(1e-3);
    expect(p.peek(0x20)).toBe(0x30);
  });

  it('wakes from SLEEP on the RB0/INT edge and runs the next instruction', () => {
    const p = boot(
      'PIC16F877A',
      `
        org 0
        bsf STATUS,RP0
        movlw 0x06
        movwf ADCON1
        bsf TRISB,0
        bcf STATUS,RP0
        bsf INTCON,INTE      ; INTE without GIE: wake only
        sleep
        movlw 0x77
        movwf 0x20
done    goto done
      `,
    );
    p.setInput('RB0', 0);
    p.run(1e-3);
    expect(p.peek(0x20)).toBe(0);
    p.setInput('RB0', 5);
    p.run(1e-3);
    expect(p.peek(0x20)).toBe(0x77);
  });
});
