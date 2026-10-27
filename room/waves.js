// Golven, monsters en hun gedrag (schutters, sluipers, hondenjagers, baas), pijlen en wortels.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER, clampXZ, inDesert } from '../public/world.js';
import { rollSword, MONSTERS, WAVE_MODS, bossForWave } from '../public/items.js';
import { XP } from '../public/progress.js';
import { bump, maxOf } from '../stats.js';
import { BUILD_BY_ID, pushOut, boundR } from '../public/builds.js';
import { r1, r2, len, CFG } from './shared.js';

export class Waves {
  wipe() {
    bump('wipe.' + String(this.wave.n).padStart(2, '0'));
    const w = this.wave; if (w.ph === 1) { if (w.failN === w.n) w.fails++; else { w.failN = w.n; w.fails = 1; } }
    this.monsters.clear(); this.projs.length = 0; this.hazards.length = 0; this.zones.length = 0; this.wave.mod = null;
    if (this.pyr.st === 'guards' || this.pyr.st === 'boss') this.pyrSet('idle');
    this.wave.n = Math.max(0, this.wave.n - 1); this.wave.ph = 0; this.wave.t = CFG.wipeDelay;
    this.bc({ t: 'wave', ph: 0, n: this.wave.n, wipe: true, next: this.wave.t });
  }

  pickAlive() { const a = [...this.players.values()].filter(p => !p.dead && !inDesert(p.x, p.z)); return a[Math.floor(Math.random() * a.length)] || null; }

  startWave(forceMod = null) {
    const w = this.wave; w.n++; w.ph = 1; w.startT = this.T;
    const n = w.n, alive = [...this.players.values()].filter(p => !p.dead).length || 1;
    const mod = forceMod ? WAVE_MODS.find(x => x.id === forceMod) : (n >= 3 && n % 5 !== 0 && Math.random() < 0.45 ? WAVE_MODS[Math.floor(Math.random() * WAVE_MODS.length)] : null);
    w.mod = mod ? mod.id : null;
    const tired = w.fails && w.failN === n ? Math.min(3, w.fails) : 0;   // na een wipe op deze golf: telkens iets makkelijker (max 3 keer)
    const ease = 1 - 0.12 * tired;
    const scale = { hp: (1 + 0.30 * (n - 1)) * (mod?.hp || 1) * ease, dmg: (1 + 0.12 * (n - 1)) * (mod?.dmg || 1) * ease, spd: Math.min(1.4, 1 + 0.02 * (n - 1)) * (mod?.spd || 1) };
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
    const boss = n % 5 === 0 ? bossForWave(n) : 0;
    if (boss) list.push(boss);
    let spawned = 0;
    for (const type of list) {
      const P = this.pickAlive(), cx = P ? P.x : 0, cz = P ? P.z : 0;
      const pt = this.world.landPoint(Math.random, cx, cz, 38, 58, 0.0) || this.world.landPoint(Math.random, 0, 0, 20, 90, 0.0);
      if (!pt) continue;
      const bossMul = MONSTERS[type].boss ? (1 + 0.25 * (n / 5 - 1)) * (alive === 1 ? 0.75 : 1) : 1;   // alleen tegen de baas: wat minder levens
      this.spawnMonster(type, pt.x, pt.z, hpMul * bossMul, scale.dmg * bossMul, scale.spd); spawned++;
    }
    this.bc({ t: 'wave', ph: 1, n, boss: boss || 0, count: spawned, mod: w.mod, ease: tired ? Math.round((1 - ease) * 100) : 0 });
    if (w.mod) bump('mod.' + w.mod);
  }

  spawnMonster(type, x, z, hpMul, dmgMul, spdMul) {
    const M = MONSTERS[type];
    const m = {
      id: this.eid++, type, x, z, yaw: 0, hp: M.hp * hpMul, maxhp: M.hp * hpMul,
      dmg: M.dmg * dmgMul, speed: M.speed * spdMul, nextAtk: 0, stun: 0, retarget: 0, target: null,
      wave: true,   // telt mee voor het einde van de golf (bewakers van ruïnes en piramide niet)
      abRoots: this.T + 6, abSummon: this.T + 12, abSand: this.T + 5, abFrost: this.T + 6, abPoison: this.T + 5, abBlink: this.T + 9, abDash: this.T + 4, lungeCd: 0, lungeUntil: 0, strafe: Math.random() < 0.5 ? 1 : -1,
    };
    this.monsters.set(m.id, m);
    return m;
  }

  waveLeft() { let n = 0; for (const m of this.monsters.values()) if (m.wave) n++; return n; }

  endWave() {
    const w = this.wave, modW = (w.mod ? 1.5 : 1) * this.wk('wave'); w.ph = 0; w.t = CFG.waveGap; w.mod = null; w.fails = 0; w.failN = 0;
    bump('waves'); bump('waveSec', this.T - (w.startT || this.T)); bump('wave.reached.' + String(w.n).padStart(2, '0')); maxOf('wave.max', w.n);
    this.projs.length = 0; this.hazards.length = 0; this.zones.length = 0;
    for (const P of this.players.values()) {
      if (P.dead) continue;
      const s = P.u.save; s.stats.bestWave = Math.max(s.stats.bestWave, w.n);
      this.addXp(P, XP.wave * w.n * this.wk('wave')); this.quest(P, 'wave', w.n, true);
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
    if (m.type === 8) this.pharaohDown(m);
    if (!P) { this.bc({ t: 'ev', k: 'mdie', id: m.id, x: r1(m.x), z: r1(m.z), type: m.type }); return; }
    const M = MONSTERS[m.type], s = P.u.save;
    s.stats.kills++; s.stats.score += M.score * Math.max(1, this.wave.n);
    if (M.boss) s.stats.bosses++;
    bump('kills'); bump('kill.' + M.key);
    this.addXp(P, M.score * XP.kill); this.quest(P, 'kill');
    this.bc({ t: 'ev', k: 'mdie', id: m.id, x: r1(m.x), z: r1(m.z), type: m.type });
    if (Math.random() < (M.boss ? 1 : 0.06 * this.wk('drop'))) this.giveSword(P, rollSword(Math.min(1, this.wave.n / 12)), 'monster');
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

  /** Bosmonsters jagen alleen op het bos-eiland, piramidemonsters alleen in de woestijn. */
  targetOk(t, zone) { return t && inDesert(t.x, t.z) === (zone === 'desert') && (t.isDog ? this.dogs.has(t.id) && t.state === 'follow' : !t.dead && !t.boat && this.players.has(t.id)); }

  updateMonsters(dt) {
    const alive = [], aliveD = [];   // doelen op het bos-eiland en in de woestijn
    for (const p of this.players.values()) if (!p.dead && !p.boat) (inDesert(p.x, p.z) ? aliveD : alive).push(p);
    for (const d of this.dogs.values()) if (d.state === 'follow') (inDesert(d.x, d.z) ? aliveD : alive).push(d);
    const arr = [...this.monsters.values()];
    for (const m of arr) {
      if (m.stun > 0) { m.stun -= dt; continue; }
      const M = MONSTERS[m.type], pool = m.zone === 'desert' ? aliveD : alive;
      m.retarget -= dt;
      if (m.retarget <= 0 || !this.targetOk(m.target, m.zone)) {
        m.retarget = 0.6;
        const dogT = M.hunter ? this.nearest(pool.filter(d => d.isDog), m.x, m.z, 80) : null;   // hondenjager: eerst de honden
        const taunt = this.nearest(pool.filter(d => d.isDog && d.breed === 'waak'), m.x, m.z, 8);   // waakhond trekt de aandacht
        m.target = dogT || taunt || this.nearest(pool, m.x, m.z, m.pyr ? 70 : 400);
      }
      const tg = m.target; if (!tg) continue;
      let dx = tg.x - m.x, dz = tg.z - m.z, d = len(dx, dz);
      if (d > 140 && !m.pyr) {   // te ver weg geraakt: dichter bij de speler zetten
        const pt = this.world.landPoint(Math.random, tg.x, tg.z, 45, 60, 0.0);
        if (pt) { m.x = pt.x; m.z = pt.z; dx = tg.x - m.x; dz = tg.z - m.z; d = len(dx, dz); }
      }
      m.yaw = Math.atan2(-dx, -dz);
      if (M.boss) this.bossAbilities(m, pool);
      else if (m.type === 8) this.pharaohAbilities(m, pool);
      if (M.ranged && !m.siege) { this.archerAI(m, M, tg, dx, dz, d, dt); continue; }
      let speed = m.speed;
      if (M.stealth) {                              // sluiper: springt het laatste stuk naar voren
        if (d < 6 && d > 1.6 && this.T >= m.lungeCd) { m.lungeCd = this.T + 4; m.lungeUntil = this.T + 0.45; this.bc({ t: 'ev', k: 'lunge', id: m.id }); }
      }
      if (this.T < m.lungeUntil) speed *= 2.6;          // sluiper en Schaduwridder: even naar voren stormen
      const reach = M.r + 0.9;
      if (m.siege && (!this.builds.has(m.siege.id) || len(m.siege.x - m.x, m.siege.z - m.z) > boundR(BUILD_BY_ID[m.siege.kind]) + M.r + 1.2)) m.siege = null;
      if (m.siege && d > reach) {                 // bouwwerk in de weg: eerst kapotslaan
        const sb = m.siege;
        m.yaw = Math.atan2(-(sb.x - m.x), -(sb.z - m.z));
        if (this.T >= m.nextAtk) {
          m.nextAtk = this.T + M.atkCd; m.siegeHits = (m.siegeHits || 0) + 1;
          this.bc({ t: 'ev', k: 'matk', id: m.id });
          this.hurtBuild(sb, m.dmg * (M.boss ? 2.5 : 1.3), m);
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
    this.updateProjectiles(dt); this.updateHazards(dt);
    // niet op elkaar stapelen
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j], dx = b.x - a.x, dz = b.z - a.z, d = len(dx, dz), min = MONSTERS[a.type].r + MONSTERS[b.type].r;
      if (d < min && d > 0.001) { const push = (min - d) * 0.5; a.x -= dx / d * push; a.z -= dz / d * push; b.x += dx / d * push; b.z += dz / d * push; }
    }
  }

  archerAI(m, M, tg, dx, dz, d, dt) {
    // blijft op 9-17 m afstand, loopt zijwaarts en schiet pijlen die je kunt ontwijken of blokkeren
    let mx = 0, mz = 0;
    if (d > 15) { mx = dx / d; mz = dz / d; }
    else if (d < 5.5) { mx = -dx / d * 0.75; mz = -dz / d * 0.75; }   // deinst wat terug, maar je kunt hem bijhouden
    else { mx = -dz / d * m.strafe * 0.5; mz = dx / d * m.strafe * 0.5; if (Math.random() < dt * 0.3) m.strafe *= -1; }
    if (mx || mz) { const ox = m.x, oz = m.z; this.move(m, m.x + mx * m.speed * dt, m.z + mz * m.speed * dt, M.r); if (len(m.x - ox, m.z - oz) < 0.01) m.strafe *= -1; }
    if (d < 20 && this.T >= m.nextAtk) {
      m.nextAtk = this.T + M.atkCd * (0.85 + Math.random() * 0.3);
      const lead = Math.min(0.6, d / 20) * 0.3, ax = tg.x + (tg.vx || 0) * lead, az = tg.z + (tg.vz || 0) * lead;   // mikt maar half voor: zijwaarts lopen ontwijkt
      const ddx = ax - m.x, ddz = az - m.z, dd = len(ddx, ddz) || 1, sp = 20;
      const pr = { x: m.x + ddx / dd * 0.6, z: m.z + ddz / dd * 0.6, vx: ddx / dd * sp, vz: ddz / dd * sp, life: 1.2, dmg: m.dmg, src: m };
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
}
