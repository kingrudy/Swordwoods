import { ROOT, tmpData } from './helpers.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createWorld, WATER } from '../public/world.js';
const PORT = 8127, BASE = 'http://localhost:' + PORT, sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA = tmpData('fish');
fs.rmSync(DATA, { recursive: true, force: true });
let srv;
const start = async () => { srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, MAX_SPEED: 99999, FIRST_WAVE_DELAY: 999, ...{} }, stdio: ['ignore', 'pipe', 'inherit'] }); await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r())); globalThis.BUILD = (await (await fetch(BASE + '/api/health')).json()).build; };
const stop = () => new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM'); });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
await start(); await post('/api/register', { username: 'Visser', password: 'geheim123' }); await sleep(1800); await stop();
const db = JSON.parse(fs.readFileSync(DATA + '/db.json', 'utf8')); Object.assign(db.users.visser.save, { wood: 100, dog: { name: 'Bas', level: 1, xp: 0, fur: 0 } });
fs.writeFileSync(DATA + '/db.json', JSON.stringify(db)); await start();
const tok = (await post('/api/login', { username: 'Visser', password: 'geheim123' })).token;
const B = { toasts: [], evs: [] }; const ws = new WebSocket('ws://localhost:' + PORT + '/ws');
ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', build: globalThis.BUILD, token: tok }));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'authed') ws.send(JSON.stringify({ t: 'create', name: 'Visbos', max: 2 })); if (m.t === 'joined') { B.joined = m; B.W = createWorld(m.room.seed); } if (m.t === 'inv') B.inv = m; if (m.t === 's') B.snap = m; if (m.t === 'toast') B.toasts.push(m.msg); if (m.t === 'ev') B.evs.push(m); };
const send = o => ws.send(JSON.stringify(o));
while (!B.joined || !B.snap) await sleep(50);
const W = B.W, sh = W.shop, at = (x, z) => send({ t: 'in', x, y: W.heightAt(x, z), z, yaw: 0, pitch: 0 });
// winkel: hengel
at(sh.x + Math.sin(sh.rotY) * 3.5, sh.z + Math.cos(sh.rotY) * 3.5); await sleep(200);
send({ t: 'buy', id: 'rod' }); await sleep(300);
ok(B.inv.up.rod === 1 && B.inv.wood === 75, 'vishengel gekocht voor 25 hout (hout ' + B.inv.wood + ')');
send({ t: 'buy', id: 'rod' }); await sleep(250); ok(B.toasts.at(-1).includes('al een vishengel'), 'tweede hengel geweigerd');
// waterkant zoeken
let shore = null;
for (let a = 0; a < 64 && !shore; a++) { const ang = a / 64 * Math.PI * 2; for (let r = 10; r < 200; r += 1) { const x = Math.cos(ang) * r, z = Math.sin(ang) * r; if (W.heightAt(x, z) < WATER - 0.6) { let b = r - 1; while (b > 5 && W.heightAt(Math.cos(ang) * b, Math.sin(ang) * b) < 0.5) b--; if (r - b > 5) break; shore = { lx: Math.cos(ang) * b, lz: Math.sin(ang) * b, wx: Math.cos(ang) * (r + 1), wz: Math.sin(ang) * (r + 1) }; break; } } }
console.log('   waterkant op', shore.lx.toFixed(0), shore.lz.toFixed(0), 'land h=', W.heightAt(shore.lx, shore.lz).toFixed(1), 'water h=', W.heightAt(shore.wx, shore.wz).toFixed(1));
at(shore.lx, shore.lz); await sleep(300);
send({ t: 'cast', x: shore.lx, z: shore.lz }); await sleep(250); ok(B.toasts.at(-1).includes('in het water'), 'uitgooien op land geweigerd');
// te vroeg
send({ t: 'cast', x: shore.wx, z: shore.wz }); await sleep(300); ok(B.evs.some(e => e.k === 'cast'), 'hengel uitgegooid');
send({ t: 'reel' }); await sleep(250); ok(B.toasts.at(-1).includes('Te vroeg') && B.evs.some(e => e.k === 'fishend'), 'te vroeg binnenhalen: ' + B.toasts.at(-1));
// te laat
B.evs.length = 0; send({ t: 'cast', x: shore.wx, z: shore.wz });
for (let i = 0; i < 60 && !B.evs.some(e => e.k === 'bite'); i++) await sleep(200);
ok(B.evs.some(e => e.k === 'bite'), 'beet binnen 10 s');
await sleep(2200); ok(B.toasts.at(-1).includes('Te laat') && B.inv.fish === 0, 'te laat: ' + B.toasts.at(-1));
// goed: 5 keer vissen
let caught = 0;
for (let k = 0; k < 5; k++) {
  B.evs.length = 0; send({ t: 'cast', x: shore.wx, z: shore.wz });
  for (let i = 0; i < 120 && !B.evs.some(e => e.k === "bite"); i++) await sleep(100);
  await sleep(300); send({ t: 'reel' }); await sleep(250);
  if (B.evs.some(e => e.k === 'caught')) caught++;
}
ok(caught === 5 && B.inv.fish >= 5, `5 keer op tijd binnengehaald: ${caught} vangsten, ${B.inv.fish} vis (goudvis telt 3)`);
// weglopen annuleert
B.evs.length = 0; send({ t: 'cast', x: shore.wx, z: shore.wz }); await sleep(200); at(shore.lx - 30 * Math.sign(shore.lx || 1), shore.lz); await sleep(400);
ok(B.evs.some(e => e.k === 'fishend'), 'weglopen haalt de dobber binnen');
at(shore.lx, shore.lz); await sleep(1500);
// hond voeren
const dog = () => B.snap.d.find(d => d[6] === B.joined.you.id);
ok(dog() && dog()[11] === 0, 'hond zonder boost');
const f0 = B.inv.fish; send({ t: 'feeddog' }); await sleep(400);
ok(B.inv.fish === f0 - 1 && dog()[11] >= 59, `hond gevoerd: vis ${f0}->${B.inv.fish}, boost ${dog()[11]} s, xp ${B.inv.dog.xp}`);
send({ t: 'feeddog' }); send({ t: 'feeddog' }); send({ t: 'feeddog' }); await sleep(400);
ok(dog()[11] <= 180, 'boost maximaal 180 s (' + dog()[11] + ')');
ws.close(); await sleep(2000); await stop(); await start();
const t2 = (await post('/api/login', { username: 'Visser', password: 'geheim123' })).token;
const ws2 = new WebSocket('ws://localhost:' + PORT + '/ws'); let au; ws2.onopen = () => ws2.send(JSON.stringify({ t: 'auth', build: globalThis.BUILD, token: t2 })); ws2.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'authed') au = m; };
while (!au) await sleep(50);
ok(au.save.up.rod === 1 && au.save.fish === B.inv.fish, 'hengel en vis bewaard: ' + au.save.fish + ' vis');
await stop(); console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
