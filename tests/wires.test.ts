import { describe, expect, it } from 'vitest';
import { addPart, addWire, emptyDoc, movePartWithWires, onSegment } from '../src/editor/model';
import { extractNetlist } from '../src/editor/netlist';

const orthogonal = (w: { a: { x: number; y: number }; b: { x: number; y: number } }) => w.a.x === w.b.x || w.a.y === w.b.y;

describe('moving a part drags its wires along', () => {
  it('keeps a horizontal wire attached and orthogonal when the part moves diagonally', () => {
    let d = addPart(emptyDoc(), 'R', 6, 6); // pins (4,6) and (8,6)
    d = addWire(d, { x: 0, y: 6 }, { x: 4, y: 6 }); // attached to pin 1, other end fixed at (0,6)
    const moved = movePartWithWires(d, 'p1', 3, 2); // pin 1 -> (7,8)
    expect(moved.parts[0].x).toBe(9);
    expect(moved.parts[0].y).toBe(8);
    expect(moved.wires.every(orthogonal)).toBe(true);
    // The fixed end stays put and some wire still reaches the moved pin.
    expect(moved.wires.some((w) => (w.a.x === 0 && w.a.y === 6) || (w.b.x === 0 && w.b.y === 6))).toBe(true);
    expect(moved.wires.some((w) => onSegment({ x: 7, y: 8 }, w.a, w.b))).toBe(true);
  });

  it('preserves electrical connectivity through a move', () => {
    let d = addPart(emptyDoc(), 'GND', 0, 6);
    d = addPart(d, 'R', 6, 6);
    d = addWire(d, { x: 0, y: 6 }, { x: 4, y: 6 });
    const before = extractNetlist(d);
    expect(before.nodeOfPin.get('p2:0')).toBe(0);
    const after = extractNetlist(movePartWithWires(d, 'p2', 2, -3));
    expect(after.nodeOfPin.get('p2:0')).toBe(0); // still tied to ground
    expect(after.nodeOfPin.get('p2:1')).not.toBe(0);
  });

  it('leaves wires that are not attached to the part untouched', () => {
    let d = addPart(emptyDoc(), 'R', 6, 6);
    d = addWire(d, { x: 20, y: 0 }, { x: 20, y: 5 });
    const moved = movePartWithWires(d, 'p1', 1, 1);
    expect(moved.wires).toEqual(d.wires);
  });
});
