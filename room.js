// Autoritatieve spelsimulatie voor één kamer: spelers, monsterjacht in golven, dieren, honger, bomen en kisten.

import { createWorld, HALF, WATER } from './public/world.js';
import { rollSword, rollSwordOfRarity, AXE, MAX_SWORDS, MONSTERS, ANIMALS, eqCode, SHOP, SHIELD_REDUCE, MAX_POTIONS, DOG_NAMES, DOG_MAX_LEVEL, DOG_FURS, dogStats, dogXpNeeded, DOG_BOOST_SEC, DOG_BOOST_MAX, TRADER_ITEMS, WEATHERS, BIOMES, DOG_BREEDS, breedOf, potGoal, FEAST_SEC, WAVE_MODS, HEAVY_MUL, ROLL_CD, ROLL_IFRAME, BLOCK_MELEE } from './public/items.js';
import { levelInfo, XP, TALENTS, TALENT_BY_ID, talentPoints, spentPoints, tal, maxHp, today, dailyQuests, ACHIEVEMENTS, FORGE_MAX, forgeCost, forgeGain, meltValue, swordLabel } from './public/progress.js';
import { bump, maxOf } from './stats.js';
import { BUILDS, BUILD_BY_ID, BUILD_RANGE, BUILD_MAX_ROOM, BUILD_MAX_PLAYER, BUILD_REFUND, FIRE_RADIUS, pushOut, canPlace, boundR } from './public/builds.js';

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const CFG = {
  firstWave: num(process.env.FIRST_WAVE_DELAY, 45),   // seconden tot golf 1
  waveGap: num(process.env.WAVE_GAP, 120),            // seconden tussen "laatste vijand weg" en volgende golf
  wipeDelay: 25,
  respawn: 8,
  hungerRate: num(process.env.HUNGER_RATE, 0.22),     // punten per seconde (100 -> 0 in ~7,5 min)
  treeRespawn: 240, chestRespawn: 600,
  animalTarget: 38,
  maxSpeed: num(process.env.MAX_SPEED, 14),   // m/s: rennen is 9, met marge voor springen en vertraging
  strays: num(process.env.STRAY_DOGS, 3), strayRespawn: 180, dogDown: 20,
  cheats: process.env.ALLOW_CHEATS === '1',   // alleen voor testen: /spawn <type> [n], /golf [mod], /hout <n>
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
  s.fish = Math.max(0, s.fish | 0);
  s.up = Object.assign({ shield: 0, axe: 0, rod: 0 }, s.up || {}); s.up.rod = clamp(s.up.rod | 0, 0, 1); s.up.shield = clamp(s.up.shield | 0, 0, 3); s.up.axe = clamp(s.up.axe | 0, 0, 3);
  if (!Array.isArray(s.swords)) s.swords = [];
  s.equip = clamp(s.equip | 0, 0, s.swords.length);
  if (s.dog && (typeof s.dog.name !== 'string' || !Number.isFinite(s.dog.level))) s.dog = null;
  if (s.dog) { s.dog.breed = breedOf(s.dog.breed).id; s.dog.level = clamp(s.dog.level | 0, 1, DOG_MAX_LEVEL); s.dog.xp = Math.max(0, s.dog.xp | 0); s.dog.fur = clamp(s.dog.fur | 0, 0, DOG_FURS.length - 1); }
  if (!Number.isInteger(s.look) || s.look < 0 || s.look > 3) { let h = 0; for (const ch of String(u.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; s.look = h % 4; }
  s.stats = Object.assign({ kills: 0, deaths: 0, bestWave: 0, score: 0, animals: 0, trees: 0, chests: 0, playSec: 0, built: 0, bosses: 0, fish: 0, ore: 0, forgedMax: 0, quests: 0, heavyKills: 0, dungeons: 0, pvpWins: 0, pvpLosses: 0, gifts: 0, feasts: 0 }, s.stats || {});
  if (!s.biomes || typeof s.biomes !== 'object') s.biomes = {};
  s.xp = Math.max(0, s.xp | 0); s.ore = Math.max(0, s.ore | 0);
  if (!s.tal || typeof s.tal !== 'object') s.tal = {};
  for (const k of Object.keys(s.tal)) { const T = TALENT_BY_ID[k]; if (!T) delete s.tal[k]; else s.tal[k] = clamp(s.tal[k] | 0, 0, T.max); }
  if (spentPoints(s.tal) > talentPoints(levelInfo(s.xp).level)) s.tal = {};
  if (!s.ach || typeof s.ach !== 'object') s.ach = {};
  for (const w of s.swords) { if (!Number.isFinite(w.d0)) w.d0 = w.damage; w.f = clamp(w.f | 0, 0, FORGE_MAX); }
  ensureDaily(u);
  return s;
}
/** Dagelijkse opdrachten verversen als de dag om is. */
export function ensureDaily(u) {
  const s = u.save, day = today();
  if (!s.daily || s.daily.day !== day || !Array.isArray(s.daily.q)) s.daily = { day, q: dailyQuests(u.name, day) };
  return s.daily;
}
/** Talent kopen of alles terugzetten (lobby en kamer). Geeft true als er iets veranderde. */
export function applyTalent(s, id) {
  if (id === 'reset') { if (!spentPoints(s.tal)) return false; s.tal = {}; return true; }
  const T = TALENT_BY_ID[id]; if (!T) return false;
  const cur = s.tal[id] | 0, free = talentPoints(levelInfo(s.xp).level) - spentPoints(s.tal);
  if (cur >= T.max || free <= 0) return false;
  s.tal[id] = cur + 1; return true;
}

export class Room {
  constructor(id, name, max, permanent, markDirty, store = null) {
    this.id = id; this.name = name; this.max = max; this.permanent = permanent; this.markDirty = markDirty;
    this.store = store || {};                                  // blijvende kamerdata (vaste kamers: in db.json)
    this.seed = Number.isInteger(this.store.seed) ? this.store.seed : 1 + Math.floor(Math.random() * 9000);
    this.store.seed = this.seed;
    this.builds = new Map(); this.bid = 1;
    if (!this.store.pot || typeof this.store.pot !== 'object') this.store.pot = { have: 0, lvl: 1 };
    for (const b of Array.isArray(this.store.builds) ? this.store.builds : []) {
      if (!BUILD_BY_ID[b.kind]) continue;
      const B = BUILD_BY_ID[b.kind], o = { id: this.bid++, kind: b.kind, x: +b.x, z: +b.z, rot: +b.rot || 0, hp: Math.min(B.hp, +b.hp || B.hp), maxhp: B.hp, owner: String(b.owner || ''), nextShot: 0 };
      if (Number.isFinite(o.x) && Number.isFinite(o.z)) this.builds.set(o.id, o);
    }
    this.world = getWorld(this.seed);
    this.players = new Map(); this.nextPid = 1;
    this.emptySince = null;
    this.reset();
  }

  reset() {
    this.T = 0; this.tickN = 0; this.eid = 1;
    this.monsters = new Map(); this.animals = new Map(); this.dogs = new Map(); this.strayAt = 0;
    this.treeHp = Float32Array.from(this.world.trees, t => t.hp0);
    this.felled = new Map();      // idx -> respawn time
    this.chestOpen = new Map();   // idx -> reset time
    this.wave = { n: 0, ph: 0, t: CFG.firstWave, mod: null };   // ph 0 = wachten, 1 = gevecht
    this.projs = []; this.hazards = [];
    this.oreLeft = Int8Array.from(this.world.ores, o => o.rich ? 6 : 4); this.oreBack = new Map();
    this.ruinSt = this.world.ruins.map(() => ({ st: 'idle', guards: new Set(), until: 0 }));
    this.weather = { k: 'helder', until: 150 + Math.random() * 150, bolt: 0 };
    this.trader = null; this.traderAt = 240 + Math.random() * 240;
    this.animalTimer = 0;
    this.rand = Math.random;
    for (let i = 0; i < CFG.animalTarget; i++) this.spawnAnimal(i < 8);
    for (let i = 0; i < CFG.strays; i++) this.spawnStray();
    for (const P of this.players.values()) if (P.u.save.dog) this.spawnOwnedDog(P);
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
    this.checkAch(P);
    P.conn.send({ t: 'inv', wood: s.wood, meat: s.meat, potions: s.potions, fish: s.fish, ore: s.ore, up: s.up, dog: s.dog || null, swords: s.swords, equip: s.equip, stats: s.stats, xp: s.xp, tal: s.tal, daily: s.daily, ach: s.ach });
  }
  // ------------------------------------------------------------ voortgang
  applyStats(P) {
    const old = P.mhp || 100; P.mhp = maxHp(P.u.save); if (P.mhp > old && !P.dead) P.hp += P.mhp - old; P.hp = Math.min(P.hp, P.mhp);
    if (P.dog) { const st = this.dogStatsFor(P, P.dog.level); P.dog.dmg = st.dmg; const f = P.dog.hp / P.dog.maxhp; P.dog.maxhp = st.maxhp; P.dog.hp = Math.round(st.maxhp * f); }
  }
  dogStatsFor(P, level) {
    const st = dogStats(level), k = 1 + 0.1 * (P ? tal(P.u.save, 'baasje') : 0), B = breedOf(P && P.u.save.dog ? P.u.save.dog.breed : 'herder');
    return { ...st, maxhp: Math.round(st.maxhp * k * B.hp), dmg: st.dmg * k * B.dmg, speed: st.speed * B.spd };
  }
  addXp(P, n) {
    const s = P.u.save, before = levelInfo(s.xp).level;
    s.xp += Math.round(n);
    const after = levelInfo(s.xp).level;
    if (after > before) {
      this.toast(P, '⭐ Niveau ' + after + '! Je hebt een talentpunt te besteden (pauzemenu of lobby).', '#f2c14e');
      this.bc({ t: 'ev', k: 'plvl', id: P.id, lvl: after });
    }
  }
  quest(P, kind, n = 1, best = false) {
    const d = ensureDaily(P.u), s = P.u.save;
    for (const q of d.q) {
      if (q.kind !== kind || q.done) continue;
      q.have = best ? Math.max(q.have, n) : q.have + n;
      if (q.have >= q.need) {
        q.have = q.need; q.done = true; s.wood += q.wood; s.stats.quests++; bump('quest.' + q.kind);
        this.addXp(P, q.xp);
        P.conn.send({ t: 'ev', k: 'quest', q });
        this.toast(P, '📅 Opdracht voltooid! +' + q.wood + ' hout en +' + q.xp + ' ervaring', '#6fd37a');
      }
    }
  }
  checkAch(P) {
    const s = P.u.save;
    for (const A of ACHIEVEMENTS) if (!s.ach[A.id] && A.test(s)) {
      s.ach[A.id] = Date.now(); this.markDirty();
      P.conn.send({ t: 'ev', k: 'ach', id: A.id });
      this.bc({ t: 'toast', msg: P.name + ' behaalde de prestatie "' + A.name + '"', color: '#f2c14e' }, P);
    }
  }
  mine(P, o, heavy) {
    const s = P.u.save;
    this.bc({ t: 'ev', k: 'mine', i: o.idx });
    if (this.oreLeft[o.idx] <= 0) { this.toast(P, 'Deze ertsader is leeg. Hij groeit over een paar minuten terug.', '#bbb'); return; }
    const chance = 0.4 + 0.15 * tal(s, 'mijnwerker') + 0.05 * s.up.axe + (heavy ? 0.25 : 0);
    if (Math.random() >= chance) return;
    const n = o.rich && Math.random() < 0.4 ? 2 : 1;
    s.ore += n; s.stats.ore += n; this.oreLeft[o.idx]--;
    this.addXp(P, XP.ore * n); this.quest(P, 'ore', n);
    P.conn.send({ t: 'loot', kind: 'ore', n });
    if (this.oreLeft[o.idx] <= 0) { this.oreBack.set(o.idx, this.T + 300); this.bc({ t: 'ev', k: 'oreGone', i: o.idx }); }
    this.sendInv(P); this.markDirty();
  }
  nearSmith(P) { const sm = this.world.smith; return !P.dead && len(sm.x - P.x, sm.z - P.z) < 7; }
  forge(P, i) {
    const s = P.u.save, sw = s.swords[i];
    if (!sw || !this.nearSmith(P)) return;
    if ((sw.f | 0) >= FORGE_MAX) return this.toast(P, 'Dit zwaard is al +' + FORGE_MAX + '.', '#bbb');
    const c = forgeCost(sw.f | 0);
    if (s.ore < c.ore || s.wood < c.wood) return this.toast(P, 'Je hebt ' + c.ore + ' erts en ' + c.wood + ' hout nodig.', '#ff9c8a');
    s.ore -= c.ore; s.wood -= c.wood; s.stats.spent = (s.stats.spent | 0) + c.wood;
    if (!Number.isFinite(sw.d0)) sw.d0 = sw.damage;
    sw.damage += forgeGain(sw); sw.f = (sw.f | 0) + 1; bump('forge'); s.stats.forgedMax = Math.max(s.stats.forgedMax, sw.f);
    this.toast(P, '⚒️ ' + swordLabel(sw) + ' · schade ' + sw.damage, '#f2c14e');
    P.conn.send({ t: 'ev', k: 'forged', i });
    this.sendInv(P); this.markDirty();
  }
  melt(P, i) {
    const s = P.u.save, sw = s.swords[i];
    if (!sw || !this.nearSmith(P)) return;
    const n = meltValue(sw);
    s.swords.splice(i, 1); s.ore += n; bump('melt');
    if (s.equip === i + 1) s.equip = 0; else if (s.equip > i + 1) s.equip--;
    this.toast(P, swordLabel(sw) + ' omgesmolten: +' + n + ' erts', '#c8c8d0');
    this.sendInv(P); this.markDirty();
  }
  toast(P, msg, color = '#fff') { P.conn.send({ t: 'toast', msg, color }); }

  addPlayer(conn) {
    const u = conn.user, s = ensureSave(u);
    const sp = this.world.spawn;
    const P = {
      id: this.nextPid++, conn, u, name: u.name, isPlayer: true,
      x: sp.x + (Math.random() - 0.5) * 3, z: sp.z + (Math.random() - 0.5) * 3, y: 0, yaw: 0.4, pitch: 0,
      hp: 100, hunger: 80, dead: false, respawnAt: 0, swings: 0, nextSwing: 0, pendingHit: -1, lastHurt: -99, lastEat: -9, starve: 0,
    };
    P.y = this.world.heightAt(P.x, P.z); P.mhp = maxHp(s); P.hp = P.mhp;
    this.players.set(P.id, P); this.emptySince = null;
    if (s.dog) this.spawnOwnedDog(P);
    bump('sessions');
    this.bc({ t: 'pjoin', id: P.id, name: P.name, look: s.look }, P);
    conn.send({
      t: 'joined', now: Date.now(),
      room: { id: this.id, name: this.name, seed: this.seed, max: this.max },
      you: { id: P.id, name: P.name, x: P.x, y: P.y, z: P.z },
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, look: p.u.save.look })),
      felled: [...this.felled.keys()], chests: [...this.chestOpen.keys()], ores: [...this.oreBack.keys()],
      builds: [...this.builds.values()].map(b => this.btuple(b)),
      ruins: this.ruinSt.map(r => r.st), weather: this.weather.k, trader: this.traderInfo(), pot: this.potInfo(),
    });
    this.sendInv(P);
    return P;
  }

  removePlayer(P) {
    this.endFishing(P);
    if (P.dog) { this.dogs.delete(P.dog.id); P.dog = null; }
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
        let x = num(m.x, P.x), z = num(m.z, P.z);
        // anti-valsspelen: niet verder dan rennen (+ marge) sinds het vorige bericht
        const since = Math.min(2, Math.max(0.05, this.T - (P.lastInT ?? this.T - 0.1)));
        const rolling = this.T < (P.rollUntil || 0) + 0.3;
        const allowed = CFG.maxSpeed * since + 1.5 + (rolling ? 9 : 0), moved = len(x - P.x, z - P.z);
        P.lastInT = this.T;
        if (moved > allowed) {
          P.cheatHits = (P.cheatHits || 0) + 1;
          if (this.T - (P.lastCorrect || -9) > 0.4) { P.lastCorrect = this.T; P.conn.send({ t: 'correct', x: r2(P.x), y: r2(P.y), z: r2(P.z) }); }
          x = P.x; z = P.z;
        }
        const r = len(x, z), lim = HALF - 6, k = r > lim ? lim / r : 1;
        if (this.T < (P.rootUntil || 0)) { x = P.x; z = P.z; }       // vastgegroeid door de Woudreus
        P.vx = (x * k - P.x) / since; P.vz = (z * k - P.z) / since;
        P.x = x * k; P.z = z * k;
        const h = this.world.heightAt(P.x, P.z);
        P.y = clamp(num(m.y, h), h - 1, h + 14);
        P.yaw = num(m.yaw, P.yaw); P.pitch = clamp(num(m.pitch, 0), -1.5, 1.5);
        break;
      }
      case 'swing': this.swing(P, !!m.heavy); break;
      case 'roll': {
        if (P.dead || this.T < (P.rollCd || 0) || this.T < (P.rootUntil || 0)) return;
        P.rollCd = this.T + ROLL_CD - 0.1 * tal(P.u.save, 'vlug'); P.iframe = this.T + ROLL_IFRAME; P.rollUntil = this.T + 0.5; P.blocking = false;
        this.bc({ t: 'ev', k: 'roll', id: P.id }, P); break;
      }
      case 'block': { const on = !!m.on && !P.dead; if (on !== !!P.blocking) { P.blocking = on; this.bc({ t: 'ev', k: 'block', id: P.id, on }, P); } break; }
      case 'open': this.openChest(P, m.i | 0); break;
      case 'equip': {
        const s = P.u.save, i = m.i | 0;
        if (i >= 0 && i <= s.swords.length) { s.equip = i; this.markDirty(); this.sendInv(P); }
        break;
      }
      case 'eat': this.eat(P); break;
      case 'drink': this.drink(P); break;
      case 'buy': this.buy(P, String(m.id)); break;
      case 'tame': this.tame(P, m.id | 0); break;
      case 'chat': {
        if (this.T - (P.lastChat || -9) < 0.8) return;
        const text = String(m.text || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 140);
        if (!text) return;
        if (CFG.cheats && text.startsWith('/')) { this.cheat(P, text.slice(1).split(/\s+/)); return; }
        P.lastChat = this.T;
        this.bc({ t: 'chat', id: P.id, name: P.name, text, ping: m.ping ? { x: r1(P.x), z: r1(P.z) } : null });
        break;
      }
      case 'build': this.build(P, String(m.kind), num(m.x, NaN), num(m.z, NaN), num(m.rot, 0)); break;
      case 'unbuild': this.unbuild(P, m.id | 0); break;
      case 'talent': if (applyTalent(P.u.save, String(m.id))) { this.applyStats(P); this.sendInv(P); this.markDirty(); } break;
      case 'forge': this.forge(P, m.i | 0); break;
      case 'melt': this.melt(P, m.i | 0); break;
      case 'ruin': this.ruin(P, m.i | 0); break;
      case 'dogcmd': this.dogCmd(P, String(m.c), m.id | 0); break;
      case 'give': this.give(P, m.to | 0, String(m.what), m.n | 0, m.i | 0); break;
      case 'deposit': this.deposit(P, m.n | 0); break;
      case 'tbuy': this.traderBuy(P, String(m.id)); break;
      case 'cast': this.cast(P, num(m.x, NaN), num(m.z, NaN)); break;
      case 'reel': this.reel(P); break;
      case 'feeddog': this.feedDog(P); break;
    }
  }

  eqItem(P) {
    const s = P.u.save;
    return s.equip === 0 ? AXE : (s.swords[s.equip - 1] || AXE);
  }

  swing(P, heavy = false) {
    if (P.dead || P.blocking || this.T < P.nextSwing) return;
    const it = this.eqItem(P);
    P.nextSwing = this.T + 0.5 / (it.speed || 1) * 0.92 * (heavy ? 1.5 : 1);
    P.swings = (P.swings + 1) & 255;
    P.pendingHit = this.T + (heavy ? 0.3 : 0.2); P.heavy = heavy;
  }

  resolveHit(P) {
    const it = this.eqItem(P), s = P.u.save, heavy = !!P.heavy; P.heavy = false;
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    let best = null, bd = 1e9, kind = null;
    const reachM = heavy ? 3.4 : 2.9, dotM = heavy ? 0.15 : 0.4, extra = [];
    const test = (e, r, reach, minDot, k) => {
      const dx = e.x - P.x, dz = e.z - P.z, d = len(dx, dz);
      if (d > reach + r || d < 0.0001) return;
      if ((dx * fx + dz * fz) / d < minDot) return;
      if (heavy && k !== 't') extra.push([e, k]);
      if (d < bd) { bd = d; best = e; kind = k; }
    };
    for (const m of this.monsters.values()) test(m, MONSTERS[m.type].r, reachM, dotM, 'm');
    for (const a of this.animals.values()) test(a, ANIMALS[a.type].r, reachM, dotM, 'a');
    if (this.inArena(P)) for (const Q of this.players.values()) if (Q !== P && !Q.dead && this.inArena(Q)) test(Q, 0.4, reachM, dotM, 'p');
    if (best && kind === 'p') { this.hitPlayer(P, it, best, heavy); return; }
    if (heavy && extra.length > 1) {           // zware slag raakt tot 4 vijanden tegelijk
      extra.sort((a, b) => len(a[0].x - P.x, a[0].z - P.z) - len(b[0].x - P.x, b[0].z - P.z));
      for (const [e, k] of extra.slice(1, 4)) this.hitEnemy(P, it, e, k, true);
    }
    if (!best) {
      for (const t of this.world.trees) {
        if (this.felled.has(t.idx)) continue;
        if (Math.abs(t.x - P.x) > 5 || Math.abs(t.z - P.z) > 5) continue;
        test(t, t.r, 3.1, 0.6, 't');
      }
      for (const o of this.world.ores) {
        if (Math.abs(o.x - P.x) > 5 || Math.abs(o.z - P.z) > 5) continue;
        test(o, o.r, 3.0, 0.5, 'o');
      }
    }
    if (!best) return;
    if (kind === 'm' || kind === 'a') this.hitEnemy(P, it, best, kind, heavy);
    else if (kind === 'o') this.mine(P, best, heavy);
    else {
      const dmg = (it.type === 'axe' ? 1 + s.up.axe : Math.max(0.15, it.damage / 60)) * (heavy ? 2 : 1);
      this.treeHp[best.idx] -= dmg;
      this.bc({ t: 'ev', k: 'chop', i: best.idx });
      if (this.treeHp[best.idx] <= 0) {
        const dx = best.x - P.x, dz = best.z - P.z, d = len(dx, dz) || 1;
        this.felled.set(best.idx, this.T + CFG.treeRespawn);
        const n = 3 + Math.floor(best.scale * 2) + tal(s, 'houthakker');
        s.wood += n; s.stats.trees++; this.addXp(P, XP.tree); this.quest(P, 'tree');
        this.bc({ t: 'ev', k: 'felled', i: best.idx, dx: r2(dx / d), dz: r2(dz / d) });
        this.toast(P, '+' + n + ' hout', '#c89a5e');
        this.sendInv(P); this.markDirty();
      }
    }
  }

  cheat(P, [cmd, a, b]) {
    const sc = this.waveScale || { hp: 1, dmg: 1, spd: 1 };
    if (cmd === 'spawn') for (let i = 0; i < Math.min(10, +b || 1); i++) {
      const t = Math.max(0, Math.min(MONSTERS.length - 1, a | 0)), ang = Math.random() * 6.28, x = P.x + Math.cos(ang) * 12, z = P.z + Math.sin(ang) * 12;
      this.spawnMonster(t, x, z, sc.hp, sc.dmg, sc.spd); this.wave.ph = 1;
    }
    if (cmd === 'golf') { this.monsters.clear(); this.startWave(a || null); }
    if (cmd === 'god') P.god = !P.god;
    if (cmd === 'hond' && !P.u.save.dog) { P.u.save.dog = { name: 'Testje', level: 3, xp: 0, fur: 1, breed: breedOf(a).id }; this.spawnOwnedDog(P); this.sendInv(P); }
    if (cmd === 'weer') { this.weather.k = WEATHERS.some(w => w.k === a) ? a : 'onweer'; this.weather.until = this.T + 600; this.weather.bolt = this.T + 2; this.bc({ t: 'weather', k: this.weather.k }); }
    if (cmd === 'handelaar') { this.trader = null; this.traderAt = this.T; }
    if (cmd === 'zwaard') this.giveSword(P, rollSwordOfRarity(Math.max(0, Math.min(4, a | 0))), 'chest');
    if (cmd === 'erts') { P.u.save.ore += Math.min(1000, a | 0); this.sendInv(P); }
    if (cmd === 'xp') { this.addXp(P, Math.min(100000, a | 0)); this.sendInv(P); }
    if (cmd === 'hout') { P.u.save.wood += Math.min(10000, a | 0); this.sendInv(P); }
  }

  inArena(P) { const A = this.world.arena; return !!A && len(P.x - A.x, P.z - A.z) < A.r; }
  hitPlayer(P, it, Q, heavy) {
    const s = P.u.save, base = it.type === 'axe' ? AXE.damage + s.up.axe * 2 : it.damage;
    const dmg = Math.max(4, base * 0.5) * (heavy ? 1.8 : 1) * (1 + 0.06 * tal(s, 'kracht')) * (0.9 + Math.random() * 0.2);
    this.bc({ t: 'ev', k: 'phit', id: Q.id, by: P.id, dmg: Math.round(dmg), heavy: heavy ? 1 : 0 });
    this.hurt(Q, dmg, P, 'melee');
  }
  arenaKO(Q, P) {
    const A = this.world.arena, a = Math.random() * 6.28;
    Q.hp = Q.mhp; Q.x = A.x + Math.cos(a) * (A.r + 2.5); Q.z = A.z + Math.sin(a) * (A.r + 2.5); Q.y = this.world.heightAt(Q.x, Q.z); Q.lastInT = this.T; Q.blocking = false;
    Q.conn.send({ t: 'correct', x: r2(Q.x), y: r2(Q.y), z: r2(Q.z) });
    P.u.save.stats.pvpWins++; Q.u.save.stats.pvpLosses++; bump('duels');
    this.bc({ t: 'ev', k: 'duel', w: P.id, l: Q.id });
    this.toast(P, '⚔️ Je wint het duel van ' + Q.name + '!', '#f2c14e'); this.toast(Q, '⚔️ ' + P.name + ' wint het duel. Je staat buiten de arena.', '#ff9c8a');
    this.sendInv(P); this.sendInv(Q); this.markDirty();
  }

  // ------------------------------------------------------------ hond: commando's, geven, gemeenschapskist
  dogCmd(P, c, id) {
    const d = P.dog; if (!d || P.dead) return;
    if (d.state === 'down') return this.toast(P, d.name + ' rust nog uit.', '#bbb');
    if (c === 'follow') { d.cmd = 'follow'; d.stayAt = null; d.seek = null; d.target = null; }
    else if (c === 'stay') { d.cmd = 'stay'; d.stayAt = { x: d.x, z: d.z }; d.seek = null; d.target = null; }
    else if (c === 'attack') {
      const m = this.monsters.get(id) || this.animals.get(id), isMon = this.monsters.has(id);
      if (!m || len(m.x - P.x, m.z - P.z) > 40) return this.toast(P, 'Kijk naar een monster om ' + d.name + ' aan te laten vallen.', '#bbb');
      d.cmd = 'attack'; d.stayAt = null; d.seek = null; d.target = { isMon, e: m, forced: true }; d.retarget = 3;
    } else if (c === 'seek') {
      if (this.T < (d.seekCd || 0)) return this.toast(P, d.name + ' snuffelt nog. Probeer het over ' + Math.ceil(d.seekCd - this.T) + ' s opnieuw.', '#bbb');
      const range = d.breed === 'speur' ? 170 : 90; let best = null, bd = range;
      this.world.chests.forEach(c2 => { if (this.chestOpen.has(c2.idx)) return; const dd = len(c2.x - P.x, c2.z - P.z); if (dd < bd) { bd = dd; best = { kind: 'chest', i: c2.idx, x: c2.x, z: c2.z }; } });
      if (d.breed === 'speur') this.world.ores.forEach(o => { if (this.oreLeft[o.idx] <= 0) return; const dd = len(o.x - P.x, o.z - P.z) * 1.15; if (dd < bd) { bd = dd; best = { kind: 'ore', i: o.idx, x: o.x, z: o.z }; } });
      if (!best) return this.toast(P, d.name + ' vindt niets in de buurt.', '#bbb');
      d.seekCd = this.T + 30; d.cmd = 'seek'; d.seek = best; d.target = null;
      this.toast(P, '👃 ' + d.name + ' heeft een spoor! Volg hem.', '#f2c14e');
    } else return;
    this.bc({ t: 'ev', k: 'dogcmd', id: d.id, c: d.cmd });
  }
  give(P, to, what, n, i) {
    const Q = this.players.get(to), s = P.u.save;
    if (!Q || Q === P || P.dead || Q.dead || len(Q.x - P.x, Q.z - P.z) > 8) return this.toast(P, 'Ga dichter bij die speler staan (binnen 8 meter).', '#bbb');
    const t = Q.u.save; let label = '';
    if (what === 'sword') {
      const sw = s.swords[i]; if (!sw) return;
      if (t.swords.length >= MAX_SWORDS) return this.toast(P, Q.name + ' heeft geen plek meer voor een zwaard.', '#ff9c8a');
      s.swords.splice(i, 1); if (s.equip === i + 1) s.equip = 0; else if (s.equip > i + 1) s.equip--;
      t.swords.push(sw); label = sw.name + (sw.f ? ' +' + sw.f : '');
    } else if (['wood', 'meat', 'fish', 'ore', 'potions'].includes(what)) {
      n = Math.max(1, Math.min(n, s[what] | 0)); if (!(s[what] > 0)) return;
      if (what === 'potions') n = Math.min(n, MAX_POTIONS - t.potions); if (n <= 0) return this.toast(P, Q.name + ' kan niet meer drankjes dragen.', '#bbb');
      s[what] -= n; t[what] = (t[what] | 0) + n;
      label = n + ' ' + { wood: 'hout', meat: 'vlees', fish: 'vis', ore: 'erts', potions: 'drankje' + (n > 1 ? 's' : '') }[what];
    } else return;
    s.stats.gifts++;
    this.toast(P, '🎁 Je gaf ' + label + ' aan ' + Q.name + '.', '#6fd37a'); this.toast(Q, '🎁 ' + P.name + ' gaf je ' + label + '!', '#6fd37a');
    this.bc({ t: 'ev', k: 'gift', from: P.id, to: Q.id });
    this.sendInv(P); this.sendInv(Q); this.markDirty();
  }
  potInfo() { const p = this.store.pot; return { have: p.have | 0, goal: potGoal(p.lvl | 0 || 1), lvl: p.lvl | 0 || 1 }; }
  deposit(P, n) {
    const W = this.world, s = P.u.save, p = this.store.pot;
    if (P.dead || len(W.pot.x - P.x, W.pot.z - P.z) > 4.5) return;
    const goal = potGoal(p.lvl);
    n = Math.max(0, Math.min(n, s.wood, goal - p.have)); if (!n) return;
    s.wood -= n; p.have += n; s.stats.spent = (s.stats.spent | 0) + n;
    this.addXp(P, Math.floor(n / 5));
    if (p.have >= goal) {
      p.have = 0; p.lvl++;
      for (const Q of this.players.values()) {
        const t = Q.u.save; t.stats.feasts++;
        if (!Q.dead) { Q.hunger = 100; Q.hp = Q.mhp; }
        t.potions = Math.min(MAX_POTIONS, t.potions + 2);
        Q.buffs = Q.buffs || {}; Q.buffs.feast = this.T + FEAST_SEC;
        this.sendInv(Q);
      }
      this.bc({ t: 'ev', k: 'feast', by: P.id, lvl: p.lvl - 1 }); bump('feasts');
    }
    this.bc({ t: 'pot', ...this.potInfo(), by: P.id, n });
    this.sendInv(P); this.markDirty();
  }

  hitEnemy(P, it, e, kind, heavy) {
    const s = P.u.save, full = P.hunger >= 80 ? 1.15 : 1;   // goed gevoed = iets sterker
    const dmg = (it.type === 'axe' ? AXE.damage + s.up.axe * 2 : it.damage) * full * (0.9 + Math.random() * 0.2) * (heavy ? HEAVY_MUL : 1) * (1 + 0.06 * tal(s, 'kracht')) * (this.buff(P, 'elixir') ? 1.25 : 1) * (this.buff(P, 'feast') ? 1.1 : 1);
    e.hp -= dmg; e.stun = heavy ? 0.5 : 0.18;
    if (heavy && !(kind === 'm' && e.type === 3)) {          // terugduwen (niet de baas)
      const dx = e.x - P.x, dz = e.z - P.z, d = len(dx, dz) || 1, r = kind === 'm' ? MONSTERS[e.type].r : ANIMALS[e.type].r;
      this.move(e, e.x + dx / d * 1.4, e.z + dz / d * 1.4, r);
    }
    if (kind === 'a') { e.angry = true; e.hurtT = this.T; }
    this.bc({ t: 'ev', k: 'hit', e: kind, id: e.id, dmg: Math.round(dmg), x: r1(e.x), z: r1(e.z), heavy: heavy ? 1 : 0 });
    if (e.hp <= 0) { if (kind === 'm') { this.killMonster(e, P); if (heavy) { s.stats.heavyKills++; this.quest(P, 'heavy'); } } else this.killAnimal(e, P); }
  }

  eat(P) {
    const s = P.u.save;
    if (P.dead || this.T - P.lastEat < 0.7) return;
    if (s.meat <= 0) { this.toast(P, 'Je hebt geen vlees. Jaag op dieren met je zwaard.', '#ff9c8a'); return; }
    if (P.hunger > 92) { this.toast(P, 'Je bent nog vol.', '#bbb'); return; }
    P.lastEat = this.T; s.meat--;
    P.hunger = Math.min(100, P.hunger + 30);
    P.hp = Math.min(P.mhp, P.hp + 8);
    P.conn.send({ t: 'ev', k: 'ate' });
    this.sendInv(P); this.markDirty();
  }

  drink(P) {
    const s = P.u.save;
    if (P.dead || this.T - (P.lastDrink || -9) < 1) return;
    if (s.potions <= 0) { this.toast(P, 'Je hebt geen helende drank. Koop er een in de winkel.', '#ff9c8a'); return; }
    if (P.hp >= P.mhp) { this.toast(P, 'Je gezondheid is al vol.', '#bbb'); return; }
    P.lastDrink = this.T; s.potions--; P.hp = Math.min(P.mhp, P.hp + 50);
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
      case 'rod':
        if (s.up.rod) return fail('Je hebt al een vishengel.');
        s.up.rod = 1; break;
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
        s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost; bump("buy." + it.id);
        this.giveSword(P, sw, 'shop'); this.sendInv(P); this.markDirty();
        P.conn.send({ t: 'ev', k: 'bought' });
        return;
      }
    }
    s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost; bump("buy." + it.id);
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
    const s = P.u.save; s.stats.chests++; this.addXp(P, XP.chest); this.quest(P, 'chest');
    const r = Math.random();
    if (r < 0.62) this.giveSword(P, rollSword(Math.min(1.3, c.luck + (c.biome === 'dark' ? 0.3 : 0))), 'chest');
    else if (r < 0.80) { const n = 4 + Math.floor(Math.random() * 6); s.wood += n; P.conn.send({ t: 'loot', kind: 'wood', n }); }
    else if (r < 0.94) { const n = 2 + Math.floor(Math.random() * 2); s.meat += n; P.conn.send({ t: 'loot', kind: 'meat', n }); }
    else P.conn.send({ t: 'loot', kind: 'empty' });
    this.sendInv(P); this.markDirty();
  }

  giveSword(P, sw, src) {
    const s = P.u.save; sw.d0 = sw.damage; sw.f = 0;
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
  hurt(P, dmg, src, kind = 'melee', cause = null) {
    if (P.dead || P.god) return;
    P.cause = cause || (kind === 'arrow' ? 'schutter' : !src ? 'onbekend' : src.isPlayer ? 'speler' : src.angry !== undefined ? ANIMALS[src.type].key : src.abRoots !== undefined ? MONSTERS[src.type].key : 'onbekend');
    if (src && this.T < (P.iframe || 0)) { P.conn.send({ t: 'ev', k: 'dodged' }); return; }
    if (src && P.blocking) {
      const dx = src.x - P.x, dz = src.z - P.z, d = len(dx, dz) || 1;
      if ((dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / d > 0.35) {
        dmg *= kind === 'arrow' ? 0 : BLOCK_MELEE;
        if (kind !== 'arrow' && src.stun !== undefined) src.stun = Math.max(src.stun, 0.35);
        this.bc({ t: 'ev', k: 'blocked', id: P.id, x: r1(P.x), z: r1(P.z) });
        if (dmg <= 0) return;
      }
    }
    dmg *= (1 - SHIELD_REDUCE[P.u.save.up.shield]) * (this.buff(P, 'feast') ? 0.9 : 1);
    P.hp -= dmg; P.lastHurt = this.T;
    P.conn.send({ t: 'hurt', dmg: Math.round(dmg), x: src ? r1(src.x) : null, z: src ? r1(src.z) : null });
    if (P.hp <= 0) { if (src && src.isPlayer && this.inArena(P)) this.arenaKO(P, src); else this.die(P); }
  }

  die(P) {
    P.hp = 0; P.dead = true; P.blocking = false; P.respawnAt = this.T + CFG.respawn; P.pendingHit = -1;
    const s = P.u.save; s.stats.deaths++; s.wood = Math.floor(s.wood / 2);
    bump('deaths'); bump('death.' + (P.cause || 'onbekend'));
    P.conn.send({ t: 'dead', in: CFG.respawn });
    this.bc({ t: 'ev', k: 'pdead', id: P.id });
    this.sendInv(P); this.markDirty();
    if ([...this.players.values()].every(p => p.dead)) this.wipe();
  }

  respawn(P) {
    const sp = this.world.spawn;
    P.dead = false; P.hp = P.mhp; P.hunger = Math.max(P.hunger, 50);
    P.x = sp.x + (Math.random() - 0.5) * 4; P.z = sp.z + (Math.random() - 0.5) * 4;
    const bed = this.bedOf(P);
    if (bed) { const a = bed.rot + Math.PI / 2; P.x = bed.x + Math.sin(a) * 1.3; P.z = bed.z + Math.cos(a) * 1.3; }
    P.y = this.world.heightAt(P.x, P.z);
    P.lastInT = this.T;
    P.conn.send({ t: 'respawn', x: P.x, y: P.y, z: P.z });
  }

  wipe() {
    bump('wipe.' + String(this.wave.n).padStart(2, '0'));
    this.monsters.clear(); this.projs.length = 0; this.hazards.length = 0; this.wave.mod = null;
    this.wave.n = Math.max(0, this.wave.n - 1); this.wave.ph = 0; this.wave.t = CFG.wipeDelay;
    this.bc({ t: 'wave', ph: 0, n: this.wave.n, wipe: true, next: this.wave.t });
  }

  // ------------------------------------------------------------ golven en monsters
  pickAlive() { const a = [...this.players.values()].filter(p => !p.dead); return a[Math.floor(Math.random() * a.length)] || null; }

  startWave(forceMod = null) {
    const w = this.wave; w.n++; w.ph = 1; w.startT = this.T;
    const n = w.n, alive = [...this.players.values()].filter(p => !p.dead).length || 1;
    const mod = forceMod ? WAVE_MODS.find(x => x.id === forceMod) : (n >= 3 && n % 5 !== 0 && Math.random() < 0.45 ? WAVE_MODS[Math.floor(Math.random() * WAVE_MODS.length)] : null);
    w.mod = mod ? mod.id : null;
    const scale = { hp: (1 + 0.30 * (n - 1)) * (mod?.hp || 1), dmg: (1 + 0.12 * (n - 1)) * (mod?.dmg || 1), spd: Math.min(1.4, 1 + 0.02 * (n - 1)) * (mod?.spd || 1) };
    this.waveScale = scale;
    const hpMul = scale.hp * (1 + 0.15 * (alive - 1));
    const count = Math.min(80, Math.round((3 + 1.6 * n) * (0.7 + 0.3 * alive) * (mod?.count || 1)));
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
      const bossMul = type === 3 ? (1 + 0.25 * (n / 5 - 1)) : 1;
      this.spawnMonster(type, pt.x, pt.z, hpMul * bossMul, scale.dmg * bossMul, scale.spd); spawned++;
    }
    this.bc({ t: 'wave', ph: 1, n, boss, count: spawned, mod: w.mod });
    if (w.mod) bump('mod.' + w.mod);
  }

  spawnMonster(type, x, z, hpMul, dmgMul, spdMul) {
    const M = MONSTERS[type];
    const m = {
      id: this.eid++, type, x, z, yaw: 0, hp: M.hp * hpMul, maxhp: M.hp * hpMul,
      dmg: M.dmg * dmgMul, speed: M.speed * spdMul, nextAtk: 0, stun: 0, retarget: 0, target: null,
      abRoots: this.T + 6, abSummon: this.T + 12, lungeCd: 0, lungeUntil: 0, strafe: Math.random() < 0.5 ? 1 : -1,
    };
    this.monsters.set(m.id, m);
    return m;
  }

  endWave() {
    const w = this.wave, modW = w.mod ? 1.5 : 1; w.ph = 0; w.t = CFG.waveGap; w.mod = null;
    bump('waves'); bump('waveSec', this.T - (w.startT || this.T)); bump('wave.reached.' + String(w.n).padStart(2, '0')); maxOf('wave.max', w.n);
    this.projs.length = 0; this.hazards.length = 0;
    for (const P of this.players.values()) {
      if (P.dead) continue;
      const s = P.u.save; s.stats.bestWave = Math.max(s.stats.bestWave, w.n);
      this.addXp(P, XP.wave * w.n); this.quest(P, 'wave', w.n, true);
      const bonus = Math.round(w.n * 25 * modW); s.stats.score += bonus;
      P.hp = Math.min(P.mhp, P.hp + 30);
      const wb = Math.round(w.n * 3 * modW); s.wood += wb;
      this.toast(P, 'Golf ' + w.n + ' verslagen! +' + bonus + ' punten en +' + wb + ' hout', '#f2c14e');
      if (Math.random() < 0.4) this.giveSword(P, rollSword(Math.min(1, w.n / 12)), 'wave');
      this.sendInv(P);
    }
    this.markDirty();
    this.bc({ t: 'wave', ph: 0, n: w.n, cleared: true, next: w.t });
  }

  killMonster(m, P) {
    this.monsters.delete(m.id);
    if (m.guard !== undefined) this.guardGone(m);
    if (!P) { this.bc({ t: 'ev', k: 'mdie', id: m.id, x: r1(m.x), z: r1(m.z), type: m.type }); return; }
    const M = MONSTERS[m.type], s = P.u.save;
    s.stats.kills++; s.stats.score += M.score * Math.max(1, this.wave.n);
    if (m.type === 3) s.stats.bosses++;
    bump('kills'); bump('kill.' + M.key);
    this.addXp(P, M.score * XP.kill); this.quest(P, 'kill');
    this.bc({ t: 'ev', k: 'mdie', id: m.id, x: r1(m.x), z: r1(m.z), type: m.type });
    if (Math.random() < (m.type === 3 ? 1 : 0.06)) this.giveSword(P, rollSword(Math.min(1, this.wave.n / 12)), 'monster');
    this.sendInv(P); this.markDirty();
  }

  killAnimal(a, P) {
    this.animals.delete(a.id);
    const A = ANIMALS[a.type], s = P.u.save;
    s.meat += A.meat; s.stats.animals++; this.addXp(P, XP.animal); this.quest(P, 'animal');
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
    e.blockedBy = null;
    if (this.builds.size) for (const b of this.builds.values()) {
      const B = BUILD_BY_ID[b.kind]; if (!B.solid) continue;
      if (Math.abs(b.x - x) > boundR(B) + r + 0.2 || Math.abs(b.z - z) > boundR(B) + r + 0.2) continue;
      const q = pushOut(b, x, z, r); if (q) { x = q[0]; z = q[1]; e.blockedBy = b; }
    }
    e.x = x; e.z = z;
  }

  nearest(list, x, z, maxD) {
    let b = null, bd = maxD;
    for (const p of list) { const d = len(p.x - x, p.z - z); if (d < bd) { bd = d; b = p; } }
    return b;
  }

  targetOk(t) { return t && (t.isDog ? this.dogs.has(t.id) && t.state === 'follow' : !t.dead && this.players.has(t.id)); }
  updateMonsters(dt) {
    const alive = [...this.players.values()].filter(p => !p.dead);
    for (const d of this.dogs.values()) if (d.state === 'follow') alive.push(d);
    const arr = [...this.monsters.values()];
    for (const m of arr) {
      if (m.stun > 0) { m.stun -= dt; continue; }
      const M = MONSTERS[m.type];
      m.retarget -= dt;
      if (m.retarget <= 0 || !this.targetOk(m.target)) {
        m.retarget = 0.6;
        const dogT = M.hunter ? this.nearest([...this.dogs.values()].filter(d => d.state === 'follow'), m.x, m.z, 80) : null;   // hondenjager: eerst de honden
        const taunt = this.nearest([...this.dogs.values()].filter(d => d.state === 'follow' && d.breed === 'waak'), m.x, m.z, 8);   // waakhond trekt de aandacht
        m.target = dogT || taunt || this.nearest(alive, m.x, m.z, 400);
      }
      const tg = m.target; if (!tg) continue;
      let dx = tg.x - m.x, dz = tg.z - m.z, d = len(dx, dz);
      if (d > 140) {   // te ver weg geraakt: dichter bij de speler zetten
        const pt = this.world.landPoint(Math.random, tg.x, tg.z, 45, 60, 0.0);
        if (pt) { m.x = pt.x; m.z = pt.z; dx = tg.x - m.x; dz = tg.z - m.z; d = len(dx, dz); }
      }
      m.yaw = Math.atan2(-dx, -dz);
      if (m.type === 3) this.bossAbilities(m, alive);
      if (M.ranged && !m.siege) { this.archerAI(m, M, tg, dx, dz, d, dt); continue; }
      let speed = m.speed;
      if (M.stealth) {                              // sluiper: springt het laatste stuk naar voren
        if (d < 6 && d > 1.6 && this.T >= m.lungeCd) { m.lungeCd = this.T + 4; m.lungeUntil = this.T + 0.45; this.bc({ t: 'ev', k: 'lunge', id: m.id }); }
        if (this.T < m.lungeUntil) speed *= 2.6;
      }
      const reach = M.r + 0.9;
      if (m.siege && (!this.builds.has(m.siege.id) || len(m.siege.x - m.x, m.siege.z - m.z) > boundR(BUILD_BY_ID[m.siege.kind]) + M.r + 1.2)) m.siege = null;
      if (m.siege && d > reach) {                 // bouwwerk in de weg: eerst kapotslaan
        const sb = m.siege;
        m.yaw = Math.atan2(-(sb.x - m.x), -(sb.z - m.z));
        if (this.T >= m.nextAtk) {
          m.nextAtk = this.T + M.atkCd; m.siegeHits = (m.siegeHits || 0) + 1;
          this.bc({ t: 'ev', k: 'matk', id: m.id });
          this.hurtBuild(sb, m.dmg * (m.type === 3 ? 2.5 : 1.3), m);
          if (m.siegeHits > 3) { m.siege = null; m.siegeHits = 0; }   // af en toe opnieuw proberen erlangs te lopen
          if (!this.monsters.has(m.id)) continue;
        }
        continue;
      }
      if (d > reach) {
        const step = Math.min(d - reach * 0.8, speed * dt), ox = m.x, oz = m.z;
        this.move(m, m.x + dx / d * step, m.z + dz / d * step, M.r);
        if (m.blockedBy && len(m.x - ox, m.z - oz) < step * 0.35) { m.stuck = (m.stuck || 0) + dt; if (m.stuck > 0.6) { m.siege = m.blockedBy; m.stuck = 0; } }
        else m.stuck = 0;
      } else if (this.T >= m.nextAtk) {
        m.nextAtk = this.T + M.atkCd;
        this.bc({ t: 'ev', k: 'matk', id: m.id });
        if (tg.isDog) this.hurtDog(tg, m.dmg * (M.hunter ? 1.5 : 1)); else this.hurt(tg, m.dmg, m);
      }
    }
    this.updateProjectiles(dt); this.updateHazards();
    // niet op elkaar stapelen
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j], dx = b.x - a.x, dz = b.z - a.z, d = len(dx, dz), min = MONSTERS[a.type].r + MONSTERS[b.type].r;
      if (d < min && d > 0.001) { const push = (min - d) * 0.5; a.x -= dx / d * push; a.z -= dz / d * push; b.x += dx / d * push; b.z += dz / d * push; }
    }
  }

  archerAI(m, M, tg, dx, dz, d, dt) {
    // blijft op 9-17 m afstand, loopt zijwaarts en schiet pijlen die je kunt ontwijken of blokkeren
    let mx = 0, mz = 0;
    if (d > 17) { mx = dx / d; mz = dz / d; }
    else if (d < 9) { mx = -dx / d; mz = -dz / d; }
    else { mx = -dz / d * m.strafe * 0.5; mz = dx / d * m.strafe * 0.5; if (Math.random() < dt * 0.3) m.strafe *= -1; }
    if (mx || mz) { const ox = m.x, oz = m.z; this.move(m, m.x + mx * m.speed * dt, m.z + mz * m.speed * dt, M.r); if (len(m.x - ox, m.z - oz) < 0.01) m.strafe *= -1; }
    if (d < 22 && this.T >= m.nextAtk) {
      m.nextAtk = this.T + M.atkCd * (0.85 + Math.random() * 0.3);
      const lead = Math.min(0.6, d / 26) * 0.6, ax = tg.x + (tg.vx || 0) * lead, az = tg.z + (tg.vz || 0) * lead;
      const ddx = ax - m.x, ddz = az - m.z, dd = len(ddx, ddz) || 1, sp = 26;
      const pr = { x: m.x + ddx / dd * 0.6, z: m.z + ddz / dd * 0.6, vx: ddx / dd * sp, vz: ddz / dd * sp, life: 1.1, dmg: m.dmg, src: m };
      this.projs.push(pr);
      this.bc({ t: 'ev', k: 'shot', id: m.id, x: r2(pr.x), z: r2(pr.z), vx: r2(pr.vx), vz: r2(pr.vz) });
    }
  }
  updateProjectiles(dt) {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i]; let hit = false;
      const steps = 3;
      for (let k = 0; k < steps && !hit; k++) {
        p.x += p.vx * dt / steps; p.z += p.vz * dt / steps;
        for (const P of this.players.values()) if (!P.dead && Math.abs(P.x - p.x) < 0.7 && Math.abs(P.z - p.z) < 0.7 && len(P.x - p.x, P.z - p.z) < 0.65) { this.hurt(P, p.dmg, { x: p.x - p.vx * 0.1, z: p.z - p.vz * 0.1 }, 'arrow'); hit = true; break; }
        if (hit) break;
        for (const d of this.dogs.values()) if (d.state === 'follow' && len(d.x - p.x, d.z - p.z) < 0.5) { this.hurtDog(d, p.dmg * 0.7); hit = true; break; }
        if (hit) break;
        for (const b of this.builds.values()) if (BUILD_BY_ID[b.kind].solid && len(b.x - p.x, b.z - p.z) < 3 && pushOut(b, p.x, p.z, 0.05)) { this.hurtBuild(b, p.dmg * 0.4, null); hit = true; break; }
        if (!hit && this.world.heightAt(p.x, p.z) > 0 && this.world.slopeAt(p.x, p.z) > 1.4) hit = true;
      }
      p.life -= dt;
      if (hit || p.life <= 0) this.projs.splice(i, 1);
    }
  }
  bossAbilities(m, alive) {
    const near = alive.filter(p => !p.isDog && len(p.x - m.x, p.z - m.z) < 30);
    if (this.T >= m.abRoots && near.length) {         // wortels schieten onder spelers uit de grond
      m.abRoots = this.T + 8 + Math.random() * 3;
      const pts = near.slice(0, 6).map(p => [r1(p.x), r1(p.z)]);
      for (const [x, z] of pts) this.hazards.push({ x, z, r: 2.4, at: this.T + 1.3, dmg: 18 * (this.waveScale?.dmg || 1) });
      this.bc({ t: 'ev', k: 'roots', id: m.id, pts, delay: 1.3 });
    }
    if (this.T >= m.abSummon && near.length) {        // roept kobolds op
      m.abSummon = this.T + 18 + Math.random() * 6;
      const summoned = [...this.monsters.values()].filter(x => x.summoned).length;
      const sc = this.waveScale || { hp: 1, dmg: 1, spd: 1 };
      const pts = [];
      for (let i = 0; i < 3 && summoned + i < 8; i++) {
        const a = Math.random() * 6.28, x = m.x + Math.cos(a) * 3.5, z = m.z + Math.sin(a) * 3.5;
        if (this.world.heightAt(x, z) < WATER + 0.9) continue;
        const k = this.spawnMonster(0, x, z, sc.hp * 0.8, sc.dmg, sc.spd); k.summoned = true; pts.push([r1(x), r1(z)]);
      }
      if (pts.length) this.bc({ t: 'ev', k: 'summon', id: m.id, pts });
    }
  }
  updateHazards() {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; if (this.T < h.at) continue;
      this.hazards.splice(i, 1);
      for (const P of this.players.values()) {
        if (P.dead || len(P.x - h.x, P.z - h.z) > h.r) continue;
        if (this.T < (P.iframe || 0)) { P.conn.send({ t: 'ev', k: 'dodged' }); continue; }
        this.hurt(P, h.dmg, null, 'melee', h.bolt ? 'bliksem' : 'wortels');
        if (!h.bolt) { P.rootUntil = this.T + 1.5; P.conn.send({ t: 'rooted', s: 1.5 }); }
      }
      for (const d of this.dogs.values()) if (d.state === 'follow' && len(d.x - h.x, d.z - h.z) < h.r) this.hurtDog(d, h.dmg * 0.6);
      if (h.bolt) {
        for (const m of [...this.monsters.values()]) if (len(m.x - h.x, m.z - h.z) < h.r) { m.hp -= 40; if (m.hp <= 0) this.killMonster(m, null); }
        this.world.gNear(h.x, h.z, o => {
          if (!o.type || this.felled.has(o.idx) || len(o.x - h.x, o.z - h.z) > 2.6) return;
          this.felled.set(o.idx, this.T + CFG.treeRespawn); this.treeHp[o.idx] = 0;
          this.bc({ t: 'ev', k: 'felled', i: o.idx, dx: 1, dz: 0 });
        });
      }
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
      const warm = this.nearFire(P);
      if ((this.tickN + P.id) % 20 === 0) {
        P.biome = this.world.biomeAt(P.x, P.z);
        const bs = P.u.save.biomes; if (!bs[P.biome]) { bs[P.biome] = 1; this.sendInv(P); this.markDirty(); }
      }
      const cold = P.biome === 'snow' && !warm ? 1.3 : 1;
      P.hunger = Math.max(0, P.hunger - CFG.hungerRate * dt * (warm ? 0.5 : 1) * cold * (1 - 0.1 * tal(P.u.save, 'maag')));
      if (warm && P.hp < P.mhp) P.hp = Math.min(P.mhp, P.hp + 3 * dt);
      P.u.save.stats.playSec += dt; bump('playSec', dt);
      if (P.hunger <= 0) {
        P.starve += dt;
        if (P.starve >= 1.5) { P.starve = 0; this.hurt(P, 4, null, 'melee', 'honger'); if (P.dead) continue; }
      } else if (P.hunger >= 40 && this.T - P.lastHurt > 6 && P.hp < P.mhp) P.hp = Math.min(P.mhp, P.hp + 1.5 * dt);
      if (P.pendingHit >= 0 && this.T >= P.pendingHit) { P.pendingHit = -1; this.resolveHit(P); }
      this.updateFishing(P);
    }

    const w = this.wave;
    if (w.ph === 0) { w.t -= dt; if (w.t <= 0) this.startWave(); }
    else if (this.monsters.size === 0) this.endWave();

    this.updateWorldEvents(dt);
    this.updateMonsters(dt);
    this.updateTowers();
    this.updateAnimals(dt);
    this.updateDogs(dt);

    if (this.tickN % 20 === 0) {
      for (const [i, t] of this.felled) if (this.T >= t) { this.felled.delete(i); this.treeHp[i] = this.world.trees[i].hp0; this.bc({ t: 'ev', k: 'treeBack', i }); }
      for (const [i, t] of this.chestOpen) if (this.T >= t) { this.chestOpen.delete(i); this.bc({ t: 'ev', k: 'chestBack', i }); }
      for (const [i, t] of this.oreBack) if (this.T >= t) { this.oreBack.delete(i); this.oreLeft[i] = this.world.ores[i].rich ? 6 : 4; this.bc({ t: 'ev', k: 'oreBack', i }); }
    }
    if (this.tickN % 2 === 0) this.snapshot();
  }

  // ------------------------------------------------------------ honden
  spawnStray() {
    const w = this.world;
    for (let i = 0; i < 10; i++) {
      const pt = w.landPoint(Math.random, 0, 0, 55, HALF * 0.75, 0.8);
      if (!pt || w.slopeAt(pt.x, pt.z) > 0.5) continue;
      const d = { id: this.eid++, isDog: true, state: 'wild', owner: null, x: pt.x, z: pt.z, home: pt, yaw: Math.random() * 6.28,
        level: 1, xp: 0, name: 'Zwerfhond', fur: Math.floor(Math.random() * DOG_FURS.length), hp: 60, maxhp: 60, dir: null, wt: 0, nextBark: 0, sit: false,
        breed: DOG_BREEDS[Math.floor(Math.random() * DOG_BREEDS.length)].id };
      this.dogs.set(d.id, d); return d;
    }
    return null;
  }
  spawnOwnedDog(P) {
    const sd = P.u.save.dog, st = this.dogStatsFor(P, sd.level);
    const d = { id: this.eid++, isDog: true, state: 'follow', owner: P, x: P.x + 1.5, z: P.z + 1.5, yaw: 0, level: sd.level, xp: sd.xp, name: sd.name, fur: sd.fur | 0,
      hp: st.maxhp, maxhp: st.maxhp, dmg: st.dmg, nextAtk: 0, target: null, retarget: 0, lastFight: -99, downUntil: 0, breed: breedOf(sd.breed).id, cmd: 'follow' };
    this.dogs.set(d.id, d); P.dog = d;
    return d;
  }
  tame(P, id) {
    const d = this.dogs.get(id), s = P.u.save;
    if (!d || d.state !== 'wild' || P.dead) return;
    if (len(d.x - P.x, d.z - P.z) > 4) return;
    if (s.dog) { this.toast(P, 'Je hebt al een hond: ' + s.dog.name + '.', '#bbb'); return; }
    if (s.meat <= 0) { this.toast(P, 'De hond kijkt hongerig naar je. Neem een stuk vlees mee om hem te temmen.', '#ff9c8a'); return; }
    s.meat--;
    const used = new Set([...this.players.values()].map(p => p.u.save.dog && p.u.save.dog.name));
    const free = DOG_NAMES.filter(n => !used.has(n)), name = (free.length ? free : DOG_NAMES)[Math.floor(Math.random() * (free.length || DOG_NAMES.length))];
    s.dog = { name, level: 1, xp: 0, fur: d.fur, breed: d.breed || 'herder' };
    s.stats.dogs = (s.stats.dogs | 0) + 1;
    this.dogs.delete(d.id);
    const nd = this.spawnOwnedDog(P); nd.x = d.x; nd.z = d.z; nd.yaw = d.yaw;
    if (!this.strayAt) this.strayAt = this.T + CFG.strayRespawn;
    this.bc({ t: 'ev', k: 'tamed', id: nd.id, by: P.id, name, x: r1(nd.x), z: r1(nd.z) });
    this.toast(P, 'Je hebt een hond! Hij heet ' + name + ' en helpt je in gevechten.', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }
  // ------------------------------------------------------------ vissen
  cast(P, x, z) {
    const s = P.u.save, w = this.world;
    if (P.dead || P.fishing || !s.up.rod) return;
    if (!Number.isFinite(x) || !Number.isFinite(z) || len(x - P.x, z - P.z) > 7) return;
    if (w.heightAt(x, z) > WATER - 0.15) { this.toast(P, 'Gooi je hengel uit in het water.', '#bbb'); return; }
    const fast = (this.weather.k === 'regen' ? 0.6 : 1) * (this.world.biomeAt(x, z) === 'swamp' ? 0.7 : 1);
    P.fishing = { x, z, biteAt: this.T + (3 + Math.random() * 6) * fast, bite: false, until: 0 };
    this.bc({ t: 'ev', k: 'cast', id: P.id, x: r1(x), z: r1(z) });
  }
  endFishing(P, caught = false) {
    if (!P.fishing) return;
    P.fishing = null;
    this.bc({ t: 'ev', k: 'fishend', id: P.id, caught });
  }
  updateFishing(P) {
    const f = P.fishing; if (!f) return;
    if (P.dead || len(f.x - P.x, f.z - P.z) > 9) { this.endFishing(P); return; }
    if (!f.bite && this.T >= f.biteAt) {
      f.bite = true; f.until = this.T + 2.0;
      P.conn.send({ t: 'ev', k: 'bite' });
      this.bc({ t: 'ev', k: 'bob', id: P.id }, P);
    } else if (f.bite && this.T > f.until) {
      this.toast(P, 'Te laat, de vis is ontsnapt. Probeer het opnieuw.', '#bbb');
      this.endFishing(P);
    }
  }
  reel(P) {
    const f = P.fishing; if (!f) return;
    if (!f.bite) { this.toast(P, 'Te vroeg! Wacht tot de dobber onder gaat.', '#bbb'); this.endFishing(P); return; }
    const s = P.u.save, gold = Math.random() < 0.12, n = gold ? 3 : 1;
    s.fish += n; s.stats.fish = (s.stats.fish | 0) + n; this.addXp(P, XP.fish * n); this.quest(P, 'fish', n);
    this.toast(P, gold ? 'Een goudvis! Die telt voor 3 vissen.' : 'Vis gevangen! Geef hem aan je hond met G.', gold ? '#f2c14e' : '#6fc6e8');
    P.conn.send({ t: 'ev', k: 'caught', gold });
    this.endFishing(P, true);
    this.sendInv(P); this.markDirty();
  }
  feedDog(P) {
    const s = P.u.save, d = P.dog;
    if (P.dead) return;
    if (!d) { this.toast(P, 'Je hebt nog geen hond om te voeren.', '#bbb'); return; }
    if (s.fish <= 0) { this.toast(P, s.up.rod ? 'Je hebt geen vis. Ga vissen aan de waterkant.' : 'Je hebt geen vis. Koop een vishengel in de winkel.', '#ff9c8a'); return; }
    s.fish--;
    d.boostUntil = Math.min(this.T + DOG_BOOST_MAX, Math.max(this.T, d.boostUntil || 0) + DOG_BOOST_SEC);
    if (d.state === 'down') { d.state = 'follow'; }
    d.hp = d.maxhp;
    if (len(d.x - P.x, d.z - P.z) > 12) { d.x = P.x + 1.5; d.z = P.z + 1.5; }
    this.bc({ t: 'ev', k: 'dogboost', id: d.id });
    this.toast(P, d.name + ' smult van de vis: sterker en sneller voor ' + Math.round(d.boostUntil - this.T) + ' seconden.', '#6fc6e8');
    this.dogXp(d, 10);
    this.sendInv(P); this.markDirty();
  }

  hurtDog(d, dmg) {
    if (d.state !== 'follow') return;
    d.hp -= dmg; d.lastFight = this.T;
    this.bc({ t: 'ev', k: 'doghurt', id: d.id });
    if (d.hp <= 0) {
      d.hp = 0; d.state = 'down'; d.downUntil = this.T + CFG.dogDown; d.target = null;
      if (d.owner) this.toast(d.owner, d.name + ' is uitgeschakeld en rust even uit.', '#ff9c8a');
    }
  }
  dogXp(d, n) {
    if (!d.owner) return;
    const sd = d.owner.u.save.dog; if (!sd) return;
    d.xp += n;
    while (d.level < DOG_MAX_LEVEL && d.xp >= dogXpNeeded(d.level)) {
      d.xp -= dogXpNeeded(d.level); d.level++;
      const st = this.dogStatsFor(d.owner, d.level); d.maxhp = st.maxhp; d.dmg = st.dmg; d.hp = st.maxhp;
      this.toast(d.owner, d.name + ' is nu niveau ' + d.level + '!', '#f2c14e');
      this.bc({ t: 'ev', k: 'doglvl', id: d.id });
    }
    if (d.level >= DOG_MAX_LEVEL) d.xp = 0;
    sd.level = d.level; sd.xp = d.xp;
    this.sendInv(d.owner); this.markDirty();
  }
  updateDogs(dt) {
    const players = [...this.players.values()].filter(p => !p.dead);
    let wild = 0;
    for (const d of this.dogs.values()) {
      if (d.state === 'wild') {
        wild++;
        const near = this.nearest(players, d.x, d.z, 9);
        d.sit = !!near;
        if (near) { d.yaw = Math.atan2(-(near.x - d.x), -(near.z - d.z)); }
        else {
          d.wt -= dt;
          if (d.wt <= 0) { d.wt = 2 + Math.random() * 4; d.dir = Math.random() < 0.4 ? null : Math.random() * 6.28; }
          if (d.dir !== null) {
            let dx = Math.cos(d.dir), dz = Math.sin(d.dir);
            if (len(d.x - d.home.x, d.z - d.home.z) > 14) { dx = d.home.x - d.x; dz = d.home.z - d.z; const l = len(dx, dz); dx /= l; dz /= l; }
            d.yaw = Math.atan2(-dx, -dz);
            this.move(d, d.x + dx * 1.6 * dt, d.z + dz * 1.6 * dt, 0.35);
          }
        }
        if (this.T >= d.nextBark && this.nearest(players, d.x, d.z, 32)) {
          d.nextBark = this.T + 3 + Math.random() * 4;
          this.bc({ t: 'ev', k: 'bark', id: d.id, x: r1(d.x), z: r1(d.z) });
        }
        continue;
      }
      const P = d.owner; if (!P) continue;
      if (d.state === 'down') {
        if (this.T >= d.downUntil) { d.state = 'follow'; d.hp = Math.round(d.maxhp * 0.5); this.toast(P, d.name + ' staat weer op.', '#6fd37a'); }
        continue;
      }
      if (this.T - d.lastFight > 5 && d.hp < d.maxhp) d.hp = Math.min(d.maxhp, d.hp + 3 * dt);
      // doel zoeken: monsters bij de baas, of dieren die de baas net heeft geraakt / boze everzwijnen
      d.retarget -= dt;
      const home = d.cmd === 'stay' && d.stayAt ? d.stayAt : P, range = d.cmd === 'stay' ? 9 : 22;
      const valid = t => t && (t.isMon ? this.monsters.has(t.e.id) : this.animals.has(t.e.id)) && (t.forced ? len(t.e.x - P.x, t.e.z - P.z) < 45 : len(t.e.x - home.x, t.e.z - home.z) < range);
      if (d.retarget <= 0 || !valid(d.target)) {
        d.retarget = 0.5; d.target = null;
        let best = null, bd = d.cmd === 'stay' ? 7 : 16;
        for (const m of this.monsters.values()) { const dd = len(m.x - home.x, m.z - home.z); if (dd < bd) { bd = dd; best = { isMon: true, e: m }; } }
        if (!best && d.cmd !== 'seek') for (const a of this.animals.values()) {
          if (!(a.angry || this.T - a.hurtT < 6 || (d.breed === 'jacht' && len(a.x - home.x, a.z - home.z) < 14))) continue;   // jachthond jaagt zelf
          const dd = len(a.x - home.x, a.z - home.z); if (dd < bd) { bd = dd; best = { isMon: false, e: a }; }
        }
        d.target = best;
        if (d.cmd === 'attack') d.cmd = 'follow';
      }
      const boosted = (d.boostUntil || 0) > this.T;
      const speed = this.dogStatsFor(P, d.level).speed + (boosted ? 2.5 : 0);
      if (d.target && !P.dead) {
        const e = d.target.e, r = d.target.isMon ? MONSTERS[e.type].r : ANIMALS[e.type].r;
        const dx = e.x - d.x, dz = e.z - d.z, dist = len(dx, dz), reach = r + 0.8;
        d.yaw = Math.atan2(-dx, -dz);
        if (dist > reach) { const st = Math.min(dist - reach * 0.8, (speed + 1) * dt); this.move(d, d.x + dx / dist * st, d.z + dz / dist * st, 0.35); }
        else if (this.T >= d.nextAtk) {
          d.nextAtk = this.T + (boosted ? 0.55 : 0.85); d.lastFight = this.T;
          const dmg = d.dmg * (boosted ? 1.5 : 1) * (0.9 + Math.random() * 0.2);
          e.hp -= dmg; e.stun = 0.12;
          if (!d.target.isMon) { e.angry = e.type === 2; e.hurtT = this.T; }
          this.bc({ t: 'ev', k: 'hit', e: d.target.isMon ? 'm' : 'a', id: e.id, dmg: Math.round(dmg), x: r1(e.x), z: r1(e.z), dog: d.id });
          if (e.hp > 0) this.dogXp(d, 1);
          if (e.hp <= 0) {
            if (d.target.isMon) { this.dogXp(d, Math.round(MONSTERS[e.type].score * 0.8)); this.killMonster(e, P); }
            else { this.dogXp(d, 4); this.killAnimal(e, P); }
            d.target = null;
          }
        }
        continue;
      }
      // zoeken: naar een kist of ertsader lopen en blaffen
      if (d.cmd === 'seek' && d.seek) {
        const g = d.seek, dx = g.x - d.x, dz = g.z - d.z, dist = len(dx, dz);
        if (dist > 1.8) { const st = Math.min(dist - 1.5, (speed + 1) * dt); this.move(d, d.x + dx / dist * st, d.z + dz / dist * st, 0.35); d.yaw = Math.atan2(-dx, -dz); }
        else if (!g.found) { g.found = this.T; this.bc({ t: 'ev', k: 'bark', id: d.id, x: r1(d.x), z: r1(d.z) }); P.conn.send({ t: 'ev', k: 'dogfound', kind: g.kind, i: g.i, x: r1(g.x), z: r1(g.z) }); }
        else if (this.T - g.found > 4) { d.cmd = 'follow'; d.seek = null; }
        if (len(d.x - P.x, d.z - P.z) > 160) { d.cmd = 'follow'; d.seek = null; }
        continue;
      }
      // blijven: op de plek zitten
      if (d.cmd === 'stay' && d.stayAt) {
        const dx = d.stayAt.x - d.x, dz = d.stayAt.z - d.z, dist = len(dx, dz);
        if (dist > 0.8) { const st = Math.min(dist - 0.5, speed * dt); this.move(d, d.x + dx / dist * st, d.z + dz / dist * st, 0.35); d.yaw = Math.atan2(-dx, -dz); }
        continue;
      }
      // volgen
      const bx = P.x + Math.sin(P.yaw) * 2.2 + Math.cos(P.yaw) * 1.2, bz = P.z + Math.cos(P.yaw) * 2.2 - Math.sin(P.yaw) * 1.2;
      const dx = bx - d.x, dz = bz - d.z, dist = len(dx, dz);
      if (dist > 45) { d.x = bx; d.z = bz; continue; }
      if (dist > 0.6) {
        const st = Math.min(dist - 0.3, Math.min(speed + 1, 1.5 + dist * 1.6) * dt);
        this.move(d, d.x + dx / dist * st, d.z + dz / dist * st, 0.35);
        d.yaw = Math.atan2(-dx, -dz);
      } else d.yaw = P.yaw;
    }
    if (wild < CFG.strays && this.strayAt && this.T >= this.strayAt) { this.spawnStray(); this.strayAt = wild + 1 < CFG.strays ? this.T + CFG.strayRespawn : 0; }
  }

  // ------------------------------------------------------------ wereld: ruïnes, weer, handelaar
  buff(P, k) { return P.buffs && P.buffs[k] > this.T; }
  buffInfo(P) { if (!P.buffs) return 0; const o = {}; let any = false; for (const k in P.buffs) if (P.buffs[k] > this.T) { o[k] = Math.ceil(P.buffs[k] - this.T); any = true; } return any ? o : 0; }
  ruin(P, i) {
    const R = this.world.ruins[i], st = this.ruinSt[i]; if (!R || P.dead) return;
    if (len(R.chest.x - P.x, R.chest.z - P.z) > 4.5) return;
    if (st.st === 'idle') {
      st.st = 'awake'; st.guards.clear();
      const n = Math.max(1, this.wave.n), sc = { hp: 1 + 0.25 * (n - 1), dmg: 1 + 0.1 * (n - 1) };
      const types = [0, 0, 4, n >= 4 ? 6 : 0, n >= 6 ? 2 : 0];
      types.forEach((t, k) => {
        const p = R.parts[k % R.parts.length], x = (p.x + R.x) / 2, z = (p.z + R.z) / 2;
        const m = this.spawnMonster(t, x, z, sc.hp * 1.2, sc.dmg, 1); m.guard = i; m.retarget = 0; st.guards.add(m.id);
      });
      this.bc({ t: 'ev', k: 'ruin', i, st: 'awake', by: P.id });
      this.toast(P, 'De bewakers van de ruïne ontwaken! Versla ze om de kist te openen.', '#c58cff');
    } else if (st.st === 'awake') this.toast(P, 'Versla eerst de bewakers (' + st.guards.size + ' over).', '#c58cff');
    else if (st.st === 'ready') {
      st.st = 'cool'; st.until = this.T + 1200;
      const s = P.u.save, ore = 4 + Math.floor(Math.random() * 5), wood = 15 + Math.floor(Math.random() * 16);
      let sw = rollSword(1.4); for (let k = 0; k < 6 && sw.rarity < 2; k++) sw = rollSword(1.4);
      s.ore += ore; s.wood += wood; s.stats.dungeons++; bump('dungeon');
      this.giveSword(P, sw, 'chest');
      P.conn.send({ t: 'loot', kind: 'dungeon', ore, wood });
      this.addXp(P, 60); this.sendInv(P); this.markDirty();
      this.bc({ t: 'ev', k: 'ruin', i, st: 'cool', by: P.id });
    }
  }
  guardGone(m) {
    const st = this.ruinSt[m.guard]; if (!st) return;
    st.guards.delete(m.id);
    if (st.st === 'awake' && !st.guards.size) { st.st = 'ready'; this.bc({ t: 'ev', k: 'ruin', i: m.guard, st: 'ready' }); }
  }
  traderInfo() { const t = this.trader; return t ? { x: r1(t.x), z: r1(t.z), left: Math.ceil(t.until - this.T), stock: t.stock } : null; }
  traderBuy(P, id) {
    const t = this.trader, s = P.u.save, it = TRADER_ITEMS.find(x => x.id === id);
    if (!t || !it || !t.stock.includes(id) || P.dead || len(t.x - P.x, t.z - P.z) > 7) return;
    if (s.wood < it.cost) return this.toast(P, 'Te weinig hout.', '#ff9c8a');
    if (id === 'snack' && !P.dog) return this.toast(P, 'Je hebt geen hond bij je.', '#bbb');
    if (id === 'potions' && s.potions >= MAX_POTIONS) return this.toast(P, 'Je kunt niet meer drankjes dragen.', '#bbb');
    s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost; bump('trader.' + id);
    P.buffs = P.buffs || {};
    switch (id) {
      case 'mystery': { let sw = rollSword(1.8); for (let k = 0; k < 8 && sw.rarity < 2; k++) sw = rollSword(1.8); this.giveSword(P, sw, 'chest'); break; }
      case 'elixir': P.buffs.elixir = Math.max(P.buffs.elixir || 0, this.T) + 300; break;
      case 'haste': P.buffs.haste = Math.max(P.buffs.haste || 0, this.T) + 180; break;
      case 'ore': s.ore += 10; break;
      case 'snack': this.dogXp(P.dog, 150); break;
      case 'potions': s.potions = Math.min(MAX_POTIONS, s.potions + 3); break;
    }
    this.toast(P, it.icon + ' ' + it.name + ' gekocht.', '#c58cff');
    this.sendInv(P); this.markDirty();
  }
  updateWorldEvents(dt) {
    // ruïnes die weer dichtgaan
    if (this.tickN % 20 === 0) this.ruinSt.forEach((st, i) => {
      if (st.st === 'cool' && this.T >= st.until) { st.st = 'idle'; this.bc({ t: 'ev', k: 'ruin', i, st: 'idle' }); }
      if (st.st === 'awake') for (const id of [...st.guards]) if (!this.monsters.has(id)) st.guards.delete(id);
      if (st.st === 'awake' && !st.guards.size) { st.st = 'ready'; this.bc({ t: 'ev', k: 'ruin', i, st: 'ready' }); }
    });
    // weer
    const W = this.weather;
    if (this.T >= W.until) {
      const opts = WEATHERS.filter(w => w.k === 'helder' || w.k !== W.k), tot = opts.reduce((a, w) => a + w.w, 0);
      let r = Math.random() * tot, pick = opts[0]; for (const w of opts) { if (r < w.w) { pick = w; break; } r -= w.w; }
      W.k = pick.k; W.until = this.T + (pick.k === 'helder' ? 200 + Math.random() * 200 : 120 + Math.random() * 120); W.bolt = this.T + 8;
      this.bc({ t: 'weather', k: W.k });
    }
    if (W.k === 'onweer' && this.T >= W.bolt) {          // bliksem in de buurt van een speler
      W.bolt = this.T + 10 + Math.random() * 15;
      const P = this.pickAlive();
      if (P) {
        const a = Math.random() * 6.28, d = 4 + Math.random() * 18, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
        if (this.world.heightAt(x, z) > WATER) { this.hazards.push({ x, z, r: 3, at: this.T + 1.0, dmg: 20, bolt: true }); this.bc({ t: 'ev', k: 'bolt', x: r1(x), z: r1(z), delay: 1.0 }); }
      }
    }
    // reizende handelaar
    if (this.trader && this.T >= this.trader.until) { this.trader = null; this.traderAt = this.T + 420 + Math.random() * 300; this.bc({ t: 'trader', info: null }); }
    if (!this.trader && this.T >= this.traderAt && this.players.size) {
      const pt = this.world.landPoint(Math.random, 0, 0, 35, 120, 1.0);
      if (pt && this.world.slopeAt(pt.x, pt.z) < 0.4) {
        let clear = true; this.world.gNear(pt.x, pt.z, o => { if (len(o.x - pt.x, o.z - pt.z) < 3.5) clear = false; });
        if (clear) {
          const stock = TRADER_ITEMS.map(x => x.id).sort(() => Math.random() - 0.5).slice(0, 4);
          this.trader = { x: pt.x, z: pt.z, until: this.T + 240, stock };
          this.bc({ t: 'trader', info: this.traderInfo(), arrived: true });
        }
      } else this.traderAt = this.T + 5;
    }
  }

  // ------------------------------------------------------------ bouwen
  btuple(b) { return [b.id, BUILD_BY_ID[b.kind].idx, r2(b.x), r2(b.z), r2(b.rot), Math.round(b.hp), b.maxhp, b.owner]; }
  saveBuilds() {
    this.store.builds = [...this.builds.values()].map(b => ({ kind: b.kind, x: r2(b.x), z: r2(b.z), rot: r2(b.rot), hp: Math.round(b.hp), owner: b.owner }));
    this.markDirty();
  }
  bedOf(P) { for (const b of this.builds.values()) if (b.kind === 'bed' && b.owner === P.name) return b; return null; }
  nearFire(P) {
    for (const b of this.builds.values()) if (b.kind === 'campfire' && Math.abs(b.x - P.x) < FIRE_RADIUS && Math.abs(b.z - P.z) < FIRE_RADIUS && len(b.x - P.x, b.z - P.z) < FIRE_RADIUS) return true;
    return false;
  }
  build(P, kind, x, z, rot) {
    const B = BUILD_BY_ID[kind], s = P.u.save;
    if (!B || P.dead || !Number.isFinite(x) || !Number.isFinite(z)) return;
    const fail = msg => { P.conn.send({ t: 'buildfail', msg }); };
    if (len(x - P.x, z - P.z) > BUILD_RANGE) return fail('Te ver weg');
    if (s.wood < B.cost) return fail('Je hebt ' + B.cost + ' hout nodig');
    if (this.builds.size >= BUILD_MAX_ROOM) return fail('Deze kamer zit vol met bouwwerken');
    const mine = [...this.builds.values()].filter(b => b.owner === P.name);
    if (mine.length >= BUILD_MAX_PLAYER) return fail('Je hebt al ' + BUILD_MAX_PLAYER + ' bouwwerken; breek er eerst een af');
    const others = B.one ? [...this.builds.values()].filter(b => !(b.kind === kind && b.owner === P.name)) : this.builds.values();
    const why = canPlace(this.world, others, kind, x, z, rot, this.felled);
    if (why) return fail(why);
    if (B.one) for (const b of mine) if (b.kind === kind) this.removeBuild(b, 'replace');
    s.wood -= B.cost; s.stats.built = (s.stats.built || 0) + 1; this.addXp(P, XP.build); this.quest(P, 'build');
    const b = { id: this.bid++, kind, x, z, rot, hp: B.hp, maxhp: B.hp, owner: P.name, nextShot: 0 }; bump('build.' + kind);
    this.builds.set(b.id, b);
    this.bc({ t: 'ev', k: 'bnew', b: this.btuple(b), by: P.id });
    this.sendInv(P); this.saveBuilds();
  }
  unbuild(P, id) {
    const b = this.builds.get(id); if (!b || P.dead) return;
    if (b.owner !== P.name) return this.toast(P, 'Dit is van ' + b.owner + '.', '#ff9c8a');
    if (len(b.x - P.x, b.z - P.z) > BUILD_RANGE + 1) return;
    const B = BUILD_BY_ID[b.kind], back = Math.floor(B.cost * BUILD_REFUND * (b.hp / b.maxhp));
    P.u.save.wood += back;
    this.removeBuild(b, 'remove');
    this.toast(P, B.name + ' afgebroken' + (back ? ': +' + back + ' hout terug' : ''), '#c89a5e');
    this.sendInv(P);
  }
  removeBuild(b, how) {
    this.builds.delete(b.id);
    for (const m of this.monsters.values()) if (m.siege === b) m.siege = null;
    this.bc({ t: 'ev', k: 'bgone', id: b.id, x: r1(b.x), z: r1(b.z), how });
    this.saveBuilds();
  }
  hurtBuild(b, dmg, m) {
    b.hp -= dmg;
    const B = BUILD_BY_ID[b.kind];
    if (B.thorns && m) {                       // palissade: punten doen pijn
      m.hp -= B.thorns * (1 + this.wave.n * 0.15);
      if (m.hp <= 0) { const owner = [...this.players.values()].find(p => p.name === b.owner); this.killMonster(m, owner || null); }
    }
    if (b.hp <= 0) {
      this.removeBuild(b, 'destroy');
      const owner = [...this.players.values()].find(p => p.name === b.owner);
      if (owner) this.toast(owner, 'Je ' + B.name.toLowerCase() + ' is vernield!', '#ff9c8a');
    } else { this.bc({ t: 'ev', k: 'bhp', id: b.id, hp: Math.round(b.hp) }); if ((this.tickN & 63) === 0) this.saveBuilds(); }
  }
  updateTowers() {
    if (!this.monsters.size) return;
    for (const b of this.builds.values()) {
      if (b.kind !== 'tower' || this.T < b.nextShot) continue;
      const B = BUILD_BY_ID.tower;
      const m = this.nearest(this.monsters.values(), b.x, b.z, B.range);
      if (!m) { b.nextShot = this.T + 0.3; continue; }
      b.nextShot = this.T + B.cd;
      const dmg = B.dmg * (1 + this.wave.n * 0.08);
      m.hp -= dmg; m.stun = Math.max(m.stun, 0.1);
      this.bc({ t: 'ev', k: 'arrow', b: b.id, id: m.id, dmg: Math.round(dmg), x: r1(m.x), z: r1(m.z) });
      if (m.hp <= 0) { const owner = [...this.players.values()].find(p => p.name === b.owner && !p.dead); this.killMonster(m, owner || null); }
    }
  }

  snapshot() {
    const p = [], m = [], a = [], d = [];
    for (const e of this.dogs.values()) d.push([e.id, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), e.maxhp, e.owner ? e.owner.id : 0, e.state === 'wild' ? (e.sit ? 3 : 0) : e.state === 'down' ? 2 : (e.cmd === 'stay' && !e.target ? 3 : 1), e.level, e.name, e.fur, e.boostUntil > this.T ? Math.ceil(e.boostUntil - this.T) : 0, DOG_BREEDS.findIndex(b => b.id === e.breed)]);
    for (const P of this.players.values()) p.push([P.id, r1(P.x), r1(P.y), r1(P.z), r2(P.yaw), Math.round(P.hp), eqCode(this.eqItem(P)), P.dead ? 1 : 0, P.swings]);
    for (const e of this.monsters.values()) m.push([e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]);
    for (const e of this.animals.values()) a.push([e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]);
    const head = JSON.stringify({ t: 's', p, m, a, d, w: { n: this.wave.n, ph: this.wave.ph, t: Math.max(0, Math.ceil(this.wave.t)), left: this.monsters.size, mod: this.wave.mod } }).slice(0, -1);
    for (const P of this.players.values()) {
      const you = { hp: Math.round(P.hp), mhp: P.mhp, bf: this.buffInfo(P), hu: Math.round(P.hunger), sc: P.u.save.stats.score, rs: P.dead ? Math.max(0, Math.ceil(P.respawnAt - this.T)) : 0 };
      P.conn.send(head + ',"y":' + JSON.stringify(you) + '}');
    }
  }
}
