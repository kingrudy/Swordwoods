// Bazen van de golven (elke 5e golf, om de beurt) en hun vaardigheden, plus de gevaren op de grond:
// wortels (vastgegroeid), ijsstorm (trager), gifwolk (blijft even hangen), bliksem en zandstralen.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER } from '../public/world.js';
import { MONSTERS, GUARD_FRONT, STAGGER_SEC, STAGGER_MUL } from '../public/items.js';
import { r1, len, CFG } from './shared.js';

const SUMMON_MAX = 8;
export const SLOW_SEC = 3, SLOW_MUL = 0.55;

export class Bosses {
  /** Gevaren onder (tot 6) spelers dichtbij: na `delay` s slaat het toe. */
  hazardsUnder(m, near, kind, r, delay, dmg, extra = {}) {
    const pts = near.slice(0, 6).map(p => [r1(p.x), r1(p.z)]);
    for (const [x, z] of pts) this.hazards.push({ x, z, r, at: this.T + delay, dmg: dmg * (this.waveScale?.dmg || 1), kind, ...extra });
    this.bc({ t: 'ev', k: kind, id: m.id, pts, delay, r, ...(extra.dur ? { dur: extra.dur } : {}) });
  }
  /** Roept `n` monsters van soort `type` op rond de baas (hooguit SUMMON_MAX tegelijk). */
  summon(m, type, n) {
    const have = [...this.monsters.values()].filter(x => x.summoned).length, sc = this.waveScale || { hp: 1, dmg: 1, spd: 1 }, pts = [];
    for (let i = 0; i < n && have + i < SUMMON_MAX; i++) {
      const a = Math.random() * 6.28, x = m.x + Math.cos(a) * 3.5, z = m.z + Math.sin(a) * 3.5;
      if (this.world.heightAt(x, z) < WATER + 0.9) continue;
      const k = this.spawnMonster(type, x, z, sc.hp * 0.8, sc.dmg, sc.spd); k.summoned = true; pts.push([r1(x), r1(z)]);
    }
    if (pts.length) this.bc({ t: 'ev', k: 'summon', id: m.id, pts });
  }
  ready(m, key, every) { if (this.T < (m[key] ?? 0)) return false; m[key] = this.T + every * (0.85 + Math.random() * 0.3); return true; }

  bossAbilities(m, alive) {
    const near = alive.filter(p => !p.isDog && len(p.x - m.x, p.z - m.z) < 30);
    if (!near.length) return;
    switch (MONSTERS[m.type].key) {
      case 'reus':          // Woudreus: wortels die je even vastzetten, en kobolds
        if (this.ready(m, 'abRoots', 9.5)) this.hazardsUnder(m, near, 'roots', 2.4, 1.3, 18);
        if (this.ready(m, 'abSummon', 21)) this.summon(m, 0, 3);
        break;
      case 'sneeuwreus':    // Sneeuwreus: ijsstorm die je vertraagt, en wolven
        if (this.ready(m, 'abFrost', 8)) this.hazardsUnder(m, near, 'frost', 2.8, 1.2, 14);
        if (this.ready(m, 'abSummon', 20)) this.summon(m, 1, 3);
        break;
      case 'heks':          // Moerasheks: gifwolken die blijven hangen, verdwijnt en duikt elders op
        if (this.ready(m, 'abPoison', 7)) this.hazardsUnder(m, near, 'poison', 3.0, 1.0, 6, { dur: 6 });
        if (this.ready(m, 'abBlink', 11)) this.blink(m, near);
        if (this.ready(m, 'abSummon', 22)) this.summon(m, 0, 2);
        break;
      case 'ridder':        // Schaduwridder: stormt op je af; pareert alles van voren tot je zijn slag blokt
        if (this.ready(m, 'abDash', 8) && !(m.staggerUntil > this.T)) { m.lungeUntil = this.T + 0.6; this.bc({ t: 'ev', k: 'lunge', id: m.id }); }
        if (this.ready(m, 'abSummon', 24)) this.summon(m, 0, 2);
        break;
    }
  }

  /** Moerasheks: weg in een wolk, en 8-12 m van een speler weer tevoorschijn. */
  blink(m, near) {
    const P = near[Math.floor(Math.random() * near.length)];
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * 6.28, d = 8 + Math.random() * 4, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (this.world.heightAt(x, z) < WATER + 0.9) continue;
      const x0 = m.x, z0 = m.z; m.x = x; m.z = z; m.stun = 0.4;
      this.bc({ t: 'ev', k: 'blink', id: m.id, x0: r1(x0), z0: r1(z0), x: r1(x), z: r1(z) });
      return;
    }
  }

  /** Hoeveel schade van een speler aankomt bij een gepareerde baas. Geeft [factor, gepareerd]. */
  guardFactor(e, P) {
    const M = MONSTERS[e.type]; if (!M || !M.guarded) return [1, false];
    if (e.staggerUntil > this.T) return [STAGGER_MUL, false];
    const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw), dx = P.x - e.x, dz = P.z - e.z, d = len(dx, dz) || 1;
    return (dx * fx + dz * fz) / d > -0.2 ? [GUARD_FRONT, true] : [1, false];   // van voren (of opzij): gepareerd; in de rug: raak
  }
  /** Een speler blokte de slag van de Schaduwridder: hij wankelt. */
  onBlocked(src) {
    if (!src || src.abRoots === undefined || !MONSTERS[src.type]?.guarded) return;   // alleen monsters hebben abRoots
    src.staggerUntil = this.T + STAGGER_SEC; src.stun = Math.max(src.stun, STAGGER_SEC);
    this.bc({ t: 'ev', k: 'stagger', id: src.id, s: STAGGER_SEC });
  }

  /** Gevaren die nu toeslaan; gifwolken blijven daarna nog even hangen. */
  updateHazards(dt = 0.05) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; if (this.T < h.at) continue;
      this.hazards.splice(i, 1);
      if (h.kind === 'poison') { this.zones.push({ x: h.x, z: h.z, r: h.r, until: this.T + h.dur, dps: h.dmg, acc: 0 }); continue; }
      for (const P of this.players.values()) {
        if (P.dead || len(P.x - h.x, P.z - h.z) > h.r) continue;
        if (this.T < (P.iframe || 0)) { P.conn.send({ t: 'ev', k: 'dodged' }); continue; }
        this.hurt(P, h.dmg, null, 'melee', h.bolt ? 'bliksem' : h.sand ? 'zandstraal' : h.kind === 'frost' ? 'ijsstorm' : 'wortels');
        if (h.kind === 'frost') { P.slowUntil = this.T + SLOW_SEC; P.conn.send({ t: 'slowed', s: SLOW_SEC }); }
        else if (!h.bolt && !h.sand) { P.rootUntil = this.T + 1.5; P.conn.send({ t: 'rooted', s: 1.5 }); }
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
    // gifwolken: elke halve seconde schade aan wie erin staat
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      if (this.T >= z.until) { this.zones.splice(i, 1); continue; }
      z.acc += dt; if (z.acc < 0.5) continue; z.acc = 0;
      for (const P of this.players.values()) if (!P.dead && len(P.x - z.x, P.z - z.z) < z.r) this.hurt(P, z.dps * 0.5, null, 'melee', 'gif');
    }
  }
}
