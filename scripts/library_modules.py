"""Sensors and hobby modules (HX711, Bluetooth, WiFi, ultrasonic, displays, drivers ...). Imported by gen-library.py.

What the simulator does with a module:
  * analog parts (LM35, TMP36, joystick, analog sensor boards, PIR output, relay module, L298N, stepper motor) have
    a working electrical model, driven by the parameters in the properties panel;
  * digital protocol modules (HX711, HC-05, ESP, nRF24, OLED, MPU-6050 ...) are pinout + footprint + supply
    current only: the program running in the Arduino cannot talk to them, because their protocols are not emulated.
The labels of the latter say "pinout only" so nobody expects more than that.

The pin names must be the pad names of the footprint in core/pcb/modules.ts; tests/footprints.test.ts checks it.
"""


def build(h):
    txt, part, box, param, el = h["txt"], h["part"], h["box"], h["param"], h["el"]
    out = {"sensors.json": [], "modules.json": []}

    def add(id, en, tr, category, prefix, left, right, fp, title, supply=None, current_ma=0.0, elements=None, params=None, pad_map=None):
        """`supply` is (positive pin, ground pin); `current_ma` becomes a resistor between them (the idle current at 5 V)."""
        elems = list(elements or [])
        if supply and current_ma > 0:
            elems.append(el("R", [supply[0], supply[1]], round(5000.0 / current_ma, 1)))
        spec = part(id, txt(en, tr), category, prefix, box(left, right, title), elems, params, footprint=fp)
        if pad_map:
            spec["padMap"] = pad_map
        out["sensors.json" if category == "sensor" else "modules.json"].append(spec)

    def pinout(id, en, tr, left, right, fp, title, supply, current_ma, category="module", params=None, pad_map=None):
        add(id, f"{en} (pinout only)", f"{tr} (yalnızca pin bağlantısı)", category, "U", left, right, fp, title, supply, current_ma, params=params, pad_map=pad_map)

    # ---- wireless -----------------------------------------------------------------------------------------
    # A serial radio is not emulated, but two modules with the same `link` name are paired by the simulator
    # (src/sim/rig.ts): what the board behind one of them writes on its serial port arrives at the board behind
    # the other, and the other way round. The wiring of each module to its board is that of the real thing.
    link = [param("link", "Radio link name (two modules with the same name are paired)", "Radyo bağlantı adı (aynı ada sahip iki modül eşleşir)", "", "text")]
    pinout("hc-05", "HC-05 Bluetooth module", "HC-05 Bluetooth modülü", ["STATE", "RXD", "TXD", "GND", "VCC", "EN"], [], "MOD_HC05", "HC-05", ("VCC", "GND"), 30, params=link)
    pinout("hc-06", "HC-06 Bluetooth module", "HC-06 Bluetooth modülü", ["VCC", "GND", "TXD", "RXD"], [], "MOD_HC06", "HC-06", ("VCC", "GND"), 30, params=link)
    # The HC-12 is a 433 MHz serial radio: two of them on the same channel (here: the same link name) talk like a wire.
    pinout("hc-12", "HC-12 433 MHz serial radio", "HC-12 433 MHz seri telsiz", ["VCC", "GND", "RXD", "TXD", "SET"], [], "SIP_5", "HC-12", ("VCC", "GND"), 20, params=link)

    # ---- more displays, drivers and logic: pinout only unless the model says otherwise -----------------------------------
    # DIP packages: the symbol lists the left side top to bottom (pins 1..n/2) and the right side top to bottom (pins n..n/2+1);
    # `pad_map` gives the pin of each pad in the footprint's own order (pad 1 first).
    pinout("ds1307", "DS1307 real-time clock", "DS1307 gerçek zaman saati", ["X1", "X2", "VBAT", "GND"], ["VCC", "SQW", "SCL", "SDA"], "DIP8", "DS1307", ("VCC", "GND"), 1.5, pad_map=["X1", "X2", "VBAT", "GND", "SDA", "SCL", "SQW", "VCC"])
    pinout("74hc595", "74HC595 8-bit shift register", "74HC595 8 bit kaydırmalı yazmaç", ["QB", "QC", "QD", "QE", "QF", "QG", "QH", "GND"], ["VCC", "QA", "SER", "OE", "RCLK", "SRCLK", "SRCLR", "QH'"], "DIP16", "74HC595", ("VCC", "GND"), 0.1, "logic", pad_map=["QB", "QC", "QD", "QE", "QF", "QG", "QH", "GND", "QH'", "SRCLR", "SRCLK", "RCLK", "OE", "SER", "QA", "VCC"])
    pinout("max7219-module", "MAX7219 8x8 LED matrix module (FC-16)", "MAX7219 8x8 LED matris modülü (FC-16)", ["VCC", "GND", "DIN", "CS", "CLK"], [], "SIP_5", "MAX7219", ("VCC", "GND"), 40)
    pinout("lcd2004", "LCD 2004 (HD44780, 20 x 4)", "LCD 2004 (HD44780, 20 x 4)", ["VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K"], [], "SIP_16", "LCD 2004", ("VDD", "VSS"), 3)
    pinout("lcd2004-i2c", "LCD 2004 with I2C backpack", "I2C adaptörlü LCD 2004", ["GND", "VCC", "SDA", "SCL"], [], "SIP_4", "LCD 2004 I2C", ("VCC", "GND"), 4)

    # A six-digit 7-segment display as it is sold on clock boards: the segment lines a..g and dp are shared by all digits, each
    # digit has its own common cathode (D1 = leftmost). Every digit is eight diodes, so a multiplexed drive really lights one
    # digit at a time; the schematic draws the digits under the box.
    segs = ["a", "b", "c", "d", "e", "f", "g", "dp"]
    six = [el("D", [s, f"D{d + 1}"], **{"is": 1e-18, "n": 2}) for d in range(6) for s in segs]
    add("7seg-6digit-cc", "6-digit 7-segment display, common cathode (multiplexed)", "6 haneli 7 segment gösterge, ortak katot (çoklamalı)", "semi", "DS", segs, [f"D{k}" for k in range(1, 7)], "SIP_14", "6x7SEG CC", None, 0, six)
    pinout("esp-01", "ESP-01 ESP8266 WiFi module", "ESP-01 ESP8266 WiFi modülü", ["GND", "GPIO2", "GPIO0", "RXD"], ["TXD", "CH_PD", "RST", "VCC"], "MOD_ESP01", "ESP-01", ("VCC", "GND"), 70)
    pinout("esp32-devkit", "ESP32 DevKit (30 pins)", "ESP32 DevKit (30 pin)", ["EN", "VP", "VN", "D34", "D35", "D32", "D33", "D25", "D26", "D27", "D14", "D12", "D13", "GND", "VIN"], ["D23", "D22", "TX0", "RX0", "D21", "D19", "D18", "D5", "TX2", "RX2", "D4", "D2", "D15", "GND2", "3V3"], "MOD_ESP32", "ESP32", ("VIN", "GND"), 80, "mcu")
    pinout("nodemcu", "NodeMCU ESP8266 (30 pins)", "NodeMCU ESP8266 (30 pin)", ["A0", "RSV1", "RSV2", "SD3", "SD2", "SD1", "CMD", "SD0", "CLK", "GND", "3V3", "EN", "RST", "GND2", "VIN"], ["D0", "D1", "D2", "D3", "D4", "3V3_2", "GND3", "D5", "D6", "D7", "D8", "RX", "TX", "GND4", "3V3_3"], "MOD_NODEMCU", "NodeMCU", ("VIN", "GND"), 70, "mcu")
    pinout("wemos-d1-mini", "Wemos D1 mini (ESP8266)", "Wemos D1 mini (ESP8266)", ["RST", "A0", "D0", "D5", "D6", "D7", "D8", "3V3"], ["TX", "RX", "D1", "D2", "D3", "D4", "GND", "5V"], "MOD_D1MINI", "D1 mini", ("5V", "GND"), 70, "mcu")
    pinout("nrf24l01", "nRF24L01+ radio", "nRF24L01+ telsiz", ["GND", "CE", "SCK", "MISO"], ["VCC", "CSN", "MOSI", "IRQ"], "MOD_NRF24", "nRF24", ("VCC", "GND"), 12)
    pinout("neo-6m", "GPS NEO-6M", "GPS NEO-6M", ["VCC", "RX", "TX", "GND"], [], "MOD_NEO6M", "NEO-6M", ("VCC", "GND"), 45)
    pinout("rc522", "RFID RC522", "RFID RC522", ["SDA", "SCK", "MOSI", "MISO", "IRQ", "GND", "RST", "3V3"], [], "MOD_RC522", "RC522", ("3V3", "GND"), 25)

    # ---- load cell, displays, storage, motion --------------------------------------------------------------
    pinout("hx711", "HX711 load-cell amplifier", "HX711 yük hücresi yükselticisi", ["GND", "DT", "SCK", "VCC"], ["E+", "E-", "A-", "A+", "B-", "B+"], "MOD_HX711", "HX711", ("VCC", "GND"), 1.5, "sensor")
    pinout("oled-ssd1306", "OLED 0.96 inch I2C (SSD1306)", "OLED 0,96 inç I2C (SSD1306)", ["GND", "VCC", "SCL", "SDA"], [], "MOD_OLED", "OLED", ("VCC", "GND"), 12)
    pinout("lcd1602", "LCD 1602 (HD44780)", "LCD 1602 (HD44780)", ["VSS", "VDD", "V0", "RS", "RW", "E", "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A", "K"], [], "MOD_LCD1602", "LCD 1602", ("VDD", "VSS"), 2)
    pinout("lcd1602-i2c", "LCD 1602 with I2C backpack", "I2C arayüzlü LCD 1602", ["GND", "VCC", "SDA", "SCL"], [], "MOD_LCD1602_I2C", "LCD I2C", ("VCC", "GND"), 25)
    pinout("tm1637", "TM1637 4-digit display", "TM1637 4 haneli ekran", ["CLK", "DIO", "VCC", "GND"], [], "MOD_TM1637", "TM1637", ("VCC", "GND"), 20)
    pinout("sd-card", "Micro SD card module", "Micro SD kart modülü", ["GND", "VCC", "MISO", "MOSI", "SCK", "CS"], [], "MOD_SDCARD", "SD CARD", ("VCC", "GND"), 20)
    pinout("ds3231", "DS3231 real-time clock", "DS3231 gerçek zaman saati", ["32K", "SQW", "SCL", "SDA", "VCC", "GND"], [], "MOD_DS3231", "DS3231", ("VCC", "GND"), 0.2)
    pinout("mpu6050", "MPU-6050 accelerometer / gyro (GY-521)", "MPU-6050 ivme / jiroskop (GY-521)", ["VCC", "GND", "SCL", "SDA", "XDA", "XCL", "AD0", "INT"], [], "MOD_GY521", "MPU6050", ("VCC", "GND"), 4, "sensor")
    pinout("bmp280", "BMP280 / BME280 pressure sensor", "BMP280 / BME280 basınç sensörü", ["VCC", "GND", "SCL", "SDA", "CSB", "SDO"], [], "MOD_BMP280", "BMP280", ("VCC", "GND"), 1, "sensor")
    pinout("hc-sr04", "HC-SR04 ultrasonic sensor", "HC-SR04 ultrasonik sensör", ["VCC", "TRIG", "ECHO", "GND"], [], "MOD_SR04", "HC-SR04", ("VCC", "GND"), 15, "sensor")

    # ---- sensors with a working model ----------------------------------------------------------------------
    lm35_like = lambda offset: [el("V", ["VOUT", "m"], f"{offset}$temp*0.01"), el("R", ["m", "GND"], 0.001), el("R", ["VOUT", "GND"], 100000), el("R", ["+VS", "GND"], 83000)]
    temp = [param("temp", "Temperature (°C)", "Sıcaklık (°C)", 25)]
    add("lm35", "LM35 temperature sensor (10 mV/°C)", "LM35 sıcaklık sensörü (10 mV/°C)", "sensor", "U", ["+VS", "VOUT", "GND"], [], "TO92", "LM35", None, 0, lm35_like(""), temp, ["+VS", "VOUT", "GND"])
    add("tmp36", "TMP36 temperature sensor (10 mV/°C, 0.5 V at 0 °C)", "TMP36 sıcaklık sensörü (10 mV/°C, 0 °C'de 0,5 V)", "sensor", "U", ["+VS", "VOUT", "GND"], [], "TO92", "TMP36", None, 0, lm35_like("0.5+"), temp, ["+VS", "VOUT", "GND"])
    add("ds18b20", "DS18B20 temperature sensor, 1-Wire (pinout only)", "DS18B20 sıcaklık sensörü, 1-Wire (yalnızca pin bağlantısı)", "sensor", "U", ["GND", "DQ", "VDD"], [], "TO92", "DS18B20", ("VDD", "GND"), 1, None, None, ["GND", "DQ", "VDD"])
    add("dht11", "DHT11 temperature and humidity (pinout only)", "DHT11 sıcaklık ve nem (yalnızca pin bağlantısı)", "sensor", "U", ["VCC", "DATA", "NC", "GND"], [], "SIP_4", "DHT11", ("VCC", "GND"), 1)
    add("dht22", "DHT22 temperature and humidity (pinout only)", "DHT22 sıcaklık ve nem (yalnızca pin bağlantısı)", "sensor", "U", ["VCC", "DATA", "NC", "GND"], [], "SIP_4", "DHT22", ("VCC", "GND"), 1.5)
    add("tsop1838", "TSOP1838 infrared receiver (pinout only)", "TSOP1838 kızılötesi alıcı (yalnızca pin bağlantısı)", "sensor", "U", ["OUT", "GND", "VCC"], [], "TO92", "TSOP1838", ("VCC", "GND"), 1, None, None, ["OUT", "GND", "VCC"])

    def analog_module(id, en, tr, default, label_en, label_tr):
        # VCC - r(up) - AO - r(down) - GND: the reading moves r(down). DO is a comparator of AO against half of VCC.
        elems = [
            el("R", ["VCC", "AO"], 10000),
            el("R", ["AO", "GND"], "max(10000*$level/(1-min($level,0.99)),1)"),
            el("R", ["VCC", "half"], 10000),
            el("R", ["half", "GND"], 10000),
            {"type": "OA", "nodes": ["DO", "half", "AO"], "p": "VCC", "n": "GND", "props": {"headroom": 0.1, "headroomLo": 0.02, "rout": 100}},
        ]
        add(id, en, tr, "sensor", "U", ["VCC", "GND", "DO", "AO"], [], "MOD_SENSOR4", {"ldr-module": "LDR", "mq2-module": "MQ-2", "soil-moisture": "SOIL", "sound-sensor": "SOUND", "rain-sensor": "RAIN"}[id], ("VCC", "GND"), 8, elems, [param("level", label_en, label_tr, default)])

    analog_module("ldr-module", "Light sensor module (LDR)", "Işık sensörü modülü (LDR)", 0.5, "Light level (0 dark - 1 bright)", "Işık düzeyi (0 karanlık - 1 aydınlık)")
    analog_module("mq2-module", "MQ-2 gas sensor module", "MQ-2 gaz sensörü modülü", 0.2, "Gas level (0 clean - 1 heavy)", "Gaz düzeyi (0 temiz - 1 yoğun)")
    analog_module("soil-moisture", "Soil moisture sensor module", "Toprak nem sensörü modülü", 0.4, "Moisture (0 dry - 1 wet)", "Nem (0 kuru - 1 ıslak)")
    analog_module("sound-sensor", "Sound sensor module", "Ses sensörü modülü", 0.3, "Sound level (0 quiet - 1 loud)", "Ses düzeyi (0 sessiz - 1 yüksek)")
    analog_module("rain-sensor", "Rain sensor module", "Yağmur sensörü modülü", 0.1, "Wetness (0 dry - 1 wet)", "Islaklık (0 kuru - 1 ıslak)")
    add("pir-hc-sr501", "PIR motion sensor HC-SR501", "PIR hareket sensörü HC-SR501", "sensor", "U", ["VCC", "OUT", "GND"], [], "MOD_PIR", "PIR", ("VCC", "GND"), 0.06, [el("V", ["hi", "GND"], "3.3*$closed"), el("R", ["hi", "OUT"], 100)], [param("closed", "Motion detected (double-click)", "Hareket var (çift tıkla)", False, "bool")])
    add("joystick", "Joystick module KY-023", "Joystick modülü KY-023", "sensor", "U", ["GND", "+5V", "VRX", "VRY", "SW"], [], "MOD_JOYSTICK", "JOYSTICK", None, 0, [el("R", ["+5V", "VRX"], "max(10000*(1-$x),1)"), el("R", ["VRX", "GND"], "max(10000*$x,1)"), el("R", ["+5V", "VRY"], "max(10000*(1-$y),1)"), el("R", ["VRY", "GND"], "max(10000*$y,1)"), el("SW", ["SW", "GND"], closed="$closed")], [param("x", "X position (0-1)", "X konumu (0-1)", 0.5), param("y", "Y position (0-1)", "Y konumu (0-1)", 0.5), param("closed", "Button pressed (double-click)", "Butona basılı (çift tıkla)", False, "bool")])

    # ---- Nextion display: the screen is simulated (see core/mcu/nextion.ts); the power draw is real ------------------------
    add("nextion-display", "Nextion display (virtual, serial protocol)", "Nextion ekran (sanal, seri protokol)", "module", "U", ["5V", "TX", "RX", "GND"], [], "MOD_NEXTION", "NEXTION", None, 0, [el("R", ["5V", "GND"], 50), el("R", ["TX", "GND"], 1e7), el("R", ["RX", "GND"], 1e7)], [param("layout", "Screen layout (JSON, empty = demo screen)", "Ekran düzeni (JSON, boş = demo ekran)", "", "text")])
    out["modules.json"][-1]["note"] = "Wire RX to the TX pin of a board (D1 on an Arduino) and TX to its RX pin (D0), 5 V and GND. The Display tab shows the screen; touching a button sends the touch event to the board. It draws about 100 mA from 5 V (backlight)."

    # ---- motors and drivers --------------------------------------------------------------------------------
    add("servo-sg90", "Servo SG90 (supply current only)", "Servo SG90 (yalnızca besleme akımı)", "module", "M", ["GND", "VCC", "SIG"], [], "SIP_3", "SERVO", ("VCC", "GND"), 100)
    phases = []
    for name in ("A", "B", "C", "D"):
        phases += [el("L", ["COM", f"l{name}"], 0.01), el("R", [f"l{name}", name], 31)]
    add("stepper-28byj48", "Stepper motor 28BYJ-48 (5 V, unipolar)", "Step motor 28BYJ-48 (5 V, unipolar)", "module", "M", ["COM", "A", "B"], ["C", "D"], "SIP_5", "28BYJ-48", None, 0, phases)
    bridge = []
    for en, inp, outp in [("ENA", "IN1", "OUT1"), ("ENA", "IN2", "OUT2"), ("ENB", "IN3", "OUT3"), ("ENB", "IN4", "OUT4")]:
        m = f"m_{outp}"
        bridge += [
            {"type": "VSW", "nodes": [m, "12V", inp, "GND"], "props": {"vth": 2.5, "vhys": 0.2, "ron": 0.6}},
            {"type": "VSW", "nodes": [m, "GND", inp, "GND"], "props": {"vth": 2.5, "vhys": 0.2, "ron": 0.6, "inv": True}},
            {"type": "VSW", "nodes": [m, outp, en, "GND"], "props": {"vth": 2.5, "vhys": 0.2, "ron": 0.05}},
        ]
    add("l298n", "L298N dual H-bridge motor driver", "L298N çift H köprüsü motor sürücü", "module", "U", ["OUT1", "OUT2", "12V", "GND", "5V"], ["OUT3", "OUT4", "ENA", "IN1", "IN2", "IN3", "IN4", "ENB"], "MOD_L298N", "L298N", None, 0, bridge)
    # TB6612FNG module. Each output follows its input (IN = high: the output goes to VM, IN = low: to ground) while STBY and the channel's PWM
    # are high; with either low the output floats. Approximation: the real chip brakes when PWM is low or both inputs are high; here the
    # motor then sees 0 V across it (both outputs equal) or nothing. Pin order follows this symbol: check the silkscreen of your module.
    tb = []
    for pwm, inp, outp in [("PWMA", "AIN1", "AO1"), ("PWMA", "AIN2", "AO2"), ("PWMB", "BIN1", "BO1"), ("PWMB", "BIN2", "BO2")]:
        hi, lo, mh, ml = f"h_{outp}", f"l_{outp}", f"mh_{outp}", f"ml_{outp}"
        tb += [
            # high side: VM -> (input high) -> (PWM high) -> (STBY high) -> output
            {"type": "VSW", "nodes": [hi, "VM", inp, "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.2}},
            {"type": "VSW", "nodes": [mh, hi, pwm, "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.05}},
            {"type": "VSW", "nodes": [outp, mh, "STBY", "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.05}},
            # low side: ground -> (input low) -> (PWM high) -> (STBY high) -> output
            {"type": "VSW", "nodes": [lo, "GND", inp, "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.2, "inv": True}},
            {"type": "VSW", "nodes": [ml, lo, pwm, "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.05}},
            {"type": "VSW", "nodes": [outp, ml, "STBY", "GND"], "props": {"vth": 1.5, "vhys": 0.2, "ron": 0.05}},
            el("D", [outp, "VM"], **{"is": 1e-12, "n": 1.5}),
            el("D", ["GND", outp], **{"is": 1e-12, "n": 1.5}),
        ]
    tb.append(el("R", ["VCC", "GND"], 2500))
    add("tb6612fng", "TB6612FNG dual motor driver module", "TB6612FNG çift motor sürücü modülü", "module", "U", ["VM", "VCC", "GND", "STBY", "PWMA", "AIN1", "AIN2"], ["AO1", "AO2", "BO1", "BO2", "BIN1", "BIN2", "PWMB"], "SIP_14", "TB6612FNG", None, 0, tb)
    # L293D, DIP16: two enables, four half-bridges with about 1.4 V of drop (source) and 1.2 V (sink) at 600 mA, clamp diodes included.
    l293 = [el("R", ["VCC1", "GND1"], 2500), el("R", ["GND1", "GND2"], 0.001), el("R", ["GND1", "GND3"], 0.001), el("R", ["GND1", "GND4"], 0.001)]
    for en, inp, outp in [("EN12", "IN1", "OUT1"), ("EN12", "IN2", "OUT2"), ("EN34", "IN3", "OUT3"), ("EN34", "IN4", "OUT4")]:
        hi, lo = f"h_{outp}", f"l_{outp}"
        l293 += [
            {"type": "VSW", "nodes": [hi, "VCC2", inp, "GND1"], "props": {"vth": 2.0, "vhys": 0.2, "ron": 2.3}},
            {"type": "VSW", "nodes": [outp, hi, en, "GND1"], "props": {"vth": 2.0, "vhys": 0.2, "ron": 0.05}},
            {"type": "VSW", "nodes": [lo, "GND1", inp, "GND1"], "props": {"vth": 2.0, "vhys": 0.2, "ron": 2.0, "inv": True}},
            {"type": "VSW", "nodes": [outp, lo, en, "GND1"], "props": {"vth": 2.0, "vhys": 0.2, "ron": 0.05}},
            el("D", [outp, "VCC2"], **{"is": 1e-12, "n": 1.5}),
            el("D", ["GND1", outp], **{"is": 1e-12, "n": 1.5}),
        ]
    add("l293d", "L293D dual H-bridge motor driver (DIP16)", "L293D çift H köprüsü motor sürücü (DIP16)", "ic", "U", ["EN12", "IN1", "OUT1", "GND1", "GND2", "OUT2", "IN2", "VCC2"], ["VCC1", "IN4", "OUT4", "GND4", "GND3", "OUT3", "IN3", "EN34"], "DIP16", "L293D", None, 0, l293, None, ["EN12", "IN1", "OUT1", "GND1", "GND2", "OUT2", "IN2", "VCC2", "EN34", "IN3", "OUT3", "GND3", "GND4", "OUT4", "IN4", "VCC1"])
    add("a4988", "A4988 stepper driver (pinout only)", "A4988 step motor sürücü (yalnızca pin bağlantısı)", "module", "U", ["ENABLE", "MS1", "MS2", "MS3", "RESET", "SLEEP", "STEP", "DIR"], ["VMOT", "GND_M", "2B", "2A", "1A", "1B", "VDD", "GND"], "MOD_A4988", "A4988", ("VDD", "GND"), 8)
    relay = [
        el("R", ["DC+", "m"], 70),
        el("R", ["m", "DC-"], 0.001),
        {"type": "VSW", "nodes": ["COM", "NO", "DC+", "IN"], "props": {"vth": 2.0, "vhys": 0.5, "ron": 0.05}},
        {"type": "VSW", "nodes": ["COM", "NC", "DC+", "IN"], "props": {"vth": 2.0, "vhys": 0.5, "ron": 0.05, "inv": True}},
    ]
    add("relay-module-1ch", "Relay module 1 channel (active low)", "Röle modülü 1 kanal (aktif düşük)", "module", "K", ["DC+", "DC-", "IN"], ["NC", "COM", "NO"], "MOD_RELAY1", "RELAY MOD", None, 0, relay)
    out["modules.json"][-1]["visual"] = {"kind": "relay", "pins": [0, 2], "threshold": 2.0}

    return out
