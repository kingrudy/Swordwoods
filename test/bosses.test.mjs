import { ROOT, tmpData } from './helpers.mjs';
// Wisselende bazen: Woudreus, Sneeuwreus, Moerasheks en Schaduwridder, elk met eigen vaardigheden.
import { Room } from '../room.js';
import { MONSTERS, BOSSES, bossForWave, GUARD_FRONT } from '../public/items.js';
import { SLOW_SEC } from '../room/bosses.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer({ user: { name: 'Held', save: { wood: 50 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
const key = n => MONSTERS[bossForWave(n)].key;
ok([5, 10, 15, 20, 25, 30].map(key).join() === 'reus,sneeuwreus,heks,ridder,reus,sneeuwreus', 'volgorde van de bazen: ' + [5, 10, 15, 20, 25].map(key).join(', '));
ok(BOSSES.every(t => MONSTERS[t].boss && MONSTERS[t].weight === 0), 'bazen komen niet als gewone monsters');
// golf 10 brengt de Sneeuwreus
R.animals.clear(); R.wave.n = 9; R.startWave('snel');
const wm = msgs.filter(m => m.t === 'wave' && m.ph === 1).pop();
ok(wm.boss === 9 && [...R.monsters.values()].some(m => m.type === 9), 'golf 10: Sneeuwreus verschijnt');
const spawnBoss = type => { R.monsters.clear(); R.zones.length = 0; R.hazards.length = 0; fresh(); const m = R.spawnMonster(type, P.x + 6, P.z, 1, 1, 1); R.wave.ph = 1; return m; };
const fresh = () => { P.dead = false; P.hp = P.mhp; P.iframe = 0; P.blocking = false; };
P.god = true;   // onkwetsbaar: de gevaren raken wel (vertraging), maar de testheld valt niet om

// Sneeuwreus: ijsstorm vertraagt
const sr = spawnBoss(9); msgs.length = 0;
step(8);
ok(msgs.some(m => m.t === 'ev' && m.k === 'frost'), 'Sneeuwreus roept een ijsstorm op');
ok(msgs.some(m => m.t === 'slowed' && m.s === SLOW_SEC) && P.slowUntil > R.T - 6, 'wie in de ijsstorm staat wordt trager');
step(14); ok(msgs.some(m => m.t === 'ev' && m.k === 'summon' && m.id === sr.id) && [...R.monsters.values()].some(m => m.type === 1 && m.summoned), 'Sneeuwreus roept wolven op');

// Moerasheks: gifwolk blijft hangen, en ze verdwijnt
const hx = spawnBoss(10); msgs.length = 0;
step(7);
ok(msgs.some(m => m.t === 'ev' && m.k === 'poison' && m.dur === 6), 'Moerasheks gooit een gifwolk');
ok(R.zones.length > 0, 'de gifwolk blijft hangen');
P.god = false; fresh(); hx.stun = 99; const hpBefore = P.hp; R.zones.push({ x: P.x, z: P.z, r: 3, until: R.T + 2, dps: 10, acc: 0 }); step(1.1); P.god = true; hx.stun = 0;
ok(P.hp < hpBefore, 'in de gifwolk loop je schade op (' + Math.round(hpBefore) + ' -> ' + Math.round(P.hp) + ')');
fresh(); step(6);
ok(msgs.some(m => m.t === 'ev' && m.k === 'blink' && m.id === hx.id), 'Moerasheks verdwijnt en duikt elders op');

// Schaduwridder: van voren gepareerd, in de rug raak, wankelt na een geblokte slag
P.god = true; const rd = spawnBoss(11); rd.stun = 99; rd.x = P.x; rd.z = P.z - 2; rd.yaw = 0;   // kijkt naar -z, speler staat achter hem (+z)
P.yaw = Math.PI; const it = { type: 'sword', damage: 50 };
let h0 = rd.hp; R.hitEnemy(P, it, rd, 'm', false); const back = h0 - rd.hp;
rd.yaw = Math.PI; h0 = rd.hp; msgs.length = 0; R.hitEnemy(P, it, rd, 'm', false); const front = h0 - rd.hp;
ok(back > 40 && front < back * (GUARD_FRONT + 0.05), 'Schaduwridder pareert van voren (' + Math.round(front) + ') maar is in de rug raak (' + Math.round(back) + ')');
ok(msgs.some(m => m.t === 'ev' && m.k === 'hit' && m.parry), 'client hoort dat hij pareerde');
P.god = false; fresh(); P.blocking = true; P.yaw = 0; rd.x = P.x; rd.z = P.z - 1.5; msgs.length = 0;   // speler kijkt naar de ridder
R.hurt(P, 30, rd, 'melee');
ok(rd.staggerUntil > R.T && msgs.some(m => m.t === 'ev' && m.k === 'stagger'), 'een geblokte slag laat hem wankelen');
rd.yaw = Math.PI; h0 = rd.hp; R.hitEnemy(P, it, rd, 'm', false);
ok(h0 - rd.hp > 50, 'wankelend: van voren extra schade (' + Math.round(h0 - rd.hp) + ')');
P.blocking = false;
// verslagen baas geeft altijd een zwaard en telt als baas
const sw0 = P.u.save.swords.length; R.killMonster(rd, P);
ok(P.u.save.stats.bosses === 1 && P.u.save.swords.length > sw0, 'baas verslagen: geteld en een zwaard');
// snapshot bevat altijd de baas
R.monsters.clear(); const far = R.spawnMonster(10, P.x + 300, P.z, 1, 1, 1); msgs.length = 0; R.tickN = 3; R.update(0.05);
ok(msgs.filter(m => m.t === 's').every(s => s.m.some(t => t[0] === far.id)), 'verre baas staat in elke snapshot');
process.exit(fails ? 1 : 0);
