import { ROOT, tmpData } from './helpers.mjs';
// Uiterlijk: kopen met goud, dragen en afdoen, voorwaarden, en dat andere spelers het te zien krijgen.
import { Room, ensureSave, cosAction } from '../room.js';
import { COSMETICS } from '../public/items.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const u = { name: 'Mode', save: { gold: 100 } }; ensureSave(u); const s = u.save;
ok(Array.isArray(s.cos.own) && s.cos.hat === null && s.cos.cape === null && s.cos.collar === null, 'nieuw: niets in bezit, niets aan');
ok(cosAction(s, 'buy', 'hoed_kroon') && s.gold === 100, 'te weinig goud voor de kroon (250)');
ok(cosAction(s, 'buy', 'cape_rood') === null && s.gold === 60 && s.cos.cape === 'cape_rood', 'rode cape gekocht en meteen aan');
ok(cosAction(s, 'buy', 'cape_rood') && s.gold === 60, 'twee keer kopen kan niet');
ok(cosAction(s, 'buy', 'band_blauw') === null && s.cos.collar === 'band_blauw' && s.gold === 40, 'halsband gekocht');
ok(cosAction(s, 'wear', 'cape_blauw') && s.cos.cape === 'cape_rood', 'dragen wat je niet hebt kan niet');
ok(cosAction(s, 'wear', null, 'cape') === null && s.cos.cape === null, 'cape afgedaan');
ok(cosAction(s, 'wear', 'cape_rood') === null && s.cos.cape === 'cape_rood', 'weer aan');
s.gold = 500;
ok(/farao/.test(cosAction(s, 'buy', 'hoed_farao') || '') && s.gold === 500, 'faraokap pas na de farao');
s.stats.pharaohs = 1;
ok(cosAction(s, 'buy', 'hoed_farao') === null && s.cos.hat === 'hoed_farao', 'na de farao wel');
ok(cosAction(s, 'buy', 'bestaatniet'), 'onbekend item geweigerd');
// opgeslagen rommel wordt opgeruimd
s.cos.own.push('nep', 'nep'); s.cos.hat = 'cape_goud'; ensureSave(u);
ok(!s.cos.own.includes('nep') && s.cos.hat === null && s.cos.cape === 'cape_rood', 'ongeldige waarden opgeruimd');
cosAction(s, 'wear', 'hoed_farao');
ok(COSMETICS.every(c => c.cost > 0 && ['hat', 'cape', 'collar'].includes(c.slot)), 'catalogus klopt (' + COSMETICS.length + ' items)');

// anderen zien wat je draagt
const R = new Room(1, 'T', 8, false, () => {}); R.wave.t = 9999;
const msgsA = [], msgsB = [];
R.addPlayer({ user: u, send: m => msgsA.push(typeof m === 'string' ? JSON.parse(m) : m) });
const v = { name: 'Kijker', save: {} };
R.addPlayer({ user: v, send: m => msgsB.push(typeof m === 'string' ? JSON.parse(m) : m) });
const j = msgsB.find(m => m.t === 'joined'), me = j.players.find(p => p.name === 'Mode');
ok(me && me.cos.cape === 'cape_rood' && me.cos.hat === 'hoed_farao' && me.cos.collar === 'band_blauw', 'nieuwe speler ziet je uiterlijk: ' + JSON.stringify(me && me.cos));
const pj = msgsA.find(m => m.t === 'pjoin'); ok(pj && pj.cos && pj.cos.hat === null, 'pjoin bevat het uiterlijk van de nieuwkomer');
process.exit(fails ? 1 : 0);
