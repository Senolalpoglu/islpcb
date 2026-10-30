import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Simulator, type Netlist, type Solution } from '../../core/sim/solver';
import type { Key } from '../i18n';
import { isMcu, type Doc } from '../editor/model';
import type { Extracted } from '../editor/netlist';
import { McuRig } from './rig';
import { SegmentMeter } from './segments';

export type SimStatus = 'idle' | 'running' | 'paused';

export interface SimSettings {
  /** Time step in seconds. */
  dt: number;
  /** Solver steps executed per animation frame. */
  stepsPerFrame: number;
  /** Scope window in seconds. */
  window: number;
}

export interface Trace {
  partId: string;
  node: number;
}

const MAX_POINTS = 1000;

export interface ScopeData {
  t: number[];
  /** One sample array per probe, parallel to t. */
  v: Map<string, number[]>;
}

/** Everything that forces a restart: the netlist (ignoring live switch/pin state) and the firmware. */
function structureKey(n: Netlist, doc: Doc): string {
  const elements = n.elements.map((e) => (e.type === 'SW' ? { ...e, closed: false } : e.type === 'PIN' ? { ...e, v: 0, g: 0 } : e));
  const firmware = doc.parts.filter((p) => isMcu(p.type)).map((p) => [p.id, p.params.hex]);
  return JSON.stringify([n.nodeCount, elements, firmware]);
}


export function useSimulation(doc: Doc, extracted: Extracted, settings: SimSettings) {
  const [status, setStatus] = useState<SimStatus>('idle');
  const [errorKey, setErrorKey] = useState<Key | null>(null);
  const [frame, setFrame] = useState(0);
  const solution = useRef<Solution | null>(null);
  const sim = useRef<{ simulator: Simulator; key: string } | null>(null);
  const scope = useRef<ScopeData>({ t: [], v: new Map() });
  const sampleCount = useRef(0);
  const raf = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const docRef = useRef(doc);
  docRef.current = doc;
  const rig = useRef<McuRig | null>(null);
  /** Averages the segment currents of the 7-segment displays over the steps of a frame (see segments.ts). */
  const meter = useRef<SegmentMeter | null>(null);
  /** The brightness of the segments of each display, by part id, as of the last frame. */
  const segLevels = useRef<Map<string, number[]>>(new Map());
  /** Where the bytes the first board prints are also sent (a real COM port); set by the application. */
  const serialTap = useRef<((byte: number) => void) | null>(null);

  const traces = useMemo<Trace[]>(
    () =>
      doc.parts
        .filter((p) => p.type === 'PROBE')
        .map((p) => ({ partId: p.id, node: extracted.nodeOfPin.get(`${p.id}:0`) ?? 0 })),
    [doc.parts, extracted],
  );
  const tracesRef = useRef(traces);
  tracesRef.current = traces;

  const clearScope = () => {
    scope.current = { t: [], v: new Map() };
    sampleCount.current = 0;
  };

  const record = (s: Solution) => {
    const st = settingsRef.current;
    const stride = Math.max(1, Math.round(st.window / (st.dt * MAX_POINTS)));
    if (sampleCount.current++ % stride !== 0) return;
    const sc = scope.current;
    sc.t.push(s.time);
    for (const tr of tracesRef.current) {
      let arr = sc.v.get(tr.partId);
      if (!arr) {
        arr = new Array(sc.t.length - 1).fill(0);
        sc.v.set(tr.partId, arr);
      }
      arr.push(s.v[tr.node] ?? 0);
    }
    if (sc.t.length > MAX_POINTS * 1.5) {
      const drop = sc.t.length - MAX_POINTS;
      sc.t.splice(0, drop);
      for (const arr of sc.v.values()) arr.splice(0, drop);
    }
  };

  const fail = (s: Solution, nl: Netlist) => {
    const nonlinear = nl.elements.some((e) => e.type === 'D');
    setErrorKey(nonlinear ? 'sim.err.noConverge' : 'sim.err.singular');
    cancelAnimationFrame(raf.current);
    setStatus('paused');
    solution.current = s;
    setFrame((f) => f + 1);
  };

  const build = useCallback((): boolean => {
    if (extracted.error || !extracted.netlist) {
      setErrorKey(extracted.error === 'noGround' ? 'sim.err.noGround' : 'sim.err.empty');
      return false;
    }
    setErrorKey(null);
    const simulator = new Simulator(extracted.netlist);
    try {
      rig.current = new McuRig(docRef.current, extracted, extracted.netlist);
      rig.current.tap = (b) => serialTap.current?.(b);
    } catch {
      rig.current = null;
      setErrorKey('prog.badHex');
      return false;
    }
    sim.current = { simulator, key: structureKey(extracted.netlist, docRef.current) };
    clearScope();
    const first = simulator.beginTransient(settingsRef.current.dt, true);
    rig.current.prime(first);
    solution.current = first;
    record(first);
    meter.current = new SegmentMeter(docRef.current);
    meter.current.add(first);
    segLevels.current = meter.current.take();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted]);

  const loop = useCallback(() => {
    const cur = sim.current;
    if (!cur) return;
    let last = solution.current!;
    for (let i = 0; i < settingsRef.current.stepsPerFrame; i++) {
      last = rig.current ? rig.current.step(cur.simulator, settingsRef.current.dt) : cur.simulator.step();
      if (!last.converged) return fail(last, cur.simulator.netlist);
      record(last);
      meter.current?.add(last);
    }
    solution.current = last;
    if (meter.current) segLevels.current = meter.current.take();
    setFrame((f) => f + 1);
    raf.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = useCallback(() => {
    if (!sim.current && !build()) return;
    setStatus('running');
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  }, [build, loop]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setStatus('paused');
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(raf.current);
    sim.current = null;
    solution.current = null;
    rig.current = null;
    meter.current = null;
    segLevels.current = new Map();
    clearScope();
    setErrorKey(null);
    setStatus('idle');
    setFrame((f) => f + 1);
  }, []);

  const sendSerial = useCallback((text: string) => rig.current?.sendSerial(text), []);
  const sendSerialBytes = useCallback((bytes: Uint8Array) => rig.current?.sendBytes(bytes), []);
  const touchDisplay = useCallback((index: number, component: number, pressed: boolean) => {
    rig.current?.touch(index, component, pressed);
    setFrame((f) => f + 1);
  }, []);
  const setSerialTap = useCallback((tap: ((byte: number) => void) | null) => {
    serialTap.current = tap;
  }, []);

  const clearSerial = useCallback(() => {
    if (rig.current) rig.current.serial = '';
    setFrame((f) => f + 1);
  }, []);

  const operatingPoint = useCallback(() => {
    cancelAnimationFrame(raf.current);
    if (extracted.error || !extracted.netlist) {
      setErrorKey(extracted.error === 'noGround' ? 'sim.err.noGround' : 'sim.err.empty');
      return;
    }
    const s = new Simulator(extracted.netlist).operatingPoint();
    sim.current = null;
    clearScope();
    solution.current = s;
    const once = new SegmentMeter(docRef.current);
    once.add(s);
    segLevels.current = once.take();
    setErrorKey(s.converged ? null : extracted.netlist.elements.some((e) => e.type === 'D') ? 'sim.err.noConverge' : 'sim.err.singular');
    setStatus('idle');
    setFrame((f) => f + 1);
  }, [extracted]);

  // Follow edits: patch switches in place, or restart when the circuit structure changed.
  useEffect(() => {
    const cur = sim.current;
    if (!cur) return;
    if (!extracted.netlist) {
      reset();
      return;
    }
    if (structureKey(extracted.netlist, doc) === cur.key) {
      for (const e of extracted.netlist.elements) {
        if (e.type !== 'SW') continue;
        const live = cur.simulator.netlist.elements.find((x) => x.id === e.id);
        if (live && live.type === 'SW') live.closed = e.closed;
      }
    } else {
      const wasRunning = status === 'running';
      cancelAnimationFrame(raf.current);
      if (build() && wasRunning) raf.current = requestAnimationFrame(loop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extracted]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return {
    status,
    errorKey,
    frame,
    solution: solution.current,
    scope: scope.current,
    segLevels: segLevels.current,
    serial: rig.current?.serial ?? '',
    sendSerial,
    sendSerialBytes,
    setSerialTap,
    displays: rig.current?.displays ?? [],
    touchDisplay,
    clearSerial,
    traces,
    time: solution.current?.time ?? 0,
    run,
    stop,
    reset,
    operatingPoint,
  };
}
