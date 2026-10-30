// Serial: prints a counter at 9600 baud and blinks the D13 LED on every message.
int counter = 0;

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("Hello from ISL PCB!");
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.print("count = ");
  Serial.println(counter++);
  delay(100);
  digitalWrite(13, LOW);
  delay(400);
}
