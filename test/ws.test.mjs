// WebSocket-compressie (permessage-deflate) zoals een browser het doet: de client comprimeert ook zijn eigen berichten.
import net from 'node:net';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ROOT, tmpData } from './helpers.mjs';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PORT = 8132, DATA = tmpData('ws'); fs.rmSync(DATA, { recursive: true, force: true });
const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise(r => srv.stdout.on('data', d => String(d).includes('luistert') && r()));
const BUILD = (await (await fetch('http://localhost:' + PORT + '/api/health')).json()).build;
const reg = await (await fetch('http://localhost:' + PORT + '/api/register', { method: 'POST', body: JSON.stringify({ username: 'Zipper', password: 'abcdef1' }) })).json();
const TAIL = Buffer.from([0, 0, 0xff, 0xff]);
const sock = net.connect(PORT, 'localhost');
let buf = Buffer.alloc(0), headers = null; const msgs = [];
sock.on('data', d => {
  buf = Buffer.concat([buf, d]);
  if (!headers) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; headers = buf.subarray(0, i).toString(); buf = buf.subarray(i + 4); }
  while (buf.length >= 2) {
    let n = buf[1] & 0x7f, off = 2; if (n === 126) { n = buf.readUInt16BE(2); off = 4; } else if (n === 127) { n = Number(buf.readBigUInt64BE(2)); off = 10; }
    if (buf.length < off + n) break;
    let p = buf.subarray(off, off + n); const rsv1 = buf[0] & 0x40, op = buf[0] & 0x0f; buf = buf.subarray(off + n);
    if (op !== 1) continue;
    if (rsv1) p = zlib.inflateRawSync(Buffer.concat([p, TAIL]), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    msgs.push({ z: !!rsv1, m: JSON.parse(p.toString()) });
  }
});
sock.write('GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') +
  '\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n');
const sendZ = obj => {   // gecomprimeerd en gemaskeerd, zoals Chrome
  const z = zlib.deflateRawSync(Buffer.from(JSON.stringify(obj)), { finishFlush: zlib.constants.Z_SYNC_FLUSH }), p = Buffer.from(z.subarray(0, z.length - 4)), mk = crypto.randomBytes(4);
  for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
  sock.write(Buffer.concat([Buffer.from([0xC1, 0x80 | p.length]), mk, p]));
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(300);
ok(/permessage-deflate/.test(headers || ''), 'server spreekt compressie af');
sendZ({ t: 'auth', build: BUILD, token: reg.token }); await sleep(500);
const authed = msgs.find(x => x.m.t === 'authed');
ok(!!authed, 'gecomprimeerd bericht van de client wordt begrepen');
ok(authed && authed.z, 'grote berichten van de server zijn gecomprimeerd');
sendZ({ t: 'join', id: 1 }); await sleep(1500);
const snaps = msgs.filter(x => x.m.t === 's');
ok(snaps.length >= 5 && snaps.some(x => x.m.f === 1) && snaps.some(x => x.m.f === 0), snaps.length + ' snapshots, vol en tussendoor');
const me = msgs.find(x => x.m.t === 'joined').m.you;
const far = snaps.flatMap(x => x.m.a).filter(a => Math.hypot(a[2] - me.x, a[3] - me.z) > 101);
ok(!far.length, 'geen dieren van ver weg in de snapshots');
sock.destroy(); srv.kill();
console.log(fails ? fails + ' MISLUKT' : 'ALLES GESLAAGD'); process.exit(fails ? 1 : 0);
