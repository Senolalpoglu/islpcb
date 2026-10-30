// A small MPASM-compatible assembler for the 14-bit mid-range PICs.
//
// Supported: labels, ORG, EQU/SET, CBLOCK/ENDC, DW/DT/DE, #DEFINE, RADIX, END, #include of the chip's .inc,
// expressions (+ - * / % << >> & | ^ ~ parentheses, HIGH(), LOW(), $), the number forms D'', H'', B'', O'',
// A'', 0x, .nn and 'c'. Like MPASM, bare numbers are hexadecimal until RADIX DEC.
// Not supported: macros, conditional assembly, relocatable objects (UDATA/CODE) and linker scripts.

import { INCLUDE_FILES, PIC_INCLUDES } from './pic-includes';
import { PIC_CHIPS, type PicChipId } from './pic16';

export interface AsmError {
  line: number;
  message: string;
}

export interface AsmResult {
  ok: boolean;
  errors: AsmError[];
  /** Intel HEX text, ready for the emulator or a programmer. */
  hex: string;
  /** Number of program words emitted. */
  words: number;
}

type Radix = 16 | 10 | 8 | 2;

interface Stmt {
  line: number;
  label?: string;
  op?: string;
  args: string[];
}

// Instruction encoding by operand shape.
const FD: Record<string, number> = {
  ADDWF: 0x0700, ANDWF: 0x0500, COMF: 0x0900, DECF: 0x0300, DECFSZ: 0x0b00, INCF: 0x0a00, INCFSZ: 0x0f00,
  IORWF: 0x0400, MOVF: 0x0800, RLF: 0x0d00, RRF: 0x0c00, SUBWF: 0x0200, SWAPF: 0x0e00, XORWF: 0x0600,
};
const BIT: Record<string, number> = { BCF: 0x1000, BSF: 0x1400, BTFSC: 0x1800, BTFSS: 0x1c00 };
const LIT: Record<string, number> = { ADDLW: 0x3e00, ANDLW: 0x3900, IORLW: 0x3800, MOVLW: 0x3000, RETLW: 0x3400, SUBLW: 0x3c00, XORLW: 0x3a00 };
const NONE: Record<string, number> = { CLRW: 0x0100, CLRWDT: 0x0064, NOP: 0x0000, RETFIE: 0x0009, RETURN: 0x0008, SLEEP: 0x0063 };
const MNEMONICS = new Set([...Object.keys(FD), ...Object.keys(BIT), ...Object.keys(LIT), ...Object.keys(NONE), 'CLRF', 'MOVWF', 'CALL', 'GOTO']);
const DIRECTIVES = new Set(['LIST', 'ORG', 'EQU', 'SET', 'CBLOCK', 'ENDC', 'DW', 'DT', 'DE', 'END', 'RADIX', '__CONFIG', 'ERRORLEVEL', 'PROCESSOR', 'TITLE', 'SUBTITLE', 'PAGE', 'EXPAND', 'NOEXPAND', 'INCLUDE', '#INCLUDE', '#DEFINE', 'MESSG', 'DATA']);
const IGNORED = new Set(['LIST', '__CONFIG', 'ERRORLEVEL', 'PROCESSOR', 'TITLE', 'SUBTITLE', 'PAGE', 'EXPAND', 'NOEXPAND', 'MESSG']);

class AsmFail extends Error {}

/** Splits operands on top-level commas (not inside parentheses or quotes). */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if (ch === '(') {
      depth++;
      cur += ch;
    } else if (ch === ')') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

function stripComment(line: string): string {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"') quote = ch;
    else if (ch === "'" && i > 0 && /[hHbBdDoOaA]/.test(line[i - 1]) ) quote = ch; // H'1F'
    else if (ch === "'" && line[i + 2] === "'") i += 2; // 'c'
    else if (ch === ';') return line.slice(0, i);
  }
  return line;
}

class Assembler {
  private readonly errors: AsmError[] = [];
  private readonly symbols = new Map<string, number>();
  private readonly defines = new Map<string, string>();
  private readonly words = new Map<number, number>();
  private readonly ee = new Map<number, number>();
  private radix: Radix = 16;
  private pc = 0;
  private line = 0;
  private pass = 1;

  constructor(private readonly chip: PicChipId) {}

  private fail(message: string): never {
    throw new AsmFail(message);
  }

  // ---- expressions ----------------------------------------------------------------------------

  private number(tok: string): number | null {
    let m: RegExpExecArray | null;
    if ((m = /^0x([0-9a-f]+)$/i.exec(tok))) return parseInt(m[1], 16);
    if ((m = /^h'([0-9a-f]+)'$/i.exec(tok))) return parseInt(m[1], 16);
    if ((m = /^b'([01]+)'$/i.exec(tok))) return parseInt(m[1], 2);
    if ((m = /^d'([0-9]+)'$/i.exec(tok))) return parseInt(m[1], 10);
    if ((m = /^o'([0-7]+)'$/i.exec(tok))) return parseInt(m[1], 8);
    if ((m = /^a'(.)'$/i.exec(tok))) return m[1].charCodeAt(0);
    if ((m = /^'(.)'$/.exec(tok))) return m[1].charCodeAt(0);
    if ((m = /^\.([0-9]+)$/.exec(tok))) return parseInt(m[1], 10);
    if ((m = /^([0-9][0-9a-f]*)h$/i.exec(tok)) && this.radix !== 16) return parseInt(m[1], 16);
    if ((m = /^[0-9][0-9a-f]*$/i.exec(tok))) {
      const v = parseInt(tok, this.radix);
      if (Number.isNaN(v) || String(v.toString(this.radix)).length < tok.replace(/^0+/, '').length) this.fail(`Bad number "${tok}" for radix ${this.radix}`);
      return v;
    }
    return null;
  }

  private tokens(expr: string): string[] {
    const re = /\s*(0x[0-9a-f]+|[hbdoa]'[^']*'|'[^']'|\.[0-9]+|[0-9][0-9a-z]*|[a-z_?$][a-z0-9_?$.]*|<<|>>|[-+*/%&|^~()])/gi;
    const out: string[] = [];
    let pos = 0;
    let m: RegExpExecArray | null;
    while (pos < expr.length) {
      re.lastIndex = pos;
      m = re.exec(expr);
      if (!m || m.index !== pos) {
        if (expr.slice(pos).trim() === '') break;
        this.fail(`Unexpected "${expr.slice(pos).trim().charAt(0)}" in expression "${expr.trim()}"`);
      }
      out.push(m[1]);
      pos = re.lastIndex;
    }
    return out;
  }

  private evalExpr(expr: string): number {
    const toks = this.tokens(expr);
    let i = 0;
    const peek = (): string | undefined => toks[i];
    const primary = (): number => {
      const t = toks[i++];
      if (t === undefined) this.fail(`Incomplete expression "${expr.trim()}"`);
      if (t === '(') {
        const v = or();
        if (toks[i++] !== ')') this.fail('Missing )');
        return v;
      }
      if (t === '-') return -primary();
      if (t === '+') return primary();
      if (t === '~') return ~primary();
      if (t === '$') return this.pc;
      const n = this.number(t);
      if (n !== null) return n;
      const up = t.toUpperCase();
      if (up === 'HIGH' || up === 'LOW') {
        // MPASM accepts both HIGH(expr) and the prefix form HIGH label.
        let v: number;
        if (toks[i] === '(') {
          i++;
          v = or();
          if (toks[i++] !== ')') this.fail('Missing )');
        } else v = primary();
        return up === 'HIGH' ? (v >> 8) & 0xff : v & 0xff;
      }
      if (this.symbols.has(up)) return this.symbols.get(up)!;
      if (this.pass === 1) return 0; // forward references resolve in pass 2
      return this.fail(`Undefined symbol "${t}"`);
    };
    const bin = (next: () => number, ops: Record<string, (a: number, b: number) => number>): (() => number) => () => {
      let v = next();
      while (peek() !== undefined && peek()! in ops) {
        const op = toks[i++];
        v = ops[op](v, next());
      }
      return v;
    };
    const mul = bin(primary, { '*': (a, b) => a * b, '/': (a, b) => (b === 0 ? this.fail('Division by zero') : Math.trunc(a / b)), '%': (a, b) => (b === 0 ? this.fail('Division by zero') : a % b) });
    const add = bin(mul, { '+': (a, b) => a + b, '-': (a, b) => a - b });
    const shift = bin(add, { '<<': (a, b) => a << b, '>>': (a, b) => a >> b });
    const and = bin(shift, { '&': (a, b) => a & b });
    const xor = bin(and, { '^': (a, b) => a ^ b });
    const or = bin(xor, { '|': (a, b) => a | b });
    const v = or();
    if (i < toks.length) this.fail(`Unexpected "${toks[i]}" in expression "${expr.trim()}"`);
    return v;
  }

  // ---- parsing --------------------------------------------------------------------------------

  private applyDefines(text: string): string {
    if (this.defines.size === 0) return text;
    return text.replace(/[A-Za-z_?][A-Za-z0-9_?]*/g, (w) => this.defines.get(w.toUpperCase()) ?? w);
  }

  private parse(source: string): Stmt[] {
    const stmts: Stmt[] = [];
    source.split(/\r?\n/).forEach((raw, idx) => {
      this.line = idx + 1;
      const text = stripComment(raw).replace(/\s+$/, '');
      if (!text.trim()) return;
      let rest = text;
      let label: string | undefined;
      const colMatch = /^([A-Za-z_?][A-Za-z0-9_?]*)(:?)(?=\s|$)/.exec(rest);
      if (colMatch && !/^\s/.test(rest)) {
        const word = colMatch[1].toUpperCase();
        const isOp = (MNEMONICS.has(word) || DIRECTIVES.has(word)) && !colMatch[2];
        if (!isOp) {
          label = word;
          rest = rest.slice(colMatch[0].length);
        }
      }
      rest = rest.trim();
      if (!rest) {
        stmts.push({ line: this.line, label, args: [] });
        return;
      }
      const m = /^(#?[A-Za-z_?][A-Za-z0-9_?]*)\s*(.*)$/.exec(rest);
      if (!m) {
        this.errors.push({ line: this.line, message: `Cannot parse "${rest}"` });
        return;
      }
      let op = m[1].toUpperCase();
      let args = m[2];
      // "NAME EQU value" has the name in the label column or the operator column.
      const second = /^(EQU|SET)\s+(.*)$/i.exec(args);
      if (second && !label) {
        label = op;
        op = second[1].toUpperCase();
        args = second[2];
      }
      if (op === '#DEFINE') {
        const dm = /^([A-Za-z_?][A-Za-z0-9_?]*)\s*(.*)$/.exec(args);
        if (dm) this.defines.set(dm[1].toUpperCase(), dm[2].trim());
        return;
      }
      stmts.push({ line: this.line, label, op, args: op === 'INCLUDE' || op === '#INCLUDE' ? [args.trim()] : splitArgs(this.applyDefines(args)) });
    });
    return stmts;
  }

  // ---- passes ---------------------------------------------------------------------------------

  private guard(line: number, fn: () => void): void {
    this.line = line;
    try {
      fn();
    } catch (e) {
      if (e instanceof AsmFail) this.errors.push({ line, message: e.message });
      else throw e;
    }
  }

  private define(name: string, value: number): void {
    if (this.pass === 1 && this.symbols.has(name) && PIC_INCLUDES[this.chip][name] === undefined) this.fail(`Symbol "${name}" is defined twice`);
    this.symbols.set(name, value);
  }

  private run(stmts: Stmt[]): void {
    let cblock: number | null = null;
    for (const s of stmts) {
      this.guard(s.line, () => {
        if (cblock !== null && s.op !== 'ENDC') {
          // Inside CBLOCK each line is: name[:size], name ...
          const names = s.label ? [s.label, ...(s.op ? [s.op, ...s.args] : [])] : [s.op!, ...s.args];
          for (const item of names.filter(Boolean)) {
            const [nm, size] = item.split(':');
            this.define(nm.toUpperCase(), cblock!);
            cblock! += size ? this.evalExpr(size) : 1;
          }
          return;
        }
        if (s.label && s.op !== 'EQU' && s.op !== 'SET') this.define(s.label, this.pc);
        if (!s.op) return;
        const op = s.op;
        if (IGNORED.has(op)) return;
        if (op === 'EQU' || op === 'SET') {
          if (!s.label) this.fail(`${op} needs a name`);
          this.pass === 1 && op === 'EQU' && this.symbols.has(s.label) ? this.fail(`Symbol "${s.label}" is defined twice`) : this.symbols.set(s.label, this.evalExpr(s.args[0] ?? ''));
          return;
        }
        if (op === 'ORG') {
          this.pc = this.evalExpr(s.args[0] ?? '');
          return;
        }
        if (op === 'END') return;
        if (op === 'RADIX') {
          const r = (s.args[0] ?? '').toUpperCase();
          this.radix = r === 'DEC' ? 10 : r === 'HEX' ? 16 : r === 'OCT' ? 8 : this.fail(`Unknown radix "${s.args[0]}"`);
          return;
        }
        if (op === 'INCLUDE' || op === '#INCLUDE') {
          const name = (s.args[0] ?? '').replace(/^[<"]|[>"]$/g, '').toLowerCase();
          if (!(name in INCLUDE_FILES)) this.fail(`Cannot find include file "${name}"`);
          return; // the chip's registers are always defined
        }
        if (op === 'CBLOCK') {
          cblock = s.args[0] ? this.evalExpr(s.args[0]) : 0;
          return;
        }
        if (op === 'ENDC') {
          cblock = null;
          return;
        }
        if (op === 'DW' || op === 'DATA') {
          for (const a of s.args) this.emit(this.evalExpr(a) & 0x3fff);
          return;
        }
        if (op === 'DT') {
          for (const a of s.args) {
            if (/^".*"$/.test(a)) for (const ch of a.slice(1, -1)) this.emit(0x3400 | ch.charCodeAt(0));
            else this.emit(0x3400 | (this.evalExpr(a) & 0xff));
          }
          return;
        }
        if (op === 'DE') {
          let addr = this.pc & 0xff;
          for (const a of s.args) {
            if (/^".*"$/.test(a)) for (const ch of a.slice(1, -1)) this.ee.set(addr++, ch.charCodeAt(0));
            else this.ee.set(addr++, this.evalExpr(a) & 0xff);
          }
          this.pc += Math.ceil((addr - (this.pc & 0xff)) / 2);
          return;
        }
        this.instruction(op, s.args);
      });
    }
  }

  private emit(word: number): void {
    if (this.pass === 2) {
      if (this.pc >= PIC_CHIPS[this.chip].flashWords) this.fail(`Address 0x${this.pc.toString(16)} is beyond the ${PIC_CHIPS[this.chip].flashWords}-word program memory`);
      if (this.words.has(this.pc)) this.fail(`Address 0x${this.pc.toString(16)} is used twice (overlapping ORG sections)`);
      this.words.set(this.pc, word & 0x3fff);
    }
    this.pc++;
  }

  private operandCount(op: string, args: string[], min: number, max: number): void {
    if (args.length < min || args.length > max) this.fail(`${op} expects ${min === max ? min : `${min}-${max}`} operand(s), got ${args.length}`);
  }

  private instruction(op: string, args: string[]): void {
    const reg = (a: string): number => this.evalExpr(a) & 0x7f;
    const dest = (a: string | undefined): number => {
      if (a === undefined) return 0x80; // MPASM defaults to F
      const v = this.evalExpr(a);
      if (v !== 0 && v !== 1) this.fail(`Destination must be W (0) or F (1), got ${v}`);
      return v ? 0x80 : 0;
    };
    if (op in FD) {
      this.operandCount(op, args, 1, 2);
      this.emit(FD[op] | dest(args[1]) | reg(args[0]));
    } else if (op === 'CLRF' || op === 'MOVWF') {
      this.operandCount(op, args, 1, 1);
      this.emit((op === 'CLRF' ? 0x0180 : 0x0080) | reg(args[0]));
    } else if (op in BIT) {
      this.operandCount(op, args, 2, 2);
      const b = this.evalExpr(args[1]);
      if (b < 0 || b > 7) this.fail(`Bit number must be 0-7, got ${b}`);
      this.emit(BIT[op] | (b << 7) | reg(args[0]));
    } else if (op in LIT) {
      this.operandCount(op, args, 1, 1);
      const k = this.evalExpr(args[0]);
      if (k < -128 || k > 255) this.fail(`Literal ${k} does not fit in 8 bits`);
      this.emit(LIT[op] | (k & 0xff));
    } else if (op === 'CALL' || op === 'GOTO') {
      this.operandCount(op, args, 1, 1);
      const k = this.evalExpr(args[0]);
      if (this.pass === 2 && (k < 0 || k > 0x7ff)) this.fail(`${op} target 0x${k.toString(16)} is outside the 11-bit page range; set PCLATH and use a computed jump`);
      this.emit((op === 'CALL' ? 0x2000 : 0x2800) | (k & 0x7ff));
    } else if (op in NONE) {
      this.operandCount(op, args, 0, 0);
      this.emit(NONE[op]);
    } else {
      this.fail(`Unknown instruction or directive "${op}"`);
    }
  }

  assemble(source: string): AsmResult {
    for (const [k, v] of Object.entries(PIC_INCLUDES[this.chip])) this.symbols.set(k.toUpperCase(), v);
    const stmts = this.parse(source);
    this.pass = 1;
    this.pc = 0;
    this.run(stmts);
    const pass1Errors = this.errors.splice(0);
    this.pass = 2;
    this.pc = 0;
    this.radix = 16;
    this.words.clear();
    this.ee.clear();
    this.run(stmts);
    const errors = [...pass1Errors.filter((e) => !this.errors.some((x) => x.line === e.line && x.message === e.message)), ...this.errors]
      .filter((e, i, all) => all.findIndex((x) => x.line === e.line && x.message === e.message) === i)
      .sort((a, b) => a.line - b.line);
    return { ok: errors.length === 0, errors, hex: errors.length ? '' : this.hex(), words: this.words.size };
  }

  private hex(): string {
    const lines: string[] = [];
    const rec = (addr: number, type: number, data: number[]): void => {
      const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
      const sum = bytes.reduce((a, b) => a + b, 0);
      lines.push(`:${[...bytes, (-sum) & 0xff].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
    };
    const bytes = new Map<number, number>();
    for (const [w, v] of this.words) {
      bytes.set(w * 2, v & 0xff);
      bytes.set(w * 2 + 1, v >> 8);
    }
    for (const [a, v] of this.ee) bytes.set(0x4200 + a * 2, v); // data EEPROM lives at word address 0x2100
    const addrs = [...bytes.keys()].sort((a, b) => a - b);
    let i = 0;
    while (i < addrs.length) {
      const start = addrs[i];
      const chunk: number[] = [];
      while (i < addrs.length && addrs[i] === start + chunk.length && chunk.length < 16) chunk.push(bytes.get(addrs[i++])!);
      rec(start, 0, chunk);
    }
    rec(0, 1, []);
    return `${lines.join('\n')}\n`;
  }
}

export function assemblePic(source: string, chip: PicChipId): AsmResult {
  return new Assembler(chip).assemble(source);
}
