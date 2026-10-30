// Bluetooth remote control with an HC-05 on the hardware serial port (D0 = RX, D1 = TX), 9600 baud.
// The phone app sends one letter; here the serial monitor stands in for the phone:
//   1 / 0   LED on D8 on / off             + / -   brightness of the LED on D9 up / down (PWM)
//   A / B   relay on D12 on / off (the relay module is active low; it switches a 220 V lamp)
//   ?       print the state
const int LED_PIN = 8;
const int DIM_PIN = 9;
const int RELAY_PIN = 12;

int level = 128;
bool relayOn = false;

void report() {
  Serial.print("LED=");
  Serial.print(digitalRead(LED_PIN));
  Serial.print(" DIM=");
  Serial.print(level);
  Serial.print(" LAMP=");
  Serial.println(relayOn ? "ON" : "OFF");
}

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH);
  analogWrite(DIM_PIN, level);
  Serial.begin(9600);
  Serial.println("READY");
}

void loop() {
  if (!Serial.available()) return;
  char c = Serial.read();
  switch (c) {
    case '1': digitalWrite(LED_PIN, HIGH); break;
    case '0': digitalWrite(LED_PIN, LOW); break;
    case '+': level = min(255, level + 32); analogWrite(DIM_PIN, level); break;
    case '-': level = max(0, level - 32); analogWrite(DIM_PIN, level); break;
    case 'A': relayOn = true; digitalWrite(RELAY_PIN, LOW); break;
    case 'B': relayOn = false; digitalWrite(RELAY_PIN, HIGH); break;
    case '?': break;
    default: return;
  }
  report();
}
