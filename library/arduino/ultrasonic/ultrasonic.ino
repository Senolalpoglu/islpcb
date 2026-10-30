// Ultrasonic transducer driver (an educational model of the drive of a lithotripsy probe, not a medical device).
// Timer1 makes two complementary 27.97 kHz square waves with a little dead time on D9 (OC1A) and D10 (OC1B). They go
// through the TC4427 gate driver to the two MOSFETs of the push-pull stage, the transformer and the Langevin transducer.
// While the FIRE button (D4, to ground) is held, the drive runs in short bursts; releasing it stops the drive at once.
// The knob on A0 sets the power, the width of the drive pulses. Status goes to the serial port (9600 baud).
const int OC1A_PIN = 9;
const int OC1B_PIN = 10;
const int FIRE_PIN = 4;
const int READY_LED = 5;
const int FIRE_LED = 6;

const unsigned int TOP = 286;              // 16 MHz / (2 * 286) = 27.97 kHz, the transducer resonates at 28 kHz
const unsigned int DEAD = 8;               // counts of dead time at each edge, about 0.5 us
const unsigned long BURST_MS = 5;          // drive on
const unsigned long PAUSE_MS = 45;         // drive off (a real unit would use longer bursts)

bool burst = false;
unsigned long phaseStart = 0;
unsigned long lastReport = 0;

void driveOn(unsigned int duty) {
  ICR1 = TOP;
  OCR1A = duty;
  OCR1B = TOP - duty;
  TCNT1 = 0;
  TCCR1A = _BV(COM1A1) | _BV(COM1B1) | _BV(COM1B0) | _BV(WGM11);   // A non-inverting, B inverting
  TCCR1B = _BV(WGM13) | _BV(CS10);                                   // phase-correct PWM, TOP = ICR1, no prescaler
}

void driveOff() {
  TCCR1A = 0;
  TCCR1B = 0;
  digitalWrite(OC1A_PIN, LOW);
  digitalWrite(OC1B_PIN, LOW);
}

void setup() {
  pinMode(OC1A_PIN, OUTPUT);
  pinMode(OC1B_PIN, OUTPUT);
  pinMode(READY_LED, OUTPUT);
  pinMode(FIRE_LED, OUTPUT);
  pinMode(FIRE_PIN, INPUT_PULLUP);
  driveOff();
  Serial.begin(9600);
  Serial.println("ULTRASONIC DRIVER");
}

void loop() {
  int raw = analogRead(A0);
  unsigned int duty = map(raw, 0, 1023, 30, TOP / 2 - DEAD);
  int percent = (int)(100L * duty / (TOP / 2 - DEAD));
  bool fire = digitalRead(FIRE_PIN) == LOW;

  if (!fire) {
    if (burst) driveOff();
    burst = false;
    phaseStart = millis();
  } else if (burst && millis() - phaseStart >= BURST_MS) {
    driveOff();
    burst = false;
    phaseStart = millis();
  } else if (!burst && millis() - phaseStart >= PAUSE_MS) {
    driveOn(duty);
    burst = true;
    phaseStart = millis();
  }

  digitalWrite(FIRE_LED, burst);
  digitalWrite(READY_LED, !burst);

  if (millis() - lastReport >= 250) {
    lastReport = millis();
    Serial.print(fire ? "FIRE " : "READY");
    Serial.print(" power=");
    Serial.print(percent);
    Serial.println("%");
  }
}
