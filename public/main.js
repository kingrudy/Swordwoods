// Inloggen, account maken en lobby. Het 3D-spel (three.js) wordt pas geladen zodra je een kamer betreedt.
import { Net } from './net.js';
import { RARITIES } from './items.js';
import { openInvite, takeInvitedRoom, clearInviteParam } from './invite.js';

let invitedRoom = takeInvitedRoom();
if (invitedRoom) document.getElementById('invited').hidden = false;
fetch('/api/health').then(r => r.json()).then(h => { for (const id of ['version-auth', 'version-lobby']) document.getElementById(id).textContent = 'Versie ' + (h.version || '?'); }).catch(() => {});

const $ = id => document.getElementById(id);
const net = new Net();
let mode = 'login', myName = null, save = null;
const TOKEN_KEY = 'sw-token';
const BUILD = document.querySelector('meta[name="sw-build"]')?.content || '';
const store = {
  get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch {} },
  del() { try { localStorage.removeItem(TOKEN_KEY); } catch {} },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id); }
function overlay(title, text, btn = 'Opnieuw laden') {
  $('ov-title').textContent = title; $('ov-text').textContent = text; $('ov-btn').textContent = btn;
  $('overlay').classList.add('on');
}
$('ov-btn').onclick = () => location.reload();

/* ---------------- inloggen ---------------- */
function setMode(m) {
  mode = m;
  $('tab-login').classList.toggle('on', m === 'login'); $('tab-register').classList.toggle('on', m === 'register');
  $('au-go').textContent = m === 'login' ? 'Inloggen' : 'Account maken';
  $('au-pass').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('au-err').textContent = '';
}
$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');

$('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('au-go'); btn.disabled = true; $('au-err').textContent = '';
  try {
    const r = await fetch('/api/' + (mode === 'login' ? 'login' : 'register'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('au-name').value.trim(), password: $('au-pass').value }),
    });
    const j = await r.json();
    if (!r.ok) { $('au-err').textContent = j.err || 'Er ging iets mis.'; return; }
    store.set(j.token); await connect(j.token);
  } catch { $('au-err').textContent = 'Geen verbinding met de server.'; }
  finally { btn.disabled = false; }
});

/* ---------------- lobby ---------------- */
async function loadLeaderboard() {
  try {
    const lb = await (await fetch('/api/leaderboard')).json();
    const html = lb.length ? lb.map((x, i) => '<li class="' + (x.name === myName ? 'me' : '') + '"><span class="n">' + (i + 1) + '</span><span>' + esc(x.name) + '</span><span class="s">golf ' + x.bestWave + ' · ' + x.score + '</span></li>').join('')
      : '<li><span></span><span class="s">Nog niemand. Wees de eerste.</span><span></span></li>';
    $('lb-auth').innerHTML = html; $('lb-lobby').innerHTML = html;
  } catch {}
}
function fmtTime(s) { const m = Math.floor(s / 60); return m >= 60 ? Math.floor(m / 60) + 'u ' + (m % 60) + 'm' : m + ' min'; }
function renderLobby() {
  $('lb-hello').textContent = 'Welkom terug, ' + myName + '. Kies een kamer of maak er zelf een.';
  const s = save.stats || {};
  const cells = [['Beste golf', s.bestWave | 0], ['Punten', s.score | 0], ['Monsters verslagen', s.kills | 0], ['Dieren gejaagd', s.animals | 0],
    ['Bomen omgehakt', s.trees | 0], ['Kisten geopend', s.chests | 0], ['Hout', save.wood | 0], ['Vlees', save.meat | 0], ['Drankjes', save.potions | 0], ['Hout uitgegeven', s.spent | 0], ['Schild', 'niveau ' + ((save.up && save.up.shield) | 0)], ['Bijl', 'niveau ' + ((save.up && save.up.axe) | 0)], ['Keer gevallen', s.deaths | 0], ['Speeltijd', fmtTime(s.playSec | 0)]];
  $('my-stats').innerHTML = cells.map(([k, v]) => '<div class="stat"><b>' + esc(v) + '</b><span>' + k + '</span></div>').join('');
  $('my-swords').innerHTML = (save.swords || []).length
    ? save.swords.map(w => '<span class="sw" style="color:' + RARITIES[w.rarity].color + '">' + esc(w.name) + ' · ' + w.damage + '</span>').join('')
    : '<span class="empty">Nog geen zwaarden. Zoek kisten in het bos.</span>';
}
let lastRooms = '';
function renderRooms(list) {
  const key = JSON.stringify(list); if (key === lastRooms) return; lastRooms = key;
  $('rooms').innerHTML = list.length ? list.map(r => {
    const full = r.players >= r.max;
    const st = r.ph === 1 ? '<span class="pill fight">Golf ' + r.wave + ' bezig</span>' : '<span class="pill calm">' + (r.wave ? 'Golf ' + r.wave + ' verslagen' : 'Nog niet begonnen') + '</span>';
    return '<div class="room"><div><b>' + esc(r.name) + '</b><small>' + (r.perm ? 'Vaste kamer' : 'Door een speler gemaakt') + '</small></div>' +
      st + '<div class="row"><span class="pill">' + r.players + ' / ' + r.max + '</span><button class="btn small primary" data-join="' + r.id + '" ' + (full ? 'disabled' : '') + '>' + (full ? 'Vol' : 'Meedoen') + '</button></div></div>';
  }).join('') : '<p class="empty">Geen kamers. Maak er een.</p>';
}
$('rooms').addEventListener('click', e => { const b = e.target.closest('[data-join]'); if (b) { $('lb-err').textContent = ''; net.send({ t: 'join', id: +b.dataset.join }); } });
$('btn-quick').onclick = () => { $('lb-err').textContent = ''; net.send({ t: 'quick' }); };
$('btn-new').onclick = () => { $('create-form').classList.toggle('on'); $('cr-name').focus(); };
$('create-form').addEventListener('submit', e => { e.preventDefault(); net.send({ t: 'create', name: $('cr-name').value, max: +$('cr-max').value }); });
$('btn-invite-lobby').onclick = () => openInvite({});
$('btn-logout').onclick = () => { store.del(); try { net.ws.close(); } catch {} location.reload(); };

/* ---------------- verbinding ---------------- */
let handlersSet = false;
function setHandlers() {
  if (handlersSet) return; handlersSet = true;
  net.on('authed', m => {
    myName = m.name; save = m.save; renderLobby(); renderRooms(m.rooms); show('lobby'); loadLeaderboard();
    if (invitedRoom) {
      const r = m.rooms.find(x => x.id === invitedRoom); const id = invitedRoom; invitedRoom = null; clearInviteParam();
      if (r) net.send({ t: 'join', id }); else $('lb-err').textContent = 'De kamer uit je uitnodiging bestaat niet meer. Kies een andere kamer.';
    }
  });
  net.on('outdated', () => {
    // Nieuwe versie op de server: één keer automatisch herladen, daarna uitleggen.
    let last = 0; try { last = +sessionStorage.getItem('sw-reload') || 0; } catch {}
    if (Date.now() - last > 30000) { try { sessionStorage.setItem('sw-reload', String(Date.now())); } catch {} location.reload(); }
    else overlay('Nieuwe versie', 'Je browser laadt nog een oude versie van het spel. Sluit het tabblad en open de link opnieuw, of wis de websitegegevens van deze site.');
  });
  net.on('authfail', () => { store.del(); show('auth'); loadLeaderboard(); });
  net.on('rooms', m => renderRooms(m.rooms));
  net.on('err', m => { $('lb-err').textContent = m.msg; });
  net.on('kicked', () => overlay('Elders ingelogd', 'Je account is op een ander apparaat of tabblad gestart.'));
  net.on('_close', () => { if (!$('overlay').classList.contains('on')) overlay('Verbinding verloren', 'De verbinding met de server is verbroken.'); });
  net.on('joined', async m => {
    net.buffering = true;                 // berichten opvangen tot het spel klaar is
    show(null); $('loading').classList.add('on');
    try {
      const g = await import('./game.js');
      await g.startGame({ net, joined: m, user: myName });
    } catch (e) {
      console.error(e);
      overlay('Laden mislukt', String(e && e.message || e));
    } finally { $('loading').classList.remove('on'); }
  });
}
async function connect(token) {
  setHandlers();
  try { await net.open(); } catch (e) { show('auth'); $('au-err').textContent = e.message; return; }
  net.send({ t: 'auth', token, build: BUILD });
}

setMode('login');
loadLeaderboard();
const t = store.get();
if (t) connect(t); else show('auth');
