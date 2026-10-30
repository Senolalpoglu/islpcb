import { beforeAll, describe, expect, it } from 'vitest';
import { familiesOf, familyOf } from '../src/editor/families';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, PART_ORDER, type Category } from '../src/editor/model';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

describe('library families', () => {
  it('puts every part into exactly one family of its own category', () => {
    const categories = [...new Set(PART_ORDER.map((t) => PART_DEFS[t].category))] as Category[]; // after the library is loaded
    const seen = new Set<string>();
    for (const cat of categories) {
      for (const f of familiesOf(cat, PART_ORDER)) {
        for (const m of f.members) {
          expect(PART_DEFS[m].category).toBe(cat);
          expect(seen.has(m), `${m} is in two families`).toBe(false);
          seen.add(m);
        }
      }
    }
    expect(seen.size).toBe(PART_ORDER.length);
  });

  it('leaves nothing in a catch-all family: every shipped part has a proper group', () => {
    const stray = PART_ORDER.filter((t) => familyOf(t).id.startsWith('other-'));
    expect(stray).toEqual([]);
  });

  it('groups similar parts together', () => {
    const fam = (t: string) => familyOf(t).id;
    expect(fam('QNPN')).toBe(fam('x:2n3904'));
    expect(fam('x:2n3904')).toBe(fam('x:bc547'));
    expect(fam('QPNP')).toBe('pnp');
    expect(fam('NMOS')).toBe(fam('x:irf540n'));
    expect(fam('D')).toBe(fam('x:1n4007'));
    expect(fam('x:zener')).toBe(fam('x:1n4733'));
    expect(fam('x:led-green')).toBe(fam('LED'));
    expect(fam('x:relay-dpdt')).toBe(fam('x:relay-3pdt'));
    expect(fam('x:lm7805')).toBe('reg-pos');
    expect(fam('x:lm7905')).toBe('reg-neg');
    expect(fam('x:scr-bt151')).toBe(fam('x:scr-2n5060'));
    expect(fam('x:triac-bt136')).toBe(fam('x:diac-db3'));
    expect(fam('x:hc-05')).toBe(fam('x:nrf24l01'));
    expect(fam('ARDUINO_UNO')).toBe(fam('ARDUINO_MEGA'));
  });

  it('a new imported part still shows up, in the catch-all of its category', () => {
    expect(familyOf('x:lm7805').id).not.toMatch(/^other/);
  });
});
