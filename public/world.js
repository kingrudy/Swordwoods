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

  // ---- bomen en kisten (eigen rng, los van decoratie)
  const rng = mulberry32(seed * 13 + 5);
  const grid = new Map();
  const key = (x, z) => Math.floor(x / 4) + ',' + Math.floor(z / 4);
  const gAdd = o => { const k = key(o.x, o.z); (grid.get(k) || grid.set(k, []).get(k)).push(o); };
  const gNear = (x, z, fn) => {
    const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = grid.get((cx + i) + ',' + (cz + j)); if (a) for (const o of a) fn(o); }
  };

  const trees = [];
  for (let tries = 0; tries < 20000 && trees.length < 420; tries++) {
    const x = (rng() - 0.5) * (WORLD - 30), z = (rng() - 0.5) * (WORLD - 30);
    const h = heightAt(x, z);
    if (h < 0.9 || h > 13 || slopeAt(x, z) > 0.55 || len(x, z) < 7) continue;
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
    if (h < 0.8 || h > 15 || slopeAt(x, z) > 0.45) continue;
    let ok = true;
    gNear(x, z, o => { if (len(o.x - x, o.z - z) < 3.2) ok = false; });
    for (const c of chests) if (len(c.x - x, c.z - z) < 24) ok = false;
    if (!ok) continue;
    const c = { idx: chests.length, x, z, y: h, rotY: rng() * 6.28, luck: clamp(r / (HALF * 0.75), 0, 1), r: 0.85, solid: true };
    chests.push(c); gAdd(c);
  }

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

  return { seed, heightAt, slopeAt, trees, chests, landPoint, vnoise, grid, gNear, spawn: { x: 0, z: 2 } };
}
