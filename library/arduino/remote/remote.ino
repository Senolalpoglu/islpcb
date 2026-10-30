// Remote control for the Bluetooth car. Arduino Nano with an HC-05 on the hardware serial port (D0 = RX, D1 = TX).
// Five push buttons (to ground, internal pull-ups) send the driving letter: F forward, B back, L left, R right,
// S stop. A knob on A0 sends the speed digit 0..9 when it moves. Letters typed in the serial monitor are passed
// on to the car as well, as if a button had been pressed. Lines that start with '#' are the car's answers: they are
// not passed on, and the green LED on D7 lights up for a moment when one arrives.
const byte BUTTON[5] = {3, 4, 5, 6, 9};
const char LETTER[5] = {'F', 'B', 'L', 'R', 'S'};
const byte LED = 7;

bool wasDown[5] = {false, false, false, false, false};
int lastLevel = -1;
bool reply = false;
unsigned long ledUntil = 0;

void setup() {
  for (byte k = 0; k < 5; k++) pinMode(BUTTON[k], INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("#REMOTE READY");
}

void loop() {
  for (byte k = 0; k < 5; k++) {
    bool down = digitalRead(BUTTON[k]) == LOW;
    if (down && !wasDown[k]) Serial.write(LETTER[k]);
    wasDown[k] = down;
  }
  int level = analogRead(A0) / 103;           // 0..1023 -> 0..9
  if (level > 9) level = 9;
  if (level != lastLevel) {
    // The first reading is only remembered, so the car keeps its own speed until the knob is turned.
    if (lastLevel >= 0) Serial.write('0' + level);
    lastLevel = level;
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (reply) {
      if (c == '\n') reply = false;
    } else if (c == '#') {
      reply = true;
      ledUntil = millis() + 300;
    } else if (c == 'F' || c == 'B' || c == 'L' || c == 'R' || c == 'S' || c == '?' || (c >= '0' && c <= '9')) {
      Serial.write(c);
    }
  }
  digitalWrite(LED, millis() < ledUntil ? HIGH : LOW);
}
