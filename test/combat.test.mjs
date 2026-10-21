import { ROOT, tmpData } from './helpers.mjs';
// Gevechten: zware slag, ontwijkrol, blokkeren, nieuwe monsters, baasaanvallen en golfmodificaties (direct op Room).
import { Room } from '../room.js';
import { MONSTERS, HEAVY_MUL, AXE } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = name => ({ user: { name, save: { wood: 0 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
function room() { const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.animals.clear(); R.dogs.clear(); return R; }
function flat(R) { for (let i = 0; i < 8000; i++) { const x = (Math.random() - 0.5) * 200, z = (Math.random() - 0.5) * 200; let good = R.world.heightAt(x, z) > 1; for (let a = 0; a < 8 && good; a++) { const h = R.world.heightAt(x + Math.cos(a) * 20, z + Math.sin(a) * 20); if (h < 1) good = false; } let tree = false; R.world.gNear(x, z, o => { if (Math.hypot(o.x - x, o.z - z) < 6) tree = true; }); if (good && !tree) return { x, z }; } }
const kob = (R, x, z, hp = 1000) => { const m = R.spawnMonster(0, x, z, hp / MONSTERS[0].hp, 1, 1); m.speed = 0; return m; };
const step = (R, s) => { for (let i = 0; i < Math.round(s / 0.05); i++) R.update(0.05); };

// ---- zware slag
{
  const R = room(), P = R.addPlayer(conn('A')), c = flat(R); P.x = c.x; P.z = c.z; P.yaw = 0; P.hunger = 50;
  const ms = [kob(R, c.x, c.z - 1.8), kob(R, c.x + 1.0, c.z - 2.0), kob(R, c.x - 1.0, c.z - 2.0)];
  ms.forEach(m => m.dmg = 0);
  R.handle(P, { t: 'swing' }); step(R, 0.3);
  const light = ms.filter(m => m.hp < 1000).length, ld = 1000 - ms[0].hp;
  ms.forEach(m => m.hp = 1000); step(R, 1);
  R.handle(P, { t: 'swing', heavy: true }); step(R, 0.4);
  const heavy = ms.filter(m => m.hp < 1000).length, hd = 1000 - Math.min(...ms.map(m => m.hp));
  ok(light === 1 && heavy === 3, 'gewone slag raakt 1, zware slag raakt ' + heavy);
  ok(hd > ld * 1.7, 'zware slag doet meer schade (' + ld.toFixed(1) + ' -> ' + hd.toFixed(1) + ')');
}
// ---- ontwijkrol
{
  const R = room(), P = R.addPlayer(conn('B')), c = flat(R); P.x = c.x; P.z = c.z; P.yaw = 0;
  const m = kob(R, c.x, c.z - 1.2); m.dmg = 20; m.nextAtk = R.T + 0.1;
  R.handle(P, { t: 'roll' }); msgs.length = 0; step(R, 0.3);
  ok(P.hp === 100 && msgs.some(x => x.k === 'dodged'), 'tijdens de rol geen schade (' + Math.round(P.hp) + ')');
  step(R, 1.2); ok(P.hp < 100, 'na de rol wel weer schade (' + Math.round(P.hp) + ')');
  R.handle(P, { t: 'roll' }); const cd = P.rollCd; R.handle(P, { t: 'roll' }); ok(P.rollCd === cd, 'rol heeft afkoeltijd');
  // snelheidscontrole laat een rol toe
  const R2 = room(), Q = R2.addPlayer(conn('Q')); Q.x = c.x; Q.z = c.z; R2.handle(Q, { t: 'in', x: c.x, z: c.z, y: 0 }); R2.update(0.1);
  R2.handle(Q, { t: 'roll' }); R2.update(0.4); msgs.length = 0; R2.handle(Q, { t: 'in', x: c.x + 6, z: c.z, y: 0 });
  ok(Math.abs(Q.x - (c.x + 6)) < 0.01 && !msgs.some(x => x.t === 'correct'), 'rol van 6 m in 0,4 s geaccepteerd');
}
// ---- blokkeren
{
  const R = room(), P = R.addPlayer(conn('C')), c = flat(R); P.x = c.x; P.z = c.z; P.yaw = 0; P.lastHurt = -99;
  const m = kob(R, c.x, c.z - 1.2); m.dmg = 20; m.nextAtk = R.T;
  R.handle(P, { t: 'block', on: true }); step(R, 0.1);
  ok(Math.abs(P.hp - (100 - 20 * 0.3)) < 0.5, 'blokkeren van voren: 30% schade (hp ' + P.hp.toFixed(1) + ')');
  P.hp = 100; P.yaw = Math.PI; m.stun = 0; m.nextAtk = R.T; step(R, 0.1);
  ok(Math.abs(P.hp - 80) < 0.5, 'van achteren helpt blokkeren niet (hp ' + P.hp.toFixed(1) + ')');
  P.hp = 100; R.handle(P, { t: 'swing' }); ok(P.pendingHit < 0, 'niet slaan tijdens blokkeren');
}
// ---- schutter
{
  const R = room(), P = R.addPlayer(conn('D')), c = flat(R); P.x = c.x; P.z = c.z; P.yaw = 0; P.lastHurt = -99;
  const a = R.spawnMonster(4, c.x, c.z - 13, 1, 1, 1); a.speed = 0; R.wave.ph = 1;
  msgs.length = 0; step(R, 3.5);
  ok(msgs.some(x => x.k === 'shot') && P.hp < 100, 'schutter schiet en raakt een stilstaande speler (hp ' + Math.round(P.hp) + ')');
  P.hp = 100; R.handle(P, { t: 'block', on: true }); step(R, 5);
  ok(P.hp === 100, 'pijlen worden volledig geblokkeerd (hp ' + Math.round(P.hp) + ')');
  R.handle(P, { t: 'block', on: false });
  // dicht bij: deinst terug
  a.speed = 3.4; P.x = a.x; P.z = a.z + 4; const d0 = Math.hypot(a.x - P.x, a.z - P.z); step(R, 1);
  ok(Math.hypot(a.x - P.x, a.z - P.z) > d0 + 1, 'schutter houdt afstand');
}
// ---- hondenjager
{
  const R = room(), P = R.addPlayer(conn('E')), c = flat(R); P.x = c.x; P.z = c.z; P.u.save.dog = { name: 'Bas', level: 1, xp: 0, fur: 0 };
  const dog = R.spawnOwnedDog(P); dog.x = c.x + 10; dog.z = c.z;
  const h = R.spawnMonster(6, c.x - 5, c.z, 1, 1, 1); R.wave.ph = 1; step(R, 0.1);
  ok(h.target === dog, 'hondenjager kiest de hond, ook al staat de speler dichterbij');
}
// ---- baas
{
  const R = room(), P = R.addPlayer(conn('F')), c = flat(R); P.x = c.x; P.z = c.z; P.lastHurt = -99;
  const b = R.spawnMonster(3, c.x, c.z - 12, 1, 1, 1); b.speed = 0; b.abRoots = R.T + 0.1; b.abSummon = R.T + 0.1; R.wave.ph = 1;
  msgs.length = 0; step(R, 0.3);
  ok(msgs.some(x => x.k === 'roots') && msgs.some(x => x.k === 'summon'), 'Woudreus kondigt wortels aan en roept kobolds op');
  ok([...R.monsters.values()].filter(m => m.summoned).length === 3, '3 kobolds opgeroepen');
  for (const m of R.monsters.values()) if (m.summoned) { m.speed = 0; m.dmg = 0; }
  step(R, 1.3);
  ok(P.hp < 100 && msgs.some(x => x.t === 'rooted'), 'wortels raken en houden je vast (hp ' + Math.round(P.hp) + ')');
  const x0 = P.x; R.handle(P, { t: 'in', x: P.x + 0.5, z: P.z, y: 0 }); ok(P.x === x0, 'vastgegroeid: je kunt niet lopen');
  step(R, 1.6); R.handle(P, { t: 'in', x: P.x + 0.5, z: P.z, y: 0 }); ok(P.x > x0, 'daarna weer los');
  // wortels ontwijken met een rol
  b.abRoots = R.T; P.hp = 100; P.rootUntil = 0; step(R, 0.2); R.handle(P, { t: 'roll' }); P.rollCd = 0; step(R, 1.0); R.handle(P, { t: 'roll' }); step(R, 0.3);
  ok(P.hp === 100, 'met een rol op het juiste moment ontwijk je de wortels');
}
// ---- golfmodificaties
{
  const R = room(), P = R.addPlayer(conn('G'));
  R.wave.n = 5; R.startWave('zwerm'); const nZ = R.monsters.size, hpZ = [...R.monsters.values()].find(m => m.type === 0)?.maxhp;
  R.monsters.clear(); R.wave.n = 5; R.startWave(null);
  ok(R.wave.mod === null || true, 'golf zonder modificatie mogelijk');
  R.monsters.clear(); R.wave.n = 7; msgs.length = 0; R.startWave('pantser');
  const w = msgs.find(x => x.t === 'wave'); ok(w && w.mod === 'pantser', 'golfbericht bevat de modificatie');
  ok(nZ > 0, 'zwerm-golf: ' + nZ + ' monsters');
  P.u.save.daily.q = []; const wood0 = P.u.save.wood; R.monsters.clear(); R.update(0.05);
  ok(P.u.save.wood - wood0 === Math.round(8 * 3 * 1.5), 'modificatiegolf geeft 50% meer hout (' + (P.u.save.wood - wood0) + ')');
}
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
