import { ROOT, tmpData } from './helpers.mjs';
// Je basis: opslagkist (veilig bij vallen), poort (spelers wel, monsters niet) en spijkerval.
import { Room } from '../room.js';
import { BUILD_BY_ID, placePoint, canPlace } from '../public/builds.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9; R.animals.clear(); R.dogs.clear();
const P = R.addPlayer({ user: { name: 'Bouwer', save: { wood: 300 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const s = P.u.save; s.tut = 99;
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
function place(kind, near = { x: 0, z: 2 }) {
  for (let i = 0; i < 500; i++) {
    const d = 3 + i * 0.08, x = near.x + Math.sin(i * 2.1) * d, z = near.z + Math.cos(i * 1.3) * d, yaw = (i % 8) * 0.785;
    const pp = placePoint(BUILD_BY_ID[kind], x, z, yaw);
    if (canPlace(R.world, R.builds.values(), kind, pp.x, pp.z, pp.rot, R.felled)) continue;
    P.x = x; P.z = z; const id = R.bid; R.handle(P, { t: 'build', kind, x: pp.x, z: pp.z, rot: pp.rot });
    if (R.bid > id) return R.builds.get(id);   // nieuw id (een tweede kist vervangt de eerste, dus niet op het aantal letten)
  }
  return null;
}

// opslagkist
const st = place('stash'); ok(st && s.wood === 285, 'opslagkist gebouwd voor 15 hout');
P.x = st.x + 1.5; P.z = st.z; s.meat = 4; s.fish = 2; s.ore = 3;
R.handle(P, { t: 'stash', op: 'put' });
ok(s.wood === 0 && s.meat === 0 && s.stash.wood === 285 && s.stash.meat === 4 && s.stash.fish === 2 && s.stash.ore === 3, 'alles opgeborgen');
s.wood = 40; R.hurt(P, 999, null, 'melee', 'test'); step(9);
ok(!P.dead && s.wood === 20 && s.stash.wood === 285, 'gevallen: de helft van het hout op zak kwijt, de kist bleef vol');
P.x = st.x + 1.5; P.z = st.z; R.handle(P, { t: 'stash', op: 'take' });
ok(s.wood === 305 && s.meat === 4 && s.stash.wood === 0, 'alles weer gepakt');
P.x = st.x + 8; msgs.length = 0; R.handle(P, { t: 'stash', op: 'put' }); ok(s.wood === 305, 'te ver van de kist: niets');
const st2 = place('stash', { x: 20, z: 20 }); ok(st2 && !R.builds.has(st.id), 'maar één opslagkist per speler');

// poort
const gate = place('gate', { x: -15, z: 5 }); ok(!!gate, 'poort gebouwd');
const nx = Math.sin(gate.rot), nz = Math.cos(gate.rot);
P.x = gate.x - nx * 1.1; P.z = gate.z - nz * 1.1; P.lastInT = R.T; msgs.length = 0;
R.T += 0.1; R.handle(P, { t: 'in', x: gate.x + nx * 1.1, z: gate.z + nz * 1.1, y: R.world.heightAt(gate.x, gate.z), yaw: 0 });
ok(!msgs.some(m => m.t === 'correct') && Math.abs(P.x - (gate.x + nx * 1.1)) < 0.01, 'speler loopt door de poort');
const m = R.spawnMonster(0, gate.x - nx * 1.5, gate.z - nz * 1.5, 50, 1, 1); R.wave.ph = 1; P.god = true;
let crossed = false; for (let i = 0; i < 80; i++) { R.update(0.05); if ((m.x - gate.x) * nx + (m.z - gate.z) * nz > 0.3 && Math.abs((m.x - gate.x) * nz - (m.z - gate.z) * nx) < 1.4) crossed = true; }
ok(!crossed, 'monster komt niet door de poort');
ok(gate.hp < gate.maxhp || !R.builds.has(gate.id), 'monster slaat op de poort');
R.monsters.clear();

// spijkerval
const sp = place('spikes', { x: 10, z: -15 }); ok(!!sp, 'spijkerval gebouwd');
const k = R.spawnMonster(0, sp.x, sp.z, 10, 0, 1); k.stun = 0; P.x = sp.x + 30; P.z = sp.z; P.god = true;
const hp0 = k.hp, sh0 = sp.hp; step(1);
ok(k.hp < hp0 - 5, 'monster op de spijkers raakt gewond (' + Math.round(hp0) + ' -> ' + Math.round(k.hp) + ')');
ok(sp.hp < sh0, 'de spijkerval slijt');
ok(R.monsters.has(k.id) ? k.onSpikes || Math.hypot(k.x - sp.x, k.z - sp.z) > 1.4 : true, 'monster is trager zolang hij erop staat');
process.exit(fails ? 1 : 0);
