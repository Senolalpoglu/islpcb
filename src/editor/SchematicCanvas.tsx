import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { Solution } from '../../core/sim/solver';
import {
  GRID,
  PART_DEFS,
  addPart,
  addWire,
  isMcu,
  movePartWithWires,
  moveSelectionWithWires,
  removeSelected,
  transformPartWithWires,
  onSegment,
  pinPositions,
  ptKey,
  rotate,
  setLabelOffset,
  type Doc,
  type LabelKind,
  type Part,
  type PartType,
  type Pt,
  type Rot,
} from './model';
import type { Extracted } from './netlist';
import { motionOf } from './motion';
import { computeFlow, NO_CURRENT } from './flow';
import { explainPart, isSwitchPart, partState } from './explain';
import { FlowLayer, type FlowView } from './FlowLayer';
import { SevenSegGlyph } from './SevenSegGlyph';
import { digitsOf, isSevenSeg } from '../sim/segments';
import { boxInside, boxesTouch, partBounds, sheetLayout, type GridBox } from './bounds';
import { PX_PER_MM, type SheetSettings } from './sheet';
import { SheetSvg } from './SheetSvg';
import { BBOX, PROBE_COLORS, PartSymbol } from './symbols';
import { eng } from './units';
import { partValueText } from './values';
import type { Issue } from './limits';
import { useI18n, type Key } from '../i18n';

export type Tool = 'select' | 'wire';
/** One part or wire, or several picked with the selection box. */
export type Selection = { kind: 'part' | 'wire'; id: string } | { kind: 'many'; parts: string[]; wires: string[] } | null;

/** The parts and wires a selection stands for. */
export function selectedIds(s: Selection): { parts: Set<string>; wires: Set<string> } {
  if (!s) return { parts: new Set(), wires: new Set() };
  if (s.kind === 'many') return { parts: new Set(s.parts), wires: new Set(s.wires) };
  return s.kind === 'part' ? { parts: new Set([s.id]), wires: new Set() } : { parts: new Set(), wires: new Set([s.id]) };
}

interface Props {
  doc: Doc;
  extracted: Extracted;
  solution: Solution | null;
  /** Parts that went beyond their ratings while the circuit ran; each gets an exclamation mark with the explanation. */
  issues?: Issue[];
  tool: Tool;
  placing: PartType | null;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onPlacing: (t: PartType | null) => void;
  /** Applies a change and records an undo step. */
  commit: (d: Doc) => void;
  /** Applies a change without an undo step (used while dragging). */
  replace: (d: Doc) => void;
  /** Records the current document as an undo step before a drag begins. */
  checkpoint: () => void;
  onCursor: (p: Pt | null) => void;
  /** Changing this value fits the whole circuit into view (used after loading a file or example). */
  fitKey: number;
  /** Draw the grid dots. */
  gridOn: boolean;
  /** The drawing sheet to draw behind the circuit, or null for none. */
  sheet: SheetSettings | null;
  lang: 'en' | 'tr';
  /** The animated view of voltage and current on the wires, and one-click switches. Without it the sheet is drawn as before. */
  flow?: FlowView;
  /** Brightness of the segments of each 7-segment display while the circuit runs, by part id. */
  segLevels?: Map<string, number[]>;
}

/** Every grid dot has the same size and is faint: it is a guide, not a drawing. */
const DOT_RADIUS = 0.9;
const snap = (v: number): number => Math.round(v);
const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

function hitPart(doc: Doc, gx: number, gy: number): Part | null {
  for (let i = doc.parts.length - 1; i >= 0; i--) {
    const p = doc.parts[i];
    const turned = rotate({ x: gx - p.x, y: gy - p.y }, ((360 - p.rot) % 360) as Rot);
    const local = p.mirror ? { x: -turned.x, y: turned.y } : turned;
    const b = BBOX[p.type];
    if (!b) continue;
    if (local.x >= b.x0 && local.x <= b.x1 && local.y >= b.y0 && local.y <= b.y1) return p;
  }
  return null;
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len2));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * What a selection box takes. Dragged from the left to the right it takes what lies completely inside; dragged from the
 * right to the left it takes everything it touches.
 */
export function pickInBox(doc: Doc, box: GridBox, window: boolean): Selection {
  const take = (b: GridBox | null): boolean => b !== null && (window ? boxInside(b, box) : boxesTouch(b, box));
  const parts = doc.parts.filter((p) => take(partBounds(p))).map((p) => p.id);
  const wires = doc.wires.filter((w) => take({ x0: Math.min(w.a.x, w.b.x), y0: Math.min(w.a.y, w.b.y), x1: Math.max(w.a.x, w.b.x), y1: Math.max(w.a.y, w.b.y) })).map((w) => w.id);
  if (parts.length + wires.length === 0) return null;
  if (parts.length === 1 && wires.length === 0) return { kind: 'part', id: parts[0] };
  if (parts.length === 0 && wires.length === 1) return { kind: 'wire', id: wires[0] };
  return { kind: 'many', parts, wires };
}

export function SchematicCanvas(props: Props) {
  const { doc, extracted, solution, tool, placing, selection, onSelect, onPlacing, commit, replace, checkpoint, onCursor, fitKey, gridOn, sheet, lang, flow: flowView } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const { t } = useI18n();
  const [overSwitch, setOverSwitch] = useState(false);
  const flowOn = flowView?.on === true && solution !== null;
  const flowData = useMemo(() => (flowOn && solution ? computeFlow(doc, solution, extracted) : null), [flowOn, doc, solution, extracted]);
  /** Closed switches, lit lamps, pulled-in relays and running motors get an ON tag. */
  const lit = useMemo(() => {
    if (!flowOn || !solution) return [];
    return doc.parts.filter((p) => (isSwitchPart(p) || motionOf(p, solution, extracted) !== null) && partState(p, solution, extracted).on === true);
  }, [flowOn, solution, doc.parts, extracted]);
  /** Why the chosen part is on or off, shown in a card while the flow view is on. */
  const why = useMemo(() => {
    if (!flowOn || !solution || selection?.kind !== 'part') return null;
    const part = doc.parts.find((q) => q.id === selection.id);
    return part ? { part, info: explainPart(part, doc, solution, extracted) } : null;
  }, [flowOn, solution, selection, doc, extracted]);
  /** What the pointer shows over each wire while the flow view is on. */
  const wireTips = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of flowData?.segs ?? []) {
      if (m.has(g.wireId)) continue;
      const flowing = g.amps !== null && Math.abs(g.amps) >= NO_CURRENT;
      const dir = !flowing ? '' : (g.amps! > 0) === (g.b.x > g.a.x || g.b.y > g.a.y) ? (g.b.x !== g.a.x ? ' →' : ' ↓') : g.b.x !== g.a.x ? ' ←' : ' ↑';
      m.set(g.wireId, `${eng(g.volts, 'V')}${g.amps === null ? '' : `, ${eng(Math.abs(g.amps), 'A')}${dir}`}`);
    }
    return m;
  }, [flowData]);
  const [tip, setTip] = useState<{ partId: string; x: number; y: number } | null>(null);
  const issuesOf = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of props.issues ?? []) m.set(i.partId, [...(m.get(i.partId) ?? []), i]);
    return m;
  }, [props.issues]);
  const [view, setView] = useState({ x: 60, y: 40, zoom: 1 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [placeRot, setPlaceRot] = useState<Rot>(0);
  const [placeMirror, setPlaceMirror] = useState(false);
  const [wirePts, setWirePts] = useState<Pt[]>([]);
  const drag = useRef<{ id: string; start: Pt; base: Doc; started: boolean; group?: { parts: Set<string>; wires: Set<string> } } | null>(null);
  /** The selection box while it is being dragged: where it began, in grid units. */
  const boxDrag = useRef<{ sx: number; sy: number } | null>(null);
  const [box, setBox] = useState<GridBox | null>(null);
  const holding = useRef<string | null>(null);
  const labelDrag = useRef<{ id: string; kind: LabelKind; start: Pt; base: Doc; off0: Pt; started: boolean } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const toGridFloat = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.zoom / GRID, y: (e.clientY - r.top - view.y) / view.zoom / GRID };
  };
  const toGrid = (e: { clientX: number; clientY: number }): Pt => {
    const f = toGridFloat(e);
    return { x: snap(f.x), y: snap(f.y) };
  };

  const probeColor = useMemo(() => {
    const m = new Map<string, string>();
    doc.parts.filter((p) => p.type === 'PROBE').forEach((p, i) => m.set(p.id, PROBE_COLORS[i % PROBE_COLORS.length]));
    return m;
  }, [doc.parts]);

  // Points where three or more things meet get a junction dot.
  const junctions = useMemo(() => {
    const count = new Map<string, { p: Pt; n: number }>();
    const bump = (p: Pt) => {
      const k = ptKey(p);
      const e = count.get(k);
      if (e) e.n++;
      else count.set(k, { p, n: 1 });
    };
    for (const w of doc.wires) {
      bump(w.a);
      bump(w.b);
    }
    for (const part of doc.parts) pinPositions(part).forEach(bump);
    for (const e of count.values()) for (const w of doc.wires) if (onSegment(e.p, w.a, w.b) && ptKey(e.p) !== ptKey(w.a) && ptKey(e.p) !== ptKey(w.b)) e.n += 2;
    return [...count.values()].filter((e) => e.n >= 3).map((e) => e.p);
  }, [doc]);

  const isConnectable = (c: Pt): boolean =>
    doc.parts.some((p) => pinPositions(p).some((q) => q.x === c.x && q.y === c.y)) || doc.wires.some((w) => onSegment(c, w.a, w.b));

  const finishWire = (pts: Pt[]) => {
    let d = doc;
    for (let i = 1; i < pts.length; i++) d = addWire(d, pts[i - 1], pts[i]);
    if (d !== doc) commit(d);
    setWirePts([]);
  };

  const pathTo = (from: Pt, to: Pt): Pt[] => {
    const corner = { x: to.x, y: from.y };
    return from.x !== to.x && from.y !== to.y ? [corner, to] : [to];
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      if (wirePts.length > 1) finishWire(wirePts);
      else setWirePts([]);
      onPlacing(null);
      return;
    }
    if (e.button === 1) {
      e.preventDefault(); // no browser auto-scroll on the middle button
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const c = toGrid(e);
    if (placing) {
      commit(addPart(doc, placing, c.x, c.y, placeRot, placeMirror));
      return;
    }
    if (tool === 'wire') {
      if (wirePts.length === 0) {
        setWirePts([c]);
        return;
      }
      const last = wirePts[wirePts.length - 1];
      if (last.x === c.x && last.y === c.y) {
        finishWire(wirePts);
        return;
      }
      const next = [...wirePts, ...pathTo(last, c)];
      if (isConnectable(c)) finishWire(next);
      else setWirePts(next);
      return;
    }
    // A text next to a part is picked up and dragged on its own.
    const labelEl = (e.target as Element).closest?.('[data-label]');
    if (labelEl) {
      const id = labelEl.getAttribute('data-part')!;
      const kind = labelEl.getAttribute('data-label') as LabelKind;
      const owner = doc.parts.find((q) => q.id === id);
      if (owner) {
        const g = toGridFloat(e);
        onSelect({ kind: 'part', id });
        labelDrag.current = { id, kind, start: { x: g.x * GRID, y: g.y * GRID }, base: doc, off0: owner.labels?.[kind] ?? { x: 0, y: 0 }, started: false };
        return;
      }
    }
    const f = toGridFloat(e);
    const part = hitPart(doc, f.x, f.y);
    const inBlock = selection?.kind === 'many' ? selectedIds(selection) : null;
    if (part && inBlock?.parts.has(part.id)) {
      // Part of a block chosen with the selection box: the whole block moves.
      drag.current = { id: part.id, start: c, base: doc, started: false, group: inBlock };
      return;
    }
    if (part) {
      onSelect({ kind: 'part', id: part.id });
      // With one-click switches a plain click flips a switch; moving it needs the select tool's drag on another part.
      if (flowView?.interactive && isSwitchLike(part) && !isMomentary(part)) {
        commit(setClosed(doc, part.id, !(part.params.closed === true)));
        return;
      }
      // A push button closes while the mouse button is held down on it.
      if (isMomentary(part)) {
        holding.current = part.id;
        replace(setClosed(doc, part.id, true));
        return;
      }
      drag.current = { id: part.id, start: c, base: doc, started: false };
      return;
    }
    const wire = doc.wires.find((w) => distToSegment(f.x, f.y, w.a, w.b) < 0.35);
    if (wire && inBlock?.wires.has(wire.id)) {
      drag.current = { id: wire.id, start: c, base: doc, started: false, group: inBlock };
      return;
    }
    if (wire) {
      onSelect({ kind: 'wire', id: wire.id });
      return;
    }
    onSelect(null);
    // Shift moves the view; without it a drag on empty space draws the selection box.
    if (e.shiftKey) pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    else boxDrag.current = { sx: f.x, sy: f.y };
  };

  const onMouseMove = (e: ReactMouseEvent) => {
    const drag0 = pan.current;
    if (drag0) {
      // Read the start of the drag now: the update below runs later, when the button may already be released.
      setView((v) => ({ ...v, x: drag0.vx + e.clientX - drag0.sx, y: drag0.vy + e.clientY - drag0.sy }));
      return;
    }
    const ld = labelDrag.current;
    if (ld) {
      const g = toGridFloat(e);
      const dx = Math.round(g.x * GRID - ld.start.x);
      const dy = Math.round(g.y * GRID - ld.start.y);
      if (!ld.started) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
        checkpoint();
        ld.started = true;
      }
      replace(setLabelOffset(ld.base, ld.id, ld.kind, { x: ld.off0.x + dx, y: ld.off0.y + dy }));
      return;
    }
    const bd = boxDrag.current;
    if (bd) {
      const g = toGridFloat(e);
      setBox({ x0: Math.min(bd.sx, g.x), y0: Math.min(bd.sy, g.y), x1: Math.max(bd.sx, g.x), y1: Math.max(bd.sy, g.y) });
      return;
    }
    const c = toGrid(e);
    setCursor(c);
    onCursor(c);
    if (flowView?.interactive) {
      const f = toGridFloat(e);
      const over = hitPart(doc, f.x, f.y);
      const clickable = over !== null && isSwitchLike(over);
      if (clickable !== overSwitch) setOverSwitch(clickable);
    }
    const d = drag.current;
    if (d) {
      const dx = c.x - d.start.x;
      const dy = c.y - d.start.y;
      if (!d.started) {
        if (dx === 0 && dy === 0) return;
        checkpoint();
        d.started = true;
      }
      // Always recomputed from the document as it was when the drag began.
      replace(d.group ? moveSelectionWithWires(d.base, d.group.parts, d.group.wires, dx, dy) : movePartWithWires(d.base, d.id, dx, dy));
    }
  };

  const endPointer = () => {
    if (holding.current) {
      replace(setClosed(doc, holding.current, false));
      holding.current = null;
    }
    drag.current = null;
    labelDrag.current = null;
    pan.current = null;
    const bd = boxDrag.current;
    if (bd) {
      boxDrag.current = null;
      if (box && (box.x1 - box.x0 > 0.3 || box.y1 - box.y0 > 0.3)) onSelect(pickInBox(doc, box, bd.sx <= box.x0 + 1e-9));
      setBox(null);
    }
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    if (tool !== 'select' || placing) return;
    const f = toGridFloat(e);
    const part = hitPart(doc, f.x, f.y);
    if (part && isSwitchLike(part) && !isMomentary(part)) commit(setClosed(doc, part.id, !(part.params.closed === true)));
  };

  const onWheel = (e: ReactWheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const zoom = Math.min(3, Math.max(0.08, v.zoom * Math.pow(1.1, -e.deltaY / 100)));
      const k = zoom / v.zoom;
      return { zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        onSelect(doc.parts.length + doc.wires.length === 0 ? null : { kind: 'many', parts: doc.parts.map((q) => q.id), wires: doc.wires.map((w) => w.id) });
        return;
      }
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === 'Escape') {
        setWirePts([]);
        onPlacing(null);
        onSelect(null);
      } else if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
        // Space turns the part like R does. A focused button would also take the space as a click: let go of it.
        if (e.key === ' ') {
          e.preventDefault();
          if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
        }
        if (placing) setPlaceRot((r) => ((r + 90) % 360) as Rot);
        else if (selection?.kind === 'part') {
          const part = doc.parts.find((p) => p.id === selection.id);
          if (part) commit(transformPartWithWires(doc, part.id, { rot: ((part.rot + 90) % 360) as Rot }));
        }
      } else if (e.key === 'm' || e.key === 'M') {
        if (placing) setPlaceMirror((m) => !m);
        else if (selection?.kind === 'part') {
          const part = doc.parts.find((p) => p.id === selection.id);
          if (part) commit(transformPartWithWires(doc, part.id, { mirror: !part.mirror }));
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        const ids = selectedIds(selection);
        commit(removeSelected(doc, ids.parts, ids.wires));
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (tool !== 'wire') setWirePts([]);
  }, [tool]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || (doc.parts.length === 0 && doc.wires.length === 0)) return;
    const pts: Pt[] = [...doc.wires.flatMap((w) => [w.a, w.b]), ...doc.parts.flatMap((p) => pinPositions(p))];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    // Margins leave room for labels and the oversized microcontroller body.
    let minX = Math.min(...xs) - 3;
    let maxX = Math.max(...xs) + 3;
    let minY = Math.min(...ys) - 3;
    let maxY = Math.max(...ys) + 3;
    if (sheet) {
      // With the sheet shown, the whole sheet is brought into view, not just the circuit.
      const l = sheetLayout(doc, sheet);
      minX = 0;
      minY = 0;
      maxX = (l.paper.w * PX_PER_MM) / GRID;
      maxY = (l.paper.h * PX_PER_MM) / GRID;
    }
    const r = svg.getBoundingClientRect();
    const w = (maxX - minX) * GRID;
    const h = (maxY - minY) * GRID;
    const zoom = Math.min(1.2, Math.max(0.08, Math.min(r.width / w, r.height / h)));
    setView({ zoom, x: (r.width - w * zoom) / 2 - minX * GRID * zoom, y: (r.height - h * zoom) / 2 - minY * GRID * zoom });
    // Only when fitKey changes; the document itself changes constantly while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  const preview = wirePts.length > 0 && cursor ? [...wirePts, ...pathTo(wirePts[wirePts.length - 1], cursor)] : wirePts;
  const px = (v: number): number => v * GRID;
  const chosen = useMemo(() => selectedIds(selection), [selection]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => (sheet ? sheetLayout(doc, sheet) : null), [doc.parts, doc.wires, sheet]);
  // Grid dots: one per grid point, or one per five when that would be closer than 10 px on the screen.
  const gridStep = GRID * view.zoom * (GRID * view.zoom >= 10 ? 1 : 5);
  const cursorClass = placing ? 'placing' : tool === 'wire' ? 'wiring' : flowView?.interactive && overSwitch ? 'clickable' : '';

  const tipPart = tip ? doc.parts.find((q) => q.id === tip.partId) : undefined;
  return (
    <>
    <svg
      ref={svgRef}
      className={`canvas ${cursorClass}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPointer}
      onMouseLeave={() => {
        endPointer();
        setCursor(null);
        onCursor(null);
      }}
      onDoubleClick={onDoubleClick}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <defs>
        {/* The dots sit in the middle of their tile (a dot on the tile's corner would be cut into quarters), so the
            tile is shifted by half its size to put every dot on a grid point. Zoomed far out, only every fifth point shows. */}
        <pattern id="grid" width={gridStep} height={gridStep} x={view.x - gridStep / 2} y={view.y - gridStep / 2} patternUnits="userSpaceOnUse">
          <circle cx={gridStep / 2} cy={gridStep / 2} r={DOT_RADIUS} className="grid-dot" />
        </pattern>
      </defs>
      {gridOn && <rect width="100%" height="100%" fill="url(#grid)" />}
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {sheet && layout && (
          <g transform={`scale(${PX_PER_MM})`}>
            <SheetSvg sheet={sheet} lang={lang} paper={layout.paper} />
          </g>
        )}
        <g data-schematic="content">
        {doc.wires.map((w) => (
          <line
            key={w.id}
            className={`wire ${chosen.wires.has(w.id) ? 'sel' : ''}`}
            x1={px(w.a.x)}
            y1={px(w.a.y)}
            x2={px(w.b.x)}
            y2={px(w.b.y)}
          >
            {wireTips.has(w.id) && <title>{wireTips.get(w.id)}</title>}
          </line>
        ))}
        {flowData && flowView && (
          <FlowLayer
            flow={flowData}
            view={flowView}
            lit={lit}
            switches={doc.parts.filter((p) => isSwitchLike(p) && !isMomentary(p)).map((p) => ({ part: p, closed: p.params.closed === true }))}
          />
        )}
        {doc.parts.map((p) => {
          const def = PART_DEFS[p.type];
          const pins = pinPositions(p);
          const vertical = pins.length > 1 && Math.abs(pins[0].y - pins[1].y) > Math.abs(pins[0].x - pins[1].x);
          const sel = chosen.parts.has(p.id);
          const color = probeColor.get(p.id);
          const value = partValueText(p);
          const live = solution && liveText(p, solution, extracted);
          const glow = solution ? ledGlow(p, solution, extracted) : null;
          const motion = solution ? motionOf(p, solution, extracted) : null;
          const probe = p.type === 'PROBE';
          // Horizontal parts: reference above the body, value and live reading below it.
          const opamp = p.type === 'OPAMP' || def.custom?.symbol.kind === 'opamp5';
          const mcu = isMcu(p.type) || def.custom?.symbol.kind === 'box';
          const three = pins.length === 3 && !opamp;
          const side = !mcu && (vertical || probe || three); // label sits beside the part, left-aligned
          const lx = mcu ? px(p.x) : probe ? px(p.x) + 14 : three ? px(p.x) + 46 : vertical ? px(p.x) + 26 : px(p.x);
          const ly = mcu ? px(p.y) + Math.min(...def.pins.map((q) => q.y)) * GRID - 40 : probe ? px(p.y) + 4 : three || vertical ? px(p.y) - 6 : opamp ? px(p.y) - 42 : px(p.y) - 14;
          const valY = side || opamp ? ly + 13 : px(p.y) + 22;
          const liveY = three || vertical ? ly + 26 : probe ? ly : opamp ? px(p.y) + 54 : px(p.y) + 35;
          const anchor = side ? 'start' : 'middle';
          const name = partName(p);
          return (
            <g key={p.id}>
              {glow && (
                <g transform={`translate(${px(p.x)} ${px(p.y)})`} pointerEvents="none" className="led-glow">
                  <circle r={18 + 22 * glow.level} fill={glow.color} opacity={0.18 + 0.4 * glow.level} style={{ filter: 'blur(7px)' }} />
                  <circle r={7 + 8 * glow.level} cy={-2} fill={glow.color} opacity={0.35 + 0.6 * glow.level} style={{ filter: 'blur(3px)' }} />
                </g>
              )}
              <g className={`sym ${sel ? 'sel' : ''}`} transform={`translate(${px(p.x)} ${px(p.y)}) rotate(${p.rot})${p.mirror ? ' scale(-1 1)' : ''}`}>
                <PartSymbol type={p.type} closed={p.params.closed === true} color={color} rot={p.rot} mirror={p.mirror === true} spin={motion?.spin ?? 0} pulled={motion?.pulled ?? false} />
              </g>
              {isSevenSeg(p.type) && (
                // The digits stay upright; their centre follows the part as it is turned: in the middle of the box for a
                // single digit, under the box for a display with several (they are wider than the box).
                <g
                  transform={(() => {
                    const along = digitsOf(p.type) === 1 ? -15 : 150;
                    const a = (p.rot * Math.PI) / 180;
                    return `translate(${px(p.x) - along * Math.sin(a)} ${px(p.y) + along * Math.cos(a)})`;
                  })()}
                >
                  <SevenSegGlyph levels={props.segLevels?.get(p.id)} digits={digitsOf(p.type)} />
                </g>
              )}
              {p.type !== 'GND' && (
                <g className="labels" textAnchor={anchor}>
                  <text x={lx} y={ly} className="lbl-ref" data-part={p.id} data-label="ref" transform={shift(p, 'ref')}>
                    {p.type === 'PROBE' ? '' : p.ref}
                  </text>
                  <text x={lx} y={valY} className="lbl-val" data-part={p.id} data-label="val" transform={shift(p, 'val')}>
                    {value}
                  </text>
                  {name && (
                    <text x={lx} y={liveY + 13} className="lbl-name" data-part={p.id} data-label="name" transform={shift(p, 'name')}>
                      {name}
                    </text>
                  )}
                  {live && (
                    <text x={lx} y={liveY} className="lbl-live" style={color ? { fill: color } : undefined}>
                      {live}
                    </text>
                  )}
                </g>
              )}
              {issuesOf.has(p.id) && <WarnBadge part={p} onTip={setTip} />}
              {pins.map((q, i) => (
                <circle key={`${p.id}-${i}`} className="pin" cx={px(q.x)} cy={px(q.y)} r={3}>
                  <title>{`${p.ref}.${def.pinNames[i]}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {junctions.map((j) => (
          <circle key={ptKey(j)} className="junction" cx={px(j.x)} cy={px(j.y)} r={4} />
        ))}
        </g>
        {box && <rect className="marquee" x={px(box.x0)} y={px(box.y0)} width={px(box.x1 - box.x0)} height={px(box.y1 - box.y0)} />}
        {preview.length > 1 && <polyline className="wire preview" points={preview.map((q) => `${px(q.x)},${px(q.y)}`).join(' ')} />}
        {placing && cursor && (
          <g className="sym ghost" transform={`translate(${px(cursor.x)} ${px(cursor.y)}) rotate(${placeRot})${placeMirror ? ' scale(-1 1)' : ''}`}>
            <PartSymbol type={placing} rot={placeRot} mirror={placeMirror} />
          </g>
        )}
        {tool === 'wire' && cursor && <circle className="cursor-dot" cx={px(cursor.x)} cy={px(cursor.y)} r={4} />}
      </g>
    </svg>
    {why && (
      <aside className="why-card" aria-live="polite">
        <header>
          <strong>{why.part.ref}</strong>
          <span className="why-value">{partValueText(why.part)}</span>
          {why.info.on !== null && <span className={`why-pill ${why.info.on ? 'on' : ''}`}>{t(why.info.on ? 'why.on' : 'why.off')}</span>}
        </header>
        <ul>
          {why.info.lines.map((l, k) => (
            <li key={k}>{t(l.key, l.vars)}</li>
          ))}
        </ul>
        {why.info.clickable && flowView?.interactive && <p className="why-hint">{t('why.clickHint')}</p>}
      </aside>
    )}
    {tip && tipPart && (
      <div className="warn-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 340), top: tip.y + 18 }} role="tooltip">
        <strong>{tipPart.ref}</strong>
        {(issuesOf.get(tip.partId) ?? []).map((i, k) => (
          <p key={k}>{issueText(i, tipPart, t)}</p>
        ))}
        <p className="warn-hint">{t('warn.hint')}</p>
      </div>
    )}
    </>
  );
}

/** The exclamation mark at the top right of a part that went beyond its ratings. Hovering it shows what is wrong. */
function WarnBadge({ part, onTip }: { part: Part; onTip: (t: { partId: string; x: number; y: number } | null) => void }) {
  const b = partBounds(part);
  if (!b) return null;
  return (
    <g
      className="warn-badge"
      transform={`translate(${b.x1 * GRID + 6} ${b.y0 * GRID - 6})`}
      onMouseEnter={(e) => onTip({ partId: part.id, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onTip({ partId: part.id, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <circle r={10} />
      <text y={4.5} textAnchor="middle">
        !
      </text>
    </g>
  );
}

/** The explanation of one problem, in the user's language. */
function issueText(i: Issue, p: Part, t: (key: Key, vars?: Record<string, string | number>) => string): string {
  const pin = (n?: string): string => (n === undefined || n === '0' ? 'GND' : `${p.ref}.${n}`);
  switch (i.kind) {
    case 'overvoltage':
      return t('warn.overvoltage', { v: eng(i.value, 'V'), a: pin(i.a), b: pin(i.b), limit: eng(i.limit, 'V') });
    case 'polarity':
      return t('warn.polarity', { v: eng(i.value, 'V'), a: pin(i.a), b: pin(i.b), limit: eng(i.limit, 'V') });
    case 'overcurrent':
      return t('warn.overcurrent', { i: eng(i.value, 'A'), a: pin(i.a), limit: eng(i.limit, 'A') });
    case 'overpower':
      return t('warn.overpower', { p: eng(i.value, 'W'), limit: eng(i.limit, 'W') });
  }
}

/** Parts that have an on/off state the user can flip: the switch and data-defined parts with a "closed" option. */
const isSwitchLike = (p: Part): boolean => p.type === 'SW' || (PART_DEFS[p.type]?.params.some((q) => q.name === 'closed' && q.kind === 'bool') ?? false);
const isMomentary = (p: Part): boolean => isSwitchLike(p) && p.params.momentary === true;
const setClosed = (doc: Doc, id: string, closed: boolean): Doc => ({ ...doc, parts: doc.parts.map((p) => (p.id === id ? { ...p, params: { ...p.params, closed } } : p)) });

/** The type of a part in a few words, drawn under it, for parts whose symbol does not say which one it is. */
function partName(p: Part): string {
  const custom = PART_DEFS[p.type]?.custom;
  if (!custom || (custom.symbol.kind !== 'like' && custom.symbol.kind !== 'glyph')) return '';
  return (PART_DEFS[p.type].labelText?.en ?? '').split(' (')[0];
}

/** SVG transform that moves a text by the offset the user dragged it to. */
const shift = (p: Part, kind: LabelKind): string | undefined => {
  const o = p.labels?.[kind];
  return o ? `translate(${o.x} ${o.y})` : undefined;
};

const LED_COLORS: Record<string, string> = {
  LED: '#ff3b30',
  'x:led-green': '#34e06a',
  'x:led-yellow': '#ffd60a',
  'x:led-blue': '#3a86ff',
  'x:led-white': '#fffbe6',
  'x:led-orange': '#ff8a1f',
};

/** An LED that carries current lights up: brightness follows the current, full at about 10 mA. */
function ledGlow(p: Part, s: Solution, x: Extracted): { color: string; level: number } | null {
  const color = LED_COLORS[p.type];
  if (!color) return null;
  const id = x.primary.get(p.id) ?? (x.elementIds.has(p.id) ? p.id : undefined);
  const i = id === undefined ? 0 : (s.i[id] ?? 0);
  if (!(i > 2e-5)) return null;
  return { color, level: Math.min(1, Math.sqrt(i / 0.01)) };
}

function liveText(p: Part, s: Solution, x: Extracted): string | null {
  const meter = PART_DEFS[p.type]?.custom?.meter;
  if (meter === 'voltage') {
    const a = x.nodeOfPin.get(`${p.id}:0`);
    const b = x.nodeOfPin.get(`${p.id}:1`);
    return a === undefined || b === undefined ? null : eng(s.v[a] - s.v[b], 'V');
  }
  if (meter === 'current') {
    const id = x.primary.get(p.id);
    return id === undefined ? null : eng(s.i[id] ?? 0, 'A');
  }
  if (p.type === 'PROBE') {
    const node = x.nodeOfPin.get(`${p.id}:0`);
    return node === undefined ? null : eng(s.v[node], 'V');
  }
  if (!x.elementIds.has(p.id)) return null;
  const i = s.i[p.id];
  return i === undefined ? null : eng(i, 'A');
}
