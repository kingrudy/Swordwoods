// Autoritatieve spelsimulatie voor één kamer: spelers, monsterjacht in golven, dieren, honger, bomen en kisten.

import { createWorld, HALF, WATER } from './public/world.js';
import { rollSword, rollSwordOfRarity, AXE, MAX_SWORDS, MONSTERS, ANIMALS, eqCode, SHOP, SHIELD_REDUCE, MAX_POTIONS } from './public/items.js';

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const CFG = {
  firstWave: num(process.env.FIRST_WAVE_DELAY, 45),   // seconden tot golf 1
  waveGap: num(process.env.WAVE_GAP, 120),            // seconden tussen "laatste vijand weg" en volgende golf
  wipeDelay: 25,
  respawn: 8,
  hungerRate: num(process.env.HUNGER_RATE, 0.22),     // punten per seconde (100 -> 0 in ~7,5 min)
  treeRespawn: 240, chestRespawn: 600,
  animalTarget: 38,
};

const worlds = new Map();
function getWorld(seed) {
  let w = worlds.get(seed);
  if (!w) { w = createWorld(seed); if (worlds.size > 12) worlds.delete(worlds.keys().next().value); worlds.set(seed, w); }
  return w;
}

const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const len = (x, z) => Math.sqrt(x * x + z * z);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export function ensureSave(u) {
  const s = u.save || (u.save = {});
  s.wood = s.wood | 0; s.meat = s.meat | 0; s.potions = clamp(s.potions | 0, 0, MAX_POTIONS);
  s.up = Object.assign({ shield: 0, axe: 0 }, s.up || {}); s.up.shield = clamp(s.up.shield | 0, 0, 3); s.up.axe = clamp(s.up.axe | 0, 0, 3);
  if (!Array.isArray(s.swords)) s.swords = [];
  s.equip = clamp(s.equip | 0, 0, s.swords.length);
  s.stats = Object.assign({ kills: 0, deaths: 0, bestWave: 0, score: 0, animals: 0, trees: 0, chests: 0, playSec: 0 }, s.stats || {});
  return s;
}

export class Room {
  constructor(id, name, max, permanent, markDirty) {
    this.id = id; this.name = name; this.max = max; this.permanent = permanent; this.markDirty = markDirty;
    this.seed = 1 + Math.floor(Math.random() * 9000);
    this.world = getWorld(this.seed);
    this.players = new Map(); this.nextPid = 1;
    this.emptySince = null;
    this.reset();
  }

  reset() {
    this.T = 0; this.tickN = 0; this.eid = 1;
    this.monsters = new Map(); this.animals = new Map();
    this.treeHp = Float32Array.from(this.world.trees, t => t.hp0);
    this.felled = new Map();      // idx -> respawn time
    this.chestOpen = new Map();   // idx -> reset time
    this.wave = { n: 0, ph: 0, t: CFG.firstWave };   // ph 0 = wachten, 1 = gevecht
    this.animalTimer = 0;
    this.rand = Math.random;
    for (let i = 0; i < CFG.animalTarget; i++) this.spawnAnimal(i < 8);
    this.emptySince = this.players.size ? null : Date.now();
  }

  get summary() {
    return { id: this.id, name: this.name, players: this.players.size, max: this.max, wave: this.wave.n, ph: this.wave.ph, perm: this.permanent };
  }

  // ------------------------------------------------------------ verbinding
  bc(obj, except = null) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except) p.conn.send(s);
  }
  sendInv(P) {
    const s = P.u.save;
    P.conn.send({ t: 'inv', wood: s.wood, meat: s.meat, potions: s.potions, up: s.up, swords: s.swords, equip: s.equip, stats: s.stats });
  }
  toast(P, msg, color = '#fff') { P.conn.send({ t: 'toast', msg, color }); }

  addPlayer(conn) {
    const u = conn.user, s = ensureSave(u);
    const sp = this.world.spawn;
    const P = {
      id: this.nextPid++, conn, u, name: u.name,
      x: sp.x + (Math.random() - 0.5) * 3, z: sp.z + (Math.random() - 0.5) * 3, y: 0, yaw: 0.4, pitch: 0,
      hp: 100, hunger: 80, dead: false, respawnAt: 0, swings: 0, nextSwing: 0, pendingHit: -1, lastHurt: -99, lastEat: -9, starve: 0,
    };
    P.y = this.world.heightAt(P.x, P.z);
    this.players.set(P.id, P); this.emptySince = null;
    this.bc({ t: 'pjoin', id: P.id, name: P.name }, P);
    conn.send({
      t: 'joined',
      room: { id: this.id, name: this.name, seed: this.seed, max: this.max },
      you: { id: P.id, name: P.name, x: P.x, y: P.y, z: P.z },
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name })),
      felled: [...this.felled.keys()], chests: [...this.chestOpen.keys()],
    });
    this.sendInv(P);
    return P;
  }

  removePlayer(P) {
    this.players.delete(P.id);
    this.markDirty();
    this.bc({ t: 'pleave', id: P.id });
    if (!this.players.size) this.emptySince = Date.now();
  }

  // ------------------------------------------------------------ invoer van spelers
  handle(P, m) {
    switch (m.t) {
      case 'in': {
        if (P.dead) return;
        const x = num(m.x, P.x), z = num(m.z, P.z);
        const r = len(x, z), lim = HALF - 6, k = r > lim ? lim / r : 1;
        P.x = x * k; P.z = z * k;
        const h = this.world.heightAt(P.x, P.z);
        P.y = clamp(num(m.y, h), h - 1, h + 14);
        P.yaw = num(m.yaw, P.yaw); P.pitch = clamp(num(m.pitch, 0), -1.5, 1.5);
        break;
      }
      case 'swing': this.swing(P); break;
      case 'open': this.openChest(P, m.i | 0); break;
      case 'equip': {
        const s = P.u.save, i = m.i | 0;
        if (i >= 0 && i <= s.swords.length) { s.equip = i; this.markDirty(); this.sendInv(P); }
        break;
      }
      case 'eat': this.eat(P); break;
      case 'drink': this.drink(P); break;
      case 'buy': this.buy(P, String(m.id)); break;
    }
  }

  eqItem(P) {
    const s = P.u.save;
    return s.equip === 0 ? AXE : (s.swords[s.equip - 1] || AXE);
  }

  swing(P) {
    if (P.dead || this.T < P.nextSwing) return;
    const it = this.eqItem(P);
    P.nextSwing = this.T + 0.5 / (it.speed || 1) * 0.92;
    P.swings = (P.swings + 1) & 255;
    P.pendingHit = this.T + 0.2;
  }

  resolveHit(P) {
    const it = this.eqItem(P), s = P.u.save;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bd = 1e9, kind = null;
    const test = (e, r, reach, minDot, k) => {
      const dx = e.x - P.x, dz = e.z - P.z, d = len(dx, dz);
      if (d > reach + r || d < 0.0001) return;
      if ((dx * fx + dz * fz) / d < minDot) return;
      if (d < bd) { bd = d; best = e; kind = k; }
    };
    for (const m of this.monsters.values()) test(m, MONSTERS[m.type].r, 2.9, 0.4, 'm');
    for (const a of this.animals.values()) test(a, ANIMALS[a.type].r, 2.9, 0.4, 'a');
    if (!best) {
      for (const t of this.world.trees) {
        if (this.felled.has(t.idx)) continue;
        if (Math.abs(t.x - P.x) > 5 || Math.abs(t.z - P.z) > 5) continue;
        test(t, t.r, 3.1, 0.6, 't');
      }
    }
    if (!best) return;
    const full = P.hunger >= 80 ? 1.15 : 1;   // goed gevoed = iets sterker
    if (kind === 'm' || kind === 'a') {
      const dmg = (it.type === 'axe' ? AXE.damage + s.up.axe * 2 : it.damage) * full * (0.9 + Math.random() * 0.2);
      best.hp -= dmg; best.stun = 0.18;
      if (kind === 'a') { best.angry = true; best.hurtT = this.T; }
      this.bc({ t: 'ev', k: 'hit', e: kind, id: best.id, dmg: Math.round(dmg), x: r1(best.x), z: r1(best.z) });
      if (best.hp <= 0) { if (kind === 'm') this.killMonster(best, P); else this.killAnimal(best, P); }
    } else {
      const dmg = it.type === 'axe' ? 1 + s.up.axe : Math.max(0.15, it.damage / 60);
      this.treeHp[best.idx] -= dmg;
      this.bc({ t: 'ev', k: 'chop', i: best.idx });
      if (this.treeHp[best.idx] <= 0) {
        const dx = best.x - P.x, dz = best.z - P.z, d = len(dx, dz) || 1;
        this.felled.set(best.idx, this.T + CFG.treeRespawn);
        const n = 3 + Math.floor(best.scale * 2);
        s.wood += n; s.stats.trees++;
        this.bc({ t: 'ev', k: 'felled', i: best.idx, dx: r2(dx / d), dz: r2(dz / d) });
        this.toast(P, '+' + n + ' hout', '#c89a5e');
        this.sendInv(P); this.markDirty();
      }
    }
  }

  eat(P) {
    const s = P.u.save;
    if (P.dead || this.T - P.lastEat < 0.7) return;
    if (s.meat <= 0) { this.toast(P, 'Je hebt geen vlees. Jaag op dieren met je zwaard.', '#ff9c8a'); return; }
    if (P.hunger > 92) { this.toast(P, 'Je bent nog vol.', '#bbb'); return; }
    P.lastEat = this.T; s.meat--;
    P.hunger = Math.min(100, P.hunger + 30);
    P.hp = Math.min(100, P.hp + 8);
    P.conn.send({ t: 'ev', k: 'ate' });
    this.sendInv(P); this.markDirty();
  }

  drink(P) {
    const s = P.u.save;
    if (P.dead || this.T - (P.lastDrink || -9) < 1) return;
    if (s.potions <= 0) { this.toast(P, 'Je hebt geen helende drank. Koop er een in de winkel.', '#ff9c8a'); return; }
    if (P.hp >= 100) { this.toast(P, 'Je gezondheid is al vol.', '#bbb'); return; }
    P.lastDrink = this.T; s.potions--; P.hp = Math.min(100, P.hp + 50);
    P.conn.send({ t: 'ev', k: 'drank' });
    this.sendInv(P); this.markDirty();
  }

  buy(P, id) {
    const s = P.u.save, it = SHOP.find(x => x.id === id), sh = this.world.shop;
    if (!it || P.dead) return;
    if (len(sh.x - P.x, sh.z - P.z) > 7.5) { this.toast(P, 'Je staat te ver van de winkel.', '#ff9c8a'); return; }
    if (s.wood < it.cost) { this.toast(P, 'Te weinig hout: je hebt ' + s.wood + ', dit kost ' + it.cost + '.', '#ff9c8a'); return; }
    const fail = msg => this.toast(P, msg, '#ff9c8a');
    switch (it.kind) {
      case 'meat': s.meat += it.n; break;
      case 'potion':
        if (s.potions >= MAX_POTIONS) return fail('Je draagt al ' + MAX_POTIONS + ' drankjes.');
        s.potions++; break;
      case 'shield': case 'axe': {
        const key = it.kind, cur = s.up[key];
        if (it.level <= cur) return fail('Dat heb je al.');
        if (it.level > cur + 1) return fail('Koop eerst het vorige niveau.');
        s.up[key] = it.level; break;
      }
      case 'sword': {
        const sw = rollSwordOfRarity(it.rarity);
        if (s.swords.length >= MAX_SWORDS && sw.damage <= Math.min(...s.swords.map(x => x.damage))) return fail('Je rugzak zit vol met betere zwaarden. Niets afgerekend.');
        s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost;
        this.giveSword(P, sw, 'shop'); this.sendInv(P); this.markDirty();
        P.conn.send({ t: 'ev', k: 'bought' });
        return;
      }
    }
    s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost;
    P.conn.send({ t: 'ev', k: 'bought' });
    this.toast(P, it.name + ' gekocht voor ' + it.cost + ' hout.', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }

  openChest(P, idx) {
    const c = this.world.chests[idx];
    if (!c || P.dead || this.chestOpen.has(idx)) return;
    if (len(c.x - P.x, c.z - P.z) > 4.6) return;
    this.chestOpen.set(idx, this.T + CFG.chestRespawn);
    this.bc({ t: 'ev', k: 'chest', i: idx, by: P.id });
    const s = P.u.save; s.stats.chests++;
    const r = Math.random();
    if (r < 0.62) this.giveSword(P, rollSword(c.luck), 'chest');
    else if (r < 0.80) { const n = 4 + Math.floor(Math.random() * 6); s.wood += n; P.conn.send({ t: 'loot', kind: 'wood', n }); }
    else if (r < 0.94) { const n = 2 + Math.floor(Math.random() * 2); s.meat += n; P.conn.send({ t: 'loot', kind: 'meat', n }); }
    else P.conn.send({ t: 'loot', kind: 'empty' });
    this.sendInv(P); this.markDirty();
  }

  giveSword(P, sw, src) {
    const s = P.u.save;
    let res = 'added', dropped = null;
    if (s.swords.length < MAX_SWORDS) s.swords.push(sw);
    else {
      let wi = 0; s.swords.forEach((x, i) => { if (x.damage < s.swords[wi].damage) wi = i; });
      if (sw.damage > s.swords[wi].damage) { dropped = s.swords[wi]; s.swords[wi] = sw; res = 'replaced'; if (s.equip - 1 === wi) s.equip = wi + 1; }
      else res = 'left';
    }
    let auto = false;
    if (res !== 'left') {
      const idx = s.swords.indexOf(sw) + 1, cur = s.equip === 0 ? 0 : (s.swords[s.equip - 1]?.damage || 0);
      if (sw.damage > cur && sw.damage >= Math.max(...s.swords.map(x => x.damage))) { s.equip = idx; auto = true; }
    }
    P.conn.send({ t: 'loot', kind: 'sword', sword: sw, res, dropped, auto, src });
  }

  // ------------------------------------------------------------ schade en dood
  hurt(P, dmg, src) {
    if (P.dead) return;
    dmg *= 1 - SHIELD_REDUCE[P.u.save.up.shield];
    P.hp -= dmg; P.lastHurt = this.T;
    P.conn.send({ t: 'hurt', dmg: Math.round(dmg), x: src ? r1(src.x) : null, z: src ? r1(src.z) : null });
    if (P.hp <= 0) this.die(P);
  }

  die(P) {
    P.hp = 0; P.dead = true; P.respawnAt = this.T + CFG.respawn; P.pendingHit = -1;
    const s = P.u.save; s.stats.deaths++; s.wood = Math.floor(s.wood / 2);
    P.conn.send({ t: 'dead', in: CFG.respawn });
    this.bc({ t: 'ev', k: 'pdead', id: P.id });
    this.sendInv(P); this.markDirty();
    if ([...this.players.values()].every(p => p.dead)) this.wipe();
  }

  respawn(P) {
    const sp = this.world.spawn;
    P.dead = false; P.hp = 100; P.hunger = Math.max(P.hunger, 50);
    P.x = sp.x + (Math.random() - 0.5) * 4; P.z = sp.z + (Math.random() - 0.5) * 4; P.y = this.world.heightAt(P.x, P.z);
    P.conn.send({ t: 'respawn', x: P.x, y: P.y, z: P.z });
  }

  wipe() {
    this.monsters.clear();
    this.wave.n = Math.max(0, this.wave.n - 1); this.wave.ph = 0; this.wave.t = CFG.wipeDelay;
    this.bc({ t: 'wave', ph: 0, n: this.wave.n, wipe: true, next: this.wave.t });
  }

  // ------------------------------------------------------------ golven en monsters
  pickAlive() { const a = [...this.players.values()].filter(p => !p.dead); return a[Math.floor(Math.random() * a.length)] || null; }

  startWave() {
    const w = this.wave; w.n++; w.ph = 1;
    const n = w.n, alive = [...this.players.values()].filter(p => !p.dead).length || 1;
    const scale = { hp: 1 + 0.30 * (n - 1), dmg: 1 + 0.12 * (n - 1), spd: Math.min(1.4, 1 + 0.02 * (n - 1)) };
    const hpMul = scale.hp * (1 + 0.15 * (alive - 1));
    const count = Math.min(70, Math.round((3 + 1.6 * n) * (0.7 + 0.3 * alive)));
    const pool = MONSTERS.map((m, i) => ({ m, i })).filter(x => x.m.minWave <= n);
    const total = pool.reduce((a, x) => a + x.m.weight, 0);
    const list = [];
    for (let i = 0; i < count; i++) {
      let t = Math.random() * total, k = 0;
      for (; k < pool.length - 1; k++) { if (t < pool[k].m.weight) break; t -= pool[k].m.weight; }
      list.push(pool[k].i);
    }
    const boss = n % 5 === 0;
    if (boss) list.push(3);
    let spawned = 0;
    for (const type of list) {
      const P = this.pickAlive(), cx = P ? P.x : 0, cz = P ? P.z : 0;
      const pt = this.world.landPoint(Math.random, cx, cz, 38, 58, 0.0) || this.world.landPoint(Math.random, 0, 0, 20, 90, 0.0);
      if (!pt) continue;
      const M = MONSTERS[type], bossMul = type === 3 ? (1 + 0.25 * (n / 5 - 1)) : 1;
      const m = {
        id: this.eid++, type, x: pt.x, z: pt.z, yaw: 0,
        hp: M.hp * hpMul * bossMul, maxhp: M.hp * hpMul * bossMul,
        dmg: M.dmg * scale.dmg * bossMul, speed: M.speed * scale.spd, nextAtk: 0, stun: 0, retarget: 0, target: null,
      };
      this.monsters.set(m.id, m); spawned++;
    }
    this.bc({ t: 'wave', ph: 1, n, boss, count: spawned });
  }

  endWave() {
    const w = this.wave; w.ph = 0; w.t = CFG.waveGap;
    for (const P of this.players.values()) {
      if (P.dead) continue;
      const s = P.u.save; s.stats.bestWave = Math.max(s.stats.bestWave, w.n);
      const bonus = w.n * 25; s.stats.score += bonus;
      P.hp = Math.min(100, P.hp + 30);
      const wb = w.n * 3; s.wood += wb;
      this.toast(P, 'Golf ' + w.n + ' verslagen! +' + bonus + ' punten en +' + wb + ' hout', '#f2c14e');
      if (Math.random() < 0.4) this.giveSword(P, rollSword(Math.min(1, w.n / 12)), 'wave');
      this.sendInv(P);
    }
    this.markDirty();
    this.bc({ t: 'wave', ph: 0, n: w.n, cleared: true, next: w.t });
  }

  killMonster(m, P) {
    this.monsters.delete(m.id);
    const M = MONSTERS[m.type], s = P.u.save;
    s.stats.kills++; s.stats.score += M.score * this.wave.n;
    this.bc({ t: 'ev', k: 'mdie', id: m.id, x: r1(m.x), z: r1(m.z), type: m.type });
    if (Math.random() < (m.type === 3 ? 1 : 0.06)) this.giveSword(P, rollSword(Math.min(1, this.wave.n / 12)), 'monster');
    this.sendInv(P); this.markDirty();
  }

  killAnimal(a, P) {
    this.animals.delete(a.id);
    const A = ANIMALS[a.type], s = P.u.save;
    s.meat += A.meat; s.stats.animals++;
    this.bc({ t: 'ev', k: 'adie', id: a.id, x: r1(a.x), z: r1(a.z), type: a.type });
    this.toast(P, '+' + A.meat + ' vlees (' + A.name + ')', '#e58b7b');
    this.sendInv(P); this.markDirty();
  }

  // ------------------------------------------------------------ dieren
  spawnAnimal(nearSpawn = false) {
    const players = [...this.players.values()];
    for (let tries = 0; tries < 8; tries++) {
      const pt = nearSpawn ? this.world.landPoint(Math.random, 0, 0, 18, 70, 0.6) : this.world.landPoint(Math.random, 0, 0, 10, HALF * 0.85, 0.6);
      if (!pt) continue;
      if (players.some(p => len(p.x - pt.x, p.z - pt.z) < 25)) continue;
      const roll = Math.random(), type = roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2;
      const A = ANIMALS[type];
      const a = { id: this.eid++, type, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, hp: A.hp, maxhp: A.hp, stun: 0, wt: Math.random() * 4, dir: null, angry: false, nextAtk: 0, hurtT: -99 };
      this.animals.set(a.id, a);
      return a;
    }
    return null;
  }

  /** Beweegt entiteit richting (nx,nz) met botsing tegen water en bomen. */
  move(e, nx, nz, r) {
    const w = this.world, lim = HALF - 10, rr = len(nx, nz);
    if (rr > lim) { nx *= lim / rr; nz *= lim / rr; }
    let x = nx, z = nz;
    if (w.heightAt(x, z) < WATER + 0.9) {
      if (w.heightAt(nx, e.z) >= WATER + 0.9) { z = e.z; }
      else if (w.heightAt(e.x, nz) >= WATER + 0.9) { x = e.x; }
      else return;
    }
    w.gNear(x, z, o => {
      if (o.type && this.felled.has(o.idx)) return;
      const dx = x - o.x, dz = z - o.z, d = len(dx, dz), min = o.r + r;
      if (d < min && d > 0.0001) { x = o.x + dx / d * min; z = o.z + dz / d * min; }
    });
    e.x = x; e.z = z;
  }

  nearest(list, x, z, maxD) {
    let b = null, bd = maxD;
    for (const p of list) { const d = len(p.x - x, p.z - z); if (d < bd) { bd = d; b = p; } }
    return b;
  }

  updateMonsters(dt) {
    const alive = [...this.players.values()].filter(p => !p.dead);
    const arr = [...this.monsters.values()];
    for (const m of arr) {
      if (m.stun > 0) { m.stun -= dt; continue; }
      const M = MONSTERS[m.type];
      m.retarget -= dt;
      if (m.retarget <= 0 || !m.target || m.target.dead || !this.players.has(m.target.id)) {
        m.retarget = 0.6; m.target = this.nearest(alive, m.x, m.z, 400);
      }
      const tg = m.target; if (!tg) continue;
      let dx = tg.x - m.x, dz = tg.z - m.z, d = len(dx, dz);
      if (d > 140) {   // te ver weg geraakt: dichter bij de speler zetten
        const pt = this.world.landPoint(Math.random, tg.x, tg.z, 45, 60, 0.0);
        if (pt) { m.x = pt.x; m.z = pt.z; dx = tg.x - m.x; dz = tg.z - m.z; d = len(dx, dz); }
      }
      m.yaw = Math.atan2(-dx, -dz);
      const reach = M.r + 0.9;
      if (d > reach) {
        const step = Math.min(d - reach * 0.8, m.speed * dt);
        this.move(m, m.x + dx / d * step, m.z + dz / d * step, M.r);
      } else if (this.T >= m.nextAtk) {
        m.nextAtk = this.T + M.atkCd;
        this.hurt(tg, m.dmg, m);
      }
    }
    // niet op elkaar stapelen
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j], dx = b.x - a.x, dz = b.z - a.z, d = len(dx, dz), min = MONSTERS[a.type].r + MONSTERS[b.type].r;
      if (d < min && d > 0.001) { const push = (min - d) * 0.5; a.x -= dx / d * push; a.z -= dz / d * push; b.x += dx / d * push; b.z += dz / d * push; }
    }
  }

  updateAnimals(dt) {
    const alive = [...this.players.values()].filter(p => !p.dead);
    for (const a of this.animals.values()) {
      if (a.stun > 0) { a.stun -= dt; continue; }
      const A = ANIMALS[a.type];
      const near = this.nearest(alive, a.x, a.z, A.flee || 25);
      if (a.type === 2) {                       // everzwijn: valt aan als je hem verwondt
        if (a.angry && this.T - a.hurtT > 12) a.angry = false;
        const tg = a.angry ? this.nearest(alive, a.x, a.z, 30) : null;
        if (tg) {
          const dx = tg.x - a.x, dz = tg.z - a.z, d = len(dx, dz);
          a.yaw = Math.atan2(-dx, -dz);
          if (d > 1.5) { const s = Math.min(d - 1.2, (A.speed + 1.5) * dt); this.move(a, a.x + dx / d * s, a.z + dz / d * s, A.r); }
          else if (this.T >= a.nextAtk) { a.nextAtk = this.T + 1.4; this.hurt(tg, A.dmg, a); }
          continue;
        }
      } else if (near) {                        // vluchten
        const dx = a.x - near.x, dz = a.z - near.z, d = len(dx, dz) || 1;
        a.yaw = Math.atan2(-dx, -dz);
        this.move(a, a.x + dx / d * A.speed * dt, a.z + dz / d * A.speed * dt, A.r);
        a.dir = null; continue;
      }
      // rondlopen
      a.wt -= dt;
      if (a.wt <= 0) {
        a.wt = 2 + Math.random() * 5;
        a.dir = Math.random() < 0.35 ? null : Math.random() * 6.28;
      }
      if (a.dir !== null) {
        const dx = Math.cos(a.dir), dz = Math.sin(a.dir);
        a.yaw = Math.atan2(-dx, -dz);
        this.move(a, a.x + dx * 1.7 * dt, a.z + dz * 1.7 * dt, A.r);
      }
    }
    this.animalTimer -= dt;
    if (this.animalTimer <= 0) { this.animalTimer = 6; if (this.animals.size < CFG.animalTarget) this.spawnAnimal(); }
  }

  // ------------------------------------------------------------ hoofdlus
  update(dt) {
    this.T += dt; this.tickN++;
    for (const P of this.players.values()) {
      if (P.dead) { if (this.T >= P.respawnAt) this.respawn(P); continue; }
      P.hunger = Math.max(0, P.hunger - CFG.hungerRate * dt);
      P.u.save.stats.playSec += dt;
      if (P.hunger <= 0) {
        P.starve += dt;
        if (P.starve >= 1.5) { P.starve = 0; this.hurt(P, 4, null); if (P.dead) continue; }
      } else if (P.hunger >= 40 && this.T - P.lastHurt > 6 && P.hp < 100) P.hp = Math.min(100, P.hp + 1.5 * dt);
      if (P.pendingHit >= 0 && this.T >= P.pendingHit) { P.pendingHit = -1; this.resolveHit(P); }
    }

    const w = this.wave;
    if (w.ph === 0) { w.t -= dt; if (w.t <= 0) this.startWave(); }
    else if (this.monsters.size === 0) this.endWave();

    this.updateMonsters(dt);
    this.updateAnimals(dt);

    if (this.tickN % 20 === 0) {
      for (const [i, t] of this.felled) if (this.T >= t) { this.felled.delete(i); this.treeHp[i] = this.world.trees[i].hp0; this.bc({ t: 'ev', k: 'treeBack', i }); }
      for (const [i, t] of this.chestOpen) if (this.T >= t) { this.chestOpen.delete(i); this.bc({ t: 'ev', k: 'chestBack', i }); }
    }
    if (this.tickN % 2 === 0) this.snapshot();
  }

  snapshot() {
    const p = [], m = [], a = [];
    for (const P of this.players.values()) p.push([P.id, r1(P.x), r1(P.y), r1(P.z), r2(P.yaw), Math.round(P.hp), eqCode(this.eqItem(P)), P.dead ? 1 : 0, P.swings]);
    for (const e of this.monsters.values()) m.push([e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]);
    for (const e of this.animals.values()) a.push([e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]);
    const head = JSON.stringify({ t: 's', p, m, a, w: { n: this.wave.n, ph: this.wave.ph, t: Math.max(0, Math.ceil(this.wave.t)), left: this.monsters.size } }).slice(0, -1);
    for (const P of this.players.values()) {
      const you = { hp: Math.round(P.hp), hu: Math.round(P.hunger), sc: P.u.save.stats.score, rs: P.dead ? Math.max(0, Math.ceil(P.respawnAt - this.T)) : 0 };
      P.conn.send(head + ',"y":' + JSON.stringify(you) + '}');
    }
  }
}
