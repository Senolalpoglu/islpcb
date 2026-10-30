import { useEffect, useRef, useState } from 'react';
import type { Solution } from '../../core/sim/solver';
import { useI18n } from '../i18n';
import { PART_DEFS, isMcu, setLabelOffset, paramLabel, partLabel, pinPositions, transformPartWithWires, type Doc, type Part } from '../editor/model';
import type { Extracted } from '../editor/netlist';
import type { Selection } from '../editor/SchematicCanvas';
import { eng, parseEng } from '../editor/units';
import { parseLayout } from '../../core/mcu/nextion';
import { NEXTION_TYPE } from '../sim/rig';
import { ProgramPanel } from './ProgramPanel';

interface Props {
  doc: Doc;
  selection: Selection;
  extracted: Extracted;
  solution: Solution | null;
  onChange: (d: Doc) => void;
  onDelete: () => void;
}

const WIDTH_KEY = 'snl.propsWidth';
const MIN_WIDTH = 220;
const MAX_WIDTH = 1000;
const DEFAULT_WIDTH = 260;

const clampWidth = (w: number): number => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(w)));

/** Like the library on the other side, the properties column is sized by a CSS variable on the workspace grid. */
function applyWidth(w: number): void {
  document.documentElement.style.setProperty('--props-w', `${w}px`);
}

function storedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
  } catch {
    /* storage unavailable: use the default */
  }
  return DEFAULT_WIDTH;
}

/** Shows plain numbers for everyday magnitudes and an SI prefix otherwise ("10 µ", "4.7 k"). */
export function formatNumber(v: number): string {
  const a = Math.abs(v);
  if (a === 0 || (a >= 0.1 && a < 1000)) return String(+v.toPrecision(6));
  return eng(v, '').trim();
}

export function NumberField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(formatNumber(value));
  useEffect(() => setText(formatNumber(value)), [value]);
  const apply = () => {
    const v = parseEng(text);
    if (v === null) setText(formatNumber(value));
    else if (v !== value) onCommit(v);
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      spellCheck={false}
    />
  );
}

export function PropertiesPanel({ doc, selection, extracted, solution, onChange, onDelete }: Props) {
  const { t, lang } = useI18n();
  const part = selection?.kind === 'part' ? doc.parts.find((p) => p.id === selection.id) : undefined;

  const update = (id: string, patch: (p: Part) => Part) => onChange({ ...doc, parts: doc.parts.map((p) => (p.id === id ? patch(p) : p)) });

  // The width the user chose last time; dragging the left edge widens the column (the program text needs room).
  const panel = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    applyWidth(storedWidth());
  }, []);
  const setWidth = (w: number, save: boolean) => {
    const width = clampWidth(w);
    applyWidth(width);
    if (!save) return;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      /* the width only lasts for this session */
    }
  };
  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const right = panel.current?.getBoundingClientRect().right ?? 0;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.classList.add('lib-resizing');
    const startX = e.clientX;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return; // a plain click must not nudge the width
      moved = true;
      setWidth(right - ev.clientX, false);
    };
    const up = (ev: PointerEvent) => {
      if (moved) setWidth(right - ev.clientX, true);
      setDragging(false);
      document.body.classList.remove('lib-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <aside className="panel props" ref={panel}>
      <div
        className={`props-resize ${dragging ? 'dragging' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t('props.resize')}
        tabIndex={0}
        title={t('props.resize')}
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH, true)}
        onKeyDown={(e) => {
          const now = panel.current?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
          if (e.key === 'ArrowLeft') setWidth(now + 20, true);
          else if (e.key === 'ArrowRight') setWidth(now - 20, true);
        }}
      />
      <h2>{t('panel.properties')}</h2>
      {selection?.kind === 'many' ? (
        <>
          <p>{t('panel.many', { n: selection.parts.length, m: selection.wires.length })}</p>
          <p className="muted">{t('panel.manyHint')}</p>
          <div className="btn-row">
            <button className="danger" onClick={onDelete}>
              {t('prop.delete')}
            </button>
          </div>
        </>
      ) : !part ? (
        <p className="muted">{t('panel.nothing')}</p>
      ) : (
        <>
          <div className="title-row">
            <strong>{part.ref}</strong>
            <span className="muted">{partLabel(PART_DEFS[part.type], t, lang)}</span>
          </div>
          <label className="field">
            <span>{t('prop.ref')}</span>
            <input value={part.ref} onChange={(e) => update(part.id, (p) => ({ ...p, ref: e.target.value }))} spellCheck={false} />
          </label>
          {PART_DEFS[part.type].params.map((def) => (
            <label className="field" key={def.name}>
              <span>{paramLabel(def, t, lang)}</span>
              {def.kind === 'number' ? (
                <NumberField value={part.params[def.name] as number} onCommit={(v) => update(part.id, (p) => ({ ...p, params: { ...p.params, [def.name]: v } }))} />
              ) : def.kind === 'bool' ? (
                <input type="checkbox" checked={part.params[def.name] === true} onChange={(e) => update(part.id, (p) => ({ ...p, params: { ...p.params, [def.name]: e.target.checked } }))} />
              ) : (
                <input value={String(part.params[def.name] ?? '')} onChange={(e) => update(part.id, (p) => ({ ...p, params: { ...p.params, [def.name]: e.target.value } }))} spellCheck={false} />
              )}
            </label>
          ))}
          {part.type === NEXTION_TYPE && (
            <label className="field">
              <span>{t('nx.loadLayout')}</span>
              <input
                type="file"
                accept=".json,.tft,.hmi"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  // A .tft or .HMI file is Nextion's closed binary format: not readable here.
                  if (/\.(tft|hmi)$/i.test(file.name)) return void alert(t('nx.tftHint'));
                  const text = await file.text();
                  const r = parseLayout(text);
                  if (r.error) return void alert(t('nx.layoutError', { error: r.error }));
                  update(part.id, (p) => ({ ...p, params: { ...p.params, layout: JSON.stringify(JSON.parse(text)) } }));
                }}
              />
            </label>
          )}
          {isMcu(part.type) && <ProgramPanel part={part} onParams={(patch) => update(part.id, (p) => ({ ...p, params: { ...p.params, ...patch } }))} />}
          <div className="btn-row">
            <button title="Space / R" onClick={() => onChange(transformPartWithWires(doc, part.id, { rot: ((part.rot + 90) % 360) as Part['rot'] }))}>
              {t('prop.rotate')}
            </button>
            {part.labels && (
              <button title={t('prop.resetLabels')} onClick={() => onChange((['ref', 'val', 'name'] as const).reduce((d, k) => setLabelOffset(d, part.id, k, null), doc))}>
                {t('prop.resetLabels')}
              </button>
            )}
            <button title="M" onClick={() => onChange(transformPartWithWires(doc, part.id, { mirror: !part.mirror }))}>
              {t('prop.mirror')}
            </button>
            <button className="danger" onClick={onDelete}>
              {t('prop.delete')}
            </button>
          </div>
          <h2>{t('panel.measure')}</h2>
          <Measurements part={part} extracted={extracted} solution={solution} />
        </>
      )}
    </aside>
  );
}

function Measurements({ part, extracted, solution }: { part: Part; extracted: Extracted; solution: Solution | null }) {
  const { t } = useI18n();
  if (!solution) return <p className="muted">{t('meas.notRunning')}</p>;
  const def = PART_DEFS[part.type];
  const pins = pinPositions(part);
  const isElement = extracted.elementIds.has(part.id);
  const va = solution.v[extracted.nodeOfPin.get(`${part.id}:0`) ?? 0];
  const vb = pins.length > 1 ? solution.v[extracted.nodeOfPin.get(`${part.id}:1`) ?? 0] : undefined;
  return (
    <table className="meas">
      <tbody>
        {isElement && pins.length === 3 && (
          <>
            {pins.map((_, i) => (
              <tr key={`i${i}`}>
                <td>{t('meas.pinCurrent', { n: def.pinNames[i] })}</td>
                <td>{eng(solution.terminals[part.id]?.[i] ?? 0, 'A')}</td>
              </tr>
            ))}
            <tr>
              <td>{t('meas.power')}</td>
              <td>{eng(solution.p[part.id], 'W')}</td>
            </tr>
          </>
        )}
        {isElement && pins.length === 2 && vb !== undefined && (
          <>
            <tr>
              <td>{t('meas.voltage')}</td>
              <td>{eng(va - vb, 'V')}</td>
            </tr>
            <tr>
              <td>{t('meas.current')}</td>
              <td>{eng(solution.i[part.id], 'A')}</td>
            </tr>
            <tr>
              <td>{t('meas.power')}</td>
              <td>{eng(solution.p[part.id], 'W')}</td>
            </tr>
          </>
        )}
        {pins.map((_, i) => (
          <tr key={i}>
            <td>
              {t('meas.pin', { n: def.pinNames[i] })}
            </td>
            <td>{eng(solution.v[extracted.nodeOfPin.get(`${part.id}:${i}`) ?? 0], 'V')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
