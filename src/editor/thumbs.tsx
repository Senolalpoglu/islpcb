// Little illustrations of the real components, shown in the part library. Drawn on a 64 x 64 canvas.
// Every part gets one: a specific drawing when we have it, otherwise a chip, board or header picked from its shape.

import type { ReactNode } from 'react';
import { PART_DEFS } from './model';

const METAL = '#b8bec8';
const BLACK = '#23262d';
const LEAD = { stroke: METAL, strokeWidth: 1.8, strokeLinecap: 'round' as const, fill: 'none' };

/** The 4-colour code of a resistor, as bands. */
const BANDS = ['#8b4513', '#000000', '#d9534f', '#d4af37'];

function Leads({ y = 32, x0 = 4, x1 = 60 }: { y?: number; x0?: number; x1?: number }) {
  return <path d={`M${x0} ${y}H${x1}`} {...LEAD} />;
}

function Chip({ left, right, title }: { left: number; right: number; title: string }) {
  const rows = Math.max(left, right, 2);
  const gap = Math.min(7, 46 / rows);
  const h = rows * gap + 4;
  const top = 32 - h / 2;
  const pin = (side: 'l' | 'r', i: number): ReactNode => (
    <rect key={`${side}${i}`} x={side === 'l' ? 8 : 52} y={top + 2 + i * gap + gap / 2 - 1.2} width={4} height={2.4} fill={METAL} />
  );
  return (
    <g>
      {Array.from({ length: left }, (_, i) => pin('l', i))}
      {Array.from({ length: right }, (_, i) => pin('r', i))}
      <rect x={12} y={top} width={40} height={h} rx={2} fill={BLACK} stroke="#3a3f4a" />
      <path d={`M29 ${top}a3 3 0 0 0 6 0`} fill="none" stroke="#5b6270" />
      <circle cx={17} cy={top + h - 5} r={1.5} fill="#5b6270" />
      <text x={32} y={35} textAnchor="middle" fontSize={title.length > 9 ? 6 : 7.5} fill="#cfd6e2" fontFamily="Segoe UI, sans-serif" fontWeight={600}>
        {title}
      </text>
    </g>
  );
}

function Board({ w, h, color, usb, title, headers }: { w: number; h: number; color: string; usb?: 'left' | 'top'; title: string; headers: 'uno' | 'rows' | 'nano' }) {
  const x = 32 - w / 2;
  const y = 32 - h / 2;
  const pins = (px: number, py: number, n: number): ReactNode =>
    Array.from({ length: n }, (_, i) => <rect key={`${px}-${py}-${i}`} x={px + i * 2.6} y={py} width={1.8} height={1.8} fill="#e6c860" />);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={color} stroke="#0c1a14" strokeWidth={0.8} />
      <circle cx={x + 3.5} cy={y + 3.5} r={1.2} fill="#0c1a14" />
      <circle cx={x + w - 3.5} cy={y + h - 3.5} r={1.2} fill="#0c1a14" />
      {usb === 'left' && <rect x={x - 3} y={27} width={11} height={10} fill={METAL} stroke="#6b7280" />}
      {usb === 'top' && <rect x={27} y={y - 3} width={10} height={9} fill={METAL} stroke="#6b7280" />}
      {headers === 'uno' && (
        <>
          {pins(x + 16, y + 2.5, 10)}
          {pins(x + 16, y + h - 4.3, 8)}
          {pins(x + 38, y + h - 4.3, 6)}
          <rect x={x + 5} y={y + h - 14} width={9} height={9} fill="#2c2f36" />
          <rect x={x + w * 0.45} y={28} width={13} height={6} rx={1} fill={BLACK} />
        </>
      )}
      {headers === 'rows' && (
        <>
          {pins(x + 2.5, y + 2, Math.floor((w - 5) / 2.6))}
          {pins(x + 2.5, y + h - 3.8, Math.floor((w - 5) / 2.6))}
          <rect x={27} y={28} width={10} height={8} rx={1} fill={BLACK} />
        </>
      )}
      {headers === 'nano' && (
        <>
          {pins(x + 1.5, y + 1.6, Math.floor((w - 3) / 2.6))}
          {pins(x + 1.5, y + h - 3.4, Math.floor((w - 3) / 2.6))}
          <rect x={27} y={29} width={10} height={6} rx={1} fill={BLACK} />
        </>
      )}
      <text x={32} y={y + h / 2 + (headers === 'rows' ? 12 : 10)} textAnchor="middle" fontSize={5.5} fill="#e8f5ee" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
        {title}
      </text>
    </g>
  );
}

function To220() {
  return (
    <g>
      <rect x={20} y={8} width={24} height={14} fill={METAL} stroke="#6b7280" />
      <circle cx={32} cy={14} r={3} fill="#2b2f36" />
      <rect x={20} y={22} width={24} height={20} fill={BLACK} stroke="#3a3f4a" />
      <path d="M26 42V58M32 42V58M38 42V58" {...LEAD} />
    </g>
  );
}

function To92() {
  return (
    <g>
      <path d="M22 18a10 10 0 0 1 20 0V40H22Z" fill={BLACK} stroke="#3a3f4a" />
      <path d="M24 40V58M32 40V58M40 40V58" {...LEAD} />
    </g>
  );
}

function Led({ color }: { color: string }) {
  return (
    <g>
      <path d="M26 36V58M38 36V56" {...LEAD} />
      <path d="M20 36V24a12 12 0 0 1 24 0V36Z" fill={color} fillOpacity={0.85} stroke={color} />
      <rect x={18} y={35} width={28} height={3.5} fill={color} fillOpacity={0.7} />
      <path d="M26 30V24M30 30L32 22M38 30V24" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={1.2} fill="none" />
    </g>
  );
}

function SevenSeg() {
  const seg = (x: number, y: number, w: number, h: number, k: string) => <rect key={k} x={x} y={y} width={w} height={h} rx={1} fill="#ff4d4d" />;
  return (
    <g>
      <rect x={16} y={8} width={32} height={48} rx={2} fill={BLACK} stroke="#3a3f4a" />
      {seg(23, 13, 18, 3, 'a')}
      {seg(23, 30, 18, 3, 'g')}
      {seg(23, 47, 18, 3, 'd')}
      {seg(20, 17, 3, 12, 'f')}
      {seg(41, 17, 3, 12, 'b')}
      {seg(20, 34, 3, 12, 'e')}
      {seg(41, 34, 3, 12, 'c')}
      <circle cx={45} cy={50} r={1.6} fill="#ff4d4d" />
    </g>
  );
}

function Cell({ label }: { label: string }) {
  return (
    <g>
      <rect x={28} y={7} width={8} height={5} fill={METAL} />
      <rect x={20} y={12} width={24} height={44} rx={3} fill="#2a7de1" stroke="#1b4f93" />
      <rect x={20} y={12} width={24} height={9} fill="#d9a441" />
      <text x={32} y={43} textAnchor="middle" fontSize={9} fill="#fff" fontWeight={700} fontFamily="Segoe UI, sans-serif">
        {label}
      </text>
    </g>
  );
}

function Meter({ label }: { label: string }) {
  return (
    <g>
      <rect x={10} y={12} width={44} height={40} rx={4} fill="#d9dde3" stroke="#6b7280" />
      <rect x={14} y={16} width={36} height={20} rx={2} fill="#9bd08a" stroke="#4d6a45" />
      <text x={32} y={31} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1c2d18" fontFamily="Consolas, monospace">
        {label}
      </text>
      <circle cx={22} cy={44} r={3} fill="#c0392b" />
      <circle cx={42} cy={44} r={3} fill="#222" />
    </g>
  );
}

/** A packaged semiconductor with its type printed on it. */
function Package({ kind, label }: { kind: 'to92' | 'to220' | 'to126' | 'to3' | 'sot223'; label: string }) {
  const text = (x: number, y: number, size = 6) => (
    <text x={x} y={y} textAnchor="middle" fontSize={size} fill="#cfd6e2" fontFamily="Segoe UI, sans-serif" fontWeight={600}>
      {label}
    </text>
  );
  switch (kind) {
    case 'to220':
      return (
        <g>
          <rect x={18} y={6} width={28} height={16} fill={METAL} stroke="#6b7280" />
          <circle cx={32} cy={13} r={3.2} fill="#2b2f36" />
          <rect x={18} y={22} width={28} height={22} fill={BLACK} stroke="#3a3f4a" />
          {text(32, 36, label.length > 7 ? 5 : 6.5)}
          <path d="M25 44V60M32 44V60M39 44V60" {...LEAD} />
        </g>
      );
    case 'to126':
      return (
        <g>
          <rect x={20} y={8} width={24} height={34} fill={BLACK} stroke="#3a3f4a" />
          <rect x={20} y={8} width={24} height={8} fill={METAL} />
          <circle cx={32} cy={12} r={2.4} fill="#2b2f36" />
          {text(32, 32, 6.5)}
          <path d="M26 42V60M32 42V60M38 42V60" {...LEAD} />
        </g>
      );
    case 'to3':
      return (
        <g>
          <ellipse cx={32} cy={32} rx={25} ry={15} fill={METAL} stroke="#6b7280" />
          <circle cx={10} cy={32} r={3} fill="#2b2f36" />
          <circle cx={54} cy={32} r={3} fill="#2b2f36" />
          <ellipse cx={32} cy={32} rx={13} ry={9} fill="#9aa3b2" stroke="#6b7280" />
          <circle cx={26} cy={32} r={2} fill="#2b2f36" />
          <circle cx={38} cy={32} r={2} fill="#2b2f36" />
          <text x={32} y={52} textAnchor="middle" fontSize={7} fill="var(--sym)" fontFamily="Segoe UI, sans-serif" fontWeight={600}>
            {label}
          </text>
        </g>
      );
    case 'sot223':
      return (
        <g>
          <rect x={22} y={8} width={20} height={9} fill={METAL} stroke="#6b7280" />
          <rect x={16} y={17} width={32} height={22} rx={1} fill={BLACK} stroke="#3a3f4a" />
          {text(32, 31, label.length > 8 ? 5 : 6.5)}
          <path d="M22 39V52M32 39V52M42 39V52" stroke={METAL} strokeWidth={3} />
        </g>
      );
    default:
      return (
        <g>
          <path d="M22 18a10 10 0 0 1 20 0V40H22Z" fill={BLACK} stroke="#3a3f4a" />
          {text(32, 33, label.length > 7 ? 4.8 : 6)}
          <path d="M24 40V58M32 40V58M40 40V58" {...LEAD} />
        </g>
      );
  }
}

function Tactile() {
  return (
    <g>
      <rect x={14} y={14} width={36} height={36} rx={3} fill="#2b2f36" stroke="#4b505c" />
      <circle cx={32} cy={32} r={11} fill="#c0392b" stroke="#7a241b" />
      {[18, 46].flatMap((x) => [18, 46].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill={METAL} />))}
    </g>
  );
}

function Toggle() {
  return (
    <g>
      <path d="M22 46V60M32 46V60M42 46V60" {...LEAD} />
      <rect x={14} y={34} width={36} height={14} rx={2} fill="#9aa3b2" stroke="#5b6270" />
      <path d="M32 34L25 10" stroke="#cfd6e2" strokeWidth={5} strokeLinecap="round" />
      <circle cx={25} cy={10} r={4} fill="#e0e4ea" stroke="#7b8494" />
    </g>
  );
}

function Transformer() {
  return (
    <g>
      <rect x={8} y={14} width={48} height={34} rx={2} fill="#3b3f48" stroke="#555b68" />
      <rect x={14} y={19} width={36} height={24} fill="#2a2d34" />
      <path d="M32 19V43" stroke="#6b7280" strokeWidth={2} />
      <path d="M14 48V60M22 48V60M42 48V60M50 48V60" {...LEAD} />
    </g>
  );
}

function Toroid() {
  return (
    <g>
      <path d="M8 36V60M56 36V60" {...LEAD} />
      <circle cx={32} cy={28} r={22} fill="#3d4049" stroke="#5b6270" />
      <circle cx={32} cy={28} r={9} fill="var(--canvas-bg)" stroke="#5b6270" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <path key={i} d={`M${32 + Math.cos(a) * 10} ${28 + Math.sin(a) * 10}L${32 + Math.cos(a) * 21} ${28 + Math.sin(a) * 21}`} stroke="#d17a3a" strokeWidth={2.4} />;
      })}
    </g>
  );
}

function Fuse() {
  return (
    <g>
      <path d="M4 32H14M50 32H60" {...LEAD} />
      <rect x={14} y={24} width={36} height={16} rx={3} fill="#cfe6ef" fillOpacity={0.5} stroke="#8aa4b0" />
      <path d="M16 32q8-8 16 0t16 0" fill="none" stroke="#b8bec8" strokeWidth={1.2} />
      <rect x={10} y={22} width={6} height={20} fill={METAL} />
      <rect x={48} y={22} width={6} height={20} fill={METAL} />
    </g>
  );
}

function Disc({ color, label }: { color: string; label: string }) {
  return (
    <g>
      <path d="M26 42V60M38 42V60" {...LEAD} />
      <circle cx={32} cy={26} r={18} fill={color} stroke="#222" strokeOpacity={0.5} />
      <text x={32} y={29} textAnchor="middle" fontSize={8} fill="#111" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
        {label}
      </text>
    </g>
  );
}

function Coin({ shape, label, color }: { shape: 'aa' | '9v' | 'coin' | 'lipo' | 'lead'; label: string; color: string }) {
  switch (shape) {
    case 'aa':
      return (
        <g>
          <rect x={27} y={6} width={10} height={4} fill={METAL} />
          <rect x={20} y={10} width={24} height={46} rx={3} fill={color} stroke="#222" strokeOpacity={0.4} />
          <rect x={20} y={10} width={24} height={9} fill="#d9a441" />
          <text x={32} y={40} textAnchor="middle" fontSize={7} fill="#fff" fontWeight={700} fontFamily="Segoe UI, sans-serif">
            {label}
          </text>
        </g>
      );
    case '9v':
      return (
        <g>
          <rect x={17} y={14} width={30} height={44} rx={2} fill="#2c2f36" stroke="#555a66" />
          <rect x={17} y={14} width={30} height={9} fill="#d9a441" />
          <circle cx={26} cy={10} r={3.2} fill={METAL} />
          <circle cx={38} cy={10} r={3.2} fill={METAL} />
          <text x={32} y={45} textAnchor="middle" fontSize={10} fill="#fff" fontWeight={700} fontFamily="Segoe UI, sans-serif">
            {label}
          </text>
        </g>
      );
    case 'coin':
      return (
        <g>
          <circle cx={32} cy={32} r={22} fill="#cfd6e2" stroke="#7b8494" />
          <circle cx={32} cy={32} r={16} fill="#e6eaf0" />
          <text x={32} y={35} textAnchor="middle" fontSize={7} fill="#333" fontWeight={700} fontFamily="Segoe UI, sans-serif">
            {label}
          </text>
        </g>
      );
    case 'lipo':
      return (
        <g>
          <rect x={14} y={16} width={36} height={40} rx={3} fill="#3b6fd0" stroke="#24478f" />
          <path d="M26 16V8M38 16V8" stroke="#c0392b" strokeWidth={3} />
          <text x={32} y={40} textAnchor="middle" fontSize={8} fill="#fff" fontWeight={700} fontFamily="Segoe UI, sans-serif">
            {label}
          </text>
        </g>
      );
    default:
      return (
        <g>
          <rect x={8} y={16} width={48} height={36} rx={2} fill="#2a2d34" stroke="#555a66" />
          <rect x={14} y={10} width={8} height={6} fill="#c0392b" />
          <rect x={42} y={10} width={8} height={6} fill="#222" />
          <text x={32} y={39} textAnchor="middle" fontSize={9} fill="#e6c860" fontWeight={700} fontFamily="Segoe UI, sans-serif">
            {label}
          </text>
        </g>
      );
  }
}

/** A hobby module: a little printed circuit board with a header and the module's name. */
function ModuleBoard({ title, color, pins, w = 46, h = 34, extra }: { title: string; color: string; pins: number; w?: number; h?: number; extra?: ReactNode }) {
  const x = 32 - w / 2;
  const y = 32 - h / 2;
  const n = Math.min(pins, 10);
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={2.5} fill={color} stroke="#0c1a14" strokeOpacity={0.6} />
      <circle cx={x + 3} cy={y + 3} r={1.2} fill="#0c1a14" />
      <circle cx={x + w - 3} cy={y + 3} r={1.2} fill="#0c1a14" />
      {Array.from({ length: n }, (_, i) => (
        <rect key={i} x={32 - (n * 3.2) / 2 + i * 3.2 + 0.7} y={y + h - 4.6} width={1.8} height={3.6} fill="#e6c860" />
      ))}
      {extra}
      <text x={32} y={y + 9} textAnchor="middle" fontSize={title.length > 9 ? 5 : 6.2} fill="#fff" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
        {title}
      </text>
    </g>
  );
}

/** Which package a semiconductor id comes in, for the printed illustrations. */
const PACKAGES: Record<string, 'to92' | 'to220' | 'to126' | 'to3' | 'sot223'> = {
  '2n2222': 'to92', '2n3904': 'to92', '2n3906': 'to92', bc547: 'to92', bc557: 'to92', bc337: 'to92', bc327: 'to92', '2n7000': 'to92', bs170: 'to92', 'lm78l05': 'to92', 'mcp1700-3v3': 'to92', 'scr-2n5060': 'to92', 'triac-z0103': 'to92', lm35: 'to92', tmp36: 'to92', ds18b20: 'to92', tsop1838: 'to92',
  bd139: 'to126', bd140: 'to126',
  '2n3055': 'to3', mj2955: 'to3',
  'lm1117-3v3': 'sot223', 'lm1117-5v': 'sot223', 'ams1117-3v3': 'sot223',
};

/** The illustration of a part. */
export function PartThumb({ type }: { type: string }) {
  return (
    <svg viewBox="0 0 64 64" className="lib-thumb" aria-hidden="true">
      {drawing(type)}
    </svg>
  );
}

function drawing(type: string): ReactNode {
  const def = PART_DEFS[type];
  const id = type.startsWith('x:') ? type.slice(2) : type;
  const spec = def?.custom;
  const short = id.replace(/^(scr|triac)-/, '').split('-')[0].toUpperCase();
  const pkg = PACKAGES[id];
  if (pkg) return <Package kind={pkg} label={short} />;
  if (/^(irf|irl|tip|lm78|lm79|lm317|lm2940|bt1|bta|tyn)/.test(id) || id.startsWith('scr-') || id.startsWith('triac-')) return <Package kind="to220" label={short} />;
  if (id.startsWith('relay-') && id !== 'relay-module-1ch') {
    const volts = /(\d+)v/.exec(id)?.[1];
    const poles = id.includes('g2rl') ? `G2RL ${volts}V` : id.includes('srd') ? `SRD ${volts}V` : id.includes('3pdt') ? '3 CO' : id.includes('dpdt') ? '2 CO' : id.endsWith('nc') ? 'NC' : 'NO';
    return (
      <g>
        <path d="M14 46V58M24 46V58M40 46V58M50 46V58" {...LEAD} />
        <rect x={8} y={12} width={48} height={34} rx={2} fill="#2c64b5" stroke="#1b3f75" />
        <rect x={14} y={18} width={20} height={14} fill="#1b3f75" />
        <text x={32} y={41} textAnchor="middle" fontSize={7} fill="#fff" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
          RELAY {poles}
        </text>
      </g>
    );
  }
  const poles = Number(/-(\d+)$/.exec(id)?.[1] ?? 2);
  if (id.startsWith('term-') || id.startsWith('plug-')) {
    const k = Math.min(poles, 6);
    const w = Math.min(56, k * 14);
    const x0 = 32 - w / 2;
    return (
      <g>
        <rect x={x0} y={16} width={w} height={32} rx={2} fill={id.startsWith('plug-') ? '#1f7a4a' : id.includes('508') ? '#2f9e58' : '#3a8f4f'} stroke="#1c5c33" />
        {Array.from({ length: k }, (_, i) => {
          const cx = x0 + (i + 0.5) * (w / k);
          return (
            <g key={i}>
              <circle cx={cx} cy={27} r={4.2} fill="#cfd6e2" stroke="#7b8494" />
              <path d={`M${cx - 2.6} 27h5.2`} stroke="#555" strokeWidth={1.2} />
              <rect x={cx - 3.4} y={38} width={6.8} height={7} fill="#0d1a14" />
            </g>
          );
        })}
        <path d={`M${x0 + 2} 50v6M${x0 + w - 2} 50v6`} {...LEAD} />
      </g>
    );
  }
  if (id.startsWith('hdr-m-') || id.startsWith('hdr2-m-')) {
    const two = id.startsWith('hdr2-m-');
    const k = Math.min(two ? poles / 2 : poles, 8);
    const w = Math.min(58, k * 7.2 + 4);
    const x0 = 32 - w / 2;
    const pitch = (w - 5.2) / Math.max(1, k - 1);
    return (
      <g>
        <rect x={x0} y={two ? 30 : 36} width={w} height={two ? 18 : 9} fill={BLACK} stroke="#3a3f4a" />
        {Array.from({ length: k }, (_, i) => (
          <g key={i}>
            <rect x={x0 + 2.6 + i * pitch} y={8} width={2.6} height={two ? 34 : 30} fill="#e6c860" />
            {two && <rect x={x0 + 2.6 + i * pitch} y={14} width={2.6} height={34} fill="#e6c860" opacity={0.55} />}
          </g>
        ))}
      </g>
    );
  }
  if (id.startsWith('hdr-f-')) {
    const k = Math.min(poles, 8);
    const w = Math.min(58, k * 7.2 + 4);
    const x0 = 32 - w / 2;
    return (
      <g>
        <rect x={x0} y={22} width={w} height={22} rx={1} fill="#262a31" stroke="#4b505c" />
        {Array.from({ length: k }, (_, i) => (
          <rect key={i} x={x0 + 2.4 + i * ((w - 4.8) / k)} y={27} width={3.2} height={12} fill="#0a0c10" stroke="#c9a227" strokeWidth={0.8} />
        ))}
        <path d={`M${x0 + 4} 44v12M${x0 + w - 4} 44v12`} {...LEAD} />
      </g>
    );
  }
  if (id.startsWith('jst-') || id.startsWith('tunik-')) {
    const k = Math.min(poles, 6);
    const w = Math.min(58, k * 8 + 8);
    const x0 = 32 - w / 2;
    return (
      <g>
        <path d={`M${x0} 20h${w}v26h-${w}Z`} fill="#f2f2ee" stroke="#9a9a92" />
        <rect x={x0 + 3} y={24} width={w - 6} height={14} rx={1} fill="#d9d9d2" />
        {Array.from({ length: k }, (_, i) => (
          <rect key={i} x={x0 + 4 + i * ((w - 8) / k)} y={27} width={(w - 8) / k - 3} height={8} fill="#2b2f36" />
        ))}
        <path d="M24 46v10M40 46v10" {...LEAD} />
      </g>
    );
  }
  if (id.startsWith('fan-'))
    return (
      <g>
        <rect x={8} y={8} width={48} height={48} rx={5} fill="#2b2f36" stroke="#4b505c" />
        <circle cx={32} cy={32} r={19} fill="#1b1d22" stroke="#555a66" />
        {[0, 90, 180, 270].map((a) => (
          <path key={a} transform={`rotate(${a} 32 32)`} d="M32 32C38 30 43 25 40 17C33 19 30 25 32 32Z" fill="#6b7280" stroke="#9aa3b2" strokeWidth={0.8} />
        ))}
        <circle cx={32} cy={32} r={4.5} fill="#3b3f48" />
        {[[11, 11], [53, 11], [11, 53], [53, 53]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={1.8} fill="#0d0f13" />
        ))}
      </g>
    );
  if (id === 'pump-12v')
    return (
      <g>
        <rect x={14} y={18} width={30} height={28} rx={4} fill="#2f6fb3" stroke="#1e4a7a" />
        <rect x={44} y={28} width={14} height={8} fill="#cfd6e2" stroke="#7b8494" />
        <rect x={20} y={10} width={8} height={8} fill="#cfd6e2" stroke="#7b8494" />
        <circle cx={29} cy={32} r={7} fill="#1b3f75" />
        <path d="M22 50V58M36 50V58" stroke="#c0392b" strokeWidth={2} />
      </g>
    );
  if (id.startsWith('valve-'))
    return (
      <g>
        <rect x={14} y={8} width={26} height={24} rx={3} fill="#2a2d34" stroke="#555a66" />
        <rect x={18} y={32} width={18} height={6} fill="#c9a227" stroke="#7a6414" />
        <path d="M6 44h52v10H6Z" fill="#c9a227" stroke="#7a6414" />
        <path d="M2 49h6M56 49h6" stroke="#c9a227" strokeWidth={5} />
        <path d="M48 8v10M44 12h8" stroke="#c0392b" strokeWidth={2} />
      </g>
    );
  if (id.startsWith('flow-'))
    return (
      <g>
        <path d="M2 40h10M52 40h10" stroke="#e8ecef" strokeWidth={8} />
        <rect x={10} y={28} width={44} height={24} rx={6} fill="#e8ecef" stroke="#9aa3b2" />
        <rect x={22} y={14} width={20} height={14} rx={3} fill="#2a2d34" stroke="#555a66" />
        <path d="M22 40h20M36 35l6 5-6 5" stroke="#2f6fb3" strokeWidth={2.2} fill="none" />
        <path d="M26 14V8M32 14V8M38 14V8" stroke="#e0902f" strokeWidth={1.6} />
      </g>
    );
  if (id.startsWith('ssr-'))
    return (
      <g>
        <path d="M14 48V60M24 48V60M40 48V60M50 48V60" {...LEAD} />
        <rect x={8} y={12} width={48} height={36} rx={2} fill="#1f1f24" stroke="#4b4f5a" />
        <rect x={12} y={16} width={40} height={10} fill="#3a8a4f" />
        <text x={32} y={24} textAnchor="middle" fontSize={7} fill="#fff" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
          SSR
        </text>
        <text x={32} y={41} textAnchor="middle" fontSize={7} fill="#cfd6e2" fontFamily="Segoe UI, sans-serif">
          {id === 'ssr-ac' ? 'AC LOAD' : 'DC LOAD'}
        </text>
      </g>
    );
  if (id === 'moc3021') return <Chip left={3} right={3} title="MOC3021" />;
  if (id === 'diac-db3')
    return (
      <g>
        <Leads />
        <rect x={18} y={25} width={28} height={14} rx={7} fill="#e0902f" fillOpacity={0.8} stroke="#8b5a1a" />
        <text x={32} y={35} textAnchor="middle" fontSize={7} fill="#3a2406" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
          DB3
        </text>
      </g>
    );
  if (id === 'pushbutton' || id === 'pushbutton-nc') return <Tactile />;
  if (id === 'toggle-spst' || id === 'spdt' || id === 'dpdt') return <Toggle />;
  if (id === 'reed-switch' || id === 'fuse') return <Fuse />;
  if (id === 'coil' || id === 'choke') return <Toroid />;
  if (id === 'transformer' || id.startsWith('transformer-') || id.startsWith('trafo-')) return <Transformer />;
  if (id.startsWith('lamp'))
    return (
      <g>
        <path d="M26 44V60M38 44V60" {...LEAD} />
        <path d="M32 6a16 16 0 0 1 10 28v10H22V34A16 16 0 0 1 32 6Z" fill="#ffe9a6" fillOpacity={0.5} stroke="#d9c26a" />
        <path d="M27 44V30l5-8 5 8v14" fill="none" stroke="#a78a2e" strokeWidth={1.4} />
        <rect x={22} y={44} width={20} height={6} fill="#b8bec8" stroke="#6b7280" />
      </g>
    );
  if (id.startsWith('neon-'))
    return (
      <g>
        <path d="M28 40V60M36 40V60" {...LEAD} />
        <path d="M24 38V18a8 8 0 0 1 16 0V38Z" fill="#ff9a4a" fillOpacity={0.45} stroke="#c9742a" />
        <path d="M29 38V24M35 38V24" stroke="#8a8f99" strokeWidth={1.6} />
      </g>
    );
  if (id === 'piezo-transducer' || id === 'ultrasonic-40k' || id === 'piezo-1mhz-focus')
    return (
      <g>
        <path d="M27 42V60M37 42V60" {...LEAD} />
        <circle cx={32} cy={26} r={17} fill="#b8bec8" stroke="#6b7280" />
        <circle cx={32} cy={26} r={11} fill="#8b95a6" stroke="#5b6270" />
        <circle cx={32} cy={26} r={4} fill="#3b4252" />
      </g>
    );
  if (id === 'langevin-28k-50w')
    return (
      <g>
        <path d="M24 46V60M40 46V60" {...LEAD} />
        <rect x={24} y={6} width={16} height={8} fill="#c9ced6" stroke="#6b7280" />
        <rect x={20} y={14} width={24} height={6} fill="#b8bec8" stroke="#6b7280" />
        <rect x={22} y={20} width={20} height={6} fill="#e8eaee" stroke="#8b95a6" />
        <rect x={22} y={26} width={20} height={6} fill="#4f5560" stroke="#2d323c" />
        <rect x={22} y={32} width={20} height={6} fill="#e8eaee" stroke="#8b95a6" />
        <rect x={22} y={38} width={20} height={6} fill="#4f5560" stroke="#2d323c" />
      </g>
    );
  if (id === 'mic-electret')
    return (
      <g>
        <path d="M26 42V60M38 42V60" {...LEAD} />
        <circle cx={32} cy={26} r={16} fill="#2e3340" stroke="#8b95a6" strokeWidth={2} />
        <circle cx={32} cy={26} r={9} fill="#14171c" stroke="#5b6270" />
      </g>
    );
  if (id === 'antenna')
    return (
      <g>
        <path d="M32 60V14M32 14L20 6M32 14L44 6" stroke="#b8bec8" strokeWidth={2.4} fill="none" strokeLinecap="round" />
      </g>
    );
  if (id === 'ferrite-antenna')
    return (
      <g>
        <rect x={8} y={26} width={48} height={12} rx={3} fill="#4a4f59" stroke="#2d323c" />
        <path d="M14 22V42M20 22V42M26 22V42M32 22V42M38 22V42" stroke="#d98a3a" strokeWidth={2.4} />
        <path d="M18 42V60M46 42V60" {...LEAD} />
      </g>
    );
  if (id === 'cap-variable' || id === 'cap-trimmer') return <Disc color={id === 'cap-trimmer' ? '#4aa3d9' : '#d9902f'} label={id === 'cap-trimmer' ? 'TRIM' : 'VAR'} />;
  if (id === 'varicap-bb910') return drawing('1n4148');
  if (id === 'zn414') return <To92 />;
  if (id === 'mains-inlet-220v')
    return (
      <g>
        <rect x={10} y={14} width={44} height={30} rx={3} fill="#2c2f36" stroke="#555a66" />
        <rect x={18} y={20} width={28} height={14} fill="#14171c" />
        <path d="M24 44V58M32 44V58M40 44V58" {...LEAD} />
        <text x={32} y={31} textAnchor="middle" fontSize={7} fill="#e8d089" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
          220 V
        </text>
      </g>
    );
  if (id === 'ptc') return <Disc color="#d9902f" label="PTC" />;
  if (id === 'varistor') return <Disc color="#3d7fd0" label="MOV" />;
  if (id === 'trimpot') return drawing('potentiometer');
  if (id === 'cell-aa') return <Coin shape="aa" label="AA" color="#2e8b57" />;
  if (id === 'cell-9v') return <Coin shape="9v" label="9V" color="#2c2f36" />;
  if (id === 'cell-cr2032') return <Coin shape="coin" label="CR2032" color="#cfd6e2" />;
  if (id === 'cell-lipo') return <Coin shape="lipo" label="3.7V" color="#3b6fd0" />;
  if (id === 'cell-lead-acid') return <Coin shape="lead" label="12V" color="#2a2d34" />;
  if (id.startsWith('mains-')) return drawing('VAC');
  if (id.startsWith('1n47')) return drawing('zener');
  if (id.startsWith('1n')) return drawing('D');
  if (id === 'led-orange') return <Led color="#ff8a1f" />;
  if (id === 'led-ir') return <Led color="#6b5b95" />;
  if (id === 'servo-sg90')
    return (
      <g>
        <rect x={10} y={22} width={44} height={24} rx={2} fill="#3a6fc0" stroke="#24478f" />
        <rect x={50} y={26} width={8} height={16} fill="#3a6fc0" stroke="#24478f" />
        <circle cx={22} cy={22} r={5} fill="#e6e8ec" stroke="#7b8494" />
        <path d="M22 22H8" stroke="#e6e8ec" strokeWidth={4} strokeLinecap="round" />
        <path d="M10 46V56M32 46V56M44 46V56" stroke="#e0902f" strokeWidth={2} />
      </g>
    );
  if (id === 'stepper-28byj48')
    return (
      <g>
        <circle cx={32} cy={34} r={20} fill="#b8bec8" stroke="#6b7280" />
        <circle cx={32} cy={34} r={6} fill="#6b7280" />
        <rect x={28} y={6} width={8} height={10} fill="#9aa3b2" />
        <path d="M24 54V60M30 54V60M36 54V60M42 54V60" stroke="#c0392b" strokeWidth={2} />
      </g>
    );
  if (id === 'hc-sr04')
    return (
      <ModuleBoard title="HC-SR04" color="#1d5fa8" pins={4} w={54} h={32} extra={<><circle cx={20} cy={34} r={8} fill="#c9ced6" stroke="#555" /><circle cx={44} cy={34} r={8} fill="#c9ced6" stroke="#555" /></>} />
    );
  if (id === 'pir-hc-sr501') return <ModuleBoard title="PIR" color="#2f7d4a" pins={3} w={44} h={34} extra={<circle cx={32} cy={34} r={11} fill="#f2f2f2" fillOpacity={0.9} stroke="#aaa" />} />;
  if (id === 'joystick') return <ModuleBoard title="JOYSTICK" color="#1d5fa8" pins={5} w={40} h={42} extra={<><circle cx={32} cy={34} r={9} fill="#2b2f36" /><circle cx={32} cy={34} r={5} fill="#555a66" /></>} />;
  if (id === 'oled-ssd1306' || id === 'tm1637') return <ModuleBoard title={id === 'tm1637' ? 'TM1637' : 'OLED'} color="#222" pins={4} w={46} h={36} extra={<rect x={14} y={24} width={36} height={14} fill={id === 'tm1637' ? '#3a0d0d' : '#0a1d33'} stroke="#555" />} />;
  if (id === 'lcd1602' || id === 'lcd1602-i2c') return <ModuleBoard title="LCD 1602" color="#1f7a3a" pins={id === 'lcd1602' ? 10 : 4} w={58} h={30} extra={<rect x={9} y={22} width={46} height={14} fill="#3fa8c8" stroke="#16556b" />} />;
  if (id === 'l298n') return <ModuleBoard title="L298N" color="#b3262c" pins={6} w={44} h={44} extra={<rect x={22} y={22} width={20} height={14} fill="#444" />} />;
  if (id === 'a4988') return <ModuleBoard title="A4988" color="#b3262c" pins={8} w={34} h={42} extra={<rect x={24} y={22} width={16} height={10} fill="#2b2f36" />} />;
  if (id === 'relay-module-1ch') return <ModuleBoard title="RELAY" color="#1d5fa8" pins={3} w={52} h={38} extra={<rect x={20} y={20} width={24} height={16} fill="#2c64b5" stroke="#1b3f75" />} />;
  if (id === 'esp-01') return <ModuleBoard title="ESP-01" color="#1f1f24" pins={4} w={46} h={28} extra={<path d="M12 32h8v-4h4v4h4v-4h4v4h4" fill="none" stroke="#e6c860" strokeWidth={1} />} />;
  if (id === 'esp32-devkit' || id === 'nodemcu' || id === 'wemos-d1-mini') return <Board w={id === 'wemos-d1-mini' ? 38 : 50} h={id === 'wemos-d1-mini' ? 34 : 26} color={id === 'esp32-devkit' ? '#1b1d22' : '#2a2d34'} usb="left" title={id === 'esp32-devkit' ? 'ESP32' : id === 'nodemcu' ? 'NodeMCU' : 'D1 mini'} headers="rows" />;
  if (id === 'dht11' || id === 'dht22') return <ModuleBoard title={id.toUpperCase()} color={id === 'dht11' ? '#2c7bd1' : '#e8ecef'} pins={4} w={34} h={42} extra={<path d="M20 22h24M20 26h24M20 30h24M20 34h24" stroke="#00000055" strokeWidth={1.2} />} />;
  if (id === 'hc-05' || id === 'hc-06') return <ModuleBoard title={id.toUpperCase()} color="#2c6fc0" pins={id === 'hc-05' ? 6 : 4} w={52} h={28} extra={<rect x={36} y={28} width={12} height={8} fill="#c9ced6" stroke="#555" />} />;
  if (def && (def.category === 'sensor' || def.category === 'module')) {
    const colors: Record<string, string> = { 'ldr-module': '#1d5fa8', 'mq2-module': '#1d5fa8', 'soil-moisture': '#222', 'sound-sensor': '#1d5fa8', 'rain-sensor': '#222' };
    return <ModuleBoard title={(spec?.title ?? id).slice(0, 12)} color={colors[id] ?? '#1f7a3a'} pins={Math.min(def.pins.length, 8)} />;
  }
  switch (id) {
    case 'ldr':
      return (
        <g>
          <path d="M24 38V58M40 38V58" {...LEAD} />
          <circle cx={32} cy={24} r={16} fill="#c98b4a" stroke="#7a5128" />
          <path d="M22 18h20M22 24h20M22 30h20" stroke="#4b2e12" strokeWidth={1.6} fill="none" />
        </g>
      );
    case 'ntc':
      return (
        <g>
          <path d="M26 30V58M38 30V58" {...LEAD} />
          <ellipse cx={32} cy={22} rx={13} ry={15} fill="#1f1f24" stroke="#4b4f5a" />
          <text x={32} y={25} textAnchor="middle" fontSize={7} fill="#cfd6e2" fontFamily="Segoe UI, sans-serif">
            NTC
          </text>
        </g>
      );
    case 'R':
      return (
        <g>
          <Leads />
          <path d="M16 25a4 4 0 0 1 4-4h24a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4Z" fill="#d9c7a0" stroke="#8c7a52" />
          {BANDS.map((c, i) => (
            <rect key={i} x={20 + i * 6 + (i === 3 ? 4 : 0)} y={21} width={3.2} height={22} fill={c} />
          ))}
        </g>
      );
    case 'C':
      return (
        <g>
          <path d="M26 30V58M38 30V58" {...LEAD} />
          <path d="M16 30a16 16 0 0 1 32 0Z" fill="#e0902f" stroke="#8b5a1a" />
          <text x={32} y={27} textAnchor="middle" fontSize={7} fill="#4a2c06" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
            104
          </text>
        </g>
      );
    case 'cap-electrolytic':
      return (
        <g>
          <path d="M26 44V60M38 44V60" {...LEAD} />
          <rect x={18} y={10} width={28} height={36} rx={4} fill="#2f5da8" stroke="#1d3c70" />
          <rect x={18} y={10} width={8} height={36} fill="#cfd6e2" />
          <text x={36} y={32} textAnchor="middle" fontSize={7} fill="#fff" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
            100µ
          </text>
        </g>
      );
    case 'L':
      return (
        <g>
          <Leads />
          <rect x={14} y={22} width={36} height={20} rx={10} fill="#3b3f48" />
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M${19 + i * 6} 21V43`} stroke="#d17a3a" strokeWidth={3.2} />
          ))}
        </g>
      );
    case 'potentiometer':
      return (
        <g>
          <path d="M20 44V58M32 44V58M44 44V58" {...LEAD} />
          <rect x={12} y={20} width={40} height={26} rx={3} fill="#2f6fb3" stroke="#1e4a7a" />
          <circle cx={32} cy={30} r={9} fill="#d5d9df" stroke="#6b7280" />
          <path d="M32 22V31" stroke="#333" strokeWidth={2} />
        </g>
      );
    case 'D':
    case 'schottky':
    case 'zener':
      return (
        <g>
          <Leads />
          <rect x={16} y={24} width={32} height={16} rx={3} fill={id === 'zener' ? '#c58a3a' : BLACK} stroke="#3a3f4a" />
          <rect x={40} y={24} width={5} height={16} fill="#d4d8de" />
        </g>
      );
    case 'LED':
      return <Led color="#ff3b30" />;
    case 'led-green':
      return <Led color="#34e06a" />;
    case 'led-yellow':
      return <Led color="#ffd60a" />;
    case 'led-blue':
      return <Led color="#3a86ff" />;
    case 'led-white':
      return <Led color="#f2f2f2" />;
    case 'led-rgb':
      return (
        <g>
          <path d="M22 36V58M29 36V54M36 36V58M43 36V58" {...LEAD} />
          <path d="M18 36V24a14 14 0 0 1 28 0V36Z" fill="#ffffff" fillOpacity={0.55} stroke="#aab" />
          <circle cx={26} cy={26} r={3} fill="#ff3b30" />
          <circle cx={38} cy={26} r={3} fill="#3a86ff" />
          <circle cx={32} cy={20} r={3} fill="#34e06a" />
        </g>
      );
    case '7seg-cc':
    case '7seg-ca':
      return <SevenSeg />;
    case 'bridge':
      return (
        <g>
          <path d="M18 40V58M28 40V58M38 40V58M48 40V58" {...LEAD} />
          <rect x={12} y={12} width={40} height={28} rx={3} fill={BLACK} stroke="#3a3f4a" />
          <path d="M22 26l6-6 6 6-6 6Z" fill="none" stroke="#cfd6e2" />
          <text x={42} y={30} fontSize={8} fill="#cfd6e2" fontFamily="Segoe UI, sans-serif">
            ~
          </text>
        </g>
      );
    case 'optocoupler':
      return <Chip left={2} right={2} title="PC817" />;
    case 'QNPN':
    case 'QPNP':
    case 'NMOS':
    case 'PMOS':
      return <To92 />;
    case 'nmos-power':
    case 'pmos-power':
    case 'regulator':
      return <To220 />;
    case 'relay':
      return (
        <g>
          <path d="M14 46V58M24 46V58M40 46V58M50 46V58" {...LEAD} />
          <rect x={8} y={12} width={48} height={34} rx={2} fill="#2c64b5" stroke="#1b3f75" />
          <rect x={14} y={18} width={20} height={14} fill="#1b3f75" />
          <text x={32} y={41} textAnchor="middle" fontSize={7} fill="#fff" fontFamily="Segoe UI, sans-serif" fontWeight={700}>
            RELAY 5V
          </text>
        </g>
      );
    case 'SW':
    case 'spdt':
      return (
        <g>
          <path d="M18 46V58M32 46V58M46 46V58" {...LEAD} />
          <rect x={12} y={30} width={40} height={16} rx={2} fill="#cfd6e2" stroke="#6b7280" />
          <path d="M32 30L26 10" stroke="#222" strokeWidth={4} strokeLinecap="round" />
          <circle cx={26} cy={10} r={3.5} fill="#c0392b" />
        </g>
      );
    case 'VDC':
    case 'battery':
      return <Cell label={id === 'battery' ? '9V' : 'DC'} />;
    case 'VAC':
    case 'VPULSE':
    case 'vtri':
      return (
        <g>
          <rect x={8} y={14} width={48} height={36} rx={4} fill="#3b4252" stroke="#6b7280" />
          <rect x={12} y={18} width={40} height={20} rx={2} fill="#0f2a1f" />
          <path d={id === 'VAC' ? 'M14 28q4-9 8 0t8 0 8 0 8 0' : id === 'VPULSE' ? 'M14 33V23H22V33H30V23H38V33H46V23' : 'M14 33l8-10 8 10 8-10 8 10'} fill="none" stroke="#5fd38d" strokeWidth={1.4} />
          <circle cx={20} cy={44} r={2.5} fill="#c0392b" />
          <circle cx={32} cy={44} r={2.5} fill="#222" />
        </g>
      );
    case 'IDC':
      return (
        <g>
          <circle cx={32} cy={32} r={18} fill="#3b4252" stroke="#6b7280" />
          <path d="M32 42V22M26 28L32 21L38 28" stroke="#f5c542" strokeWidth={2.4} fill="none" strokeLinecap="round" />
        </g>
      );
    case 'voltmeter':
      return <Meter label="V" />;
    case 'ammeter':
      return <Meter label="A" />;
    case 'dc-motor':
      return (
        <g>
          <rect x={44} y={29} width={14} height={6} fill={METAL} />
          <rect x={8} y={16} width={38} height={32} rx={4} fill="#9aa3b2" stroke="#5b6270" />
          <rect x={8} y={16} width={10} height={32} fill="#6b7280" />
          <text x={30} y={36} textAnchor="middle" fontSize={11} fontWeight={700} fill="#222" fontFamily="Segoe UI, sans-serif">
            M
          </text>
        </g>
      );
    case 'speaker':
      return (
        <g>
          <circle cx={32} cy={32} r={22} fill="#2a2d34" stroke="#555a66" />
          <circle cx={32} cy={32} r={14} fill="#3d414b" stroke="#6b7280" />
          <circle cx={32} cy={32} r={5} fill="#1b1d22" />
        </g>
      );
    case 'GND':
      return (
        <g stroke="var(--sym)" strokeWidth={2.4} fill="none" strokeLinecap="round">
          <path d="M32 10V30M16 30H48M22 38H42M28 46H36" />
        </g>
      );
    case 'PROBE':
      return (
        <g>
          <path d="M32 40V58" {...LEAD} />
          <circle cx={32} cy={26} r={13} fill="#f5c542" fillOpacity={0.25} stroke="#f5c542" strokeWidth={2} />
          <circle cx={32} cy={26} r={6} fill="#f5c542" />
        </g>
      );
    case 'OPAMP':
    case 'opamp-supply':
      return <Chip left={4} right={4} title="OP-AMP" />;
    case 'ARDUINO_NANO':
      return <Board w={26} h={46} color="#1b6fa8" usb="top" title="NANO" headers="nano" />;
    case 'PICO_W':
      return <Board w={52} h={22} color="#1f7a3a" usb="top" title="PICO W" headers="rows" />;
    case 'ARDUINO_UNO':
      return <Board w={50} h={38} color="#0f7b8a" usb="left" title="UNO" headers="uno" />;
    case 'ARDUINO_MEGA':
      return <Board w={60} h={34} color="#0f7b8a" usb="left" title="MEGA 2560" headers="uno" />;
    case 'PICO':
      return <Board w={52} h={22} color="#1f7a3a" usb="top" title="PICO" headers="rows" />;
    default:
  }
  if (id.startsWith('conn-')) {
    const n = Number(id.slice(5)) || 2;
    const k = Math.min(n, 8);
    return (
      <g>
        <rect x={32 - k * 3.4} y={26} width={k * 6.8} height={14} fill={BLACK} stroke="#3a3f4a" />
        {Array.from({ length: k }, (_, i) => (
          <rect key={i} x={32 - k * 3.4 + 2.2 + i * 6.8} y={19} width={2.4} height={21} fill="#e6c860" />
        ))}
      </g>
    );
  }
  if (id.startsWith('PIC')) {
    const half = def ? Math.min(def.pins.length / 2, 8) : 8;
    return <Chip left={half} right={half} title={id.replace('PIC', 'PIC ')} />;
  }
  if (id.startsWith('gate-') || id === 'dff') {
    const names: Record<string, string> = { nand: 'NAND', nor: 'NOR', and: 'AND', or: 'OR', xor: 'XOR', xnor: 'XNOR', inv: 'NOT', buf: 'BUF' };
    return <Chip left={id === 'gate-inv' || id === 'gate-buf' ? 1 : 2} right={id === 'dff' ? 2 : 1} title={id === 'dff' ? 'D-FF' : (names[id.slice(5)] ?? 'LOGIC')} />;
  }
  if (id.startsWith('74hc')) return <Chip left={7} right={7} title={id.toUpperCase()} />;
  if (id === 'ne555' || id === 'lm358' || id === 'lm741') return <Chip left={4} right={4} title={id.toUpperCase()} />;
  if (spec?.symbol.kind === 'like') return drawing(spec.symbol.like);
  if (def && (def.category === 'mcu' || def.category === 'ic' || def.category === 'logic' || spec?.symbol.kind === 'box')) {
    const half = Math.ceil(def.pins.length / 2);
    return <Chip left={Math.min(half, 8)} right={Math.min(def.pins.length - half, 8)} title={(spec?.title ?? def.mcu?.title ?? id).slice(0, 12)} />;
  }
  return <Chip left={4} right={4} title={id.slice(0, 8).toUpperCase()} />;
}
