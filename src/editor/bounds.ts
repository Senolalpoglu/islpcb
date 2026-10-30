// Bounding boxes of the parts and of the whole circuit, in grid units. They serve box selection, and the drawing sheet,
// which is sized to the circuit and centred on it.

import { GRID, rotate, translateDoc, type Doc, type Part, type Pt } from './model';
import { MM_PER_PX, centerShift, insideFrame, paperFor, type Box, type Paper, type SheetSettings } from './sheet';
import { BBOX } from './symbols';

export interface GridBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Room around the circuit for the texts that stand beside the parts. */
export const LABEL_MARGIN = 1.5;

/** The box of one part in grid units: its hit box, turned and mirrored like the part itself. */
export function partBounds(p: Pick<Part, 'type' | 'x' | 'y' | 'rot' | 'mirror'>): GridBox | null {
  const b = BBOX[p.type];
  if (!b) return null;
  const corners: Pt[] = [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ].map((c) => {
    const r = rotate(p.mirror ? { x: -c.x, y: c.y } : c, p.rot);
    return { x: p.x + r.x, y: p.y + r.y };
  });
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    y0: Math.min(...corners.map((c) => c.y)),
    x1: Math.max(...corners.map((c) => c.x)),
    y1: Math.max(...corners.map((c) => c.y)),
  };
}

/** The box around all parts and wires, with a margin for their texts; null for an empty drawing. */
export function circuitBounds(doc: Pick<Doc, 'parts' | 'wires'>, margin = LABEL_MARGIN): GridBox | null {
  const boxes: GridBox[] = [];
  for (const p of doc.parts) {
    const b = partBounds(p);
    if (b) boxes.push(b);
  }
  for (const w of doc.wires) boxes.push({ x0: Math.min(w.a.x, w.b.x), y0: Math.min(w.a.y, w.b.y), x1: Math.max(w.a.x, w.b.x), y1: Math.max(w.a.y, w.b.y) });
  if (boxes.length === 0) return null;
  return {
    x0: Math.min(...boxes.map((b) => b.x0)) - margin,
    y0: Math.min(...boxes.map((b) => b.y0)) - margin,
    x1: Math.max(...boxes.map((b) => b.x1)) + margin,
    y1: Math.max(...boxes.map((b) => b.y1)) + margin,
  };
}

export const boxesTouch = (a: GridBox, b: GridBox): boolean => a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
export const boxInside = (inner: GridBox, outer: GridBox): boolean => inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;

/**
 * The drawing sheet of a document: its paper (sized to the circuit when the choice is "auto") and the circuit's box in
 * pixels from the sheet's top left corner, which is the origin of the drawing. The sheet does not move with the circuit.
 */
export function sheetLayout(doc: Pick<Doc, 'parts' | 'wires'>, sheet: Pick<SheetSettings, 'size' | 'landscape'>): { paper: Paper; circuit: Box | null } {
  const b = circuitBounds(doc);
  const circuit = b ? { x: b.x0 * GRID, y: b.y0 * GRID, w: (b.x1 - b.x0) * GRID, h: (b.y1 - b.y0) * GRID } : null;
  return { paper: paperFor(sheet, circuit ? { w: circuit.w * MM_PER_PX, h: circuit.h * MM_PER_PX } : null), circuit };
}

/** Moves the circuit into the middle of its sheet. */
export function centerOnSheet(doc: Doc, sheet: Pick<SheetSettings, 'size' | 'landscape'>): Doc {
  const { paper, circuit } = sheetLayout(doc, sheet);
  if (!circuit) return doc;
  const { dx, dy } = centerShift(circuit, paper);
  return translateDoc(doc, dx, dy);
}

/** Whether the circuit lies inside the frame of its sheet. */
export function circuitOnSheet(doc: Pick<Doc, 'parts' | 'wires'>, sheet: Pick<SheetSettings, 'size' | 'landscape'>): boolean {
  const { paper, circuit } = sheetLayout(doc, sheet);
  return circuit === null || insideFrame(circuit, paper);
}
