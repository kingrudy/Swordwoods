// Autoritatieve spelsimulatie voor één kamer. Hier: opbouw, invoer van spelers, hoofdlus en snapshots.
// Alle onderwerpen (golven, honden, bouwen, woestijn, ...) staan in room/*.js en worden onderaan aan Room gekoppeld.

import { createWorld, worldOk, WATER, clampXZ, inDesert } from './public/world.js';
import { REGEN_PER_SEC, rollSwordOfRarity, AXE, MONSTERS, eqCode, WEATHERS, DOG_BREEDS, breedOf, ROLL_CD, ROLL_IFRAME } from './public/items.js';
import { tal, maxHp } from './public/progress.js';
import { bump } from './stats.js';
import { logChat, mutedUntil, muteText } from './moderation.js';
import { BUILD_BY_ID } from './public/builds.js';
import { num, r1, r2, len, clamp, CFG } from './room/shared.js';
import { ensureSave, applyTalent, wearing } from './room/save.js';
import { Progress } from './room/progress.js';
import { Economy } from './room/economy.js';
import { Combat } from './room/combat.js';
import { Waves, NIGHT } from './room/waves.js';
import { Animals } from './room/animals.js';
import { Dogs } from './room/dogs.js';
import { Fishing } from './room/fishing.js';
import { Social } from './room/social.js';
import { WorldEvents } from './room/worldEvents.js';
import { Desert } from './room/desert.js';
import { Building } from './room/building.js';
import { Pyramid } from './room/pyramid.js';
import { Bosses } from './room/bosses.js';
import { Cooking } from './room/cooking.js';
import { Travel } from './room/travel.js';
export { ensureSave, ensureDaily, applyTalent, claimLogin, cosAction } from './room/save.js';
export { CFG } from './room/shared.js';

/** Stralen (m) voor wat een speler te zien krijgt; mist begint op zo'n 60-90 m. */
const SNAP = { monFar: 140, aniFar: 100, near: 45 };

const worlds = new Map();
function getWorld(seed) {
  let w = worlds.get(seed);
  if (!w) { w = createWorld(seed); if (worlds.size > 12) worlds.delete(worlds.keys().next().value); worlds.set(seed, w); }
  return w;
}

export class Room {
  constructor(id, name, max, permanent, markDirty, store = null) {
    this.id = id; this.name = name; this.max = max; this.permanent = permanent; this.markDirty = markDirty;
    this.store = store || {};                                  // blijvende kamerdata (vaste kamers: in db.json)
    if (Number.isInteger(this.store.seed)) this.seed = this.store.seed;
    else for (let k = 0; k < 30; k++) { this.seed = 1 + Math.floor(Math.random() * 9000); if (worldOk(getWorld(this.seed))) break; }   // geen piepkleine eilanden
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
    this.projs = []; this.hazards = []; this.zones = [];
    this.oreLeft = Int8Array.from(this.world.ores, o => o.rich ? 6 : 4); this.oreBack = new Map();
    this.ruinSt = this.world.ruins.map(() => ({ st: 'idle', guards: new Set(), until: 0 }));
    this.weather = { k: 'helder', until: 150 + Math.random() * 150, bolt: 0 };
    this.trader = null; this.traderAt = 240 + Math.random() * 240;
    this.animalTimer = 0;
    this.rand = Math.random;
    for (let i = 0; i < CFG.animalTarget; i++) this.spawnAnimal(i < 8);
    for (let i = 0; i < CFG.desertAnimals; i++) this.spawnAnimal(false, true);
    this.moundBack = new Map();   // idx -> tijd waarop de zandberg terug is
    this.pyr = { st: 'idle', until: 0, empty: 0 };   // idle | guards | boss | cool
    for (let i = 0; i < CFG.strays; i++) this.spawnStray();
    for (const P of this.players.values()) if (P.u.save.dog) this.spawnOwnedDog(P);
    this.emptySince = this.players.size ? null : Date.now();
  }

  get summary() {
    return { id: this.id, name: this.name, players: this.players.size, max: this.max, wave: this.wave.n, ph: this.wave.ph, perm: this.permanent };
  }

  bc(obj, except = null) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except) p.conn.send(s);
  }

  sendInv(P) {
    const s = P.u.save;
    this.checkAch(P);
    P.conn.send({ t: 'inv', wood: s.wood, meat: s.meat, potions: s.potions, fish: s.fish, ore: s.ore, gold: s.gold, tut: s.tut, statues: s.statues, up: s.up, dog: s.dog || null, swords: s.swords, equip: s.equip, stats: s.stats, xp: s.xp, tal: s.tal, daily: s.daily, ach: s.ach, week: s.week, stash: s.stash, travel: s.travel });
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
    this.bc({ t: 'pjoin', id: P.id, name: P.name, look: s.look, cos: wearing(s) }, P);
    conn.send({
      t: 'joined', now: Date.now(),
      room: { id: this.id, name: this.name, seed: this.seed, max: this.max },
      you: { id: P.id, name: P.name, x: P.x, y: P.y, z: P.z },
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, look: p.u.save.look, cos: wearing(p.u.save) })),
      felled: [...this.felled.keys()], chests: [...this.chestOpen.keys()], ores: [...this.oreBack.keys()], mounds: [...this.moundBack.keys()],
      builds: [...this.builds.values()].map(b => this.btuple(b)),
      ruins: this.ruinSt.map(r => r.st), weather: this.weather.k, trader: this.traderInfo(), pot: this.potInfo(), pyr: this.pyrInfo(), week: this.weekInfo(),
    });
    this.sendInv(P);
    for (const n of P.u.save.notes.splice(0)) this.toast(P, n, '#ffd27a');   // berichten van terwijl je weg was (bv. weekprijs)
    return P;
  }

  removePlayer(P) {
    this.endFishing(P); this.leaveBoat(P);
    if (P.dog) { this.dogs.delete(P.dog.id); P.dog = null; }
    this.players.delete(P.id);
    this.markDirty();
    this.bc({ t: 'pleave', id: P.id });
    if (!this.players.size) this.emptySince = Date.now();
  }

  handle(P, m) {
    switch (m.t) {
      case 'in': {
        if (P.dead) return;
        if (this.T < (P.posLock || 0)) return;          // net door de server verplaatst (reizen): oude posities van onderweg negeren
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
        if (this.T < (P.rootUntil || 0)) { x = P.x; z = P.z; }       // vastgegroeid door de Woudreus
        if (!P.boat) {                                                // niet door muren heen
          const stop = this.wallBlock(P.x, P.z, x, z);
          if (stop) {
            [x, z] = stop; P.wallHits = (P.wallHits || 0) + 1;
            if (this.T - (P.lastCorrect || -9) > 0.25) { P.lastCorrect = this.T; P.conn.send({ t: 'correct', x: r2(x), y: r2(this.world.heightAt(x, z)), z: r2(z) }); }
          }
        }
        [x, z] = clampXZ(x, z);
        P.vx = (x - P.x) / since; P.vz = (z - P.z) / since;
        P.x = x; P.z = z;
        if (P.boat) { P.boat.x = x; P.boat.z = z; P.boat.rot = num(m.yaw, P.boat.rot); }
        const h = Math.max(this.world.heightAt(P.x, P.z), P.boat ? WATER - 1 : -99);
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
        if (mutedUntil(P.u)) { P.lastChat = this.T; return this.toast(P, muteText(P.u), '#ff9c8a'); }
        P.lastChat = this.T; logChat(this.name, P.name, text);
        this.bc({ t: 'chat', id: P.id, name: P.name, text, ping: m.ping ? { x: r1(P.x), z: r1(P.z) } : null });
        break;
      }
      case 'build': this.build(P, String(m.kind), num(m.x, NaN), num(m.z, NaN), num(m.rot, 0)); break;
      case 'unbuild': this.unbuild(P, m.id | 0); break;
      case 'talent': if (applyTalent(P.u.save, String(m.id))) { this.applyStats(P); this.sendInv(P); this.markDirty(); } break;
      case 'forge': this.forge(P, m.i | 0); break;
      case 'melt': this.melt(P, m.i | 0); break;
      case 'ruin': this.ruin(P, m.i | 0); break;
      case 'board': this.board(P, m.id | 0); break;
      case 'unboard': this.unboard(P); break;
      case 'dig': this.dig(P, m.i | 0); break;
      case 'revive': this.startRevive(P, m.id | 0); break;
      case 'cook': this.cook(P, String(m.id)); break;
      case 'stash': this.stash(P, String(m.op)); break;
      case 'travel': this.travelStart(P); break;
      case 'sell': this.sellStatues(P, String(m.k)); break;
      case 'pyramid': this.openPyramid(P); break;
      case 'bzbuy': this.bazaarBuy(P, String(m.id)); break;
      case 'dogcmd': this.dogCmd(P, String(m.c), m.id | 0); break;
      case 'give': this.give(P, m.to | 0, String(m.what), m.n | 0, m.i | 0); break;
      case 'deposit': this.deposit(P, m.n | 0); break;
      case 'tbuy': this.traderBuy(P, String(m.id)); break;
      case 'cast': this.cast(P, num(m.x, NaN), num(m.z, NaN)); break;
      case 'reel': this.reel(P); break;
      case 'feeddog': this.feedDog(P); break;
      case 'tutskip': P.u.save.tut = 999; ensureSave(P.u); this.sendInv(P); this.markDirty(); break;
    }
  }

  eqItem(P) {
    const s = P.u.save;
    return s.equip === 0 ? AXE : (s.swords[s.equip - 1] || AXE);
  }

  cheat(P, [cmd, a, b]) {
    const sc = this.waveScale || { hp: 1, dmg: 1, spd: 1 };
    if (cmd === 'spawn') for (let i = 0; i < Math.min(10, +b || 1); i++) {
      const t = Math.max(0, Math.min(MONSTERS.length - 1, a | 0)), ang = Math.random() * 6.28, x = P.x + Math.cos(ang) * 12, z = P.z + Math.sin(ang) * 12;
      const m = this.spawnMonster(t, x, z, sc.hp, sc.dmg, sc.spd); this.wave.ph = 1;
      if (inDesert(P.x, P.z)) { m.zone = 'desert'; m.wave = false; }
    }
    if (cmd === 'golf') { this.monsters.clear(); this.startWave(a || null); }
    if (cmd === 'god') P.god = !P.god;
    if (cmd === 'hond' && !P.u.save.dog) { P.u.save.dog = { name: 'Testje', level: 3, xp: 0, fur: 1, breed: breedOf(a).id }; this.spawnOwnedDog(P); this.sendInv(P); }
    if (cmd === 'weer') { this.weather.k = WEATHERS.some(w => w.k === a) ? a : 'onweer'; this.weather.until = this.T + 600; this.weather.bolt = this.T + 2; this.bc({ t: 'weather', k: this.weather.k }); }
    if (cmd === 'piramide') { if (this.pyr.st === 'cool') this.pyrSet('idle'); P.u.save.gold += 30; this.sendInv(P); }
    if (cmd === 'tp') { const x = +a, z = +b; if (Number.isFinite(x) && Number.isFinite(z)) { P.x = x; P.z = z; P.y = this.world.heightAt(x, z); P.lastInT = this.T; P.posLock = this.T + 0.3; P.conn.send({ t: 'correct', x: r2(x), y: r2(P.y), z: r2(z) }); } }
    if (cmd === 'stil') { this.monsters.clear(); this.projs.length = 0; this.hazards.length = 0; this.wave.ph = 0; this.wave.t = 9999; if (this.pyr.st === 'guards' || this.pyr.st === 'boss') this.pyrSet('idle'); }
    if (cmd === 'goud') { P.u.save.gold += Math.min(100000, a | 0); this.sendInv(P); }
    if (cmd === 'handelaar') { this.trader = null; this.traderAt = this.T; }
    if (cmd === 'zwaard') this.giveSword(P, rollSwordOfRarity(Math.max(0, Math.min(4, a | 0))), 'chest');
    if (cmd === 'erts') { P.u.save.ore += Math.min(1000, a | 0); this.sendInv(P); }
    if (cmd === 'xp') { this.addXp(P, Math.min(100000, a | 0)); this.sendInv(P); }
    if (cmd === 'hout') { P.u.save.wood += Math.min(10000, a | 0); this.sendInv(P); }
  }

  update(dt) {
    this.T += dt; this.tickN++;
    for (const P of this.players.values()) {
      if (P.dead) { if (this.T >= P.respawnAt) this.respawn(P); continue; }
      if (P.reviving) this.updateRevive(P);
      const warm = this.nearFire(P);
      if ((this.tickN + P.id) % 20 === 0) {
        P.biome = this.world.biomeAt(P.x, P.z);
        const bs = P.u.save.biomes; if (!bs[P.biome]) { bs[P.biome] = 1; this.sendInv(P); this.markDirty(); }
      }
      const cold = P.biome === 'snow' && !warm ? 1.3 : 1;
      P.hunger = Math.max(0, P.hunger - CFG.hungerRate * dt * (warm ? 0.5 : 1) * cold * (1 - 0.1 * tal(P.u.save, 'maag')) * (this.buff(P, 'hearty') ? 0.5 : 1));
      if (this.buff(P, 'regen') && P.hp < P.mhp) P.hp = Math.min(P.mhp, P.hp + REGEN_PER_SEC * dt);
      if (warm && P.hp < P.mhp) P.hp = Math.min(P.mhp, P.hp + 3 * dt);
      P.u.save.stats.playSec += dt; bump('playSec', dt);
      if (P.hunger <= 0) {
        P.starve += dt;
        if (P.starve >= 1.5) { P.starve = 0; this.hurt(P, 4, null, 'melee', 'honger'); if (P.dead) continue; }
      } else if (P.hunger >= 40 && this.T - P.lastHurt > 6 && P.hp < P.mhp) P.hp = Math.min(P.mhp, P.hp + 1.5 * dt);
      if (P.pendingHit >= 0 && this.T >= P.pendingHit) { P.pendingHit = -1; this.resolveHit(P); }
      this.updateFishing(P);
      if (P.digging && this.T >= P.digging.until) this.finishDig(P);
      if (P.travel) this.updateTravel(P);
      if ((this.tickN + P.id) % 10 === 0) {
        const des = inDesert(P.x, P.z);
        if (des && !P.wasDesert && !P.boat) { P.u.save.stats.voyages++; bump('voyages'); this.tutorial(P, 'voyage'); this.toast(P, '🏝️ Welkom op het Woestijneiland! Graaf in zandbergen (E) naar faraobeelden en verkoop ze bij Farid voor goud.', '#f2c14e'); this.sendInv(P); }
        if (!P.boat) P.wasDesert = des;
      }
    }

    const w = this.wave;
    if (w.ph === 0) { w.t -= dt * (this.isNight() ? 1 / NIGHT.gap : 1); if (w.t <= 0) this.startWave(); }   // 's nachts komt de volgende golf sneller
    else if (this.waveLeft() === 0) this.endWave();

    this.updateWorldEvents(dt);
    this.updatePyramid();
    this.updateMonsters(dt);
    this.updateTowers();
    this.updateSpikes(dt);
    this.updateAnimals(dt);
    this.updateDogs(dt);

    if (this.tickN % 20 === 0) {
      for (const [i, t] of this.felled) if (this.T >= t) { this.felled.delete(i); this.treeHp[i] = this.world.trees[i].hp0; this.bc({ t: 'ev', k: 'treeBack', i }); }
      for (const [i, t] of this.chestOpen) if (this.T >= t) { this.chestOpen.delete(i); this.bc({ t: 'ev', k: 'chestBack', i }); }
      for (const [i, t] of this.moundBack) if (this.T >= t) { this.moundBack.delete(i); this.bc({ t: 'ev', k: 'moundBack', i }); }
      for (const [i, t] of this.oreBack) if (this.T >= t) { this.oreBack.delete(i); this.oreLeft[i] = this.world.ores[i].rich ? 6 : 4; this.bc({ t: 'ev', k: 'oreBack', i }); }
    }
    if (this.tickN % 2 === 0) this.snapshot();
  }

  /**
   * Stuurt elke speler zijn eigen snapshot: spelers en honden altijd, monsters en dieren alleen in de buurt.
   * Om de keer een 'volle' snapshot (f:1, alles binnen de grote straal; wat ontbreekt mag de client opruimen)
   * en daartussen een kleine met alleen wat dichtbij is (de client houdt de rest gewoon vast).
   */
  snapshot() {
    const full = this.tickN % 4 === 0, p = [], d = [];
    for (const e of this.dogs.values()) d.push([e.id, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), e.maxhp, e.owner ? e.owner.id : 0, e.state === 'wild' ? (e.sit ? 3 : 0) : e.state === 'down' ? 2 : (e.cmd === 'stay' && !e.target ? 3 : 1), e.level, e.name, e.fur, e.boostUntil > this.T ? Math.ceil(e.boostUntil - this.T) : 0, DOG_BREEDS.findIndex(b => b.id === e.breed)]);
    for (const P of this.players.values()) p.push([P.id, r1(P.x), r1(P.y), r1(P.z), r2(P.yaw), Math.round(P.hp), eqCode(this.eqItem(P)), P.dead ? 1 : 0, P.swings, P.boat ? P.boat.id : 0, P.digging ? 1 : 0]);
    const mons = [...this.monsters.values()].map(e => [e, [e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]]);
    const anis = [...this.animals.values()].map(e => [e, [e.id, e.type, r1(e.x), r1(e.z), r2(e.yaw), Math.round(e.hp), Math.round(e.maxhp)]]);
    const nn = this.isNight();   // nacht: de wachttijd loopt twee keer zo snel, dus echte seconden sturen
    const head = JSON.stringify({ t: 's', f: full ? 1 : 0, p, d, w: { n: this.wave.n, ph: this.wave.ph, t: Math.max(0, Math.ceil(this.wave.t * (nn ? NIGHT.gap : 1))), left: this.waveLeft(), mod: this.wave.mod, night: this.wave.night ? 1 : 0, nn: nn ? 1 : 0 } }).slice(0, -1);
    const rm = full ? SNAP.monFar : SNAP.near, ra = full ? SNAP.aniFar : SNAP.near;
    for (const P of this.players.values()) {
      const near = (e, r) => Math.abs(e.x - P.x) < r && Math.abs(e.z - P.z) < r && len(e.x - P.x, e.z - P.z) < r;
      const m = [], a = [];
      for (const [e, t] of mons) if (MONSTERS[e.type].boss || e.type === 8 || near(e, rm)) m.push(t);
      for (const [e, t] of anis) if (near(e, ra)) a.push(t);
      const you = { hp: Math.round(P.hp), mhp: P.mhp, bf: this.buffInfo(P), hu: Math.round(P.hunger), sc: P.u.save.stats.score, rs: P.dead ? Math.max(0, Math.ceil(P.respawnAt - this.T)) : 0 };
      P.conn.send(head + ',"m":' + JSON.stringify(m) + ',"a":' + JSON.stringify(a) + ',"y":' + JSON.stringify(you) + '}');
    }
  }

}

// De rest van de kamer staat per onderwerp in room/*.js.
for (const Mixin of [Progress, Economy, Combat, Waves, Animals, Dogs, Fishing, Social, WorldEvents, Desert, Building, Pyramid, Bosses, Cooking, Travel]) {
  for (const k of Object.getOwnPropertyNames(Mixin.prototype)) if (k !== 'constructor') Object.defineProperty(Room.prototype, k, Object.getOwnPropertyDescriptor(Mixin.prototype, k));
}
