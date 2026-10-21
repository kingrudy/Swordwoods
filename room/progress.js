// Ervaring, niveaus, talenten (effect op levens en hond), dagelijkse opdrachten en prestaties.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { dogStats, breedOf } from '../public/items.js';
import { levelInfo, tal, maxHp, ACHIEVEMENTS } from '../public/progress.js';
import { bump } from '../stats.js';
import { ensureDaily } from './save.js';

export class Progress {
  applyStats(P) {
    const old = P.mhp || 100; P.mhp = maxHp(P.u.save); if (P.mhp > old && !P.dead) P.hp += P.mhp - old; P.hp = Math.min(P.hp, P.mhp);
    if (P.dog) { const st = this.dogStatsFor(P, P.dog.level); P.dog.dmg = st.dmg; const f = P.dog.hp / P.dog.maxhp; P.dog.maxhp = st.maxhp; P.dog.hp = Math.round(st.maxhp * f); }
  }

  dogStatsFor(P, level) {
    const st = dogStats(level), k = 1 + 0.1 * (P ? tal(P.u.save, 'baasje') : 0), B = breedOf(P && P.u.save.dog ? P.u.save.dog.breed : 'herder');
    return { ...st, maxhp: Math.round(st.maxhp * k * B.hp), dmg: st.dmg * k * B.dmg, speed: st.speed * B.spd };
  }

  addXp(P, n) {
    const s = P.u.save, before = levelInfo(s.xp).level;
    s.xp += Math.round(n);
    const after = levelInfo(s.xp).level;
    if (after > before) {
      this.toast(P, '⭐ Niveau ' + after + '! Je hebt een talentpunt te besteden (pauzemenu of lobby).', '#f2c14e');
      this.bc({ t: 'ev', k: 'plvl', id: P.id, lvl: after });
    }
  }

  quest(P, kind, n = 1, best = false) {
    const d = ensureDaily(P.u), s = P.u.save;
    for (const q of d.q) {
      if (q.kind !== kind || q.done) continue;
      q.have = best ? Math.max(q.have, n) : q.have + n;
      if (q.have >= q.need) {
        q.have = q.need; q.done = true; s.wood += q.wood; s.stats.quests++; bump('quest.' + q.kind);
        this.addXp(P, q.xp);
        P.conn.send({ t: 'ev', k: 'quest', q });
        this.toast(P, '📅 Opdracht voltooid! +' + q.wood + ' hout en +' + q.xp + ' ervaring', '#6fd37a');
      }
    }
  }

  checkAch(P) {
    const s = P.u.save;
    for (const A of ACHIEVEMENTS) if (!s.ach[A.id] && A.test(s)) {
      s.ach[A.id] = Date.now(); this.markDirty();
      P.conn.send({ t: 'ev', k: 'ach', id: A.id });
      this.bc({ t: 'toast', msg: P.name + ' behaalde de prestatie "' + A.name + '"', color: '#f2c14e' }, P);
    }
  }
}
