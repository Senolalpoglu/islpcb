import { footprintById } from '../../core/pcb/footprints';
import type { DrcIssue } from '../../core/pcb/drc';
import type { AirWire } from '../../core/pcb/ratsnest';
import type { Layer, PcbDoc, Pt, Rot, Rules } from '../../core/pcb/types';
import { useState } from 'react';
import { useI18n, type Key } from '../i18n';
import type { Doc } from '../editor/model';
import { PART_DEFS } from '../editor/model';
import { NumberField } from '../panels/PropertiesPanel';
import type { PcbSelection } from './PcbCanvas';
import { footprintChoices } from './sync';

interface Props {
  doc: Doc;
  pcb: PcbDoc;
  selection: PcbSelection;
  airwires: AirWire[];
  /** Names of the nets on the board, for the copper pour. */
  nets: string[];
  issues: DrcIssue[] | null;
  message: string;
  busy: boolean;
  onPcb: (p: PcbDoc) => void;
  onSync: () => void;
  onRoute: () => void;
  onLayout: () => void;
  onClear: () => void;
  onDrc: () => void;
  onExport: () => void;
  onFocus: (p: Pt) => void;
}

const RULE_FIELDS: Array<[keyof Rules, Key]> = [
  ['clearance', 'pcb.clearance'],
  ['trackWidth', 'pcb.trackWidth'],
  ['viaDia', 'pcb.viaDia'],
  ['viaDrill', 'pcb.viaDrill'],
  ['edgeClearance', 'pcb.edge'],
];

export function PcbPanel({ doc, pcb, selection, airwires, nets, issues, message, busy, onPcb, onSync, onRoute, onLayout, onClear, onDrc, onExport, onFocus }: Props) {
  const { t } = useI18n();
  const [pourNet, setPourNet] = useState('GND');
  const [pourLayer, setPourLayer] = useState<Layer>('bottom');
  const fp = selection?.kind === 'fp' ? pcb.fps.find((f) => f.partId === selection.id) : undefined;
  const part = fp ? doc.parts.find((p) => p.id === fp.partId) : undefined;
  const track = selection?.kind === 'track' ? pcb.tracks.find((x) => x.id === selection.id) : undefined;
  const via = selection?.kind === 'via' ? pcb.vias.find((v) => v.id === selection.id) : undefined;
  const def = fp ? footprintById(fp.footprint) : undefined;
  const basePad = def ? Math.min(...def.pads.map((p) => Math.min(p.w, p.h))) : 0;
  const baseDrill = def ? Math.max(0, ...def.pads.map((p) => p.drill)) : 0;

  const setFp = (patch: Partial<NonNullable<typeof fp>>) => onPcb({ ...pcb, fps: pcb.fps.map((f) => (f.partId === fp!.partId ? { ...f, ...patch } : f)) });

  return (
    <aside className="panel props">
      <div className="btn-col">
        <button onClick={onSync}>{t('pcb.update')}</button>
        <button className="run" onClick={onLayout} disabled={busy || doc.parts.length === 0}>
          {t('pcb.autolayout')}
        </button>
        <button onClick={onRoute} disabled={busy || pcb.fps.length === 0}>
          {t('pcb.autoroute')}
        </button>
        <button onClick={onClear} disabled={pcb.tracks.length + pcb.vias.length === 0}>
          {t('pcb.clear')}
        </button>
        <button title={t('pcb.lockHint')} onClick={() => onPcb({ ...pcb, fps: pcb.fps.map((f) => ({ ...f, locked: pcb.fps.every((x) => x.locked) ? undefined : true })) })} disabled={pcb.fps.length === 0}>
          {pcb.fps.length > 0 && pcb.fps.every((f) => f.locked) ? t('pcb.unlockAll') : t('pcb.lockAll')}
        </button>
        <button onClick={onDrc}>{t('pcb.drc')}</button>
        <button onClick={onExport} disabled={pcb.fps.length === 0}>
          {t('pcb.export')}
        </button>
      </div>
      {pcb.fps.length === 0 && <p className="muted small">{t('pcb.empty')}</p>}
      {message && <p className="small">{message}</p>}
      <p className="muted small">
        {t('pcb.unrouted')}: {airwires.length} · {t('pcb.stats', { t: pcb.tracks.length, v: pcb.vias.length })}
      </p>

      {fp && part && def && (
        <>
          <h2>{part.ref}</h2>
          <label className="field">
            <span>{t('pcb.footprint')}</span>
            <select value={fp.footprint} onChange={(e) => setFp({ footprint: e.target.value })}>
              {(footprintChoices(part.type).includes(fp.footprint) ? footprintChoices(part.type) : [fp.footprint, ...footprintChoices(part.type)]).map((id) => (
                <option key={id} value={id}>
                  {footprintById(id)?.label ?? id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              {t('pcb.padSize')} ({t('pcb.default')} {basePad.toFixed(2)})
            </span>
            <NumberField value={fp.padSize ?? basePad} onCommit={(v) => setFp({ padSize: v > 0 ? v : undefined })} />
          </label>
          {baseDrill > 0 && (
            <label className="field">
              <span>
                {t('pcb.drill')} ({t('pcb.default')} {baseDrill.toFixed(2)})
              </span>
              <NumberField value={fp.drill ?? baseDrill} onCommit={(v) => setFp({ drill: v > 0 ? v : undefined })} />
            </label>
          )}
          <div className="btn-row">
            <button onClick={() => setFp({ rot: ((fp.rot + 90) % 360) as Rot })}>{t('pcb.rotate')}</button>
            <button title={t('pcb.mirrorHint')} className={fp.mirror ? 'on' : ''} onClick={() => setFp({ mirror: fp.mirror ? undefined : true })}>
              {t('pcb.mirror')}
            </button>
          </div>
          <div className="btn-row">
            <button title={t('pcb.lockHint')} className={fp.locked ? 'on' : ''} onClick={() => setFp({ locked: fp.locked ? undefined : true })}>
              {fp.locked ? '🔒 ' : ''}
              {t('pcb.lock')}
            </button>
          </div>
          <p className="muted small">{PART_DEFS[part.type] ? t(PART_DEFS[part.type].label) : ''}</p>
        </>
      )}

      {track && (
        <>
          <h2>{t('pcb.track')}</h2>
          <p className="small">
            {t('pcb.net')}: {track.net}
          </p>
          <label className="field">
            <span>{t('pcb.trackWidth')}</span>
            <NumberField value={track.width} onCommit={(v) => v > 0 && onPcb({ ...pcb, tracks: pcb.tracks.map((x) => (x.id === track.id ? { ...x, width: v } : x)) })} />
          </label>
          <div className="btn-row">
            <button className="danger" onClick={() => onPcb({ ...pcb, tracks: pcb.tracks.filter((x) => x.id !== track.id) })}>
              {t('pcb.delete')}
            </button>
          </div>
        </>
      )}

      {via && (
        <>
          <h2>{t('pcb.via')}</h2>
          <p className="small">
            {t('pcb.net')}: {via.net}
          </p>
          <label className="field">
            <span>{t('pcb.viaDia')}</span>
            <NumberField value={via.dia} onCommit={(v) => v > 0 && onPcb({ ...pcb, vias: pcb.vias.map((x) => (x.id === via.id ? { ...x, dia: v } : x)) })} />
          </label>
          <label className="field">
            <span>{t('pcb.viaDrill')}</span>
            <NumberField value={via.drill} onCommit={(v) => v > 0 && onPcb({ ...pcb, vias: pcb.vias.map((x) => (x.id === via.id ? { ...x, drill: v } : x)) })} />
          </label>
          <div className="btn-row">
            <button className="danger" onClick={() => onPcb({ ...pcb, vias: pcb.vias.filter((x) => x.id !== via.id) })}>
              {t('pcb.delete')}
            </button>
          </div>
        </>
      )}

      <h2>{t('pcb.board')}</h2>
      <label className="field">
        <span>{t('pcb.sides')}</span>
        <select
          value={pcb.sides === 1 ? '1' : '2'}
          onChange={(e) => {
            const sides = e.target.value === '1' ? 1 : 2;
            // Going single-sided drops what lived on the top side: its tracks and every via.
            onPcb(sides === 1 ? { ...pcb, sides, tracks: pcb.tracks.filter((x) => x.layer === 'bottom'), vias: [] } : { ...pcb, sides });
          }}
        >
          <option value="2">{t('pcb.sides.2')}</option>
          <option value="1">{t('pcb.sides.1')}</option>
        </select>
      </label>
      <label className="field">
        <span>{t('pcb.width')}</span>
        <NumberField value={pcb.board.w} onCommit={(v) => v > 5 && onPcb({ ...pcb, board: { ...pcb.board, w: v } })} />
      </label>
      <label className="field">
        <span>{t('pcb.height')}</span>
        <NumberField value={pcb.board.h} onCommit={(v) => v > 5 && onPcb({ ...pcb, board: { ...pcb.board, h: v } })} />
      </label>

      <h2>{t('pcb.pour')}</h2>
      <p className="muted small">{t('pcb.pour.hint')}</p>
      {(pcb.pours ?? []).map((pour) => (
        <div className="btn-row" key={pour.id}>
          <span className="small grow">
            {pour.net} · {t(pour.layer === 'top' ? 'pcb.layer.top' : 'pcb.layer.bottom')}
          </span>
          <button className="danger" onClick={() => onPcb({ ...pcb, pours: (pcb.pours ?? []).filter((x) => x.id !== pour.id) })}>
            {t('pcb.delete')}
          </button>
        </div>
      ))}
      <label className="field">
        <span>{t('pcb.pour.net')}</span>
        <select value={nets.includes(pourNet) ? pourNet : (nets[0] ?? '')} onChange={(e) => setPourNet(e.target.value)}>
          {nets.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {pcb.sides !== 1 && (
        <label className="field">
          <span>{t('pcb.pour.layer')}</span>
          <select value={pourLayer} onChange={(e) => setPourLayer(e.target.value as Layer)}>
            <option value="bottom">{t('pcb.layer.bottom')}</option>
            <option value="top">{t('pcb.layer.top')}</option>
          </select>
        </label>
      )}
      <div className="btn-row">
        <button
          disabled={nets.length === 0}
          onClick={() => {
            const net = nets.includes(pourNet) ? pourNet : nets[0];
            const layer: Layer = pcb.sides === 1 ? 'bottom' : pourLayer;
            if (!net || (pcb.pours ?? []).some((x) => x.net === net && x.layer === layer)) return;
            onPcb({ ...pcb, pours: [...(pcb.pours ?? []), { id: `p${pcb.nextId}`, layer, net }], nextId: pcb.nextId + 1 });
          }}
        >
          {t('pcb.pour.add')}
        </button>
      </div>

      <h2>{t('pcb.rules')}</h2>
      {RULE_FIELDS.map(([key, label]) => (
        <label className="field" key={key}>
          <span>{t(label)}</span>
          <NumberField value={pcb.rules[key]} onCommit={(v) => v > 0 && onPcb({ ...pcb, rules: { ...pcb.rules, [key]: v } })} />
        </label>
      ))}

      {issues && (
        <>
          <h2>{t('pcb.issues')}</h2>
          {issues.length === 0 ? (
            <p className="small drc-ok">{t('pcb.noIssues')}</p>
          ) : (
            <ul className="drc-list">
              {issues.slice(0, 60).map((i, k) => (
                <li key={k} onClick={() => onFocus({ x: i.x, y: i.y })} className={i.kind}>
                  {i.message}
                </li>
              ))}
              {issues.length > 60 && <li className="muted">… {issues.length - 60}</li>}
            </ul>
          )}
        </>
      )}
    </aside>
  );
}
