import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { footprintById } from '../core/pcb/footprints';
import { addPart, emptyDoc, PART_DEFS, type PartType } from '../src/editor/model';
import { loadBuiltinLibrary } from '../src/editor/library';
import { partValueText } from '../src/editor/values';
import { buildModel } from '../src/pcb/models3d';
import { defaultFootprint, footprintChoices } from '../src/pcb/sync';

beforeAll(() => {
  expect(loadBuiltinLibrary()).toEqual([]);
});

const POLAR = ['x:cap-electrolytic', 'x:cap-tantalum'] as PartType[];

describe('polarised capacitors', () => {
  it('have a + and a - pin, a capacitance and a rated voltage', () => {
    for (const type of POLAR) {
      const def = PART_DEFS[type];
      expect(def.pinNames, type).toEqual(['+', '-']);
      expect(def.params.map((p) => p.name), type).toEqual(['c', 'v', 'esr', 'ic']);
      expect(def.custom?.symbol, type).toEqual({ kind: 'glyph', glyph: 'cap-polar' });
    }
  });

  it('show capacitance and voltage as the value, from the parameters the user typed', () => {
    const doc = addPart(emptyDoc(), 'x:cap-electrolytic', 0, 0);
    const part = { ...doc.parts[0], params: { ...doc.parts[0].params, c: 4.7e-5, v: 35 } };
    expect(partValueText(part)).toBe('47 µF 35 V');
    expect(partValueText({ ...part, params: { ...part.params, c: 1e-6, v: 6.3 } })).toBe('1 µF 6.3 V');
  });

  it('offer the can sizes of an electrolytic, every one with the + lead on the square pad', () => {
    const choices = footprintChoices('x:cap-electrolytic' as PartType);
    expect(choices).toEqual(['CAP_RADIAL_D6.3_P2.5', 'CAP_RADIAL_D5_P2', 'CAP_RADIAL_D8_P3.5', 'CAP_RADIAL_D10_P5', 'CAP_RADIAL_D12.5_P5', 'CAP_RADIAL_D16_P7.5']);
    expect(defaultFootprint({ type: 'x:cap-electrolytic' })).toBe(choices[0]);
    for (const id of choices) {
      const def = footprintById(id)!;
      expect(def.pads.map((p) => p.pin), id).toEqual([0, 1]);
      expect(def.pads[0].shape, id).toBe('rect');
      const dia = Number(/_D([\d.]+)_/.exec(id)![1]);
      expect(def.body, id).toEqual({ w: dia, h: dia });
      // The copper of the two pads must keep a gap.
      expect(def.pads[1].x - def.pads[0].x - def.pads[0].w, id).toBeGreaterThanOrEqual(0.4);
      // The 3D can is as wide as the footprint says.
      const box = new THREE.Box3().setFromObject(buildModel(def, { type: 'x:cap-electrolytic', polarised: { cathodeIndex: 1, plusIndex: 0 } }));
      expect(box.max.x - box.min.x, id).toBeCloseTo(dia, 0);
    }
  });

  it('give a tantalum the two radial lead spacings', () => {
    expect(footprintChoices('x:cap-tantalum' as PartType)).toEqual(['CAP_RADIAL_2.54', 'CAP_RADIAL_5.08']);
  });
});

describe('TO-92 3D model', () => {
  it('is a closed solid: the flat face towards the leads is there, not just the round back', () => {
    const model = buildModel(footprintById('TO92')!, { type: 'QNPN' });
    const body = model.children.find((c) => (c as THREE.Mesh).geometry?.type === 'ExtrudeGeometry') as THREE.Mesh;
    expect(body).toBeDefined();
    body.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(body);
    // A D-shape: the full diameter across the leads, one radius deep, the flat side at z = 0.
    expect(box.max.x - box.min.x).toBeCloseTo(4.8, 1);
    expect(box.min.z).toBeCloseTo(0, 1);
    expect(box.max.z).toBeCloseTo(2.4, 1);
    // Some triangles lie in the plane z = 0: that is the flat face, and it spans the whole height of the body.
    const pos = body.geometry.getAttribute('position');
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(body.matrixWorld);
    let flat = 0;
    let top = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const tri = [v(i), v(i + 1), v(i + 2)];
      if (tri.every((p) => Math.abs(p.z) < 1e-4)) {
        flat++;
        top = Math.max(top, ...tri.map((p) => p.y));
      }
    }
    expect(flat).toBeGreaterThanOrEqual(2);
    expect(top).toBeCloseTo(4.6, 1);
  });
});
