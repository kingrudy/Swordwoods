import { ROOT, tmpData } from './helpers.mjs';
// Balans: nieuwe poging na een wipe is iets makkelijker, schutters en bosmonsters zijn minder dodelijk.
import { Room } from '../room.js';
import { MONSTERS } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const R = new Room(1, 'T', 8, false, () => {}); R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer({ user: { name: 'Held', save: {} }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });

const scaleAt = () => R.waveScale.hp;
R.wave.n = 3; R.startWave('snel'); const base = scaleAt();
ok(R.wave.n === 4 && Math.abs(base - 1.9) < 0.21, 'golf 4 normaal: levens x' + base.toFixed(2));
const tries = [];
for (let k = 0; k < 4; k++) { R.wipe(); R.startWave('snel'); tries.push(+scaleAt().toFixed(2)); }
ok(R.wave.n === 4, 'na een wipe opnieuw golf 4');
ok(tries[0] < base && tries[1] < tries[0] && tries[2] < tries[1] && tries[3] === tries[2], 'elke nieuwe poging makkelijker, maximaal 3 keer: ' + tries.join(' → '));
const wm = msgs.filter(m => m.t === 'wave' && m.ph === 1).pop(); ok(wm.ease === 36, 'client hoort hoeveel zwakker (' + wm.ease + '%)');
R.monsters.clear(); R.endWave(); R.startWave('snel'); ok(R.wave.n === 5 && !msgs.filter(m => m.t === 'wave' && m.ph === 1).pop().ease, 'na winst weer normaal');

// dodelijkheid op golf 4 (levens 100, geen schild): hoe lang overleef je één monster dat steeds raak slaat?
const sec = (k, n) => { const M = MONSTERS.find(m => m.key === k), dmg = M.dmg * (1 + 0.12 * (n - 1)); return 100 / (dmg / M.atkCd); };
ok(sec('troll', 4) > 10, 'bosmonster op golf 4: ' + sec('troll', 4).toFixed(1) + ' s om je te vellen');
ok(sec('schutter', 4) > 30, 'schutter op golf 4: ' + sec('schutter', 4).toFixed(1) + ' s (als elke pijl raakt)');
// de schutter blijft binnen bereik van je zwaard als je op hem afloopt
const m = R.spawnMonster(4, P.x + 8, P.z, 1, 1, 1); R.monsters.clear(); R.monsters.set(m.id, m); R.wave.ph = 1;
const W = R.world; P.god = true;
let closest = 99; for (let i = 0; i < 120; i++) {
  const dx = m.x - P.x, dz = m.z - P.z, d = Math.hypot(dx, dz); closest = Math.min(closest, d);
  const st = Math.min(d - 1, 0.35), nx = P.x + dx / d * st, nz = P.z + dz / d * st;   // ~7 m/s lopen
  R.handle(P, { t: 'in', x: nx, z: nz, y: W.heightAt(nx, nz), yaw: 0 }); R.update(0.05);
}
ok(closest < 3.2, 'je kunt een schutter inhalen (dichtst bij: ' + closest.toFixed(1) + ' m)');
process.exit(fails ? 1 : 0);
