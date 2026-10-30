// A real serial (COM) port connected to the simulated board: what comes in on the port is typed into the board's serial
// input, and what the board prints goes out on the port. It wraps the browser's Web Serial API (which Electron has),
// behind small interfaces so that it can be tested without hardware.

/** The part of a Web Serial port that is used here. */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}

/** `navigator.serial`. */
export interface SerialProvider {
  requestPort(): Promise<SerialPortLike>;
}

export type ComState = 'closed' | 'opening' | 'open';

/** The common baud rates offered in the panel. */
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 250000];

/** The Web Serial provider of this page, or null when there is none. */
export const browserSerial = (): SerialProvider | null => (typeof navigator !== 'undefined' ? ((navigator as unknown as { serial?: SerialProvider }).serial ?? null) : null);

/** The baud rate a sketch asks for (`Serial.begin(115200)`), or null when it does not say. */
export function baudOfSource(source: string): number | null {
  const m = /Serial\d?\s*\.\s*begin\s*\(\s*(\d{3,7})/.exec(source);
  return m ? Number(m[1]) : null;
}

/** What is appended to a typed message, like the line ending menu of the Arduino IDE (plus Nextion's three 0xFF). */
export type LineEnding = 'none' | 'lf' | 'cr' | 'crlf' | 'nextion';

export const LINE_ENDINGS: Record<LineEnding, number[]> = { none: [], lf: [0x0a], cr: [0x0d], crlf: [0x0d, 0x0a], nextion: [0xff, 0xff, 0xff] };

/**
 * The bytes of a typed message: its text in UTF-8, or in hex mode the bytes written as hex numbers ("65 FF", "0x41,0x0A"),
 * followed by the line ending. Returns the offending word for anything that is not a hex byte.
 */
export function encodeMessage(text: string, ending: LineEnding, hex: boolean): { bytes: Uint8Array } | { error: string } {
  let body: number[];
  if (hex) {
    body = [];
    for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
      const t = token.replace(/^0x/i, '');
      if (!/^[0-9a-fA-F]{1,2}$/.test(t)) return { error: token };
      body.push(parseInt(t, 16));
    }
  } else body = [...new TextEncoder().encode(text)];
  return { bytes: Uint8Array.from([...body, ...LINE_ENDINGS[ending]]) };
}

/** One thing that happened on the port: a chunk that arrived (`rx`) or a message typed by the user (`tx`). */
export interface Traffic {
  dir: 'rx' | 'tx';
  bytes: Uint8Array;
}

const hexOf = (b: Uint8Array): string => [...b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join(' ');

/** Bytes as the monitor shows them as text: printable characters and line breaks as they are, the rest as a backslash-x escape. */
const textOf = (b: Uint8Array): string =>
  [...b].map((v) => (v === 0x0a || v === 0x0d || v === 0x09 || (v >= 0x20 && v < 0x7f) ? String.fromCharCode(v) : `\\x${v.toString(16).padStart(2, '0').toUpperCase()}`)).join('');

/**
 * The traffic as the monitor shows it: what arrives as it is (as text, or as hex bytes), what the user sent on a line of
 * its own, marked with an arrow.
 */
export function formatTraffic(log: readonly Traffic[], hex: boolean): string {
  let out = '';
  for (const t of log) {
    if (t.dir === 'rx') out += hex ? `${hexOf(t.bytes)} ` : textOf(t.bytes);
    else {
      if (out && !out.endsWith('\n')) out += '\n';
      out += `→ ${hex ? hexOf(t.bytes) : textOf(t.bytes).replace(/[\r\n]+$/, '')}\n`;
    }
  }
  return out;
}

/** How many events the monitor keeps. */
const LOG_LIMIT = 4000;

/** How long outgoing bytes are collected before they are written to the port in one piece, in ms. */
const FLUSH_MS = 4;

export class ComBridge {
  state: ComState = 'closed';
  /** The last problem (port unplugged, could not be opened), cleared on the next connection. */
  error = '';
  /** How the port was described when it was chosen, e.g. "USB 1a86:7523". */
  label = '';
  baud = 9600;
  rxBytes = 0;
  txBytes = 0;
  /** What arrived and what the user sent, newest last (limited). */
  log: Traffic[] = [];
  /** Called with every chunk that arrives on the port. */
  onRx: (bytes: Uint8Array) => void = () => {};
  /** Called whenever the state, the counters or the error change. */
  onChange: () => void = () => {};

  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private outgoing: number[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly provider: SerialProvider | null) {}

  get available(): boolean {
    return this.provider !== null;
  }

  /** Lets the user choose a port, opens it at `baud` and starts reading. */
  async connect(baud: number): Promise<void> {
    if (!this.provider || this.state !== 'closed') return;
    this.error = '';
    this.state = 'opening';
    this.onChange();
    try {
      const port = await this.provider.requestPort();
      await port.open({ baudRate: baud });
      if (!port.readable || !port.writable) throw new Error('the port has no data streams');
      this.port = port;
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();
      const info = port.getInfo?.() ?? {};
      this.label = info.usbVendorId !== undefined ? `USB ${info.usbVendorId.toString(16).padStart(4, '0')}:${(info.usbProductId ?? 0).toString(16).padStart(4, '0')}` : 'COM';
      this.baud = baud;
      this.rxBytes = 0;
      this.txBytes = 0;
      this.state = 'open';
      this.onChange();
      void this.readLoop();
    } catch (e) {
      this.cleanup();
      // Closing the chooser without a choice is not an error.
      const name = e instanceof Error ? e.name : '';
      this.error = name === 'NotFoundError' || name === 'AbortError' ? '' : e instanceof Error ? e.message : String(e);
      this.onChange();
    }
  }

  async disconnect(): Promise<void> {
    if (this.state === 'closed') return;
    const port = this.port;
    const reader = this.reader;
    const writer = this.writer;
    this.flush();
    this.cleanup();
    try {
      await reader?.cancel();
    } catch {
      /* already gone */
    }
    try {
      reader?.releaseLock();
      writer?.releaseLock();
      await port?.close();
    } catch {
      /* the port was unplugged */
    }
    this.onChange();
  }

  /** Writes a message typed by the user to the port at once. Returns false when no port is open. */
  write(bytes: Uint8Array): boolean {
    if (this.state !== 'open' || !this.writer || bytes.length === 0) return false;
    this.flush();
    this.txBytes += bytes.length;
    this.record({ dir: 'tx', bytes });
    this.writer.write(bytes).catch((e: unknown) => this.lost(e));
    this.onChange();
    return true;
  }

  clearLog(): void {
    this.log = [];
    this.onChange();
  }

  private record(t: Traffic): void {
    this.log.push(t);
    if (this.log.length > LOG_LIMIT) this.log.splice(0, this.log.length - LOG_LIMIT);
  }

  /** Queues one byte for the port (from the simulated board). Bytes are written together a few ms later. */
  send(byte: number): void {
    if (this.state !== 'open') return;
    this.outgoing.push(byte & 0xff);
    if (this.timer === null) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.outgoing.length === 0 || !this.writer) return;
    const chunk = Uint8Array.from(this.outgoing);
    this.outgoing = [];
    this.txBytes += chunk.length;
    this.writer.write(chunk).catch((e: unknown) => this.lost(e));
    this.onChange();
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    try {
      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.length > 0) {
          this.rxBytes += value.length;
          this.record({ dir: 'rx', bytes: value });
          this.onRx(value);
          this.onChange();
        }
      }
    } catch (e) {
      this.lost(e);
      return;
    }
    // The stream ended by itself (the adapter was unplugged) unless we closed it.
    if (this.state === 'open') this.lost(new Error('the port was closed'));
  }

  private lost(e: unknown): void {
    if (this.state === 'closed') return;
    this.error = e instanceof Error ? e.message : String(e);
    void this.disconnect();
  }

  private cleanup(): void {
    this.state = 'closed';
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.outgoing = [];
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
