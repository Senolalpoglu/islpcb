import { eng } from './units';
import type { Part } from './model';

/** The short value shown next to a part on the schematic and listed in the bill of materials. */
export function partValueText(p: Part): string {
  const n = (k: string): number => (typeof p.params[k] === 'number' ? (p.params[k] as number) : 0);
  switch (p.type) {
    case 'R':
      return eng(n('r'), 'Ω');
    case 'C':
      return eng(n('c'), 'F');
    case 'L':
      return eng(n('l'), 'H');
    case 'VDC':
      return eng(n('v'), 'V');
    case 'VAC':
      return `${eng(n('amp'), 'V')} ${eng(n('freq'), 'Hz')}`;
    case 'VPULSE':
      return `${eng(n('high'), 'V')} ${eng(n('freq'), 'Hz')}`;
    case 'IDC':
      return eng(n('i'), 'A');
    case 'PROBE':
      return String(p.params.label ?? '');
    case 'x:cap-electrolytic':
    case 'x:cap-tantalum':
      // Capacitance and the voltage it is rated for, e.g. "100 µF 25 V".
      return `${eng(n('c'), 'F')} ${+n('v').toPrecision(3)} V`;
    default:
      return '';
  }
}
