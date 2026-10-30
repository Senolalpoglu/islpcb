// Co-simulation of microcontroller firmware and the analog circuit around it.
// Per time step: the firmware runs for dt and sets what each pin drives, the circuit solver settles
// with those drives, then each pin senses the voltage of its net (digital level and ADC input).

import { AvrBoard } from '../../core/mcu/avr';
import { base64ToBytes, type McuBoard } from '../../core/mcu/board';
import { NextionDisplay, parseLayout } from '../../core/mcu/nextion';
import { Pic16, type PicChipId } from '../../core/mcu/pic16';
import { RpBoard } from '../../core/mcu/rp2040';
import type { Element, Netlist, Simulator, Solution } from '../../core/sim/solver';
import { PART_DEFS, isMcu, type Doc } from '../editor/model';
import type { Extracted } from '../editor/netlist';

type PinElement = Extract<Element, { type: 'PIN' }>;

interface RunningBoard {
  board: McuBoard;
  pins: Array<{ pin: string; el: PinElement }>;
}

const MAX_SERIAL = 20000;

/** The part id of the virtual Nextion display of the library. */
export const NEXTION_TYPE = 'x:nextion-display';

/** The pins of a board that carry its serial port (its TX and its RX), by part type. */
const UART_PINS: Record<string, { tx: string; rx: string }> = {
  ARDUINO_UNO: { tx: 'D1', rx: 'D0' },
  ARDUINO_NANO: { tx: 'D1', rx: 'D0' },
  ARDUINO_MEGA: { tx: 'D1', rx: 'D0' },
  PIC16F877A: { tx: 'RC6', rx: 'RC7' },
  PIC16F628A: { tx: 'RB2', rx: 'RB1' },
};

/** The radio modules whose `link` name pairs them (the library's HC-05 and HC-06). */
const LINK_TYPES = new Set(['x:hc-05', 'x:hc-06']);

interface RunningDisplay {
  display: NextionDisplay;
  /** The board whose serial port is wired to it (index into `boards`), or -1. */
  board: number;
  /** Circuit nodes of the display's supply pins. */
  vdd: number | undefined;
  gnd: number | undefined;
  /** Error of the layout text, if it was not valid (the demo screen is shown instead). */
  layoutError: string;
  partId: string;
}

export class McuRig {
  private readonly boards: RunningBoard[] = [];
  private readonly screens: RunningDisplay[] = [];
  /** What each board's printed bytes are passed on to (the radios paired with it), by board index. */
  private readonly relays: Array<Array<(byte: number) => void>> = [];
  /** The latest circuit solution, which tells whether a radio module has power. */
  private last: Solution | null = null;
  /** The virtual Nextion displays of the circuit. */
  get displays(): Array<{ display: NextionDisplay; layoutError: string; partId: string }> {
    return this.screens;
  }
  /** Everything the sketches printed on Serial, newest last. */
  serial = '';
  /** Called with every byte the first board prints, so that it can be passed on (to a real COM port). */
  tap: ((byte: number) => void) | null = null;

  /** Builds a rig for every microcontroller part that has firmware. Throws if a hex file is invalid. */
  constructor(doc: Doc, extracted: Extracted, netlist: Netlist) {
    for (const part of doc.parts.filter((p) => isMcu(p.type))) {
      const hex = typeof part.params.hex === 'string' ? part.params.hex : '';
      if (!hex) continue;
      const engine = PART_DEFS[part.type].mcu!.engine;
      const clock = typeof part.params.clock === 'number' && part.params.clock > 0 ? part.params.clock : 4;
      const board: McuBoard = engine.startsWith('pic16')
        ? new Pic16(part.type as PicChipId, hex, { clockHz: clock * 1e6 })
        : engine === 'rp2040'
          ? new RpBoard(base64ToBytes(hex))
          : new AvrBoard(hex, { variant: engine === 'avr2560' ? 'atmega2560' : 'atmega328p' });
      const boardIndex = this.boards.length;
      board.onSerial = (b) => {
        this.serial = (this.serial + String.fromCharCode(b)).slice(-MAX_SERIAL);
        if (boardIndex === 0) this.tap?.(b);
        for (const s of this.screens) if (s.board === boardIndex && s.display.linkedRx) s.display.feed(b);
        for (const relay of this.relays[boardIndex] ?? []) relay(b);
      };
      const pins: RunningBoard['pins'] = [];
      for (const mp of extracted.mcuPins.filter((m) => m.partId === part.id)) {
        const el = netlist.elements.find((e) => e.id === mp.elementId);
        if (el && el.type === 'PIN') pins.push({ pin: mp.pin, el });
      }
      this.boards.push({ board, pins });
      this.relays.push([]);
    }
    this.connectDisplays(doc, extracted);
    this.connectLinks(doc, extracted, netlist);
  }

  /**
   * Pairs the serial radios of the circuit. Modules (HC-05, HC-06) that carry the same `link` name pass what their
   * boards print on to the boards behind the other modules of that name. A board is behind a module when its TX pin
   * leads to the module's RXD, or the module's TXD leads to its RX pin: directly, or through a resistor or two (the
   * usual voltage divider in front of RXD). Only boards on hardware serial (D0/D1) can be paired.
   */
  private connectLinks(doc: Doc, extracted: Extracted, netlist: Netlist): void {
    const boardParts = doc.parts.filter((p) => isMcu(p.type) && typeof p.params.hex === 'string' && p.params.hex);
    const nodeOf = (owner: { id: string; type: string }, pin: string): number | undefined => {
      const i = PART_DEFS[owner.type].pinNames.indexOf(pin);
      return i < 0 ? undefined : extracted.nodeOfPin.get(`${owner.id}:${i}`);
    };
    /** `start` and the nodes behind up to two resistors from it; the way round through ground does not count. */
    const reach = (start: number | undefined): Set<number> => {
      const seen = new Set<number>();
      if (start === undefined) return seen;
      seen.add(start);
      let edge = [start];
      for (let hop = 0; hop < 2; hop++) {
        const next: number[] = [];
        for (const e of netlist.elements) {
          if (e.type !== 'R') continue;
          for (const [from, to] of [[e.a, e.b], [e.b, e.a]]) {
            if (edge.includes(from) && to !== 0 && !seen.has(to)) {
              seen.add(to);
              next.push(to);
            }
          }
        }
        edge = next;
      }
      return seen;
    };
    interface Member {
      board: number;
      vcc: number | undefined;
      gnd: number | undefined;
    }
    const groups = new Map<string, Member[]>();
    for (const m of doc.parts) {
      const name = typeof m.params.link === 'string' ? m.params.link.trim() : '';
      if (!LINK_TYPES.has(m.type) || !name) continue;
      const rxd = nodeOf(m, 'RXD');
      const txd = nodeOf(m, 'TXD');
      const board = boardParts.findIndex((bp) => {
        const uart = UART_PINS[bp.type];
        return !!uart && ((rxd !== undefined && reach(nodeOf(bp, uart.tx)).has(rxd)) || (txd !== undefined && reach(nodeOf(bp, uart.rx)).has(txd)));
      });
      if (board < 0) continue;
      groups.set(name, [...(groups.get(name) ?? []), { board, vcc: nodeOf(m, 'VCC'), gnd: nodeOf(m, 'GND') }]);
    }
    /** A radio without supply does not transmit or receive. */
    const powered = (m: Member): boolean => {
      const s = this.last;
      return !s || m.vcc === undefined || m.gnd === undefined || s.v[m.vcc] - s.v[m.gnd] > 2.5;
    };
    for (const members of groups.values()) {
      for (const from of members) {
        for (const to of members) {
          if (to.board === from.board) continue;
          this.relays[from.board].push((byte) => {
            if (powered(from) && powered(to)) this.boards[to.board].board.serialWrite(byte);
          });
        }
      }
    }
  }

  /** Builds the virtual displays and works out which board each one is wired to (its RX to the board's TX, its TX to the board's RX). */
  private connectDisplays(doc: Doc, extracted: Extracted): void {
    const boardParts = doc.parts.filter((p) => isMcu(p.type) && typeof p.params.hex === 'string' && p.params.hex);
    for (const part of doc.parts.filter((p) => p.type === NEXTION_TYPE)) {
      const node = (owner: { id: string; type: string }, pin: string): number | undefined => {
        const i = PART_DEFS[owner.type].pinNames.indexOf(pin);
        return i < 0 ? undefined : extracted.nodeOfPin.get(`${owner.id}:${i}`);
      };
      const { layout, error } = parseLayout(typeof part.params.layout === 'string' ? part.params.layout : '');
      const display = new NextionDisplay(layout);
      const rxNode = node(part, 'RX');
      const txNode = node(part, 'TX');
      let board = -1;
      boardParts.forEach((bp, i) => {
        const uart = UART_PINS[bp.type];
        if (!uart || board >= 0) return;
        const toRx = rxNode !== undefined && node(bp, uart.tx) === rxNode;
        const toTx = txNode !== undefined && node(bp, uart.rx) === txNode;
        if (toRx || toTx) {
          board = i;
          display.linkedRx = toRx;
          display.linkedTx = toTx;
        }
      });
      if (board >= 0) {
        const target = this.boards[board];
        display.output = (b) => {
          if (display.linkedTx) target.board.serialWrite(b);
        };
      }
      this.screens.push({ display, board, vdd: node(part, '5V'), gnd: node(part, 'GND'), layoutError: error, partId: part.id });
    }
  }

  /** The screen of display `index` was touched or let go. */
  touch(index: number, component: number, pressed: boolean): void {
    this.screens[index]?.display.touch(component, pressed);
  }

  get count(): number {
    return this.boards.length;
  }

  /** Feeds the initial circuit state to the pins before the first step. */
  prime(first: Solution): void {
    for (const b of this.boards) for (const p of b.pins) b.board.setInput(p.pin, first.v[p.el.a]);
  }

  step(simulator: Simulator, dt: number): Solution {
    for (const b of this.boards) {
      b.board.run(dt);
      for (const p of b.pins) {
        const d = b.board.drive(p.pin);
        p.el.g = d ? 1 / d.r : 0;
        p.el.v = d ? d.v : 0;
      }
    }
    const s = simulator.step();
    this.last = s;
    for (const d of this.screens) d.display.setPower(d.vdd !== undefined && d.gnd !== undefined && s.v[d.vdd] - s.v[d.gnd] > 3);
    for (const b of this.boards) for (const p of b.pins) b.board.setInput(p.pin, s.v[p.el.a]);
    return s;
  }

  /** Sends raw bytes (from a real COM port) to the first board's Serial port. */
  sendBytes(bytes: Uint8Array): void {
    const b = this.boards[0];
    if (b) for (const v of bytes) b.board.serialWrite(v);
  }

  /** Sends text to the first board's Serial port. */
  sendSerial(text: string): void {
    const b = this.boards[0];
    if (b) for (const ch of text) b.board.serialWrite(ch.charCodeAt(0) & 0xff);
  }
}
