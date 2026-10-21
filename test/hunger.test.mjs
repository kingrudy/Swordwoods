import { ROOT, tmpData } from './helpers.mjs';
import { spawn } from 'node:child_process';
const PORT = 8124, sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA = tmpData('hunger');
import fs from 'node:fs'; fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, MAX_SPEED: 99999, HUNGER_RATE: 25, FIRST_WAVE_DELAY: 999 }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r())); globalThis.BUILD = (await (await fetch('http://localhost:' + PORT + '/api/health')).json()).build;
const j = await (await fetch('http://localhost:' + PORT + '/api/register', { method: 'POST', body: JSON.stringify({ username: 'Hongerig', password: 'abcdef1' }) })).json();
const ws = new WebSocket('ws://localhost:' + PORT + '/ws'); const log = []; let snap;
ws.onopen = () => ws.send(JSON.stringify({ t: 'auth', build: globalThis.BUILD, token: j.token }));
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.t === 's') snap = m; else if (m.t === 'authed') ws.send(JSON.stringify({ t: 'quick' })); else log.push(m.t + (m.in ? ':' + m.in : '')); };
await sleep(1500); const hu = [], hp = [];
for (let i = 0; i < 14; i++) { hu.push(snap.y.hu); hp.push(snap.y.hp); await sleep(1000); }
console.log('honger:', hu.join(' ')); console.log('hp    :', hp.join(' ')); console.log('berichten:', [...new Set(log)].join(', '));
const starved = hp[hp.length - 1] < 100 && hu[hu.length - 1] === 0;
console.log(starved ? 'PASS verhongering doet schade' : 'FAIL'); srv.kill(); process.exit(starved ? 0 : 1);
