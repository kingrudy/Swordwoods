// Koken bij een kampvuur: ingrediënten erin, maaltijd meteen op, en een tijdelijk voordeel (buff).
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { RECIPES, COOK_RANGE, COOK_HUNGER, NEED_NAMES } from '../public/items.js';
import { bump } from '../stats.js';
import { r1, len } from './shared.js';

export class Cooking {
  /** Het kampvuur waar je naast staat (of null). */
  fireNear(P) { for (const b of this.builds.values()) if (b.kind === 'campfire' && len(b.x - P.x, b.z - P.z) < COOK_RANGE) return b; return null; }

  cook(P, id) {
    const R = RECIPES.find(r => r.id === id), s = P.u.save;
    if (!R || P.dead) return;
    const fire = this.fireNear(P);
    if (!fire) return this.toast(P, 'Koken kan alleen naast een kampvuur.', '#bbb');
    const short = Object.entries(R.need).filter(([k, n]) => (s[k] | 0) < n);
    if (short.length) return this.toast(P, 'Te weinig ' + short.map(([k]) => NEED_NAMES[k]).join(' en ') + ' voor ' + R.name.toLowerCase() + '.', '#ff9c8a');
    for (const [k, n] of Object.entries(R.need)) s[k] -= n;
    P.hunger = Math.min(100, P.hunger + COOK_HUNGER);
    P.buffs = P.buffs || {}; P.buffs[R.buff] = Math.max(P.buffs[R.buff] || 0, this.T) + R.sec;
    s.stats.meals = (s.stats.meals | 0) + 1; bump('cook.' + R.id); this.addXp(P, 12); this.quest(P, 'cook');
    this.bc({ t: 'ev', k: 'cooked', by: P.id, id: R.id, x: r1(fire.x), z: r1(fire.z) });
    this.toast(P, R.icon + ' ' + R.name + ': ' + R.desc + '.', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }
}
