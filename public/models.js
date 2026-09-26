// Alle 3D-modellen (three.js): bomen, kisten, zwaarden, spelers, monsters en dieren.
import * as THREE from 'three';
import { RARITIES, BASES } from './items.js';

const lerp = (a, b, t) => a + (b - a) * t;
export function mulberryLocal(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- materialen */
export const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a3c25, roughness: 1 });
export const woodCutMat = new THREE.MeshStandardMaterial({ color: 0xc89a5e, roughness: 0.8 });
const leafMats = [0x2f6b2a, 0x3a7d2f, 0x2c6a3a, 0x4b8a34].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
const pineMats = [0x1f4d2b, 0x265a31, 0x1a4526].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
export const foliageMats = [...leafMats, ...pineMats];
export const goldMat = new THREE.MeshStandardMaterial({ color: 0xd9a83a, metalness: 0.5, roughness: 0.35 });
const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1c, roughness: 0.9 });
const metalMat = (c, emi) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.45, roughness: 0.3, emissive: c, emissiveIntensity: emi });
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

/* ---------------------------------------------------------------- organische vormen */
export function makeBlobGeo(r, jit, seed, squash = 0.88, seg = [12, 9]) {
  const g = new THREE.SphereGeometry(r, seg[0], seg[1]);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + jit * (Math.sin(x * 2.3 + seed) + Math.sin(y * 2.9 + seed * 1.3) + Math.sin(z * 2.1 + seed * 0.7)) / 3;
    p.setXYZ(i, x * k, y * k * squash, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------- bomen */
function makeTrunkGeo(h, rb, rt, bend, seed) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 9, 6).translate(0, h / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h;
    p.setX(i, p.getX(i) + Math.sin(t * 2 + seed) * bend * t * t);
    p.setZ(i, p.getZ(i) + Math.cos(t * 1.7 + seed) * bend * t * t);
  }
  g.computeVertexNormals();
  return g;
}
export function makeTreeKit(seed) {
  const kit = { oak: [], pine: [] };
  for (let i = 0; i < 4; i++) {
    const r = mulberryLocal(seed + i * 101);
    const th = 2.8 + r() * 1.2;
    const crowns = [{ geo: makeBlobGeo(1.9 + r() * 0.3, 0.22, r() * 9), x: 0, y: th + 0.9, z: 0 }];
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * 6.28 + r();
      crowns.push({ geo: makeBlobGeo(1.1 + r() * 0.6, 0.25, r() * 9), x: Math.cos(a) * (1.3 + r() * 0.5), y: th + 0.3 + r() * 1.5, z: Math.sin(a) * (1.3 + r() * 0.5) });
    }
    kit.oak.push({ trunk: makeTrunkGeo(th, 0.36, 0.17, 0.35 + r() * 0.3, r() * 9), crowns, mat: leafMats[i % leafMats.length], h: th + 3 });
    const ph = 2.2 + r() * 0.8, cones = [], layers = 4 + (i % 2);
    for (let k = 0; k < layers; k++) {
      const t = k / (layers - 1), cr = lerp(2.1, 0.7, t) * (0.9 + r() * 0.2), chh = lerp(2.5, 1.8, t);
      cones.push({ geo: new THREE.ConeGeometry(cr, chh, 12, 1).translate(0, chh / 2, 0), x: 0, y: ph - 0.3 + k * 1.35, z: 0 });
    }
    kit.pine.push({ trunk: makeTrunkGeo(ph + 3, 0.28, 0.08, 0.12, r() * 9), crowns: cones, mat: pineMats[i % pineMats.length], h: ph + 3 + layers * 1.2 });
  }
  return kit;
}
export function buildTree(kit, type, vi, scale, rotY) {
  const v = kit[type][vi], g = new THREE.Group();
  const trunk = new THREE.Mesh(v.trunk, barkMat); trunk.castShadow = true; g.add(trunk);
  const crown = new THREE.Group(); g.add(crown);
  for (const c of v.crowns) { const m = new THREE.Mesh(c.geo, v.mat); m.position.set(c.x, c.y, c.z); m.castShadow = true; crown.add(m); }
  g.scale.setScalar(scale); g.rotation.y = rotY;
  return { group: g, crown, trunk, height: v.h * scale };
}
const stumpGeo = new THREE.CylinderGeometry(0.28, 0.36, 0.55, 9).translate(0, 0.27, 0);
const stumpTop = new THREE.CircleGeometry(0.29, 9).rotateX(-Math.PI / 2).translate(0, 0.552, 0);
export function buildStump(scale) {
  const s = new THREE.Mesh(stumpGeo, barkMat); s.scale.setScalar(scale); s.castShadow = true; s.receiveShadow = true;
  s.add(new THREE.Mesh(stumpTop, woodCutMat));
  return s;
}

/* ---------------------------------------------------------------- zwaarden en bijl */
export function makeSwordMesh(sw) {
  const R = RARITIES[sw.rarity], B = BASES[sw.base], g = new THREE.Group();
  const s = new THREE.Shape(), w = B.w / 2, L = B.len;
  s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w * 0.85, L * 0.86); s.lineTo(0, L); s.lineTo(-w * 0.85, L * 0.86); s.closePath();
  const bg = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  bg.translate(0, 0.16, -0.006);
  g.add(new THREE.Mesh(bg, metalMat(R.blade, 0.12 + R.emi * 0.35)));
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.014, L * 0.6, 0.032), metalMat(R.blade, R.emi * 0.8));
  fuller.position.y = 0.16 + L * 0.42; g.add(fuller);
  const guard = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.3, 4, 8), goldMat); guard.rotation.z = Math.PI / 2; guard.position.y = 0.16; g.add(guard);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.033, 0.2, 10), leatherMat); grip.position.y = 0.05; g.add(grip);
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 10), goldMat); pommel.position.y = -0.06; g.add(pommel);
  if (R.emi > 0.5) {
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), new THREE.MeshStandardMaterial({ color: R.color, emissive: R.color, emissiveIntensity: 2 }));
    gem.position.set(0, 0.16, 0.035); g.add(gem);
  }
  return g;
}
export function makeAxeMesh() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.95, 10), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.85 }));
  handle.position.y = 0.32; g.add(handle);
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.06, 0.02); s.quadraticCurveTo(0.24, 0.05, 0.27, 0.19); s.lineTo(0.27, -0.02);
  s.quadraticCurveTo(0.24, -0.16, 0.06, -0.12); s.lineTo(0, -0.1); s.closePath();
  const hg = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 8 });
  hg.translate(0.03, 0, -0.015);
  const head = new THREE.Mesh(hg, metalMat(0xb9c2cb, 0)); head.position.y = 0.72; g.add(head);
  return g;
}

/* ---------------------------------------------------------------- kisten */
function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = 0;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
const chestWood = new THREE.MeshStandardMaterial({ color: 0x6b3f1d, roughness: 0.75 });
const chestBaseGeo = new THREE.ExtrudeGeometry(roundedRect(1.2, 0.6, 0.06), { depth: 0.7, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 4 }).translate(0, 0, -0.35);
const chestLidGeo = new THREE.CylinderGeometry(0.44, 0.44, 1.2, 20, 1, false, 0, Math.PI).rotateZ(Math.PI / 2);
const chestLidCapGeo = new THREE.CircleGeometry(0.44, 20, 0, Math.PI);
const bandGeo = new THREE.TorusGeometry(0.45, 0.035, 6, 18, Math.PI);
export const beamMat = new THREE.MeshBasicMaterial({ color: 0xff9d2e, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const beamGeo = new THREE.CylinderGeometry(0.28, 0.5, 16, 12, 1, true).translate(0, 8, 0);
export function buildChest() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(chestBaseGeo, chestWood); base.castShadow = true; g.add(base);
  for (const x of [-0.42, 0.42]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.86), goldMat); b.position.set(x, 0.3, 0); b.castShadow = true; g.add(b); }
  const pivot = new THREE.Group(); pivot.position.set(0, 0.6, -0.4); g.add(pivot);
  const lid = new THREE.Mesh(chestLidGeo, chestWood); lid.position.z = 0.4; lid.castShadow = true; pivot.add(lid);
  for (const x of [-0.6, 0.6]) { const cap = new THREE.Mesh(chestLidCapGeo, chestWood); cap.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2; cap.position.set(x, 0, 0.4); pivot.add(cap); }
  for (const x of [-0.42, 0.42]) { const b = new THREE.Mesh(bandGeo, goldMat); b.rotation.y = Math.PI / 2; b.position.set(x, 0, 0.4); pivot.add(b); }
  const lock = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), goldMat); lock.position.set(0, 0.06, 0.85); pivot.add(lock);
  const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 0.4; g.add(beam);
  return { group: g, pivot, beam };
}

/* ---------------------------------------------------------------- levende wezens */
const capsule = (r, l, mat, seg = 8) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, seg), mat);
const sphere = (r, mat, seg = [14, 10]) => new THREE.Mesh(new THREE.SphereGeometry(r, seg[0], seg[1]), mat);
const glow = c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2 });
function shadows(g) { g.traverse(o => { if (o.isMesh) o.castShadow = true; }); return g; }

/** Tweebenig wezen (speler, kobold, trol, reus). Kijkt richting -Z. */
export function buildHumanoid({ skin = 0xe0b48a, cloth = 0x3b6ea5, hair = 0x4a3220, scale = 1, bulk = 1, ears = false, tusks = false, eye = null, club = false, hairStyle = true }) {
  const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
  const skinM = std(skin), clothM = std(cloth), pantsM = std(new THREE.Color(cloth).multiplyScalar(0.55).getHex());
  const mkLeg = x => { const p = new THREE.Group(); p.position.set(x * bulk, 0.8, 0); const m = capsule(0.11 * bulk, 0.5, pantsM); m.position.y = -0.4; p.add(m); g.add(p); return p; };
  const legL = mkLeg(-0.13), legR = mkLeg(0.13);
  const torso = capsule(0.25 * bulk, 0.5, clothM, 10); torso.position.y = 1.12; g.add(torso);
  const head = new THREE.Group(); head.position.y = 1.68; g.add(head);
  head.add(sphere(0.2, skinM));
  if (hairStyle && !ears) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.212, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), std(hair)); h.position.set(0, 0.015, 0.02); head.add(h); }
  const nose = sphere(0.04, skinM, [8, 6]); nose.position.set(0, -0.02, -0.2); head.add(nose);
  if (eye) for (const x of [-0.075, 0.075]) { const e = sphere(0.035, glow(eye), [8, 6]); e.position.set(x, 0.04, -0.17); head.add(e); }
  if (ears) for (const x of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), skinM); e.position.set(x * 0.24, 0.06, 0); e.rotation.z = -x * 1.15; head.add(e); }
  if (tusks) for (const x of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.16, 6), std(0xefe6cf)); t.position.set(x * 0.09, -0.11, -0.18); t.rotation.x = -0.4; head.add(t); }
  const mkArm = x => { const p = new THREE.Group(); p.position.set(x * (0.3 + 0.05 * bulk), 1.36, 0); const m = capsule(0.085 * bulk, 0.42, skinM); m.position.y = -0.3; p.add(m); g.add(p); return p; };
  const armL = mkArm(-1), armR = mkArm(1);
  const mount = new THREE.Group(); mount.position.set(0, -0.58, -0.04); armR.add(mount);
  if (club) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.035, 0.75, 8), std(0x6b4a2a)); c.position.y = 0.3; c.rotation.x = -0.15; mount.add(c);
  }
  root.scale.setScalar(scale);
  shadows(root);
  return { group: root, legL, legR, armL, armR, mount, head };
}

/** Viervoeter (wolf, konijn, hert, everzwijn). Kijkt richting -Z. */
export function buildQuadruped({ fur, belly = null, r = 0.3, bodyLen = 0.7, legH = 0.5, legR = 0.07, headR = 0.18, snout = 0.2, ears = null, tail = null, antlers = false, tusks = false, neck = 0, eye = null }) {
  const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
  const furM = std(fur), bodyY = legH + r * 0.85;
  const body = capsule(r, bodyLen, furM, 10); body.rotation.x = Math.PI / 2; body.position.y = bodyY; g.add(body);
  const legs = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Group(); p.position.set(x * r * 0.62, bodyY - r * 0.3, z * bodyLen * 0.42);
    const m = capsule(legR, legH * 0.9, furM, 6); m.position.y = -legH * 0.5; p.add(m); g.add(p); legs.push(p);
  }
  const head = new THREE.Group(); head.position.set(0, bodyY + neck * 0.7 + r * 0.15, -(bodyLen / 2 + r * 0.7 + neck * 0.3)); g.add(head);
  if (neck) { const n = capsule(r * 0.42, neck, furM, 8); n.position.set(0, -neck * 0.45, r * 0.5); n.rotation.x = -0.55; head.add(n); }
  head.add(sphere(headR, furM, [12, 9]));
  if (snout) { const s = new THREE.Mesh(new THREE.ConeGeometry(headR * 0.6, snout, 8), furM); s.rotation.x = -Math.PI / 2; s.position.set(0, -headR * 0.2, -headR - snout * 0.35); head.add(s);
    const nose = sphere(headR * 0.16, std(0x222222), [6, 5]); nose.position.set(0, -headR * 0.2, -headR - snout * 0.85); head.add(nose); }
  if (eye) for (const x of [-1, 1]) { const e = sphere(headR * 0.16, glow(eye), [6, 5]); e.position.set(x * headR * 0.5, headR * 0.25, -headR * 0.8); head.add(e); }
  if (ears) for (const x of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(ears.r, ears.len, 6), furM); e.position.set(x * headR * 0.6, headR * 0.9 + ears.len * 0.35, headR * 0.1); e.rotation.z = -x * (ears.tilt ?? 0.2); head.add(e); }
  if (tusks) for (const x of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.2, 6), std(0xefe6cf)); t.position.set(x * headR * 0.55, -headR * 0.45, -headR - 0.05); t.rotation.x = -0.9; head.add(t); }
  if (antlers) for (const x of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(x * headR * 0.55, headR * 0.8, 0);
    const main = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.03, 0.5, 5), std(0xd8c9a3)); main.position.y = 0.22; main.rotation.z = -x * 0.3; a.add(main);
    for (const k of [0.14, 0.3]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.02, 0.22, 5), std(0xd8c9a3)); b.position.set(-x * 0.05 + x * k * 0.3, 0.12 + k, -0.02); b.rotation.z = -x * 0.9; a.add(b); }
    head.add(a);
  }
  if (tail) { const t = sphere(tail.r, std(tail.color ?? fur), [8, 6]); t.position.set(0, bodyY + r * 0.3, bodyLen / 2 + r * 0.8); if (tail.len) t.scale.z = tail.len; g.add(t); }
  shadows(root);
  return { group: root, legs, head };
}

export function buildMonster(type) {
  switch (type) {
    case 0: return { kind: 'biped', ...buildHumanoid({ skin: 0x6b9a3a, cloth: 0x7a5230, scale: 0.85, ears: true, eye: 0xff3322, club: true, hairStyle: false }), height: 1.9 };
    case 1: return { kind: 'quad', ...buildQuadruped({ fur: 0x3b3f47, r: 0.27, bodyLen: 0.8, legH: 0.5, legR: 0.075, headR: 0.19, snout: 0.26, ears: { r: 0.07, len: 0.2, tilt: 0.1 }, tail: { r: 0.09, len: 3 }, eye: 0xffd21a }), height: 1.35 };
    case 2: return { kind: 'biped', ...buildHumanoid({ skin: 0x7d8578, cloth: 0x4d4b3f, scale: 1.9, bulk: 1.5, tusks: true, eye: 0xff8a1a, club: true, hairStyle: false }), height: 3.9 };
    default: return { kind: 'biped', ...buildHumanoid({ skin: 0x5a3d6b, cloth: 0x2a1f33, scale: 3.6, bulk: 1.55, tusks: true, eye: 0xff4a10, club: true, hairStyle: false }), height: 7.6 };
  }
}
export function buildAnimal(type) {
  switch (type) {
    case 0: return { kind: 'quad', ...buildQuadruped({ fur: 0xb59a7a, r: 0.14, bodyLen: 0.22, legH: 0.1, legR: 0.035, headR: 0.1, snout: 0.05, ears: { r: 0.03, len: 0.24, tilt: 0.12 }, tail: { r: 0.05, color: 0xffffff } }), height: 0.7 };
    case 1: return { kind: 'quad', ...buildQuadruped({ fur: 0xa8703c, r: 0.27, bodyLen: 0.8, legH: 0.85, legR: 0.055, headR: 0.15, snout: 0.22, ears: { r: 0.045, len: 0.16, tilt: 0.7 }, tail: { r: 0.06 }, antlers: true, neck: 0.45 }), height: 2.1 };
    default: return { kind: 'quad', ...buildQuadruped({ fur: 0x5c463a, r: 0.36, bodyLen: 0.6, legH: 0.35, legR: 0.07, headR: 0.24, snout: 0.22, ears: { r: 0.06, len: 0.14, tilt: 0.5 }, tail: { r: 0.05 }, tusks: true }), height: 1.3 };
  }
}

/* ---------------------------------------------------------------- HUD in de wereld */
export function makeBar(width = 1.4) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.13), new THREE.MeshBasicMaterial({ color: 0x120a0a, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.06, 0.07), new THREE.MeshBasicMaterial({ color: 0xe0413a, depthWrite: false, toneMapped: false }));
  fill.position.z = 0.002; bg.renderOrder = 10; fill.renderOrder = 11;
  g.add(bg, fill); g.userData = { fill, width: width - 0.06 };
  return g;
}
export function setBar(g, ratio) {
  const r = Math.max(0.001, Math.min(1, ratio)), f = g.userData.fill;
  f.scale.x = r; f.position.x = -(1 - r) * g.userData.width / 2;
}
function textTexture(text, color, font, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(text, w / 2, h / 2);
  x.fillStyle = color; x.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function makeLabel(text, color = '#ffffff') {
  const font = '600 40px system-ui, sans-serif', probe = document.createElement('canvas').getContext('2d');
  probe.font = font;
  const w = Math.max(256, Math.ceil(probe.measureText(text).width) + 40);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text, color, font, w, 64), transparent: true, depthWrite: false, fog: false }));
  s.scale.set(0.29 * (w / 64), 0.29, 1); s.renderOrder = 12;
  return s;
}
export function makePopup(text, color = '#ffe08a') {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(String(text), color, '800 54px system-ui, sans-serif', 192, 96), transparent: true, depthWrite: false, depthTest: false, fog: false }));
  s.scale.set(1.2, 0.6, 1); s.renderOrder = 13;
  return s;
}

/** Kleur per spelersnaam, stabiel */
export function colorForName(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return new THREE.Color().setHSL((h % 360) / 360, 0.55, 0.45).getHex();
}

/* ---------------------------------------------------------------- winkel met handelaar */
const shopBeamMat = new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
function stripeTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 8;
  const x = c.getContext('2d');
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#f1e6cf' : '#b5382f'; x.fillRect(i * 16, 0, 16, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; return t;
}
/** Kraampje met handelaar. Voorkant kijkt naar +Z. */
export function buildShop() {
  const g = new THREE.Group();
  const plank = std(0x8a5a2b), dark = std(0x5a3c25), light = std(0xb98a52);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  add(new THREE.BoxGeometry(4.4, 0.18, 3.4), plank, 0, 0.09, 0);                                   // vloer
  for (const [x, z] of [[-1.95, -1.45], [1.95, -1.45], [-1.95, 1.45], [1.95, 1.45]]) add(new THREE.CylinderGeometry(0.09, 0.11, 2.7, 8), dark, x, 1.5, z);
  add(new THREE.BoxGeometry(4.0, 2.4, 0.12), plank, 0, 1.35, -1.45);                               // achterwand
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 2.0, 2.9), plank, s * 1.98, 1.25, 0);    // zijwanden (laag)
  const roof = add(new THREE.ConeGeometry(3.5, 1.2, 4), new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.9 }), 0, 3.3, 0, 0, Math.PI / 4, 0);
  roof.scale.set(1.0, 1, 0.82);
  add(new THREE.BoxGeometry(3.6, 0.95, 0.6), dark, 0, 0.66, 1.05);                                 // toonbank
  add(new THREE.BoxGeometry(3.9, 0.08, 0.85), light, 0, 1.17, 1.08);
  for (const y of [1.15, 1.85]) add(new THREE.BoxGeometry(3.5, 0.07, 0.4), light, 0, y, -1.2);     // planken
  const goods = [[0xd0403a, 0], [0x4aa3ff, 1], [0x6fd37a, 2], [0xf2c14e, 3]];
  for (let i = 0; i < 7; i++) {
    const [c] = goods[i % 4], y = i < 4 ? 1.27 : 1.97, x = -1.4 + (i % 4) * 0.9 + (i > 3 ? 0.4 : 0);
    const bottle = add(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: c, roughness: 0.3, emissive: c, emissiveIntensity: 0.25 }), x, y + 0.07, -1.2);
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.12, 6), light, x, y + 0.2, -1.2);
  }
  for (const x of [-0.9, 0.2, 1.2]) add(new THREE.SphereGeometry(0.15, 8, 6), std(0x9a4b3a), x, 1.28, 1.05);   // vlees op de toonbank
  add(new THREE.BoxGeometry(0.7, 0.6, 0.7), light, -2.6, 0.3, 0.8, 0, 0.3, 0);                      // kisten en vat
  add(new THREE.BoxGeometry(0.55, 0.5, 0.55), plank, -2.55, 0.85, 0.85, 0, 0.7, 0);
  add(new THREE.CylinderGeometry(0.34, 0.3, 0.75, 12), dark, 2.6, 0.375, 0.9);
  add(new THREE.BoxGeometry(0.9, 0.5, 0.7), light, 2.7, 0.25, -0.5, 0, -0.2, 0);
  // bord
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const cx = c.getContext('2d');
  cx.fillStyle = '#4b2f17'; cx.fillRect(0, 0, 256, 96); cx.strokeStyle = '#d9a83a'; cx.lineWidth = 6; cx.strokeRect(6, 6, 244, 84);
  cx.fillStyle = '#f2d28a'; cx.font = '700 46px system-ui, sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText('WINKEL', 128, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.8, 0.08), [dark, dark, dark, dark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), dark]);
  board.position.set(0, 2.45, 1.78); board.castShadow = true; g.add(board);
  for (const x of [-1.95, 1.95]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: 0xffb84a, emissiveIntensity: 2 })); l.position.set(x, 2.1, 1.55); g.add(l); }
  // handelaar
  const npc = buildHumanoid({ skin: 0xd9a77a, cloth: 0x2f6b4a, hair: 0x9a9a9a, scale: 1.0 });
  npc.group.position.set(0, 0.18, -0.15); npc.group.rotation.y = Math.PI;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 16), std(0x6b4a2a)); brim.position.y = 0.17; npc.head.add(brim);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.25, 12), std(0x6b4a2a)); top.position.y = 0.3; npc.head.add(top);
  npc.armL.rotation.x = -0.5; npc.armR.rotation.x = -0.35;
  g.add(npc.group);
  const label = makeLabel('Handelaar Bram', '#ffd27a'); label.position.y = 4.4; label.scale.multiplyScalar(1.5); g.add(label);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 16, 12, 1, true).translate(0, 8, 0), shopBeamMat); beam.position.set(0, 0.3, -2.2); g.add(beam);   // achter de kraam, niet door de handelaar heen
  return { group: g, npc, beam };
}

/* ---------------------------------------------------------------- hond */
/** Hond met kwispelstaart, flaporen en (optioneel) halsband. Kijkt richting -Z. */
export function buildDog(furColor, collar = false) {
  const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
  const fur = std(furColor), light = std(new THREE.Color(furColor).lerp(new THREE.Color(0xffffff), 0.45).getHex()), dark = std(0x1c1410);
  const bodyY = 0.5;
  const body = capsule(0.2, 0.46, fur, 10); body.rotation.x = Math.PI / 2; body.position.y = bodyY; g.add(body);
  const belly = capsule(0.15, 0.3, light, 8); belly.rotation.x = Math.PI / 2; belly.position.set(0, bodyY - 0.07, 0.02); g.add(belly);
  const legs = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const p = new THREE.Group(); p.position.set(x * 0.12, bodyY - 0.08, z * 0.23);
    const m = capsule(0.055, 0.3, fur, 6); m.position.y = -0.2; p.add(m);
    const paw = sphere(0.06, light, [8, 6]); paw.position.y = -0.37; paw.scale.set(1, 0.6, 1.3); p.add(paw);
    g.add(p); legs.push(p);
  }
  const head = new THREE.Group(); head.position.set(0, bodyY + 0.24, -0.38); g.add(head);
  const skull = sphere(0.16, fur, [12, 10]); skull.scale.set(1, 0.95, 1.05); head.add(skull);
  const muzzle = capsule(0.075, 0.12, light, 8); muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, -0.05, -0.16); head.add(muzzle);
  const nose = sphere(0.035, dark, [8, 6]); nose.position.set(0, -0.02, -0.26); head.add(nose);
  for (const x of [-1, 1]) {
    const eye = sphere(0.025, dark, [8, 6]); eye.position.set(x * 0.07, 0.04, -0.13); head.add(eye);
    const ear = new THREE.Group(); ear.position.set(x * 0.12, 0.08, 0.0); ear.rotation.z = x * 0.35;
    const flap = capsule(0.045, 0.12, std(new THREE.Color(furColor).multiplyScalar(0.75).getHex()), 6); flap.position.y = -0.09; flap.scale.set(1, 1, 0.45); ear.add(flap);
    head.add(ear);
  }
  const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.07), std(0xe07a8a)); tongue.position.set(0, -0.12, -0.21); tongue.rotation.x = 0.4; head.add(tongue);
  const tail = new THREE.Group(); tail.position.set(0, bodyY + 0.08, 0.36); g.add(tail);
  const tm = capsule(0.035, 0.24, fur, 6); tm.position.y = 0.13; tail.add(tm); tail.rotation.x = -0.7;
  let collarMesh = null;
  if (collar) {
    collarMesh = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 16), new THREE.MeshStandardMaterial({ color: 0xd0403a, roughness: 0.6 }));
    collarMesh.position.set(0, bodyY + 0.15, -0.3); collarMesh.rotation.x = 1.2; g.add(collarMesh);
    const tag = sphere(0.03, goldMat, [8, 6]); tag.position.set(0, bodyY + 0.07, -0.37); g.add(tag);
  }
  shadows(root);
  const aura = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0x6fe0ff, transparent: true, opacity: 0.85, toneMapped: false }));
  aura.rotation.x = -Math.PI / 2; aura.position.y = 0.06; aura.visible = false; root.add(aura);
  return { kind: 'quad', group: root, body: g, legs, head, tail, tongue, aura, height: 1.0 };
}

/* ---------------------------------------------------------------- vissen */
export function makeRodMesh() {
  const g = new THREE.Group();
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.28, 10), std(0xb98a52)); cork.position.y = 0.05; g.add(cork);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, 1.45, 8), std(0x3b2a1a)); rod.position.y = 0.9; g.add(rod);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), metalMat(0xb9c2cb, 0)); reel.rotation.z = Math.PI / 2; reel.position.set(0.06, 0.2, 0); g.add(reel);
  const line = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 1.6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  line.position.set(0, 1.62 - 0.8, -0.35); line.rotation.x = 0.45; g.add(line);
  return g;
}
export function makeBobber() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe0413a, roughness: 0.4 }));
  const bot = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.4 }));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), std(0x222222)); stick.position.y = 0.15;
  g.add(top, bot, stick);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.2, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; g.add(ring); g.userData.ring = ring;
  return g;
}
