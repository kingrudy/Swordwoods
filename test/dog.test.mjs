import { ROOT, tmpData } from './helpers.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createWorld } from '../public/world.js';
const PORT = 8126, BASE = 'http://localhost:' + PORT, sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA = tmpData('dog');
fs.rmSync(DATA, { recursive: true, force: true });
let srv;
const start = async env => { srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, MAX_SPEED: 99999, FIRST_WAVE_DELAY: 8, WAVE_GAP: 60, ...env }, stdio: ['ignore', 'pipe', 'inherit'] }); await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r())); globalThis.BUILD = (await (await fetch(BASE + '/api/health')).json()).build; };
const stop = () => new Promise(r => { srv.on('exit', r); srv.kill('SIGTERM'); });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const post = (p, b) => fetch(BASE + p, { method: 'POST', body: JSON.stringify(b) }).then(r => r.json());
function bot(tok, onAuthed) {
  const b = { toasts: [], evs: [], inv: null, snap: null, joined: null };
  b.ws = new WebSocket('ws://localhost:' + PORT + '/ws');
  b.ws.onopen = () => b.ws.send(JSON.stringify({ t: 'auth', build: globalThis.BUILD, token: tok }));
  b.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'authed') onAuthed(b); if (m.t === 'joined') { b.joined = m; b.W = createWorld(m.room.seed); } if (m.t === 'inv') b.inv = m; if (m.t === 's') { b.snap = m; if (m.f !== 0 || !b.monMap) b.monMap = new Map(m.m.map(t => [t[0], t])); else for (const t of m.m) b.monMap.set(t[0], t); b.mons = [...b.monMap.values()]; }   // tussensnapshots: alleen wat dichtbij is
    if (m.t === 'ev' && m.k === 'mdie' && b.monMap) { b.monMap.delete(m.id); b.mons = [...b.monMap.values()]; } if (m.t === 'toast') b.toasts.push(m.msg); if (m.t === 'ev') b.evs.push(m); };
  b.send = o => b.ws.send(JSON.stringify(o));
  b.at = (x, z, yaw = 0) => b.send({ t: 'in', x, y: b.W.heightAt(x, z), z, yaw, pitch: 0 });
  return b;
}
await start();
await post('/api/register', { username: 'Baasje', password: 'geheim123' });
await sleep(1800); await stop();
const db = JSON.parse(fs.readFileSync(DATA + '/db.json', 'utf8')); db.users.baasje.save.meat = 0; db.users.baasje.save.swords = [{ type: 'sword', rarity: 4, base: 1, name: 'Test', damage: 60, speed: 1 }]; db.users.baasje.save.equip = 1;
fs.writeFileSync(DATA + '/db.json', JSON.stringify(db));
await start();
const tok = (await post('/api/login', { username: 'Baasje', password: 'geheim123' })).token;
const A = bot(tok, b => b.send({ t: 'create', name: 'Hondenbos', max: 2 }));
while (!A.joined || !A.snap) await sleep(50);
const strays = A.snap.d.filter(d => d[6] === 0);
ok(strays.length === 3, 'drie zwerfhonden in de wereld: ' + strays.map(d => Math.round(Math.hypot(d[1], d[2])) + 'm').join(', ') + ' van de start');
const s0 = strays[0];
A.at(s0[1] + 12, s0[2]); await sleep(300);
for (let i = 0; i < 40 && !A.evs.some(e => e.k === 'bark'); i++) await sleep(250);
ok(A.evs.some(e => e.k === 'bark'), 'hond blaft als je in de buurt komt');
// te ver weg
A.send({ t: 'tame', id: s0[0] }); await sleep(250); ok(!A.inv.dog, 'temmen van ver weg lukt niet');
// dichtbij zonder vlees
const cur = () => A.snap.d.find(d => d[0] === s0[0]);
A.at(cur()[1] + 1.5, cur()[2]); await sleep(300);
ok(cur()[7] === 3, 'hond gaat zitten als je dichtbij staat (state 3)');
A.send({ t: 'tame', id: s0[0] }); await sleep(250);
ok(!A.inv.dog && A.toasts.some(t => /vlees mee/.test(t)), 'zonder vlees: ' + A.toasts.at(-1));
// vlees geven: server-side meat toevoegen via winkel kan niet (afstand); kist/jacht te traag -> doe het via db en herstart
A.ws.close(); await sleep(2000); await stop();
const db2 = JSON.parse(fs.readFileSync(DATA + '/db.json', 'utf8')); db2.users.baasje.save.meat = 2; fs.writeFileSync(DATA + '/db.json', JSON.stringify(db2));
await start();
const tok2 = (await post('/api/login', { username: 'Baasje', password: 'geheim123' })).token;
const B = bot(tok2, b => b.send({ t: 'create', name: 'Hondenbos2', max: 2 }));
while (!B.joined || !B.snap) await sleep(50);
const st = B.snap.d.find(d => d[6] === 0);
B.at(st[1] + 1.5, st[2]); await sleep(300);
B.send({ t: 'tame', id: st[0] }); await sleep(400);
ok(B.inv.dog && B.inv.dog.level === 1 && B.inv.meat === 1, 'getemd met 1 vlees: ' + JSON.stringify(B.inv.dog) + ', vlees over ' + B.inv.meat);
ok(B.evs.some(e => e.k === 'tamed') && B.toasts.some(t => /Je hebt een hond/.test(t)), 'melding: ' + B.toasts.find(t => /hond/.test(t)));
const myDog = () => B.snap.d.find(d => d[6] === B.joined.you.id);
ok(myDog() && myDog()[7] === 1, 'eigen hond in snapshot, naam ' + myDog()[9] + ', niveau ' + myDog()[8]);
ok(B.snap.d.filter(d => d[6] === 0).length === 2, 'getemde zwerfhond is uit de wilde lijst');
// volgen: speler loopt 20m weg
const px = st[1] + 1.5, pz = st[2];
for (let i = 0; i < 20; i++) { B.at(px + i, pz, Math.PI / 2); await sleep(100); }
await sleep(1500);
const dd = Math.hypot(myDog()[1] - (px + 19), myDog()[2] - pz);
ok(dd < 5 || myDog()[12] === 1, 'hond volgt de speler (jachthond mag even jagen; afstand ' + dd.toFixed(1) + ' m)');
// gevecht: wacht op golf, blijf staan, laat de hond vechten (speler slaat niet)
const home = { x: B.W.spawn.x, z: B.W.spawn.z };
B.at(home.x, home.z); await sleep(2500);
for (let i = 0; i < 80 && !(B.snap.w.ph === 1 && B.mons.length); i++) await sleep(250);
ok(B.snap.w.ph === 1, 'golf gestart met ' + B.mons.length + ' monsters');
const t0 = Date.now(); let dogHits = 0;
while (Date.now() - t0 < 60000 && B.mons.length) {
  // speler blijft in de buurt van het dichtstbijzijnde monster maar valt niet aan
  const m = B.mons.slice().sort((a, b) => Math.hypot(a[2] - home.x, a[3] - home.z) - Math.hypot(b[2] - home.x, b[3] - home.z))[0];
  B.at(m[2] + 6, m[3]); await sleep(400);
  dogHits = B.evs.filter(e => e.k === 'hit' && e.dog).length;
  if (dogHits > 12) break;
}
ok(dogHits > 0, 'hond valt monsters aan (' + dogHits + ' beten)');
const kills = B.evs.filter(e => e.k === 'mdie').length;
console.log('   monsters gedood (door de hond):', kills, 'hond:', JSON.stringify(B.inv.dog), 'hp', myDog()?.[4] + '/' + myDog()?.[5]);
ok(B.inv.dog.xp > 0 || B.inv.dog.level > 1, 'hond krijgt ervaring');
// opslag
B.send({ t: 'leave' }); await sleep(2200); await stop(); await start();
const tok3 = (await post('/api/login', { username: 'Baasje', password: 'geheim123' })).token;
const C = bot(tok3, b => b.send({ t: 'quick' }));
while (!C.joined || !C.snap) await sleep(50);
await sleep(300);
const cd = C.snap.d.find(d => d[6] === C.joined.you.id);
ok(cd && cd[9] === B.inv.dog.name, 'na herstart loopt ' + (cd && cd[9]) + ' (niveau ' + (cd && cd[8]) + ') meteen weer mee in een andere kamer');
C.send({ t: 'tame', id: C.snap.d.find(d => d[6] === 0)[0] }); await sleep(200);
await stop(); console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
