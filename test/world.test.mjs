import { ROOT, tmpData } from './helpers.mjs';
// Wereld: ruïnes met bewakers, biomen, weer met bliksem en de reizende handelaar.
import { Room } from '../room.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const conn = name => ({ user: { name, save: { wood: 500 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.animals.clear(); R.dogs.clear(); R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer(conn('W')); P.god = false;
const step = s => { for (let i = 0; i < Math.round(s / 0.05); i++) R.update(0.05); };
// ---- ruïne
const ru = R.world.ruins[0]; ok(R.world.ruins.length >= 3, R.world.ruins.length + ' ruïnes');
P.x = ru.chest.x + 2; P.z = ru.chest.z; msgs.length = 0;
R.handle(P, { t: 'ruin', i: 0 });
ok(R.ruinSt[0].st === 'awake' && R.ruinSt[0].guards.size >= 3, 'bewakers ontwaken: ' + R.ruinSt[0].guards.size);
R.handle(P, { t: 'ruin', i: 0 }); ok(R.ruinSt[0].st === 'awake', 'kist blijft dicht zolang er bewakers zijn');
for (const id of [...R.ruinSt[0].guards]) R.killMonster(R.monsters.get(id), P);
ok(R.ruinSt[0].st === 'ready' && msgs.some(m => m.k === 'ruin' && m.st === 'ready'), 'alle bewakers verslagen: kist klaar');
const sw0 = P.u.save.swords.length, ore0 = P.u.save.ore;
R.handle(P, { t: 'ruin', i: 0 });
const sw = P.u.save.swords[P.u.save.swords.length - 1];
ok(P.u.save.swords.length === sw0 + 1 && sw.rarity >= 2 && P.u.save.ore > ore0 && P.u.save.stats.dungeons === 1, 'buit: ' + sw.name + ' (zeldzaamheid ' + sw.rarity + ') en erts');
ok(R.ruinSt[0].st === 'cool', 'kist in afkoeltijd'); R.T += 1201; step(1.1); ok(R.ruinSt[0].st === 'idle', 'na 20 minuten weer beschikbaar');
// ---- biomen
function spot(b) { for (let i = 0; i < 20000; i++) { const x = (Math.random() - 0.5) * 380, z = (Math.random() - 0.5) * 380; if (R.world.heightAt(x, z) > 1 && R.world.biomeAt(x, z) === b) return { x, z }; } }
const snow = spot('snow'), forest = spot('forest');
function drain(pt) { P.x = pt.x; P.z = pt.z; P.hunger = 90; P.dead = false; step(1.1); const h0 = P.hunger; step(10); return h0 - P.hunger; }
if (snow) { const a = drain(forest), b = drain(snow); ok(b > a * 1.2, 'honger in de sneeuw sneller: ' + a.toFixed(2) + ' vs ' + b.toFixed(2)); } else console.log('(geen sneeuw in deze wereld)');
ok(P.u.save.biomes.forest && (!snow || P.u.save.biomes.snow), 'bezochte gebieden onthouden: ' + Object.keys(P.u.save.biomes).join(','));
// ---- onweer
P.x = forest.x; P.z = forest.z; P.hp = P.mhp;
R.weather.k = 'onweer'; R.weather.bolt = R.T; msgs.length = 0; step(0.2);
const bolt = msgs.find(m => m.k === 'bolt');
ok(!!bolt && R.hazards.some(h => h.bolt), 'bliksem aangekondigd');
const m = R.spawnMonster(0, bolt.x, bolt.z, 1, 0, 0); m.speed = 0; step(1.2);
ok(!R.monsters.has(m.id), 'monster op de inslag gedood');
R.weather.k = 'helder';
// ---- handelaar
R.traderAt = R.T; step(0.2);
ok(!!R.trader && msgs.some(m => m.t === 'trader' && m.arrived), 'reizende handelaar komt langs');
R.trader.stock = ['elixir', 'haste', 'ore', 'mystery'];
P.x = R.trader.x + 2; P.z = R.trader.z; const w0 = P.u.save.wood;
R.handle(P, { t: 'tbuy', id: 'elixir' }); R.handle(P, { t: 'tbuy', id: 'snack' });
ok(P.u.save.wood === w0 - 40 && R.buff(P, 'elixir'), 'krachtelixer gekocht (hondenkoekje niet in voorraad)');
const mm = R.spawnMonster(0, P.x, P.z - 1.5, 100, 0, 0); P.yaw = 0; P.hunger = 50;
const h0 = mm.hp; R.hitEnemy(P, { type: 'axe' }, mm, 'm', false); ok(h0 - mm.hp > 3 * 0.9 * 1.2, 'elixer: meer schade (' + (h0 - mm.hp).toFixed(2) + ')');
R.handle(P, { t: 'tbuy', id: 'mystery' }); ok(P.u.save.swords.length >= 2 && P.u.save.swords.some(w => w.rarity >= 2), 'mysterieuze kist geeft een goed zwaard');
R.T = R.trader.until + 1; step(0.1); ok(!R.trader && msgs.some(m => m.t === 'trader' && m.info === null), 'handelaar vertrekt weer');
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
