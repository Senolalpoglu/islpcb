import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { polarityMarks } from '../../core/pcb/silk';
import { analyzePour, deadIslandRuns, pourContacts, pourCutouts, pourOutline } from '../../core/pcb/pour';
import { footprintById, footprintExtent } from '../../core/pcb/footprints';
import { pointBoxDist, pointSegDist } from '../../core/pcb/geom';
import type { AirWire } from '../../core/pcb/ratsnest';
import type { DrcIssue } from '../../core/pcb/drc';
import type { AbsPad, Layer, PcbDoc, Pt, Rot, Track } from '../../core/pcb/types';
import type { Doc } from '../editor/model';

export type PcbTool = 'select' | 'route' | 'via';
export type PcbSelection = { kind: 'fp'; id: string } | { kind: 'track'; id: string } | { kind: 'via'; id: string } | null;

interface Props {
  pcb: PcbDoc;
  doc: Doc;
  pads: AbsPad[];
  airwires: AirWire[];
  issues: DrcIssue[];
  tool: PcbTool;
  layer: Layer;
  showTop: boolean;
  showBottom: boolean;
  selection: PcbSelection;
  focus: Pt | null;
  onSelect: (s: PcbSelection) => void;
  onLayer: (l: Layer) => void;
  commit: (p: PcbDoc) => void;
  replace: (p: PcbDoc) => void;
  checkpoint: () => void;
  onHover: (text: string) => void;
  fitKey: number;
}

const S = 10; // pixels per millimetre at zoom 1
const TOP = '#d9534f';
const BOTTOM = '#4a90e2';
const SNAP = 0.25;

const snap = (v: number): number => Math.round(v / SNAP) * SNAP;
const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);

/** Points to append so that the track from `from` to `to` uses only 0, 45 and 90 degree directions. */
function route45(from: Pt, to: Pt): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-9 || ay < 1e-9 || Math.abs(ax - ay) < 1e-9) return [to];
  const d = Math.min(ax, ay);
  const mid = { x: from.x + Math.sign(dx) * d, y: from.y + Math.sign(dy) * d };
  return [mid, to];
}

export function PcbCanvas(props: Props) {
  const { pcb, doc, pads, airwires, issues, tool, layer, showTop, showBottom, selection, focus, onSelect, onLayer, commit, replace, checkpoint, onHover, fitKey } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ x: 40, y: 40, zoom: 1 });
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [routing, setRouting] = useState<{ net: string; layer: Layer; pts: Pt[] } | null>(null);
  const drag = useRef<{ id: string; start: Pt; origin: Pt; started: boolean } | null>(null);
  const pan = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const toMm = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / (S * view.zoom), y: (e.clientY - r.top - view.y) / (S * view.zoom) };
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const b = pcb.board;
    const zoom = Math.min(4, Math.max(0.2, Math.min((r.width - 80) / (b.w * S), (r.height - 80) / (b.h * S))));
    setView({ zoom, x: (r.width - b.w * S * zoom) / 2 - b.x * S * zoom, y: (r.height - b.h * S * zoom) / 2 - b.y * S * zoom });
    // Only when asked to refit; the board changes while editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Bring a DRC issue into the middle of the view.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !focus) return;
    const r = svg.getBoundingClientRect();
    setView((v) => ({ ...v, x: r.width / 2 - focus.x * S * v.zoom, y: r.height / 2 - focus.y * S * v.zoom }));
  }, [focus]);

  const padAt = (p: Pt): AbsPad | undefined =>
    pads.find((pad) => {
      if (pad.smd && layer === 'bottom') return false;
      return pad.shape === 'round' ? Math.hypot(p.x - pad.x, p.y - pad.y) <= pad.w / 2 : pointBoxDist(p, { x0: pad.x - pad.w / 2, y0: pad.y - pad.h / 2, x1: pad.x + pad.w / 2, y1: pad.y + pad.h / 2 }) === 0;
    });

  const trackAt = (p: Pt, onLayer?: Layer): Track | undefined => {
    const reach = 0.25 / view.zoom + 0.1;
    for (let i = pcb.tracks.length - 1; i >= 0; i--) {
      const t = pcb.tracks[i];
      if (onLayer && t.layer !== onLayer) continue;
      for (let k = 1; k < t.pts.length; k++) if (pointSegDist(p, t.pts[k - 1], t.pts[k]) <= t.width / 2 + reach) return t;
    }
    return undefined;
  };

  const viaAt = (p: Pt) => pcb.vias.find((v) => Math.hypot(p.x - v.x, p.y - v.y) <= v.dia / 2 + 0.1);

  const fpAt = (p: Pt): string | undefined => {
    for (let i = pcb.fps.length - 1; i >= 0; i--) {
      const f = pcb.fps[i];
      const def = footprintById(f.footprint);
      if (!def) continue;
      const e = footprintExtent(f, def);
      if (Math.abs(p.x - f.x) <= e.w / 2 && Math.abs(p.y - f.y) <= e.h / 2) return f.partId;
    }
    return undefined;
  };

  const finishRoute = (r: { net: string; layer: Layer; pts: Pt[] }): void => {
    if (r.pts.length >= 2) {
      commit({ ...pcb, tracks: [...pcb.tracks, { id: `t${pcb.nextId}`, layer: r.layer, width: pcb.rules.trackWidth, pts: r.pts, net: r.net }], nextId: pcb.nextId + 1 });
    }
    setRouting(null);
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (e.button === 2) {
      e.preventDefault();
      if (routing) finishRoute(routing);
      return;
    }
    if (e.button === 1) {
      e.preventDefault(); // no browser auto-scroll on the middle button
      pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const p = toMm(e);
    if (tool === 'route') {
      if (!routing) {
        const pad = padAt(p);
        if (pad?.net) {
          setRouting({ net: pad.net, layer, pts: [{ x: pad.x, y: pad.y }] });
        } else {
          const t = trackAt(p, layer);
          if (t) setRouting({ net: t.net, layer, pts: [{ x: snap(p.x), y: snap(p.y) }] });
        }
        return;
      }
      const last = routing.pts[routing.pts.length - 1];
      const pad = padAt(p);
      if (pad && pad.net === routing.net && !(pad.x === last.x && pad.y === last.y)) {
        finishRoute({ ...routing, pts: [...routing.pts, ...route45(last, { x: pad.x, y: pad.y })] });
        return;
      }
      const t = trackAt(p, routing.layer);
      const to = { x: snap(p.x), y: snap(p.y) };
      const next = [...routing.pts, ...route45(last, to)];
      if (t && t.net === routing.net) finishRoute({ ...routing, pts: next });
      else setRouting({ ...routing, pts: next });
      return;
    }
    if (tool === 'via') {
      if (pcb.sides === 1) return; // a single-sided board has nothing to connect a via to
      const pad = padAt(p);
      const t = trackAt(p);
      const net = pad?.net ?? t?.net;
      if (net) {
        const at = pad ? { x: pad.x, y: pad.y } : { x: snap(p.x), y: snap(p.y) };
        commit({ ...pcb, vias: [...pcb.vias, { id: `v${pcb.nextId}`, x: at.x, y: at.y, dia: pcb.rules.viaDia, drill: pcb.rules.viaDrill, net }], nextId: pcb.nextId + 1 });
      }
      return;
    }
    // select
    const v = viaAt(p);
    if (v) return onSelect({ kind: 'via', id: v.id });
    const t = trackAt(p);
    if (t) return onSelect({ kind: 'track', id: t.id });
    const id = fpAt(p);
    if (id) {
      const f = pcb.fps.find((x) => x.partId === id)!;
      onSelect({ kind: 'fp', id });
      drag.current = { id, start: p, origin: { x: f.x, y: f.y }, started: false };
      return;
    }
    onSelect(null);
    pan.current = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  };

  const onMouseMove = (e: ReactMouseEvent) => {
    const drag0 = pan.current;
    if (drag0) {
      // Read the start of the drag now: the update below runs later, when the button may already be released.
      setView((v) => ({ ...v, x: drag0.vx + e.clientX - drag0.sx, y: drag0.vy + e.clientY - drag0.sy }));
      return;
    }
    const p = toMm(e);
    setCursor(p);
    const pad = padAt(p);
    const t = trackAt(p);
    onHover(pad ? `${pad.key} (${pad.name})  ${pad.net ?? ''}` : t ? `${t.net}  ${t.width} mm` : `${p.x.toFixed(2)}, ${p.y.toFixed(2)} mm`);
    const d = drag.current;
    if (d) {
      const nx = Math.round((d.origin.x + p.x - d.start.x) * 2) / 2;
      const ny = Math.round((d.origin.y + p.y - d.start.y) * 2) / 2;
      const f = pcb.fps.find((x) => x.partId === d.id);
      if (!f || (f.x === nx && f.y === ny)) return;
      if (!d.started) {
        checkpoint();
        d.started = true;
      }
      replace({ ...pcb, fps: pcb.fps.map((x) => (x.partId === d.id ? { ...x, x: nx, y: ny } : x)) });
    }
  };

  const endPointer = () => {
    drag.current = null;
    pan.current = null;
  };

  const onWheel = (e: ReactWheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setView((v) => {
      const zoom = Math.min(8, Math.max(0.15, v.zoom * Math.pow(1.1, -e.deltaY / 100)));
      const k = zoom / v.zoom;
      return { zoom, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') setRouting(null);
      else if (k === 'l' && pcb.sides !== 1) {
        const next: Layer = layer === 'top' ? 'bottom' : 'top';
        onLayer(next);
        if (routing) setRouting({ ...routing, layer: next });
      } else if (k === 'v' && routing && pcb.sides !== 1) {
        // Drop a via where the track currently ends and continue on the other layer.
        const last = routing.pts[routing.pts.length - 1];
        const next: Layer = routing.layer === 'top' ? 'bottom' : 'top';
        const withVia = { ...pcb, vias: [...pcb.vias, { id: `v${pcb.nextId}`, x: last.x, y: last.y, dia: pcb.rules.viaDia, drill: pcb.rules.viaDrill, net: routing.net }], nextId: pcb.nextId + 1 };
        const tracks = routing.pts.length >= 2 ? [...withVia.tracks, { id: `t${withVia.nextId}`, layer: routing.layer, width: pcb.rules.trackWidth, pts: routing.pts, net: routing.net }] : withVia.tracks;
        commit({ ...withVia, tracks, nextId: withVia.nextId + 1 });
        setRouting({ net: routing.net, layer: next, pts: [last] });
        onLayer(next);
      } else if (k === 'm' && selection?.kind === 'fp') {
        replace({ ...pcb, fps: pcb.fps.map((f) => (f.partId === selection.id ? { ...f, mirror: f.mirror ? undefined : true } : f)) });
        checkpoint();
      } else if ((k === 'r' || k === ' ') && selection?.kind === 'fp') {
        replace({ ...pcb, fps: pcb.fps.map((f) => (f.partId === selection.id ? { ...f, rot: ((f.rot + 90) % 360) as Rot } : f)) });
        checkpoint();
      } else if ((k === 'delete' || k === 'backspace') && selection && selection.kind !== 'fp') {
        commit(selection.kind === 'track' ? { ...pcb, tracks: pcb.tracks.filter((t) => t.id !== selection.id) } : { ...pcb, vias: pcb.vias.filter((v) => v.id !== selection.id) });
        onSelect(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (tool !== 'route') setRouting(null);
  }, [tool]);

  const refOf = useMemo(() => new Map(doc.parts.map((p) => [p.id, p.ref])), [doc.parts]);
  const b = pcb.board;
  const preview = routing && cursor ? [...routing.pts, ...route45(routing.pts[routing.pts.length - 1], { x: snap(cursor.x), y: snap(cursor.y) })] : routing?.pts;
  const color = (l: Layer): string => (l === 'top' ? TOP : BOTTOM);
  // The plane of each pour as it is drawn: halos around other nets and the pieces nothing connects to. Computed only
  // when the copper changes, not on every mouse move.
  const pourViews = useMemo(
    () =>
      (pcb.pours ?? []).map((pour) => {
        const an = analyzePour(pcb, pads, pour);
        const dead = deadIslandRuns(an, pourContacts(pcb, pads, pour, an));
        const g = an.g;
        const deadPath = dead.map((r) => `M${r.x0} ${r.y - g / 2}H${r.x1}V${r.y + g / 2}H${r.x0}Z`).join('');
        return { pour, cuts: pourCutouts(pcb, pads, pour), deadPath };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pcb.pours, pcb.tracks, pcb.vias, pcb.board, pcb.rules, pcb.sides, pads],
  );
  const marks = useMemo(() => polarityMarks(pcb, pads), [pcb.fps, pads]); // eslint-disable-line react-hooks/exhaustive-deps
  const layers: Layer[] = [showBottom ? 'bottom' : null, showTop ? 'top' : null].filter((l): l is Layer => l !== null);
  const selNet = selection?.kind === 'track' ? pcb.tracks.find((t) => t.id === selection.id)?.net : selection?.kind === 'via' ? pcb.vias.find((v) => v.id === selection.id)?.net : undefined;

  return (
    <svg
      ref={svgRef}
      className={`canvas pcb ${tool === 'route' ? 'wiring' : ''}`}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPointer}
      onMouseLeave={() => {
        endPointer();
        setCursor(null);
      }}
      onDoubleClick={() => routing && finishRoute(routing)}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${S * view.zoom})`}>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} className="board" />
        {layers.map((l) => (
          <g key={l} opacity={l === layer ? 1 : 0.55}>
            {pourViews
              .filter((v) => v.pour.layer === l)
              .map(({ pour, cuts, deadPath }) => {
                const id = `pour-${pour.id}`;
                const black = { fill: 'black', stroke: 'black' };
                return (
                  <g key={pour.id}>
                    <mask id={id} maskUnits="userSpaceOnUse" x={b.x} y={b.y} width={b.w} height={b.h}>
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="white" />
                      {cuts.map((cut, i) =>
                        cut.kind === 'round' ? (
                          <circle key={i} cx={cut.c.x} cy={cut.c.y} r={cut.d / 2} {...black} />
                        ) : cut.kind === 'stroke' ? (
                          <polyline key={i} points={cut.pts.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="black" strokeWidth={cut.width} strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <rect key={i} x={cut.c.x - cut.w / 2} y={cut.c.y - cut.h / 2} width={cut.w} height={cut.h} rx={cut.kind === 'oval' ? Math.min(cut.w, cut.h) / 2 : 0} {...black} />
                        ),
                      )}
                      {deadPath && <path d={deadPath} fill="black" />}
                    </mask>
                    <polygon points={pourOutline(pcb).map((q) => `${q.x},${q.y}`).join(' ')} fill={color(l)} opacity={0.38} mask={`url(#${id})`} className="pour" />
                  </g>
                );
              })}
            {pcb.tracks
              .filter((t) => t.layer === l)
              .map((t) => (
                <polyline
                  key={t.id}
                  points={t.pts.map((q) => `${q.x},${q.y}`).join(' ')}
                  fill="none"
                  stroke={color(l)}
                  strokeWidth={t.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={selection?.kind === 'track' && selection.id === t.id ? 'sel-track' : undefined}
                  opacity={selNet && t.net !== selNet ? 0.5 : 1}
                />
              ))}
          </g>
        ))}
        {pcb.fps.map((f) => {
          const def = footprintById(f.footprint);
          if (!def) return null;
          const sel = selection?.kind === 'fp' && selection.id === f.partId;
          const e = footprintExtent(f, def);
          return (
            <g key={f.partId}>
              <rect x={-def.body.w / 2} y={-def.body.h / 2} width={def.body.w} height={def.body.h} transform={`translate(${f.x} ${f.y}) rotate(${f.rot})`} className={`silk ${sel ? 'sel' : ''}`} />
              <text x={f.x} y={f.y - e.h / 2 - 0.4} className="ref" textAnchor="middle">
                {refOf.get(f.partId)}
              </text>
            </g>
          );
        })}
        {pads.map((p) => {
          const dim = (p.smd && !showTop) || (!p.smd && !showTop && !showBottom);
          const fill = p.smd ? TOP : '#c9a227';
          return (
            <g key={p.key} opacity={dim ? 0.2 : 1} className={selNet && p.net === selNet ? 'net-hot' : undefined}>
              {p.shape === 'round' ? (
                <circle cx={p.x} cy={p.y} r={p.w / 2} fill={fill} />
              ) : (
                <rect x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={p.shape === 'oval' ? Math.min(p.w, p.h) / 2 : 0} fill={fill} />
              )}
              {p.drill > 0 && <circle cx={p.x} cy={p.y} r={p.drill / 2} className="hole" />}
              <title>{`${p.key} (${p.name}) ${p.net ?? ''}`}</title>
            </g>
          );
        })}
        {pcb.vias.map((v) => (
          <g key={v.id} className={selection?.kind === 'via' && selection.id === v.id ? 'sel-via' : undefined}>
            <circle cx={v.x} cy={v.y} r={v.dia / 2} fill="#4caf50" />
            <circle cx={v.x} cy={v.y} r={v.drill / 2} className="hole" />
          </g>
        ))}
        {marks.map((m, i) => (
          <polyline key={`mark${i}`} points={m.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#e9eef5" strokeWidth={0.2} strokeLinecap="round" pointerEvents="none" />
        ))}
        {airwires.map((w, i) => (
          <line key={i} x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} className="airwire" />
        ))}
        {issues.map((i, k) => (
          <circle key={k} cx={i.x} cy={i.y} r={0.9} className="drc-mark" />
        ))}
        {preview && <polyline points={preview.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={color(routing!.layer)} strokeWidth={pcb.rules.trackWidth} strokeLinecap="round" strokeLinejoin="round" opacity={0.7} />}
      </g>
    </svg>
  );
}
