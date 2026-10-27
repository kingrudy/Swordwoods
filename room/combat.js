// Slaan (licht en zwaar), treffers op monsters, dieren en spelers (arena), schade, dood en respawn.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { inDesert } from '../public/world.js';
import { AXE, MONSTERS, ANIMALS, SHIELD_REDUCE, HEAVY_MUL, BLOCK_MELEE } from '../public/items.js';
import { XP, tal } from '../public/progress.js';
import { bump } from '../stats.js';
import { r1, r2, len, CFG } from './shared.js';

export const REVIVE_SEC = 3, REVIVE_R = 2.6;   // opknappen: zo lang naast een gevallen medespeler blijven

export class Combat {
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
        const n = (3 + Math.floor(best.scale * 2) + tal(s, 'houthakker')) * this.wk('wood');
        s.wood += n; s.stats.trees++; this.addXp(P, XP.tree); this.quest(P, 'tree');
        this.bc({ t: 'ev', k: 'felled', i: best.idx, dx: r2(dx / d), dz: r2(dz / d) });
        this.toast(P, '+' + n + ' hout', '#c89a5e');
        this.sendInv(P); this.markDirty();
      }
    }
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

  hitEnemy(P, it, e, kind, heavy) {
    const s = P.u.save, full = P.hunger >= 80 ? 1.15 : 1;   // goed gevoed = iets sterker
    const dmg0 = (it.type === 'axe' ? AXE.damage + s.up.axe * 2 : it.damage) * full * (0.9 + Math.random() * 0.2) * (heavy ? HEAVY_MUL : 1) * (1 + 0.06 * tal(s, 'kracht')) * (this.buff(P, 'elixir') ? 1.25 : 1) * (this.buff(P, 'feast') ? 1.1 : 1) * (this.buff(P, 'royal') ? 1.15 : 1);
    const [gf, parried] = kind === 'm' ? this.guardFactor(e, P) : [1, false];   // Schaduwridder pareert van voren
    const dmg = dmg0 * gf;
    e.hp -= dmg; e.stun = Math.max(e.stun || 0, parried ? 0 : heavy ? 0.5 : 0.18);
    if (heavy && !parried && !(kind === 'm' && MONSTERS[e.type].boss)) {          // terugduwen (niet de baas)
      const dx = e.x - P.x, dz = e.z - P.z, d = len(dx, dz) || 1, r = kind === 'm' ? MONSTERS[e.type].r : ANIMALS[e.type].r;
      this.move(e, e.x + dx / d * 1.4, e.z + dz / d * 1.4, r);
    }
    if (kind === 'a') { e.angry = true; e.hurtT = this.T; }
    this.bc({ t: 'ev', k: 'hit', e: kind, id: e.id, dmg: Math.round(dmg), x: r1(e.x), z: r1(e.z), heavy: heavy ? 1 : 0, ...(parried ? { parry: 1 } : {}) });
    if (e.hp <= 0) { if (kind === 'm') { this.killMonster(e, P); if (heavy) { s.stats.heavyKills++; this.quest(P, 'heavy'); } } else this.killAnimal(e, P); }
  }

  hurt(P, dmg, src, kind = 'melee', cause = null) {
    if (P.dead || P.god) return;
    P.cause = cause || (kind === 'arrow' ? 'schutter' : !src ? 'onbekend' : src.isPlayer ? 'speler' : src.angry !== undefined ? ANIMALS[src.type].key : src.abRoots !== undefined ? MONSTERS[src.type].key : 'onbekend');
    if (src && this.T < (P.iframe || 0)) { P.conn.send({ t: 'ev', k: 'dodged' }); return; }
    if (src && P.blocking) {
      const dx = src.x - P.x, dz = src.z - P.z, d = len(dx, dz) || 1;
      if ((dx * -Math.sin(P.yaw) + dz * -Math.cos(P.yaw)) / d > 0.35) {
        dmg *= kind === 'arrow' ? 0 : BLOCK_MELEE;
        if (kind !== 'arrow' && src.stun !== undefined) src.stun = Math.max(src.stun, 0.35);
        if (kind !== 'arrow') this.onBlocked(src);
        this.bc({ t: 'ev', k: 'blocked', id: P.id, x: r1(P.x), z: r1(P.z) });
        if (dmg <= 0) return;
      }
    }
    dmg *= (1 - SHIELD_REDUCE[P.u.save.up.shield]) * (this.buff(P, 'feast') ? 0.9 : 1) * (this.buff(P, 'royal') ? 0.9 : 1);
    if (kind === 'arrow' && (P.arrowHits = (P.arrowHits || 0) + 1) === 3) this.toast(P, '🛡️ Tip: blokkeer pijlen met je schild (rechtermuisknop, LT of 🛡️): van voren houdt het ze helemaal tegen. Of loop zijwaarts.', '#9ad8ff');
    P.hp -= dmg; P.lastHurt = this.T;
    P.conn.send({ t: 'hurt', dmg: Math.round(dmg), x: src ? r1(src.x) : null, z: src ? r1(src.z) : null });
    if (P.hp <= 0) { if (src && src.isPlayer && this.inArena(P)) this.arenaKO(P, src); else this.die(P); }
  }

  die(P) {
    this.leaveBoat(P); P.digging = null; P.diedInDesert = inDesert(P.x, P.z);
    P.hp = 0; P.dead = true; P.blocking = false; P.respawnAt = this.T + CFG.respawn; P.pendingHit = -1;
    if (P.reviving) this.stopRevive(P);
    const s = P.u.save; s.stats.deaths++;
    bump('deaths'); bump('death.' + (P.cause || 'onbekend'));
    const helpers = [...this.players.values()].some(q => q !== P && !q.dead);
    P.conn.send({ t: 'dead', in: CFG.respawn, help: helpers });
    this.bc({ t: 'ev', k: 'pdead', id: P.id });
    this.sendInv(P); this.markDirty();
    if ([...this.players.values()].every(p => p.dead)) this.wipe();
  }

  respawn(P) {
    const sp = this.world.spawn, s = P.u.save, lost = s.wood - Math.floor(s.wood / 2);
    s.wood -= lost;                 // niemand knapte je op: de helft van je hout ben je kwijt
    P.dead = false; P.hp = P.mhp; P.hunger = Math.max(P.hunger, 50);
    P.x = sp.x + (Math.random() - 0.5) * 4; P.z = sp.z + (Math.random() - 0.5) * 4;
    const bed = this.bedOf(P), H = this.world.desert.harbor;
    if (P.diedInDesert) { P.x = H.x + 2 + Math.random() * 3; P.z = H.z + (Math.random() - 0.5) * 4; }
    else if (bed) { const a = bed.rot + Math.PI / 2; P.x = bed.x + Math.sin(a) * 1.3; P.z = bed.z + Math.cos(a) * 1.3; }
    P.y = this.world.heightAt(P.x, P.z);
    P.lastInT = this.T;
    P.conn.send({ t: 'respawn', x: P.x, y: P.y, z: P.z, lost });
    this.sendInv(P); this.markDirty();
  }

  /* ---------------------------------------------------------------- opknappen: een gevallen medespeler weer op de been helpen */
  startRevive(P, id) {
    const T = this.players.get(id);
    if (!T || T === P || !T.dead || P.dead || P.boat || P.reviving || this.reviverOf(T)) return;
    if (len(T.x - P.x, T.z - P.z) > REVIVE_R) return;
    P.reviving = { id, until: this.T + REVIVE_SEC };
    T.respawnAt = Math.max(T.respawnAt, P.reviving.until + 0.5);     // niet terug naar het begin terwijl iemand je helpt
    this.bc({ t: 'ev', k: 'revstart', id, by: P.id, dur: REVIVE_SEC });
  }
  reviverOf(T) { for (const q of this.players.values()) if (q.reviving && q.reviving.id === T.id) return q; return null; }
  stopRevive(P) { const R = P.reviving; P.reviving = null; this.bc({ t: 'ev', k: 'revfail', id: R.id, by: P.id }); }
  updateRevive(P) {
    const R = P.reviving, T = this.players.get(R.id);
    if (!T || !T.dead || len(T.x - P.x, T.z - P.z) > REVIVE_R + 0.8) return this.stopRevive(P);
    if (this.T < R.until) return;
    P.reviving = null;
    T.dead = false; T.hp = Math.round(T.mhp * 0.4); T.hunger = Math.max(T.hunger, 30); T.lastInT = this.T; T.lastHurt = this.T; T.iframe = this.T + 1.5;
    const s = P.u.save; s.stats.revives = (s.stats.revives | 0) + 1; bump('revives');
    this.addXp(P, 25);
    T.conn.send({ t: 'revived', by: P.name, hp: T.hp });
    this.bc({ t: 'ev', k: 'revived', id: T.id, by: P.id, x: r1(T.x), z: r1(T.z) });
    this.toast(P, '❤️ Je hebt ' + T.name + ' opgeknapt!', '#6fd37a');
    this.sendInv(P); this.markDirty();
  }
}
