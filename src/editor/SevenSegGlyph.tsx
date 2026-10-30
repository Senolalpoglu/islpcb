/** Segment outlines of one digit, centred on (0, 0), about 52 wide and 96 high; a b c d e f g in the order of the part's pins. */
const SEGMENTS = [
  '-17,-44 -13,-48 13,-48 17,-44 13,-40 -13,-40', // a
  '22,-44 26,-40 26,-4 22,-1 18,-4 18,-40', // b
  '22,1 26,4 26,40 22,44 18,40 18,4', // c
  '-17,44 -13,40 13,40 17,44 13,48 -13,48', // d
  '-22,1 -18,4 -18,40 -22,44 -26,40 -26,4', // e
  '-22,-44 -18,-40 -18,-4 -22,-1 -26,-4 -26,-40', // f
  '-17,0 -13,-4 13,-4 17,0 13,4 -13,4', // g
];
const LIT = '#ff3b30';
/** A digit of a multi-digit display is drawn at this scale, this far apart. */
const SCALE = 0.8;
const PITCH = 50;

/**
 * The digits of a 7-segment display with the segments that are lit in red and the others as a faint ghost, drawn over the
 * part. `levels` holds the brightness 0..1 of a b c d e f g and the decimal point of each digit one after the other;
 * without it nothing is lit. One digit fills the box of the part; several are drawn side by side, centred on (0, 0).
 */
export function SevenSegGlyph({ levels, digits = 1 }: { levels?: number[]; digits?: number }) {
  const at = (digit: number, k: number): number => levels?.[digit * 8 + k] ?? 0;
  const width = digits === 1 ? 76 : digits * PITCH + 16;
  const height = digits === 1 ? 124 : 124 * SCALE + 4;
  return (
    <g pointerEvents="none" stroke="none">
      <rect x={-width / 2} y={-height / 2} width={width} height={height} rx={6} fill="#0b0d10" opacity={0.9} />
      {Array.from({ length: digits }, (_, d) => (
        <g key={d} transform={digits === 1 ? undefined : `translate(${(d - (digits - 1) / 2) * PITCH} 0) scale(${SCALE})`}>
          {SEGMENTS.map((pts, k) => (
            <polygon key={k} points={pts} fill={at(d, k) > 0.04 ? LIT : '#5a6270'} opacity={at(d, k) > 0.04 ? 0.3 + 0.7 * at(d, k) : 0.18} />
          ))}
          <circle cx={31} cy={46} r={4} fill={at(d, 7) > 0.04 ? LIT : '#5a6270'} opacity={at(d, 7) > 0.04 ? 0.3 + 0.7 * at(d, 7) : 0.18} />
        </g>
      ))}
    </g>
  );
}
