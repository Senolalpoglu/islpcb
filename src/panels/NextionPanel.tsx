// The screen of the virtual Nextion display: what it shows now, whether it has power and is wired to a board, the
// instructions it got, and its touch screen (a mouse press on a button sends the touch event to the board).

import { useEffect, useRef, useState } from 'react';
import { cssColor, fontPixels, type NextionDisplay, type NxComponent } from '../../core/mcu/nextion';
import { useI18n } from '../i18n';

interface Props {
  displays: Array<{ display: NextionDisplay; layoutError: string; partId: string }>;
  running: boolean;
  /** Whether the circuit has a display part at all. */
  present: boolean;
  onTouch: (index: number, component: number, pressed: boolean) => void;
}

function Piece({ c, id, pressed }: { c: NxComponent; id: number; pressed: boolean }) {
  const common = { left: c.x, top: c.y, width: c.w, height: c.h };
  const size = fontPixels(c.font);
  const text = { color: cssColor(c.pco), fontSize: Math.min(size, c.h), lineHeight: `${c.h}px` };
  if (c.type === 'progress') {
    return (
      <div className="nx-comp nx-progress" style={{ ...common, background: cssColor(c.bco) }} data-id={id}>
        <div style={{ width: `${Math.max(0, Math.min(100, c.val))}%`, background: cssColor(c.pco) }} />
      </div>
    );
  }
  const label = c.type === 'number' ? String(c.val) : c.txt;
  return (
    <div
      className={`nx-comp nx-${c.type}${pressed ? ' nx-pressed' : ''}${c.tsw ? ' nx-touch' : ''}`}
      style={{ ...common, ...text, background: cssColor(c.bco), textAlign: c.type === 'button' ? 'center' : 'left' }}
      data-id={id}
    >
      {label}
    </div>
  );
}

function Screen({ index, d, layoutError, onTouch }: { index: number; d: NextionDisplay; layoutError: string; onTouch: Props['onTouch'] }) {
  const { t } = useI18n();
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const { width, height } = d.layout;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1.5, Math.max(0.2, Math.min(el.clientWidth / width, (el.clientHeight || 260) / height))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);
  const page = d.current;
  const held = useRef<number | null>(null);
  const release = () => {
    if (held.current !== null) onTouch(index, held.current, false);
    held.current = null;
  };

  return (
    <div className="nx">
      <div className="nx-status">
        <span className={d.powered ? 'com-on' : 'muted'}>{d.powered ? t('nx.powered') : t('nx.noPower')}</span>
        <span className={d.linkedRx ? 'com-on' : 'muted'}>{d.linkedRx ? t('nx.rxOk') : t('nx.rxMissing')}</span>
        <span className={d.linkedTx ? 'com-on' : 'muted'}>{d.linkedTx ? t('nx.txOk') : t('nx.txMissing')}</span>
        <span className="muted">
          {t('nx.page')} {d.page + 1}/{d.pageCount}
        </span>
        {layoutError && <span className="com-bad">{t('nx.layoutError', { error: layoutError })}</span>}
      </div>
      <div className="nx-body">
        <div ref={wrap} className="nx-wrap">
          <div
            className="nx-screen"
            style={{ width, height, transform: `scale(${scale})`, background: cssColor(page.bco), opacity: d.powered ? 1 : 0.25 }}
            onMouseUp={release}
            onMouseLeave={release}
          >
            {page.components.map((c, i) =>
              c.vis ? (
                <div
                  key={`${d.page}-${c.name}`}
                  onMouseDown={() => {
                    if (!c.tsw) return;
                    held.current = i + 1;
                    onTouch(index, i + 1, true);
                  }}
                  style={{ display: 'contents' }}
                >
                  <Piece c={c} id={i + 1} pressed={d.pressed === i + 1} />
                </div>
              ) : null,
            )}
          </div>
        </div>
        <pre className="nx-log">{d.history.length ? d.history.slice(-14).join('\n') : t('nx.noCommands')}</pre>
      </div>
    </div>
  );
}

export function NextionPanel({ displays, running, present, onTouch }: Props) {
  const { t } = useI18n();
  return (
    <section className="panel nextion">
      <div className="scope-head">
        <h2>{t('nx.title')}</h2>
      </div>
      {!present ? (
        <p className="muted">{t('nx.none')}</p>
      ) : !running || displays.length === 0 ? (
        <p className="muted">{t('nx.press')}</p>
      ) : (
        displays.map((s, i) => <Screen key={s.partId} index={i} d={s.display} layoutError={s.layoutError} onTouch={onTouch} />)
      )}
    </section>
  );
}
