// The drawing sheet of a schematic: paper size, the frame and the small title block in the bottom right corner, and how
// the circuit lands on the page when it is printed. Everything here is in millimetres of paper.
//
// The sheet sits still at the origin of the drawing and the circuit is moved on it, like a page of a drawing program.
// One grid step (20 px) is 3.81 mm of paper, so the texts next to the parts print about 6 pt high and stay readable;
// what the editor shows is what is printed. With the paper on "auto" the sheet is the smallest standard size that holds
// a circuit of that size; "Center" moves the circuit into the middle of the sheet.

import { GRID, type LocalText } from './model';

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export type PaperChoice = PaperSize | 'auto';

export interface SheetSettings {
  /** Draw the sheet (frame and title block) in the editor. */
  show: boolean;
  /** A fixed paper size, or "auto": the smallest standard size that holds the circuit. */
  size: PaperChoice;
  landscape: boolean;
  company: string;
  title: string;
  drawnBy: string;
  approvedBy: string;
  date: string;
  revision: string;
  docNo: string;
  sheetNo: string;
}

/** Paper sizes in millimetres, landscape (width, height), smallest first. */
export const PAPER_MM: Record<PaperSize, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
export const PAPER_SIZES = Object.keys(PAPER_MM) as PaperSize[];

/** Millimetres of paper per grid step. */
export const GRID_MM = 3.81;
/** Millimetres of paper per screen pixel: the scale of the printed drawing. */
export const MM_PER_PX = GRID_MM / GRID;
/** Screen pixels per millimetre of paper. */
export const PX_PER_MM = GRID / GRID_MM;

/** Distance from the paper edge to the frame. */
export const MARGIN_MM = 10;
/** Free space between the frame and the circuit. */
export const GAP_MM = 4;
/** The title block is small: the circuit is the drawing, the block only names it. */
export const TITLE_W = 110;
export const TITLE_H = 26;

export interface Paper {
  w: number;
  h: number;
  /** "A4" ... "A0", or "custom" for a circuit bigger than A0. */
  name: string;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const defaultSheet = (): SheetSettings => ({
  show: true,
  size: 'auto',
  landscape: true,
  company: '',
  title: '',
  drawnBy: '',
  approvedBy: '',
  date: new Date().toISOString().slice(0, 10),
  revision: '1',
  docNo: '',
  sheetNo: '1/1',
});

/** The sheet settings of a document, with the defaults filled in. */
export const sheetOf = (doc: { sheet?: Partial<SheetSettings> }): SheetSettings => ({ ...defaultSheet(), ...doc.sheet });

const standard = (size: PaperSize, landscape: boolean): Paper => {
  const [w, h] = PAPER_MM[size];
  return landscape ? { w, h, name: size } : { w: h, h: w, name: size };
};

/** The space the circuit needs on a sheet, in mm: its own size, the frame margins, and the strip of the title block. */
export const sheetNeed = (content: { w: number; h: number }): { w: number; h: number } => ({
  w: content.w + 2 * (MARGIN_MM + GAP_MM),
  h: content.h + 2 * (MARGIN_MM + GAP_MM) + TITLE_H,
});

/**
 * The paper of a sheet. A fixed size is just that; "auto" takes the smallest standard size that holds a circuit of
 * `content` mm, or a custom size (a multiple of 10 mm) when even A0 is too small.
 */
export function paperFor(s: Pick<SheetSettings, 'size' | 'landscape'>, content: { w: number; h: number } | null): Paper {
  if (s.size !== 'auto') return standard(s.size, s.landscape);
  if (!content) return standard('A4', s.landscape);
  const need = sheetNeed(content);
  for (const size of PAPER_SIZES) {
    const p = standard(size, s.landscape);
    if (need.w <= p.w && need.h <= p.h) return p;
  }
  return { w: Math.ceil(need.w / 10) * 10, h: Math.ceil(need.h / 10) * 10, name: 'custom' };
}

/** The title block rectangle in sheet millimetres: the bottom right corner of the frame. */
export function titleBlockRect(p: { w: number; h: number }): Box {
  const w = Math.min(TITLE_W, p.w - 2 * MARGIN_MM);
  return { x: p.w - MARGIN_MM - w, y: p.h - MARGIN_MM - TITLE_H, w, h: TITLE_H };
}

export interface TitleCell {
  /** Millimetres from the top left of the title block. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  value: string;
  /** Height of the value text in mm. */
  size: number;
  bold?: boolean;
}

const L = (en: string, tr: string): LocalText => ({ en, tr });
const LABELS = {
  company: L('Company', 'Şirket'),
  title: L('Title', 'Başlık'),
  drawnBy: L('Drawn by', 'Çizen'),
  date: L('Date', 'Tarih'),
  revision: L('Revision', 'Revizyon'),
  approvedBy: L('Approved by', 'Onaylayan'),
  docNo: L('Drawing no', 'Çizim no'),
  sheetNo: L('Sheet', 'Sayfa'),
};

/** A text shortened with an ellipsis so that it fits a cell of `width` mm at the given height. */
export function fitText(text: string, width: number, size: number): string {
  const max = Math.max(1, Math.floor((width - 3) / (size * 0.56)));
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** The cells of the title block: company and title across the top, then two rows of three. */
export function titleBlockCells(s: SheetSettings, lang: 'en' | 'tr', p: { w: number; h: number }): TitleCell[] {
  const { w } = titleBlockRect(p);
  const third = w / 3;
  const label = (k: keyof typeof LABELS): string => LABELS[k][lang] ?? LABELS[k].en;
  const cell = (x: number, y: number, cw: number, h: number, k: keyof typeof LABELS, value: string, size: number, bold = false): TitleCell => ({
    x,
    y,
    w: cw,
    h,
    label: label(k),
    value: fitText(value, cw, size),
    size,
    ...(bold ? { bold } : {}),
  });
  return [
    cell(0, 0, w, 8, 'company', s.company, 3.8, true),
    cell(0, 8, w, 7, 'title', s.title, 3.2),
    cell(0, 15, third, 5.5, 'drawnBy', s.drawnBy, 2.5),
    cell(third, 15, third, 5.5, 'date', s.date, 2.5),
    cell(2 * third, 15, third, 5.5, 'revision', s.revision, 2.5),
    cell(0, 20.5, third, 5.5, 'approvedBy', s.approvedBy, 2.5),
    cell(third, 20.5, third, 5.5, 'docNo', s.docNo, 2.5),
    cell(2 * third, 20.5, third, 5.5, 'sheetNo', s.sheetNo, 2.5),
  ];
}

/** The part of the sheet the circuit may use: inside the frame, above the title block. */
export function drawingArea(p: { w: number; h: number }): Box {
  return { x: MARGIN_MM + GAP_MM, y: MARGIN_MM + GAP_MM, w: p.w - 2 * (MARGIN_MM + GAP_MM), h: p.h - 2 * MARGIN_MM - TITLE_H - 2 * GAP_MM };
}

/** Whether a circuit (pixels from the sheet's corner) lies inside the frame at the printed scale. */
export function insideFrame(content: Box, p: { w: number; h: number }): boolean {
  const x0 = content.x * MM_PER_PX;
  const y0 = content.y * MM_PER_PX;
  return x0 >= MARGIN_MM && y0 >= MARGIN_MM && x0 + content.w * MM_PER_PX <= p.w - MARGIN_MM && y0 + content.h * MM_PER_PX <= p.h - MARGIN_MM;
}

/**
 * Where a circuit goes on the printed page: `scale` millimetres per pixel and the offset (`tx`, `ty`, mm) so that a
 * point (x, y) of the circuit lands at (tx + x * scale, ty + y * scale). A circuit that lies inside the frame is
 * printed exactly where it is on the sheet, at the sheet's scale. One that does not (it was moved off the sheet, or the
 * paper is fixed and small) is scaled down to fit and centred in the drawing area.
 */
export function fitContent(content: Box, p: { w: number; h: number }): { scale: number; tx: number; ty: number } {
  const area = drawingArea(p);
  if (content.w <= 0 || content.h <= 0) return { scale: MM_PER_PX, tx: 0, ty: 0 };
  if (insideFrame(content, p)) return { scale: MM_PER_PX, tx: 0, ty: 0 };
  const scale = Math.min(area.w / content.w, area.h / content.h, MM_PER_PX);
  return {
    scale,
    tx: area.x + (area.w - content.w * scale) / 2 - content.x * scale,
    ty: area.y + (area.h - content.h * scale) / 2 - content.y * scale,
  };
}

/**
 * How far (pixels) to move a circuit so that it sits in the middle of the drawing area of the sheet, in whole grid
 * steps so that every pin stays on the grid.
 */
export function centerShift(circuit: Box, p: { w: number; h: number }): { dx: number; dy: number } {
  const area = drawingArea(p);
  const cx = circuit.x + circuit.w / 2;
  const cy = circuit.y + circuit.h / 2;
  return {
    dx: Math.round(((area.x + area.w / 2) * PX_PER_MM - cx) / GRID),
    dy: Math.round(((area.y + area.h / 2) * PX_PER_MM - cy) / GRID),
  };
}
