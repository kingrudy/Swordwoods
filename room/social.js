// Spullen geven en de gemeenschapskist met feestmaal.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { MAX_SWORDS, MAX_POTIONS, potGoal, FEAST_SEC } from '../public/items.js';
import { bump } from '../stats.js';
import { len } from './shared.js';

export class Social {
  give(P, to, what, n, i) {
    const Q = this.players.get(to), s = P.u.save;
    if (!Q || Q === P || P.dead || Q.dead || len(Q.x - P.x, Q.z - P.z) > 8) return this.toast(P, 'Ga dichter bij die speler staan (binnen 8 meter).', '#bbb');
    const t = Q.u.save; let label = '';
    if (what === 'sword') {
      const sw = s.swords[i]; if (!sw) return;
      if (t.swords.length >= MAX_SWORDS) return this.toast(P, Q.name + ' heeft geen plek meer voor een zwaard.', '#ff9c8a');
      s.swords.splice(i, 1); if (s.equip === i + 1) s.equip = 0; else if (s.equip > i + 1) s.equip--;
      t.swords.push(sw); label = sw.name + (sw.f ? ' +' + sw.f : '');
    } else if (['wood', 'meat', 'fish', 'ore', 'potions'].includes(what)) {
      n = Math.max(1, Math.min(n, s[what] | 0)); if (!(s[what] > 0)) return;
      if (what === 'potions') n = Math.min(n, MAX_POTIONS - t.potions); if (n <= 0) return this.toast(P, Q.name + ' kan niet meer drankjes dragen.', '#bbb');
      s[what] -= n; t[what] = (t[what] | 0) + n;
      label = n + ' ' + { wood: 'hout', meat: 'vlees', fish: 'vis', ore: 'erts', potions: 'drankje' + (n > 1 ? 's' : '') }[what];
    } else return;
    s.stats.gifts++;
    this.toast(P, '🎁 Je gaf ' + label + ' aan ' + Q.name + '.', '#6fd37a'); this.toast(Q, '🎁 ' + P.name + ' gaf je ' + label + '!', '#6fd37a');
    this.bc({ t: 'ev', k: 'gift', from: P.id, to: Q.id });
    this.sendInv(P); this.sendInv(Q); this.markDirty();
  }

  potInfo() { const p = this.store.pot; return { have: p.have | 0, goal: potGoal(p.lvl | 0 || 1), lvl: p.lvl | 0 || 1 }; }

  deposit(P, n) {
    const W = this.world, s = P.u.save, p = this.store.pot;
    if (P.dead || len(W.pot.x - P.x, W.pot.z - P.z) > 4.5) return;
    const goal = potGoal(p.lvl);
    n = Math.max(0, Math.min(n, s.wood, goal - p.have)); if (!n) return;
    s.wood -= n; p.have += n; s.stats.spent = (s.stats.spent | 0) + n;
    this.addXp(P, Math.floor(n / 5));
    if (p.have >= goal) {
      p.have = 0; p.lvl++;
      for (const Q of this.players.values()) {
        const t = Q.u.save; t.stats.feasts++;
        if (!Q.dead) { Q.hunger = 100; Q.hp = Q.mhp; }
        t.potions = Math.min(MAX_POTIONS, t.potions + 2);
        Q.buffs = Q.buffs || {}; Q.buffs.feast = this.T + FEAST_SEC;
        this.sendInv(Q);
      }
      this.bc({ t: 'ev', k: 'feast', by: P.id, lvl: p.lvl - 1 }); bump('feasts');
    }
    this.bc({ t: 'pot', ...this.potInfo(), by: P.id, n });
    this.sendInv(P); this.markDirty();
  }
}
