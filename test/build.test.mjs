import { ROOT, tmpData } from './helpers.mjs';
// Bouwen: eenheidstests op Room + een rondje via de echte server (incl. herstart).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { Room } from '../room.js';
import { BUILD_BY_ID, placePoint, canPlace } from '../public/builds.js';
import { createWorld, WATER } from '../public/world.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- eenheidstests */
const msgs = [];
const fakeConn = name => ({ user: { name, save: { wood: 500 } }, send: m => msgs.push(typeof m === 'string' ? JSON.parse(m) : m) });
const store = {};
const R = new Room(1, 'Test', 8, true, () => {}, store);
R.wave.t = 9999; R.animals.clear(); R.dogs.clear();
const P = R.addPlayer(fakeConn('Bouwer'));
function findSpot(kind, near = { x: 0, z: 2 }) {
  for (let i = 0; i < 400; i++) {
    const yaw = Math.random() * 6.28, d = 2 + Math.random() * 30;
    const x = near.x + Math.sin(i) * d, z = near.z + Math.cos(i * 1.7) * d;
    const pp = placePoint(BUILD_BY_ID[kind], x, z, yaw);
    if (!canPlace(R.world, R.builds.values(), kind, pp.x, pp.z, pp.rot, R.felled)) return { px: x, pz: z, ...pp };
  }
  return null;
}
const goto = (x, z) => { P.x = x; P.z = z; };
let sp = findSpot('wall'); goto(sp.px, sp.pz);
R.handle(P, { t: 'build', kind: 'wall', x: sp.x, z: sp.z, rot: sp.rot });
ok(R.builds.size === 1 && P.u.save.wood === 492, 'muur gebouwd, 8 hout betaald');
ok(store.builds && store.builds.length === 1, 'opgeslagen in kamerdata');
msgs.length = 0; R.handle(P, { t: 'build', kind: 'wall', x: sp.x, z: sp.z, rot: sp.rot });
ok(msgs.some(m => m.t === 'buildfail' && /Overlapt/.test(m.msg)), 'overlap geweigerd: ' + (msgs.find(m => m.t === 'buildfail') || {}).msg);
msgs.length = 0; R.handle(P, { t: 'build', kind: 'wall', x: sp.x + 50, z: sp.z, rot: 0 });
ok(msgs.some(m => m.t === 'buildfail' && /ver/.test(m.msg)), 'te ver weg geweigerd');
// water
let wpt = null; for (const t of R.world.trees.slice(0, 1)) {}
for (let x = -200; x < 200 && !wpt; x += 2) for (let z = -200; z < 200 && !wpt; z += 2) if (R.world.heightAt(x, z) < WATER - 1) wpt = { x, z };
goto(wpt.x, wpt.z); msgs.length = 0; R.handle(P, { t: 'build', kind: 'campfire', x: wpt.x + 1, z: wpt.z, rot: 0 });
ok(msgs.some(m => m.t === 'buildfail' && /water/.test(m.msg)), 'in het water geweigerd');
// bed vervangen
sp = findSpot('bed'); goto(sp.px, sp.pz); R.handle(P, { t: 'build', kind: 'bed', x: sp.x, z: sp.z, rot: sp.rot });
const bed1 = [...R.builds.values()].find(b => b.kind === 'bed');
sp = findSpot('bed'); goto(sp.px, sp.pz); R.handle(P, { t: 'build', kind: 'bed', x: sp.x, z: sp.z, rot: sp.rot });
const beds = [...R.builds.values()].filter(b => b.kind === 'bed');
ok(beds.length === 1 && beds[0] !== bed1, 'tweede bed vervangt het eerste');
// respawn bij bed
R.die(P); for (let i = 0; i < 200 && P.dead; i++) R.update(0.05);
ok(!P.dead && Math.hypot(P.x - beds[0].x, P.z - beds[0].z) < 2, 'respawn naast het bed (' + Math.hypot(P.x - beds[0].x, P.z - beds[0].z).toFixed(2) + ' m)');
// kampvuur geneest
sp = findSpot('campfire'); goto(sp.px, sp.pz); R.handle(P, { t: 'build', kind: 'campfire', x: sp.x, z: sp.z, rot: 0 });
P.hp = 40; P.lastHurt = R.T; P.hunger = 60; for (let i = 0; i < 40; i++) R.update(0.05);
ok(P.hp > 44, 'kampvuur geneest: 40 -> ' + P.hp.toFixed(1));
ok(P.hunger > 60 - 0.22 * 2 * 0.75, 'honger daalt langzamer bij het vuur: ' + P.hunger.toFixed(2));
// monster tegen een muur
const wall = [...R.builds.values()].find(b => b.kind === 'wall');
const nx = Math.sin(wall.rot), nz = Math.cos(wall.rot);   // normaal van de muur
goto(wall.x - nx * 2.5, wall.z - nz * 2.5); P.hp = 100; P.lastHurt = -99;
const m = { id: 999, type: 0, x: wall.x + nx * 1.5, z: wall.z + nz * 1.5, yaw: 0, hp: 500, maxhp: 500, dmg: 6, speed: 3.7, nextAtk: 0, stun: 0, retarget: 0, target: null };
R.monsters.set(m.id, m); R.wave.ph = 1;
const hp0 = wall.hp; let crossed = false;
for (let i = 0; i < 200; i++) { R.update(0.05); P.hp = 100; const side = (m.x - wall.x) * nx + (m.z - wall.z) * nz; const along = Math.abs((m.x - wall.x) * nz - (m.z - wall.z) * nx); if (side < 0 && along < 1.4) crossed = true; }
ok(!crossed, 'monster loopt niet door de muur');
ok(wall.hp < hp0 || !R.builds.has(wall.id), 'monster slaat op de muur: ' + hp0 + ' -> ' + Math.round(wall.hp));
// spelers kunnen niet door een muur heen (ook niet met een aangepaste client)
if (R.builds.has(wall.id)) {
  R.monsters.clear(); wall.hp = wall.maxhp;
  const walk = (x, z) => { R.T += 0.1; R.handle(P, { t: 'in', x, z, y: R.world.heightAt(x, z), yaw: 0 }); };
  goto(wall.x - nx * 1.5, wall.z - nz * 1.5); P.lastInT = R.T; msgs.length = 0;
  walk(wall.x + nx * 1.5, wall.z + nz * 1.5);
  const side = (P.x - wall.x) * nx + (P.z - wall.z) * nz;
  ok(side < 0 && msgs.some(m => m.t === 'correct'), 'speler die door de muur loopt wordt teruggezet (kant ' + side.toFixed(2) + ')');
  goto(wall.x - nx * 1.5, wall.z - nz * 1.5); P.lastInT = R.T; msgs.length = 0;
  for (let i = 1; i <= 10; i++) walk(wall.x - nx * 1.5 + nz * i * 0.4, wall.z - nz * 1.5 - nx * i * 0.4);
  ok(!msgs.some(m => m.t === 'correct'), 'langs de muur lopen mag gewoon');
  goto(wall.x - nx * 0.6, wall.z - nz * 0.6); P.lastInT = R.T; msgs.length = 0; walk(wall.x - nx * 0.4, wall.z - nz * 0.4);
  ok(!msgs.some(m => m.t === 'correct') && Math.abs(P.x - (wall.x - nx * 0.4)) < 0.01, 'tegen de muur aan staan (client-straal 0,38) mag');
  goto(wall.x, wall.z); P.lastInT = R.T; msgs.length = 0; walk(wall.x - nx * 1.2, wall.z - nz * 1.2);
  ok(!msgs.some(m => m.t === 'correct'), 'wie in een muur staat mag eruit lopen');
}
// toren schiet
R.monsters.clear();
sp = findSpot('tower'); goto(sp.px, sp.pz); R.handle(P, { t: 'build', kind: 'tower', x: sp.x, z: sp.z, rot: sp.rot });
const tw = [...R.builds.values()].find(b => b.kind === 'tower');
const m2 = { id: 1000, type: 0, x: tw.x + 10, z: tw.z, yaw: 0, hp: 20, maxhp: 20, dmg: 0, speed: 0, nextAtk: 0, stun: 0, retarget: 0, target: null };
R.monsters.set(m2.id, m2); msgs.length = 0;
for (let i = 0; i < 80 && R.monsters.has(1000); i++) R.update(0.05);
ok(msgs.some(x => x.t === 'ev' && x.k === 'arrow') && !R.monsters.has(1000), 'wachttoren schiet monster dood');
// afbreken
const w0 = P.u.save.wood; goto(tw.x + 3, tw.z); R.handle(P, { t: 'unbuild', id: tw.id });
ok(!R.builds.has(tw.id) && P.u.save.wood === w0 + 22, 'afbreken geeft de helft terug (' + (P.u.save.wood - w0) + ')');
// van een ander
const Q = R.addPlayer(fakeConn('Ander')); const bb = [...R.builds.values()][0]; Q.x = bb.x + 2; Q.z = bb.z;
R.handle(Q, { t: 'unbuild', id: bb.id }); ok(R.builds.has(bb.id), 'je kunt andermans bouwwerk niet afbreken');
// herladen uit opslag
const n = R.builds.size, R2 = new Room(2, 'Test', 8, true, () => {}, JSON.parse(JSON.stringify(store)));
ok(R2.seed === R.seed && R2.builds.size === n, 'zelfde wereld en ' + n + ' bouwwerken na herladen');

/* ---------------- via de echte server */
const PORT = 8126, DATA = tmpData('build');
fs.rmSync(DATA, { recursive: true, force: true });
const env = { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, FIRST_WAVE_DELAY: 999, MAX_SPEED: 99999 };
let srv;
async function start() { srv = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'inherit'] }); await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r())); return (await (await fetch('http://localhost:' + PORT + '/api/health')).json()).build; }
let BUILD = await start();
const reg = await (await fetch('http://localhost:' + PORT + '/api/register', { method: 'POST', body: JSON.stringify({ username: 'Timmer', password: 'abcdef1' }) })).json();
srv.kill('SIGTERM'); await sleep(800);
const db = JSON.parse(fs.readFileSync(DATA + '/db.json', 'utf8')); db.users.timmer.save.wood = 300; fs.writeFileSync(DATA + '/db.json', JSON.stringify(db));
BUILD = await start();
async function bot() {
  const b = { msgs: [], ws: new WebSocket('ws://localhost:' + PORT + '/ws') };
  b.send = m => b.ws.send(JSON.stringify(m));
  b.ws.onopen = () => b.send({ t: 'auth', build: BUILD, token: reg.token });
  b.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'authed') b.send({ t: 'join', id: 1 }); if (m.t === 'joined') b.joined = m; if (m.t === 'inv') b.inv = m; if (m.t !== 's') b.msgs.push(m); };
  for (let i = 0; i < 50 && !b.joined; i++) await sleep(100);
  return b;
}
let A = await bot();
const W = createWorld(A.joined.room.seed);
let spot = null;
for (let i = 0; i < 500 && !spot; i++) { const x = (Math.random() - 0.5) * 60, z = (Math.random() - 0.5) * 60, pp = placePoint(BUILD_BY_ID.palisade, x, z, 0.3); if (!canPlace(W, [], 'palisade', pp.x, pp.z, pp.rot)) spot = { px: x, pz: z, ...pp }; }
A.send({ t: 'in', x: spot.px, y: W.heightAt(spot.px, spot.pz), z: spot.pz, yaw: 0.3, pitch: 0 }); await sleep(200);
A.send({ t: 'build', kind: 'palisade', x: spot.x, z: spot.z, rot: spot.rot }); await sleep(400);
const nb = A.msgs.find(m => m.t === 'ev' && m.k === 'bnew');
ok(nb && A.inv.wood === 284, 'palissade via websocket gebouwd, hout 300 -> ' + A.inv.wood);
A.ws.close(); await sleep(300); srv.kill('SIGTERM'); await sleep(800);
BUILD = await start(); A = await bot();
ok(A.joined.builds.length === 1 && A.joined.builds[0][1] === BUILD_BY_ID.palisade.idx && A.joined.room.seed === W.seed, 'na serverherstart staat de palissade er nog (zelfde wereld)');
srv.kill(); console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
