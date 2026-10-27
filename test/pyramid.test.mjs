import { ROOT, tmpData } from './helpers.mjs';
// Piramide: zegel breken voor goud, mummies, de mummie-farao, beloning en afkoeltijd.
import { Room } from '../room.js';
import { inDesert, WATER } from '../public/world.js';
import { PYRAMID, MONSTERS } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = name => ({ user: { name, save: { wood: 100 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer(conn('Archeoloog')), W = R.world, s = P.u.save, py = W.desert.pyramid;
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
const at = (x, z) => { P.x = x; P.z = z; P.y = W.heightAt(x, z); P.lastInT = R.T; };

ok(py && inDesert(py.x, py.z) && inDesert(py.entrance.x, py.entrance.z), 'piramide staat in de woestijn bij ' + Math.round(py.x) + ',' + Math.round(py.z));
ok(W.heightAt(py.entrance.x, py.entrance.z) > WATER + 0.5, 'ingang ligt op het droge');
ok(MONSTERS[7].key === 'mummie' && MONSTERS[8].key === 'farao' && MONSTERS[7].weight === 0 && MONSTERS[8].weight === 0, 'mummie en farao komen niet in golven');
const joined = msgs.find(m => m.t === 'joined'); ok(joined.pyr && joined.pyr.st === 'idle', 'piramidestatus in joined');

// zonder goud: niets
at(py.entrance.x, py.entrance.z); s.gold = 10;
R.handle(P, { t: 'pyramid' });
ok(R.pyr.st === 'idle' && s.gold === 10, 'te weinig goud = zegel blijft dicht');
// te ver weg: niets
s.gold = 100; at(py.entrance.x + 20, py.entrance.z);
R.handle(P, { t: 'pyramid' }); ok(R.pyr.st === 'idle', 'te ver van de ingang');
at(py.entrance.x, py.entrance.z);
R.handle(P, { t: 'pyramid' });
const guards = [...R.monsters.values()].filter(m => m.pyr);
ok(R.pyr.st === 'guards' && s.gold === 100 - PYRAMID.cost, 'zegel gebroken voor ' + PYRAMID.cost + ' goud');
ok(guards.length === PYRAMID.guards && guards.every(m => m.type === 7 && !m.wave && m.zone === 'desert'), guards.length + ' mummies (tellen niet mee voor de golf)');
ok(guards.every(m => Math.hypot(m.x - py.x, m.z - py.z) > py.r), 'mummies staan buiten de piramide');
ok(R.waveLeft() === 0, 'golfteller ziet de mummies niet');
P.god = true; step(1);
ok(guards.some(m => m.target === P), 'mummies jagen op de speler in de woestijn');
// een bosmonster jaagt niet op iemand in de woestijn
const forest = R.spawnMonster(0, py.x + 30, py.z, 1, 1, 1); step(0.7); ok(!forest.target, 'bosmonster negeert spelers in de woestijn'); R.monsters.delete(forest.id);
R.handle(P, { t: 'pyramid' }); ok(R.monsters.size === guards.length, 'tweede keer openen tijdens gevecht doet niets');
// mummies verslaan -> farao
for (const m of guards) R.killMonster(m, P);
step(1);
const boss = [...R.monsters.values()].find(m => m.type === 8);
ok(R.pyr.st === 'boss' && boss && boss.pyr, 'farao verschijnt als de mummies verslagen zijn');
ok(msgs.some(m => m.t === 'ev' && m.k === 'pharaoh'), 'pharaoh-event verstuurd');
// snapshot bevat altijd de farao (ook voor een speler ver weg)
const Q = R.addPlayer(conn('Bosbewoner')); Q.x = W.spawn.x; Q.z = W.spawn.z;
msgs.length = 0; R.tickN = 3; R.update(0.05);
const snaps = msgs.filter(m => m.t === 's');
ok(snaps.length === 2 && snaps.every(sn => sn.m.some(t => t[1] === 8)), 'farao zit in elke snapshot');
// vaardigheden: zandstralen en mummies oproepen
at(boss.x + 3, boss.z); msgs.length = 0; step(14);
ok(msgs.some(m => m.t === 'ev' && m.k === 'sandblast'), 'farao schiet zandstralen');
ok(msgs.some(m => m.t === 'ev' && m.k === 'summon' && m.id === boss.id), 'farao roept mummies op');
boss.hp = boss.maxhp * 0.3; step(0.3); ok(boss.enraged, 'farao wordt woest onder 35%');
// zandstraal raakt (zonder god) en zet je niet vast
P.god = false; P.hp = P.mhp; R.hazards.push({ x: P.x, z: P.z, r: 2.8, at: R.T, dmg: 20, sand: true }); R.updateHazards();
ok(P.hp < P.mhp && !(P.rootUntil > R.T), 'zandstraal doet schade maar zet niet vast');
P.god = true;
// verslaan
const before = { gold: s.gold, goud: s.statues.goud | 0, swords: s.swords.length };
R.killMonster(boss, P);
ok(R.pyr.st === 'cool' && ![...R.monsters.values()].some(m => m.pyr), 'farao verslagen: piramide rust, overige mummies weg');
ok(s.gold >= before.gold + PYRAMID.reward[0] && (s.statues.goud | 0) === before.goud + 1 && s.stats.pharaohs === 1, 'beloning: ' + (s.gold - before.gold) + ' goud + gouden beeld');
const nieuw = s.swords.slice(before.swords), sw = nieuw.find(w => w.rarity >= 3);   // er kan ook nog gewone monsterbuit bij zitten
ok(!!sw, 'zwaard van minstens episch: ' + (sw ? sw.name : nieuw.map(w => w.name).join(', ')));
ok(!!s.ach.mummie, 'prestatie Farao gevloerd');
s.gold = 100; R.handle(P, { t: 'pyramid' }); ok(R.pyr.st === 'cool' && s.gold === 100, 'tijdens afkoeltijd kan het zegel niet open');
R.pyr.until = R.T; step(0.1); ok(R.pyr.st === 'idle', 'na afkoeltijd weer open');
// weglopen: de piramide geeft het op
R.handle(P, { t: 'pyramid' }); ok(R.pyr.st === 'guards', 'opnieuw geopend');
at(W.spawn.x, W.spawn.z); step(PYRAMID.giveUp + 2);
ok(R.pyr.st === 'idle' && ![...R.monsters.values()].some(m => m.pyr), 'iedereen weg: mummies verdwijnen weer');
// wipe zet de piramide ook terug
at(py.entrance.x, py.entrance.z); s.gold = 100; R.handle(P, { t: 'pyramid' });
R.wipe(); ok(R.pyr.st === 'idle', 'wipe sluit de piramide');
process.exit(fails ? 1 : 0);
