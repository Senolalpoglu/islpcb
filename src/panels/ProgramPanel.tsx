import { useEffect, useMemo, useRef, useState } from 'react';
import { base64ToBytes, bytesToBase64 } from '../../core/mcu/board';
import { parseIntelHex } from '../../core/mcu/ihex';
import type { PicChipId } from '../../core/mcu/pic16';
import { assemblePic } from '../../core/mcu/picasm';
import { isUf2, parseUf2 } from '../../core/mcu/uf2';
import { useI18n, type Key } from '../i18n';
import { SKETCHES, hasImage, hexFor } from '../editor/arduinoExamples';
import { PART_DEFS, type Part } from '../editor/model';
import { PIC_PROGRAMS, assembleCached } from '../editor/picExamples';

interface Props {
  part: Part;
  /** Merges new values into the part's parameters (one undo step). */
  onParams: (patch: Record<string, string>) => void;
}

interface Example {
  id: string;
  label: Key;
  source: string;
  hex: () => string;
}

export function ProgramPanel({ part, onParams }: Props) {
  const { t } = useI18n();
  const mcu = PART_DEFS[part.type].mcu!;
  const isPic = mcu.engine.startsWith('pic16');
  const source = typeof part.params.source === 'string' ? part.params.source : '';
  const hex = typeof part.params.hex === 'string' ? part.params.hex : '';
  const [draft, setDraft] = useState(source);
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasCli, setHasCli] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(source), [source, part.id]);
  useEffect(() => {
    window.snl?.cliAvailable().then(setHasCli, () => setHasCli(false));
  }, []);

  const examples: Example[] = useMemo(
    () =>
      isPic
        ? PIC_PROGRAMS[part.type as PicChipId].map((p) => ({ id: p.id, label: p.label, source: p.source, hex: () => assembleCached(part.type as PicChipId, p.source).hex }))
        : SKETCHES.filter((s) => hasImage(s, mcu.engine)).map((s) => ({ id: s.id, label: s.label, source: s.source, hex: () => hexFor(s, mcu.engine) })),
    [isPic, part.type, mcu.engine],
  );

  const size = useMemo(() => {
    try {
      return mcu.engine === 'rp2040' ? base64ToBytes(hex).length : parseIntelHex(hex).length;
    } catch {
      return null;
    }
  }, [hex, mcu.engine]);

  const compile = async () => {
    if (isPic) {
      // PIC programs are assembled right here, no external tool needed.
      const r = assemblePic(draft, part.type as PicChipId);
      if (r.ok) {
        onParams({ source: draft, hex: r.hex });
        setLog(t('prog.assembleOk', { n: r.words }));
      } else {
        setLog(`${t('prog.assembleFail')}\n${r.errors.map((e) => `${e.line}: ${e.message}`).join('\n')}`);
      }
      return;
    }
    if (!window.snl) return;
    setBusy(true);
    setLog(t('prog.compiling'));
    try {
      const r = await window.snl.compile(draft, mcu.fqbn);
      if (r.ok) {
        onParams({ source: draft, hex: r.hex });
        setLog(t('prog.compileOk'));
      } else {
        setLog(`${t('prog.compileFail')}\n${r.log}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const loadFirmware = async (file: File) => {
    try {
      if (mcu.engine === 'rp2040') {
        // .uf2 is flattened to the flash image; a .bin already is one.
        const bytes = new Uint8Array(await file.arrayBuffer());
        onParams({ hex: bytesToBase64(isUf2(bytes) ? parseUf2(bytes) : bytes) });
      } else {
        const text = await file.text();
        parseIntelHex(text);
        onParams({ hex: text });
      }
      setLog('');
    } catch {
      setLog(t('prog.badHex'));
    }
  };

  const canBuild = isPic || hasCli;

  return (
    <div className="program">
      <h2>{t('panel.program')}</h2>
      <select
        value=""
        onChange={(e) => {
          const ex = examples.find((x) => x.id === e.target.value);
          if (ex) onParams({ source: ex.source, hex: ex.hex() });
        }}
      >
        <option value="" disabled>
          {t('prog.example')}
        </option>
        {examples.map((ex) => (
          <option key={ex.id} value={ex.id}>
            {t(ex.label)}
          </option>
        ))}
      </select>
      <textarea
        className="code"
        value={draft}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== source && onParams({ source: draft })}
      />
      <div className="btn-row">
        <button onClick={compile} disabled={busy || !canBuild} title={canBuild ? '' : t('prog.noCompiler')}>
          {busy ? t('prog.compiling') : isPic ? t('prog.assemble') : t('prog.compile')}
        </button>
        <button onClick={() => fileInput.current?.click()}>{t('prog.loadHex')}</button>
        <input
          ref={fileInput}
          type="file"
          accept={mcu.engine === 'rp2040' ? '.uf2,.bin' : '.hex'}
          hidden
          onChange={(e) => e.target.files?.[0] && loadFirmware(e.target.files[0]).then(() => (e.target.value = ''))}
        />
      </div>
      {!canBuild && <p className="muted small">{t('prog.noCompiler')}</p>}
      {size !== null && <p className="muted small">{t('prog.size', { n: size })}</p>}
      {log && <pre className="log">{log}</pre>}
    </div>
  );
}
