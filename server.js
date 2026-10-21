// Swordwoods multiplayer-server. Geen npm-dependencies: eigen WebSocket, accounts, lobby en statische bestanden.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Room, ensureSave, applyTalent, ensureDaily } from './room.js';
import { initStats, statsData, statsHtml } from './stats.js';
import { createStorage } from './storage.js';
import { handleAdmin } from './admin.js';
import { isBanned } from './moderation.js';

const scrypt = promisify(crypto.scrypt);
const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dir, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dir, 'data');
const PORT = Number(process.env.PORT) || 8304;
// Extra poorten voor het geval een deploy-platform de containerpoort zelf herschrijft
const EXTRA_PORTS = (process.env.EXTRA_PORTS ?? '8080,8787').split(',').map(Number).filter(p => p > 0 && p !== PORT);
const TICK_MS = 50;
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dir, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ opslag */
const STATS_KEY = process.env.STATS_KEY || '';
const storage = createStorage(DATA_DIR);
let db;
try { const r = storage.load({ users: {}, sessions: {} }); db = r.db; if (r.source !== 'db.json' && r.source !== 'nieuw') console.error('Database geladen uit ' + r.source); }
catch (e) { console.error(e.message); process.exit(1); }
db.balance = initStats(db.balance);
let saveTimer = null;
function flush() {
  clearTimeout(saveTimer); saveTimer = null;
  try { storage.save(db); } catch (e) { console.error('db schrijven mislukt:', e.message); }
}
function markDirty() { if (!saveTimer) saveTimer = setTimeout(flush, 1500); }
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
// dagelijkse back-up (bij de start en daarna elk uur controleren of het tijd is)
const doBackup = () => { try { flush(); storage.backup(); } catch (e) { console.error('back-up mislukt:', e.message); } };
setTimeout(doBackup, 5000).unref?.(); setInterval(doBackup, 3600 * 1000).unref?.();

/* ------------------------------------------------------------------ accounts */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const USER_RE = /^[A-Za-z0-9_-]{3,16}$/;
const SESSION_MS = 30 * 24 * 3600 * 1000;

async function hashPw(pw, salt) { return (await scrypt(pw, salt, 64)).toString('hex'); }
function newSession(key) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[sha(token)] = { u: key, exp: Date.now() + SESSION_MS };
  markDirty();
  return token;
}
function userByToken(token) {
  if (typeof token !== 'string') return null;
  const s = db.sessions[sha(token)];
  if (!s) return null;
  if (s.exp < Date.now()) { delete db.sessions[sha(token)]; return null; }
  const u = db.users[s.u];
  return u || null;
}
async function register(name, pw) {
  if (typeof name !== 'string' || !USER_RE.test(name)) return { err: 'Gebruikersnaam: 3-16 tekens (letters, cijfers, _ of -).' };
  if (typeof pw !== 'string' || pw.length < 6 || pw.length > 72) return { err: 'Wachtwoord: minimaal 6 tekens.' };
  const key = name.toLowerCase();
  if (db.users[key]) return { err: 'Die gebruikersnaam is al in gebruik.' };
  const salt = crypto.randomBytes(16).toString('hex');
  const u = { name, salt, hash: await hashPw(pw, salt), created: Date.now(), save: {} };
  if (db.users[key]) return { err: 'Die gebruikersnaam is al in gebruik.' };
  db.users[key] = u; ensureSave(u);
  return { token: newSession(key), name };
}
async function login(name, pw) {
  const key = typeof name === 'string' ? name.toLowerCase() : '';
  const u = db.users[key];
  const salt = u ? u.salt : 'x'.repeat(32);
  const h = await hashPw(typeof pw === 'string' ? pw.slice(0, 72) : '', salt);
  if (!u || !crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'))) return { err: 'Onjuiste gebruikersnaam of wachtwoord.' };
  if (isBanned(u)) return { err: 'Dit account is geblokkeerd door de beheerder.' + (u.mod.reason ? ' Reden: ' + u.mod.reason : '') };
  return { token: newSession(key), name: u.name };
}

const attempts = new Map();
function limited(ip) {
  const now = Date.now(), arr = (attempts.get(ip) || []).filter(t => now - t < 60000);
  arr.push(now); attempts.set(ip, arr);
  return arr.length > 15;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of attempts) if (!arr.some(t => now - t < 60000)) attempts.delete(ip);
  for (const [h, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[h];
}, 600000).unref();

function leaderboard() {
  return Object.values(db.users)
    .map(u => ({ name: u.name, bestWave: u.save?.stats?.bestWave | 0, score: u.save?.stats?.score | 0, kills: u.save?.stats?.kills | 0 }))
    .filter(x => x.score > 0 || x.bestWave > 0)
    .sort((a, b) => b.bestWave - a.bestWave || b.score - a.score).slice(0, 10);
}

/* ------------------------------------------------------------------ HTTP */
const MIME = { '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cache = new Map();
// Build-id: hash van alle spelbestanden. Staat in elk script-adres (/b/<id>/...), zodat een browser of proxy
// nooit oude spelcode kan combineren met een nieuwe server.
const BUILD = (() => {
  const h = crypto.createHash('sha256');
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (f === 'vendor') continue; if (fs.statSync(p).isDirectory()) walk(p); else h.update(f).update(fs.readFileSync(p)); } };
  try { walk(PUBLIC); } catch {}
  h.update(fs.readFileSync(path.join(__dir, 'room.js')));
  return h.digest('hex').slice(0, 10);
})();

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname), versioned = false;
  const vm = /^\/b\/([A-Za-z0-9]+)(\/.*)$/.exec(p);
  if (vm) { versioned = vm[1] === BUILD; p = vm[2]; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Niet gevonden'); return; }
    const ext = path.extname(file);
    const isHtml = ext === '.html';
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isHtml ? 'no-store, max-age=0' : (versioned || p.startsWith('/vendor/')) ? 'public, max-age=31536000, immutable' : 'no-store, max-age=0' };
    const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && ['.html', '.js', '.css', '.json', '.svg', '.glb'].includes(ext);
    const ck = file + (gz ? ':gz' : '');
    const hit = cache.get(ck);
    if (hit && hit.mtime === st.mtimeMs) { if (gz) headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers).end(hit.buf); return; }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(500).end(); return; }
      if (isHtml) buf = Buffer.from(buf.toString('utf8').replaceAll('__BUILD__', BUILD));
      if (gz) { buf = zlib.gzipSync(buf); headers['Content-Encoding'] = 'gzip'; }
      cache.set(ck, { mtime: st.mtimeMs, buf });
      res.writeHead(200, headers).end(buf);
    });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 4096) { reject(new Error('te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));

const onRequest = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/admin' || url.pathname.startsWith('/api/admin/')) {
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
      if (await handleAdmin(req, res, url, ip, { db, conns, byUser, rooms, storage, markDirty, flush, hashPw, json, readJson, version: VERSION, dataDir: DATA_DIR })) return;
    }
    if (req.method === 'POST' && url.pathname === '/api/password') {
      let body; try { body = await readJson(req); } catch { return json(res, 400, { err: 'Ongeldig verzoek.' }); }
      const u = userByToken(body.token);
      if (!u) return json(res, 401, { err: 'Log opnieuw in.' });
      if (limited('pw' + u.name)) return json(res, 429, { err: 'Te veel pogingen. Probeer het over een minuut opnieuw.' });
      const h = await hashPw(String(body.old || '').slice(0, 72), u.salt);
      if (!crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'))) return json(res, 400, { err: 'Je huidige wachtwoord klopt niet.' });
      const pw = String(body.pw || ''); if (pw.length < 6 || pw.length > 72) return json(res, 400, { err: 'Nieuw wachtwoord: minimaal 6 tekens.' });
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await hashPw(pw, u.salt); markDirty();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/stats') {
      if (STATS_KEY && url.searchParams.get('key') !== STATS_KEY) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Geef ?key=... mee (STATS_KEY).'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(statsHtml(VERSION));
    }
    if (url.pathname.startsWith('/api/')) {
      const ip = req.socket.remoteAddress || '?';
      if (req.method === 'GET' && url.pathname === '/api/stats') {
        if (STATS_KEY && url.searchParams.get('key') !== STATS_KEY) return json(res, 403, { err: 'Geef ?key=... mee (STATS_KEY).' });
        if (url.pathname === '/api/stats') return json(res, 200, statsData());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(statsHtml(VERSION));
      }
      if (req.method === 'GET' && url.pathname === '/api/leaderboard') return json(res, 200, leaderboard());
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, version: VERSION, build: BUILD, rooms: rooms.size, users: Object.keys(db.users).length, online: [...conns].filter(c => c.user).length, net: { kbIn: Math.round(netStats.raw / 1024), kbOut: Math.round(netStats.sent / 1024), sec: Math.round((Date.now() - netStats.since) / 1000) } });
      if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
        if (limited(ip + (req.headers['x-forwarded-for'] || ''))) return json(res, 429, { err: 'Te veel pogingen. Probeer het over een minuut opnieuw.' });
        let body; try { body = await readJson(req); } catch { return json(res, 400, { err: 'Ongeldig verzoek.' }); }
        const r = url.pathname === '/api/register' ? await register(body.username, body.password) : await login(body.username, body.password);
        return json(res, r.err ? 400 : 200, r);
      }
      return json(res, 404, { err: 'Onbekend' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    serveStatic(req, res);
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end(); }
};

/* ------------------------------------------------------------------ WebSocket (RFC 6455, minimaal) */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const conns = new Set();
const byUser = new Map();   // lowercase naam -> Conn

// permessage-deflate (RFC 7692) zonder gedeelde context: berichten worden los gecomprimeerd.
const DEFLATE_MIN = 160, TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const netStats = { raw: 0, sent: 0, since: Date.now() };
class Conn {
  constructor(sock, deflate = false) {
    this.deflate = deflate; this.rsv1 = false;
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = []; this.user = null; this.room = null; this.player = null;
    this.msgCount = 0; this.pongAt = Date.now(); this.closed = false;
    sock.setNoDelay(true);
    sock.on('data', d => this.onData(d));
    sock.on('close', () => this.onClose());
    sock.on('error', () => {});
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > (1 << 20)) return this.kill();
    let buf = this.buf;
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1], fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80), rsv1 = !!(b0 & 0x40);
      let n = b1 & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (n > 65536) return this.kill();
      const ml = masked ? 4 : 0;
      if (buf.length < off + ml + n) break;
      let payload = buf.subarray(off + ml, off + ml + n);
      if (masked) { const mk = buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i & 3]; }
      buf = buf.subarray(off + ml + n);
      if (op === 0x8) { this.kill(); return; }
      if (op === 0x9) { this.raw(0xA, payload); continue; }
      if (op === 0xA) { this.pongAt = Date.now(); continue; }
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) this.rsv1 = rsv1 && this.deflate;
        this.frag.push(payload);
        if (fin) {
          let data = Buffer.concat(this.frag); this.frag = [];
          if (this.rsv1) { try { data = zlib.inflateRawSync(Buffer.concat([data, TAIL]), { maxOutputLength: 1 << 20, finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return this.kill(); } }
          this.onMessage(data.toString('utf8'));
        }
      }
    }
    this.buf = buf;
  }
  raw(op, data, rsv = 0) {
    if (this.closed || this.sock.destroyed) return;
    let hdr; const b0 = 0x80 | rsv | op;
    if (data.length < 126) hdr = Buffer.from([b0, data.length]);
    else if (data.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = b0; hdr[1] = 126; hdr.writeUInt16BE(data.length, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = b0; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([hdr, data]));
    netStats.sent += hdr.length + data.length;
  }
  send(obj) {
    if (this.closed || this.sock.destroyed) return;
    if (this.sock.writableLength > 2e6) return;   // trage client: sla updates over
    let data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)); netStats.raw += data.length;
    if (this.deflate && data.length >= DEFLATE_MIN) {
      const z = zlib.deflateRawSync(data, { level: 4, memLevel: 7, finishFlush: zlib.constants.Z_SYNC_FLUSH });   // eindigt op 00 00 ff ff, dat laten we weg
      return this.raw(0x1, z.subarray(0, z.length - 4), 0x40);
    }
    this.raw(0x1, data);
  }
  kill() { if (!this.closed) { try { this.sock.destroy(); } catch {} } this.onClose(); }
  onClose() {
    if (this.closed) return; this.closed = true; conns.delete(this);
    this.leaveRoom();
    if (this.user && byUser.get(this.user.name.toLowerCase()) === this) byUser.delete(this.user.name.toLowerCase());
  }

  onMessage(text) {
    if (++this.msgCount > 400) return this.kill();   // tickt elke seconde terug (zie interval)
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'auth') {
      const u = userByToken(m.token);
      if (!u) return this.send({ t: 'authfail' });
      if (isBanned(u)) { this.send({ t: 'kicked', reason: 'Dit account is geblokkeerd.' }); return this.kill(); }
      u.lastSeen = Date.now();
      const key = u.name.toLowerCase(), old = byUser.get(key);
      if (old && old !== this) { old.send({ t: 'kicked' }); old.kill(); }
      this.user = u; byUser.set(key, this); ensureSave(u);
      if (m.build !== BUILD) {               // oude spelcode in de browser: niet laten spelen, wel uitleggen
        this.outdated = true;
        this.send({ t: 'outdated', build: BUILD });
        this.send({ t: 'authed', name: u.name, save: u.save, rooms: [] });
        return this.send({ t: 'err', msg: 'Er is een nieuwe versie van Swordwoods. Herlaad de pagina (F5, of op je telefoon omlaag trekken) om verder te spelen.' });
      }
      return this.send({ t: 'authed', name: u.name, save: u.save, rooms: roomList() });
    }
    if (!this.user) return;
    if (this.outdated) return this.send({ t: 'err', msg: 'Herlaad de pagina om de nieuwe versie te laden.' });
    if (this.room) {
      if (m.t === 'leave') return this.leaveRoom(true);
      if (this.player) this.room.handle(this.player, m);
      return;
    }
    switch (m.t) {
      case 'rooms': this.send({ t: 'rooms', rooms: roomList() }); break;
      case 'talent': { if (applyTalent(this.user.save, String(m.id))) { markDirty(); } this.send({ t: 'save', save: this.user.save }); break; }
      case 'look': { const l = m.v | 0; if (l >= 0 && l <= 3) { this.user.save.look = l; markDirty(); this.send({ t: 'look', v: l }); } break; }
      case 'create': {
        if (rooms.size >= 24) return this.send({ t: 'err', msg: 'Er zijn al te veel kamers. Kies een bestaande.' });
        let name = String(m.name || '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 24) || (this.user.name + 's bos');
        const max = Math.min(8, Math.max(1, m.max | 0 || 4));
        const room = makeRoom(name, max, false);
        this.joinRoom(room); break;
      }
      case 'join': { const r = rooms.get(m.id | 0); if (r) this.joinRoom(r); else this.send({ t: 'err', msg: 'Die kamer bestaat niet meer.' }); break; }
      case 'quick': {
        const cand = [...rooms.values()].filter(r => r.players.size < r.max).sort((a, b) => b.players.size - a.players.size)[0];
        this.joinRoom(cand || makeRoom(this.user.name + 's bos', 4, false)); break;
      }
    }
  }
  joinRoom(room) {
    if (room.players.size >= room.max) return this.send({ t: 'err', msg: 'Deze kamer is vol.' });
    this.room = room; this.player = room.addPlayer(this);
  }
  leaveRoom(notify = false) {
    if (!this.room) return;
    const room = this.room; const P = this.player;
    this.room = null; this.player = null;
    if (P) room.removePlayer(P);
    if (this.user) this.user.lastSeen = Date.now();
    if (notify && !this.closed) { ensureDaily(this.user); this.send({ t: 'left', save: this.user.save, rooms: roomList() }); }
  }
}

const onUpgrade = (req, socket) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const deflate = /permessage-deflate/i.test(req.headers['sec-websocket-extensions'] || '') && process.env.WS_DEFLATE !== '0';
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n' +
    (deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '') + '\r\n');
  conns.add(new Conn(socket, deflate));
};

setInterval(() => {
  const now = Date.now();
  for (const c of conns) {
    c.msgCount = 0;
    if (now - c.pongAt > 60000) { c.kill(); continue; }
    c.raw(0x9, Buffer.alloc(0));
  }
}, 1000 * 20).unref?.();
setInterval(() => { for (const c of conns) c.msgCount = 0; }, 1000);

/* ------------------------------------------------------------------ kamers en lobby */
const rooms = new Map();
let nextRoomId = 1;
function makeRoom(name, max, permanent) {
  let store = null;
  if (permanent) { db.rooms = db.rooms && typeof db.rooms === 'object' ? db.rooms : {}; store = db.rooms[name] || (db.rooms[name] = {}); }
  const r = new Room(nextRoomId++, name, max, permanent, markDirty, store);
  rooms.set(r.id, r); broadcastRooms();
  return r;
}
const roomList = () => [...rooms.values()].map(r => r.summary);
function broadcastRooms() {
  const msg = JSON.stringify({ t: 'rooms', rooms: roomList() });
  for (const c of conns) if (c.user && !c.room && !c.outdated) c.send(msg);
}
makeRoom('Bos van Aldric', 8, true);
makeRoom('Zwaardenwoud', 8, true);

let last = process.hrtime.bigint(), lobbyT = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.2, Number(now - last) / 1e9); last = now;
  for (const r of rooms.values()) {
    if (r.players.size) r.update(dt);
    else if (r.emptySince && Date.now() - r.emptySince > 45000) {
      if (r.permanent) { r.reset(); } else { rooms.delete(r.id); broadcastRooms(); }
    }
  }
  lobbyT += dt;
  if (lobbyT >= 2) { lobbyT = 0; broadcastRooms(); }
}, TICK_MS);

function listen(port, main) {
  const srv = http.createServer(onRequest);
  srv.on('upgrade', onUpgrade);
  srv.on('error', e => { if (main) { console.error('Kan niet luisteren op poort ' + port + ': ' + e.message); process.exit(1); } });
  srv.listen(port, () => console.log('Swordwoods ' + VERSION + ' (build ' + BUILD + ') luistert op poort ' + port + (main ? ' (data: ' + DATA_DIR + ')' : ' (extra)')));
}
listen(PORT, true);
for (const p of EXTRA_PORTS) listen(p, false);
setInterval(markDirty, 60000).unref?.();
