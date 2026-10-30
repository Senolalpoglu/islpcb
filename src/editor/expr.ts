// A small, safe expression evaluator for part definitions: "$r * (1 - $pos)", "$vout / 2", "$pos > 0.5".
// No eval: a recursive-descent parser over numbers, $parameters, + - * / ^, comparisons, ! and a few functions.

const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };

const FUNCTIONS: Record<string, (...a: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  sqrt: Math.sqrt,
  exp: Math.exp,
  ln: Math.log,
  log10: Math.log10,
  pow: Math.pow,
};

export class ExprError extends Error {}

export function evalExpression(text: string, params: Record<string, number>): number {
  const src = text.trim();
  let i = 0;
  const peek = (): string => src[i] ?? '';
  const ws = (): void => {
    while (peek() === ' ' || peek() === '\t') i++;
  };
  const eat = (s: string): boolean => {
    ws();
    if (src.startsWith(s, i)) {
      i += s.length;
      return true;
    }
    return false;
  };
  const fail = (m: string): never => {
    throw new ExprError(`${m} in "${text}"`);
  };

  const primary = (): number => {
    ws();
    if (eat('(')) {
      const v = compare();
      if (!eat(')')) fail('Missing )');
      return v;
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) {
      i += num[0].length;
      let v = parseFloat(num[0]);
      const suffix = src[i];
      if (suffix && suffix in SI && !/[A-Za-z0-9_]/.test(src[i + 1] ?? '')) {
        v *= SI[suffix];
        i++;
      }
      return v;
    }
    if (peek() === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(src.slice(i));
      if (!m) return fail('Bad parameter name');
      i += m[0].length;
      if (!(m[1] in params)) return fail(`Unknown parameter $${m[1]}`);
      return params[m[1]];
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) {
      i += id[0].length;
      const fn = FUNCTIONS[id[0]];
      if (!fn) return fail(`Unknown function ${id[0]}`);
      if (!eat('(')) return fail(`${id[0]} needs arguments`);
      const args: number[] = [compare()];
      while (eat(',')) args.push(compare());
      if (!eat(')')) fail('Missing )');
      return fn(...args);
    }
    return fail('Unexpected input');
  };
  const unary = (): number => {
    if (eat('-')) return -unary();
    if (eat('+')) return unary();
    if (eat('!')) return unary() === 0 ? 1 : 0;
    const base = primary();
    return eat('^') ? Math.pow(base, unary()) : base;
  };
  const product = (): number => {
    let v = unary();
    for (;;) {
      if (eat('*')) v *= unary();
      else if (eat('/')) {
        const d = unary();
        if (d === 0) fail('Division by zero');
        v /= d;
      } else return v;
    }
  };
  const sum = (): number => {
    let v = product();
    for (;;) {
      if (eat('+')) v += product();
      else if (eat('-')) v -= product();
      else return v;
    }
  };
  const compare = (): number => {
    const l = sum();
    if (eat('>=')) return l >= sum() ? 1 : 0;
    if (eat('<=')) return l <= sum() ? 1 : 0;
    if (eat('==')) return l === sum() ? 1 : 0;
    if (eat('!=')) return l !== sum() ? 1 : 0;
    if (eat('>')) return l > sum() ? 1 : 0;
    if (eat('<')) return l < sum() ? 1 : 0;
    return l;
  };

  const v = compare();
  ws();
  if (i < src.length) fail(`Unexpected "${src.slice(i, i + 8)}"`);
  if (!Number.isFinite(v)) fail('Result is not a number');
  return v;
}

/** A value from a data file: a literal number or an expression over the part's parameters. */
export type Value = number | string;

export const resolve = (v: Value, params: Record<string, number>): number => (typeof v === 'number' ? v : evalExpression(v, params));
