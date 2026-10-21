// Beheer: /admin (pagina) en /api/admin/* (JSON). Alleen met ADMIN_KEY (omgevingsvariabele).
// Spelers dempen, uit het spel zetten, verbannen, wachtwoord resetten, aankondigingen, chatlog en back-ups.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { modOf, mutedUntil, recentChat } from './moderation.js';
import { levelInfo } from './public/progress.js';

const KEY = process.env.ADMIN_KEY || '';
const fails = new Map();   // ip -> [tijden]

function keyOk(req, ip) {
  if (!KEY) return false;
  const now = Date.now(), arr = (fails.get(ip) || []).filter(t => now - t < 10 * 60000);
  if (arr.length >= 10) return false;                      // te veel foute pogingen: 10 minuten pauze
  const given = Buffer.from(String(req.headers['x-admin-key'] || '')), want = Buffer.from(KEY);
  const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
  if (!ok) { arr.push(now); fails.set(ip, arr); }
  return ok;
}

/**
 * ctx: { db, conns, byUser, rooms, storage, markDirty, flush, hashPw, json, readJson, version }
 * Geeft true als het verzoek is afgehandeld.
 */
export async function handleAdmin(req, res, url, ip, ctx) {
  if (url.pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    res.end(PAGE.replace('__ENABLED__', KEY ? '1' : '0')); return true;
  }
  if (!url.pathname.startsWith('/api/admin/')) return false;
  const { db, conns, byUser, rooms, json } = ctx;
  if (!KEY) return json(res, 403, { err: 'Beheer staat uit. Zet ADMIN_KEY in de omgevingsvariabelen van de container.' }), true;
  if (!keyOk(req, ip)) return json(res, 401, { err: 'Onjuiste beheersleutel.' }), true;
  const what = url.pathname.slice('/api/admin/'.length);

  if (req.method === 'GET' && what === 'overview') {
    const online = new Map(); for (const c of conns) if (c.user) online.set(c.user.name.toLowerCase(), c.room ? c.room.name : 'lobby');
    const users = Object.entries(db.users).map(([k, u]) => {
      const s = u.save || {}, st = s.stats || {}, m = u.mod || {};
      return { key: k, name: u.name, created: u.created || 0, lastSeen: u.lastSeen || 0, online: online.get(k) || null, level: levelInfo(s.xp | 0).level,
        bestWave: st.bestWave | 0, playMin: Math.round((st.playSec | 0) / 60), wood: s.wood | 0, gold: s.gold | 0,
        mutedUntil: mutedUntil(u), banned: !!m.banned, reason: m.reason || '' };
    }).sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || b.lastSeen - a.lastSeen);
    const roomsOut = [...rooms.values()].map(r => ({ id: r.id, name: r.name, players: [...r.players.values()].map(p => p.name), wave: r.wave.n, perm: r.permanent, seed: r.seed }));
    return json(res, 200, { version: ctx.version, users, rooms: roomsOut, chat: recentChat().slice(-150), backups: ctx.storage.backups().reverse(), reports: (db.reports || []).slice(-50).reverse() }), true;
  }
  if (req.method === 'GET' && what === 'backup') {
    ctx.flush();
    const data = fs.readFileSync(path.join(ctx.dataDir, 'db.json'));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="swordwoods-db-' + new Date().toISOString().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' });
    res.end(data); return true;
  }
  if (req.method !== 'POST') return json(res, 404, { err: 'Onbekend' }), true;
  let body; try { body = await ctx.readJson(req); } catch { return json(res, 400, { err: 'Ongeldig verzoek.' }), true; }

  if (what === 'announce') {
    const text = String(body.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 200);
    if (!text) return json(res, 400, { err: 'Lege tekst.' }), true;
    for (const c of conns) if (c.user) c.send({ t: 'announce', text });
    return json(res, 200, { ok: true, sent: [...conns].filter(c => c.user).length }), true;
  }
  if (what === 'backup-now') { ctx.flush(); const name = ctx.storage.backup(true); return json(res, 200, { ok: true, name }), true; }

  // acties op één speler
  const key = String(body.user || '').toLowerCase(), u = db.users[key];
  if (!u) return json(res, 404, { err: 'Speler bestaat niet.' }), true;
  const m = modOf(u), conn = byUser.get(key), reason = String(body.reason || '').slice(0, 120);
  const kick = msg => { if (conn) { conn.send({ t: 'kicked', reason: msg }); conn.kill(); } };
  const dropSessions = () => { for (const [h, s] of Object.entries(db.sessions)) if (s.u === key) delete db.sessions[h]; };
  let out = { ok: true };
  switch (what) {
    case 'mute': {
      const min = Math.max(1, Math.min(60 * 24 * 30, Number(body.minutes) || 60));
      m.mutedUntil = Date.now() + min * 60000; m.reason = reason;
      if (conn) conn.send({ t: 'toast', msg: 'Je bent door de beheerder gedempt voor ' + min + ' minuten.' + (reason ? ' Reden: ' + reason : ''), color: '#ff9c8a' });
      break;
    }
    case 'unmute': m.mutedUntil = 0; break;
    case 'kick': kick('Je bent door de beheerder uit het spel gezet.' + (reason ? ' Reden: ' + reason : '')); break;
    case 'ban': m.banned = true; m.reason = reason; dropSessions(); kick('Je account is geblokkeerd.' + (reason ? ' Reden: ' + reason : '')); break;
    case 'unban': m.banned = false; break;
    case 'resetpw': {
      const pw = crypto.randomBytes(6).toString('base64').replace(/[+/=]/g, 'x').slice(0, 8);
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await ctx.hashPw(pw, u.salt);
      dropSessions(); kick('Je wachtwoord is door de beheerder gewijzigd. Log opnieuw in.');
      out = { ok: true, password: pw };
      break;
    }
    default: return json(res, 404, { err: 'Onbekende actie.' }), true;
  }
  ctx.markDirty();
  return json(res, 200, out), true;
}

const PAGE = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Swordwoods · beheer</title><style>
:root{--bg:#0e1a12;--card:#16241a;--line:#2a3d2e;--ink:#e8efe6;--dim:#9fb0a0;--gold:#f2c14e;--red:#ff8a7a;--green:#6fd37a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px system-ui,sans-serif;padding:16px}
h1{margin:0 0 4px;font-size:22px}h2{font-size:16px;margin:0 0 10px}p{color:var(--dim);margin:0 0 12px}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:12px 0;max-width:1100px}
input,button,select{font:inherit;border-radius:9px;border:1px solid var(--line);background:#0b140e;color:var(--ink);padding:7px 10px}
button{cursor:pointer;background:#22382a}button.gold{background:var(--gold);color:#2b2110;border:0;font-weight:700}button.red{background:#5a2522}
table{width:100%;border-collapse:collapse}td,th{padding:6px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--dim);font-weight:600;font-size:12px}
.on{color:var(--green)}.tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;margin-left:4px}.tag.m{background:#5a4a22}.tag.b{background:#5a2522}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.chat{max-height:300px;overflow:auto;font-size:13px}.chat div{padding:2px 0;border-bottom:1px solid #1d2e22}
.t{color:var(--dim);font-size:12px}#msg{min-height:20px;color:var(--gold)}.scroll{overflow-x:auto}
</style></head><body>
<h1>Swordwoods · beheer</h1><p id="ver"></p>
<section id="login"><h2>Inloggen</h2><p id="off" hidden>Beheer staat uit: zet <code>ADMIN_KEY=een-lang-geheim</code> in de omgevingsvariabelen van de container en herstart.</p>
<div class="row"><input id="key" type="password" placeholder="Beheersleutel (ADMIN_KEY)" autocomplete="current-password"><button class="gold" id="go">Open</button></div></section>
<div id="app" hidden>
<p id="msg"></p>
<section><h2>Aankondiging aan iedereen die online is</h2><div class="row"><input id="ann" maxlength="200" style="flex:1;min-width:220px" placeholder="Bijvoorbeeld: Over 5 minuten herstart de server"><button class="gold" id="annGo">Versturen</button></div></section>
<section><h2>Spelers</h2><div class="row" style="margin-bottom:8px"><input id="q" placeholder="Zoek op naam"><label class="t"><input type="checkbox" id="onlyOn"> alleen online</label></div><div class="scroll"><table id="users"></table></div></section>
<section><h2>Kamers</h2><table id="rooms"></table></section>
<section><h2>Chat (laatste berichten)</h2><div class="chat" id="chat"></div></section>
<section><h2>Back-ups</h2><p>Elke dag automatisch, 7 dagen bewaard in <code>/data/backups</code>.</p><div class="row"><button id="bkNow">Nu een back-up maken</button><button id="bkDl">Huidige database downloaden</button></div><p id="bks" class="t" style="margin-top:8px"></p></section>
</div>
<script>
const enabled = '__ENABLED__' === '1'; let KEY = ''; try { KEY = sessionStorage.getItem('sw-admin') || ''; } catch {}
const $ = id => document.getElementById(id), esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = t => t ? new Date(t).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) : '–';
if (!enabled) { $('off').hidden = false; $('go').disabled = true; }
async function api(p, body) {
  const r = await fetch('/api/admin/' + p, { method: body ? 'POST' : 'GET', headers: { 'X-Admin-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.err || r.status); return j;
}
let data = null;
async function load() {
  try { data = await api('overview'); } catch (e) { $('msg').textContent = e.message; if (/sleutel/.test(e.message)) { $('app').hidden = true; $('login').hidden = false; } return; }
  $('login').hidden = true; $('app').hidden = false; $('ver').textContent = 'Versie ' + data.version + ' · ' + data.users.length + ' spelers · ' + data.users.filter(u => u.online).length + ' online';
  render();
}
function render() {
  const q = $('q').value.toLowerCase(), only = $('onlyOn').checked;
  $('users').innerHTML = '<tr><th>Naam</th><th>Waar</th><th>Niveau</th><th>Beste golf</th><th>Speeltijd</th><th>Laatst gezien</th><th>Acties</th></tr>' +
    data.users.filter(u => u.key.includes(q) && (!only || u.online)).slice(0, 300).map(u => '<tr><td><b>' + esc(u.name) + '</b>' + (u.mutedUntil ? '<span class="tag m">gedempt tot ' + when(u.mutedUntil) + '</span>' : '') + (u.banned ? '<span class="tag b">geblokkeerd</span>' : '') + (u.reason ? '<div class="t">' + esc(u.reason) + '</div>' : '') + '</td>' +
      '<td>' + (u.online ? '<span class="on">● ' + esc(u.online) + '</span>' : '<span class="t">offline</span>') + '</td><td>' + u.level + '</td><td>' + u.bestWave + '</td><td>' + u.playMin + ' min</td><td class="t">' + when(u.lastSeen) + '</td>' +
      '<td><div class="row"><select data-u="' + u.key + '"><option value="">Kies…</option><option value="mute:15">Dempen 15 min</option><option value="mute:60">Dempen 1 uur</option><option value="mute:1440">Dempen 1 dag</option>' +
      (u.mutedUntil ? '<option value="unmute">Niet meer dempen</option>' : '') + (u.online ? '<option value="kick">Uit het spel zetten</option>' : '') +
      (u.banned ? '<option value="unban">Blokkade opheffen</option>' : '<option value="ban">Blokkeren</option>') + '<option value="resetpw">Nieuw wachtwoord</option></select></div></td></tr>').join('');
  $('rooms').innerHTML = '<tr><th>Kamer</th><th>Spelers</th><th>Golf</th><th>Seed</th></tr>' + data.rooms.map(r => '<tr><td>' + esc(r.name) + (r.perm ? ' <span class="t">(vast)</span>' : '') + '</td><td>' + (r.players.map(esc).join(', ') || '<span class="t">leeg</span>') + '</td><td>' + r.wave + '</td><td class="t">' + r.seed + '</td></tr>').join('');
  $('chat').innerHTML = data.chat.slice().reverse().map(c => '<div><span class="t">' + when(c.at) + ' · ' + esc(c.room) + '</span> <b>' + esc(c.name) + '</b> ' + esc(c.text) + '</div>').join('') || '<span class="t">Nog niets gezegd sinds de laatste herstart.</span>';
  $('bks').textContent = data.backups.length ? 'Aanwezig: ' + data.backups.join(', ') : 'Nog geen back-ups.';
}
$('go').onclick = () => { KEY = $('key').value; try { sessionStorage.setItem('sw-admin', KEY); } catch {} load(); };
$('key').onkeydown = e => { if (e.key === 'Enter') $('go').onclick(); };
$('q').oninput = render; $('onlyOn').onchange = render;
$('users').addEventListener('change', async e => {
  const s = e.target.closest('select[data-u]'); if (!s || !s.value) return;
  const [act, min] = s.value.split(':'), user = s.dataset.u; s.value = '';
  let reason = ''; if (act === 'mute' || act === 'ban' || act === 'kick') { reason = prompt('Reden (optioneel, de speler ziet dit):') ?? null; if (reason === null) return; }
  if ((act === 'ban' || act === 'resetpw') && !confirm(act === 'ban' ? 'Deze speler blokkeren?' : 'Een nieuw wachtwoord maken? Het oude werkt dan niet meer.')) return;
  try { const r = await api(act, { user, minutes: +min || 0, reason }); $('msg').textContent = r.password ? 'Nieuw wachtwoord voor ' + user + ': ' + r.password + '  (geef het door; de speler kan het daarna niet zelf wijzigen)' : 'Gelukt.'; load(); }
  catch (err) { $('msg').textContent = err.message; }
});
$('annGo').onclick = async () => { try { const r = await api('announce', { text: $('ann').value }); $('msg').textContent = 'Verstuurd naar ' + r.sent + ' spelers.'; $('ann').value = ''; } catch (e) { $('msg').textContent = e.message; } };
$('bkNow').onclick = async () => { try { const r = await api('backup-now', {}); $('msg').textContent = 'Back-up gemaakt: ' + r.name; load(); } catch (e) { $('msg').textContent = e.message; } };
$('bkDl').onclick = async () => { const r = await fetch('/api/admin/backup', { headers: { 'X-Admin-Key': KEY } }); if (!r.ok) return $('msg').textContent = 'Download mislukt'; const b = await r.blob(), a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'swordwoods-db.json'; a.click(); };
if (KEY && enabled) load(); setInterval(() => { if (!$('app').hidden) load(); }, 15000);
</script></body></html>`;
