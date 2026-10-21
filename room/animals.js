// Wilde dieren in het bos en in de woestijn: rondlopen, vluchten, terugvechten, vlees.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { HALF } from '../public/world.js';
import { ANIMALS } from '../public/items.js';
import { XP } from '../public/progress.js';
import { r1, len, CFG } from './shared.js';

export class Animals {
  killAnimal(a, P) {
    this.animals.delete(a.id);
    const A = ANIMALS[a.type], s = P.u.save;
    s.meat += A.meat; s.stats.animals++; this.addXp(P, XP.animal); this.quest(P, 'animal');
    this.bc({ t: 'ev', k: 'adie', id: a.id, x: r1(a.x), z: r1(a.z), type: a.type });
    this.toast(P, '+' + A.meat + ' vlees (' + A.name + ')', '#e58b7b');
    this.sendInv(P); this.markDirty();
  }

  spawnAnimal(nearSpawn = false, desert = false) {
    const players = [...this.players.values()];
    for (let tries = 0; tries < 8; tries++) {
      const pt = desert ? this.world.desert.point(Math.random, 8, this.world.desert.r * 0.8, 1.0) : nearSpawn ? this.world.landPoint(Math.random, 0, 0, 18, 70, 0.6) : this.world.landPoint(Math.random, 0, 0, 10, HALF * 0.85, 0.6);
      if (!pt) continue;
      if (players.some(p => len(p.x - pt.x, p.z - pt.z) < 25)) continue;
      const roll = Math.random(), type = desert ? (roll < 0.62 ? 3 : 4) : roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2;
      const A = ANIMALS[type];
      const a = { id: this.eid++, type, x: pt.x, z: pt.z, yaw: Math.random() * 6.28, hp: A.hp, maxhp: A.hp, stun: 0, wt: Math.random() * 4, dir: null, angry: false, nextAtk: 0, hurtT: -99 };
      this.animals.set(a.id, a);
      return a;
    }
    return null;
  }

  updateAnimals(dt) {
    const alive = [...this.players.values()].filter(p => !p.dead);
    for (const a of this.animals.values()) {
      if (a.stun > 0) { a.stun -= dt; continue; }
      const A = ANIMALS[a.type];
      const near = this.nearest(alive, a.x, a.z, A.flee || 25);
      let fought = false;
      if (A.fights) {                           // everzwijn en kangoeroe: vallen aan als je ze verwondt
        if (a.angry && this.T - a.hurtT > 12) a.angry = false;
        const tg = a.angry ? this.nearest(alive, a.x, a.z, 30) : null;
        if (tg) {
          const dx = tg.x - a.x, dz = tg.z - a.z, d = len(dx, dz);
          a.yaw = Math.atan2(-dx, -dz);
          if (d > 1.5) { const s = Math.min(d - 1.2, (A.speed * 0.8 + 1.5) * dt); this.move(a, a.x + dx / d * s, a.z + dz / d * s, A.r); }
          else if (this.T >= a.nextAtk) { a.nextAtk = this.T + 1.4; this.hurt(tg, A.dmg, a); if (a.type === 4) this.bc({ t: 'ev', k: 'kick', id: a.id }); }
          fought = true;
        }
      }
      if (fought) continue;
      if (near && A.flee) {                     // vluchten
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
    if (this.animalTimer <= 0) {
      this.animalTimer = 6;
      let des = 0; for (const a of this.animals.values()) if (ANIMALS[a.type].desert) des++;
      if (this.animals.size - des < CFG.animalTarget) this.spawnAnimal();
      if (des < CFG.desertAnimals) this.spawnAnimal(false, true);
    }
  }
}
