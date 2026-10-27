import { ROOT, tmpData } from './helpers.mjs';
// Nachtgolven: sterker en meer monsters, de volgende golf komt sneller, en dubbele buit.
import { Room, CFG } from '../room.js';
import { NIGHT } from '../room/waves.js';
import { isNight, dayT, CYCLE_SEC } from '../public/world.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// de klok: 70% dag, daarna nacht (zelfde formule als de lucht in de browser)
const at = t => t * CYCLE_SEC * 1000;
ok(!isNight(at(0.3)) && !isNight(at(0.69)) && isNight(at(0.8)) && isNight(at(0.95)) && !isNight(at(0.99)), 'nacht tussen 72% en 98,5% van de cyclus');
ok(Math.abs(dayT(at(0.42) + CYCLE_SEC * 1000 * 5) - 0.42) < 1e-9, 'de cyclus herhaalt zich elke 20 minuten');

const msgs = [];
const mk = () => { const R = new Room(1, 'T', 8, false, () => {}); R.weather.until = 1e9; R.traderAt = 1e9; R.animals.clear(); return R; };
const R = mk(), P = R.addPlayer({ user: { name: 'Nachtuil', save: { tut: 99 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
ok(R.isNight() === false, 'tests draaien standaard overdag (FORCE_NIGHT=0)');

// dag tegen nacht op dezelfde golf
R.forceNight = false; R.wave.n = 3; R.startWave('snel'); const day = { hp: R.waveScale.hp, dmg: R.waveScale.dmg, n: R.monsters.size };
R.monsters.clear(); R.forceNight = true; R.wave.n = 3; R.startWave('snel'); const night = { hp: R.waveScale.hp, dmg: R.waveScale.dmg, n: R.monsters.size };
ok(Math.abs(night.hp / day.hp - NIGHT.hp) < 1e-6 && Math.abs(night.dmg / day.dmg - NIGHT.dmg) < 1e-6, 'nacht: monsters ' + Math.round((NIGHT.hp - 1) * 100) + '% meer levens en ' + Math.round((NIGHT.dmg - 1) * 100) + '% meer schade');
ok(night.n > day.n, 'nacht: meer monsters (' + day.n + ' -> ' + night.n + ')');
const wm = msgs.filter(m => m.t === 'wave' && m.ph === 1).pop(); ok(wm.night === true, 'client hoort dat het een nachtgolf is');
R.update(0.05); R.tickN = 3; msgs.length = 0; R.update(0.05);
const snap = msgs.find(m => m.t === 's'); ok(snap && snap.w.night === 1 && snap.w.nn === 1, 'snapshot: nachtgolf en nacht');

// dubbele buit
const s = P.u.save, sc0 = s.stats.score, w0 = s.wood;
R.monsters.clear(); R.forceNight = true; R.endWave();
const nightBonus = s.stats.score - sc0, nightWood = s.wood - w0;
R.forceNight = false; R.wave.n = 3; R.startWave('snel'); R.monsters.clear();
const sc1 = s.stats.score, w1 = s.wood; R.endWave();
ok(nightBonus === 2 * (s.stats.score - sc1) && nightWood === 2 * (s.wood - w1), 'nachtgolf: dubbele punten (' + nightBonus + ') en hout (' + nightWood + ')');
ok(!R.wave.night, 'na de golf is de vlag weer uit');

// 's nachts komt de volgende golf sneller
const R2 = mk(); R2.forceNight = true; R2.wave.t = 10;
for (let i = 0; i < 104; i++) R2.update(0.05);   // ruim 5 seconden
ok(R2.wave.ph === 1, 'nacht: wachttijd van 10 s is na 5,2 s al om');
const R3 = mk(); R3.forceNight = false; R3.wave.t = 10;
for (let i = 0; i < 100; i++) R3.update(0.05);
ok(R3.wave.ph === 0, 'dag: na 5 s nog niet');
process.exit(fails ? 1 : 0);
