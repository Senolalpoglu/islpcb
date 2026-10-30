// Analog: A0 is read with the 10-bit ADC and copied to the D9 PWM output (0-5 V maps to 0-100 % duty).
// The raw reading is also printed on the serial port.
void setup() {
  pinMode(9, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(A0);
  analogWrite(9, raw / 4);
  Serial.print("A0 = ");
  Serial.println(raw);
  delay(200);
}
