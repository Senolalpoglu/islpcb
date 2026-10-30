// Sensor station: temperature (LM35 on A0), light (LDR module on A1), gas (MQ-2 module on A2) and a set-point
// knob (A3). The board answers with
//   - a 12 V fan on D9 through a logic-level MOSFET, its speed rising as the temperature passes the set-point,
//   - a night light (LED on D5) that comes on when it gets dark,
//   - a buzzer on D8 and a red LED on D12 when the gas level is high.
// The LED on D13 blinks once a second and the readings go to the serial port (9600 baud).
const int NIGHT_LED = 5;
const int BUZZER_PIN = 8;
const int FAN_PIN = 9;
const int ALARM_LED = 12;
const int HEART_LED = 13;

const int GAS_LIMIT = 500;      // ADC counts
const int DARK_LIMIT = 300;     // ADC counts

unsigned long lastReport = 0;
unsigned long lastBeep = 0;
bool beeping = false;

void setup() {
  pinMode(NIGHT_LED, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(ALARM_LED, OUTPUT);
  pinMode(HEART_LED, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  float temp = analogRead(A0) * 500.0 / 1023.0;          // LM35: 10 mV per degree, 5 V reference
  int light = analogRead(A1);
  int gas = analogRead(A2);
  float setPoint = 20.0 + analogRead(A3) * 20.0 / 1023.0; // 20 to 40 degrees C

  // Fan: off below the set-point, full speed 5 degrees above it.
  float over = temp - setPoint;
  int duty = over <= 0 ? 0 : (over >= 5 ? 255 : (int)(over * 51));
  analogWrite(FAN_PIN, duty);

  // Night light: on in the dark.
  digitalWrite(NIGHT_LED, light < DARK_LIMIT);

  // Gas alarm: beep and light the LED.
  bool alarm = gas > GAS_LIMIT;
  digitalWrite(ALARM_LED, alarm);
  if (alarm) {
    if (millis() - lastBeep > 150) {
      lastBeep = millis();
      beeping = !beeping;
      digitalWrite(BUZZER_PIN, beeping);
    }
  } else {
    digitalWrite(BUZZER_PIN, LOW);
    beeping = false;
  }

  if (millis() - lastReport >= 1000) {
    lastReport = millis();
    digitalWrite(HEART_LED, !digitalRead(HEART_LED));
    Serial.print("T=");
    Serial.print(temp, 1);
    Serial.print("C SET=");
    Serial.print(setPoint, 1);
    Serial.print("C FAN=");
    Serial.print(duty * 100 / 255);
    Serial.print("% LIGHT=");
    Serial.print(light);
    Serial.print(light < DARK_LIMIT ? " (dark)" : "");
    Serial.print(" GAS=");
    Serial.print(gas);
    Serial.println(alarm ? " ALARM" : "");
  }
}
