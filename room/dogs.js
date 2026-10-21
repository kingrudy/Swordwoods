// Zwerfhonden, temmen, eigen hond volgen/vechten/commando's, boost, ervaring.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { HALF } from '../public/world.js';
import { MONSTERS, ANIMALS, DOG_NAMES, DOG_MAX_LEVEL, DOG_FURS, dogXpNeeded, DOG_BOOST_SEC, DOG_BOOST_MAX, DOG_BREEDS, breedOf } from '../public/items.js';
import { r1, len, CFG } from './shared.js';

export class Dogs {
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
          if (!d.target.isMon) { e.angry = !!ANIMALS[e.type].fights; e.hurtT = this.T; }
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
      if (P.boat) continue;                     // baasje vaart: de hond wacht en springt er aan land weer bij
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
}
