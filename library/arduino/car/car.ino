// Four-motor car (4WD) with two L298N modules, controlled over Bluetooth. Arduino Nano.
// The HC-05 is on the hardware serial port (D0 = RX, D1 = TX), 9600 baud. A phone app, the remote control
// (see the "remote" example) or the serial monitor sends one letter:
//   F forward   B back   L turn left on the spot   R turn right on the spot   S stop
//   0..9 speed (0 is the slowest moving speed, 9 the fastest)   ? print the state
// Both L298N modules take the same control lines, so the two left motors always turn together, and so do the two
// right ones: ENA (D5, PWM) and IN1 (D2) / IN2 (D4) for the left side, ENB (D6, PWM) and IN3 (D7) / IN4 (D8) for the right.
// The car answers every command with one line that starts with '#', e.g. "#CAR F v=7".
const byte ENA = 5, ENB = 6;
const byte IN1 = 2, IN2 = 4, IN3 = 7, IN4 = 8;

char dir = 'S';
int level = 7;          // speed 0..9
bool comment = false;   // inside a line that starts with '#': a reply of another car, ignored

void side(byte a, byte b, int d) {   // d = 1 forward, -1 back, 0 stop
  digitalWrite(a, d > 0 ? HIGH : LOW);
  digitalWrite(b, d < 0 ? HIGH : LOW);
}

void apply() {
  int pwm = dir == 'S' ? 0 : 60 + level * 21;   // 60 .. 249, so that even speed 0 still moves
  int left = 0, right = 0;
  if (dir == 'F') left = right = 1;
  else if (dir == 'B') left = right = -1;
  else if (dir == 'L') { left = -1; right = 1; }
  else if (dir == 'R') { left = 1; right = -1; }
  side(IN1, IN2, left);
  side(IN3, IN4, right);
  analogWrite(ENA, pwm);
  analogWrite(ENB, pwm);
}

void report() {
  Serial.print("#CAR ");
  Serial.print(dir);
  Serial.print(" v=");
  Serial.println(level);
}

void setup() {
  pinMode(ENA, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  apply();
  Serial.begin(9600);
  Serial.println("#CAR READY");
}

void loop() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (comment) {
    if (c == '\n') comment = false;
    return;
  }
  if (c == '#') {
    comment = true;
    return;
  }
  if (c == 'F' || c == 'B' || c == 'L' || c == 'R' || c == 'S') dir = c;
  else if (c >= '0' && c <= '9') level = c - '0';
  else if (c != '?') return;
  apply();
  report();
}
