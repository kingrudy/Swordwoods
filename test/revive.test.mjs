import { ROOT, tmpData } from './helpers.mjs';
// Opknappen: een gevallen medespeler binnen 3 s weer op de been helpen, zonder houtverlies.
import { Room } from '../room.js';
import { REVIVE_SEC } from '../room/combat.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = name => ({ user: { name, save: { wood: 100 } }, send: m => msgs.push({ to: name, ...(typeof m === 'string' ? JSON.parse(m) : m) }) });
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9; R.monsters.clear();
const A = R.addPlayer(conn('Anna')), B = R.addPlayer(conn('Bram'));
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
A.x = B.x = 5; A.z = 5; B.z = 6.5;

R.hurt(A, 999, null, 'melee', 'test');
ok(A.dead && A.u.save.wood === 100, 'Anna valt en houdt voorlopig haar hout');
ok(msgs.some(m => m.to === 'Anna' && m.t === 'dead' && m.help), 'Anna hoort dat een medespeler kan helpen');
R.handle(B, { t: 'revive', id: A.id });
ok(B.reviving && msgs.some(m => m.t === 'ev' && m.k === 'revstart' && m.by === B.id), 'Bram begint met opknappen');
step(REVIVE_SEC * 0.5); ok(A.dead, 'na de helft nog niet klaar');
step(REVIVE_SEC * 0.6);
ok(!A.dead && A.hp === Math.round(A.mhp * 0.4) && A.x === 5 && A.z === 5, 'Anna staat op dezelfde plek op met 40% levens');
ok(A.u.save.wood === 100 && B.u.save.stats.revives === 1, 'geen houtverlies, opknappen geteld bij Bram');
ok(msgs.some(m => m.to === 'Anna' && m.t === 'revived' && m.by === 'Bram'), 'Anna krijgt te horen wie haar hielp');

// weglopen breekt af, dan gewoon respawnen met houtverlies
R.hurt(A, 999, null, 'melee', 'test'); msgs.length = 0;
R.handle(B, { t: 'revive', id: A.id }); B.x += 6; step(0.2);
ok(!B.reviving && msgs.some(m => m.k === 'revfail'), 'weglopen stopt het opknappen');
step(9);
ok(!A.dead && A.u.save.wood === 50 && msgs.some(m => m.to === 'Anna' && m.t === 'respawn' && m.lost === 50), 'zonder hulp: respawn en de helft van het hout kwijt');

// te ver weg, of jezelf, of een levende speler: niets
R.handle(B, { t: 'revive', id: A.id }); ok(!B.reviving, 'een levende speler opknappen kan niet');
R.hurt(A, 999, null, 'melee', 'test'); B.x = A.x + 10; B.z = A.z;
R.handle(B, { t: 'revive', id: A.id }); ok(!B.reviving, 'te ver weg');
R.handle(A, { t: 'revive', id: A.id }); ok(!A.reviving, 'jezelf opknappen kan niet');
// de teller wacht zolang iemand bezig is
B.x = A.x + 1; const at = A.respawnAt; step(CFG_RESPAWN_LEFT(A));
function CFG_RESPAWN_LEFT(P) { return Math.max(0, P.respawnAt - R.T - 0.3); }
R.handle(B, { t: 'revive', id: A.id }); ok(A.respawnAt > at, 'respawn wordt uitgesteld tijdens het opknappen');
step(REVIVE_SEC + 0.2); ok(!A.dead && A.hp < A.mhp, 'op het nippertje opgeknapt in plaats van gerespawnd');
process.exit(fails ? 1 : 0);
