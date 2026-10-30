// 2D distance helpers used by connectivity, DRC and the router.

import type { Pt } from './types';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

export function segSegDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(pointSegDist(a, c, d), pointSegDist(b, c, d), pointSegDist(c, a, b), pointSegDist(d, a, b));
}

export const pointInBox = (p: Pt, b: Box): boolean => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;

export function pointBoxDist(p: Pt, b: Box): number {
  const dx = Math.max(b.x0 - p.x, 0, p.x - b.x1);
  const dy = Math.max(b.y0 - p.y, 0, p.y - b.y1);
  return Math.hypot(dx, dy);
}

export function segBoxDist(a: Pt, b: Pt, box: Box): number {
  if (pointInBox(a, box) || pointInBox(b, box)) return 0;
  const c = [
    { x: box.x0, y: box.y0 },
    { x: box.x1, y: box.y0 },
    { x: box.x1, y: box.y1 },
    { x: box.x0, y: box.y1 },
  ];
  let m = Infinity;
  for (let i = 0; i < 4; i++) m = Math.min(m, segSegDist(a, b, c[i], c[(i + 1) % 4]));
  return m;
}

export function boxBoxDist(a: Box, b: Box): number {
  const dx = Math.max(a.x0 - b.x1, 0, b.x0 - a.x1);
  const dy = Math.max(a.y0 - b.y1, 0, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

/** Closest approach of a polyline to a point. */
export function polylineDist(pts: Pt[], p: Pt): number {
  if (pts.length === 1) return dist(pts[0], p);
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) m = Math.min(m, pointSegDist(p, pts[i - 1], pts[i]));
  return m;
}
