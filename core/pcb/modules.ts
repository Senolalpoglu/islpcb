// Footprints of the usual hobby modules: sensors, wireless boards, drivers. Each is a board outline with its header
// pins at 2.54 mm, named exactly like the pins printed on the module (the symbol of the matching library part uses
// the same names, so the pads wire themselves). Header order follows the common versions of each module; board
// outlines are the typical sizes sold by the big shops, so check yours against the module in hand.

import type { FootprintDef, PadDef } from './types';

interface Row {
  names: string[];
  x: number;
  y: number;
  dx: number;
  dy: number;
}

const P = 2.54;

const mod = (id: string, label: string, w: number, h: number, rows: Row[]): FootprintDef => {
  const pads: PadDef[] = [];
  rows.forEach((r, k) =>
    r.names.forEach((name, i) => pads.push({ name, x: r.x + i * r.dx, y: r.y + i * r.dy, shape: k === 0 && i === 0 ? 'rect' : 'round', w: 1.8, h: 1.8, drill: 1.0, pin: null })),
  );
  return { id, label, pads, body: { w, h } };
};

/** A vertical header of `names` starting at (x, y), going down. */
const down = (names: string[], x: number, y: number, pitch = P): Row => ({ names, x, y, dx: 0, dy: pitch });
/** A horizontal header of `names` starting at (x, y), going right. */
const across = (names: string[], x: number, y: number): Row => ({ names, x, y, dx: P, dy: 0 });
/** A horizontal header centred on x = 0. */
const centred = (names: string[], y: number): Row => across(names, (-(names.length - 1) * P) / 2, y);

const ESP32_LEFT = ['EN', 'VP', 'VN', 'D34', 'D35', 'D32', 'D33', 'D25', 'D26', 'D27', 'D14', 'D12', 'D13', 'GND', 'VIN'];
const ESP32_RIGHT = ['D23', 'D22', 'TX0', 'RX0', 'D21', 'D19', 'D18', 'D5', 'TX2', 'RX2', 'D4', 'D2', 'D15', 'GND2', '3V3'];
const NODEMCU_LEFT = ['A0', 'RSV1', 'RSV2', 'SD3', 'SD2', 'SD1', 'CMD', 'SD0', 'CLK', 'GND', '3V3', 'EN', 'RST', 'GND2', 'VIN'];
const NODEMCU_RIGHT = ['D0', 'D1', 'D2', 'D3', 'D4', '3V3_2', 'GND3', 'D5', 'D6', 'D7', 'D8', 'RX', 'TX', 'GND4', '3V3_3'];
const D1MINI_LEFT = ['RST', 'A0', 'D0', 'D5', 'D6', 'D7', 'D8', '3V3'];
const D1MINI_RIGHT = ['TX', 'RX', 'D1', 'D2', 'D3', 'D4', 'GND', '5V'];
const LCD16 = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'];

export const MODULE_FOOTPRINTS: FootprintDef[] = [
  mod('MOD_HX711', 'HX711 load-cell amplifier (34 x 21 mm)', 34, 21, [down(['GND', 'DT', 'SCK', 'VCC'], -14.5, -3.81), down(['E+', 'E-', 'A-', 'A+', 'B-', 'B+'], 14.5, -6.35)]),
  mod('MOD_HC05', 'HC-05 Bluetooth module (37 x 16 mm)', 37, 16, [down(['STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN'], -17, -6.35)]),
  mod('MOD_HC06', 'HC-06 Bluetooth module (28 x 13 mm)', 28, 13, [down(['VCC', 'GND', 'TXD', 'RXD'], -12, -3.81)]),
  mod('MOD_ESP01', 'ESP-01 WiFi module (24.8 x 14.5 mm)', 24.75, 14.5, [down(['GND', 'GPIO2', 'GPIO0', 'RXD'], 8.9, -3.81), down(['TXD', 'CH_PD', 'RST', 'VCC'], 11.44, -3.81)]),
  mod('MOD_ESP32', 'ESP32 DevKit 30 pins (51.5 x 28 mm)', 28, 51.5, [down(ESP32_LEFT, -12.7, -17.78), down(ESP32_RIGHT, 12.7, -17.78)]),
  mod('MOD_NODEMCU', 'NodeMCU ESP8266 30 pins (49 x 26 mm)', 26, 49, [down(NODEMCU_LEFT, -11.43, -17.78), down(NODEMCU_RIGHT, 11.43, -17.78)]),
  mod('MOD_D1MINI', 'Wemos D1 mini (34 x 26 mm)', 26, 34, [down(D1MINI_LEFT, -11.43, -8.89), down(D1MINI_RIGHT, 11.43, -8.89)]),
  mod('MOD_NRF24', 'nRF24L01+ module (15 x 29 mm)', 15, 29, [down(['GND', 'CE', 'SCK', 'MISO'], -1.27, -11.4), down(['VCC', 'CSN', 'MOSI', 'IRQ'], 1.27, -11.4)]),
  mod('MOD_SR04', 'HC-SR04 ultrasonic sensor (45 x 20 mm)', 45, 20, [centred(['VCC', 'TRIG', 'ECHO', 'GND'], 8.5)]),
  mod('MOD_OLED', 'OLED 0.96 inch I2C (27 x 27 mm)', 27, 27, [centred(['GND', 'VCC', 'SCL', 'SDA'], -11.5)]),
  mod('MOD_LCD1602', 'LCD 1602 character display (80 x 36 mm)', 80, 36, [centred(LCD16, -15.2)]),
  mod('MOD_LCD1602_I2C', 'LCD 1602 with I2C backpack (80 x 36 mm)', 80, 36, [centred(['GND', 'VCC', 'SDA', 'SCL'], -15.2)]),
  mod('MOD_GY521', 'GY-521 MPU-6050 module (21 x 16 mm)', 21, 16, [centred(['VCC', 'GND', 'SCL', 'SDA', 'XDA', 'XCL', 'AD0', 'INT'], -6.3)]),
  mod('MOD_BMP280', 'BMP280 / BME280 module (15 x 12 mm)', 15, 12, [centred(['VCC', 'GND', 'SCL', 'SDA', 'CSB', 'SDO'], -4.5)]),
  mod('MOD_DS3231', 'DS3231 RTC module (38 x 22 mm)', 38, 22, [centred(['32K', 'SQW', 'SCL', 'SDA', 'VCC', 'GND'], -9)]),
  mod('MOD_SDCARD', 'Micro SD card module (42 x 24 mm)', 42, 24, [centred(['GND', 'VCC', 'MISO', 'MOSI', 'SCK', 'CS'], -10)]),
  mod('MOD_NEO6M', 'GPS NEO-6M module (36 x 24 mm)', 36, 24, [centred(['VCC', 'RX', 'TX', 'GND'], -10)]),
  mod('MOD_PIR', 'PIR motion sensor HC-SR501 (32 x 24 mm)', 32, 24, [centred(['VCC', 'OUT', 'GND'], 9)]),
  mod('MOD_JOYSTICK', 'Joystick module KY-023 (26 x 34 mm)', 26, 34, [centred(['GND', '+5V', 'VRX', 'VRY', 'SW'], 14)]),
  mod('MOD_RELAY1', 'Relay module 1 channel (50 x 26 mm)', 50, 26, [down(['DC+', 'DC-', 'IN'], -22, -2.54), down(['NC', 'COM', 'NO'], 18, -5.08, 5.08)]),
  mod('MOD_SENSOR4', 'Analog sensor module (32 x 14 mm)', 32, 14, [centred(['VCC', 'GND', 'DO', 'AO'], 5)]),
  mod('MOD_RC522', 'RFID RC522 module (60 x 40 mm)', 60, 40, [centred(['SDA', 'SCK', 'MOSI', 'MISO', 'IRQ', 'GND', 'RST', '3V3'], 17)]),
  mod('MOD_TM1637', 'TM1637 4-digit display (42 x 24 mm)', 42, 24, [centred(['CLK', 'DIO', 'VCC', 'GND'], 10)]),
  mod('MOD_A4988', 'A4988 stepper driver (15.2 x 20.3 mm)', 15.24, 20.32, [down(['ENABLE', 'MS1', 'MS2', 'MS3', 'RESET', 'SLEEP', 'STEP', 'DIR'], -7.62, -8.89), down(['VMOT', 'GND_M', '2B', '2A', '1A', '1B', 'VDD', 'GND'], 7.62, -8.89)]),
  mod('MOD_ACS712', 'ACS712 current sensor module (31 x 13 mm)', 31, 13, [down(['VCC', 'OUT', 'GND'], 12, -2.54), down(['IP+', 'IP-'], -12, -2.54, 5.08)]),
  mod('MOD_NEXTION', 'Nextion display, 4-pin header (approximate board 86 x 56 mm)', 86, 56, [centred(['5V', 'TX', 'RX', 'GND'], 22)]),
  mod('MOD_L298N', 'L298N motor driver (43 x 43 mm)', 43, 43, [down(['OUT1', 'OUT2'], -19, -16, 5.08), down(['OUT3', 'OUT4'], 19, -16, 5.08), across(['12V', 'GND', '5V'], -5.08, 18), across(['ENA', 'IN1', 'IN2', 'IN3', 'IN4', 'ENB'], -6.35, -18)]),
];
