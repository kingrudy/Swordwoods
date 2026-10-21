// Opslag: back-ups, herstel van een kapotte db.json, en de server start daarmee gewoon op.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { ROOT, tmpData } from './helpers.mjs';
import { createStorage } from '../storage.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const dir = tmpData('storage'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
const quiet = { log() {}, error() {} };
const st = createStorage(dir, { keep: 3, log: quiet });
ok(st.load({ users: {} }).source === 'nieuw', 'lege map: nieuwe database');
st.save({ users: { anna: { name: 'Anna' } } });
ok(JSON.parse(fs.readFileSync(path.join(dir, 'db.json'))).users.anna, 'opgeslagen');
const b1 = st.backup(); ok(b1 && st.backup() === null, 'back-up gemaakt, niet twee keer per dag');
for (let i = 0; i < 4; i++) st.backup(true);
ok(st.backups().length === 3, 'alleen de laatste 3 bewaard');
ok(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(st.dir, st.backups()[2])))).users.anna, 'back-up is leesbaar');
fs.writeFileSync(path.join(dir, 'db.json'), '{"users": {"anna": KAPOT');
const r = st.load({ users: {} });
ok(r.db.users.anna && r.source.startsWith('db-'), 'kapotte db.json: hersteld uit ' + r.source);
ok(fs.readdirSync(dir).some(f => f.startsWith('db.json.kapot-')), 'kapotte versie apart bewaard');
// zonder back-ups: niet stilletjes leeg beginnen
const dir2 = tmpData('storage2'); fs.rmSync(dir2, { recursive: true, force: true }); fs.mkdirSync(dir2, { recursive: true });
fs.writeFileSync(path.join(dir2, 'db.json'), 'onzin');
let threw = false; try { createStorage(dir2, { log: quiet }).load({ users: {} }); } catch { threw = true; }
ok(threw, 'kapot en geen back-up: weigert te starten in plaats van alles te wissen');
// de echte server start met een herstelde database
fs.writeFileSync(path.join(dir, 'db.json'), 'kapot');
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: 8131, EXTRA_PORTS: '', DATA_DIR: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
await new Promise(r => { const t = setInterval(() => { if (out.includes('luistert')) { clearInterval(t); r(); } }, 100); setTimeout(r, 6000); });
const h = await (await fetch('http://localhost:8131/api/health')).json().catch(() => null);
ok(h && h.users === 1 && /Hersteld uit back-up/.test(out), 'server start met herstelde gebruikers (' + (h && h.users) + ')');
srv.kill();
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
