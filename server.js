// Swordwoods multiplayer-server. Geen npm-dependencies: eigen WebSocket, accounts, lobby en statische bestanden.
// Hier staat de bedrading: opslag, HTTP-routes, het berichtenprotocol per verbinding, de lobby en de hoofdlus.
// Onderdelen: accounts.js, web.js (bestanden en JSON), ws.js (WebSocket), room.js + room/*.js (het spel zelf),
// storage.js (db.json en back-ups), admin.js, moderation.js, stats.js en week.js.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, ensureSave, applyTalent, ensureDaily, claimLogin } from './room.js';
import { initStats, statsData, statsHtml } from './stats.js';
import { createStorage } from './storage.js';
import { handleAdmin } from './admin.js';
import { isBanned } from './moderation.js';
import { createWeekly } from './week.js';
import { createAccounts, hashPw } from './accounts.js';
import { buildId, createStatic, readJson, json, html, clientIp } from './web.js';
import { WsConn, acceptUpgrade, heartbeat, netStats } from './ws.js';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dir, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dir, 'data');
const PORT = Number(process.env.PORT) || 8304;
// Extra poorten voor het geval een deploy-platform de containerpoort zelf herschrijft
const EXTRA_PORTS = (process.env.EXTRA_PORTS ?? '8080,8787').split(',').map(Number).filter(p => p > 0 && p !== PORT);
const TICK_MS = 50;
const STATS_KEY = process.env.STATS_KEY || '';
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dir, 'package.json'), 'utf8')).version; } catch { return '?'; } })();
const BUILD = buildId(PUBLIC, [path.join(__dir, 'room.js'), path.join(__dir, 'room')]);
fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ opslag */
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
setInterval(markDirty, 60000).unref?.();
// dagelijkse back-up (bij de start en daarna elk uur controleren of het tijd is)
const doBackup = () => { try { flush(); storage.backup(); } catch (e) { console.error('back-up mislukt:', e.message); } };
setTimeout(doBackup, 5000).unref?.(); setInterval(doBackup, 3600 * 1000).unref?.();

const accounts = createAccounts({ db, markDirty });

/* ------------------------------------------------------------------ HTTP */
const serveStatic = createStatic(PUBLIC, BUILD);
const statsAllowed = url => !STATS_KEY || url.searchParams.get('key') === STATS_KEY;
const health = () => ({
  ok: true, version: VERSION, build: BUILD, rooms: rooms.size, users: Object.keys(db.users).length, online: [...conns].filter(c => c.user).length,
  net: { kbIn: Math.round(netStats.raw / 1024), kbOut: Math.round(netStats.sent / 1024), sec: Math.round((Date.now() - netStats.since) / 1000) },
});

async function onRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://x'), p = url.pathname, method = req.method;
    if (p === '/admin' || p.startsWith('/api/admin/')) {
      if (await handleAdmin(req, res, url, clientIp(req), { db, conns, byUser, rooms, storage, markDirty, flush, hashPw, json, readJson, version: VERSION, dataDir: DATA_DIR })) return;
    }
    if (method === 'GET' && p === '/stats') {
      if (!statsAllowed(url)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Geef ?key=... mee (STATS_KEY).'); }
      return html(res, 200, statsHtml(VERSION));
    }
    if (!p.startsWith('/api/')) {
      if (method !== 'GET' && method !== 'HEAD') { res.writeHead(405).end(); return; }
      return serveStatic(req, res);
    }
    if (method === 'GET') {
      if (p === '/api/health') return json(res, 200, health());
      if (p === '/api/leaderboard') return json(res, 200, { all: accounts.leaderboard(), week: weekly.board() });
      if (p === '/api/stats') return statsAllowed(url) ? json(res, 200, statsData()) : json(res, 403, { err: 'Geef ?key=... mee (STATS_KEY).' });
    }
    if (method === 'POST' && (p === '/api/register' || p === '/api/login' || p === '/api/password')) {
      if (p !== '/api/password' && accounts.limited((req.socket.remoteAddress || '?') + (req.headers['x-forwarded-for'] || ''))) return json(res, 429, { err: 'Te veel pogingen. Probeer het over een minuut opnieuw.' });
      let body; try { body = await readJson(req); } catch { return json(res, 400, { err: 'Ongeldig verzoek.' }); }
      if (p === '/api/password') { const r = await accounts.changePassword(body.token, body.old, body.pw); return json(res, r.code, r.err ? { err: r.err } : { ok: true }); }
      const r = p === '/api/register' ? await accounts.register(body.username, body.password) : await accounts.login(body.username, body.password);
      return json(res, r.err ? 400 : 200, r);
    }
    return json(res, 404, { err: 'Onbekend' });
  } catch (e) { console.error(e); if (!res.headersSent) res.writeHead(500).end(); }
}

/* ------------------------------------------------------------------ verbindingen: inloggen, lobby en doorgeven aan de kamer */
const conns = new Set();
const byUser = new Map();   // lowercase naam -> Client
class Client extends WsConn {
  constructor(sock, deflate) { super(sock, deflate); this.user = null; this.room = null; this.player = null; }
  onDisconnect() {
    conns.delete(this);
    this.leaveRoom();
    if (this.user && byUser.get(this.user.name.toLowerCase()) === this) byUser.delete(this.user.name.toLowerCase());
  }
  onMessage(text) {
    let m; try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'auth') return this.auth(m);
    if (!this.user) return;
    if (this.outdated) return this.send({ t: 'err', msg: 'Herlaad de pagina om de nieuwe versie te laden.' });
    if (this.room) {
      if (m.t === 'leave') return this.leaveRoom(true);
      if (this.player) this.room.handle(this.player, m);
      return;
    }
    this.lobby(m);
  }
  auth(m) {
    const u = accounts.userByToken(m.token);
    if (!u) return this.send({ t: 'authfail' });
    if (isBanned(u)) { this.send({ t: 'kicked', reason: 'Dit account is geblokkeerd.' }); return this.kill(); }
    u.lastSeen = Date.now();
    const key = u.name.toLowerCase(), old = byUser.get(key);
    if (old && old !== this) { old.send({ t: 'kicked' }); old.kill(); }   // op een ander apparaat ingelogd: de oude verbinding eruit
    this.user = u; byUser.set(key, this); ensureSave(u);
    if (m.build !== BUILD) {               // oude spelcode in de browser: niet laten spelen, wel uitleggen
      this.outdated = true;
      this.send({ t: 'outdated', build: BUILD });
      this.send({ t: 'authed', name: u.name, save: u.save, rooms: [] });
      return this.send({ t: 'err', msg: 'Er is een nieuwe versie van Swordwoods. Herlaad de pagina (F5, of op je telefoon omlaag trekken) om verder te spelen.' });
    }
    const login = claimLogin(u); if (login) markDirty();
    this.send({ t: 'authed', name: u.name, save: u.save, rooms: roomList(), login });
  }
  lobby(m) {
    const s = this.user.save;
    switch (m.t) {
      case 'rooms': this.send({ t: 'rooms', rooms: roomList() }); break;
      case 'talent': if (applyTalent(s, String(m.id))) markDirty(); this.send({ t: 'save', save: s }); break;
      case 'look': { const l = m.v | 0; if (l >= 0 && l <= 3) { s.look = l; markDirty(); this.send({ t: 'look', v: l }); } break; }
      case 'create': {
        if (rooms.size >= 24) return this.send({ t: 'err', msg: 'Er zijn al te veel kamers. Kies een bestaande.' });
        const name = String(m.name || '').replace(/[^\p{L}\p{N} _'-]/gu, '').trim().slice(0, 24) || (this.user.name + 's bos');
        this.joinRoom(makeRoom(name, Math.min(8, Math.max(1, m.max | 0 || 4)), false)); break;
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
    const room = this.room, P = this.player;
    this.room = null; this.player = null;
    if (P) room.removePlayer(P);
    if (this.user) this.user.lastSeen = Date.now();
    if (notify && !this.closed) { ensureDaily(this.user); this.send({ t: 'left', save: this.user.save, rooms: roomList() }); }
  }
}
function onUpgrade(req, socket) { const c = acceptUpgrade(req, socket, Client); if (c) conns.add(c); }
heartbeat(conns);

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
const weekly = createWeekly({ db, rooms, markDirty });
weekly.tick(); setInterval(weekly.tick, 60000).unref?.();

/* ------------------------------------------------------------------ hoofdlus (20x per seconde) */
let last = process.hrtime.bigint(), lobbyT = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  const dt = Math.min(0.2, Number(now - last) / 1e9); last = now;
  for (const r of rooms.values()) {
    if (r.players.size) r.update(dt);
    else if (r.emptySince && Date.now() - r.emptySince > 45000) {       // lege kamer: vaste kamers opnieuw beginnen, eigen kamers opruimen
      if (r.permanent) r.reset(); else { rooms.delete(r.id); broadcastRooms(); }
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
