import { useEffect, useRef } from 'react';
import type { Solution } from '../../core/sim/solver';
import { useI18n } from '../i18n';
import { isSwitchPart, partState } from '../editor/explain';
import type { Doc } from '../editor/model';
import type { Extracted } from '../editor/netlist';
import { eng } from '../editor/units';

interface Props {
  doc: Doc;
  extracted: Extracted;
  solution: Solution | null;
  /** Simulated time of `solution`, in seconds. */
  time: number;
}

/** Samples kept; the oldest fall off the left edge. */
const MAX_SAMPLES = 1500;
const ROW = 26;
const LABEL_W = 70;

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

interface Rec {
  t: number[];
  /** On / off per sample, by part id. */
  rows: Map<string, boolean[]>;
}

/**
 * ON / OFF of the switches, lamps, LEDs, relays and motors over the simulated time, one row each, drawn as a step
 * line like a logic analyser. A switch you click shows up as a step in its row.
 */
export function TimingPanel({ doc, extracted, solution, time }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const rec = useRef<Rec>({ t: [], rows: new Map() });

  useEffect(() => {
    const r = rec.current;
    if (!solution) {
      r.t = [];
      r.rows = new Map();
    } else {
      // Time running backwards means a restart: begin a new record.
      if (r.t.length && time < r.t[r.t.length - 1]) {
        r.t = [];
        r.rows = new Map();
      }
      const states = new Map<string, boolean>();
      for (const p of doc.parts) {
        const st = partState(p, solution, extracted);
        if (st.on !== null) states.set(p.id, st.on);
      }
      // The same instant again (a switch clicked while paused) replaces the last sample instead of adding one.
      const same = r.t.length > 0 && r.t[r.t.length - 1] === time;
      if (same) r.t.pop();
      else if (r.t.length >= MAX_SAMPLES) {
        r.t.shift();
        for (const a of r.rows.values()) a.shift();
      }
      for (const [id, on] of states) {
        let a = r.rows.get(id);
        if (!a) {
          // A part that appeared later is OFF in the samples before it.
          a = new Array(r.t.length).fill(false);
          r.rows.set(id, a);
        }
        if (same) a.pop();
        a.push(on);
      }
      r.t.push(time);
      // A part that has no state now (it was deleted) stays OFF so every row keeps the length of the time axis.
      for (const a of r.rows.values()) if (a.length < r.t.length) a.push(false);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, solution, doc.parts]);

  const draw = () => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = css('--scope-bg', '#0d1117');
    g.fillRect(0, 0, w, h);
    const r = rec.current;
    const parts = doc.parts.filter((p) => r.rows.has(p.id)).sort((a, b) => Number(isSwitchPart(b)) - Number(isSwitchPart(a)));
    if (r.t.length < 2 || parts.length === 0) return;
    const grid = css('--scope-grid', '#1f2a37');
    const text = css('--muted', '#8b98a9');
    const on = css('--accent', '#2dd4a8');
    const t0 = r.t[0];
    const span = Math.max(r.t[r.t.length - 1] - t0, 1e-12);
    const plotW = w - LABEL_W - 8;
    const x = (tt: number): number => LABEL_W + ((tt - t0) / span) * plotW;
    g.font = '11px sans-serif';
    parts.slice(0, Math.floor((h - 18) / ROW)).forEach((p, k) => {
      const y0 = 4 + k * ROW;
      const hi = y0 + 4;
      const lo = y0 + ROW - 8;
      const a = r.rows.get(p.id)!;
      g.strokeStyle = grid;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(LABEL_W, lo + 0.5);
      g.lineTo(w - 8, lo + 0.5);
      g.stroke();
      g.fillStyle = text;
      g.textBaseline = 'middle';
      g.fillText(p.ref, 6, y0 + ROW / 2 - 2);
      // The step line, with the ON stretches filled.
      g.beginPath();
      g.moveTo(x(r.t[0]), a[0] ? hi : lo);
      for (let n = 1; n < r.t.length; n++) {
        g.lineTo(x(r.t[n]), a[n - 1] ? hi : lo);
        g.lineTo(x(r.t[n]), a[n] ? hi : lo);
      }
      g.strokeStyle = on;
      g.lineWidth = 1.6;
      g.stroke();
      g.globalAlpha = 0.18;
      g.fillStyle = on;
      for (let n = 1; n < r.t.length; n++) if (a[n - 1]) g.fillRect(x(r.t[n - 1]), hi, Math.max(1, x(r.t[n]) - x(r.t[n - 1])), lo - hi);
      g.globalAlpha = 1;
    });
    g.fillStyle = text;
    g.textBaseline = 'alphabetic';
    g.fillText(eng(t0, 's'), LABEL_W, h - 4);
    g.textAlign = 'right';
    g.fillText(eng(r.t[r.t.length - 1], 's'), w - 8, h - 4);
    g.textAlign = 'left';
  };

  const empty = rec.current.rows.size === 0;
  return (
    <section className="panel scope">
      <div className="scope-head">
        <span className="muted">{t('timing.hint')}</span>
      </div>
      {empty && <p className="muted scope-empty">{t('timing.empty')}</p>}
      <canvas ref={ref} className="scope-canvas" />
    </section>
  );
}
