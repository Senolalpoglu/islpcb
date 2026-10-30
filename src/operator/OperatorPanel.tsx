import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import type { Doc } from '../editor/model';
import { layoutInWorker } from '../pcb/layoutAsync';
import { DEFAULT_MODEL, MODELS, runTurn, type ApiMessage, type ChatItem, type Role } from './session';
import type { Workspace } from './tools';

interface Props {
  doc: Doc;
  /** Receives the document after each step of the operator, without adding an undo step. */
  onDoc: (d: Doc) => void;
  /** Marks one undo step before the operator changes anything, so a single Undo takes back its whole request. */
  onCheckpoint: () => void;
  onLibraryChanged: () => void;
  onShowView: (view: 'schematic' | 'pcb') => void;
  onClose: () => void;
}

const MODEL_KEY = 'snl.claudeModel';

function loadModel(): string {
  try {
    const m = localStorage.getItem(MODEL_KEY);
    if (m && MODELS.some((x) => x.id === m)) return m;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_MODEL;
}

export function OperatorPanel({ doc, onDoc, onCheckpoint, onLibraryChanged, onShowView, onClose }: Props) {
  const { t } = useI18n();
  const bridge = window.snl;
  const [items, setItems] = useState<ChatItem[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState(loadModel);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [settings, setSettings] = useState(false);
  const [keyNote, setKeyNote] = useState('');
  const [mcp, setMcp] = useState<BridgeStatus | null>(null);
  const [mcpNote, setMcpNote] = useState('');
  const history = useRef<ApiMessage[]>([]);
  const docRef = useRef(doc);
  const stop = useRef(false);
  const nextId = useRef(1);
  const box = useRef<HTMLDivElement>(null);
  docRef.current = doc;

  useEffect(() => {
    bridge?.claudeStatus().then((s) => setHasKey(s.hasKey), () => setHasKey(false));
    bridge?.bridgeStatus().then(setMcp, () => setMcp(null));
  }, [bridge]);

  /** Switches Claude Desktop access on (registering the MCP server in its settings) or off. */
  const toggleMcp = async () => {
    if (!bridge || !mcp) return;
    setMcpNote('');
    if (mcp.enabled) {
      setMcp(await bridge.bridgeDisable());
      return;
    }
    const r = await bridge.bridgeEnable();
    setMcp(r);
    setMcpNote(r.ok ? t('mcp.restart') : `${t('mcp.failed')} ${r.error ?? ''}`);
  };

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  const push = (role: Role, body: string) => setItems((list) => [...list, { id: nextId.current++, role, text: body }]);

  const saveKey = async () => {
    if (!bridge || !keyInput.trim()) return;
    const r = await bridge.claudeSetKey(keyInput);
    if (r.ok) {
      setHasKey(true);
      setKeyInput('');
      setKeyNote(r.encrypted ? t('op.keyEncrypted') : t('op.keyPlain'));
      setSettings(false);
    } else setKeyNote(r.error ?? '');
  };

  const send = async (request?: string) => {
    const userText = (request ?? text).trim();
    if (!userText || busy || !bridge) return;
    setText('');
    push('user', userText);
    setBusy(true);
    stop.current = false;
    onCheckpoint();
    const ws: Workspace = { doc: docRef.current, onLibraryChanged, showView: onShowView, layoutAsync: layoutInWorker };
    try {
      history.current = await runTurn({
        model,
        history: history.current,
        userText,
        ws,
        send: (req) => bridge.claudeSend(req),
        onItem: push,
        onDoc: (w) => onDoc(w.doc),
        cancelled: () => stop.current,
      });
      onDoc(ws.doc);
    } catch (e) {
      push('error', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const examples = [t('op.ex1'), t('op.ex2'), t('op.ex3')];

  return (
    <aside className="operator" role="dialog" aria-label={t('op.title')}>
      <header>
        <h2>{t('op.title')}</h2>
        <select
          value={model}
          title={t('op.model')}
          onChange={(e) => {
            setModel(e.target.value);
            try {
              localStorage.setItem(MODEL_KEY, e.target.value);
            } catch {
              /* the choice only lasts for this session */
            }
          }}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <button title={t('op.settings')} onClick={() => setSettings((s) => !s)}>
          ⚙
        </button>
        <button
          title={t('op.clear')}
          disabled={busy}
          onClick={() => {
            history.current = [];
            setItems([]);
          }}
        >
          ⌫
        </button>
        <button onClick={onClose} title={t('op.close')}>
          ✕
        </button>
      </header>

      {!bridge ? (
        <p className="muted small op-pad">{t('op.noBridge')}</p>
      ) : (
        <>
          {(settings || hasKey === false) && (
            <div className="op-key">
              <p className="small">{t('op.keyHint')}</p>
              <div className="btn-row">
                <input type="password" className="grow" placeholder="sk-ant-…" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void saveKey()} autoComplete="off" spellCheck={false} />
                <button onClick={() => void saveKey()} disabled={!keyInput.trim()}>
                  {t('op.saveKey')}
                </button>
              </div>
              {hasKey && (
                <button
                  className="danger"
                  onClick={async () => {
                    await bridge.claudeClearKey();
                    const s = await bridge.claudeStatus();
                    setHasKey(s.hasKey);
                  }}
                >
                  {t('op.removeKey')}
                </button>
              )}
              {keyNote && <p className="muted small">{keyNote}</p>}
            </div>
          )}
          {(settings || hasKey === false) && mcp && (
            <div className="op-key">
              <h3>{t('mcp.title')}</h3>
              <p className="small">{t('mcp.hint')}</p>
              <div className="btn-row">
                <button className={mcp.enabled ? '' : 'run'} onClick={() => void toggleMcp()}>
                  {mcp.enabled ? t('mcp.disconnect') : t('mcp.connect')}
                </button>
              </div>
              {mcp.enabled && <p className="small">{mcp.running && mcp.installed ? t('mcp.on') : t('mcp.partial')}</p>}
              {mcpNote && <p className="muted small">{mcpNote}</p>}
              <p className="muted small">{t('mcp.file')} {mcp.configFile}</p>
            </div>
          )}

          <div className="op-log" ref={box}>
            {items.length === 0 && (
              <div className="op-empty">
                <p className="muted small">{t('op.intro')}</p>
                {examples.map((ex) => (
                  <button key={ex} className="op-chip" disabled={!hasKey} onClick={() => void send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className={`op-item ${it.role}`}>
                {it.role === 'tool' ? <code>{it.text}</code> : it.text}
              </div>
            ))}
            {busy && <div className="op-item note">…</div>}
          </div>

          <div className="op-input">
            <textarea
              value={text}
              rows={3}
              placeholder={t('op.placeholder')}
              disabled={busy || hasKey === false}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            {busy ? (
              <button className="danger" onClick={() => (stop.current = true)}>
                {t('op.stop')}
              </button>
            ) : (
              <button className="run" onClick={() => void send()} disabled={!text.trim() || hasKey === false}>
                {t('op.send')}
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
