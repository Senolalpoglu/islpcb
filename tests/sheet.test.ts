import { beforeAll, describe, expect, it } from 'vitest';
import { centerOnSheet, circuitBounds, circuitOnSheet, sheetLayout } from '../src/editor/bounds';
import { loadBuiltinLibrary } from '../src/editor/library';
import { GRID, addPart, addWire, emptyDoc, translateDoc, type Doc } from '../src/editor/model';
import {
  GRID_MM,
  MARGIN_MM,
  MM_PER_PX,
  PAPER_MM,
  PX_PER_MM,
  TITLE_H,
  TITLE_W,
  centerShift,
  defaultSheet,
  drawingArea,
  fitContent,
  fitText,
  insideFrame,
  paperFor,
  sheetNeed,
  sheetOf,
  titleBlockCells,
  titleBlockRect,
} from '../src/editor/sheet';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const A4 = { w: 297, h: 210 };
const auto = { size: 'auto' as const, landscape: true };

describe('drawing sheet paper', () => {
  it('knows the paper sizes in both orientations', () => {
    expect(paperFor({ size: 'A4', landscape: true }, null)).toEqual({ w: 297, h: 210, name: 'A4' });
    expect(paperFor({ size: 'A4', landscape: false }, null)).toEqual({ w: 210, h: 297, name: 'A4' });
    expect(paperFor({ size: 'A3', landscape: true }, null)).toEqual({ w: 420, h: 297, name: 'A3' });
    expect(Object.keys(PAPER_MM)).toEqual(['A4', 'A3', 'A2', 'A1', 'A0']);
  });

  it('prints one grid step as 3.81 mm, so the drawing is the same size on the screen and on paper', () => {
    expect(GRID * MM_PER_PX).toBeCloseTo(GRID_MM, 9);
    expect(PX_PER_MM * MM_PER_PX).toBeCloseTo(1, 9);
    // The 11 px texts next to the parts come out about 2 mm (6 pt) high: readable on paper and in a PDF.
    expect(11 * MM_PER_PX).toBeGreaterThan(2);
  });

  it('"auto" takes the smallest standard paper that holds the circuit', () => {
    const fits = (content: { w: number; h: number }) => paperFor(auto, content).name;
    expect(fits({ w: 100, h: 60 })).toBe('A4');
    expect(fits({ w: 270, h: 60 })).toBe('A3'); // A4 leaves 297 - 28 = 269 mm across
    expect(fits({ w: 100, h: 157 })).toBe('A3'); // and 210 - 28 - 26 = 156 mm of height
    expect(fits({ w: 800, h: 500 })).toBe('A1');
    expect(fits({ w: 1100, h: 700 })).toBe('A0');
    expect(paperFor(auto, null).name).toBe('A4');
  });

  it('"auto" grows past A0 into a custom size that still holds the circuit', () => {
    const content = { w: 1500, h: 900 };
    const p = paperFor(auto, content);
    expect(p.name).toBe('custom');
    expect(p.w).toBeGreaterThanOrEqual(sheetNeed(content).w);
    expect(p.h).toBeGreaterThanOrEqual(sheetNeed(content).h);
  });

  it('a fixed size ignores the circuit; the orientation is honoured in auto mode', () => {
    expect(paperFor({ size: 'A4', landscape: true }, { w: 2000, h: 2000 }).name).toBe('A4');
    const portrait = paperFor({ size: 'auto', landscape: false }, { w: 100, h: 200 });
    expect(portrait.h).toBeGreaterThan(portrait.w);
  });
});

describe('title block', () => {
  it('is small and sits in the bottom right corner of the frame', () => {
    expect(TITLE_W).toBeLessThanOrEqual(120);
    expect(TITLE_H).toBeLessThanOrEqual(30);
    const r = titleBlockRect(A4);
    expect(r.x + r.w).toBe(297 - MARGIN_MM);
    expect(r.y + r.h).toBe(210 - MARGIN_MM);
    // It takes only a small part of the drawing area.
    const area = drawingArea(A4);
    expect((r.w * r.h) / (area.w * area.h)).toBeLessThan(0.1);
    expect(titleBlockRect({ w: 210, h: 297 }).x).toBeGreaterThanOrEqual(MARGIN_MM);
  });

  it('is company, title and two rows of three, filling the block exactly, in both languages', () => {
    const s = { ...defaultSheet(), company: 'ISL Lab', title: 'Power supply', drawnBy: 'A', approvedBy: 'B', date: '2026-10-25', revision: '2', docNo: 'D-1', sheetNo: '1/2' };
    const cells = titleBlockCells(s, 'en', A4);
    const r = titleBlockRect(A4);
    expect(cells).toHaveLength(8);
    expect(cells.reduce((a, c) => a + c.w * c.h, 0)).toBeCloseTo(r.w * r.h, 6);
    expect(cells.map((c) => c.value)).toEqual(['ISL Lab', 'Power supply', 'A', '2026-10-25', '2', 'B', 'D-1', '1/2']);
    expect(cells.map((c) => c.label)).toEqual(['Company', 'Title', 'Drawn by', 'Date', 'Revision', 'Approved by', 'Drawing no', 'Sheet']);
    expect(titleBlockCells(s, 'tr', A4).map((c) => c.label)).toEqual(['Şirket', 'Başlık', 'Çizen', 'Tarih', 'Revizyon', 'Onaylayan', 'Çizim no', 'Sayfa']);
  });

  it('keeps the writing readable: at least 2.5 mm (7 pt) for the entries and every entry inside its cell', () => {
    const long = 'A very long company name that would run out of its cell';
    const cells = titleBlockCells({ ...defaultSheet(), company: long, title: long, drawnBy: long }, 'en', A4);
    for (const c of cells) {
      expect(c.size).toBeGreaterThanOrEqual(2.5);
      expect(c.value.length * c.size * 0.56).toBeLessThanOrEqual(c.w); // an average letter is about 0.56 of its height wide
    }
    expect(cells[0].value.endsWith('…')).toBe(true);
    expect(fitText('short', 100, 3)).toBe('short');
  });

  it('fills in the defaults of a document that has no sheet or only part of one', () => {
    expect(sheetOf({}).size).toBe('auto');
    expect(sheetOf({ sheet: { company: 'X' } })).toMatchObject({ company: 'X', landscape: true, show: true });
  });
});

describe('putting the circuit on the page', () => {
  it('prints a circuit that lies inside the frame exactly where it is on the sheet, at the sheet scale', () => {
    const content = { x: 200, y: 150, w: 600, h: 400 };
    expect(insideFrame(content, A4)).toBe(true);
    expect(fitContent(content, A4)).toEqual({ scale: MM_PER_PX, tx: 0, ty: 0 });
  });

  it('scales down and centres one that does not fit, never beyond the sheet scale', () => {
    const content = { x: -500, y: 50, w: 4000, h: 2000 };
    expect(insideFrame(content, A4)).toBe(false);
    const f = fitContent(content, A4);
    expect(f.scale).toBeLessThan(MM_PER_PX);
    const x0 = f.tx + content.x * f.scale;
    const x1 = x0 + content.w * f.scale;
    const y0 = f.ty + content.y * f.scale;
    const y1 = y0 + content.h * f.scale;
    expect(x0).toBeGreaterThanOrEqual(MARGIN_MM);
    expect(x1).toBeLessThanOrEqual(A4.w - MARGIN_MM);
    expect(y1).toBeLessThanOrEqual(A4.h - MARGIN_MM - TITLE_H);
    expect(y0).toBeGreaterThanOrEqual(MARGIN_MM);
    expect(fitContent({ x: -900, y: 0, w: 100, h: 60 }, A4).scale).toBe(MM_PER_PX); // small but off the sheet: moved, not blown up
  });

  it('copes with an empty circuit', () => {
    const f = fitContent({ x: 0, y: 0, w: 0, h: 0 }, A4);
    expect(Number.isFinite(f.scale) && Number.isFinite(f.tx) && Number.isFinite(f.ty)).toBe(true);
  });

  it('works out how far to move a circuit to put it in the middle, in whole grid steps', () => {
    const circuit = { x: 1000, y: 600, w: 800, h: 400 };
    const { dx, dy } = centerShift(circuit, A4);
    expect(Number.isInteger(dx) && Number.isInteger(dy)).toBe(true);
    const area = drawingArea(A4);
    const cx = circuit.x + dx * GRID + circuit.w / 2;
    const cy = circuit.y + dy * GRID + circuit.h / 2;
    expect(Math.abs(cx - (area.x + area.w / 2) * PX_PER_MM)).toBeLessThanOrEqual(GRID / 2 + 1e-9);
    expect(Math.abs(cy - (area.y + area.h / 2) * PX_PER_MM)).toBeLessThanOrEqual(GRID / 2 + 1e-9);
  });
});

describe('the sheet stays still while the circuit moves on it', () => {
  const sample = (): Doc => {
    let doc = addPart(emptyDoc(), 'R', 20, 20, 0, false);
    doc = addPart(doc, 'R', 40, 20, 0, false);
    return addWire(doc, { x: 22, y: 20 }, { x: 38, y: 20 });
  };

  it('an empty drawing gets A4', () => {
    const l = sheetLayout(emptyDoc(), auto);
    expect(l.paper.name).toBe('A4');
    expect(l.circuit).toBeNull();
    expect(circuitOnSheet(emptyDoc(), auto)).toBe(true);
  });

  it('moving the circuit does not change the sheet, only whether the circuit is on it', () => {
    const doc = sample();
    const moved = translateDoc(doc, 300, 200);
    expect(sheetLayout(moved, auto).paper).toEqual(sheetLayout(doc, auto).paper);
    expect(circuitOnSheet(doc, auto)).toBe(true);
    expect(circuitOnSheet(moved, auto)).toBe(false);
  });

  it('centring moves the circuit, not the sheet, keeps its shape and is idempotent', () => {
    const doc = translateDoc(sample(), 300, 200);
    const centred = centerOnSheet(doc, auto);
    expect(circuitOnSheet(centred, auto)).toBe(true);
    const a = circuitBounds(doc)!;
    const b = circuitBounds(centred)!;
    expect(b.x1 - b.x0).toBeCloseTo(a.x1 - a.x0, 9);
    expect(b.y1 - b.y0).toBeCloseTo(a.y1 - a.y0, 9);
    expect(centerOnSheet(centred, auto)).toEqual(centred);
    expect(centerOnSheet(emptyDoc(), auto)).toEqual(emptyDoc());
  });

  it('gets bigger as the circuit gets bigger', () => {
    const area = (d: Doc) => {
      const p = sheetLayout(d, auto).paper;
      return p.w * p.h;
    };
    let doc = addPart(emptyDoc(), 'R', 10, 10, 0, false);
    expect(sheetLayout(doc, auto).paper.name).toBe('A4');
    const small = area(doc);
    doc = addWire(doc, { x: 10, y: 10 }, { x: 150, y: 10 });
    expect(area(doc)).toBeGreaterThan(small);
    expect(sheetLayout(doc, auto).paper.name).not.toBe('A4');
  });
});
