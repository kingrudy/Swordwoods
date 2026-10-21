// Wereldgeneratie over veel seeds: deterministisch, alles aanwezig, en de seeds die een kamer kiest zijn speelbaar.
import { createWorld, worldOk, WATER } from '../public/world.js';
import { BUILD_BY_ID, placePoint, canPlace } from '../public/builds.js';
import { Room } from '../room.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const a = createWorld(77), b = createWorld(77);
ok(JSON.stringify([a.trees, a.chests, a.ores, a.desert.mounds]) === JSON.stringify([b.trees, b.chests, b.ores, b.desert.mounds]), 'zelfde seed = zelfde wereld');
let good = 0, noBoat = [];
for (let seed = 1; seed <= 120; seed++) {
  const W = createWorld(seed); if (!worldOk(W)) continue; good++;
  // ergens langs de kust moet een boot kunnen
  let boat = false;
  for (let k = 0; k < 48 && !boat; k++) {
    const t = k / 48 * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); let r = 200; while (r > 30 && W.heightAt(r * c, r * s) < 0.8) r -= 1;
    for (let d = r; d < r + 8 && !boat; d += 0.5) { const pp = placePoint(BUILD_BY_ID.boat, d * c, d * s, Math.atan2(-c, -s)); if (!canPlace(W, [], 'boat', pp.x, pp.z, pp.rot)) boat = true; }
  }
  if (!boat) noBoat.push(seed);
  const D = W.desert;
  if (!(D.harbor.y > WATER && Math.hypot(W.shop.x, W.shop.z) < 40 && Math.hypot(W.smith.x - W.shop.x, W.smith.z - W.shop.z) < 15)) { ok(false, 'seed ' + seed + ': haven, winkel of smid op een rare plek'); }
}
ok(good >= 95, good + ' van 120 seeds zijn goed genoeg om te kiezen');
ok(!noBoat.length, 'in elke goede wereld kan een boot te water' + (noBoat.length ? ' (niet in ' + noBoat.join(',') + ')' : ''));
for (let i = 0; i < 8; i++) { const R = new Room(i, 'T', 8, false, () => {}); ok(worldOk(R.world), 'nieuwe kamer kiest een goede wereld (seed ' + R.seed + ')'); }
const R2 = new Room(9, 'T', 8, true, () => {}, { seed: 136 }); ok(R2.seed === 136, 'opgeslagen seed blijft behouden, ook als die niet ideaal is');
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
