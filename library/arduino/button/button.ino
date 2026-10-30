// Button: D2 uses the internal pull-up, so a switch from D2 to GND pulls it low.
// While the switch is closed the D13 LED is on.
void setup() {
  pinMode(2, INPUT_PULLUP);
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, digitalRead(2) == LOW ? HIGH : LOW);
}
