const PREFIXES: [number, string][] = [
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Formats a value with an SI prefix, e.g. eng(0.0123, 'A') -> "12.3 mA". */
export function eng(v: number, unit: string, digits = 3): string {
  if (!Number.isFinite(v)) return `— ${unit}`;
  const a = Math.abs(v);
  if (a < 1e-13) return `0 ${unit}`;
  for (const [m, p] of PREFIXES) {
    if (a >= m * 0.9995) return `${+(v / m).toPrecision(digits)} ${p}${unit}`;
  }
  return `${v.toExponential(2)} ${unit}`;
}

const SUFFIX: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };

/** Parses "4.7k", "10u", "1e-6", "2.2µF". Returns null when the text is not a number. */
export function parseEng(text: string): number | null {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(meg|[pnuµmkKMG])?\s*[a-zA-ZΩ]*\s*$/i.exec(text);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const s = m[2];
  const mult = s === undefined ? 1 : s.toLowerCase() === 'meg' ? 1e6 : (SUFFIX[s] ?? 1);
  const out = base * mult;
  return Number.isFinite(out) ? out : null;
}
