// Vissen: uitwerpen, beet, binnenhalen.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER } from '../public/world.js';
import { XP } from '../public/progress.js';
import { r1, len } from './shared.js';

export class Fishing {
  cast(P, x, z) {
    const s = P.u.save, w = this.world;
    if (P.dead || P.fishing || !s.up.rod) return;
    if (!Number.isFinite(x) || !Number.isFinite(z) || len(x - P.x, z - P.z) > 7) return;
    if (w.heightAt(x, z) > WATER - 0.15) { this.toast(P, 'Gooi je hengel uit in het water.', '#bbb'); return; }
    const fast = (this.weather.k === 'regen' ? 0.6 : 1) * (this.world.biomeAt(x, z) === 'swamp' ? 0.7 : 1);
    P.fishing = { x, z, biteAt: this.T + (3 + Math.random() * 6) * fast * this.wk('fishFast'), bite: false, until: 0 };
    this.bc({ t: 'ev', k: 'cast', id: P.id, x: r1(x), z: r1(z) });
  }

  endFishing(P, caught = false) {
    if (!P.fishing) return;
    P.fishing = null;
    this.bc({ t: 'ev', k: 'fishend', id: P.id, caught });
  }

  updateFishing(P) {
    const f = P.fishing; if (!f) return;
    if (P.dead || len(f.x - P.x, f.z - P.z) > 9) { this.endFishing(P); return; }
    if (!f.bite && this.T >= f.biteAt) {
      f.bite = true; f.until = this.T + 2.0;
      P.conn.send({ t: 'ev', k: 'bite' });
      this.bc({ t: 'ev', k: 'bob', id: P.id }, P);
    } else if (f.bite && this.T > f.until) {
      this.toast(P, 'Te laat, de vis is ontsnapt. Probeer het opnieuw.', '#bbb');
      this.endFishing(P);
    }
  }

  reel(P) {
    const f = P.fishing; if (!f) return;
    if (!f.bite) { this.toast(P, 'Te vroeg! Wacht tot de dobber onder gaat.', '#bbb'); this.endFishing(P); return; }
    const s = P.u.save, gold = Math.random() < 0.12 * this.wk('goldFish'), n = gold ? 3 : 1;
    s.fish += n; s.stats.fish = (s.stats.fish | 0) + n; this.addXp(P, XP.fish * n); this.quest(P, 'fish', n);
    this.toast(P, gold ? 'Een goudvis! Die telt voor 3 vissen.' : 'Vis gevangen! Geef hem aan je hond met G.', gold ? '#f2c14e' : '#6fc6e8');
    P.conn.send({ t: 'ev', k: 'caught', gold });
    this.endFishing(P, true);
    this.sendInv(P); this.markDirty();
  }
}
