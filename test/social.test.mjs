import { ROOT, tmpData } from './helpers.mjs';
// Hond (rassen, commando's), geven, gemeenschapskist en arena.
import { Room } from '../room.js';
import { potGoal, rollSwordOfRarity } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = (name, save = {}) => ({ user: { name, save: { wood: 1000, meat: 5, ...save } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const store = {};
const R = new Room(1, 'T', 8, true, () => {}, store); R.wave.t = 9999; R.animals.clear(); R.weather.until = 1e9; R.traderAt = 1e9;
const step = s => { for (let i = 0; i < Math.round(s / 0.05); i++) R.update(0.05); };
// ---- ras bij temmen
const stray = [...R.dogs.values()].find(d => d.state === 'wild'); stray.breed = 'waak';
const A = R.addPlayer(conn('Anna')); A.x = stray.x + 2; A.z = stray.z;
R.handle(A, { t: 'tame', id: stray.id });
ok(A.u.save.dog && A.u.save.dog.breed === 'waak' && A.dog.breed === 'waak', 'getemde hond is een waakhond');
ok(A.dog.maxhp > 60 * 1.3, 'waakhond heeft meer levens (' + A.dog.maxhp + ')');
// ---- waakhond trekt monsters
const m = R.spawnMonster(0, A.dog.x + 3, A.dog.z, 1, 0, 0); m.speed = 0; R.wave.ph = 1; step(0.1);
ok(m.target === A.dog, 'monster dichtbij valt de waakhond aan');
R.monsters.clear();
// ---- blijf (op de vlakke startweide, zodat water niet in de weg zit)
A.x = 0; A.z = 2; A.dog.x = 1; A.dog.z = 3; step(0.5);
A.x = A.dog.x; A.z = A.dog.z; R.handle(A, { t: 'dogcmd', c: 'stay' }); const sx = A.dog.x, sz = A.dog.z;
A.x += 14; step(3);
ok(Math.hypot(A.dog.x - sx, A.dog.z - sz) < 1.5, 'blijf: hond blijft op zijn plek');
R.handle(A, { t: 'dogcmd', c: 'follow' }); step(4); ok(Math.hypot(A.dog.x - A.x, A.dog.z - A.z) < 5, 'volg: hond komt terug');
// ---- val aan
const lp = { x: A.x - 12, z: A.z + 4 }; const t = R.spawnMonster(0, lp.x, lp.z, 3, 0, 0); t.speed = 0;
R.handle(A, { t: 'dogcmd', c: 'attack', id: t.id }); step(8);
ok(!R.monsters.has(t.id) || t.hp < t.maxhp, 'val aan: hond rent naar het monster en bijt');
R.monsters.clear(); R.wave.ph = 0; R.wave.t = 9999;
// ---- zoek
msgs.length = 0; R.handle(A, { t: 'dogcmd', c: 'seek' });
for (let i = 0; i < 40 && !msgs.some(x => x.k === 'dogfound'); i++) { step(1); A.x = A.dog.x + 2; A.z = A.dog.z; }
ok(msgs.some(x => x.k === 'dogfound'), 'zoek: hond vindt ' + (msgs.find(x => x.k === 'dogfound') || {}).kind);
// ---- geven
const B = R.addPlayer(conn('Bram', { wood: 0 })); B.x = A.x + 3; B.z = A.z; B.dead = false;
A.u.save.swords = [rollSwordOfRarity(3)];
R.handle(A, { t: 'give', to: B.id, what: 'wood', n: 100 }); R.handle(A, { t: 'give', to: B.id, what: 'sword', i: 0 });
ok(B.u.save.wood === 100 && B.u.save.swords.length === 1 && A.u.save.swords.length === 0, 'hout en zwaard gegeven');
B.x += 30; R.handle(A, { t: 'give', to: B.id, what: 'wood', n: 5 }); ok(B.u.save.wood === 100, 'geven alleen van dichtbij');
R.handle(A, { t: 'give', to: B.id, what: 'wood', n: 99999 }); ok(A.u.save.wood >= 0, 'niet meer geven dan je hebt');
// ---- gemeenschapskist
const W = R.world; A.x = W.pot.x + 2; A.z = W.pot.z; B.x = W.pot.x - 2; B.z = W.pot.z; A.u.save.wood = 1000; A.hunger = 20;
R.handle(A, { t: 'deposit', n: 100 }); ok(store.pot.have === 100, 'hout in de kist: 100/' + potGoal(1));
msgs.length = 0; R.handle(A, { t: 'deposit', n: 1000 });
ok(store.pot.lvl === 2 && store.pot.have === 0 && msgs.some(x => x.k === 'feast'), 'doel gehaald: feestmaal, volgend doel ' + potGoal(2));
ok(A.hunger === 100 && R.buff(A, 'feast') && R.buff(B, 'feast'), 'iedereen vol en met feestbuff');
// ---- arena
const Ar = W.arena; A.x = Ar.x; A.z = Ar.z; A.yaw = 0; B.x = Ar.x; B.z = Ar.z - 1.5; B.hp = 5; B.lastInT = R.T; B.dead = false; A.dead = false; A.nextSwing = 0;
msgs.length = 0; R.handle(A, { t: 'swing', heavy: true }); step(0.4);
ok(msgs.some(x => x.k === 'phit') && msgs.some(x => x.k === 'duel'), 'duel in de arena: geraakt en verslagen');
ok(!B.dead && B.hp === B.mhp && Math.hypot(B.x - Ar.x, B.z - Ar.z) > Ar.r, 'verliezer staat met volle levens buiten de arena');
ok(A.u.save.stats.pvpWins === 1, 'overwinning geteld');
// buiten de arena geen schade
A.x = Ar.x + 40; A.z = Ar.z; B.x = A.x; B.z = A.z - 1.5; B.hp = 50; A.nextSwing = 0; R.handle(A, { t: 'swing' }); step(0.4);
ok(B.hp === 50, 'buiten de arena kun je elkaar niet raken');
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
