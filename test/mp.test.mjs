import { ROOT, tmpData } from './helpers.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createWorld } from '../public/world.js';
const PORT = 8123, BASE = 'http://localhost:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DATA = tmpData('mp');
fs.rmSync(DATA, { recursive: true, force: true });
let srv;
function start(env = {}) {
  srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, EXTRA_PORTS: '', DATA_DIR: DATA, MAX_SPEED: 99999, FIRST_WAVE_DELAY: 6, WAVE_GAP: 7, HUNGER_RATE: 0.22, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', d => process.stderr.write('[srv-err] ' + d));
  return new Promise(res => srv.stdout.on('data', d => { if (String(d).includes('luistert')) res(); })).then(async () => { globalThis.BUILD = (await (await fetch(BASE + '/api/health')).json()).build; });
}
const stop = () => new Promise(res => { srv.on('exit', res); srv.kill('SIGTERM'); });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ s: r.status, j: await r.json() }));

class Bot {
  constructor(name) { this.name = name; this.snap = null; this.inv = null; this.msgs = []; this.ev = []; this.waves = []; this.toasts = []; this.loots = []; this.hurt = 0; }
  connect(token) {
    return new Promise((res, rej) => {
      this.ws = new WebSocket('ws://localhost:' + PORT + '/ws');
      this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'auth', build: globalThis.BUILD, token }));
      this.ws.onerror = e => rej(e);
      this.ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 's') { this.snap = m; }
        else if (m.t === 'inv') this.inv = m;
        else if (m.t === 'ev') this.ev.push(m);
        else if (m.t === 'wave') this.waves.push(m);
        else if (m.t === 'toast') this.toasts.push(m);
        else if (m.t === 'loot') this.loots.push(m);
        else if (m.t === 'hurt') this.hurt++;
        else this.msgs.push(m);
        if (m.t === 'authed') res(m);
        if (m.t === 'authfail') rej(new Error('authfail'));
        if (m.t === 'joined') { this.joined = m; this.me = m.you; this.world = createWorld(m.room.seed); }
        if (m.t === 'respawn') { this.me = { ...this.me, x: m.x, z: m.z }; }
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 5000) { return new Promise(async (res, rej) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return res(v); await sleep(25); } rej(new Error('timeout')); }); }
  at(x, z, yaw = 0) { this.me.x = x; this.me.z = z; this.send({ t: 'in', x, y: this.world.heightAt(x, z), z, yaw, pitch: 0 }); }
  // sta naast doel, kijk ernaar
  face(tx, tz, dist = 1.6) { const dx = tx - this.px, dz = tz - this.pz; }
  goNear(tx, tz, dist = 1.8) {
    const ang = Math.atan2(-1, 0); // vaste kant: kom van +x kant
    const x = tx + dist, z = tz;
    this.at(x, z, Math.atan2(-(tx - x), -(tz - z)));
  }
}

const main = async () => {
  await start();
  // ---- accounts
  let r = await post('/api/register', { username: 'a', password: 'geheim123' }); ok(r.s === 400, 'te korte naam geweigerd: ' + r.j.err);
  r = await post('/api/register', { username: 'Alice', password: '123' }); ok(r.s === 400, 'te kort wachtwoord geweigerd');
  const A = await post('/api/register', { username: 'Alice', password: 'geheim123' }); ok(A.s === 200 && A.j.token, 'registreren Alice');
  r = await post('/api/register', { username: 'alice', password: 'anders123' }); ok(r.s === 400, 'dubbele naam (hoofdletterongevoelig) geweigerd');
  const B = await post('/api/register', { username: 'Bob_1', password: 'geheim456' }); ok(B.s === 200, 'registreren Bob');
  r = await post('/api/login', { username: 'Alice', password: 'fout' }); ok(r.s === 400, 'login met fout wachtwoord geweigerd');
  r = await post('/api/login', { username: 'alice', password: 'geheim123' }); ok(r.s === 200 && r.j.name === 'Alice', 'login werkt');
  // ---- geef beide een legendarisch zwaard via db (server stoppen, aanpassen, starten)
  await sleep(1800); await stop();
  const db = JSON.parse(fs.readFileSync(DATA + '/db.json', 'utf8'));
  ok(!JSON.stringify(db).includes('geheim123'), 'wachtwoord staat niet in platte tekst in db');
  const sw = { type: 'sword', rarity: 4, base: 1, name: 'Testzwaard', damage: 60, speed: 1.0 };
  for (const k of ['alice', 'bob_1']) { db.users[k].save.swords = [sw]; db.users[k].save.equip = 1; }
  fs.writeFileSync(DATA + '/db.json', JSON.stringify(db));
  await start();
  const tokA = (await post('/api/login', { username: 'Alice', password: 'geheim123' })).j.token;
  const tokB = (await post('/api/login', { username: 'Bob_1', password: 'geheim456' })).j.token;

  // ---- lobby
  const a = new Bot('Alice'), b = new Bot('Bob');
  const authedA = await a.connect(tokA); ok(authedA.rooms.length >= 2, 'lobby toont ' + authedA.rooms.length + ' kamers');
  await b.connect(tokB);
  // oude client zonder build: krijgt 'outdated', lege kamerlijst en mag niet meedoen
  { const o = new Bot('oud'); const saved = globalThis.BUILD; globalThis.BUILD = undefined; const au = await o.connect(tokA); globalThis.BUILD = saved;
    await sleep(200); o.send({ t: 'quick' }); await sleep(300);
    ok(o.msgs.some(m => m.t === 'outdated') && au.rooms.length === 0 && !o.joined && o.msgs.some(m => m.t === 'err' && /nieuwe versie|Herlaad/.test(m.msg)), 'oude client: outdated + herlaadmelding, kan niet meedoen');
    o.ws.close(); await sleep(200); }
  const authedA2 = await a.connect(tokA);
  const bad = new Bot('bad'); let failed = false; try { await bad.connect('nep'); } catch { failed = true; } ok(failed, 'ongeldige token geweigerd');
  a.send({ t: 'create', name: 'Testbos', max: 3 });
  await a.wait(() => a.joined); ok(a.joined.room.name === 'Testbos', 'kamer aangemaakt en betreden, seed ' + a.joined.room.seed);
  await sleep(2200);
  b.send({ t: 'rooms' }); await b.wait(() => b.msgs.find(m => m.t === 'rooms' && m.rooms.some(x => x.name === 'Testbos' && x.players === 1)));
  ok(true, 'Bob ziet Testbos (1 speler) in de lobby');
  const rid = a.joined.room.id;
  b.send({ t: 'join', id: rid }); await b.wait(() => b.joined);
  ok(b.joined.players.length === 2, 'Bob in dezelfde kamer, 2 spelers');
  await a.wait(() => a.msgs.find(m => m.t === 'pjoin' && m.name === 'Bob_1')); ok(true, 'Alice krijgt pjoin voor Bob');
  ok(a.joined.room.seed === b.joined.room.seed, 'zelfde wereld-seed');

  const W = a.world;
  // ---- bomen hakken
  const t = W.trees.filter(t => Math.hypot(t.x, t.z) < 80).sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
  const wood0 = a.inv.wood;
  let n = 0;
  while (!a.ev.find(e => e.k === 'felled' && e.i === t.idx) && n < 30) { a.goNear(t.x, t.z); await sleep(30); a.send({ t: 'swing' }); await sleep(560); n++; }
  ok(a.ev.some(e => e.k === 'felled' && e.i === t.idx), 'boom omgehakt met zwaard na ' + n + ' slagen');
  await sleep(100);
  ok(a.inv.wood > wood0, 'hout ' + wood0 + ' -> ' + a.inv.wood);
  ok(b.ev.some(e => e.k === 'felled' && e.i === t.idx), 'Bob ziet dezelfde boom vallen');
  // ---- kist
  const c = W.chests.slice().sort((p, q) => Math.hypot(p.x, p.z) - Math.hypot(q.x, q.z))[0];
  a.at(c.x + 2, c.z, 0); await sleep(150);
  const sw0 = a.inv.swords.length, wd = a.inv.wood, mt = a.inv.meat;
  a.send({ t: 'open', i: c.idx }); await a.wait(() => a.loots.length);
  ok(a.loots.length === 1, 'kist geeft buit: ' + JSON.stringify(a.loots[0]).slice(0, 90));
  await b.wait(() => b.ev.find(e => e.k === 'chest' && e.i === c.idx)); ok(true, 'Bob ziet kist openen');
  a.send({ t: 'open', i: c.idx }); await sleep(200); ok(a.loots.length === 1, 'kist kan niet twee keer geopend worden');
  b.at(c.x + 30, c.z, 0); b.send({ t: 'open', i: c.idx }); await sleep(200); ok(b.loots.length === 0, 'te ver weg: kist openen mislukt');

  // ---- dieren -> vlees
  const meat0 = a.inv.meat; let tries = 0;
  const hitAnimals = () => a.ev.filter(e => e.k === 'hit' && e.e === 'a').length;
  while (a.inv.meat === meat0 && tries < 80) {
    const an = a.snap.a.slice().sort((p, q) => Math.hypot(p[2] - a.me.x, p[3] - a.me.z) - Math.hypot(q[2] - a.me.x, q[3] - a.me.z))[0];
    // teleporteer naast het dier (het vlucht, dus per slag opnieuw)
    a.at(an[2] + 1.5, an[3], Math.atan2(1.5, 0)); await sleep(60); a.send({ t: 'swing' }); await sleep(320); tries++;
  }
  ok(a.inv.meat > meat0, 'dier gedood, vlees ' + meat0 + ' -> ' + a.inv.meat + ' (' + hitAnimals() + ' treffers)');
  ok(a.toasts.some(x => /vlees/.test(x.msg)), 'toast over vlees: ' + a.toasts.find(x => /vlees/.test(x.msg))?.msg);

  // ---- honger en eten
  const hu0 = a.snap.y.hu; await sleep(6000);
  ok(a.snap.y.hu < hu0, 'honger daalt: ' + hu0 + ' -> ' + a.snap.y.hu);
  // maak Bob hongerig via veel wachten is te traag: test eten met Alice
  const meatBefore = a.inv.meat; a.send({ t: 'eat' }); await sleep(200);
  ok(a.inv.meat === meatBefore - 1 || a.toasts.some(x => /vol/.test(x.msg)), 'eten verbruikt vlees of meldt vol (hunger ' + a.snap.y.hu + ')');

  // ---- golven
  console.log('… wachten op golf 1');
  await a.wait(() => a.waves.find(w => w.ph === 1 && w.n === 1), 15000);
  ok(true, 'golf 1 gestart, ' + a.waves.find(w => w.ph === 1).count + ' monsters');
  await sleep(300);
  ok(a.snap.m.length > 0 && a.snap.w.ph === 1, 'snapshot bevat ' + a.snap.m.length + ' monsters');
  // Alice en Bob vechten met legendarisch zwaard (60 dmg)
  const fight = async (bot, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms && bot.snap.w.ph === 1) {
    const ms_ = bot.snap.m; if (!ms_.length) break;
    const mo = ms_.slice().sort((p, q) => Math.hypot(p[2] - bot.me.x, p[3] - bot.me.z) - Math.hypot(q[2] - bot.me.x, q[3] - bot.me.z))[0];
    bot.at(mo[2] + 1.5, mo[3], Math.atan2(1.5, 0)); await sleep(40); bot.send({ t: 'swing' }); await sleep(300); } };
  b.at(a.me.x, a.me.z, 0);
  await Promise.all([fight(a, 40000), fight(b, 40000)]);
  const cleared = a.waves.find(w => w.cleared); ok(!!cleared, 'golf 1 verslagen, volgende golf over ' + cleared?.next + 's');
  ok(a.hurt + b.hurt > 0, 'spelers kregen schade (' + (a.hurt + b.hurt) + ' hits)');
  const t1 = Date.now();
  await a.wait(() => a.waves.find(w => w.ph === 1 && w.n === 2), 15000);
  const dt = (Date.now() - t1) / 1000; ok(dt > 3 && dt < 9.5, 'golf 2 komt ' + dt.toFixed(1) + 's na afloop (WAVE_GAP=7)');
  const w2 = a.waves.find(w => w.ph === 1 && w.n === 2); ok(w2.count > a.waves.find(w => w.ph === 1 && w.n === 1).count, 'golf 2 heeft meer monsters (' + w2.count + ')');
  await a.wait(() => a.snap.m.length > 0);
  const hp1 = a.snap.m[0]?.[6]; console.log('   monster maxhp in golf 2:', hp1, '(kobold golf1 = 24)');
  ok(a.inv.stats.kills > 0 && a.inv.stats.score > 0, 'stats: ' + JSON.stringify(a.inv.stats));

  // ---- Alice laat zich doden -> respawn
  a.at(a.snap.m[0][2] + 1, a.snap.m[0][3], 0);
  await a.wait(() => a.msgs.find(m => m.t === 'dead'), 60000).catch(() => {});
  ok(!!a.msgs.find(m => m.t === 'dead'), 'Alice gedood door monsters (wood over: ' + a.inv.wood + ', deaths ' + a.inv.stats.deaths + ')');
  await a.wait(() => a.msgs.find(m => m.t === 'respawn'), 14000).catch(() => {});
  ok(!!a.msgs.find(m => m.t === 'respawn'), 'Alice respawnt na 8s, hp ' + a.snap.y.hp);

  // ---- opslag
  const before = JSON.stringify({ kills: a.inv.stats.kills, wood: a.inv.wood, meat: a.inv.meat, sw: a.inv.swords.length });
  a.send({ t: 'leave' }); await a.wait(() => a.msgs.find(m => m.t === 'left'));
  ok(true, 'Alice terug in lobby');
  b.ws.close(); await sleep(2200);
  await stop(); await start();
  const tok2 = (await post('/api/login', { username: 'Alice', password: 'geheim123' })).j.token;
  const a2 = new Bot('Alice2'); const au = await a2.connect(tok2);
  const after = JSON.stringify({ kills: au.save.stats.kills, wood: au.save.wood, meat: au.save.meat, sw: au.save.swords.length });
  ok(au.save.stats.kills > 0 && au.save.swords.length >= 1, 'na serverherstart bewaard: ' + after + ' (voor: ' + before + ')');
  const lb = await (await fetch(BASE + '/api/leaderboard')).json(); ok(lb.all.length > 0 && lb.all[0].score > 0, 'leaderboard: ' + JSON.stringify(lb.all[0]));
  ok(lb.week && /^\d{4}-W\d\d$/.test(lb.week.k) && lb.week.ev.name && lb.week.top.length > 0 && lb.week.top[0].pts > 0, 'weekranglijst: ' + lb.week.k + ' ' + lb.week.ev.name + ' ' + JSON.stringify(lb.week.top[0]));
  // dubbele login kickt oude sessie
  const a3 = new Bot('Alice3'); await a3.connect(tok2); await sleep(300);
  ok(a2.msgs.some(m => m.t === 'kicked'), 'tweede login kickt de eerste');
  await stop();
  console.log(fails ? '\n' + fails + ' MISLUKT' : '\nALLES GESLAAGD');
  process.exit(fails ? 1 : 0);
};
main().catch(e => { console.error('TESTFOUT', e); try { srv.kill(); } catch {} process.exit(2); });
