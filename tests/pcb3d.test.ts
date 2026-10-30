import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { footprintById } from '../core/pcb/footprints';
import { loadBuiltinLibrary } from '../src/editor/library';
import { PART_DEFS, PART_ORDER } from '../src/editor/model';
import { buildModel, resistorBands } from '../src/pcb/models3d';
import { defaultFootprint } from '../src/pcb/sync';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

describe('3D models', () => {
  it('reads the colour bands of a resistor', () => {
    expect(resistorBands(4700)).toEqual([4, 7, 2]);
    expect(resistorBands(10)).toEqual([1, 0, 0]);
    expect(resistorBands(220)).toEqual([2, 2, 1]);
    expect(resistorBands(1_000_000)).toEqual([1, 0, 5]); // brown, black, green
  });

  it('builds a model for every part that has a footprint, standing on the board and not absurdly big', () => {
    let built = 0;
    for (const type of PART_ORDER) {
      const id = defaultFootprint({ type });
      const def = id ? footprintById(id) : undefined;
      if (!def) continue;
      const model = buildModel(def, { type });
      const box = new THREE.Box3().setFromObject(model);
      expect(box.isEmpty(), type).toBe(false);
      expect(box.max.y, type).toBeGreaterThan(0.5); // something rises above the board
      expect(box.max.y, type).toBeLessThan(40);
      // The body stays near its footprint (the pads), within a few mm of the silkscreen outline.
      expect(box.max.x - box.min.x, type).toBeLessThan(def.body.w + 40);
      expect(PART_DEFS[type], type).toBeDefined();
      built++;
    }
    expect(built).toBeGreaterThan(100);
  });
});
