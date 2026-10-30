import { beforeAll, describe, expect, it } from 'vitest';
import { circuitBounds, partBounds } from '../src/editor/bounds';
import { loadBuiltinLibrary } from '../src/editor/library';
import { addPart, addWire, emptyDoc, moveSelectionWithWires, pinPositions, ptKey, removeSelected, type Doc } from '../src/editor/model';
import { pickInBox, selectedIds } from '../src/editor/SchematicCanvas';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

/** Two resistors joined by a wire, a third one far away. */
function sample(): { doc: Doc; r1: string; r2: string; r3: string } {
  let doc = emptyDoc();
  doc = addPart(doc, 'R', 10, 10, 0, false);
  doc = addPart(doc, 'R', 20, 10, 0, false);
  doc = addPart(doc, 'R', 60, 40, 0, false);
  const [r1, r2, r3] = doc.parts.map((p) => p.id);
  // R1's right pin to R2's left pin.
  doc = addWire(doc, pinPositions(doc.parts[0])[1], pinPositions(doc.parts[1])[0]);
  return { doc, r1, r2, r3 };
}

describe('selection box', () => {
  it('takes what lies completely inside when dragged left to right (window)', () => {
    const { doc, r1, r2 } = sample();
    const sel = pickInBox(doc, { x0: 5, y0: 5, x1: 25, y1: 15 }, true);
    expect(sel?.kind).toBe('many');
    const ids = selectedIds(sel);
    expect([...ids.parts].sort()).toEqual([r1, r2].sort());
    expect(ids.wires.size).toBe(1);
  });

  it('takes everything it touches when dragged right to left (crossing)', () => {
    const { doc, r1, r2, r3 } = sample();
    const touching = selectedIds(pickInBox(doc, { x0: 12, y0: 8, x1: 18.5, y1: 12 }, false));
    expect(touching.parts.has(r1) && touching.parts.has(r2)).toBe(true);
    expect(touching.parts.has(r3)).toBe(false);
    // The same box as a window takes only the wire: no part lies completely inside it.
    expect(pickInBox(doc, { x0: 12, y0: 8, x1: 18.5, y1: 12 }, true)).toMatchObject({ kind: 'wire' });
  });

  it('a box around one part selects just that part; an empty box selects nothing', () => {
    const { doc, r3 } = sample();
    expect(pickInBox(doc, { x0: 55, y0: 35, x1: 65, y1: 45 }, true)).toEqual({ kind: 'part', id: r3 });
    expect(pickInBox(doc, { x0: 100, y0: 100, x1: 110, y1: 110 }, true)).toBeNull();
  });

  it('a box round the whole circuit takes all of it', () => {
    const { doc } = sample();
    const b = circuitBounds(doc)!;
    const ids = selectedIds(pickInBox(doc, b, true));
    expect(ids.parts.size).toBe(3);
    expect(ids.wires.size).toBe(1);
  });

  it('knows the box of a part, turned', () => {
    const flat = partBounds({ type: 'R', x: 0, y: 0, rot: 0 })!;
    const upright = partBounds({ type: 'R', x: 0, y: 0, rot: 90 })!;
    expect(flat.x1 - flat.x0).toBeCloseTo(upright.y1 - upright.y0, 9);
    expect(flat.y1 - flat.y0).toBeCloseTo(upright.x1 - upright.x0, 9);
  });
});

describe('moving and deleting a block', () => {
  it('moves the chosen parts and wires together and keeps the wire on the pins', () => {
    const { doc, r1, r2, r3 } = sample();
    const moved = moveSelectionWithWires(doc, new Set([r1, r2]), new Set(doc.wires.map((w) => w.id)), 5, 3);
    const p = (id: string) => moved.parts.find((q) => q.id === id)!;
    expect([p(r1).x, p(r1).y, p(r2).x, p(r2).y]).toEqual([15, 13, 25, 13]);
    expect([p(r3).x, p(r3).y]).toEqual([60, 40]); // the one that was not chosen stays
    const pins = new Set([...pinPositions(p(r1)), ...pinPositions(p(r2))].map(ptKey));
    for (const w of moved.wires) {
      expect(pins.has(ptKey(w.a)) && pins.has(ptKey(w.b))).toBe(true);
    }
    expect(moved.wires.map((w) => w.id)).toEqual(doc.wires.map((w) => w.id)); // ids kept: the selection survives
  });

  it('stretches a wire that is attached to the block but not part of it, with straight segments', () => {
    let { doc } = sample();
    const r2 = doc.parts[1];
    const far = { x: pinPositions(r2)[1].x + 10, y: pinPositions(r2)[1].y };
    doc = addWire(doc, pinPositions(r2)[1], far);
    const moved = moveSelectionWithWires(doc, new Set([r2.id]), new Set(), 0, 4);
    for (const w of moved.wires) expect(w.a.x === w.b.x || w.a.y === w.b.y).toBe(true);
    // The far end of the stretched wire did not move.
    expect(moved.wires.some((w) => ptKey(w.a) === ptKey(far) || ptKey(w.b) === ptKey(far))).toBe(true);
  });

  it('moving by nothing, or nothing, changes nothing', () => {
    const { doc, r1 } = sample();
    expect(moveSelectionWithWires(doc, new Set([r1]), new Set(), 0, 0)).toBe(doc);
    expect(moveSelectionWithWires(doc, new Set(), new Set(), 3, 3)).toBe(doc);
  });

  it('deletes the chosen parts and wires', () => {
    const { doc, r1, r2, r3 } = sample();
    const left = removeSelected(doc, new Set([r1, r2]), new Set(doc.wires.map((w) => w.id)));
    expect(left.parts.map((p) => p.id)).toEqual([r3]);
    expect(left.wires).toHaveLength(0);
  });

  it('turns every kind of selection into id sets', () => {
    expect(selectedIds(null).parts.size).toBe(0);
    expect([...selectedIds({ kind: 'part', id: 'a' }).parts]).toEqual(['a']);
    expect([...selectedIds({ kind: 'wire', id: 'w' }).wires]).toEqual(['w']);
    const many = selectedIds({ kind: 'many', parts: ['a', 'b'], wires: ['w'] });
    expect(many.parts.size + many.wires.size).toBe(3);
  });
});
