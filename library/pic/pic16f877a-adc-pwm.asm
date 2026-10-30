; ADC to PWM: AN0 (RA0) is digitised and its 8 high bits set the CCP1 PWM duty cycle on RC2.
; Feed RA0 from a voltage divider; the LED on RC2 gets brighter as the voltage rises.
        #include <p16f877a.inc>
        radix dec

        org 0
        bsf   STATUS,RP0
        movlw 0x0E              ; AN0 analog, result left justified
        movwf ADCON1
        movlw 255
        movwf PR2               ; PWM period = 256 * 4 us = about 1 kHz with the 1:4 prescaler
        bcf   TRISC,2           ; RC2 / CCP1 is an output
        bcf   STATUS,RP0
        movlw B'00001100'       ; CCP1 in PWM mode
        movwf CCP1CON
        movlw B'00000101'       ; Timer2 on, prescaler 1:4
        movwf T2CON
        movlw B'01000001'       ; ADC on, Fosc/8, channel AN0
        movwf ADCON0
loop    bsf   ADCON0,GO
wait    btfsc ADCON0,GO         ; wait for the conversion
        goto  wait
        movf  ADRESH,w
        movwf CCPR1L            ; duty cycle = ADC result
        goto  loop
        end
