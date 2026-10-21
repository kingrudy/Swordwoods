import { ROOT, tmpData } from './helpers.mjs';
// Voortgang: ervaring/niveaus, talenten, dagelijkse opdrachten, prestaties, erts en smid.
import { Room, ensureSave, applyTalent } from '../room.js';
import { levelInfo, xpNeeded, dailyQuests, today, forgeCost, maxHp } from '../public/progress.js';
import { rollSwordOfRarity } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const mk = name => { const u = { name, save: { wood: 0 } }; ensureSave(u); return { user: u, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) }; };
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.animals.clear(); R.dogs.clear();
const step = s => { for (let i = 0; i < Math.round(s / 0.05); i++) R.update(0.05); };

ok(levelInfo(0).level === 1 && levelInfo(xpNeeded(1)).level === 2, 'niveaucurve');
const q1 = dailyQuests('Anna', '2026-10-01'), q2 = dailyQuests('anna', '2026-10-01'), q3 = dailyQuests('Anna', '2026-10-02');
ok(JSON.stringify(q1) === JSON.stringify(q2) && JSON.stringify(q1) !== JSON.stringify(q3) && new Set(q1.map(q => q.kind)).size === 3, 'opdrachten vast per naam en dag, drie verschillende');

const P = R.addPlayer(mk('Tester')), s = P.u.save;
ok(s.daily.day === today() && s.daily.q.length === 3, 'dagelijkse opdrachten bij inloggen');
// monster doden -> xp, opdracht, prestatie
const killQ = s.daily.q.find(q => q.kind === 'kill') || (s.daily.q[0] = { kind: 'kill', need: 2, have: 0, done: false, wood: 20, xp: 100 });
killQ.need = 2; killQ.have = 0; killQ.done = false;
const w0 = s.wood;
for (let i = 0; i < 2; i++) { const m = R.spawnMonster(0, P.x + 1, P.z, 0.01, 0, 0); R.killMonster(m, P); }
ok(s.xp >= 20 + 100, 'ervaring voor monsters en opdracht: ' + s.xp);
ok(killQ.done && s.wood === w0 + killQ.wood && s.stats.quests === 1, 'opdracht voltooid, hout gekregen');
R.sendInv(P);
ok(s.ach.eerste && msgs.some(m => m.k === 'ach' && m.id === 'eerste'), 'prestatie "Eerste bloed"');
// talenten
s.xp = 0; for (let l = 1; l < 4; l++) s.xp += xpNeeded(l);   // niveau 4 -> 3 punten
ok(levelInfo(s.xp).level === 4, 'niveau 4');
ok(applyTalent(s, 'taai') && applyTalent(s, 'taai') && applyTalent(s, 'kracht') && !applyTalent(s, 'kracht'), '3 punten te besteden, vierde lukt niet');
R.handle(P, { t: 'talent', id: 'nope' }); R.applyStats(P);
ok(P.mhp === 120 && maxHp(s) === 120, 'taaiheid 2: 120 levens');
P.hp = 50; P.lastHurt = -99; P.hunger = 90; step(40); ok(P.hp > 100, 'genezen tot boven 100 (' + Math.round(P.hp) + ')');
ok(applyTalent(s, 'reset') && !Object.keys(s.tal).some(k => s.tal[k]), 'talenten terugzetten');
// kracht maakt verschil
s.tal = { kracht: 5 }; s.equip = 0;
const m1 = R.spawnMonster(0, P.x, P.z - 1.5, 100, 0, 0); P.yaw = 0; P.hunger = 50; m1.speed = 0;
const hp0 = m1.hp; R.hitEnemy(P, { type: 'axe' }, m1, 'm', false);
ok(hp0 - m1.hp > 3 * 0.9 * 1.25, 'kracht 5: meer schade (' + (hp0 - m1.hp).toFixed(2) + ')');
R.monsters.clear();
// ongeldige talenten bij laden
const u2 = { name: 'X', save: { xp: 0, tal: { kracht: 5, onzin: 3 } } }; ensureSave(u2); ok(!u2.save.tal.kracht && !u2.save.tal.onzin, 'te veel talentpunten worden teruggezet');
// erts
const o = R.world.ores[0]; P.x = o.x + 2.2; P.z = o.z; P.yaw = Math.PI / 2; P.dead = false;   // kijk naar -x
let got = 0;
for (let i = 0; i < 60 && R.oreLeft[o.idx] > 0; i++) { P.nextSwing = 0; R.handle(P, { t: 'swing' }); step(0.3); }
ok(s.ore >= 4 && R.oreLeft[o.idx] === 0 && R.oreBack.has(o.idx), 'ertsader leeggehakt: ' + s.ore + ' erts');
// smid
const sm = R.world.smith; P.x = sm.x + 3; P.z = sm.z;
s.swords = [rollSwordOfRarity(1), rollSwordOfRarity(2)]; s.swords.forEach(w => { w.d0 = w.damage; w.f = 0; }); s.equip = 2;
s.ore = 100; s.wood = 1000;
const d0 = s.swords[0].damage; R.handle(P, { t: 'forge', i: 0 });
ok(s.swords[0].f === 1 && s.swords[0].damage > d0 && s.ore === 100 - forgeCost(0).ore, 'smeden +1: schade ' + d0 + ' -> ' + s.swords[0].damage);
for (let i = 0; i < 6; i++) R.handle(P, { t: 'forge', i: 0 });
ok(s.swords[0].f === 5 && s.stats.forgedMax === 5, 'maximaal +5');
R.sendInv(P); ok(!!s.ach.smid, 'prestatie Meestersmid');
const ore0 = s.ore; R.handle(P, { t: 'melt', i: 0 });
ok(s.swords.length === 1 && s.ore > ore0 && s.equip === 1, 'omsmelten geeft erts en houdt het juiste zwaard vast');
P.x = sm.x + 40; R.handle(P, { t: 'forge', i: 0 }); ok(s.swords[0].f === 0, 'smeden alleen bij de smid');
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
