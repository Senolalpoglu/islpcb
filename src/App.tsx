import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { EXAMPLES, type Example } from './editor/examples';
import { autoroute } from '../core/pcb/router';
import { runDrc, type DrcIssue } from '../core/pcb/drc';
import { ratsnest } from '../core/pcb/ratsnest';
import { emptyPcb, type Layer, type PcbDoc, type Pt as MmPt } from '../core/pcb/types';
import { emptyDoc, PART_DEFS, removeSelected, type Doc, type PartType, type Pt } from './editor/model';
import { centerOnSheet, circuitOnSheet, sheetLayout } from './editor/bounds';
import { extractNetlist } from './editor/netlist';
import { registerEmbedded, usedUserSpecs } from './editor/library';
import { SchematicCanvas, selectedIds, type Selection, type Tool } from './editor/SchematicCanvas';
import { LimitTracker } from './editor/limits';
import { eng } from './editor/units';
import { LibraryPanel } from './panels/LibraryPanel';
import { NumberField, PropertiesPanel } from './panels/PropertiesPanel';
import { ScopePanel } from './panels/ScopePanel';
import { TimingPanel } from './panels/TimingPanel';
import { NextionPanel } from './panels/NextionPanel';
import { SerialPanel } from './panels/SerialPanel';
import { NEXTION_TYPE } from './sim/rig';
import { baudOfSource } from './sim/comPort';
import { useComPort } from './sim/useComPort';
import { PcbCanvas, type PcbSelection, type PcbTool } from './pcb/PcbCanvas';
import { Pcb3D } from './pcb/Pcb3D';
import { PrintSheet, type PrintJob } from './editor/PrintSheet';
import { SheetDialog } from './editor/SheetDialog';
import { sheetOf, type SheetSettings } from './editor/sheet';
import { PcbPanel } from './pcb/PcbPanel';
import { manufacturingZip } from './pcb/export';
import { padNets, padsWithNets, syncPcb } from './pcb/sync';
import { netWidths } from './pcb/layout';
import { layoutInWorker } from './pcb/layoutAsync';
import { useBridge } from './operator/useBridge';
import { OperatorPanel } from './operator/OperatorPanel';
import { THEMES, applyTheme, loadTheme } from './theme';
import { useSimulation, type SimSettings } from './sim/useSimulation';

interface History {
  past: Doc[];
  present: Doc;
  future: Doc[];
}

const MAX_UNDO = 100;
const FILE_EXT = '.islpcb';
/** Files saved by the program under its old name (SNL PCB) still open. */
const OPEN_EXT = `${FILE_EXT},.snlpcb`;

/** Reads a project file. Library parts it carries are registered; parts nobody can supply are dropped and counted. */
function parseDoc(text: string): { doc: Doc; dropped: number; problems: string[] } | null {
  try {
    const d = JSON.parse(text) as Doc;
    if (d.version === 1 && Array.isArray(d.parts) && Array.isArray(d.wires) && typeof d.nextId === 'number') {
      const problems = registerEmbedded(d.customParts);
      const parts = d.parts.filter((p) => PART_DEFS[p.type] !== undefined);
      return { doc: { ...d, parts }, dropped: d.parts.length - parts.length, problems };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** A yes/no choice kept between sessions; `fallback` when nothing was saved or storage is unavailable. */
const savedFlag = (key: string, fallback: boolean): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
};

export function App() {
  const { t, lang, setLang } = useI18n();
  const [hist, setHist] = useState<History>(() => ({ past: [], present: emptyDoc(), future: [] }));
  const doc = hist.present;
  // The document as it was last saved or loaded: anything else is an unsaved change (undoing back to it is clean again).
  const [savedDoc, setSavedDoc] = useState(doc);
  const dirty = doc !== savedDoc;
  const [tool, setTool] = useState<Tool>('select');
  const [placing, setPlacing] = useState<PartType | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [tab, setTab] = useState<'scope' | 'serial' | 'display' | 'timing'>('scope');
  const [fitKey, setFitKey] = useState(0);
  const [libVersion, setLibVersion] = useState(0);
  const [operatorOpen, setOperatorOpen] = useState(false);
  const [theme, setThemeState] = useState(loadTheme);
  const [settings, setSettings] = useState<SimSettings>({ dt: EXAMPLES[0].dt, stepsPerFrame: 100, window: EXAMPLES[0].dt * 1000 });
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<'schematic' | 'pcb' | 'pcb3d'>('schematic');
  const [pcbTool, setPcbTool] = useState<PcbTool>('select');
  const [pcbLayerChoice, setPcbLayer] = useState<Layer>('top');
  const [showTop, setShowTop] = useState(true);
  const [showBottom, setShowBottom] = useState(true);
  const [pcbSel, setPcbSel] = useState<PcbSelection>(null);
  const [issues, setIssues] = useState<DrcIssue[] | null>(null);
  const [pcbMsg, setPcbMsg] = useState('');
  const [pcbBusy, setPcbBusy] = useState(false);
  const [pcbFocus, setPcbFocus] = useState<MmPt | null>(null);
  const [pcbHover, setPcbHover] = useState('');
  const [pcbFit, setPcbFit] = useState(0);
  const [gridOn, setGridOn] = useState(() => {
    try {
      return localStorage.getItem('snl.grid') !== 'off';
    } catch {
      return true;
    }
  });
  const [flowOn, setFlowOn] = useState(() => savedFlag('snl.flow', true));
  const [flowElectrons, setFlowElectrons] = useState(() => savedFlag('snl.flow.electrons', false));
  const [flowClick, setFlowClick] = useState(() => savedFlag('snl.flow.click', true));
  const [flowVolt, setFlowVolt] = useState(() => savedFlag('snl.flow.volt', false));
  const [sheetOpen, setSheetOpen] = useState(false);
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);

  const commit = useCallback((d: Doc) => setHist((h) => ({ past: [...h.past.slice(-MAX_UNDO), h.present], present: d, future: [] })), []);
  const replace = useCallback((d: Doc) => setHist((h) => ({ ...h, present: d })), []);
  const checkpoint = useCallback(() => setHist((h) => ({ past: [...h.past.slice(-MAX_UNDO), h.present], present: h.present, future: [] })), []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)), []);

  const showView = useCallback((v: 'schematic' | 'pcb') => {
    setView(v);
    if (v === 'pcb') setPcbFit((k) => k + 1);
  }, []);
  // Claude Desktop (MCP) drives the open project through this, whether or not the assistant panel is open.
  useBridge({ doc, onDoc: replace, onCheckpoint: checkpoint, onLibraryChanged: () => setLibVersion((v) => v + 1), onShowView: showView });

  const extracted = useMemo(() => extractNetlist(doc), [doc]);
  const sim = useSimulation(doc, extracted, settings);
  // Parts that went beyond what they are rated for (over voltage, over current, wrong polarity) while the circuit ran.
  const limitTracker = useRef(new LimitTracker());
  const limitIssues = useMemo(() => limitTracker.current.update(doc, extracted, sim.solution), [doc, extracted, sim.solution, sim.frame]);

  // The real COM port (a USB-TTL adapter): what arrives goes to the first board's serial input, what it prints goes out.
  const [linked, setLinked] = useState(true); // port <-> board; off: the port is only a monitor, like in the Arduino IDE
  const linkedRef = useRef(true);
  linkedRef.current = linked;
  const com = useComPort((bytes) => {
    if (linkedRef.current) sim.sendSerialBytes(bytes);
  });
  const [baud, setBaud] = useState(9600);
  const suggestedBaud = useMemo(() => {
    for (const p of doc.parts) {
      const found = typeof p.params.source === 'string' ? baudOfSource(p.params.source) : null;
      if (found) return found;
    }
    return null;
  }, [doc.parts]);
  useEffect(() => {
    if (suggestedBaud && com.bridge.state === 'closed') setBaud(suggestedBaud);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedBaud]);
  useEffect(() => {
    sim.setSerialTap((b) => {
      if (linkedRef.current) com.bridge.send(b);
    });
    return () => sim.setSerialTap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PCB data is only derived while the PCB view is open.
  const pcb: PcbDoc = doc.pcb ?? emptyPcb();
  const singleSided = pcb.sides === 1;
  const pcbLayer: Layer = singleSided ? 'bottom' : pcbLayerChoice;
  const pcbData = useMemo(() => {
    if (view === 'schematic') return null;
    const nets = padNets(doc, extracted);
    const pads = padsWithNets(pcb, nets, doc);
    return { nets, pads, airwires: ratsnest(pcb, pads) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, doc, extracted]);

  const commitPcb = useCallback((p: PcbDoc) => commit({ ...doc, pcb: p }), [commit, doc]);
  const replacePcb = useCallback((p: PcbDoc) => replace({ ...doc, pcb: p }), [replace, doc]);

  /** Brings footprints and nets in line with the schematic, as one undo step and only if something changed. */
  const syncFromSchematic = () => {
    const next = syncPcb(doc, extracted, pcb);
    if (JSON.stringify(next) !== JSON.stringify(doc.pcb)) commit({ ...doc, pcb: next });
    setIssues(null);
  };

  const openPcb = () => {
    syncFromSchematic();
    setView('pcb');
    setPcbFit((k) => k + 1);
  };

  const openPcb3d = () => {
    syncFromSchematic();
    setView('pcb3d');
  };

  const toggleFlag = (key: string, set: (f: (on: boolean) => boolean) => void) =>
    set((on) => {
      try {
        localStorage.setItem(key, on ? 'off' : 'on');
      } catch {
        /* storage unavailable: the choice only lasts for this session */
      }
      return !on;
    });

  const toggleGrid = () =>
    setGridOn((on) => {
      try {
        localStorage.setItem('snl.grid', on ? 'off' : 'on');
      } catch {
        /* storage unavailable: the choice only lasts for this session */
      }
      return !on;
    });

  const sheet = sheetOf(doc);
  const setSheet = (s: SheetSettings) => replace({ ...doc, sheet: s });
  const centerCircuit = () => commit(centerOnSheet(doc, sheet));

  /** Takes the circuit as the editor draws it and hands it to the print page (see PrintSheet). */
  const startPrint = (mode: 'print' | 'pdf') => {
    const g = document.querySelector<SVGGraphicsElement>('svg.canvas [data-schematic]');
    if (!g) {
      alert(t('print.needSchematic'));
      return;
    }
    const b = g.getBBox();
    setSheetOpen(false);
    setPrintJob({ mode, html: g.innerHTML, bbox: { x: b.x, y: b.y, w: b.width, h: b.height }, sheet, paper: sheetLayout(doc, sheet).paper, lang });
  };

  // The print page needs a moment to be drawn before the browser prints it; the dialog is closed first so it is not on the page.
  useEffect(() => {
    if (!printJob) return;
    let cancelled = false;
    (async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      const p = printJob.paper;
      try {
        if (window.snl?.print) {
          const r = await window.snl.print({ mode: printJob.mode, size: p.name, landscape: p.w >= p.h, widthMm: p.w, heightMm: p.h });
          if (!r.ok && r.error) alert(`${t('print.failed')} ${r.error}`);
        } else window.print();
      } finally {
        setPrintJob(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printJob]);

  const routeAll = () => {
    if (!pcbData) return;
    setPcbBusy(true);
    setPcbMsg('…');
    // Let the "busy" state paint before the (synchronous) search starts.
    setTimeout(() => {
      const r = autoroute(pcb, pcbData.pads, { netWidths: netWidths(doc, extracted, pcb, pcbData.nets), ...(pcb.sides === 1 ? { onlyLayer: 'bottom' as const } : {}) });
      const used = [...r.tracks.map((x) => x.id), ...r.vias.map((v) => v.id)].map((id) => Number(id.slice(1)));
      commit({ ...doc, pcb: { ...pcb, tracks: [...pcb.tracks, ...r.tracks], vias: [...pcb.vias, ...r.vias], nextId: Math.max(pcb.nextId, ...used, 0) + 1 } });
      setPcbMsg(r.failed.length ? `${t('pcb.routed', { n: r.routed })} ${t('pcb.failed', { n: r.failed.length })}${pcb.sides === 1 ? ` ${t('pcb.jumpers')}` : ''}` : t('pcb.routed', { n: r.routed }));
      setIssues(null);
      setPcbBusy(false);
    }, 30);
  };

  /** Arranges the parts, picks track widths and routes the whole board in one go, in a worker so the page stays usable. */
  const layoutAll = async () => {
    setPcbBusy(true);
    setPcbMsg(t('pcb.working'));
    try {
      const r = await layoutInWorker(doc, pcb);
      commit({ ...doc, pcb: r.pcb });
      setPcbMsg(r.failed.length ? `${t('pcb.routed', { n: r.routed })} ${t('pcb.failed', { n: r.failed.length })}${r.pcb.sides === 1 ? ` ${t('pcb.jumpers')}` : ''}` : t('pcb.routed', { n: r.routed }));
      setIssues(null);
      setPcbFit((k) => k + 1);
    } catch (e) {
      setPcbMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setPcbBusy(false);
    }
  };

  const exportZip = () => {
    if (!pcbData) return;
    const zip = manufacturingZip(doc, extracted, pcb, 'islpcb');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([zip.slice().buffer], { type: 'application/zip' }));
    a.download = 'islpcb-fabrication.zip';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const loadDoc = (d: Doc, ex?: Example) => {
    sim.reset();
    // A circuit that does not lie on its sheet is brought into the middle of it; one that does stays where it was put.
    const sh = sheetOf(d);
    const loaded = circuitOnSheet(d, sh) ? d : centerOnSheet(d, sh);
    commit(loaded);
    setSavedDoc(loaded);
    setPcbMsg('');
    setIssues(null);
    setSelection(null);
    setPlacing(null);
    setFitKey((k) => k + 1);
    if (ex) {
      setSettings({ dt: ex.dt, window: ex.window ?? ex.dt * 1000, stepsPerFrame: ex.steps ?? 100 });
      setTab(ex.id === 'ino-nextion' ? 'display' : ex.id === 'ino-serial' || ex.id === 'ino-serial-control' || ex.id === 'ino-bluetooth' || ex.id === 'ino-sensors' || ex.id === 'us-driver' ? 'serial' : 'scope');
    }
  };

  /** The text of the circuit file: the document with the definitions of the user parts it uses. */
  const fileText = (): string => {
    const used = usedUserSpecs(doc);
    return JSON.stringify({ ...doc, customParts: used.length ? used : undefined }, null, 2);
  };

  const save = () => {
    const blob = new Blob([fileText()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `circuit${FILE_EXT}`;
    a.click();
    URL.revokeObjectURL(a.href);
    setSavedDoc(doc);
  };

  /** True when there is nothing to lose, or the user agrees to lose the unsaved changes. */
  const confirmDiscard = (): boolean => !dirty || confirm(t('confirm.unsaved'));

  // The main process asks for the file text when the user chooses "save" while closing the window.
  const fileTextRef = useRef(fileText);
  fileTextRef.current = fileText;
  useEffect(() => window.snl?.onSaveRequest?.(() => window.snl?.provideSave?.(fileTextRef.current())), []);

  // Tell the main process (it asks before closing the window) or the browser (it asks before leaving the page).
  const closeTexts = {
    title: t('close.title'),
    message: t('close.message'),
    save: t('close.save'),
    discard: t('close.discard'),
    cancel: t('close.cancel'),
    failed: t('close.failed'),
  };
  const closeKey = JSON.stringify(closeTexts);
  useEffect(() => {
    if (window.snl?.setDirty) {
      window.snl.setDirty(dirty, JSON.parse(closeKey));
      return;
    }
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, closeKey]);

  const open = async (file: File) => {
    const r = parseDoc(await file.text());
    if (!r) {
      alert(t('file.error'));
      return;
    }
    setLibVersion((v) => v + 1);
    loadDoc(r.doc);
    if (r.dropped > 0 || r.problems.length > 0) alert([r.dropped > 0 ? `${t('file.missingParts')}: ${r.dropped}` : '', ...r.problems.slice(0, 5)].filter(Boolean).join('\n'));
  };

  const deleteSelection = () => {
    if (!selection) return;
    const ids = selectedIds(selection);
    commit(removeSelected(doc, ids.parts, ids.wires));
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.ctrlKey || e.metaKey) && !typing) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        } else if (k === 'y') {
          e.preventDefault();
          redo();
        } else if (k === 's') {
          e.preventDefault();
          save();
        } else if (k === 'p' && view === 'schematic') {
          e.preventDefault();
          setSheetOpen(true);
        }
      } else if (!typing && !e.ctrlKey && view === 'schematic' && (e.key === 'g' || e.key === 'G')) {
        toggleGrid();
      } else if (!typing && !e.ctrlKey && view === 'schematic' && (e.key === 'w' || e.key === 'W')) {
        setPlacing(null);
        setTool((x) => (x === 'wire' ? 'select' : 'wire'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const nodeV = cursor && sim.solution ? extracted.nodeAt(cursor) : undefined;
  const statusText = t(`sim.status.${sim.status}`);
  const hint =
    view === 'pcb3d'
      ? t('pcb3d.hint')
      : view === 'pcb'
      ? pcbTool === 'route'
        ? t('pcb.hint.route')
        : pcbTool === 'via'
          ? t('pcb.hint.via')
          : t('pcb.hint.select')
      : placing
        ? t('hint.place')
        : tool === 'wire'
          ? t('hint.wire')
          : t('hint.select');

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <img src="icon.svg" alt="" width={22} height={22} />
          <strong>{t('appName')}</strong>
        </div>
        <div className="group">
          <button className={view === 'schematic' ? 'on' : ''} onClick={() => setView('schematic')}>
            {t('view.schematic')}
          </button>
          <button className={view === 'pcb' ? 'on' : ''} onClick={openPcb}>
            {t('view.pcb')}
          </button>
          <button className={view === 'pcb3d' ? 'on' : ''} onClick={openPcb3d}>
            {t('view.pcb3d')}
          </button>
        </div>
        <div className="group">
          <button
            onClick={() => {
              if (confirmDiscard()) loadDoc(emptyDoc());
            }}
          >
            {t('menu.new')}
          </button>
          <button onClick={() => confirmDiscard() && fileInput.current?.click()}>{t('menu.open')}</button>
          <button onClick={save}>{t('menu.save')}</button>
          <input ref={fileInput} type="file" accept={OPEN_EXT} hidden onChange={(e) => e.target.files?.[0] && open(e.target.files[0]).then(() => (e.target.value = ''))} />
          <select
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.target.value);
              if (ex && confirmDiscard()) loadDoc(ex.build(), ex);
            }}
          >
            <option value="" disabled>
              {t('menu.examples')}
            </option>
            {EXAMPLES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {t(ex.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="group">
          <button onClick={undo} disabled={!hist.past.length} title={`${t('menu.undo')} (Ctrl+Z)`}>
            ↶
          </button>
          <button onClick={redo} disabled={!hist.future.length} title={`${t('menu.redo')} (Ctrl+Y)`}>
            ↷
          </button>
        </div>
        {view === 'pcb' ? (
          <div className="group">
            <button className={pcbTool === 'select' ? 'on' : ''} onClick={() => setPcbTool('select')}>
              {t('pcb.tool.select')}
            </button>
            <button className={pcbTool === 'route' ? 'on' : ''} onClick={() => setPcbTool('route')}>
              {t('pcb.tool.route')}
            </button>
            {!singleSided && (
              <button className={pcbTool === 'via' ? 'on' : ''} onClick={() => setPcbTool('via')}>
                {t('pcb.tool.via')}
              </button>
            )}
            {!singleSided && (
              <button className={pcbLayer === 'top' ? 'on top-layer' : 'top-layer'} onClick={() => setPcbLayer('top')} title="L">
                {t('pcb.layer.top')}
              </button>
            )}
            <button className={pcbLayer === 'bottom' ? 'on bottom-layer' : 'bottom-layer'} onClick={() => setPcbLayer('bottom')} title="L">
              {t('pcb.layer.bottom')}
            </button>
            {!singleSided && (
              <label className="inline">
                <input type="checkbox" checked={showTop} onChange={(e) => setShowTop(e.target.checked)} />
                <span>{t('pcb.layer.top')}</span>
              </label>
            )}
            <label className="inline">
              <input type="checkbox" checked={showBottom} onChange={(e) => setShowBottom(e.target.checked)} />
              <span>{t('pcb.layer.bottom')}</span>
            </label>
          </div>
        ) : view === 'pcb3d' ? null : (
          <>
        <div className="group">
          <button className={tool === 'select' && !placing ? 'on' : ''} onClick={() => (setTool('select'), setPlacing(null))}>
            {t('tool.select')}
          </button>
          <button className={tool === 'wire' ? 'on' : ''} onClick={() => (setTool('wire'), setPlacing(null))} title="W">
            {t('tool.wire')}
          </button>
        </div>
        <div className="group sim">
          {sim.status === 'running' ? (
            <button className="stop" onClick={sim.stop}>
              ■ {t('sim.stop')}
            </button>
          ) : (
            <button className="run" onClick={sim.run}>
              ▶ {t('sim.run')}
            </button>
          )}
          <button onClick={sim.reset}>↺ {t('sim.reset')}</button>
          <button onClick={sim.operatingPoint}>{t('sim.op')}</button>
          <button className={flowOn ? 'on' : ''} onClick={() => toggleFlag('snl.flow', setFlowOn)} title={t('flow.titleHint')}>
            ⚡ {t('flow.title')}
          </button>
          {flowOn && (
            <>
              <button className={flowElectrons ? 'on' : ''} onClick={() => toggleFlag('snl.flow.electrons', setFlowElectrons)} title={t('flow.electronsHint')}>
                {t('flow.electrons')}
              </button>
              <button className={flowClick ? 'on' : ''} onClick={() => toggleFlag('snl.flow.click', setFlowClick)} title={t('flow.clickHint')}>
                {t('flow.click')}
              </button>
              <button className={flowVolt ? 'on' : ''} onClick={() => toggleFlag('snl.flow.volt', setFlowVolt)} title={t('flow.voltHint')}>
                {t('flow.volt')}
              </button>
              {flowVolt && (
                <span className="flow-legend" title={t('flow.legend')}>
                  <span className="ramp" />
                </span>
              )}
            </>
          )}
          <label className="inline">
            <span>{t('sim.dt')}</span>
            <NumberField value={settings.dt} onCommit={(v) => v > 0 && setSettings((s) => ({ ...s, dt: v, window: v * 1000 }))} />
          </label>
          <label className="inline">
            <span>{t('sim.speed')}</span>
            <NumberField value={settings.stepsPerFrame} onCommit={(v) => v >= 1 && setSettings((s) => ({ ...s, stepsPerFrame: Math.round(v) }))} />
          </label>
        </div>
        <div className="group">
          <button className={gridOn ? 'on' : ''} onClick={toggleGrid} title="G">
            {t('view.grid')}
          </button>
          <button className={sheet.show ? 'on' : ''} onClick={() => setSheet({ ...sheet, show: !sheet.show })}>
            {t('view.sheet')}
          </button>
          <button onClick={centerCircuit} title={t('view.centerHint')} disabled={!sheet.show}>
            {t('view.center')}
          </button>
          <button onClick={() => setSheetOpen(true)} title="Ctrl+P">
            {t('print.button')}
          </button>
        </div>
          </>
        )}
        <div className="spacer" />
        <div className="group">
          <button className={operatorOpen ? 'on' : ''} onClick={() => setOperatorOpen((o) => !o)} title={t('op.title')}>
            ✦ {t('op.open')}
          </button>
          <select
            className="theme-select"
            value={theme}
            title={t('theme.label')}
            onChange={(e) => {
              setThemeState(e.target.value);
              applyTheme(e.target.value);
            }}
          >
            {THEMES.map((th) => (
              <option key={th.id} value={th.id}>
                {t(th.label)}
              </option>
            ))}
          </select>
          <button className={lang === 'tr' ? 'on' : ''} onClick={() => setLang('tr')}>
            TR
          </button>
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
            EN
          </button>
        </div>
      </header>

      {view === 'pcb3d' && pcbData ? (
        <main className="workspace pcb3d-workspace">
          <Pcb3D doc={doc} pcb={pcb} pads={pcbData.pads} />
        </main>
      ) : view === 'pcb' && pcbData ? (
        <main className="workspace pcb-workspace">
          <div className="center">
            <PcbCanvas
              pcb={pcb}
              doc={doc}
              pads={pcbData.pads}
              airwires={pcbData.airwires}
              issues={issues ?? []}
              tool={pcbTool}
              layer={pcbLayer}
              showTop={showTop}
              showBottom={showBottom}
              selection={pcbSel}
              focus={pcbFocus}
              onSelect={setPcbSel}
              onLayer={setPcbLayer}
              commit={commitPcb}
              replace={replacePcb}
              checkpoint={checkpoint}
              onHover={setPcbHover}
              fitKey={pcbFit}
            />
          </div>
          <PcbPanel
            doc={doc}
            pcb={pcb}
            selection={pcbSel}
            airwires={pcbData.airwires}
            nets={[...new Set([...pcbData.nets.values()].filter((n, _, all) => all.filter((m) => m === n).length > 1))].sort((x, y) => (x === 'GND' ? -1 : y === 'GND' ? 1 : x.localeCompare(y)))}
            issues={issues}
            message={pcbMsg}
            busy={pcbBusy}
            onPcb={commitPcb}
            onSync={syncFromSchematic}
            onRoute={routeAll}
            onLayout={layoutAll}
            onClear={() => commitPcb({ ...pcb, tracks: [], vias: [] })}
            onDrc={() => setIssues(runDrc(pcb, pcbData.pads))}
            onExport={exportZip}
            onFocus={(p) => setPcbFocus({ ...p })}
          />
        </main>
      ) : (
      <main className="workspace">
        <LibraryPanel
          version={libVersion}
          onLibraryChanged={() => setLibVersion((v) => v + 1)}
          placing={placing}
          onPick={(type) => {
            setPlacing(type);
            setTool('select');
            setSelection(null);
          }}
        />
        <div className="center">
          <SchematicCanvas
            doc={doc}
            extracted={extracted}
            solution={sim.solution}
            issues={limitIssues}
            tool={tool}
            placing={placing}
            selection={selection}
            onSelect={setSelection}
            onPlacing={setPlacing}
            commit={commit}
            replace={replace}
            checkpoint={checkpoint}
            onCursor={setCursor}
            fitKey={fitKey}
            gridOn={gridOn}
            sheet={sheet.show ? sheet : null}
            lang={lang}
            segLevels={sim.segLevels}
            flow={{ on: flowOn, palette: flowVolt ? 'volt' : 'state', electrons: flowElectrons, interactive: flowClick, animate: sim.status !== 'paused' }}
          />
          <div className="tabs">
            <button className={tab === 'scope' ? 'on' : ''} onClick={() => setTab('scope')}>
              {t('panel.scope')}
            </button>
            <button className={tab === 'timing' ? 'on' : ''} onClick={() => setTab('timing')}>
              {t('panel.timing')}
            </button>
            <button className={tab === 'serial' ? 'on' : ''} onClick={() => setTab('serial')}>
              {t('panel.serial')}
            </button>
            {doc.parts.some((p) => p.type === NEXTION_TYPE) && (
              <button className={tab === 'display' ? 'on' : ''} onClick={() => setTab('display')}>
                {t('nx.tab')}
              </button>
            )}
          </div>
          {tab === 'scope' ? (
            <ScopePanel key={theme} doc={doc} scope={sim.scope} traces={sim.traces} frame={sim.frame} window={settings.window} />
          ) : tab === 'timing' ? (
            <TimingPanel key={theme} doc={doc} extracted={extracted} solution={sim.solution} time={sim.time} />
          ) : tab === 'display' ? (
            <NextionPanel displays={sim.displays} running={sim.status === 'running'} present={doc.parts.some((p) => p.type === NEXTION_TYPE)} onTouch={sim.touchDisplay} />
          ) : (
            <SerialPanel text={sim.serial} onSendBytes={sim.sendSerialBytes} onClear={sim.clearSerial} com={{ bridge: com.bridge, choices: com.choices, pick: com.pick, baud, onBaud: setBaud, running: sim.status === 'running', linked, onLink: setLinked }} />
          )}
        </div>
        <PropertiesPanel doc={doc} selection={selection} extracted={extracted} solution={sim.solution} onChange={commit} onDelete={deleteSelection} />
      </main>
      )}

      <footer className="statusbar">
        <span className={`chip ${sim.status}`}>{statusText}</span>
        {limitIssues.length > 0 && <span className="chip warn">⚠ {t('warn.count', { n: new Set(limitIssues.map((i) => i.partId)).size })}</span>}
        <span>
          {t('sim.time')}: {eng(sim.time, 's')}
        </span>
        {sim.errorKey && <span className="error">{t(sim.errorKey)}</span>}
        {nodeV !== undefined && sim.solution && <span>V = {eng(sim.solution.v[nodeV], 'V')}</span>}
        <span className="spacer" />
        {view === 'pcb' ? (
          <span className="muted">{pcbHover}</span>
        ) : (
          cursor && (
            <span className="muted">
              {cursor.x}, {cursor.y}
            </span>
          )
        )}
        <span className="muted">{hint}</span>
      </footer>
      {sheetOpen && <SheetDialog sheet={sheet} autoName={sheetLayout(doc, sheet).paper.name} onChange={setSheet} onPrint={() => startPrint('print')} onPdf={() => startPrint('pdf')} onClose={() => setSheetOpen(false)} />}
      {printJob && <PrintSheet job={printJob} />}
      {operatorOpen && (
        <OperatorPanel
          doc={doc}
          onDoc={replace}
          onCheckpoint={checkpoint}
          onLibraryChanged={() => setLibVersion((v) => v + 1)}
          onShowView={showView}
          onClose={() => setOperatorOpen(false)}
        />
      )}
    </div>
  );
}
