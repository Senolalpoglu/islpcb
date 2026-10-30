// Fade: D9 is a PWM output that ramps up and down. Put a scope probe on D9 to see the duty cycle.
int level = 0;
int step = 5;

void setup() {
  pinMode(9, OUTPUT);
}

void loop() {
  analogWrite(9, level);
  level += step;
  if (level <= 0 || level >= 255) step = -step;
  delay(30);
}
