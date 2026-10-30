// SVG symbols drawn in local pixel coordinates around the part origin (rotation 0).

import type { ReactNode } from 'react';
import { PART_DEFS, type PartDef, type PartType } from './model';

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Hit-test box in grid units, local to the part at rotation 0. */
export const BBOX: Record<PartType, BBox> = {
  R: { x0: -2, y0: -0.8, x1: 2, y1: 0.8 },
  C: { x0: -2, y0: -0.8, x1: 2, y1: 0.8 },
  L: { x0: -2, y0: -0.8, x1: 2, y1: 0.8 },
  D: { x0: -2, y0: -0.8, x1: 2, y1: 0.8 },
  LED: { x0: -2, y0: -1.2, x1: 2, y1: 0.8 },
  SW: { x0: -2, y0: -0.9, x1: 2, y1: 0.6 },
  VDC: { x0: -0.9, y0: -2, x1: 0.9, y1: 2 },
  VAC: { x0: -0.9, y0: -2, x1: 0.9, y1: 2 },
  VPULSE: { x0: -0.9, y0: -2, x1: 0.9, y1: 2 },
  IDC: { x0: -0.9, y0: -2, x1: 0.9, y1: 2 },
  GND: { x0: -0.9, y0: -0.3, x1: 0.9, y1: 1.2 },
  PROBE: { x0: -0.6, y0: -0.6, x1: 0.6, y1: 0.6 },
  QNPN: { x0: -2, y0: -2, x1: 2.2, y1: 2 },
  QPNP: { x0: -2, y0: -2, x1: 2.2, y1: 2 },
  NMOS: { x0: -2, y0: -2, x1: 2.2, y1: 2 },
  PMOS: { x0: -2, y0: -2, x1: 2.2, y1: 2 },
  OPAMP: { x0: -3, y0: -1.8, x1: 3, y1: 1.8 },
  ARDUINO_UNO: { x0: -4, y0: -8, x1: 4, y1: 10 },
  ARDUINO_NANO: { x0: -4, y0: -8, x1: 4, y1: 8 },
  ARDUINO_MEGA: { x0: -4, y0: -29, x1: 4, y1: 28 },
  PICO_W: { x0: -4, y0: -11, x1: 4, y1: 10 },
  PICO: { x0: -4, y0: -11, x1: 4, y1: 10 },
  PIC16F84A: { x0: -4, y0: -6, x1: 4, y1: 5 },
  PIC16F628A: { x0: -4, y0: -6, x1: 4, y1: 5 },
  PIC16F877A: { x0: -4, y0: -11, x1: 4, y1: 10 },
};

/** Open arrow head with its tip at (tx, ty), pointing along (dx, dy). */
function arrow(tx: number, ty: number, dx: number, dy: number): string {
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const back = (ang: number): string => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return `${(tx - 9 * (ux * c - uy * s)).toFixed(1)} ${(ty - 9 * (ux * s + uy * c)).toFixed(1)}`;
  };
  return `M${back(0.5)}L${tx} ${ty}L${back(-0.5)}`;
}

export const PROBE_COLORS = ['#f5c542', '#4cc9f0', '#ff6b9a', '#8ce99a', '#c77dff', '#ff9f43'];

interface Props {
  type: PartType;
  closed?: boolean;
  color?: string;
  /** How the symbol is turned on the sheet, so text can be kept upright and readable. */
  rot?: number;
  mirror?: boolean;
  /** Revolutions per second of a fan, motor or turbine; 0 or absent when it stands still. */
  spin?: number;
  /** Relay: the coil is energised, so the armature is pulled in. */
  pulled?: boolean;
}

/** Turns its children round the origin at `spin` revolutions per second (shown at 8 at most); still when 0. */
function Spinner({ spin, children }: { spin: number; children: ReactNode }) {
  if (!(spin > 0)) return <g>{children}</g>;
  const dur = 1 / Math.min(spin, 8);
  return (
    <g>
      {children}
      <animateTransform attributeName="transform" type="rotate" from="0 0 0" to="360 0 0" dur={`${dur.toFixed(3)}s`} repeatCount="indefinite" />
    </g>
  );
}

/** Transform for a piece of text that sits in a rotated / mirrored symbol but should read upright (angle 0 or -90). */
const uprightAngle = (rot: number): number => (rot % 180 === 0 ? 0 : -90);
const textFrame = (rot: number, mirror: boolean): string => `${mirror ? 'scale(-1 1) ' : ''}rotate(${uprightAngle(rot) - rot})`;

/**
 * A rectangle with the pin names inside and the part's title: microcontroller boards and data-defined ICs. The
 * names stay next to their pins and readable (never upside down) however the part is rotated or mirrored: they are
 * drawn in the page's orientation, horizontal when the part is turned 0 or 180 degrees and running upwards when it
 * is turned 90 or 270.
 */
function BoxSymbol({ def, rot = 0, mirror = false, picture = false }: { def: PartDef; rot?: number; mirror?: boolean; picture?: boolean }) {
  const ys = def.pins.map((p) => p.y);
  const half = Math.max(...def.pins.map((p) => Math.abs(p.x))) * 20;
  const top = Math.min(...ys) * 20 - 30;
  const bottom = Math.max(Math.max(...ys) * 20 + 20, picture ? top + PICTURE_HEIGHT : -Infinity);
  const title = def.mcu?.title ?? def.custom?.title ?? '';
  const W = (uprightAngle(rot) * Math.PI) / 180;
  const along = { x: Math.cos(W), y: Math.sin(W) }; // the direction the text runs in on the page
  const turn = (rot * Math.PI) / 180;
  const frame = textFrame(rot, mirror);
  /** Whether the text, starting at the pin side, runs inwards (then it starts there) or outwards (then it ends there). */
  const anchorFor = (pinSideX: number): 'start' | 'end' => {
    const inward = pinSideX < 0 ? 1 : -1;
    const nx = (mirror ? -inward : inward) * Math.cos(turn);
    const ny = (mirror ? -inward : inward) * Math.sin(turn);
    return nx * along.x + ny * along.y >= 0 ? 'start' : 'end';
  };
  return (
    <g>
      <rect x={-half} y={top} width={half * 2} height={bottom - top} rx={8} />
      <g stroke="none" fill="var(--sym)" fontSize={10} fontFamily="Segoe UI, sans-serif">
        <text transform={`translate(0 ${top + 16}) ${frame}`} textAnchor="middle" fontSize={12} fontWeight={700}>
          {title}
        </text>
        {def.pins.map((p, i) => (
          <text key={`${def.pinNames[i]}-${i}`} transform={`translate(${p.x < 0 ? -half + 8 : half - 8} ${p.y * 20}) ${frame}`} y={3.5} textAnchor={anchorFor(p.x)}>
            {def.pinNames[i]}
          </text>
        ))}
      </g>
    </g>
  );
}

/** Five-pin op-amp: inputs left, output right, supply above and below. */
function Opamp5() {
  return (
    <g>
      <path d="M-60 -20H-36M-60 20H-36M48 0H60M0 -40V-21M0 40V21" />
      <path d="M-36 -36L-36 36L48 0Z" />
      <path d="M-31 -20h8M-31 20h8M-27 16v8" strokeWidth={1.5} />
    </g>
  );
}

/** Drawn symbols for data-defined parts (see glyphs.ts for their pins). Coordinates are in pixels: one grid unit is 20. */
function Glyph({ name, rot = 0, mirror = false, spin = 0, pulled = false }: { name: string; rot?: number; mirror?: boolean; spin?: number; pulled?: boolean }) {
  switch (name) {
    case 'transformer-pct':
    case 'transformer-sct':
    case 'transformer-ct': {
      // Two six-turn coils facing an iron core; a centre tap is a lead from the middle of its coil.
      const pct = name !== 'transformer-sct';
      const sct = name !== 'transformer-pct';
      const left = pct ? 'M-40 -60H-16V-36M-40 60H-16V36M-40 0H-16' : 'M-40 -40H-16V-36M-40 40H-16V36';
      const right = sct ? 'M40 -60H16V-36M40 60H16V36M40 0H16' : 'M40 -40H16V-36M40 40H16V36';
      const arcs = 'a6 6 0 0 1 0 12'.repeat(6);
      return (
        <g>
          <path d={left} />
          <path d={right} />
          <path d={`M-16 -36${arcs}`} />
          <path d={`M16 -36${arcs.replaceAll(' 0 0 1 ', ' 0 0 0 ')}`} />
          <path d="M-3 -38V38M3 -38V38" />
          <circle cx={-26} cy={pct ? -52 : -34} r={2} fill="var(--sym)" stroke="none" />
          <circle cx={26} cy={sct ? -52 : -34} r={2} fill="var(--sym)" stroke="none" />
        </g>
      );
    }
    case 'loopstick':
      // Ferrite rod antenna: a long tuned coil, a few turns of coupling winding at one end, a dashed ferrite rod between.
      return (
        <g>
          <path d="M-40 -40H-16V-24M-40 40H-16V24M40 -40H16V-24M40 40H16V24" />
          <path d={`M-16 -24${'a6 6 0 0 1 0 12'.repeat(4)}`} />
          <path d={`M16 -24${'a6 6 0 0 0 0 12'.repeat(4)}`} />
          <path d="M0 -30V30" strokeWidth={5} strokeDasharray="6 3" strokeOpacity={0.55} />
        </g>
      );
    case 'lamp':
      // Bulb with crossed filament; the glass fills with light as it comes up to power.
      return (
        <g>
          <path d="M-40 0H-16M16 0H40" />
          <circle r={16} fill="#ffd23f" fillOpacity={pulled ? 0.15 + 0.8 * spin : 0} />
          <circle r={16} fill="none" />
          <path d="M-11.3 -11.3L11.3 11.3M-11.3 11.3L11.3 -11.3" stroke={pulled ? '#b36b00' : undefined} />
          {pulled && <circle r={22} fill="none" stroke="#ffd23f" strokeOpacity={0.5 * spin} strokeWidth={4} />}
        </g>
      );
    case 'neon':
      // Glass bulb with two electrodes; when it strikes, the gas glows orange.
      return (
        <g>
          <path d="M-40 0H-8M8 0H40" />
          <circle r={16} fill="#ff7a1a" fillOpacity={pulled ? 0.55 : 0} />
          <circle r={16} fill="none" />
          <path d="M-8 -9V9M8 -9V9" strokeWidth={2.4} />
          {pulled && <circle r={22} fill="none" stroke="#ff7a1a" strokeOpacity={0.45} strokeWidth={4} />}
        </g>
      );
    case 'piezo':
      // Piezoelectric crystal between two plates, with sound waves going off: an ultrasonic transducer.
      return (
        <g>
          <path d="M-40 0H-12M12 0H40M-12 -14V14M12 -14V14" />
          <rect x={-6} y={-10} width={12} height={20} />
          <path d="M-9 -22Q0 -30 9 -22M-14 -28Q0 -40 14 -28" strokeWidth={1.4} />
        </g>
      );
    case 'mic':
      // Electret capsule: a diaphragm and a back plate in a can; + is the output / supply pin.
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <path d="M-8 -6V6M-3 -9V9" strokeWidth={2} />
          <path d="M-3 0H12" strokeWidth={1.2} />
          <path d="M6 -26h8M10 -30v8" strokeWidth={1.4} />
        </g>
      );
    case 'cap-var':
    case 'cap-trim':
      return (
        <g>
          <path d="M-40 0H-5M5 0H40M-5 -14V14M5 -14V14" />
          <path d="M-16 16L16 -16" />
          <path d={arrow(16, -16, 1, -1)} />
          {name === 'cap-trim' && <path d="M10 -22L22 -10" />}
        </g>
      );
    case 'varicap':
      // A diode whose cathode is a capacitor plate: the junction capacitance is the part.
      return (
        <g>
          <path d="M-40 0H-8M8 0H12M16 0H40M16 -10V10" />
          <path d="M-8 -10L8 0L-8 10Z" />
          <path d="M8 -10V10" />
        </g>
      );
    case 'antenna':
      return (
        <g>
          <path d="M0 40V-34M0 -34L-14 -54M0 -34L14 -54" />
        </g>
      );
    case 'scr':
      return (
        <g>
          <path d="M40 -40V-14M40 40V12M-40 0H8L28 12" />
          <path d="M26 -14H54L40 12Z" />
          <path d="M26 12H54" />
        </g>
      );
    case 'triac':
      return (
        <g>
          <path d="M40 -40V-18M40 40V18M-40 0H10L28 14" />
          <path d="M27 -18H53L40 -2Z" />
          <path d="M27 18H53L40 2Z" />
          <path d="M27 -2H53M27 2H53" strokeWidth={1} />
        </g>
      );
    case 'diac':
      return (
        <g>
          <path d="M-40 0H-14M14 0H40" />
          <path d="M-14 -12V12L2 0ZM14 -12V12L-2 0Z" />
        </g>
      );
    case 'transformer':
      return (
        <g>
          <path d="M-40 -40H-16V-24M-40 40H-16V24M40 -40H16V-24M40 40H16V24" />
          <path d="M-16 -24a6 6 0 0 1 0 12a6 6 0 0 1 0 12a6 6 0 0 1 0 12a6 6 0 0 1 0 12" />
          <path d="M16 -24a6 6 0 0 0 0 12a6 6 0 0 0 0 12a6 6 0 0 0 0 12a6 6 0 0 0 0 12" />
          <path d="M-3 -26V26M3 -26V26" />
        </g>
      );
    case 'pushbutton':
      return (
        <g>
          <path d="M-40 0H-14M14 0H40M-14 -10H14M0 -10V-22M-8 -22H8" />
          <circle cx={-14} cy={0} r={2.5} />
          <circle cx={14} cy={0} r={2.5} />
        </g>
      );
    case 'spdt':
      return (
        <g>
          <path d="M-40 0H-18M40 -20H20M40 20H20M-18 0L16 -14" />
          <circle cx={-18} cy={0} r={2.5} />
          <circle cx={18} cy={-20} r={2.5} />
          <circle cx={18} cy={20} r={2.5} />
        </g>
      );
    case 'pot':
      return (
        <g>
          <path d="M-40 0H-18M18 0H40M0 -40V-20" />
          <rect x={-18} y={-7} width={36} height={14} />
          <path d="M0 -8L-4 -16M0 -8L4 -16" />
        </g>
      );
    case 'ldr':
    case 'ntc':
    case 'ptc':
    case 'varistor':
      return (
        <g>
          <path d="M-40 0H-18M18 0H40" />
          <rect x={-18} y={-7} width={36} height={14} />
          <path d={name === 'ldr' ? 'M-14 -26L-6 -14M-6 -26L2 -14' : 'M-22 13L22 -13'} />
          {name === 'ldr' && <path d="M-6 -14l-1 -5M2 -14l-5 -1M2 -14l0 -5" />}
          {name === 'ptc' && <path d="M22 -13h5" />}
        </g>
      );
    case 'fuse':
      return (
        <g>
          <path d="M-40 0H-18M18 0H40" />
          <rect x={-18} y={-6} width={36} height={12} />
          <path d="M-18 0H18" />
        </g>
      );
    case 'cap-polar':
      // Straight plate and "+" on the positive pin (left), curved plate on the negative pin.
      return (
        <g>
          <path d="M-40 0H-4M4 0H40M-4 -13V13M8 -13Q0 0 8 13" />
          <path d="M-20 -10h8M-16 -14v8" strokeWidth={1.4} />
        </g>
      );
    case 'cell':
      return (
        <g>
          <path d="M0 -40V-6M0 6V40M-14 -6H14M-8 6H8" />
          <path d="M-20 -16h6M-17 -19v6" strokeWidth={1.4} />
        </g>
      );
    case 'zener':
    case 'schottky':
      return (
        <g>
          <path d="M-40 0H-8M8 0H40" />
          <path d="M-8 -10L8 0L-8 10Z" />
          <path d={name === 'zener' ? 'M12 -14L8 -10V10L4 14' : 'M4 -14V-10H8V10H12V14'} />
        </g>
      );
    case 'speaker':
      return (
        <g>
          <path d="M-40 -20H-20M-40 20H-20" />
          <rect x={-20} y={-24} width={10} height={48} />
          <path d="M-10 -12L12 -26V26L-10 12" />
        </g>
      );
    case 'motor':
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <g transform={textFrame(rot, mirror)}>
            <text x={0} y={5} textAnchor="middle" fontSize={14} fontWeight={700} fill="var(--sym)" stroke="none">
              M
            </text>
          </g>
          <Spinner spin={spin}>
            <path d="M0 -12V12" strokeWidth={2.4} />
          </Spinner>
        </g>
      );
    case 'fan':
      return (
        <g>
          <path d="M0 -40V-24M0 24V40" />
          <circle r={24} />
          <circle r={4} fill="var(--sym)" />
          <Spinner spin={spin}>
            {[0, 90, 180, 270].map((a) => (
              <path key={a} transform={`rotate(${a})`} d="M0 -4C8 -6 14 -12 10 -21C2 -19 -2 -12 0 -4Z" fill="var(--accent)" fillOpacity={0.55} strokeWidth={1.2} />
            ))}
          </Spinner>
        </g>
      );
    case 'ind-core':
      return (
        <g>
          <path d="M-40 0H-20M20 0H40" />
          <path d="M-20 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0" />
          <path d="M-20 -10H20M-20 -13H20" />
        </g>
      );
    default:
      return null;
  }
}

/** A box with a moving picture is at least this tall (pixels), so the picture has room between the pin names. */
export const PICTURE_HEIGHT = 120;
/** Picture and pin names never overlap: the picture stays inside this half width (pixels). */
const PICTURE_HALF = 16;

/**
 * The moving picture in the middle of a box symbol: a relay's armature, a turbine, a valve. It sits below the title
 * and between the two columns of pin names, and stays inside `PICTURE_HALF` either side of the centre.
 */
function Overlay({ kind, def, spin, pulled, rot, mirror }: { kind: string; def: PartDef; spin: number; pulled: boolean; rot: number; mirror: boolean }) {
  const top = Math.min(...def.pins.map((p) => p.y)) * 20 - 30;
  const cy = top + 66; // the middle of the free space under the title
  const h = PICTURE_HALF;
  if (kind === 'relay') {
    return (
      <g transform={`translate(0 ${cy})`} stroke="var(--sym)" fill="none" strokeWidth={1.6}>
        <rect x={-h} y={-30} width={2 * h} height={14} rx={3} fill={pulled ? 'var(--accent)' : 'none'} fillOpacity={pulled ? 0.55 : 0} />
        <path d={`M${-h + 5} -23h${2 * h - 10}`} strokeWidth={1} strokeDasharray="2 2" />
        <circle cx={-h + 3} cy={14} r={2.2} fill="var(--panel)" />
        <circle cx={h - 3} cy={2} r={2.2} fill="var(--panel)" />
        <circle cx={h - 3} cy={26} r={2.2} fill="var(--panel)" />
        <path d={pulled ? `M${-h + 3} 14L${h - 5} 3` : `M${-h + 3} 14L${h - 5} 25`} strokeWidth={2.2} stroke={pulled ? 'var(--accent)' : 'var(--sym)'} />
      </g>
    );
  }
  if (kind === 'turbine') {
    return (
      <g transform={`translate(0 ${cy})`} stroke="var(--sym)" strokeWidth={1.4}>
        <circle r={h} fill="none" />
        <circle r={2.5} fill="var(--sym)" />
        <Spinner spin={spin}>
          {[0, 120, 240].map((a) => (
            <path key={a} transform={`rotate(${a})`} d="M0 -2C5 -4 9 -8 6 -14C1 -12 -1 -8 0 -2Z" fill="var(--accent)" fillOpacity={0.6} strokeWidth={1} />
          ))}
        </Spinner>
      </g>
    );
  }
  if (kind === 'valve') {
    return (
      <g transform={`translate(0 ${cy})`} stroke="var(--sym)" fill="none" strokeWidth={1.6}>
        <path d={`M${-h} -2V22L0 10ZM${h} -2V22L0 10Z`} fill={pulled ? 'var(--accent)' : 'none'} fillOpacity={0.45} />
        <path d={pulled ? 'M0 8V-22' : 'M0 8V-6'} strokeWidth={3} />
        <g transform={textFrame(rot, mirror)}>
          <text y={36} fontSize={8} fill="var(--sym)" stroke="none" textAnchor="middle">
            {pulled ? 'OPEN' : 'SHUT'}
          </text>
        </g>
      </g>
    );
  }
  return null;
}

export function PartSymbol({ type, closed, color, rot = 0, mirror = false, spin = 0, pulled = false }: Props) {
  const custom = PART_DEFS[type]?.custom;
  if (custom) {
    if (custom.symbol.kind === 'like') return <PartSymbol type={custom.symbol.like} closed={closed} color={color} rot={rot} mirror={mirror} />;
    if (custom.symbol.kind === 'glyph') return <Glyph name={custom.symbol.glyph} rot={rot} mirror={mirror} spin={spin} pulled={pulled} />;
    if (custom.symbol.kind === 'opamp5') return <Opamp5 />;
    const def = PART_DEFS[type];
    return (
      <g>
        <BoxSymbol def={def} rot={rot} mirror={mirror} picture={custom.visual !== undefined && custom.visual.kind !== 'fan' && custom.visual.kind !== 'motor'} />
        {custom.visual && <Overlay kind={custom.visual.kind} def={def} spin={spin} pulled={pulled} rot={rot} mirror={mirror} />}
      </g>
    );
  }
  switch (type) {
    case 'R':
      return (
        <g>
          <path d="M-40 0H-18M18 0H40" />
          <rect x={-18} y={-7} width={36} height={14} />
        </g>
      );
    case 'C':
      return (
        <g>
          <path d="M-40 0H-4M4 0H40M-4 -13V13M4 -13V13" />
        </g>
      );
    case 'L':
      return (
        <g>
          <path d="M-40 0H-20M20 0H40" />
          <path d="M-20 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0a5 5 0 0 1 10 0" />
        </g>
      );
    case 'D':
      return (
        <g>
          <path d="M-40 0H-8M8 0H40M8 -10V10" />
          <path d="M-8 -10L8 0L-8 10Z" />
        </g>
      );
    case 'LED':
      return (
        <g>
          <path d="M-40 0H-8M8 0H40M8 -10V10" />
          <path d="M-8 -10L8 0L-8 10Z" />
          <path d="M-2 -13l6 -7M4 -9l6 -7" />
          <path d="M4 -20l2 3M10 -16l2 3" />
        </g>
      );
    case 'SW':
      return (
        <g>
          <path d="M-40 0H-18M18 0H40" />
          <circle cx={-18} cy={0} r={2.5} />
          <circle cx={18} cy={0} r={2.5} />
          <path d={closed ? 'M-18 0L18 0' : 'M-18 0L16 -13'} />
        </g>
      );
    case 'VDC':
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <path d="M-4 -8h8M0 -12v8" strokeWidth={1.4} />
          <path d="M-4 8h8" strokeWidth={1.4} />
        </g>
      );
    case 'VAC':
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <path d="M-9 0q4.5 -9 9 0t9 0" />
        </g>
      );
    case 'VPULSE':
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <path d="M-9 5V-5H-3V5H3V-5H9" strokeWidth={1.4} />
        </g>
      );
    case 'IDC':
      return (
        <g>
          <path d="M0 -40V-16M0 16V40" />
          <circle r={16} />
          <path d="M0 9V-9M-5 -4L0 -10L5 -4" />
        </g>
      );
    case 'QNPN':
    case 'QPNP':
      return (
        <g>
          <path d="M-40 0H-10M-10 -16V16M-10 -9L18 -32V-40H40M-10 9L18 32V40H40" />
          <path d={type === 'QNPN' ? arrow(13.8, 28.6, 28, 23) : arrow(-3, 14.8, -28, -23)} />
        </g>
      );
    case 'NMOS':
    case 'PMOS':
      return (
        <g>
          <path d="M-40 0H-14M-14 -14V14M-8 -16V-8M-8 -4V4M-8 8V16M-8 -12H20V-40H40M-8 12H20V40H40M-8 0H20V12" />
          <path d={type === 'NMOS' ? arrow(-8, 0, -1, 0) : arrow(6, 0, 1, 0)} />
        </g>
      );
    case 'OPAMP':
      return (
        <g>
          <path d="M-60 -20H-36M-60 20H-36M48 0H60" />
          <path d="M-36 -36L-36 36L48 0Z" />
          <path d="M-31 -20h8M-31 20h8M-27 16v8" strokeWidth={1.5} />
        </g>
      );
    case 'ARDUINO_UNO':
    case 'ARDUINO_NANO':
    case 'ARDUINO_MEGA':
    case 'PICO':
    case 'PICO_W':
    case 'PIC16F84A':
    case 'PIC16F628A':
    case 'PIC16F877A':
      return <BoxSymbol def={PART_DEFS[type]} rot={rot} mirror={mirror} />;
    case 'GND':
      return (
        <g>
          <path d="M0 0V8M-12 8H12M-8 13H8M-4 18H4" />
        </g>
      );
    case 'PROBE':
      return (
        <g>
          <circle r={5} fill={color ?? PROBE_COLORS[0]} stroke="none" />
          <circle r={7.5} stroke={color ?? PROBE_COLORS[0]} fill="none" strokeWidth={1.2} />
        </g>
      );
  }
}
