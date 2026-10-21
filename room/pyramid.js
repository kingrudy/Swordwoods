// Piramide op het Woestijneiland: betaal goud bij de ingang, versla de mummies en daarna de mummie-farao.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER, inDesert } from '../public/world.js';
import { PYRAMID, STATUES, rollSwordAtLeast } from '../public/items.js';
import { bump } from '../stats.js';
import { r1, len } from './shared.js';

const MUMMY = 7, PHARAOH = 8;

export class Pyramid {
  pyrInfo() { const p = this.pyr; return { st: p.st, left: p.st === 'cool' ? Math.max(0, Math.ceil(p.until - this.T)) : 0 }; }
  pyrSet(st, until = 0) { Object.assign(this.pyr, { st, until, empty: 0 }); this.bc({ t: 'pyr', ...this.pyrInfo() }); }

  /** Spelers die bij de piramide meevechten (levend, te voet, binnen 60 m). */
  pyrFighters() {
    const py = this.world.desert.pyramid;
    return [...this.players.values()].filter(p => !p.dead && !p.boat && len(p.x - py.x, p.z - py.z) < 60);
  }

  /** Een plek rond de ingang, buiten de piramide zelf. */
  pyrSpot(r0, r1_) {
    const py = this.world.desert.pyramid, e = py.entrance;
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1_ - r0), x = e.x + Math.cos(a) * r, z = e.z + Math.sin(a) * r;
      if (len(x - py.x, z - py.z) > py.r + 1.4 && this.world.heightAt(x, z) > WATER + 0.9) return { x, z };
    }
    return { x: e.x, z: e.z };
  }

  pyrSpawn(type, hpMul, dmgMul, near = null) {
    const pt = near || this.pyrSpot(3, 9);
    const m = this.spawnMonster(type, pt.x, pt.z, hpMul, dmgMul, 1);
    m.wave = false; m.zone = 'desert'; m.pyr = true;
    return m;
  }

  openPyramid(P) {
    const py = this.world.desert.pyramid, s = P.u.save;
    if (!py || P.dead || P.boat || len(py.entrance.x - P.x, py.entrance.z - P.z) > 6) return;
    const p = this.pyr;
    if (p.st === 'cool') return this.toast(P, 'De farao rust nog ' + Math.ceil((p.until - this.T) / 60) + ' min. Kom later terug.', '#bbb');
    if (p.st !== 'idle') return this.toast(P, 'De vloek is al gewekt: versla de mummies!', '#ff9c8a');
    if ((s.gold | 0) < PYRAMID.cost) return this.toast(P, 'Het zegel breken kost ' + PYRAMID.cost + ' goud.', '#ff9c8a');
    s.gold -= PYRAMID.cost; bump('pyramid.open');
    const n = this.pyrFighters().length || 1, hp = 1 + 0.45 * (n - 1);
    const guards = Math.min(12, PYRAMID.guards + PYRAMID.perPlayer * (n - 1));
    for (let i = 0; i < guards; i++) this.pyrSpawn(MUMMY, hp, 1);
    this.pyrSet('guards');
    this.bc({ t: 'ev', k: 'pyrwake', by: P.id, x: r1(py.entrance.x), z: r1(py.entrance.z) });
    this.bc({ t: 'toast', msg: '⚱️ ' + P.name + ' heeft het zegel van de piramide gebroken. De mummies ontwaken!', color: '#f2c14e' });
    this.sendInv(P); this.markDirty();
  }

  updatePyramid() {
    const p = this.pyr; if (p.st === 'idle') return;
    if (p.st === 'cool') { if (this.T >= p.until) this.pyrSet('idle'); return; }
    if (this.tickN % 10) return;
    const mine = [...this.monsters.values()].filter(m => m.pyr);
    if (!this.pyrFighters().length) {           // iedereen weg of dood: de piramide sluit zich weer
      p.empty += 0.5;
      if (p.empty >= PYRAMID.giveUp) {
        for (const m of mine) this.monsters.delete(m.id);
        bump('pyramid.giveup'); this.pyrSet('idle');
        this.bc({ t: 'toast', msg: '⚱️ De mummies kruipen terug in de piramide.', color: '#bbb' });
      }
      return;
    }
    p.empty = 0;
    if (p.st === 'guards' && !mine.length) {
      const n = this.pyrFighters().length, e = this.world.desert.pyramid.entrance;
      const f = this.pyrSpawn(PHARAOH, 1 + 0.6 * (n - 1), 1 + 0.08 * (n - 1), { x: e.x, z: e.z });
      this.pyrSet('boss');
      this.bc({ t: 'ev', k: 'pharaoh', id: f.id, x: r1(f.x), z: r1(f.z) });
      this.bc({ t: 'toast', msg: '👑 De mummie-farao is ontwaakt!', color: '#ffd27a' });
    }
  }

  pharaohAbilities(m, targets) {
    const near = targets.filter(p => !p.isDog && len(p.x - m.x, p.z - m.z) < 30);
    if (!near.length) return;
    if (!m.enraged && m.hp < m.maxhp * 0.35) {   // laatste stuk: sneller en vaker zand
      m.enraged = true; m.speed *= 1.35;
      this.bc({ t: 'ev', k: 'enrage', id: m.id });
    }
    if (this.T >= m.abSand) {                     // zandstralen schieten onder spelers uit de grond
      m.abSand = this.T + (m.enraged ? 5 : 7.5) + Math.random() * 2;
      const pts = near.slice(0, 6).map(p => [r1(p.x), r1(p.z)]);
      for (const [x, z] of pts) this.hazards.push({ x, z, r: 2.8, at: this.T + 1.2, dmg: 20, sand: true });
      this.bc({ t: 'ev', k: 'sandblast', id: m.id, pts, delay: 1.2 });
    }
    if (this.T >= m.abSummon) {                   // roept mummies op
      m.abSummon = this.T + 16 + Math.random() * 5;
      const have = [...this.monsters.values()].filter(x => x.pyr && x.type === MUMMY).length, pts = [];
      for (let i = 0; i < 2 && have + i < 6; i++) {
        const a = Math.random() * 6.28, x = m.x + Math.cos(a) * 3.5, z = m.z + Math.sin(a) * 3.5;
        if (this.world.heightAt(x, z) < WATER + 0.9 || !inDesert(x, z)) continue;
        this.pyrSpawn(MUMMY, 0.8, 1, { x, z }); pts.push([r1(x), r1(z)]);
      }
      if (pts.length) this.bc({ t: 'ev', k: 'summon', id: m.id, pts });
    }
  }

  /** De farao is verslagen: iedereen die meevocht krijgt een deel van de schat. */
  pharaohDown(m) {
    for (const x of [...this.monsters.values()]) if (x.pyr) { this.monsters.delete(x.id); this.bc({ t: 'ev', k: 'mdie', id: x.id, x: r1(x.x), z: r1(x.z), type: x.type }); }   // de rest valt tot stof
    bump('pyramid.win');
    const gold = STATUES.find(x => x.k === 'goud'), mask = STATUES.find(x => x.k === 'masker');
    for (const P of this.players.values()) {
      if (P.dead || len(P.x - m.x, P.z - m.z) > 45) continue;
      const s = P.u.save, [lo, hi] = PYRAMID.reward, g = lo + Math.floor(Math.random() * (hi - lo + 1));
      s.gold += g; s.stats.goldEarned += g; s.stats.pharaohs++;
      s.statues.goud = (s.statues.goud | 0) + 1; s.stats.statues++;
      const gotMask = Math.random() < PYRAMID.maskChance;
      if (gotMask) { s.statues.masker = (s.statues.masker | 0) + 1; s.stats.statues++; s.stats.masks++; bump('statue.masker'); }
      this.addXp(P, 400);
      this.toast(P, '👑 De farao is verslagen! +' + g + ' goud, een ' + gold.name.toLowerCase() + (gotMask ? ' én het ' + mask.name.toLowerCase() : '') + '.', '#ffd27a');
      this.giveSword(P, rollSwordAtLeast(3, 2.0), 'pharaoh');
      this.checkAch(P); this.sendInv(P);
    }
    this.pyrSet('cool', this.T + PYRAMID.cooldown);
    this.markDirty();
  }
}
