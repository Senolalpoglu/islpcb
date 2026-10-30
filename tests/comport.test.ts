import { beforeAll, describe, expect, it } from 'vitest';
import { Simulator, type Solution } from '../core/sim/solver';
import { EXAMPLES } from '../src/editor/examples';
import { loadBuiltinLibrary } from '../src/editor/library';
import { extractNetlist } from '../src/editor/netlist';
import { ComBridge, baudOfSource, encodeMessage, formatTraffic, type SerialPortLike, type SerialProvider, type Traffic } from '../src/sim/comPort';
import { McuRig } from '../src/sim/rig';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A serial port without hardware: `push` plays bytes that arrive, `written` collects what is sent out. */
function fakePort() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const written: number[] = [];
  const chunks: number[] = [];
  const state = { opened: 0, closed: 0, baud: 0 };
  const port: SerialPortLike = {
    async open(o) {
      state.opened++;
      state.baud = o.baudRate;
    },
    async close() {
      state.closed++;
    },
    readable: new ReadableStream<Uint8Array>({ start: (c) => (controller = c) }),
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        chunks.push(chunk.length);
        written.push(...chunk);
      },
    }),
    getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
  };
  return {
    port,
    state,
    written,
    chunks,
    push: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    unplug: () => controller.close(),
  };
}

const providerOf = (port: SerialPortLike): SerialProvider => ({ requestPort: async () => port });

describe('COM port bridge', () => {
  it('opens the chosen port at the baud rate and counts what arrives', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    const got: string[] = [];
    bridge.onRx = (b) => got.push(new TextDecoder().decode(b));
    await bridge.connect(115200);
    expect(bridge.state).toBe('open');
    expect(f.state.baud).toBe(115200);
    expect(bridge.label).toBe('USB 1a86:7523');
    f.push('LED ON\n');
    await sleep(20);
    expect(got.join('')).toBe('LED ON\n');
    expect(bridge.rxBytes).toBe(7);
    await bridge.disconnect();
    expect(bridge.state).toBe('closed');
    expect(f.state.closed).toBe(1);
  });

  it('collects the bytes of the board and writes them to the port together, in order', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    await bridge.connect(9600);
    for (const ch of 'OK LED=1\r\n') bridge.send(ch.charCodeAt(0));
    expect(f.written).toHaveLength(0); // not yet: they are gathered for a few ms
    await sleep(30);
    expect(new TextDecoder().decode(Uint8Array.from(f.written))).toBe('OK LED=1\r\n');
    expect(f.chunks).toHaveLength(1);
    expect(bridge.txBytes).toBe(10);
    await bridge.disconnect();
  });

  it('ignores bytes while no port is connected', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    bridge.send(65);
    await sleep(10);
    expect(f.written).toHaveLength(0);
    expect(bridge.txBytes).toBe(0);
  });

  it('closing the port chooser is not an error, a real failure is reported', async () => {
    const cancelled = new ComBridge({ requestPort: async () => Promise.reject(Object.assign(new Error('No port selected by the user.'), { name: 'NotFoundError' })) });
    await cancelled.connect(9600);
    expect(cancelled.state).toBe('closed');
    expect(cancelled.error).toBe('');
    const busy = new ComBridge({ requestPort: async () => ({ ...fakePort().port, open: async () => Promise.reject(new Error('Access denied')) }) });
    await busy.connect(9600);
    expect(busy.state).toBe('closed');
    expect(busy.error).toBe('Access denied');
  });

  it('notices when the adapter is unplugged', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    await bridge.connect(9600);
    f.unplug();
    await sleep(30);
    expect(bridge.state).toBe('closed');
    expect(bridge.error).toContain('closed');
  });

  it('there is no bridge without Web Serial', () => {
    expect(new ComBridge(null).available).toBe(false);
  });

  it('reads the baud rate out of a sketch', () => {
    expect(baudOfSource('void setup() { Serial.begin(115200); }')).toBe(115200);
    expect(baudOfSource('Serial . begin( 9600 )')).toBe(9600);
    expect(baudOfSource('Serial1.begin(57600);')).toBe(57600);
    expect(baudOfSource('void setup() {}')).toBeNull();
  });
});

describe('monitor in the manner of the Arduino IDE', () => {
  const text = (r: ReturnType<typeof encodeMessage>) => ('bytes' in r ? [...r.bytes] : r.error);

  it('adds the chosen line ending to a typed message', () => {
    expect(text(encodeMessage('LED ON', 'none', false))).toEqual([...new TextEncoder().encode('LED ON')]);
    expect(text(encodeMessage('hi', 'lf', false))).toEqual([0x68, 0x69, 0x0a]);
    expect(text(encodeMessage('hi', 'cr', false))).toEqual([0x68, 0x69, 0x0d]);
    expect(text(encodeMessage('hi', 'crlf', false))).toEqual([0x68, 0x69, 0x0d, 0x0a]);
    // A Nextion display wants the command followed by three 0xFF bytes.
    expect(text(encodeMessage('page 1', 'nextion', false))).toEqual([...new TextEncoder().encode('page 1'), 0xff, 0xff, 0xff]);
  });

  it('sends non-ASCII text as UTF-8', () => {
    expect(text(encodeMessage('ş', 'none', false))).toEqual([0xc5, 0x9f]);
  });

  it('takes hex bytes in the usual spellings and refuses anything else', () => {
    expect(text(encodeMessage('65 ff 0A', 'none', true))).toEqual([0x65, 0xff, 0x0a]);
    expect(text(encodeMessage('0x41,0x0a;7', 'lf', true))).toEqual([0x41, 0x0a, 0x07, 0x0a]);
    expect(text(encodeMessage('', 'nextion', true))).toEqual([0xff, 0xff, 0xff]);
    expect(text(encodeMessage('65 GG', 'none', true))).toBe('GG');
    expect(text(encodeMessage('123', 'none', true))).toBe('123');
  });

  it('shows what arrives as text (escaping the unprintable bytes) or as hex, and what was sent after an arrow', () => {
    const rx = (s: number[]): Traffic => ({ dir: 'rx', bytes: Uint8Array.from(s) });
    const log: Traffic[] = [rx([...new TextEncoder().encode('Hel')]), rx([...new TextEncoder().encode('lo\r\n')]), { dir: 'tx', bytes: Uint8Array.from([...new TextEncoder().encode('ping'), 0x0a]) }, rx([0x70, 0xff, 0xff, 0xff])];
    expect(formatTraffic(log, false)).toBe('Hello\r\n→ ping\np\\xFF\\xFF\\xFF');
    expect(formatTraffic(log, true)).toBe('48 65 6C 6C 6F 0D 0A \n→ 70 69 6E 67 0A\n70 FF FF FF ');
  });

  it('writes a typed message to the port, keeps a log of both directions, and can clear it', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    expect(bridge.write(Uint8Array.from([1]))).toBe(false); // nothing connected yet
    await bridge.connect(9600);
    f.push('pong\n');
    await sleep(20);
    expect(bridge.write(Uint8Array.from([0x70, 0x69, 0x6e, 0x67, 0x0a]))).toBe(true);
    await sleep(10);
    expect(new TextDecoder().decode(Uint8Array.from(f.written))).toBe('ping\n');
    expect(bridge.log.map((e) => e.dir)).toEqual(['rx', 'tx']);
    expect(bridge.txBytes).toBe(5);
    bridge.clearLog();
    expect(bridge.log).toHaveLength(0);
    await bridge.disconnect();
  });

  it('keeps the log from growing without end', async () => {
    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    await bridge.connect(9600);
    for (let i = 0; i < 4500; i++) bridge.write(Uint8Array.from([i & 0xff]));
    expect(bridge.log.length).toBeLessThanOrEqual(4000);
    await bridge.disconnect();
  });
});

describe('a real port driving the simulated board', () => {
  it('commands that arrive on the port switch the LED, the answer goes back out on the port', async () => {
    const ex = EXAMPLES.find((e) => e.id === 'ino-serial-control')!;
    const doc = ex.build();
    const x = extractNetlist(doc);
    const sim = new Simulator(x.netlist!);
    const rig = new McuRig(doc, x, x.netlist!);
    let last: Solution = sim.beginTransient(ex.dt, true);
    rig.prime(last);
    const runTo = (t: number) => {
      while (last.time < t - ex.dt / 2) last = rig.step(sim, ex.dt);
    };
    const led = doc.parts.find((p) => p.type === 'LED')!.id;

    const f = fakePort();
    const bridge = new ComBridge(providerOf(f.port));
    bridge.onRx = (bytes) => rig.sendBytes(bytes);
    rig.tap = (b) => bridge.send(b);
    await bridge.connect(9600);

    runTo(0.3);
    expect(Math.abs(last.i[led])).toBeLessThan(1e-6);
    f.push('LED ON\r\n');
    await sleep(20); // the bytes reach the rig
    runTo(0.8);
    expect(last.i[led]).toBeGreaterThan(7e-3); // the board obeyed
    await sleep(30);
    const reply = new TextDecoder().decode(Uint8Array.from(f.written));
    expect(reply).toContain('Ready:'); // what the board printed at start-up went out on the port, too
    expect(reply).toContain('OK LED=1 RELAY=0');
    await bridge.disconnect();
  });
});
