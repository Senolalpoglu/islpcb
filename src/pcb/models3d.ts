// Simple 3D models of the parts on a board, built from boxes and cylinders. They are recognisable rather than exact:
// the footprint says how big the body is and where the legs are, the part says what it is (resistor, LED ...).
//
// Local coordinates: x and z are the footprint's x and y (mm, rotation 0), y points up from the board surface.

import * as THREE from 'three';
import type { FootprintDef, PadDef } from '../../core/pcb/types';

const cache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, o: { metal?: number; rough?: number; opacity?: number } = {}): THREE.MeshStandardMaterial {
  const key = `${color}|${o.metal ?? 0}|${o.rough ?? 0.6}|${o.opacity ?? 1}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: o.metal ?? 0,
      roughness: o.rough ?? 0.6,
      ...(o.opacity !== undefined && o.opacity < 1 ? { transparent: true, opacity: o.opacity } : {}),
    });
    cache.set(key, m);
  }
  return m;
}

const METAL = (): THREE.MeshStandardMaterial => mat(0xc9ccd1, { metal: 0.9, rough: 0.3 });
const GOLD = (): THREE.MeshStandardMaterial => mat(0xd9b24a, { metal: 0.9, rough: 0.3 });
const BLACK = (): THREE.MeshStandardMaterial => mat(0x1b1b1d, { rough: 0.5 });

/** A box standing on y (its base), centred on x and z. */
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** A cylinder standing on the board (axis up) with its base at height y. */
function cyl(r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 28), m);
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}

/** A cylinder lying along x, its axis at height y. */
function bar(r: number, len: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 20), m);
  mesh.rotation.z = Math.PI / 2;
  mesh.position.set(x, y, z);
  return mesh;
}

const BAND = [0x111111, 0x7a4a1e, 0xcc2222, 0xff8a1a, 0xf2d21a, 0x2f9e44, 0x2b59c3, 0x8a3fc1, 0x808080, 0xf0f0f0];

/** Colour-band digits of a resistance in ohms: two digits and the power of ten. */
export function resistorBands(ohms: number): number[] {
  if (!(ohms > 0)) return [0, 0, 0];
  let exp = Math.floor(Math.log10(ohms)) - 1;
  let mant = Math.round(ohms / 10 ** exp);
  if (mant >= 100) {
    mant = Math.round(mant / 10);
    exp += 1;
  }
  return [Math.floor(mant / 10) % 10, mant % 10, Math.max(0, Math.min(9, exp))];
}

export interface PartInfo {
  /** The part's type id ("R", "LED", "x:led-green" ...). */
  type: string;
  /** Resistance of a resistor, ohms. */
  ohms?: number;
  /** For a polarised part: the footprint pads (index in the footprint) of its cathode and of its "+" pin. */
  polarised?: { cathodeIndex: number; plusIndex: number };
}

const LED_COLORS: Array<[RegExp, number]> = [
  [/red/i, 0xe5322d],
  [/green/i, 0x2fbf4f],
  [/blue/i, 0x2f6bff],
  [/yellow/i, 0xf5d020],
  [/white/i, 0xf4f4f0],
  [/orange/i, 0xff8a1a],
];

/** Legs through the board: from below the board up into the body. */
function legs(group: THREE.Group, pads: PadDef[], top: number): void {
  for (const p of pads) {
    if (p.drill <= 0) continue;
    const r = Math.max(0.2, p.drill * 0.32);
    group.add(cyl(r, top + 2.2, METAL(), p.x, -2.2, p.y));
  }
}

function padBounds(pads: PadDef[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...pads.map((p) => p.x)),
    maxX: Math.max(...pads.map((p) => p.x)),
    minY: Math.min(...pads.map((p) => p.y)),
    maxY: Math.max(...pads.map((p) => p.y)),
  };
}

function axial(def: FootprintDef, info: PartInfo, g: THREE.Group): void {
  const [a, b] = def.pads;
  const span = Math.abs(b.x - a.x);
  const r = Math.min(1.35, def.body.h / 2);
  const axis = r + 0.15;
  const len = Math.max(2, Math.min(def.body.w, span - 0.8));
  const diode = info.polarised !== undefined;
  const inductor = /^L$|inductor|choke/i.test(info.type);
  g.add(bar(r, len, diode ? BLACK() : inductor ? mat(0x2f4f8f) : mat(0xd9c28f), 0, axis, 0));
  for (const sx of [-1, 1]) g.add(bar(0.28, (span - len) / 2 + 0.3, METAL(), (sx * (span + len)) / 4, axis, 0));
  if (diode) {
    const cathodeX = def.pads[info.polarised!.cathodeIndex]?.x ?? b.x;
    g.add(bar(r + 0.02, 0.6, mat(0xd8d8d8, { rough: 0.4 }), Math.sign(cathodeX) * (len / 2 - 0.5), axis, 0));
  } else if (!inductor) {
    resistorBands(info.ohms ?? 1000).forEach((d, i) => g.add(bar(r + 0.02, 0.35, mat(BAND[d], { rough: 0.5 }), -len / 2 + 0.7 + i * 0.7, axis, 0)));
    g.add(bar(r + 0.02, 0.35, mat(0xd4af37, { metal: 0.6, rough: 0.4 }), len / 2 - 0.6, axis, 0));
  }
  for (const p of def.pads) g.add(cyl(0.28, axis + 2.2, METAL(), p.x, -2.2, p.y));
}

/** The model of one placed part, centred on the footprint origin and standing on y = 0. */
export function buildModel(def: FootprintDef, info: PartInfo): THREE.Group {
  const g = new THREE.Group();
  const id = def.id.split('|')[0];
  const { w, h } = def.body;
  const pads = def.pads;
  const smdOnly = pads.length > 0 && pads.every((p) => p.drill === 0);

  if (/^AXIAL_/.test(id) && pads.length === 2) {
    axial(def, info, g);
    return g;
  }

  if (/^CAP_RADIAL_/.test(id) && pads.length === 2) {
    if (info.polarised) {
      // The sized electrolytics (CAP_RADIAL_D8_P3.5 ...) are drawn at their can diameter, the older generic ones by lead spacing.
      const sized = /^CAP_RADIAL_D/.test(id);
      const r = sized ? w / 2 : Math.max(2.5, Math.abs(pads[1].x - pads[0].x) * 1.1);
      const height = sized ? w * 1.6 + 1.5 : Math.max(7, r * 2.2);
      g.add(cyl(r, height, mat(0x1f3a6e, { rough: 0.4 })));
      g.add(cyl(r * 0.98, 0.1, METAL(), 0, height - 0.05));
      // The light stripe marks the negative side.
      const neg = pads[info.polarised.plusIndex].x < 0 ? 1 : -1;
      g.add(box(0.5, height - 1, 0.6, mat(0xdde3ee), neg * r * 0.98, 0.4, 0));
    } else {
      g.add(box(Math.max(w, 5), 6.5, 2.6, mat(0xf0a830, { rough: 0.5 })));
    }
    legs(g, pads, 0.5);
    return g;
  }

  if (/^LED_(3|5|10)MM$/.test(id)) {
    const hit = LED_COLORS.find(([re]) => re.test(info.type));
    const m = mat(hit ? hit[1] : 0xe5322d, { opacity: 0.8, rough: 0.2 });
    const r = Math.min(2.55, Math.max(w, h) / 2);
    g.add(cyl(r + 0.25, 1, m), cyl(r, 5.5, m, 0, 1));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
    dome.position.y = 6.5;
    g.add(dome);
    legs(g, pads, 1);
    return g;
  }

  if (/^TO92/.test(id)) {
    // A closed D-shaped solid: round on the +z side, flat face towards -z where the leads come out.
    const r = 2.4;
    const d = new THREE.Shape();
    d.moveTo(-r, 0);
    d.absarc(0, 0, r, Math.PI, 2 * Math.PI, false);
    d.closePath();
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(d, { depth: 4.6, bevelEnabled: false, curveSegments: 20 }), BLACK());
    body.rotation.x = -Math.PI / 2; // extrusion becomes height, the shape's -y becomes +z
    g.add(body);
    legs(g, pads, 1.2);
    return g;
  }

  if (id === 'SOT23') {
    // Body 1.3 x 2.9 mm lying along y of the footprint; gull-wing legs reach the pads.
    g.add(box(1.3, 1.0, 2.9, BLACK(), 0, 0.1, 0));
    for (const p of pads) {
      const s = Math.sign(p.x) || 1;
      g.add(box(1.0, 0.2, Math.min(p.h, 0.5), METAL(), s * 1.15, 0, p.y));
    }
    return g;
  }

  if (id === 'SOT223') {
    // Plastic body in the middle, three gull-wing legs on the +y side, the wide tab on the -y side.
    g.add(box(w, 1.6, h, BLACK(), 0, 0.2, 0));
    for (const p of pads) {
      const tab = p.w > 2.5;
      const reach = Math.abs(p.y) - h / 2 + p.h / 2;
      g.add(box(tab ? p.w * 0.95 : 0.7, 0.25, reach, METAL(), p.x, 0, Math.sign(p.y) * (h / 2 + reach / 2 - 0.2)));
    }
    return g;
  }

  if (id === 'TO18' || id === 'TO39') {
    const r = id === 'TO18' ? 2.65 : 4.55;
    g.add(cyl(r, id === 'TO18' ? 5.2 : 6.6, METAL()), cyl(r + 0.35, 0.5, METAL()));
    legs(g, pads, 1);
    return g;
  }

  if (id === 'HC49') {
    g.add(box(11, 3.2, 4.6, METAL(), 0, 0.2));
    legs(g, pads, 0.5);
    return g;
  }

  if (id === 'TO3') {
    // Oval flange with the two mounting holes (the pads at +-y), the can on top and the two pins through the board.
    const holes = pads.filter((p) => p.drill >= 3);
    const reach = holes.length ? Math.max(...holes.map((p) => Math.abs(p.y))) : 15;
    g.add(box(13, 1.2, reach * 2, METAL(), 0, 3));
    for (const sz of [-1, 1]) g.add(cyl(6.5, 1.2, METAL(), 0, 3, sz * reach));
    g.add(cyl(11, 7, METAL(), 0, 4.2), cyl(8.5, 1, METAL(), 0, 11.2));
    for (const p of pads) if (p.drill > 0 && p.drill < 3) g.add(cyl(0.5, 7, METAL(), p.x, -3, p.y));
    return g;
  }

  if (/^TO220|^TO126|^TO247/.test(id)) {
    // Standing package: plastic body on the leads, the metal tab rising behind it (towards -y) with its mounting hole.
    const body = /^TO247/.test(id) ? { h: 15, tab: 5.5 } : /^TO126/.test(id) ? { h: 7.5, tab: 3 } : { h: 9, tab: 6.5 };
    const thick = Math.min(h, 5);
    const lift = 3.5;
    const tabW = w * 0.96;
    const z = -thick / 2 - 0.65;
    g.add(box(w, body.h, thick, BLACK(), 0, lift, 0));
    g.add(box(tabW, body.tab + 2, 1.3, METAL(), 0, lift + body.h - 2, z));
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 1.4, 20), BLACK());
    hole.rotation.x = Math.PI / 2;
    hole.position.set(0, lift + body.h + body.tab - 2.2, z);
    g.add(hole);
    legs(g, pads, lift);
    return g;
  }

  if (/^DIP|^OPAMP_DIP/.test(id)) {
    const b = padBounds(pads);
    const chipW = Math.min(Math.max(w, 5), Math.max(3, b.maxX - b.minX - 0.6));
    const chipH = Math.max(h, b.maxY - b.minY + 1);
    g.add(box(chipW, 3.4, chipH, BLACK(), 0, 0.5));
    g.add(cyl(0.8, 0.05, mat(0x3a3a3d), 0, 3.9, -chipH / 2 + 1.2));
    legs(g, pads, 1);
    return g;
  }

  if (/^FHDR_/.test(id)) {
    g.add(box(w, 8.5, h, BLACK()));
    for (const p of pads) g.add(box(1.0, 0.05, 1.0, mat(0x444448), p.x, 8.5, p.y));
    legs(g, pads, 0.5);
    return g;
  }

  if (/^SIP_|^HDR2X|^HDR_/.test(id)) {
    g.add(box(w, 2.5, h, BLACK()));
    for (const p of pads) g.add(box(0.64, 11.5, 0.64, GOLD(), p.x, -3, p.y));
    return g;
  }

  if (/^TERM_|^TB\d|^PLUG508/.test(id)) {
    const small = id.startsWith('TB350');
    const plug = id.startsWith('PLUG');
    const height = small ? 8.5 : plug ? 8 : 10;
    g.add(box(w, height, h, mat(small ? 0x2f7d4a : plug ? 0x1f7a4a : 0x2c5fa8, { rough: 0.5 })));
    for (const p of pads) {
      g.add(cyl(small ? 1.2 : 1.8, 0.4, METAL(), p.x, height, -h * 0.12));
      g.add(box(small ? 1.6 : 2.6, 3.4, 0.1, BLACK(), p.x, 1.2, h / 2 + 0.01)); // the wire entry
    }
    legs(g, pads, 0.5);
    return g;
  }

  if (/^JSTXH|^TUNIK/.test(id)) {
    g.add(box(w, 7, h, mat(0xe9e2cf, { rough: 0.7 })));
    legs(g, pads, 0.5);
    return g;
  }

  if (/^RELAY|^TRAFO/.test(id)) {
    const trafo = /^TRAFO/.test(id);
    g.add(box(w, trafo ? 14 : 15.5, h, mat(trafo ? 0x2d2f33 : 0x2b6fb5, { rough: 0.5 })));
    legs(g, pads, 1);
    return g;
  }

  if (id === 'PUSH_6MM') {
    g.add(box(6, 3.4, 6, BLACK()));
    g.add(cyl(1.8, 1.6, mat(0xbfc3c8, { rough: 0.4 }), 0, 3.4));
    legs(g, pads, 1);
    return g;
  }

  if (/^BOARD_|^MOD_/.test(id)) {
    const dev = id.startsWith('BOARD_');
    const color = /PICO/.test(id) ? 0x1d7a3a : /UNO|MEGA/.test(id) ? 0x0f6f86 : dev ? 0x1b4e8c : 0x2554a8;
    const lift = 2.5;
    g.add(box(w, 1.6, h, mat(color, { rough: 0.45 }), 0, lift));
    if (dev) for (const sz of [-1, 1]) g.add(box(w * 0.88, lift + 1.6, 2.6, BLACK(), 0, 0, sz * (h / 2 - 1.5))); // the pin rows it stands on
    g.add(box(Math.min(w * 0.3, 14), 1.4, Math.min(h * 0.3, 14), BLACK(), w * 0.1, lift + 1.6, 0));
    if (dev) {
      const usbW = Math.min(12, w * 0.3);
      g.add(box(usbW, 4.2, Math.min(h * 0.4, 11), METAL(), -w / 2 + usbW / 2 - 1, lift + 1.6, 0));
    }
    legs(g, pads, lift);
    return g;
  }

  if (smdOnly) {
    const b = padBounds(pads);
    const bw = Math.max(0.6, Math.min(w, b.maxX - b.minX));
    const bd = Math.max(0.5, h * 0.8);
    const height = /SMD_(1206|0805|0603)/.test(id) ? 0.55 : 1.2;
    g.add(box(bw, height, bd, info.type === 'R' ? BLACK() : mat(0xb89a6a)));
    for (const p of pads) g.add(box(Math.min(p.w, 1), height * 0.9, bd + 0.05, METAL(), p.x, 0, 0));
    return g;
  }

  g.add(box(w, Math.max(2, Math.min(8, Math.min(w, h) * 0.6)), h, mat(0x44474d)));
  legs(g, pads, 1);
  return g;
}
