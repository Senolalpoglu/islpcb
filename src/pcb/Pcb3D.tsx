// The finished board in 3D: the board with its copper and silkscreen, and the parts standing on it. Left button turns
// the board, right (or middle) button moves it, the wheel zooms, like in EasyEDA.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { footprintById } from '../../core/pcb/footprints';
import type { AbsPad, PcbDoc } from '../../core/pcb/types';
import { useI18n } from '../i18n';
import { PART_DEFS, partLabel, type Doc } from '../editor/model';
import { partValueText } from '../editor/values';
import { drawFace } from './boardTexture';
import { buildModel, type PartInfo } from './models3d';

const THICKNESS = 1.6;

interface Props {
  doc: Doc;
  pcb: PcbDoc;
  pads: AbsPad[];
}

interface Api {
  view: (kind: 'top' | 'bottom' | 'iso') => void;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const tex = (m.material as THREE.MeshStandardMaterial | undefined)?.map;
    tex?.dispose();
  });
}

/** A white text label that always faces the viewer: the reference (R1), the name of the part and its value. */
function labelSprite(lines: string[]): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const rows = lines.filter(Boolean).slice(0, 3);
  const sizes = [76, 46, 46];
  const gap = 12;
  const total = rows.reduce((s, _, i) => s + sizes[i] + gap, -gap);
  let y = (256 - total) / 2;
  rows.forEach((text, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${sizes[i]}px "Segoe UI", Arial, sans-serif`;
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 256, y + sizes[i] / 2, 496);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 256, y + sizes[i] / 2, 496);
    y += sizes[i] + gap;
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  sprite.scale.set(13, 6.5, 1);
  return sprite;
}

/** The board, its two faces and all parts; centred on the origin, the top face at y = THICKNESS / 2. */
export function buildBoardScene(doc: Doc, pcb: PcbDoc, pads: AbsPad[], lang: 'tr' | 'en', t: (k: never) => string): THREE.Group {
  const root = new THREE.Group();
  const b = pcb.board;
  const refs = new Map(doc.parts.map((p) => [p.id, p.ref]));
  const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, THICKNESS, b.h), new THREE.MeshStandardMaterial({ color: 0x6b6a3a, roughness: 0.7 }));
  root.add(body);

  for (const layer of ['top', 'bottom'] as const) {
    const tex = new THREE.CanvasTexture(drawFace(pcb, pads, refs, layer));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(b.w, b.h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 }));
    face.rotation.x = layer === 'top' ? -Math.PI / 2 : Math.PI / 2;
    face.position.y = (layer === 'top' ? 1 : -1) * (THICKNESS / 2 + 0.01);
    root.add(face);
  }

  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const labels = new THREE.Group();
  labels.name = 'labels';
  for (const fp of pcb.fps) {
    const def = footprintById(fp.footprint);
    const part = doc.parts.find((p) => p.id === fp.partId);
    if (!def || !part) continue;
    const mine = pads.filter((p) => p.partId === fp.partId);
    const cathodeIndex = mine.findIndex((p) => p.cathode);
    const plusIndex = mine.findIndex((p) => p.positive);
    const info: PartInfo = {
      type: part.type,
      ...(part.type === 'R' && typeof part.params.r === 'number' ? { ohms: part.params.r } : {}),
      ...(cathodeIndex >= 0 || plusIndex >= 0 ? { polarised: { cathodeIndex, plusIndex } } : {}),
    };
    const model = buildModel(def, info);
    if (fp.mirror) model.scale.x = -1;
    const holder = new THREE.Group();
    holder.add(model);
    holder.rotation.y = (-fp.rot * Math.PI) / 180; // the board turns clockwise seen from above
    holder.position.set(fp.x - cx, THICKNESS / 2, fp.y - cy);
    root.add(holder);

    const def0 = PART_DEFS[part.type];
    const name = def0 ? partLabel(def0, t as never, lang).split(' (')[0] : part.type;
    const sprite = labelSprite([part.ref, name, partValueText(part)]);
    const top = new THREE.Box3().setFromObject(holder).max.y;
    sprite.position.set(holder.position.x, top + 4.5, holder.position.z);
    labels.add(sprite);
  }
  root.add(labels);
  return root;
}

export function Pcb3D({ doc, pcb, pads }: Props) {
  const { t, lang } = useI18n();
  const [showLabels, setShowLabels] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const content = useRef<THREE.Group | null>(null);
  const scene = useRef<THREE.Scene | null>(null);
  const redraw = useRef<() => void>(() => {});
  const size = useRef(60);

  // The stage: renderer, camera, lights and mouse control. Built once.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setClearColor(0x252b33);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const sc = new THREE.Scene();
    scene.current = sc;
    sc.add(new THREE.HemisphereLight(0xffffff, 0x33363c, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 90, 50);
    sc.add(sun);
    const fill = new THREE.DirectionalLight(0xbfd2ff, 0.5);
    fill.position.set(-50, 30, -40);
    sc.add(fill);
    const under = new THREE.DirectionalLight(0xffffff, 1.5); // so the underside of the board is lit too
    under.position.set(-20, -90, -30);
    sc.add(under);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    const draw = (): void => renderer.render(sc, camera);
    redraw.current = draw;
    controls.addEventListener('change', draw);

    const place = (kind: 'top' | 'bottom' | 'iso'): void => {
      const d = size.current * 1.25;
      controls.target.set(0, 0, 0);
      if (kind === 'top') camera.position.set(0, d, 0.001);
      else if (kind === 'bottom') camera.position.set(0, -d, 0.001);
      else camera.position.set(d * 0.35, d * 0.85, d * 0.8);
      camera.lookAt(0, 0, 0);
      controls.update();
      draw();
    };
    api.current = { view: place };

    const resize = (): void => {
      const w = Math.max(1, el.clientWidth);
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    place('iso');

    return () => {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.current = null;
      api.current = null;
    };
  }, []);

  // The board and its parts: rebuilt when the layout changes.
  useEffect(() => {
    const sc = scene.current;
    if (!sc) return;
    if (content.current) {
      sc.remove(content.current);
      disposeTree(content.current);
    }
    const group = buildBoardScene(doc, pcb, pads, lang, t as never);
    const labels = group.getObjectByName('labels');
    if (labels) labels.visible = showLabels;
    sc.add(group);
    content.current = group;
    const before = size.current;
    size.current = Math.max(pcb.board.w, pcb.board.h, 20);
    if (size.current !== before) api.current?.view('iso'); // a board of another size: frame it again
    redraw.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pcb, pads, lang]);

  useEffect(() => {
    const labels = content.current?.getObjectByName('labels');
    if (labels) labels.visible = showLabels;
    redraw.current();
  }, [showLabels]);

  return (
    <div className="pcb3d">
      <div ref={host} className="pcb3d-host" />
      <div className="pcb3d-bar">
        <button onClick={() => api.current?.view('iso')}>{t('pcb3d.iso')}</button>
        <button onClick={() => api.current?.view('top')}>{t('pcb3d.top')}</button>
        <button onClick={() => api.current?.view('bottom')}>{t('pcb3d.bottom')}</button>
        <label className="inline">
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          <span>{t('pcb3d.labels')}</span>
        </label>
      </div>
      <div className="pcb3d-hint">{t('pcb3d.hint')}</div>
    </div>
  );
}
