; Blink: RB4 toggles about every 0.4 s with a 4 MHz clock.
; Wire an LED + resistor from RB4 to GND (and the chip's VSS pin to the same ground).
        #include <p16f84a.inc>
        radix dec               ; MPASM numbers are hexadecimal unless told otherwise
        cblock 0x0C
          d1
          d2
          d3
        endc

        org 0
        bsf   STATUS,RP0
        bcf   TRISB,4          ; RB4 is an output
        bcf   STATUS,RP0
loop    bsf   PORTB,4
        call  delay
        bcf   PORTB,4
        call  delay
        goto  loop

; 2 * 256 * 256 * 3 cycles = 393,216 us at 1 us per cycle
delay   movlw 2
        movwf d3
        clrf  d2
        clrf  d1
dl      decfsz d1,f
        goto  dl
        decfsz d2,f
        goto  dl
        decfsz d3,f
        goto  dl
        return
        end
