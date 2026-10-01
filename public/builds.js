// Bouwwerken: gedeeld door server (regels, botsing) en client (voorbeeld, botsing, weergave).
import { WATER } from './world.js';

export const BUILDS = [
  { id: 'campfire', name: 'Kampvuur', icon: '🔥', cost: 10, hp: 80, shape: 'circle', r: 0.85, solid: true, fire: true,
    desc: 'Binnen 6 m: +3 gezondheid per seconde en de helft minder honger. Geeft licht.' },
  { id: 'torch', name: 'Fakkel', icon: '🕯️', cost: 3, hp: 30, shape: 'circle', r: 0.18, solid: false, fire: true,
    desc: 'Licht in het donker. Goedkoop om je kamp te markeren.' },
  { id: 'wall', name: 'Houten muur', icon: '🧱', cost: 8, hp: 180, shape: 'box', w: 3.2, d: 0.45, h: 2.2, solid: true,
    desc: 'Houdt monsters tegen. Ze moeten er eerst doorheen slaan.' },
  { id: 'palisade', name: 'Palissade', icon: '🪵', cost: 16, hp: 320, shape: 'box', w: 3.2, d: 0.7, h: 2.7, solid: true, thorns: 4,
    desc: 'Dikke puntige muur. Monsters die erop slaan raken zelf gewond.' },
  { id: 'tower', name: 'Wachttoren', icon: '🏹', cost: 45, hp: 260, shape: 'box', w: 2.2, d: 2.2, h: 5.6, solid: true, range: 20, dmg: 7, cd: 1.4,
    desc: 'Schiet om de 1,4 s een pijl op monsters binnen 20 m.' },
  { id: 'bed', name: 'Bed', icon: '🛏️', cost: 20, hp: 90, shape: 'box', w: 1.2, d: 2.2, h: 0.6, solid: false, one: true,
    desc: 'Je respawnt hier na een val. Eén per speler; een nieuw bed vervangt het oude.' },
];
export const BUILD_BY_ID = Object.fromEntries(BUILDS.map((b, i) => [b.id, { ...b, idx: i }]));
export const BUILD_RANGE = 8, BUILD_MAX_ROOM = 160, BUILD_MAX_PLAYER = 40, BUILD_REFUND = 0.5, FIRE_RADIUS = 6;

export const boundR = B => B.shape === 'circle' ? B.r : Math.hypot(B.w, B.d) / 2;
export const snapRot = yaw => Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12);
/** Waar een bouwwerk komt als je kijkt met deze yaw. */
export function placePoint(B, px, pz, yaw) {
  const dist = 1.6 + boundR(B) * (B.shape === 'box' ? Math.min(1, B.d / B.w + 0.35) : 1);
  return { x: px - Math.sin(yaw) * dist, z: pz - Math.cos(yaw) * dist, rot: snapRot(yaw) };
}

/** Lokale coördinaten (rot zoals three.js rotation.y). */
function toLocal(b, x, z) { const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z; return [dx * c - dz * s, dx * s + dz * c]; }
function toWorld(b, lx, lz) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; }

/** Duwt een cirkel (x,z,r) uit een bouwwerk. Geeft null als er geen overlap is, anders [x, z]. */
export function pushOut(b, x, z, r) {
  const B = BUILD_BY_ID[b.kind];
  if (B.shape === 'circle') {
    const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz), min = B.r + r;
    if (d >= min) return null;
    if (d < 1e-4) return [b.x + min, z];
    return [b.x + dx / d * min, b.z + dz / d * min];
  }
  const hw = B.w / 2, hd = B.d / 2, [lx, lz] = toLocal(b, x, z);
  if (Math.abs(lx) > hw + r || Math.abs(lz) > hd + r) return null;
  const cx = Math.max(-hw, Math.min(hw, lx)), cz = Math.max(-hd, Math.min(hd, lz));
  let ox = lx - cx, oz = lz - cz; const d = Math.hypot(ox, oz);
  let nx, nz;
  if (d > 1e-4) { if (d >= r) return null; nx = cx + ox / d * r; nz = cz + oz / d * r; }
  else {           // middelpunt binnen de doos: langs de kortste weg eruit
    const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);
    if (px < pz) { nx = Math.sign(lx || 1) * (hw + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (hd + r); }
  }
  return toWorld(b, nx, nz);
}

/** Hoeken + midden van de voetafdruk, voor plaatsingscontrole. */
function samplePoints(B, x, z, rot) {
  if (B.shape === 'circle') return [[x, z], [x + B.r, z], [x - B.r, z], [x, z + B.r], [x, z - B.r]];
  const b = { x, z, rot }, hw = B.w / 2, hd = B.d / 2, out = [[x, z]];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) out.push(toWorld(b, sx * hw, sz * hd));
  return out;
}

/**
 * Mag hier gebouwd worden? world = createWorld(), builds = iterable van {kind,x,z,rot},
 * felled = Set/Map met omgehakte boomindexen (optioneel). Geeft '' (ok) of een reden.
 */
export function canPlace(world, builds, kind, x, z, rot, felled = null) {
  const B = BUILD_BY_ID[kind]; if (!B) return 'Onbekend bouwwerk';
  const pts = samplePoints(B, x, z, rot);
  let lo = 1e9, hi = -1e9;
  for (const [px, pz] of pts) { const h = world.heightAt(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h); }
  if (lo < WATER + 0.3) return 'Niet in het water';
  if (hi - lo > (B.shape === 'box' ? 1.6 : 0.9)) return 'Te steil';
  if (Math.hypot(x - world.shop.x, z - world.shop.z) < 7 + boundR(B)) return 'Te dicht bij de winkel';
  for (const c of world.chests) if (Math.hypot(c.x - x, c.z - z) < 1.4 + boundR(B)) return 'Er staat een kist';
  let tree = false;
  for (const [px, pz] of pts) world.gNear(px, pz, o => {
    if (o.type && felled && felled.has(o.idx)) return;
    if (Math.hypot(px - o.x, pz - o.z) < o.r + 0.15) tree = true;
  });
  if (tree) return 'Er staat een boom of rots in de weg';
  const me = { x, z, rot };
  for (const b of builds) {
    const O = BUILD_BY_ID[b.kind];
    if (Math.hypot(b.x - x, b.z - z) > boundR(O) + boundR(B) + 0.1) continue;
    for (const [px, pz] of pts) if (pushOut(b, px, pz, 0.05)) return 'Overlapt met ' + O.name.toLowerCase();
    if (pushOut({ ...me, kind }, b.x, b.z, 0.05)) return 'Overlapt met ' + O.name.toLowerCase();
  }
  return '';
}
