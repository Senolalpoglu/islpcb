// Compiles Arduino sketches with arduino-cli. Used by the app (IPC, electron/main.cjs) and by
// scripts/build-arduino-examples.cjs, so both agree on where the tool lives and how it is called.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const EXE = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';

/** Looks for arduino-cli: env var, next to the app, PATH, then the Arduino IDE 2 install. */
function findCli(extraDirs = []) {
  const candidates = [];
  if (process.env.ARDUINO_CLI) candidates.push(process.env.ARDUINO_CLI);
  for (const d of extraDirs) candidates.push(path.join(d, EXE));
  for (const d of (process.env.PATH || '').split(path.delimiter)) if (d) candidates.push(path.join(d, EXE));
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, 'Programs', 'Arduino IDE', 'resources', 'app', 'lib', 'backend', 'resources', EXE));
  return candidates.find((c) => fs.existsSync(c)) || null;
}

function run(cli, args, timeout = 180000) {
  return new Promise((resolve) => {
    execFile(cli, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

/**
 * Compiles sketch source text for a board. Resolves to { ok, hex, log }.
 * `hex` is the program in the form the emulator stores: Intel HEX for AVR boards (no bootloader, the emulator
 * starts at address 0) and the base64 of the flash image (.bin) for RP2040 boards.
 */
async function compileSketch(cli, source, fqbn = 'arduino:avr:uno') {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snlpcb-sketch-'));
  try {
    const sketchDir = path.join(work, 'sketch');
    fs.mkdirSync(sketchDir);
    fs.writeFileSync(path.join(sketchDir, 'sketch.ino'), source);
    const outDir = path.join(work, 'out');
    const r = await run(cli, ['compile', '--fqbn', fqbn, '--output-dir', outDir, sketchDir]);
    const rp = fqbn.startsWith('rp2040:');
    const outPath = path.join(outDir, rp ? 'sketch.ino.bin' : 'sketch.ino.hex');
    if (!r.ok || !fs.existsSync(outPath)) return { ok: false, hex: '', log: r.out };
    const program = rp ? fs.readFileSync(outPath).toString('base64') : fs.readFileSync(outPath, 'utf8');
    return { ok: true, hex: program, log: r.out };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = { findCli, compileSketch };
