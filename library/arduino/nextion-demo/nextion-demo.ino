// Nextion demo: the display is wired to the serial port (Arduino TX -> display RX, display TX -> Arduino RX, 9600 baud).
// The screen shows the state of the LED on D13 and a counter. Button b0 (component 4) toggles the LED, button b1
// (component 5) counts up. The display reports a touch as: 0x65, page, component, 1 (press) or 0 (release), 0xFF 0xFF 0xFF.
const int LED_PIN = 13;

bool ledOn = false;
int counter = 0;
byte frame[12];
byte length = 0;

void send(const char* command) {
  Serial.print(command);
  Serial.write(0xFF);
  Serial.write(0xFF);
  Serial.write(0xFF);
}

void refresh() {
  send(ledOn ? "t1.txt=\"LED: ON\"" : "t1.txt=\"LED: OFF\"");
  char text[24];
  sprintf(text, "n0.val=%d", counter);
  send(text);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(9600);
  delay(300);  // let the display start
  send("page 0");
  refresh();
}

void loop() {
  while (Serial.available()) {
    frame[length++] = Serial.read();
    if (length >= sizeof(frame)) length = 0;
    // Every message ends with three 0xFF.
    if (length >= 4 && frame[length - 1] == 0xFF && frame[length - 2] == 0xFF && frame[length - 3] == 0xFF) {
      if (length == 7 && frame[0] == 0x65 && frame[3] == 1) {  // a button was pressed
        if (frame[2] == 4) {
          ledOn = !ledOn;
          digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
        }
        if (frame[2] == 5) counter++;
        refresh();
      }
      length = 0;
    }
  }
}
