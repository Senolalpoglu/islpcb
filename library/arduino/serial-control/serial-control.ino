// Serial control: type a command in the serial monitor (9600 baud, line ending Newline).
//   LED ON / LED OFF        the LED on D13
//   RELAY ON / RELAY OFF    the relay module on D7 (active low: the board pulls IN low to close the relay)
//   STATUS                  prints the state of both
const int LED_PIN = 13;
const int RELAY_PIN = 7;

char line[24];
byte len = 0;
bool ledOn = false;
bool relayOn = false;

void apply() {
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);
  digitalWrite(RELAY_PIN, relayOn ? LOW : HIGH);
}

void handle() {
  for (byte i = 0; i < len; i++) line[i] = toupper(line[i]);
  line[len] = 0;
  if (!strcmp(line, "LED ON")) ledOn = true;
  else if (!strcmp(line, "LED OFF")) ledOn = false;
  else if (!strcmp(line, "RELAY ON")) relayOn = true;
  else if (!strcmp(line, "RELAY OFF")) relayOn = false;
  else if (strcmp(line, "STATUS")) {
    Serial.println("ERR unknown command");
    return;
  }
  apply();
  Serial.print("OK LED=");
  Serial.print(ledOn ? 1 : 0);
  Serial.print(" RELAY=");
  Serial.println(relayOn ? 1 : 0);
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  apply();
  Serial.begin(9600);
  Serial.println("Ready: LED ON/OFF, RELAY ON/OFF, STATUS");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (len) handle();
      len = 0;
    } else if (len < sizeof(line) - 1) {
      line[len++] = c;
    }
  }
}
