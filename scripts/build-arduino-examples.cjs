// Compiles every sketch in library/arduino/<name>/<name>.ino for each supported AVR board:
//   <name>.hex       Arduino UNO / Nano (ATmega328P)
//   <name>.mega.hex  Arduino Mega 2560 (ATmega2560)
//   <name>.pico.b64  Raspberry Pi Pico (RP2040), base64 of the flash image; needs the Arduino-Pico core
//                    (skipped with a warning when it is not installed)
// The hex files are committed so the app's examples run without an Arduino toolchain installed.
// Usage: node scripts/build-arduino-examples.cjs [sketch name]   (one sketch only, when a name is given)

const fs = require('fs');
const path = require('path');
const { findCli, compileSketch } = require('../electron/arduino.cjs');

const root = path.resolve(__dirname, '..', 'library', 'arduino');
const BOARDS = [
  { ext: '.hex', fqbn: 'arduino:avr:uno' },
  { ext: '.mega.hex', fqbn: 'arduino:avr:mega:cpu=atmega2560' },
  { ext: '.pico.b64', fqbn: 'rp2040:rp2040:rpipico', optional: true },
];

(async () => {
  const cli = findCli();
  if (!cli) {
    console.error('arduino-cli not found. Install the Arduino IDE 2 or set ARDUINO_CLI to the executable.');
    process.exit(1);
  }
  let failed = 0;
  const only = process.argv[2];
  for (const name of fs.readdirSync(root).filter((n) => fs.statSync(path.join(root, n)).isDirectory() && (!only || n === only))) {
    const src = path.join(root, name, `${name}.ino`);
    if (!fs.existsSync(src)) continue;
    for (const board of BOARDS) {
      const r = await compileSketch(cli, fs.readFileSync(src, 'utf8'), board.fqbn);
      if (r.ok) {
        fs.writeFileSync(path.join(root, name, `${name}${board.ext}`), r.hex);
        console.log(`${name}${board.ext}: ${r.hex.split('\n').length} hex lines`);
      } else {
        failed++;
        console.error(`${name} (${board.fqbn}): FAILED\n${r.log}`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
})();
