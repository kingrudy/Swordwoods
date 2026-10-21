import { ROOT, tmpData } from './helpers.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PORT = 8125, sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA = tmpData('chat');
fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, FIRST_WAVE_DELAY: 999 }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r()));
const BUILD = (await (await fetch('http://localhost:' + PORT + '/api/health')).json()).build;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function bot(name) {
  const j = await (await fetch('http://localhost:' + PORT + '/api/register', { method: 'POST', body: JSON.stringify({ username: name, password: 'abcdef1' }) })).json();
  const b = { msgs: [], ws: new WebSocket('ws://localhost:' + PORT + '/ws') };
  b.send = m => b.ws.send(JSON.stringify(m));
  b.ws.onopen = () => b.send({ t: 'auth', build: BUILD, token: j.token });
  b.ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 'authed') b.send({ t: 'join', id: 1 }); if (m.t === 'joined') b.joined = m; if (m.t !== 's') b.msgs.push(m); else b.snap = m; };
  for (let i = 0; i < 50 && !b.joined; i++) await sleep(100);
  return b;
}
const a = await bot('Anna'), c = await bot('Cas');
ok(a.joined && c.joined, 'beide in kamer 1');
a.send({ t: 'chat', text: 'Hallo\u0007 allemaal!', ping: true });
await sleep(400);
const got = c.msgs.find(m => m.t === 'chat');
ok(got && got.text === 'Hallo allemaal!' && got.name === 'Anna' && got.ping && typeof got.ping.x === 'number', 'chat met ping komt aan bij de ander: ' + JSON.stringify(got));
a.send({ t: 'chat', text: 'spam' }); await sleep(300);
ok(c.msgs.filter(m => m.t === 'chat').length === 1, 'tweede bericht binnen 0,8 s wordt genegeerd');
await sleep(700); a.send({ t: 'chat', text: 'x'.repeat(500) }); await sleep(300);
const long = c.msgs.filter(m => m.t === 'chat').pop(); ok(long.text.length === 140, 'bericht ingekort tot 140 tekens');
// snelheidscontrole: teleport 80 m
const sx = a.joined.you.x, sz = a.joined.you.z;
a.send({ t: 'in', x: sx + 0.5, y: a.joined.you.y, z: sz, yaw: 0, pitch: 0 }); await sleep(200);
a.send({ t: 'in', x: sx + 80, y: a.joined.you.y, z: sz, yaw: 0, pitch: 0 }); await sleep(300);
const cor = a.msgs.find(m => m.t === 'correct');
ok(cor && Math.abs(cor.x - sx) < 3, 'teleport wordt teruggezet: ' + JSON.stringify(cor));
const me = c.snap.p.find(p => p[0] === a.joined.you.id);
ok(me && Math.abs(me[1] - sx) < 3, 'anderen zien geen teleport');
// gewoon lopen mag
let x = sx; for (let i = 0; i < 10; i++) { x += 0.55; a.send({ t: 'in', x, y: a.joined.you.y, z: sz, yaw: 0, pitch: 0 }); await sleep(66); }
await sleep(300); const me2 = c.snap.p.find(p => p[0] === a.joined.you.id);
ok(me2 && Math.abs(me2[1] - x) < 0.6, 'normaal lopen wordt geaccepteerd (' + me2[1] + ' ~ ' + x.toFixed(2) + ')');
srv.kill(); console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
