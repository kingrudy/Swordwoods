import { ROOT, tmpData } from './helpers.mjs';
// Boot, Woestijneiland, graven naar faraobeelden, goud en de bazaar.
import { Room } from '../room.js';
import { WATER, inDesert } from '../public/world.js';
import { BUILD_BY_ID, placePoint, canPlace } from '../public/builds.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = name => ({ user: { name, save: { wood: 100 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer(conn('Zeevaarder')); const W = R.world, s = P.u.save;
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
const walk = (x, z) => { R.handle(P, { t: 'in', x, z, y: Math.max(W.heightAt(x, z), WATER), yaw: P.yaw }); R.update(0.1); };
// boot bouwen aan de oostkust van het bos
let spot = null;   // vanaf open zee (straal 200) naar binnen tot de kust, rondom het eiland; begin aan de oostkant
for (let k = 0; k < 72 && !spot; k++) {
  const a = (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * 0.09, ca = Math.cos(a), sa = Math.sin(a);
  let r = 200; while (r > 40 && W.heightAt(r * ca, r * sa) < 0.8) r -= 0.5;
  if (r <= 40) continue;
  for (let d = r - 1; d < r + 8 && !spot; d += 0.5) {
    const pp = placePoint(BUILD_BY_ID.boat, d * ca, d * sa, Math.atan2(-ca, -sa));
    if (!canPlace(W, R.builds.values(), 'boat', pp.x, pp.z, pp.rot)) spot = { px: d * ca, pz: d * sa, a, ...pp };
  }
}
ok(!!spot, 'plek voor een boot gevonden bij x=' + (spot && spot.x.toFixed(1)));
P.x = spot.px; P.z = spot.pz; P.lastInT = R.T;
R.handle(P, { t: 'build', kind: 'boat', x: spot.x, z: spot.z, rot: spot.rot });
const boat = [...R.builds.values()].find(b => b.kind === 'boat');
ok(boat && s.wood === 88, 'boot gebouwd voor 12 hout');
const land = placePoint(BUILD_BY_ID.boat, P.x, P.z, Math.PI / 2);
ok(!!canPlace(W, [], 'boat', land.x, land.z, land.rot), 'boot op het land kan niet: ' + canPlace(W, [], 'boat', land.x, land.z, land.rot));
// instappen en varen
R.handle(P, { t: 'board', id: boat.id });
ok(P.boat === boat, 'ingestapt');
const H = W.desert.harbor; let x = P.x, z = P.z;
const route = [[205 * Math.cos(spot.a), 205 * Math.sin(spot.a)]];        // naar open zee, langs de buitenkant naar het oosten, dan naar de haven
for (let k = 1; k <= 12; k++) { const b = spot.a * (1 - k / 12); route.push([205 * Math.cos(b), 205 * Math.sin(b)]); }
route.push([235, 0], [235, H.z], [H.x - 4, H.z]);
for (const [tx, tz] of route) {
  while (Math.hypot(tx - x, tz - z) > 0.5) { const d = Math.hypot(tx - x, tz - z), st = Math.min(d, 0.9), nx = x + (tx - x) / d * st, nz = z + (tz - z) / d * st; if (W.heightAt(nx, nz) > WATER - 0.2) break; x = nx; z = nz; walk(x, z); }
}
ok(Math.hypot(boat.x - P.x, boat.z - P.z) < 0.01 && P.x > 240, 'over zee gevaren tot x=' + P.x.toFixed(0) + ' (boot vaart mee)');
ok(!msgs.some(m => m.t === 'correct'), 'snelheidscontrole laat varen toe');
// monsters negeren spelers op zee / in de woestijn
const m = R.spawnMonster(0, 150, 0, 1, 1, 1); R.wave.ph = 1; step(0.2); ok(!m.target, 'monsters jagen niet op spelers op zee');
R.monsters.clear(); R.wave.ph = 0;
R.handle(P, { t: 'unboard' });
ok(!P.boat && inDesert(P.x, P.z) && W.heightAt(P.x, P.z) > WATER + 0.3, 'aan land gegaan op het Woestijneiland');
step(1.5); ok(s.stats.voyages === 1, 'reis geteld');
// graven
let statues = 0, gold = 0;
for (const mo of W.desert.mounds) {
  P.x = mo.x + 1.5; P.z = mo.z; P.lastInT = R.T; P.dead = false; P.hp = P.mhp;
  R.handle(P, { t: 'dig', i: mo.idx }); step(3);
}
statues = Object.values(s.statues).reduce((a, b) => a + b, 0);
ok(s.stats.digs === W.desert.mounds.length && R.moundBack.size === W.desert.mounds.length, 'in ' + s.stats.digs + ' zandbergen gegraven');
ok(statues > 0, statues + ' faraobeelden gevonden: ' + JSON.stringify(s.statues) + ', goud ' + s.gold);
R.handle(P, { t: 'dig', i: 0 }); step(3); ok(s.stats.digs === W.desert.mounds.length, 'een uitgegraven zandberg kan niet opnieuw');
// weglopen breekt graven af
R.moundBack.clear(); const m0 = W.desert.mounds[0]; P.x = m0.x + 1; P.z = m0.z; R.handle(P, { t: 'dig', i: 0 }); P.x += 10; step(3); ok(!R.moundBack.has(0), 'weglopen tijdens graven = niets');
// verkopen
const g0 = s.gold; P.x = W.desert.bazaar.x + 3; P.z = W.desert.bazaar.z;
R.handle(P, { t: 'sell', k: 'all' });
ok(s.gold > g0 && Object.values(s.statues).every(v => v === 0), 'beelden verkocht: ' + g0 + ' -> ' + s.gold + ' goud');
s.wood = 50; R.handle(P, { t: 'bzbuy', id: 'shovel' }); ok(s.up.shovel === 1 && s.wood === 30, 'schep gekocht');
R.moundBack.clear(); P.x = m0.x + 1; P.z = m0.z; R.handle(P, { t: 'dig', i: 0 }); step(1.5); ok(R.moundBack.has(0), 'met schep sneller klaar');
// goud in Brams winkel
s.gold = 300; P.x = W.shop.x + 2; P.z = W.shop.z; const sw0 = s.swords.length;
R.handle(P, { t: 'buy', id: 'gsword' }); ok(s.gold === 50 && s.swords.length === sw0 + 1 && s.swords[s.swords.length - 1].rarity === 4, 'farao-zwaard gekocht voor 250 goud');
// kangoeroe vecht terug
P.x = W.desert.harbor.x + 3; P.z = W.desert.harbor.z; P.hp = P.mhp; P.lastHurt = -99;
const k = [...R.animals.values()].find(a => a.type === 4); ok(!!k, 'kangoeroes op het eiland, gerbils: ' + [...R.animals.values()].filter(a => a.type === 3).length);
k.x = P.x; k.z = P.z - 1.2; k.angry = true; k.hurtT = R.T; step(2); ok(P.hp < P.mhp, 'boze kangoeroe schopt terug (hp ' + Math.round(P.hp) + ')');
// sterven in de woestijn -> haven
R.die(P); step(9); ok(!P.dead && inDesert(P.x, P.z), 'na een val in de woestijn terug bij de haven');
R.sendInv(P); ok(s.ach.zeeman && s.ach.archeoloog === undefined || s.ach.zeeman, 'prestatie Zeeman');
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
