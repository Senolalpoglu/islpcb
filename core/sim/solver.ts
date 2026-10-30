// Modified Nodal Analysis circuit solver (DC operating point + transient).
// Node 0 is ground. Current convention for every element: positive current flows a -> b
// through the element, so power absorbed = (v[a] - v[b]) * i (negative for a source delivering power).

export type Waveform =
  | { kind: 'dc'; value: number }
  | { kind: 'sin'; offset: number; amp: number; freq: number; phase?: number }
  | { kind: 'pulse'; low: number; high: number; period: number; duty: number; delay?: number }
  | { kind: 'tri'; low: number; high: number; period: number; delay?: number }
  /** Amplitude-modulated carrier: amp * (1 + depth * sin(2 pi mod t)) * sin(2 pi freq t). */
  | { kind: 'am'; amp: number; freq: number; mod: number; depth: number };

export type Element =
  | { type: 'R'; id: string; a: number; b: number; r: number }
  | { type: 'C'; id: string; a: number; b: number; c: number; ic?: number }
  | { type: 'L'; id: string; a: number; b: number; l: number }
  | { type: 'V'; id: string; a: number; b: number; wave: Waveform }
  | { type: 'I'; id: string; a: number; b: number; wave: Waveform }
  /** Diode. With `bv` it also conducts in reverse breakdown (a Zener): `ibv` amps flow at -bv volts. */
  | { type: 'D'; id: string; a: number; b: number; is?: number; n?: number; bv?: number; ibv?: number }
  | { type: 'SW'; id: string; a: number; b: number; closed: boolean; ron?: number; roff?: number }
  /** Bipolar transistor, Ebers-Moll. a = collector, b = emitter, c = base. */
  | { type: 'Q'; id: string; a: number; b: number; c: number; npn: boolean; is?: number; bf?: number; br?: number }
  /** MOSFET, level 1 square law (beta = kp * W / L). a = drain, b = source, c = gate. */
  | { type: 'M'; id: string; a: number; b: number; c: number; nmos: boolean; beta?: number; vth?: number; lambda?: number }
  /**
   * Microcontroller pin: a voltage `v` behind conductance `g` to the node `a` (b is ground). g = 0 is high
   * impedance. The co-simulation rewrites v and g between steps, like a switch changing state.
   */
  | { type: 'PIN'; id: string; a: number; b: number; v: number; g: number }
  /**
   * Op-amp. a = output, b = inverting input, c = non-inverting input. Without supply nodes the output swings
   * +-vmax around ground; with p / n (positive and negative supply) it swings between the rails, minus `headroom`.
   */
  | { type: 'OA'; id: string; a: number; b: number; c: number; gain?: number; vmax?: number; rout?: number; p?: number; n?: number; headroom?: number; headroomLo?: number }
  /** Voltage-controlled switch between a and b, closed while v(c) - v(d) is above `vth` (with hysteresis `vhys`). */
  | { type: 'VSW'; id: string; a: number; b: number; c: number; d: number; vth?: number; vhys?: number; ron?: number; roff?: number; inv?: boolean }
  /**
   * Latching switch (thyristor, or triac with `bidir`) between a (anode / MT2) and b (cathode / MT1), fired by the
   * gate c: it closes when v(c) - v(b) passes `vgt` while the main terminals are biased, and stays closed until
   * the current through it falls below the holding current `ih`.
   */
  | { type: 'THY'; id: string; a: number; b: number; c: number; vgt?: number; ih?: number; ron?: number; roff?: number; bidir?: boolean }
  /** Voltage-controlled current source: i = gm * (v(c) - v(d)) flows from a to b through the element. */
  | { type: 'G'; id: string; a: number; b: number; c: number; d: number; gm: number };

export interface Netlist {
  /** Number of nodes including ground (node 0). */
  nodeCount: number;
  elements: Element[];
}

export interface Solution {
  time: number;
  /** Node voltages, index 0 is ground (always 0). */
  v: Float64Array;
  /** Current through each element (a -> b), keyed by element id. */
  i: Record<string, number>;
  /** Power absorbed by each element in watts, keyed by element id. */
  p: Record<string, number>;
  /** Current into each terminal of three-terminal elements (Q: C,B,E; M: D,G,S; OA: out,-,+), keyed by id. */
  terminals: Record<string, number[]>;
  converged: boolean;
}

const VT = 0.025852;
const GMIN = 1e-12;
const MAX_ITER = 150;

export function waveValue(w: Waveform, t: number): number {
  switch (w.kind) {
    case 'dc':
      return w.value;
    case 'sin':
      return w.offset + w.amp * Math.sin(2 * Math.PI * w.freq * t + (w.phase ?? 0));
    case 'pulse': {
      const td = w.delay ?? 0;
      if (t < td) return w.low;
      const ph = ((t - td) % w.period) / w.period;
      return ph < w.duty ? w.high : w.low;
    }
    case 'tri': {
      const td = w.delay ?? 0;
      if (t < td) return w.low;
      const ph = ((t - td) % w.period) / w.period;
      return w.low + (w.high - w.low) * (ph < 0.5 ? 2 * ph : 2 * (1 - ph));
    }
    case 'am':
      return w.amp * (1 + w.depth * Math.sin(2 * Math.PI * w.mod * t)) * Math.sin(2 * Math.PI * w.freq * t);
  }
}

/** Solves A x = b in place with partial pivoting. Returns false if the matrix is singular. */
function gaussSolve(A: Float64Array, b: Float64Array, n: number): boolean {
  for (let col = 0; col < n; col++) {
    let piv = col;
    let max = Math.abs(A[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const m = Math.abs(A[r * n + col]);
      if (m > max) {
        max = m;
        piv = r;
      }
    }
    if (max < 1e-300) return false;
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const t = A[col * n + k];
        A[col * n + k] = A[piv * n + k];
        A[piv * n + k] = t;
      }
      const t = b[col];
      b[col] = b[piv];
      b[piv] = t;
    }
    const d = A[col * n + col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) A[r * n + k] -= f * A[col * n + k];
      b[r] -= f * b[col];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * n + k] * b[k];
    b[r] = s / A[r * n + r];
  }
  return true;
}

function pnjlim(vnew: number, vold: number, vt: number, vcrit: number): number {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / vt;
      return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vnew / vt);
  }
  return vnew;
}

function bjtEval(is: number, bf: number, br: number, vbe: number, vbc: number) {
  const e1 = Math.exp(Math.min(vbe / VT, 80));
  const e2 = Math.exp(Math.min(vbc / VT, 80));
  const iF = is * (e1 - 1);
  const iR = is * (e2 - 1);
  const gf = (is * e1) / VT;
  const gr = (is * e2) / VT;
  return {
    ic: iF - iR * (1 + 1 / br),
    ib: iF / bf + iR / br,
    icBe: gf,
    icBc: -gr * (1 + 1 / br),
    ibBe: gf / bf,
    ibBc: gr / br,
  };
}

/** Square-law MOSFET in the n-channel frame (vgs, vds >= 0). */
function mosEval(beta: number, vth: number, lambda: number, vgs: number, vds: number) {
  const vov = vgs - vth;
  if (vov <= 0) return { id: 0, gm: 0, gds: 1e-12 };
  const clm = 1 + lambda * vds;
  if (vds < vov) {
    const core = vov * vds - (vds * vds) / 2;
    return { id: beta * core * clm, gm: beta * vds * clm, gds: beta * (vov - vds) * clm + beta * core * lambda + 1e-12 };
  }
  return { id: (beta / 2) * vov * vov * clm, gm: beta * vov * clm, gds: (beta / 2) * vov * vov * lambda + 1e-12 };
}

/** Which of the labelled drain/source is the electrical drain, and the device operating point. */
function mosState(e: Extract<Element, { type: 'M' }>, vD: number, vG: number, vS: number) {
  const s = e.nmos ? 1 : -1;
  const swapped = s * (vD - vS) < 0;
  const vDe = swapped ? vS : vD;
  const vSe = swapped ? vD : vS;
  const vgs = s * (vG - vSe);
  const vds = s * (vDe - vSe);
  const ev = mosEval(e.beta ?? 0.02, e.vth ?? 2, e.lambda ?? 0, vgs, vds);
  return { s, swapped, vDe, vSe, ...ev };
}

/**
 * Open-loop transfer of an op-amp: the output tries to reach `target`. `slope` is d target / d vd, and dtp / dtn
 * are the sensitivities to the positive and negative supply (zero for the legacy +-vmax model).
 */
function opampTarget(e: Extract<Element, { type: 'OA' }>, vd: number, vp = 0, vn = 0, scale = 1) {
  const gain = (e.gain ?? 1e5) * scale;
  if (e.p === undefined) {
    const vmax = e.vmax ?? 12;
    const th = Math.tanh((gain * vd) / vmax);
    return { target: vmax * th, slope: gain * (1 - th * th), dtp: 0, dtn: 0, half: vmax, gain };
  }
  const hr = e.headroom ?? 0;
  const hi = vp - hr;
  const lo = vn + (e.headroomLo ?? hr);
  if (hi - lo < 1e-6) return { target: (hi + lo) / 2, slope: 0, dtp: 0.5, dtn: 0.5, half: 0, gain };
  const half = (hi - lo) / 2;
  const x = (gain * vd) / half;
  const th = Math.tanh(x);
  const sech2 = 1 - th * th;
  const dHalf = th - x * sech2; // d target / d half
  return { target: (hi + lo) / 2 + half * th, slope: gain * sech2, dtp: 0.5 + 0.5 * dHalf, dtn: 0.5 - 0.5 * dHalf, half, gain };
}

export class Simulator {
  readonly netlist: Netlist;
  private readonly nNode: number;
  private readonly branchOf = new Map<string, number>();
  private readonly size: number;
  /** Limited junction voltages from the previous Newton iteration: D -> [vd], Q -> [vbe, vbc]. */
  private readonly junc = new Map<string, number[]>();
  private readonly nonlinear: boolean;
  /** State of every voltage-controlled switch; updated after each accepted solution. */
  private readonly swOn = new Map<string, boolean>();
  private gmin = GMIN;
  /** Temporary scale on every op-amp gain while a hard circuit is being walked towards its solution. */
  private gainScale = 1;
  /** Control voltage each op-amp was linearised at in the previous Newton iteration (see the OA stamp). */
  private readonly oaVd = new Map<string, number>();
  private readonly hasOpamp: boolean;
  // Reactive element history (previous accepted step).
  private readonly capV = new Map<string, number>();
  private readonly capI = new Map<string, number>();
  private readonly indI = new Map<string, number>();
  private readonly indV = new Map<string, number>();
  private x: Float64Array;
  /** Set when a junction voltage was clamped during stamping; the iteration cannot have converged yet. */
  private limited = false;
  private dt = 0;
  private firstStep = true;
  time = 0;

  constructor(netlist: Netlist) {
    this.netlist = netlist;
    this.nNode = netlist.nodeCount - 1;
    let nb = 0;
    this.nonlinear = netlist.elements.some((e) => e.type === 'D' || e.type === 'Q' || e.type === 'M' || e.type === 'OA');
    this.hasOpamp = netlist.elements.some((e) => e.type === 'OA');
    for (const e of netlist.elements) {
      if (e.type === 'V' || e.type === 'L') this.branchOf.set(e.id, this.nNode + nb++);
    }
    this.resetJunctions();
    this.size = this.nNode + nb;
    this.x = new Float64Array(this.size);
  }

  private resetJunctions(): void {
    for (const e of this.netlist.elements) {
      if (e.type === 'D') this.junc.set(e.id, [0]);
      else if (e.type === 'Q') this.junc.set(e.id, [0, 0]);
    }
  }

  /** DC operating point: capacitors open, inductors short, sources at t = 0. */
  operatingPoint(): Solution {
    this.time = 0;
    let sol = this.solveOperatingPoint();
    // Switches follow the circuit: settle their states (a few passes are enough for sane circuits).
    for (let pass = 0; pass < 4 && this.updateSwitches(sol); pass++) sol = this.solveOperatingPoint();
    return sol;
  }

  private solveOperatingPoint(): Solution {
    this.gmin = GMIN;
    let ok = this.newtonRobust(0, 0, 'op');
    if (!ok && this.nonlinear) {
      // Gmin stepping: solve with a heavy conductance to ground first, then relax it.
      this.x.fill(0);
      this.resetJunctions();
      for (const g of [1e-3, 1e-5, 1e-7, 1e-9, GMIN]) {
        this.gmin = g;
        ok = this.newtonRobust(0, 0, 'op');
        if (!ok) break;
      }
      this.gmin = GMIN;
    }
    return this.collect(ok, 0, 'op');
  }

  /** Whether a voltage-controlled switch currently conducts (its control state, flipped for normally-closed ones). */
  private swClosed(e: Extract<Element, { type: 'VSW' }>): boolean {
    return (this.swOn.get(e.id) ?? false) !== (e.inv === true);
  }

  /** Re-evaluates every voltage-controlled switch against a solution. Returns true if any changed. */
  private updateSwitches(sol: Solution): boolean {
    let changed = false;
    for (const e of this.netlist.elements) {
      if (e.type === 'THY') {
        const was = this.swOn.get(e.id) ?? false;
        const vab = sol.v[e.a] - sol.v[e.b];
        const vg = sol.v[e.c] - sol.v[e.b];
        const forward = e.bidir ? Math.abs(vab) : vab;
        const fired = (e.bidir ? Math.abs(vg) : vg) > (e.vgt ?? 0.8);
        // Off: fires when the gate is driven while the main terminals are biased. On: drops out below the holding current.
        const i = e.bidir ? Math.abs(vab) / (e.ron ?? 0.05) : vab / (e.ron ?? 0.05);
        const now = was ? i >= (e.ih ?? 5e-3) : fired && forward > 0.3;
        if (now !== was) {
          this.swOn.set(e.id, now);
          changed = true;
        }
        continue;
      }
      if (e.type !== 'VSW') continue;
      const v = sol.v[e.c] - sol.v[e.d];
      const th = e.vth ?? 2.5;
      const hys = e.vhys ?? 0.1;
      const was = this.swOn.get(e.id) ?? false;
      const now = was ? v > th - hys / 2 : v > th + hys / 2;
      if (now !== was) {
        this.swOn.set(e.id, now);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Prepares transient analysis with fixed step dt.
   * With uic the DC solution is skipped and capacitors start at their `ic` voltage (default 0).
   */
  beginTransient(dt: number, uic = false): Solution {
    this.dt = dt;
    this.time = 0;
    this.firstStep = true;
    this.capV.clear();
    this.capI.clear();
    this.indI.clear();
    this.indV.clear();
    if (uic) {
      this.x.fill(0);
      for (const e of this.netlist.elements) {
        if (e.type === 'C') {
          this.capV.set(e.id, e.ic ?? 0);
          this.capI.set(e.id, 0);
        }
        if (e.type === 'L') {
          this.indI.set(e.id, 0);
          this.indV.set(e.id, 0);
        }
      }
      return this.collect(true, 0, 'op');
    }
    const sol = this.operatingPoint();
    this.commitHistory(sol);
    return sol;
  }

  /** Advances the transient simulation by one time step. */
  step(): Solution {
    const t0 = this.time;
    const dt = this.dt;
    const t = t0 + dt;
    const from = this.x.slice();
    const wasFirst = this.firstStep;
    const hist = [new Map(this.capV), new Map(this.capI), new Map(this.indI), new Map(this.indV)];
    let ok = this.newtonRobust(t, dt, 'tran');
    let sol = this.collect(ok, t, 'tran');
    if (!ok && this.nonlinear) {
      // A latch that flips or a stage that switches hard can defeat Newton over a whole step: take the same
      // interval in smaller pieces, each one starting from a state close to its answer.
      const restore = (): void => {
        this.x = from.slice();
        this.firstStep = wasFirst;
        this.dt = dt;
        [this.capV, this.capI, this.indI, this.indV].forEach((m, k) => {
          m.clear();
          hist[k].forEach((v, key) => m.set(key, v));
        });
      };
      for (const pieces of [4, 16, 64]) {
        restore();
        const h = dt / pieces;
        this.dt = h;
        let good = true;
        for (let k = 1; k <= pieces && good; k++) {
          const tk = t0 + k * h;
          good = this.newtonRobust(tk, h, 'tran');
          sol = this.collect(good, tk, 'tran');
          if (k < pieces && good) {
            this.commitHistory(sol);
            this.updateSwitches(sol);
          }
          this.firstStep = false;
        }
        this.dt = dt;
        ok = good;
        if (ok) break;
      }
      if (!ok) {
        // Last resort, and the way in from an all-zero start: walk in from a heavy gmin. It forgets a latch's
        // state, so it only runs when splitting the step did not help.
        restore();
        for (const g of [1e-3, 1e-5, 1e-7, 1e-9, GMIN]) {
          this.gmin = g;
          ok = this.newtonRobust(t, dt, 'tran');
          if (!ok) break;
        }
        this.gmin = GMIN;
        if (!ok && wasFirst) {
          // A cold start that cannot be walked in: begin from the DC operating point instead (capacitors charged to their
          // steady state), which a circuit like that has even when it has no way up from all zeros.
          restore();
          const dc = this.solveOperatingPoint();
          if (dc.converged) {
            this.commitHistory(dc);
            ok = this.newtonRobust(t, dt, 'tran');
          }
        }
        if (!ok) restore();
        sol = this.collect(ok, t, 'tran');
      }
    }
    this.commitHistory(sol);
    this.updateSwitches(sol);
    this.time = t;
    this.firstStep = false;
    return sol;
  }

  private commitHistory(sol: Solution): void {
    for (const e of this.netlist.elements) {
      if (e.type === 'C') {
        this.capV.set(e.id, sol.v[e.a] - sol.v[e.b]);
        this.capI.set(e.id, sol.i[e.id]);
      } else if (e.type === 'L') {
        this.indI.set(e.id, sol.i[e.id]);
        this.indV.set(e.id, sol.v[e.a] - sol.v[e.b]);
      }
    }
  }

  /**
   * Newton from the current state; when an op-amp circuit hops between the rails instead of converging, retry
   * with the gains turned down and bring them back up step by step, each solution seeding the next.
   */
  private newtonRobust(t: number, dt: number, mode: 'op' | 'tran'): boolean {
    const start = this.x.slice();
    if (this.newton(t, dt, mode)) return true;
    if (!this.hasOpamp) return false;
    this.x = start;
    let ok = true;
    for (const scale of [1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 0.1, 0.3, 1]) {
      this.gainScale = scale;
      ok = this.newton(t, dt, mode);
      if (!ok) break;
    }
    this.gainScale = 1;
    return ok;
  }

  private newton(t: number, dt: number, mode: 'op' | 'tran'): boolean {
    const n = this.size;
    if (n === 0) return true;
    const hasNonlinear = this.nonlinear;
    const iterMax = hasNonlinear ? MAX_ITER : 1;
    let prev = this.x.slice();
    this.oaVd.clear();
    for (let iter = 0; iter < iterMax; iter++) {
      const A = new Float64Array(n * n);
      const rhs = new Float64Array(n);
      this.limited = false;
      this.stamp(A, rhs, t, dt, mode);
      if (!gaussSolve(A, rhs, n)) return false;
      // A circuit that has not settled after a few iterations is probably hopping between two states (the
      // two rails of a saturating gain stage, a latch): averaging old and new damps that out.
      if (hasNonlinear && iter >= 8) for (let k = 0; k < n; k++) rhs[k] = prev[k] + 0.5 * (rhs[k] - prev[k]);
      this.x = rhs;
      if (!hasNonlinear) return true;
      let maxErr = 0;
      for (let k = 0; k < n; k++) {
        const tol = 1e-6 + 1e-6 * Math.abs(this.x[k]);
        maxErr = Math.max(maxErr, Math.abs(this.x[k] - prev[k]) / tol);
      }
      if (iter > 0 && !this.limited && maxErr <= 1) return true;
      prev = this.x.slice();
    }
    return false;
  }

  private nodeV(k: number): number {
    return k === 0 ? 0 : this.x[k - 1];
  }

  private stamp(A: Float64Array, rhs: Float64Array, t: number, dt: number, mode: 'op' | 'tran'): void {
    const n = this.size;
    const g = (a: number, b: number, val: number): void => {
      if (a > 0) A[(a - 1) * n + (a - 1)] += val;
      if (b > 0) A[(b - 1) * n + (b - 1)] += val;
      if (a > 0 && b > 0) {
        A[(a - 1) * n + (b - 1)] -= val;
        A[(b - 1) * n + (a - 1)] -= val;
      }
    };
    /** Current source of value `i` flowing a -> b through the element. */
    const cur = (a: number, b: number, i: number): void => {
      if (a > 0) rhs[a - 1] -= i;
      if (b > 0) rhs[b - 1] += i;
    };
    const branch = (a: number, b: number, row: number, series: number, volt: number): void => {
      if (a > 0) {
        A[(a - 1) * n + row] += 1;
        A[row * n + (a - 1)] += 1;
      }
      if (b > 0) {
        A[(b - 1) * n + row] -= 1;
        A[row * n + (b - 1)] -= 1;
      }
      A[row * n + row] -= series;
      rhs[row] = volt;
    };

    /** Stamps a linearised multi-terminal device: row t gets G[t][*] and constant c[t]. */
    const device = (nodes: number[], G: number[][], c: number[]): void => {
      nodes.forEach((row, t) => {
        if (row === 0) return;
        nodes.forEach((col, j) => {
          if (col !== 0) A[(row - 1) * n + (col - 1)] += G[t][j];
        });
        rhs[row - 1] -= c[t];
      });
    };

    for (let k = 1; k <= this.nNode; k++) g(k, 0, this.gmin);

    for (const e of this.netlist.elements) {
      switch (e.type) {
        case 'R':
          g(e.a, e.b, 1 / e.r);
          break;
        case 'SW':
          g(e.a, e.b, e.closed ? 1 / (e.ron ?? 1e-3) : 1 / (e.roff ?? 1e9));
          break;
        case 'VSW':
          g(e.a, e.b, this.swClosed(e) ? 1 / (e.ron ?? 1e-2) : 1 / (e.roff ?? 1e9));
          break;
        case 'THY':
          g(e.a, e.b, this.swOn.get(e.id) ? 1 / (e.ron ?? 0.05) : 1 / (e.roff ?? 1e9));
          break;
        case 'G': {
          // KCL at a: + gm (vc - vd); at b: - gm (vc - vd).
          const put = (row: number, col: number, val: number): void => {
            if (row > 0 && col > 0) A[(row - 1) * n + (col - 1)] += val;
          };
          put(e.a, e.c, e.gm);
          put(e.a, e.d, -e.gm);
          put(e.b, e.c, -e.gm);
          put(e.b, e.d, e.gm);
          break;
        }
        case 'I':
          cur(e.a, e.b, waveValue(e.wave, t));
          break;
        case 'PIN':
          if (e.g > 0) {
            g(e.a, e.b, e.g);
            cur(e.b, e.a, e.g * e.v); // Norton source pushing current into the pin's net
          }
          break;
        case 'V':
          branch(e.a, e.b, this.branchOf.get(e.id)!, 0, waveValue(e.wave, t));
          break;
        case 'C': {
          if (mode === 'op') break;
          const vPrev = this.capV.get(e.id) ?? 0;
          const iPrev = this.capI.get(e.id) ?? 0;
          // Backward Euler on the first step, trapezoidal afterwards.
          const geq = ((this.firstStep ? 1 : 2) * e.c) / dt;
          const ieq = this.firstStep ? geq * vPrev : geq * vPrev + iPrev;
          g(e.a, e.b, geq);
          cur(e.a, e.b, -ieq);
          break;
        }
        case 'L': {
          const row = this.branchOf.get(e.id)!;
          if (mode === 'op') {
            branch(e.a, e.b, row, 0, 0);
            break;
          }
          const iPrev = this.indI.get(e.id) ?? 0;
          const vPrev = this.indV.get(e.id) ?? 0;
          const req = ((this.firstStep ? 1 : 2) * e.l) / dt;
          const veq = this.firstStep ? req * iPrev : req * iPrev + vPrev;
          branch(e.a, e.b, row, req, -veq);
          break;
        }
        case 'D': {
          const st = this.junc.get(e.id)!;
          const is = e.is ?? 1e-14;
          const vt = (e.n ?? 1) * VT;
          const vcrit = vt * Math.log(vt / (Math.SQRT2 * is));
          const vRaw = this.nodeV(e.a) - this.nodeV(e.b);
          let vd: number;
          if (e.bv !== undefined && vRaw < -e.bv) {
            // Reverse breakdown: limit the step like a forward junction, mirrored about -bv.
            const ibv = e.ibv ?? 1e-3;
            const vcritB = vt * Math.log(vt / (Math.SQRT2 * ibv));
            const old = -(st[0] + e.bv);
            vd = -pnjlim(-(vRaw + e.bv), Math.max(old, 0), vt, vcritB) - e.bv;
          } else vd = pnjlim(vRaw, st[0], vt, vcrit);
          if (vd !== vRaw) this.limited = true;
          st[0] = vd;
          const ex = Math.exp(Math.min(vd / vt, 80));
          let id = is * (ex - 1);
          let gd = (is * ex) / vt + GMIN;
          if (e.bv !== undefined) {
            const ibv = e.ibv ?? 1e-3;
            const eb = Math.exp(Math.min(-(vd + e.bv) / vt, 80));
            id -= ibv * eb;
            gd += (ibv * eb) / vt;
          }
          g(e.a, e.b, gd);
          cur(e.a, e.b, id - gd * vd);
          break;
        }
        case 'Q': {
          const st = this.junc.get(e.id)!;
          const s = e.npn ? 1 : -1;
          const is = e.is ?? 1e-14;
          const vcrit = VT * Math.log(VT / (Math.SQRT2 * is));
          const vB = this.nodeV(e.c);
          const rawBe = s * (vB - this.nodeV(e.b));
          const rawBc = s * (vB - this.nodeV(e.a));
          const vbe = pnjlim(rawBe, st[0], VT, vcrit);
          const vbc = pnjlim(rawBc, st[1], VT, vcrit);
          if (vbe !== rawBe || vbc !== rawBc) this.limited = true;
          st[0] = vbe;
          st[1] = vbc;
          const m = bjtEval(is, e.bf ?? 100, e.br ?? 1, vbe, vbc);
          const cC = s * (m.ic - m.icBe * vbe - m.icBc * vbc);
          const cB = s * (m.ib - m.ibBe * vbe - m.ibBc * vbc);
          // Terminals: collector, base, emitter. Columns follow the same order.
          device(
            [e.a, e.c, e.b],
            [
              [-m.icBc, m.icBe + m.icBc, -m.icBe],
              [-m.ibBc, m.ibBe + m.ibBc, -m.ibBe],
              [m.icBc + m.ibBc, -(m.icBe + m.icBc + m.ibBe + m.ibBc), m.icBe + m.ibBe],
            ],
            [cC, cB, -(cC + cB)],
          );
          break;
        }
        case 'M': {
          const m = mosState(e, this.nodeV(e.a), this.nodeV(e.c), this.nodeV(e.b));
          const dn = m.swapped ? e.b : e.a;
          const sn = m.swapped ? e.a : e.b;
          const vG = this.nodeV(e.c);
          const cD = m.s * m.id - (m.gds * m.vDe + m.gm * vG - (m.gm + m.gds) * m.vSe);
          device(
            [dn, e.c, sn],
            [
              [m.gds, m.gm, -(m.gm + m.gds)],
              [0, 0, 0],
              [-m.gds, -m.gm, m.gm + m.gds],
            ],
            [cD, 0, -cD],
          );
          break;
        }
        case 'OA': {
          const rout = e.rout ?? 50;
          let vd = this.nodeV(e.c) - this.nodeV(e.b);
          const vp = e.p === undefined ? 0 : this.nodeV(e.p);
          const vn = this.nodeV(e.n ?? 0);
          let { target, slope, dtp, dtn, half, gain } = opampTarget(e, vd, vp, vn, this.gainScale);
          // A saturated stage has no slope to follow, so Newton throws the control voltage from one side of the
          // linear region to the other and back. When it does that, linearise in the middle of the linear region
          // instead (vd = 0): that is where a feedback loop settles.
          const raw = vd;
          const last = this.oaVd.get(e.id);
          if (last !== undefined && half > 0 && last * raw < 0 && Math.abs(gain * raw) > 2 * half && Math.abs(gain * last) > 2 * half) {
            vd = 0;
            ({ target, slope, dtp, dtn } = opampTarget(e, vd, vp, vn, this.gainScale));
            this.limited = true;
          }
          this.oaVd.set(e.id, raw);
          device(
            [e.a, e.b, e.c, e.p ?? 0, e.n ?? 0],
            [
              [1 / rout, slope / rout, -slope / rout, -dtp / rout, -dtn / rout],
              [0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0],
            ],
            [(slope * vd + dtp * vp + dtn * vn - target) / rout, 0, 0, 0, 0],
          );
          break;
        }
      }
    }
  }

  private collect(converged: boolean, t: number, mode: 'op' | 'tran'): Solution {
    const v = new Float64Array(this.netlist.nodeCount);
    for (let k = 1; k < v.length; k++) v[k] = this.x[k - 1] ?? 0;
    const i: Record<string, number> = {};
    const p: Record<string, number> = {};
    const terminals: Record<string, number[]> = {};
    for (const e of this.netlist.elements) {
      const vab = v[e.a] - v[e.b];
      let cur = 0;
      let power: number | undefined;
      switch (e.type) {
        case 'R':
          cur = vab / e.r;
          break;
        case 'SW':
          cur = vab * (e.closed ? 1 / (e.ron ?? 1e-3) : 1 / (e.roff ?? 1e9));
          break;
        case 'I':
          cur = waveValue(e.wave, t);
          break;
        case 'PIN':
          // Current flowing from the net into the pin; negative while the pin sources current.
          cur = e.g > 0 ? e.g * (vab - e.v) : 0;
          break;
        case 'V':
        case 'L':
          cur = this.x[this.branchOf.get(e.id)!];
          break;
        case 'C': {
          if (mode === 'op') break;
          const vPrev = this.capV.get(e.id) ?? 0;
          const iPrev = this.capI.get(e.id) ?? 0;
          const geq = ((this.firstStep ? 1 : 2) * e.c) / this.dt;
          const ieq = this.firstStep ? geq * vPrev : geq * vPrev + iPrev;
          cur = geq * vab - ieq;
          break;
        }
        case 'D': {
          const is = e.is ?? 1e-14;
          const vt = (e.n ?? 1) * VT;
          cur = is * (Math.exp(Math.min(vab / vt, 80)) - 1);
          if (e.bv !== undefined) cur -= (e.ibv ?? 1e-3) * Math.exp(Math.min(-(vab + e.bv) / vt, 80));
          break;
        }
        case 'VSW':
          cur = vab * (this.swClosed(e) ? 1 / (e.ron ?? 1e-2) : 1 / (e.roff ?? 1e9));
          break;
        case 'THY':
          cur = vab * (this.swOn.get(e.id) ? 1 / (e.ron ?? 0.05) : 1 / (e.roff ?? 1e9));
          break;
        case 'G':
          cur = e.gm * (v[e.c] - v[e.d]);
          break;
        case 'Q': {
          const s = e.npn ? 1 : -1;
          const m = bjtEval(e.is ?? 1e-14, e.bf ?? 100, e.br ?? 1, s * (v[e.c] - v[e.b]), s * (v[e.c] - v[e.a]));
          const term = [s * m.ic, s * m.ib, -s * (m.ic + m.ib)];
          terminals[e.id] = term;
          cur = term[0];
          power = v[e.a] * term[0] + v[e.c] * term[1] + v[e.b] * term[2];
          break;
        }
        case 'M': {
          const m = mosState(e, v[e.a], v[e.c], v[e.b]);
          const iDe = m.s * m.id; // current into the electrical drain
          const term = m.swapped ? [-iDe, 0, iDe] : [iDe, 0, -iDe];
          terminals[e.id] = term;
          cur = term[0];
          power = v[e.a] * term[0] + v[e.b] * term[2];
          break;
        }
        case 'OA': {
          const { target } = opampTarget(e, v[e.c] - v[e.b], e.p === undefined ? 0 : v[e.p], v[e.n ?? 0]);
          const iOut = (v[e.a] - target) / (e.rout ?? 50);
          terminals[e.id] = [iOut, 0, 0];
          cur = iOut;
          power = v[e.a] * iOut;
          break;
        }
      }
      i[e.id] = cur;
      p[e.id] = power ?? vab * cur;
    }
    return { time: t, v, i, p, terminals, converged };
  }
}
