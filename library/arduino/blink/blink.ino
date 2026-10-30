// Blink: D13 toggles every 500 ms. Wire an LED + resistor from D13 to GND.
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
