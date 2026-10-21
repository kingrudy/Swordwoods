// Bouwwerken: plaatsen, afbreken, schade, opslaan, kampvuur en wachttorens.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { XP } from '../public/progress.js';
import { bump } from '../stats.js';
import { BUILD_BY_ID, BUILD_RANGE, BUILD_MAX_ROOM, BUILD_MAX_PLAYER, BUILD_REFUND, FIRE_RADIUS, canPlace, pushOut, boundR } from '../public/builds.js';
import { r1, r2, len } from './shared.js';

export class Building {
  /**
   * Controleert of een stap van (ox,oz) naar (x,z) dwars door een muur, palissade, toren of kampvuur gaat.
   * De client botst zelf al met straal 0,38; hier testen we ruim (0,12), zodat alleen echte doorsteken worden
   * tegengehouden. Geeft de laatste geldige plek terug, of null als de stap mag.
   */
  wallBlock(ox, oz, x, z) {
    if (!this.builds.size) return null;
    const r = 0.12, cand = [];
    for (const b of this.builds.values()) {
      const B = BUILD_BY_ID[b.kind]; if (!B.solid) continue;
      const R = boundR(B) + r + 0.2;
      if (Math.max(ox, x) < b.x - R || Math.min(ox, x) > b.x + R || Math.max(oz, z) < b.z - R || Math.min(oz, z) > b.z + R) continue;
      if (pushOut(b, ox, oz, r)) continue;          // stond er al in (bv. net iets op je gebouwd): eruit lopen mag
      cand.push(b);
    }
    if (!cand.length) return null;
    const n = Math.max(1, Math.ceil(len(x - ox, z - oz) / 0.2));
    let px = ox, pz = oz;
    for (let i = 1; i <= n; i++) {
      const sx = ox + (x - ox) * i / n, sz = oz + (z - oz) * i / n;
      for (const b of cand) if (pushOut(b, sx, sz, r)) return [px, pz];
      px = sx; pz = sz;
    }
    return null;
  }

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
    if (b.rider) { const R = this.players.get(b.rider); if (R) R.boat = null; b.rider = null; }
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
}
