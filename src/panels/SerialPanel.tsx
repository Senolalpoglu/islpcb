// The serial monitor, in the manner of the Arduino IDE: pick a baud rate, connect, watch what comes in, type a message,
// choose the line ending and send. It has two views: the simulated board's own serial port, and a real COM port.

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { BAUD_RATES, LINE_ENDINGS, encodeMessage, formatTraffic, type ComBridge, type LineEnding } from '../sim/comPort';
import type { PortChoice } from '../sim/useComPort';

interface Props {
  /** What the simulated board printed. */
  text: string;
  /** Sends bytes to the simulated board's serial input. */
  onSendBytes: (bytes: Uint8Array) => void;
  onClear: () => void;
  /** The real COM port: its bridge, the ports to choose from while a choice is pending, the baud rate and the link to the board. */
  com: {
    bridge: ComBridge;
    choices: PortChoice[] | null;
    pick: (id: string) => void;
    baud: number;
    onBaud: (b: number) => void;
    running: boolean;
    linked: boolean;
    onLink: (on: boolean) => void;
  };
}

const ENDING_KEYS: Record<LineEnding, 'serial.end.none' | 'serial.end.lf' | 'serial.end.cr' | 'serial.end.crlf' | 'serial.end.nextion'> = {
  none: 'serial.end.none',
  lf: 'serial.end.lf',
  cr: 'serial.end.cr',
  crlf: 'serial.end.crlf',
  nextion: 'serial.end.nextion',
};

export function SerialPanel({ text, onSendBytes, onClear, com }: Props) {
  const { t } = useI18n();
  const b = com.bridge;
  const [view, setView] = useState<'board' | 'com'>('board');
  const [line, setLine] = useState('');
  const [ending, setEnding] = useState<LineEnding>('lf');
  const [hexInput, setHexInput] = useState(false);
  const [hexView, setHexView] = useState(false);
  const [problem, setProblem] = useState('');
  const box = useRef<HTMLPreElement>(null);

  const shown = view === 'board' ? text : formatTraffic(b.log, hexView);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const canSend = view === 'board' || b.state === 'open';
  const send = () => {
    const m = encodeMessage(line, ending, hexInput);
    if ('error' in m) {
      setProblem(t('serial.badHex', { word: m.error }));
      return;
    }
    setProblem('');
    if (view === 'board') onSendBytes(m.bytes);
    else if (!b.write(m.bytes)) return;
    setLine('');
  };

  return (
    <section className="panel serial">
      <div className="scope-head">
        <h2>{t('panel.serial')}</h2>
        <div className="serial-tabs">
          <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
            {t('serial.board')}
          </button>
          {b.available && (
            <button className={view === 'com' ? 'on' : ''} onClick={() => setView('com')}>
              {t('serial.com')}
            </button>
          )}
        </div>
        <button onClick={view === 'board' ? onClear : () => b.clearLog()}>{t('serial.clear')}</button>
      </div>
      {view === 'com' && b.available && (
        <>
          <div className="com-row">
            <span className="muted">{t('com.baud')}</span>
            <select value={com.baud} disabled={b.state !== 'closed'} onChange={(e) => com.onBaud(Number(e.target.value))}>
              {[...new Set([...BAUD_RATES, com.baud])].sort((x, y) => x - y).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {b.state === 'closed' ? (
              <button onClick={() => void b.connect(com.baud)}>{t('com.connect')}</button>
            ) : (
              <button onClick={() => void b.disconnect()} disabled={b.state === 'opening'}>
                {t('com.disconnect')}
              </button>
            )}
            <span className={b.state === 'open' ? 'com-on' : 'muted'}>
              {b.state === 'open' ? t('com.open', { name: b.label, baud: b.baud, rx: b.rxBytes, tx: b.txBytes }) : b.state === 'opening' ? t('com.opening') : b.error ? `${t('com.error')} ${b.error}` : t('com.idle')}
            </span>
          </div>
          <div className="com-row">
            <label className="inline">
              <input type="checkbox" checked={com.linked} onChange={(e) => com.onLink(e.target.checked)} />
              <span>{t('com.link')}</span>
            </label>
            <label className="inline">
              <input type="checkbox" checked={hexView} onChange={(e) => setHexView(e.target.checked)} />
              <span>{t('serial.hexView')}</span>
            </label>
          </div>
          {b.state === 'open' && com.linked && !com.running && <p className="muted com-note">{t('com.notRunning')}</p>}
        </>
      )}
      {com.choices && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && com.pick('')}>
          <div className="modal" role="dialog" aria-label={t('com.choose')}>
            <h3>{t('com.choose')}</h3>
            {com.choices.length === 0 ? (
              <p className="muted">{t('com.none')}</p>
            ) : (
              <div className="com-list">
                {com.choices.map((p) => (
                  <button key={p.id} onClick={() => com.pick(p.id)}>
                    <strong>{p.name}</strong> <span className="muted">{p.display}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="muted">{t('com.hint')}</p>
            <div className="modal-buttons">
              <span className="spacer" />
              <button onClick={() => com.pick('')}>{t('print.close')}</button>
            </div>
          </div>
        </div>
      )}
      <pre ref={box} className="serial-out">
        {shown || <span className="muted">{view === 'board' ? t('serial.empty') : t('serial.emptyCom')}</span>}
      </pre>
      <div className="serial-in">
        <input
          value={line}
          placeholder={view === 'com' && b.state !== 'open' ? t('serial.needPort') : hexInput ? t('serial.placeholderHex') : t('serial.placeholder')}
          onChange={(e) => {
            setLine(e.target.value);
            setProblem('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && canSend && send()}
          disabled={!canSend}
          spellCheck={false}
        />
        <select value={ending} onChange={(e) => setEnding(e.target.value as LineEnding)} title={t('serial.ending')}>
          {(Object.keys(LINE_ENDINGS) as LineEnding[]).map((k) => (
            <option key={k} value={k}>
              {t(ENDING_KEYS[k])}
            </option>
          ))}
        </select>
        <label className="inline" title={t('serial.hexInputHint')}>
          <input type="checkbox" checked={hexInput} onChange={(e) => setHexInput(e.target.checked)} />
          <span>Hex</span>
        </label>
        <button onClick={send} disabled={!canSend}>
          {t('serial.send')}
        </button>
      </div>
      {problem && <p className="com-note com-bad">{problem}</p>}
    </section>
  );
}
