// A virtual Nextion display. It speaks the instruction set of the Nextion serial protocol (commands in text, each ended
// by three 0xFF bytes) and answers the way the real display does: return codes according to `bkcmd`, `get` replies,
// `sendme`, and touch events (0x65 page component state FF FF FF). What it shows is described by a small layout (pages
// with text, number, button and progress components), not by a .tft/.HMI file, which is a closed binary format.

export type NxType = 'text' | 'number' | 'button' | 'progress';

export interface NxComponent {
  type: NxType;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Text of a text or button component. */
  txt: string;
  /** Value of a number (integer) or progress (0-100) component. */
  val: number;
  /** Font colour and background colour, 16-bit RGB565 like on the real display. */
  pco: number;
  bco: number;
  /** Font number 0-7: the size of the letters. */
  font: number;
  vis: boolean;
  /** Whether the component reacts to touch (buttons do). */
  tsw: boolean;
}

export interface NxPage {
  name: string;
  bco: number;
  components: NxComponent[];
}

export interface NxLayout {
  width: number;
  height: number;
  pages: NxPage[];
}

export const NX_END = 0xff;

/** Return codes of the display. */
export const NX = { invalid: 0x00, ok: 0x01, badComponent: 0x02, badPage: 0x03, badAttribute: 0x1a, badOperation: 0x1b } as const;

export const rgb565 = (r: number, g: number, b: number): number => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);

/** A 16-bit RGB565 colour as a CSS colour. */
export function cssColor(v: number): string {
  const r = Math.round((((v >> 11) & 31) * 255) / 31);
  const g = Math.round((((v >> 5) & 63) * 255) / 63);
  const b = Math.round(((v & 31) * 255) / 31);
  return `rgb(${r},${g},${b})`;
}

/** Height in pixels of a font number: 0 is 16 px, 1 is 24, 2 is 32 ... */
export const fontPixels = (font: number): number => [16, 24, 32, 40, 48, 56, 64, 72][Math.max(0, Math.min(7, Math.round(font)))];

const WHITE = 65535;
const BLACK = 0;
const GREY = rgb565(60, 60, 60);

function component(partial: Partial<NxComponent> & Pick<NxComponent, 'type' | 'name'>): NxComponent {
  return { x: 0, y: 0, w: 100, h: 30, txt: '', val: 0, pco: WHITE, bco: BLACK, font: 0, vis: true, tsw: partial.type === 'button', ...partial };
}

/** The demo screen: a title, a status line, a counter and two buttons. Component ids on page 0 are t0=1, t1=2, n0=3, b0=4, b1=5. */
export const DEFAULT_LAYOUT: NxLayout = {
  width: 320,
  height: 240,
  pages: [
    {
      name: 'main',
      bco: rgb565(20, 24, 32),
      components: [
        component({ type: 'text', name: 't0', x: 10, y: 10, w: 300, h: 36, txt: 'ISL Nextion', font: 2, pco: rgb565(255, 190, 60), bco: rgb565(20, 24, 32) }),
        component({ type: 'text', name: 't1', x: 10, y: 56, w: 300, h: 30, txt: 'LED: OFF', font: 1, pco: rgb565(80, 220, 160), bco: rgb565(20, 24, 32) }),
        component({ type: 'number', name: 'n0', x: 10, y: 96, w: 140, h: 30, val: 0, font: 1, pco: WHITE, bco: rgb565(20, 24, 32) }),
        component({ type: 'button', name: 'b0', x: 10, y: 160, w: 145, h: 56, txt: 'LED', font: 1, bco: rgb565(40, 100, 180) }),
        component({ type: 'button', name: 'b1', x: 165, y: 160, w: 145, h: 56, txt: 'COUNT', font: 1, bco: rgb565(40, 140, 90) }),
      ],
    },
  ],
};

const NAME = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

const num = (v: unknown, lo: number, hi: number, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : fallback);

/**
 * Reads a layout from its JSON text. An empty text gives the demo screen; a text that is not a valid layout gives the demo
 * screen and a message saying what is wrong.
 */
export function parseLayout(text: string): { layout: NxLayout; error: string } {
  if (!text.trim()) return { layout: DEFAULT_LAYOUT, error: '' };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.pages) || raw.pages.length === 0) throw new Error('"pages" must be a list with at least one page');
    if (raw.pages.length > 16) throw new Error('at most 16 pages');
    const pages: NxPage[] = (raw.pages as Array<Record<string, unknown>>).map((p, pi) => {
      const comps = Array.isArray(p.components) ? (p.components as Array<Record<string, unknown>>) : [];
      if (comps.length > 64) throw new Error(`page ${pi}: at most 64 components`);
      const seen = new Set<string>();
      return {
        name: typeof p.name === 'string' && NAME.test(p.name) ? p.name : `page${pi}`,
        bco: num(p.bco, 0, 65535, GREY),
        components: comps.map((c, ci) => {
          const type = c.type;
          if (type !== 'text' && type !== 'number' && type !== 'button' && type !== 'progress') throw new Error(`page ${pi}, component ${ci + 1}: "type" must be text, number, button or progress`);
          if (typeof c.name !== 'string' || !NAME.test(c.name)) throw new Error(`page ${pi}, component ${ci + 1}: "name" must be letters, digits and _ (up to 16, starting with a letter)`);
          if (seen.has(c.name)) throw new Error(`page ${pi}: the name ${c.name} is used twice`);
          seen.add(c.name);
          return component({
            type,
            name: c.name,
            x: num(c.x, 0, 2000, 0),
            y: num(c.y, 0, 2000, 0),
            w: num(c.w, 1, 2000, 100),
            h: num(c.h, 1, 2000, 30),
            txt: typeof c.txt === 'string' ? c.txt.slice(0, 255) : '',
            val: num(c.val, -2147483648, 2147483647, 0),
            pco: num(c.pco, 0, 65535, WHITE),
            bco: num(c.bco, 0, 65535, BLACK),
            font: num(c.font, 0, 7, 0),
            vis: c.vis !== false,
            tsw: typeof c.tsw === 'boolean' ? c.tsw : type === 'button',
          });
        }),
      };
    });
    return { layout: { width: num(raw.width, 32, 1024, 320), height: num(raw.height, 32, 1024, 240), pages }, error: '' };
  } catch (e) {
    return { layout: DEFAULT_LAYOUT, error: e instanceof Error ? e.message : String(e) };
  }
}

const clone = (l: NxLayout): NxLayout => JSON.parse(JSON.stringify(l)) as NxLayout;

/** The display. Feed it the bytes the board sends; it calls `output` with the bytes it sends back. */
export class NextionDisplay {
  readonly layout: NxLayout;
  /** Layout as it is now (texts and values change while it runs). */
  private pages: NxPage[];
  page = 0;
  /** 0: no return codes, 1: only success, 2: only failure (default), 3: both. */
  bkcmd = 2;
  powered = false;
  /** Whether the wires to a board are there (set by the circuit): the display's RX to a board's TX, and its TX to a board's RX. */
  linkedRx = false;
  linkedTx = false;
  /** The component that is held down at the moment (for the picture). */
  pressed: number | null = null;
  output: (byte: number) => void = () => {};
  /** The instructions received so far, for the panel (newest last). */
  history: string[] = [];

  private buf: number[] = [];
  private ends = 0;

  constructor(layout: NxLayout = DEFAULT_LAYOUT) {
    this.layout = layout;
    this.pages = clone(layout).pages;
  }

  /** The current page with its components as they are now. */
  get current(): NxPage {
    return this.pages[this.page];
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Switching the power on: the display announces that it is ready (0x88). */
  setPower(on: boolean): void {
    if (on === this.powered) return;
    this.powered = on;
    if (on) {
      this.reset();
      this.send([0x88]);
    }
  }

  private reset(): void {
    this.pages = clone(this.layout).pages;
    this.page = 0;
    this.bkcmd = 2;
    this.pressed = null;
    this.buf = [];
    this.ends = 0;
  }

  private send(bytes: number[]): void {
    for (const b of bytes) this.output(b);
    for (let i = 0; i < 3; i++) this.output(NX_END);
  }

  private reply(code: number): void {
    const ok = code === NX.ok;
    if ((ok && (this.bkcmd === 1 || this.bkcmd === 3)) || (!ok && (this.bkcmd === 2 || this.bkcmd === 3))) this.send([code]);
  }

  /** One byte from the board. An instruction ends with three 0xFF. */
  feed(byte: number): void {
    if (!this.powered) return;
    if (byte === NX_END) {
      this.ends++;
      if (this.ends === 3) {
        const text = String.fromCharCode(...this.buf).trim();
        this.buf = [];
        this.ends = 0;
        if (text) this.execute(text);
      }
      return;
    }
    this.ends = 0;
    this.buf.push(byte);
    if (this.buf.length > 600) this.buf = [];
  }

  private find(name: string): { comp: NxComponent; id: number } | null {
    const i = this.current.components.findIndex((c) => c.name === name);
    return i >= 0 ? { comp: this.current.components[i], id: i + 1 } : null;
  }

  private pageIndex(arg: string): number {
    if (/^\d+$/.test(arg)) return Number(arg) < this.pages.length ? Number(arg) : -1;
    return this.pages.findIndex((p) => p.name === arg);
  }

  /** The value of an expression: a number, a quoted string, or `obj.attr` of a component on the current page. */
  private value(expr: string): number | string | null {
    const e = expr.trim();
    if (/^-?\d+$/.test(e)) return Number(e);
    if (/^0x[0-9a-f]+$/i.test(e)) return parseInt(e, 16);
    if (/^"(?:[^"\\]|\\.)*"$/.test(e)) return e.slice(1, -1).replace(/\\(.)/g, '$1');
    const m = /^([A-Za-z]\w*)\.(\w+)$/.exec(e);
    if (m) {
      const f = this.find(m[1]);
      if (f && (m[2] === 'txt' || m[2] === 'val' || m[2] === 'pco' || m[2] === 'bco' || m[2] === 'font')) return f.comp[m[2]];
    }
    return null;
  }

  private execute(text: string): void {
    this.history.push(text);
    if (this.history.length > 40) this.history.shift();
    // Assignment: obj.attr=value, obj.attr+=value, or a system variable (bkcmd=3, dim=50 ...).
    const assign = /^([A-Za-z]\w*)(?:\.(\w+))?\s*(\+?=)\s*(.+)$/.exec(text);
    if (assign) return this.assign(assign[1], assign[2], assign[3], assign[4]);
    const [word, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    switch (word) {
      case 'page': {
        const i = this.pageIndex(arg.trim());
        if (i < 0) return this.reply(NX.badPage);
        this.page = i;
        this.pressed = null;
        return this.reply(NX.ok);
      }
      case 'vis':
      case 'tsw': {
        const m = /^(\w+)\s*,\s*([01])$/.exec(arg);
        if (!m) return this.reply(NX.invalid);
        const targets = m[1] === '255' ? this.current.components : [this.find(m[1])?.comp].filter((c): c is NxComponent => !!c);
        if (targets.length === 0) return this.reply(NX.badComponent);
        for (const c of targets) c[word] = m[2] === '1';
        return this.reply(NX.ok);
      }
      case 'click': {
        const m = /^(\w+)\s*,\s*([01])$/.exec(arg);
        if (!m) return this.reply(NX.invalid);
        const f = this.find(m[1]);
        if (!f) return this.reply(NX.badComponent);
        this.event(f.id, m[2] === '1');
        return this.reply(NX.ok);
      }
      case 'get': {
        const v = this.value(arg);
        if (v === null) return this.reply(NX.badAttribute);
        if (typeof v === 'string') this.send([0x70, ...[...v].map((ch) => ch.charCodeAt(0) & 0xff)]);
        else this.send([0x71, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
        return;
      }
      case 'sendme':
        return this.send([0x66, this.page]);
      case 'printh': {
        const bytes = arg.split(/\s+/).filter(Boolean);
        if (bytes.length === 0 || bytes.some((b) => !/^[0-9a-f]{2}$/i.test(b))) return this.reply(NX.invalid);
        for (const b of bytes) this.output(parseInt(b, 16));
        return this.reply(NX.ok);
      }
      case 'rest':
        this.reset();
        return;
      case 'ref':
      case 'cls':
      case 'sleep':
      case 'dim':
      case 'dims':
      case 'thsp':
      case 'thup':
      case 'sendxy':
      case 'delay':
      case 'wup':
        return this.reply(NX.ok);
      default:
        return this.reply(NX.invalid);
    }
  }

  private assign(obj: string, attr: string | undefined, op: string, expr: string): void {
    const v = this.value(expr);
    if (v === null) return this.reply(NX.invalid);
    if (attr === undefined) {
      // System variables.
      if (obj === 'bkcmd') {
        if (typeof v !== 'number' || v < 0 || v > 3) return this.reply(NX.badOperation);
        this.bkcmd = v;
        return this.reply(NX.ok);
      }
      if (['dim', 'dims', 'sleep', 'thsp', 'thup', 'baud', 'bauds', 'usup', 'ussp', 'delay', 'sendxy', 'wup'].includes(obj)) return this.reply(NX.ok);
      return this.reply(NX.badComponent);
    }
    const f = this.find(obj);
    if (!f) return this.reply(NX.badComponent);
    const c = f.comp;
    switch (attr) {
      case 'txt': {
        if (c.type !== 'text' && c.type !== 'button') return this.reply(NX.badAttribute);
        if (typeof v !== 'string') return this.reply(NX.badOperation);
        c.txt = (op === '+=' ? c.txt + v : v).slice(0, 255);
        return this.reply(NX.ok);
      }
      case 'val': {
        if (c.type !== 'number' && c.type !== 'progress') return this.reply(NX.badAttribute);
        if (typeof v !== 'number') return this.reply(NX.badOperation);
        const next = op === '+=' ? c.val + v : v;
        c.val = c.type === 'progress' ? Math.max(0, Math.min(100, next)) : next | 0;
        return this.reply(NX.ok);
      }
      case 'pco':
      case 'bco':
      case 'font': {
        if (typeof v !== 'number') return this.reply(NX.badOperation);
        c[attr] = attr === 'font' ? Math.max(0, Math.min(7, v)) : v & 0xffff;
        return this.reply(NX.ok);
      }
      case 'vis':
      case 'tsw':
        if (typeof v !== 'number') return this.reply(NX.badOperation);
        c[attr] = v !== 0;
        return this.reply(NX.ok);
      default:
        // Attributes that only matter for the picture on a real display (pic, aph, key ...) are accepted and ignored.
        return this.reply(['pic', 'pic2', 'aph', 'key', 'sta', 'xcen', 'ycen', 'isbr', 'spax', 'spay', 'dis', 'lenth', 'dir', 'wid', 'hig', 'x', 'y'].includes(attr) ? NX.ok : NX.badAttribute);
    }
  }

  /** The send-component-id touch event: 0x65 page component state, then FF FF FF. */
  private event(id: number, pressed: boolean): void {
    this.send([0x65, this.page, id, pressed ? 1 : 0]);
  }

  /** The screen was touched (or let go) on component `id` (1-based, as on the real display). */
  touch(id: number, pressed: boolean): void {
    if (!this.powered) return;
    const c = this.current.components[id - 1];
    if (!c || !c.vis || !c.tsw) return;
    this.pressed = pressed ? id : null;
    this.event(id, pressed);
  }
}
