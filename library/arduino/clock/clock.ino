// Digital clock HH:MM:SS on six 7-segment digits (common cathode), Arduino Nano.
// The digits share the seven segment lines a..g (D2..D8, one 330 ohm resistor each); every digit has its own
// NPN transistor that connects its common cathode to ground. The sketch lights one digit at a time, fast
// enough that all six look lit (multiplexing). The decimal points of the 2nd and 4th digit make the colons.
//
// Serial monitor (9600 baud): the time is printed every second. Type T123456 (hour, minute, second) to set it.
const byte SEG[7] = {2, 3, 4, 5, 6, 7, 8};         // a b c d e f g
const byte DIGIT[6] = {9, 10, 11, 12, 13, 14};     // hours tens ... seconds units (A0 is pin 14)
const byte DP = 15;                                // A1: decimal points of every digit
const byte FONT[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

long secs = 12L * 3600 + 34L * 60 + 50;            // starts at 12:34:50 so the minute turns over soon
unsigned long lastTick = 0;
unsigned long lastScan = 0;
byte shown = 0;                                    // digit lit at the moment
String line = "";

void showDigit(byte i) {
  for (byte d = 0; d < 6; d++) digitalWrite(DIGIT[d], LOW);
  long h = secs / 3600, m = (secs / 60) % 60, s = secs % 60;
  byte v[6] = {(byte)(h / 10), (byte)(h % 10), (byte)(m / 10), (byte)(m % 10), (byte)(s / 10), (byte)(s % 10)};
  byte bits = FONT[v[i]];
  for (byte k = 0; k < 7; k++) digitalWrite(SEG[k], (bits >> k) & 1);
  // The colons blink with the seconds.
  digitalWrite(DP, (i == 1 || i == 3) && (secs & 1) ? HIGH : LOW);
  digitalWrite(DIGIT[i], HIGH);
}

void setTime(const String& text) {
  String digits = "";
  for (unsigned int k = 1; k < text.length(); k++)
    if (text[k] >= '0' && text[k] <= '9') digits += text[k];
  if (digits.length() < 6) return;
  long h = digits.substring(0, 2).toInt(), m = digits.substring(2, 4).toInt(), s = digits.substring(4, 6).toInt();
  if (h > 23 || m > 59 || s > 59) return;
  secs = h * 3600 + m * 60 + s;
  lastTick = millis();
}

void report() {
  long h = secs / 3600, m = (secs / 60) % 60, s = secs % 60;
  Serial.print(h < 10 ? "0" : "");
  Serial.print(h);
  Serial.print(m < 10 ? ":0" : ":");
  Serial.print(m);
  Serial.print(s < 10 ? ":0" : ":");
  Serial.println(s);
}

void setup() {
  for (byte k = 0; k < 7; k++) pinMode(SEG[k], OUTPUT);
  for (byte d = 0; d < 6; d++) pinMode(DIGIT[d], OUTPUT);
  pinMode(DP, OUTPUT);
  Serial.begin(9600);
  Serial.println("CLOCK READY (T123456 sets the time)");
  report();
}

void loop() {
  unsigned long now = millis();
  if (now - lastTick >= 1000) {
    lastTick += 1000;
    secs = (secs + 1) % 86400L;
    report();
  }
  if (micros() - lastScan >= 1500) {
    lastScan = micros();
    shown = (shown + 1) % 6;
    showDigit(shown);
  }
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line.length() && (line[0] == 'T' || line[0] == 't')) setTime(line);
      line = "";
    } else if (line.length() < 16) line += c;
  }
}
