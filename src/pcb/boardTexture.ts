// The picture of one face of the board for the 3D view: green solder mask, the copper that shows through as a lighter
// green, the bare pads, the holes and (on the top) the white silkscreen. Drawn on a canvas, then used as a texture.

import { footprintById } from '../../core/pcb/footprints';
import { textStrokes } from '../../core/pcb/font';
import { analyzePour, deadIslandRuns, pourContacts, pourCutouts, pourOutline, type Cutout } from '../../core/pcb/pour';
import { polarityMarks } from '../../core/pcb/silk';
import type { AbsPad, Layer, PcbDoc, Pt } from '../../core/pcb/types';

const MASK = '#14603a';
const COPPER_UNDER_MASK = '#2e8a57';
const PAD = '#d9d6c8';
const HOLE = '#0b0d0e';
const SILK = '#f2f2ea';

const MAX_PX = 4096;

type Ctx = CanvasRenderingContext2D;

function padPath(ctx: Ctx, p: { x: number; y: number; w: number; h: number; shape: string }, grow = 0): void {
  const w = p.w + grow;
  const h = p.h + grow;
  ctx.beginPath();
  if (p.shape === 'round') ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
  else if (p.shape === 'rect') ctx.rect(p.x - w / 2, p.y - h / 2, w, h);
  else {
    const r = Math.min(w, h) / 2;
    const horizontal = w >= h;
    const a = horizontal ? { x: p.x - (w / 2 - r), y: p.y } : { x: p.x, y: p.y - (h / 2 - r) };
    const b = horizontal ? { x: p.x + (w / 2 - r), y: p.y } : { x: p.x, y: p.y + (h / 2 - r) };
    ctx.arc(a.x, a.y, r, horizontal ? Math.PI / 2 : Math.PI, horizontal ? (3 * Math.PI) / 2 : 2 * Math.PI);
    ctx.arc(b.x, b.y, r, horizontal ? (3 * Math.PI) / 2 : 0, horizontal ? Math.PI / 2 : Math.PI);
    ctx.closePath();
  }
}

function cutoutPath(ctx: Ctx, c: Cutout): void {
  if (c.kind === 'round') padPath(ctx, { x: c.c.x, y: c.c.y, w: c.d, h: c.d, shape: 'round' });
  else if (c.kind === 'rect') padPath(ctx, { x: c.c.x, y: c.c.y, w: c.w, h: c.h, shape: 'rect' });
  else if (c.kind === 'oval') padPath(ctx, { x: c.c.x, y: c.c.y, w: c.w, h: c.h, shape: 'oval' });
}

function strokeLine(ctx: Ctx, pts: Pt[], width: number): void {
  if (pts.length < 2) return;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
}

/** Pixels per mm for a board of this size. */
export const texScale = (pcb: PcbDoc): number => Math.min(24, MAX_PX / Math.max(pcb.board.w, pcb.board.h));

/**
 * The face of `layer`. Board millimetres map to pixels with y flipped on the bottom, so that the texture sits on the
 * plane of the 3D scene correctly (see Pcb3D).
 */
export function drawFace(pcb: PcbDoc, pads: AbsPad[], refs: Map<string, string>, layer: Layer): HTMLCanvasElement {
  const b = pcb.board;
  const s = texScale(pcb);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(b.w * s));
  canvas.height = Math.max(1, Math.round(b.h * s));
  const ctx = canvas.getContext('2d')!;
  const single = pcb.sides === 1;
  const hasCopper = !(single && layer === 'top');

  // Board millimetres -> pixels.
  const setup = (c: Ctx): void => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (layer === 'top') c.setTransform(s, 0, 0, s, -b.x * s, -b.y * s);
    else c.setTransform(s, 0, 0, -s, -b.x * s, (b.y + b.h) * s);
  };

  ctx.fillStyle = MASK;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (hasCopper) {
    const cu = document.createElement('canvas');
    cu.width = canvas.width;
    cu.height = canvas.height;
    const c = cu.getContext('2d')!;
    setup(c);
    c.fillStyle = COPPER_UNDER_MASK;
    c.strokeStyle = COPPER_UNDER_MASK;

    for (const pour of pcb.pours ?? []) {
      if (pour.layer !== layer) continue;
      c.globalCompositeOperation = 'source-over';
      c.beginPath();
      pourOutline(pcb).forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
      c.fill();
      c.globalCompositeOperation = 'destination-out';
      for (const cut of pourCutouts(pcb, pads, pour)) {
        if (cut.kind === 'stroke') strokeLine(c, cut.pts, cut.width);
        else {
          cutoutPath(c, cut);
          c.fill();
        }
      }
      const an = analyzePour(pcb, pads, pour);
      for (const run of deadIslandRuns(an, pourContacts(pcb, pads, pour, an))) c.fillRect(run.x0, run.y - an.g / 2, run.x1 - run.x0, an.g);
      c.globalCompositeOperation = 'source-over';
    }
    for (const t of pcb.tracks) if (t.layer === layer) strokeLine(c, t.pts, t.width);
    for (const p of pads) {
      if (p.smd && layer === 'bottom' && !single) continue;
      padPath(c, p);
      c.fill();
    }
    if (!single) {
      for (const v of pcb.vias) {
        padPath(c, { x: v.x, y: v.y, w: v.dia, h: v.dia, shape: 'round' });
        c.fill();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(cu, 0, 0);
  }

  setup(ctx);
  if (hasCopper) {
    // Bare pads (tinned) with their holes; vias are tented, only the hole shows.
    ctx.fillStyle = PAD;
    for (const p of pads) {
      if (p.smd && layer === 'bottom' && !single) continue;
      padPath(ctx, p);
      ctx.fill();
    }
    ctx.fillStyle = HOLE;
    for (const p of pads) {
      if (p.drill <= 0) continue;
      padPath(ctx, { x: p.x, y: p.y, w: p.drill, h: p.drill, shape: 'round' });
      ctx.fill();
    }
    if (!single) {
      for (const v of pcb.vias) {
        padPath(ctx, { x: v.x, y: v.y, w: v.drill, h: v.drill, shape: 'round' });
        ctx.fill();
      }
    }
  }

  if (layer === 'top') {
    ctx.strokeStyle = SILK;
    for (const fp of pcb.fps) {
      const def = footprintById(fp.footprint);
      if (!def) continue;
      const swap = fp.rot === 90 || fp.rot === 270;
      const bw = swap ? def.body.h : def.body.w;
      const bh = swap ? def.body.w : def.body.h;
      ctx.lineWidth = 0.15;
      ctx.strokeRect(fp.x - bw / 2, fp.y - bh / 2, bw, bh);
      const ref = refs.get(fp.partId);
      if (ref) for (const st of textStrokes(ref, fp.x, fp.y - bh / 2 - 0.9, 1)) strokeLine(ctx, st, 0.15);
    }
    for (const m of polarityMarks(pcb, pads)) strokeLine(ctx, m, 0.15);
  }
  return canvas;
}
