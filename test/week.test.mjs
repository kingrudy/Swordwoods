import { ROOT, tmpData } from './helpers.mjs';
process.env.WEEK_EVENT = '';   // de echte kalender
// Weekranglijst (punten = ervaring van deze week), weekwissel met prijzen, en de effecten van weekevents.
import { Room, ensureSave } from '../room.js';
import { createWeekly } from '../week.js';
import { isoWeek, weekEvent, WEEK_EVENTS, WEEK_PRIZES } from '../public/progress.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ISO-weken
const wk = d => isoWeek(new Date(d + 'T12:00:00Z'));
ok(wk('2026-10-22').k === '2026-W43' && wk('2026-10-22').left === 4, 'donderdag 22 okt 2026 = week 43, nog 4 dagen');
ok(wk('2025-12-29').k === '2026-W01' && wk('2027-01-03').k === '2026-W53', 'jaarwissel volgens ISO');
ok(wk('2026-10-25').k === '2026-W43' && wk('2026-10-26').k === '2026-W44', 'week wisselt op maandag');
const evs = []; for (let d = 0; d < 7 * 6; d += 7) evs.push(weekEvent(isoWeek(Date.UTC(2026, 9, 5) + d * 864e5)).id);
ok(evs.every((e, i) => i === 0 || e !== evs[i - 1]) && new Set(evs).size === WEEK_EVENTS.length, 'events wisselen elke week: ' + evs.join(', '));

// weekpunten in de kamer
const msgs = [];
const mk = name => { const u = { name, save: { wood: 0 } }; ensureSave(u); return u; };
const users = { anna: mk('Anna'), bob: mk('Bob'), cas: mk('Cas'), dirk: mk('Dirk') };
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer({ user: users.anna, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const j = msgs.find(m => m.t === 'joined'); ok(j.week && j.week.k === isoWeek().k && WEEK_EVENTS.some(e => e.id === j.week.ev), 'weekinfo in joined: ' + JSON.stringify(j.week));
R.addXp(P, 120); ok(users.anna.save.week.k === isoWeek().k && users.anna.save.week.pts === 120, 'ervaring telt als weekpunten');
users.anna.save.week = { k: '2000-W01', pts: 999 }; R.addXp(P, 5); ok(users.anna.save.week.pts === 5 && users.anna.save.week.k === isoWeek().k, 'oude week begint opnieuw bij 0');

// effecten
const W = R.world, s = users.anna.save; s.tut = 99;
R.weekForce = 'hout'; R._wev = null;
const t = W.trees.find(t => !R.felled.has(t.idx)); R.treeHp[t.idx] = 0.01; P.x = t.x + 1.2; P.z = t.z; P.yaw = Math.atan2(-(t.x - P.x), -(t.z - P.z));
const w0 = s.wood, base = 3 + Math.floor(t.scale * 2); R.resolveHit(P);
ok(s.wood - w0 === base * 2, 'Houthakkersweek: dubbel hout (' + (s.wood - w0) + ')');
R.weekForce = 'jacht'; R._wev = null;
const a = [...R.animals.values()][0], m0 = s.meat; R.killAnimal(a, P); ok(s.meat - m0 > 0 && (s.meat - m0) % 2 === 0, 'Jachtweek: dubbel vlees (' + (s.meat - m0) + ')');
R.weekForce = 'vis'; R._wev = null; ok(R.wk('fishFast') === 0.5 && R.wk('goldFish') === 2 && R.wk('wood') === 1, 'Visweek: vissen bijten sneller, geen effect op hout');
R.weekForce = 'woestijn'; R._wev = null; ok(R.wk('statue', 0) === 0.1 && R.wk('digGold') === 2, 'Woestijnweek: meer beelden, dubbel goud');
R.weekForce = 'monster'; R._wev = null;
R.wave.n = 4; R.wave.ph = 1; const sc0 = s.stats.score; R.endWave(); ok(s.stats.score - sc0 === Math.round(4 * 25 * 1.5), 'Monsterweek: golfbonus +50%');

// weekwissel
let clock = Date.parse('2026-10-22T12:00:00Z');
const db = { users: Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u])) };
const rooms = new Map([[1, R]]);
const W1 = createWeekly({ db, rooms, markDirty: () => {}, now: () => clock, log: () => {} });
W1.tick(); ok(db.weekK === '2026-W43', 'huidige week onthouden');
users.anna.save.week = { k: '2026-W43', pts: 300 }; users.bob.save.week = { k: '2026-W43', pts: 500 };
users.cas.save.week = { k: '2026-W43', pts: 100 }; users.dirk.save.week = { k: '2026-W43', pts: 50 };
const b = W1.board();
ok(b.k === '2026-W43' && b.top.map(x => x.name).join() === 'Bob,Anna,Cas,Dirk' && b.ev.name, 'ranglijst van deze week: ' + b.top.map(x => x.name + ' ' + x.pts).join(', '));
const gold0 = Object.fromEntries(Object.entries(users).map(([k, u]) => [k, u.save.gold]));
msgs.length = 0;
clock = Date.parse('2026-10-26T08:00:00Z'); W1.tick();
ok(db.weekK === '2026-W44', 'nieuwe week begonnen');
ok(users.bob.save.gold - gold0.bob === WEEK_PRIZES[0] && users.anna.save.gold - gold0.anna === WEEK_PRIZES[1] && users.cas.save.gold - gold0.cas === WEEK_PRIZES[2] && users.dirk.save.gold === gold0.dirk, 'top 3 krijgt ' + WEEK_PRIZES.join('/') + ' goud');
ok(users.bob.save.stats.weekWins === 1 && users.anna.save.stats.weekTop3 === 1, 'weekwinst geteld');
ok(msgs.some(m => m.t === 'toast' && /2e in de weekranglijst/.test(m.msg)) && !users.anna.save.notes.length, 'Anna is online en ziet het meteen');
ok(users.bob.save.notes.length === 1 && /1e/.test(users.bob.save.notes[0]), 'Bob is offline: bericht bewaard voor later');
const Q = R.addPlayer({ user: users.bob, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
ok(msgs.some(m => m.t === 'toast' && /1e in de weekranglijst/.test(m.msg)) && !users.bob.save.notes.length, 'bij inloggen krijgt Bob het bericht');
const b2 = W1.board(); ok(b2.k === '2026-W44' && b2.top.length === 0 && b2.last.k === '2026-W43' && b2.last.top[0].name === 'Bob', 'nieuwe ranglijst leeg, vorige week bewaard');
W1.tick(); ok(users.bob.save.gold - gold0.bob === WEEK_PRIZES[0], 'nog een tick geeft geen dubbele prijs');
process.exit(fails ? 1 : 0);
