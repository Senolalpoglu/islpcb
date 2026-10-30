// Draws circuits from code, for the built-in examples: parts are placed on grid points and wires are laid between pins.

import { PART_DEFS, addPart, addWire, emptyDoc, pinPositions, routeWire, type Doc, type Part, type PartType, type Pt, type Rot } from './model';

export class Builder {
  doc: Doc = emptyDoc();
  put(type: PartType, x: number, y: number, rot: Rot = 0, params: Record<string, number | boolean | string> = {}): this {
    this.add(type, x, y, rot, params);
    return this;
  }
  /** Places a part and returns it, so its pins can be looked up. `ref` replaces the automatic reference designator (R1, Q2 ...). */
  add(type: PartType, x: number, y: number, rot: Rot = 0, params: Record<string, number | boolean | string> = {}, ref?: string, mirror = false): Part {
    this.doc = addPart(this.doc, type, x, y, rot, mirror);
    const i = this.doc.parts.length - 1;
    const part = { ...this.doc.parts[i], params: { ...this.doc.parts[i].params, ...params }, ...(ref ? { ref } : {}) };
    this.doc = { ...this.doc, parts: this.doc.parts.map((q, k) => (k === i ? part : q)) };
    return part;
  }
  /** Draws an L-shaped wire: horizontal first, then vertical. */
  wire(a: Pt, b: Pt): this {
    if (a.x !== b.x && a.y !== b.y) {
      const corner = { x: b.x, y: a.y };
      this.doc = addWire(addWire(this.doc, a, corner), corner, b);
    } else this.doc = addWire(this.doc, a, b);
    return this;
  }
  /** World position of a named pin of a part placed with `add`. */
  pin(part: Part, name: string): Pt {
    const i = PART_DEFS[part.type].pinNames.indexOf(name);
    if (i < 0) throw new Error(`${part.type} has no pin ${name}`);
    return pinPositions(part)[i];
  }
  /** Wires straight segments through the points one after another. */
  poly(...pts: Pt[]): this {
    for (let i = 1; i < pts.length; i++) {
      const [u, v] = [pts[i - 1], pts[i]];
      if (u.x !== v.x && u.y !== v.y) throw new Error(`diagonal wire from ${u.x},${u.y} to ${v.x},${v.y}`);
      this.doc = addWire(this.doc, u, v);
    }
    return this;
  }
  /** Wires two points by the first path that stays clear of other pins and wires. */
  route(a: Pt, b: Pt): this {
    const { path } = routeWire(this.doc, a, b);
    return this.poly(...path);
  }
  /** A supply rail: a long horizontal wire. */
  rail(y: number, x0: number, x1: number): this {
    return this.poly({ x: x0, y }, { x: x1, y });
  }
  /** Wires a pin straight up (or down) to the rail at height `y`. */
  tap(pin: Pt, y: number): this {
    return this.poly(pin, { x: pin.x, y });
  }
  /** Joins pins into one net: each is routed to the nearest one already joined. */
  join(...pts: Pt[]): this {
    const done = [pts[0]];
    for (const q of pts.slice(1)) {
      const near = done.reduce((best, c) => (Math.abs(c.x - q.x) + Math.abs(c.y - q.y) < Math.abs(best.x - q.x) + Math.abs(best.y - q.y) ? c : best));
      this.route(q, near);
      done.push(q);
    }
    return this;
  }
  /** A ground symbol drawn pointing up, `rise` units above a point (for a pin whose lower side is taken). */
  gndUp(at: Pt, rise = 2): this {
    this.put('GND', at.x, at.y - rise, 180);
    return this.poly(at, { x: at.x, y: at.y - rise });
  }
  /** A ground symbol pointing right, `reach` units to the right of a point. */
  gndRight(at: Pt, reach = 2): this {
    this.put('GND', at.x + reach, at.y, 270);
    return this.poly(at, { x: at.x + reach, y: at.y });
  }
  /** A ground symbol pointing left, `reach` units to the left of a point (for a pin with wires above and below). */
  gndLeft(at: Pt, reach = 2): this {
    this.put('GND', at.x - reach, at.y, 90);
    return this.poly(at, { x: at.x - reach, y: at.y });
  }
  /** A ground symbol `drop` grid units below a point, wired to it. */
  gnd(at: Pt, drop = 2): this {
    this.put('GND', at.x, at.y + drop);
    return this.poly(at, { x: at.x, y: at.y + drop });
  }
  /** Names a probe: a probe sits on a point, wired up to a point of the circuit. */
  probe(at: Pt, label: string, dx = 0, dy = -2): this {
    this.put('PROBE', at.x + dx, at.y + dy, 0, { label });
    return this.poly({ x: at.x + dx, y: at.y + dy }, ...(dx !== 0 ? [{ x: at.x + dx, y: at.y }] : []), at);
  }
}
