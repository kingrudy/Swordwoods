// Deterministische wereld per seed. Draait identiek in de browser en op de server.
// Let op: geen Math.hypot/sin/cos gebruiken in placement, zodat elke JS-engine dezelfde uitkomst geeft.

export const WORLD = 420, HALF = WORLD / 2, WATER = -2.2;

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const len = (x, z) => Math.sqrt(x * x + z * z);

export function createWorld(seed) {
  function hash(ix, iz) {
    let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function vnoise(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
    return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
  }
  function fbm(x, z, oct = 5) {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }
  function heightAt(x, z) {
    const n = fbm(x * 0.006, z * 0.006);
    const m = fbm(x * 0.02 + 50, z * 0.02 + 50, 3);
    let h = (n - 0.45) * 46 + (m - 0.5) * 5;
    const r = len(x, z);
    h = lerp(2.2 + (m - 0.5) * 2, h, sstep(12, 70, r));   // zachte startweide
    h -= sstep(0.68, 1.0, r / HALF) * 30;                  // eiland: water aan de randen
    return h;
  }
  function slopeAt(x, z) {
    const e = 1;
    const dx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
    const dz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
    return len(dx, dz);
  }

  // ---- winkel: vaste, vlakke plek dicht bij de start (deterministisch, zonder rng)
  const shop = (() => {
    let best = null, bestScore = 1e9;
    for (let r = 16; r <= 34; r += 2) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2 + 0.6, x = r * Math.cos(a), z = r * Math.sin(a), h = heightAt(x, z);
      if (h < 1.2) continue;
      let dev = 0;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) dev = Math.max(dev, Math.abs(heightAt(x + dx, z + dz) - h));
      const score = dev * 10 + r * 0.05;
      if (score < bestScore) { bestScore = score; best = { x, z, y: h }; }
    }
    best.rotY = Math.atan2(-best.x, -best.z);   // kijkt naar het startpunt
    best.r = 2.6; best.solid = true;
    return best;
  })();

  // ---- bomen en kisten (eigen rng, los van decoratie)
  const rng = mulberry32(seed * 13 + 5);
  const grid = new Map();
  const key = (x, z) => Math.floor(x / 4) + ',' + Math.floor(z / 4);
  const gAdd = o => { const k = key(o.x, o.z); (grid.get(k) || grid.set(k, []).get(k)).push(o); };
  const gNear = (x, z, fn) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = grid.get((cx + i) + ',' + (cz + j)); if (a) for (const o of a) fn(o); }
  };

  gAdd(shop);
  const trees = [];
  for (let tries = 0; tries < 20000 && trees.length < 420; tries++) {
    const x = (rng() - 0.5) * (WORLD - 30), z = (rng() - 0.5) * (WORLD - 30);
    const h = heightAt(x, z);
    if (h < 0.9 || h > 13 || slopeAt(x, z) > 0.55 || len(x, z) < 7 || len(x - shop.x, z - shop.z) < 9) continue;
    if (vnoise(x * 0.03 + 9, z * 0.03 + 9) < 0.35 && rng() < 0.75) continue;
    let ok = true;
    gNear(x, z, o => { if (len(o.x - x, o.z - z) < 3.2) ok = false; });
    if (!ok) continue;
    const type = (h > 7 || rng() < 0.4) ? 'pine' : 'oak';
    const scale = 0.85 + rng() * 0.6;
    const t = { idx: trees.length, x, z, y: h, type, vi: Math.floor(rng() * 4), scale, rotY: rng() * 6.28, r: 0.42 * scale, hp0: 4 + scale * 2, solid: true };
    trees.push(t); gAdd(t);
  }

  const chests = [];
  for (let tries = 0; tries < 20000 && chests.length < 46; tries++) {
    const r = 14 + rng() * (HALF * 0.82 - 14), a = rng() * 6.28;
    const x = r * Math.cos(a), z = r * Math.sin(a), h = heightAt(x, z);
    if (h < 0.8 || h > 15 || slopeAt(x, z) > 0.45 || len(x - shop.x, z - shop.z) < 9) continue;
    let ok = true;
    gNear(x, z, o => { if (len(o.x - x, o.z - z) < 3.2) ok = false; });
    for (const c of chests) if (len(c.x - x, c.z - z) < 24) ok = false;
    if (!ok) continue;
    const c = { idx: chests.length, x, z, y: h, rotY: rng() * 6.28, luck: clamp(r / (HALF * 0.75), 0, 1), r: 0.85, solid: true };
    chests.push(c); gAdd(c);
  }

  // ---- smid naast de winkel (op een plek zonder bomen; eigen rng zodat bomen en kisten niet veranderen)
  const smith = (() => {
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = shop.rotY + Math.PI / 2 + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.35;
      for (const d of [8.5, 10, 12]) {
        const x = shop.x + Math.sin(a) * d, z = shop.z + Math.cos(a) * d, h = heightAt(x, z);
        if (h < 0.6 || slopeAt(x, z) > 0.4) continue;
        let ok = true; gNear(x, z, o => { if (len(o.x - x, o.z - z) < 4.2) ok = false; });
        for (const c of chests) if (len(c.x - x, c.z - z) < 5) ok = false;
        if (ok) { best = { x, z, y: h }; break; }
      }
      if (best) break;
    }
    if (!best) best = { x: shop.x + 9, z: shop.z, y: heightAt(shop.x + 9, shop.z) };
    best.rotY = Math.atan2(-best.x, -best.z); best.r = 2.2; best.solid = true; best.smith = true;
    gAdd(best);
    return best;
  })();

  // ---- ertsaders (eigen rng)
  const orng = mulberry32(seed * 29 + 3), ores = [];
  for (let tries = 0; tries < 8000 && ores.length < 44; tries++) {
    const r = 25 + orng() * (HALF * 0.85 - 25), a = orng() * 6.28;
    const x = r * Math.cos(a), z = r * Math.sin(a), h = heightAt(x, z);
    if (h < 1.0 || slopeAt(x, z) > 0.7) continue;
    let ok = true; gNear(x, z, o => { if (len(o.x - x, o.z - z) < 3.4) ok = false; });
    for (const o of ores) if (len(o.x - x, o.z - z) < 14) ok = false;
    if (!ok) continue;
    const scale = 0.9 + orng() * 0.5;
    const o = { idx: ores.length, x, z, y: h, scale, rotY: orng() * 6.28, r: 0.95 * scale, solid: true, ore: true, rich: orng() < 0.25 };
    ores.push(o); gAdd(o);
  }

  // ---- biomen: sectoren rond het eiland (het midden is altijd gewoon bos)
  const TAU = Math.PI * 2, boff = (seed * 2.399) % TAU;
  function biomeW(x, z) {
    const away = sstep(42, 78, len(x, z));
    if (away <= 0) return { snow: 0, swamp: 0, dark: 0 };
    const a = Math.atan2(z, x) + (vnoise(x * 0.02 + 7, z * 0.02 + 3) - 0.5) * 0.9 - boff;
    const sector = (c, half) => { const d = Math.abs((((a - c) % TAU) + TAU * 1.5) % TAU - Math.PI); return sstep(half + 0.2, half - 0.2, d); };
    const snow = away * sector(0, 0.8);
    const dark = away * sector(2.15, 0.7);
    const swamp = away * sector(4.25, 0.65) * (1 - sstep(5, 9, heightAt(x, z)));
    return { snow, swamp, dark };
  }
  function biomeAt(x, z) { const w = biomeW(x, z); return w.snow > 0.5 ? 'snow' : w.swamp > 0.5 ? 'swamp' : w.dark > 0.5 ? 'dark' : 'forest'; }
  for (const t of trees) t.biome = biomeAt(t.x, t.z);
  for (const c of chests) c.biome = biomeAt(c.x, c.z);

  // ---- ruïnes met een kerkerkist (eigen rng)
  const rrng = mulberry32(seed * 41 + 7), ruins = [];
  for (let tries = 0; tries < 20000 && ruins.length < 5; tries++) {
    const r = 50 + rrng() * (HALF * 0.82 - 50), a = rrng() * TAU;
    const x = r * Math.cos(a), z = r * Math.sin(a), h = heightAt(x, z);
    if (h < 1.0 || h > 15 || slopeAt(x, z) > 0.38) continue;
    let ok = true;
    for (let k = 0; k < 8 && ok; k++) { const px = x + Math.cos(k / 8 * TAU) * 6, pz = z + Math.sin(k / 8 * TAU) * 6; if (heightAt(px, pz) < 0.8 || Math.abs(heightAt(px, pz) - h) > 2.2) ok = false; }
    gNear(x, z, o => { if (len(o.x - x, o.z - z) < 6.6) ok = false; });
    for (const g2 of [[x + 5, z], [x - 5, z], [x, z + 5], [x, z - 5]]) gNear(g2[0], g2[1], o => { if (len(o.x - x, o.z - z) < 6.6) ok = false; });
    for (const o of ruins) if (len(o.x - x, o.z - z) < 40) ok = false;
    if (len(x - shop.x, z - shop.z) < 30) ok = false;
    if (!ok) continue;
    const rotY = rrng() * TAU, idx = ruins.length, parts = [];
    for (let k = 0; k < 7; k++) {
      const pa = rotY + k / 7 * TAU, px = x + Math.cos(pa) * 5, pz = z + Math.sin(pa) * 5;
      const part = { x: px, z: pz, y: heightAt(px, pz), r: 0.5, solid: true, ruin: idx, h: k % 3 === 1 ? 1.2 + rrng() : 3.2 + rrng() * 1.5, rot: rrng() * TAU };
      parts.push(part); gAdd(part);
    }
    const chest = { x, z, y: h, r: 0.9, solid: true, ruin: idx, rotY: rotY + Math.PI };
    gAdd(chest);
    ruins.push({ idx, x, z, y: h, rotY, parts, chest, biome: biomeAt(x, z) });
  }

  // ---- gemeenschapskist vlak bij het startpunt
  const pot = (() => {
    for (let k = 0; k < 24; k++) {
      const a = 2.4 + k * 0.55, d = 4.5 + (k >> 3) * 1.5, x = Math.cos(a) * d, z = 2 + Math.sin(a) * d;
      if (heightAt(x, z) < 0.6 || len(x - shop.x, z - shop.z) < 6.5 || len(x - smith.x, z - smith.z) < 5) continue;
      let ok = true; gNear(x, z, o => { if (len(o.x - x, o.z - z) < 2.6) ok = false; });
      if (ok) { const p = { x, z, y: heightAt(x, z), r: 0.95, solid: true, pot: true, rotY: Math.atan2(-x, -(z - 2)) }; gAdd(p); return p; }
    }
    const p = { x: -4, z: -1, y: heightAt(-4, -1), r: 0.95, solid: true, pot: true, rotY: 0 }; gAdd(p); return p;
  })();

  // ---- arena voor duels (eigen rng; kiest de vlakste plek met de minste bomen)
  const arena = (() => {
    const arng = mulberry32(seed * 53 + 11); let best = null, bestScore = 1e9;
    for (let tries = 0; tries < 400; tries++) {
      const r = 30 + arng() * 45, a = arng() * TAU, x = r * Math.cos(a), z = r * Math.sin(a), h = heightAt(x, z);
      if (h < 1 || h > 12) continue;
      let lo = h, hi = h, water = false;
      for (let k = 0; k < 12; k++) { const hx = heightAt(x + Math.cos(k / 12 * TAU) * 10, z + Math.sin(k / 12 * TAU) * 10); lo = Math.min(lo, hx); hi = Math.max(hi, hx); if (hx < 0.6) water = true; }
      if (water || len(x - shop.x, z - shop.z) < 18 || len(x - smith.x, z - smith.z) < 15 || len(x - pot.x, z - pot.z) < 15) continue;
      let objs = 0; for (const [ox, oz] of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) gNear(x + ox, z + oz, o => { if (len(o.x - x, o.z - z) < 10 && !o.type) objs += 50; else if (len(o.x - x, o.z - z) < 10) objs++; });
      const score = (hi - lo) * 3 + objs;
      if (score < bestScore) { bestScore = score; best = { x, z, y: h, r: 9 }; }
    }
    return best || { x: 40, z: 0, y: heightAt(40, 0), r: 9 };
  })();

  /** Willekeurig punt op land (voor dieren en monsters). rnd: () => 0..1 */
  function landPoint(rnd, cx = 0, cz = 0, rMin = 0, rMax = HALF * 0.85, minH = 0.2) {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, d = rMin + rnd() * (rMax - rMin);
      const x = cx + d * Math.cos(a), z = cz + d * Math.sin(a);
      if (len(x, z) > HALF - 12) continue;
      if (heightAt(x, z) > minH) return { x, z };
    }
    return null;
  }

  return { seed, heightAt, slopeAt, trees, chests, shop, smith, ores, ruins, pot, arena, biomeW, biomeAt, landPoint, vnoise, grid, gNear, spawn: { x: 0, z: 2 } };
}
