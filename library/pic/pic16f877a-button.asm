; Button: RB4 uses the weak pull-up, so a switch from RB4 to GND pulls it low.
; While the switch is closed, RD0 lights the LED.
        #include <p16f877a.inc>
        radix dec

        org 0
        bsf   STATUS,RP0
        movlw 0x06
        movwf ADCON1            ; digital I/O
        clrf  TRISD             ; PORTD outputs
        bcf   OPTION_REG,NOT_RBPU  ; enable the PORTB weak pull-ups
        bcf   STATUS,RP0
loop    btfss PORTB,4           ; skip when the button is released (high)
        goto  pressed
        bcf   PORTD,0
        goto  loop
pressed bsf   PORTD,0
        goto  loop
        end
