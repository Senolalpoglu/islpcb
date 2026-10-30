// PCB data model. All lengths are millimetres; the y axis points down (screen convention).

export interface Pt {
  x: number;
  y: number;
}

export type Layer = 'top' | 'bottom';
export type Rot = 0 | 90 | 180 | 270;
export type PadShape = 'round' | 'rect' | 'oval';

/** One pad of a footprint, in footprint coordinates (origin at the footprint centre, rotation 0). */
export interface PadDef {
  /** Label printed on the board and in reports: the physical pin number or name. */
  name: string;
  x: number;
  y: number;
  shape: PadShape;
  w: number;
  h: number;
  /** Plated hole diameter; 0 for surface-mount pads. */
  drill: number;
  /** Index of the schematic symbol pin this pad connects to, or null for a mechanical / unused pad. */
  pin: number | null;
}

export interface FootprintDef {
  id: string;
  label: string;
  pads: PadDef[];
  /** Silkscreen body outline (centred, rotation 0). */
  body: { w: number; h: number };
}

/** A footprint placed on the board, bound to a schematic part. */
export interface FootprintInst {
  partId: string;
  footprint: string;
  x: number;
  y: number;
  rot: Rot;
  /** Flipped left to right, before the rotation: for a part whose real pin layout is the mirror image of the drawing. */
  mirror?: boolean;
  /** Overrides the pad diameter (the smaller pad dimension), in mm. */
  padSize?: number;
  /** Overrides the drill diameter, in mm. */
  drill?: number;
  /** Placed by hand: automatic placement leaves this footprint where it is. */
  locked?: boolean;
}

export interface Track {
  id: string;
  layer: Layer;
  width: number;
  pts: Pt[];
  net: string;
}

/** A copper pour (ground plane): the board area of one layer filled with the copper of `net`, kept `clearance` away from every other net. */
export interface Pour {
  id: string;
  layer: Layer;
  net: string;
  /** Gap to copper of other nets; the board rules' clearance when absent. */
  clearance?: number;
}

export interface Via {
  id: string;
  x: number;
  y: number;
  dia: number;
  drill: number;
  net: string;
}

export interface Rules {
  clearance: number;
  trackWidth: number;
  viaDia: number;
  viaDrill: number;
  /** Minimum distance from copper to the board edge. */
  edgeClearance: number;
}

export interface Board {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PcbDoc {
  version: 1;
  board: Board;
  fps: FootprintInst[];
  tracks: Track[];
  vias: Via[];
  rules: Rules;
  nextId: number;
  /** 2 (default): copper on both sides. 1: single-sided board, copper on the bottom only, no vias. */
  sides?: 1 | 2;
  /** Copper pours (ground planes). */
  pours?: Pour[];
}

export const DEFAULT_RULES: Rules = { clearance: 0.2, trackWidth: 0.3, viaDia: 0.8, viaDrill: 0.4, edgeClearance: 0.5 };

export const emptyPcb = (): PcbDoc => ({
  version: 1,
  board: { x: 0, y: 0, w: 60, h: 40 },
  fps: [],
  tracks: [],
  vias: [],
  rules: { ...DEFAULT_RULES },
  nextId: 1,
});

/** A pad in board coordinates, with the net it belongs to. */
export interface AbsPad {
  /** `${partId}:${pin}` for connected pads, `${partId}#${name}` for unconnected ones. */
  key: string;
  partId: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: PadShape;
  drill: number;
  smd: boolean;
  net: string | null;
  /** The pad of a positive pin (+ of a capacitor, battery or connector, the anode of a diode): always drawn square. */
  positive?: boolean;
  /** The cathode of a diode or LED: its end of the part gets a bar on the silkscreen. */
  cathode?: boolean;
  /** A pin named "+": a plus sign is printed next to it. */
  plus?: boolean;
}
