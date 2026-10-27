import { ROOT, tmpData } from './helpers.mjs';
// Koken bij een kampvuur: ingrediënten, honger, tijdelijke voordelen.
import { Room } from '../room.js';
import { RECIPES, COOK_HUNGER, REGEN_PER_SEC } from '../public/items.js';
import { BUILD_BY_ID, placePoint, canPlace } from '../public/builds.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const msgs = [];
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999; R.weather.until = 1e9; R.traderAt = 1e9;
const P = R.addPlayer({ user: { name: 'Kok', save: { wood: 100 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const s = P.u.save; s.tut = 99;
const step = t => { for (let i = 0; i < Math.round(t / 0.05); i++) R.update(0.05); };
const last = () => msgs.filter(m => m.t === 'toast').pop()?.msg || '';

// een kampvuur bouwen
let spot = null;
for (let i = 0; i < 300 && !spot; i++) { const x = Math.sin(i) * (4 + i * 0.1), z = 2 + Math.cos(i * 1.3) * (4 + i * 0.1), pp = placePoint(BUILD_BY_ID.campfire, x, z, 0); if (!canPlace(R.world, R.builds.values(), 'campfire', pp.x, pp.z, pp.rot, R.felled)) spot = { px: x, pz: z, ...pp }; }
P.x = spot.px; P.z = spot.pz; R.handle(P, { t: 'build', kind: 'campfire', x: spot.x, z: spot.z, rot: spot.rot });
const fire = [...R.builds.values()].find(b => b.kind === 'campfire'); ok(!!fire, 'kampvuur gebouwd');

// te ver weg
P.x = fire.x + 10; P.z = fire.z; s.fish = 5; s.meat = 5; R.handle(P, { t: 'cook', id: 'spies' });
ok(s.fish === 5 && /kampvuur/.test(last()), 'koken kan alleen naast een kampvuur');
// naast het vuur
P.x = fire.x + 1.6; P.hunger = 30; R.handle(P, { t: 'cook', id: 'spies' });
ok(s.fish === 3 && s.wood === 89 && P.hunger === 30 + COOK_HUNGER, 'visspies: 2 vis en 1 hout, +' + COOK_HUNGER + ' honger');
ok(R.buff(P, 'regen') && s.stats.meals === 1, 'voordeel actief en maaltijd geteld');
P.hp = 50; P.lastHurt = R.T; step(2); ok(P.hp >= 50 + REGEN_PER_SEC * 2 - 0.1, 'visspies: levens komen vanzelf terug (' + Math.round(P.hp) + ')');
// te weinig
s.meat = 1; R.handle(P, { t: 'cook', id: 'stoof' }); ok(s.meat === 1 && /Te weinig vlees/.test(last()), 'te weinig vlees: niets gebeurt');
// stoofpot: halve honger
s.meat = 3; R.handle(P, { t: 'cook', id: 'stoof' }); ok(R.buff(P, 'hearty'), 'jagersstoofpot actief');
P.hunger = 80; P.x = fire.x + 20; step(10); const withStew = 80 - P.hunger;
P.buffs.hearty = 0; P.hunger = 80; step(10); const without = 80 - P.hunger;
ok(withStew < without * 0.6, 'stoofpot: half zo snel honger (' + withStew.toFixed(1) + ' tegen ' + without.toFixed(1) + ')');
// koningsmaal: meer schade
P.x = fire.x + 1.6; s.meat = 2; s.fish = 2; s.gold = 10; R.handle(P, { t: 'cook', id: 'maal' });
ok(s.gold === 0 && R.buff(P, 'royal'), 'koningsmaal kost ook 10 goud');
const m = R.spawnMonster(0, P.x + 1, P.z, 100, 1, 1); m.stun = 99; const it = { type: 'sword', damage: 40 };
let h0 = m.hp; R.hitEnemy(P, it, m, 'm', false); const royal = h0 - m.hp;
P.buffs.royal = 0; h0 = m.hp; R.hitEnemy(P, it, m, 'm', false); const plain = h0 - m.hp;
ok(royal > plain * 1.02, 'koningsmaal: meer schade (' + Math.round(royal) + ' tegen ' + Math.round(plain) + ')');
ok(msgs.some(m => m.t === 'ev' && m.k === 'cooked' && m.id === 'maal'), 'iedereen ziet dat er gekookt wordt');
ok(RECIPES.every(r => r.sec > 0 && r.buff), 'alle recepten hebben een voordeel');
process.exit(fails ? 1 : 0);
