import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { PROBE_COLORS } from '../editor/symbols';
import { eng } from '../editor/units';
import type { Doc } from '../editor/model';
import type { ScopeData, Trace } from '../sim/useSimulation';

interface Props {
  doc: Doc;
  scope: ScopeData;
  traces: Trace[];
  frame: number;
  /** Visible time window in seconds. */
  window: number;
}

const css = (name: string, fallback: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function ScopePanel({ doc, scope, traces, frame, window: win }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
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

    const padL = 52;
    const padB = 18;
    const plotW = w - padL - 8;
    const plotH = h - padB - 8;
    g.strokeStyle = css('--scope-grid', '#1f2a37');
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 10; i++) {
      const x = padL + (plotW * i) / 10;
      g.moveTo(x, 8);
      g.lineTo(x, 8 + plotH);
    }
    for (let i = 0; i <= 8; i++) {
      const y = 8 + (plotH * i) / 8;
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
    }
    g.stroke();

    const n = scope.t.length;
    if (n < 2 || traces.length === 0) return;
    const tEnd = scope.t[n - 1];
    // The trace grows from t = 0 until the window is full, then scrolls.
    const tLeft = Math.max(0, tEnd - win);
    const tStart = tLeft;
    let first = 0;
    while (first < n - 1 && scope.t[first] < tStart) first++;

    let lo = Infinity;
    let hi = -Infinity;
    for (const tr of traces) {
      const arr = scope.v.get(tr.partId);
      if (!arr) continue;
      for (let i = first; i < n; i++) {
        lo = Math.min(lo, arr[i]);
        hi = Math.max(hi, arr[i]);
      }
    }
    if (!Number.isFinite(lo)) return;
    if (hi - lo < 1e-9) {
      hi += 0.5;
      lo -= 0.5;
    }
    const margin = (hi - lo) * 0.08;
    lo -= margin;
    hi += margin;
    const X = (tt: number): number => padL + ((tt - tLeft) / win) * plotW;
    const Y = (v: number): number => 8 + plotH - ((v - lo) / (hi - lo)) * plotH;

    g.fillStyle = css('--muted', '#8b98a9');
    g.font = '11px "Segoe UI", sans-serif';
    g.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) * i) / 4;
      g.fillText(eng(v, 'V', 3), padL - 6, Y(v) + 4);
    }
    g.textAlign = 'center';
    for (let i = 0; i <= 5; i++) {
      g.fillText(eng(tLeft + (win * i) / 5, 's', 3), padL + (plotW * i) / 5, h - 4);
    }

    const probes = doc.parts.filter((p) => p.type === 'PROBE');
    g.lineWidth = 1.6;
    traces.forEach((tr, idx) => {
      const arr = scope.v.get(tr.partId);
      if (!arr) return;
      g.strokeStyle = PROBE_COLORS[idx % PROBE_COLORS.length];
      g.beginPath();
      for (let i = first; i < n; i++) {
        const x = X(scope.t[i]);
        const y = Y(arr[i]);
        if (i === first) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      void probes;
    });
  }, [frame, scope, traces, win, doc.parts]);

  return (
    <section className="panel scope">
      <div className="scope-head">
        <div className="legend">
          {traces.map((tr, i) => {
            const part = doc.parts.find((p) => p.id === tr.partId);
            const arr = scope.v.get(tr.partId);
            const last = arr && arr.length > 0 ? arr[arr.length - 1] : undefined;
            const name = String(part?.params.label || part?.ref || '');
            return (
              <span key={tr.partId} style={{ color: PROBE_COLORS[i % PROBE_COLORS.length] }}>
                ● {name}
                {last !== undefined && ` ${eng(last, 'V')}`}
              </span>
            );
          })}
        </div>
      </div>
      {traces.length === 0 && <p className="muted scope-empty">{t('scope.empty')}</p>}
      <canvas ref={ref} className="scope-canvas" />
    </section>
  );
}
