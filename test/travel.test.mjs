import { ROOT, tmpData } from './helpers.mjs';
// Reisstenen: activeren in de woestijn voor goud, heen en weer reizen, afbreken, opladen en de hond reist mee.
import { Room } from '../room.js';
import { inDesert } from '../public/world.js';
import { TRAVEL } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer({ user: { name: 'Reiziger', save: { tut: 99, gold: 5, dog: { name: 'Bas', level: 2, xp: 0, fur: 0 } } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const s = P.u.save, W = R.world, F = W.travel.forest, D = W.travel.desert;
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
const at = (x, z) => { P.x = x; P.z = z; P.y = W.heightAt(x, z); P.lastInT = R.T; };
const toast = () => (msgs.filter(m => m.t === 'toast').pop() || {}).msg || '';

ok(F && D && !inDesert(F.x, F.z) && inDesert(D.x, D.z), 'reissteen in het bos en in de woestijn');
ok(Math.hypot(F.x, F.z - 2) < 20 && Math.hypot(D.x - W.desert.harbor.x, D.z - W.desert.harbor.z) < 12, 'vlak bij het startpunt en bij de haven');
// in het bos: nog niet geactiveerd
at(F.x + 1.5, F.z); R.handle(P, { t: 'travel' });
ok(!P.travel && /slaapt/.test(toast()), 'bossteen werkt pas na activeren in de woestijn');
// in de woestijn, te weinig goud
at(D.x + 1.5, D.z); R.handle(P, { t: 'travel' });
ok(!s.travel && /20 goud/.test(toast()), 'activeren kost ' + TRAVEL.cost + ' goud');
s.gold = 50; R.handle(P, { t: 'travel' });
ok(s.travel === 1 && s.gold === 30 && !P.travel, 'geactiveerd voor 20 goud');
// reizen naar het bos
R.handle(P, { t: 'travel' }); ok(!!P.travel && msgs.some(m => m.t === 'ev' && m.k === 'tpstart'), 'reizen begint');
step(TRAVEL.sec + 0.2);
ok(!inDesert(P.x, P.z) && Math.hypot(P.x - F.x, P.z - F.z) < 2.5, 'aangekomen bij de bossteen');
ok(msgs.some(m => m.t === 'correct') && msgs.some(m => m.t === 'ev' && m.k === 'tp'), 'client krijgt de nieuwe plek');
ok(P.dog && Math.hypot(P.dog.x - P.x, P.dog.z - P.z) < 2, 'de hond reist mee');
ok(s.stats.travels === 1, 'reis geteld');
// opladen
R.handle(P, { t: 'travel' }); ok(!P.travel && /opladen/.test(toast()), 'de steen moet eerst opladen');
R.T += TRAVEL.cooldown;
// weglopen breekt af
R.handle(P, { t: 'travel' }); ok(!!P.travel, 'opnieuw reizen');
at(F.x + 8, F.z); step(0.2); ok(!P.travel && msgs.some(m => m.t === 'ev' && m.k === 'tpfail'), 'weglopen breekt de reis af');
// geraakt worden breekt af
at(F.x + 1.5, F.z); R.handle(P, { t: 'travel' }); step(0.5); R.hurt(P, 5, null, 'melee', 'test'); step(0.2);
ok(!P.travel && !inDesert(P.x, P.z), 'geraakt worden breekt de reis af');
// en nu wel naar de woestijn, zonder dubbel geteld 'welkom'
R.handle(P, { t: 'travel' }); const v0 = s.stats.voyages; step(TRAVEL.sec + 1.5);
ok(inDesert(P.x, P.z) && s.stats.voyages === v0, 'naar de woestijn gereisd (telt niet als bootreis)');
// op een boot of te ver: niets
at(D.x + 10, D.z); R.T += TRAVEL.cooldown; R.handle(P, { t: 'travel' }); ok(!P.travel, 'te ver van de steen');
process.exit(fails ? 1 : 0);
