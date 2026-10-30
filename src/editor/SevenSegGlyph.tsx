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

/**
 * The digit of a 7-segment display with the segments that are lit in red, the others as a faint ghost, drawn over the
 * box of the part. `levels` holds the brightness 0..1 of a b c d e f g and the decimal point; without it nothing is lit.
 */
export function SevenSegGlyph({ levels }: { levels?: number[] }) {
  const at = (k: number): number => levels?.[k] ?? 0;
  return (
    <g pointerEvents="none" stroke="none">
      <rect x={-38} y={-62} width={76} height={124} rx={6} fill="#0b0d10" opacity={0.9} />
      {SEGMENTS.map((pts, k) => (
        <polygon key={k} points={pts} fill={at(k) > 0.04 ? LIT : '#5a6270'} opacity={at(k) > 0.04 ? 0.3 + 0.7 * at(k) : 0.18} />
      ))}
      <circle cx={31} cy={46} r={4} fill={at(7) > 0.04 ? LIT : '#5a6270'} opacity={at(7) > 0.04 ? 0.3 + 0.7 * at(7) : 0.18} />
    </g>
  );
}
