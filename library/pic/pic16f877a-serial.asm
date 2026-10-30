; Serial: sends "HELLO FROM PIC n" at 9600 baud (4 MHz, BRGH = 1) every 0.4 s and blinks RB0.
        #include <p16f877a.inc>
        radix dec
        cblock 0x20
          d1
          d2
          d3
          idx
          cnt
        endc

        org 0
        bsf   STATUS,RP0
        movlw 25                ; 4 MHz / (16 * (25 + 1)) = 9615 baud
        movwf SPBRG
        movlw B'00100100'       ; TXEN, BRGH
        movwf TXSTA
        movlw 0x06
        movwf ADCON1
        bcf   TRISB,0
        bcf   STATUS,RP0
        bsf   RCSTA,SPEN        ; the USART takes over RC6/TX
        clrf  cnt
loop    bsf   PORTB,0
        clrf  idx
next    movf  idx,w
        call  text              ; W = next character, 0 at the end
        iorlw 0                 ; sets Z when W = 0
        btfsc STATUS,Z
        goto  tail
        call  send
        incf  idx,f
        goto  next
tail    movf  cnt,w
        addlw '0'
        call  send
        movlw 13
        call  send
        movlw 10
        call  send
        incf  cnt,f
        movlw 10
        subwf cnt,w
        btfsc STATUS,Z
        clrf  cnt               ; the counter wraps after 9
        bcf   PORTB,0
        call  delay
        goto  loop

send    btfss PIR1,TXIF         ; wait until TXREG is empty
        goto  send
        movwf TXREG
        return

text    addwf PCL,f             ; computed jump into a table of RETLW instructions
        dt    "HELLO FROM PIC ", 0

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
