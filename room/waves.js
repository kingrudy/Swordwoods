// Golven, monsters en hun gedrag (schutters, sluipers, hondenjagers, baas), pijlen en wortels.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER, clampXZ, inDesert } from '../public/world.js';
import { rollSword, MONSTERS, WAVE_MODS } from '../public/items.js';
import { XP } from '../public/progress.js';
import { bump, maxOf } from '../stats.js';
import { BUILD_BY_ID, pushOut, boundR } from '../public/builds.js';
import { r1, r2, len, CFG } from './shared.js';

export class Waves {
  wipe() {
    bump('wipe.' + String(this.wave.n).padStart(2, '0'));
    this.monsters.clear(); this.projs.length = 0; this.hazards.length = 0; this.wave.mod = null;
    this.wave.n = Math.max(0, this.wave.n - 1); this.wave.ph = 0; this.wave.t = CFG.wipeDelay;
    this.bc({ t: 'wave', ph: 0, n: this.wave.n, wipe: true, next: this.wave.t });
  }

  pickAlive() { const a = [...this.players.values()].filter(p => !p.dead && !inDesert(p.x, p.z)); return a[Math.floor(Math.random() * a.length)] || null; }

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

  /** Beweegt entiteit richting (nx,nz) met botsing tegen water en bomen. */
  move(e, nx, nz, r) {
    const w = this.world;
    [nx, nz] = clampXZ(nx, nz);
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

  targetOk(t) { return t && !inDesert(t.x, t.z) && (t.isDog ? this.dogs.has(t.id) && t.state === 'follow' : !t.dead && !t.boat && this.players.has(t.id)); }

  updateMonsters(dt) {
    const alive = [...this.players.values()].filter(p => !p.dead && !inDesert(p.x, p.z) && !p.boat);   // monsters blijven op het bos-eiland
    for (const d of this.dogs.values()) if (d.state === 'follow' && !inDesert(d.x, d.z)) alive.push(d);
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
}
