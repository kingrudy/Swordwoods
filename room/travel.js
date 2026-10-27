// Reisstenen: één bij het startpunt op het bos-eiland, één bij de haven van het Woestijneiland.
// Eén keer activeren bij de steen in de woestijn (je moet er dus eerst heen varen), daarna heen en weer reizen:
// even stilstaan bij een steen, je hond reist mee. Bewegen, geraakt worden of vallen breekt het af.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { inDesert } from '../public/world.js';
import { TRAVEL } from '../public/items.js';
import { bump } from '../stats.js';
import { r1, r2, len } from './shared.js';

export class Travel {
  /** De reissteen waar P naast staat ('forest' of 'desert'), of null. */
  stoneNear(P) {
    for (const [k, t] of Object.entries(this.world.travel)) if (len(t.x - P.x, t.z - P.z) < TRAVEL.range) return k;
    return null;
  }

  travelStart(P) {
    const k = this.stoneNear(P), s = P.u.save;
    if (!k || P.dead || P.boat || P.travel || P.digging) return;
    if (!s.travel) {
      if (k !== 'desert') return this.toast(P, 'Deze reissteen slaapt nog. Vaar naar het Woestijneiland en activeer daar de steen bij de haven.', '#bbb');
      if ((s.gold | 0) < TRAVEL.cost) return this.toast(P, 'Activeren kost ' + TRAVEL.cost + ' goud. Graaf naar faraobeelden en verkoop ze bij Farid.', '#ff9c8a');
      s.gold -= TRAVEL.cost; s.travel = 1; bump('travel.unlock');
      this.toast(P, '✨ De reisstenen herkennen je. Vanaf nu reis je met E tussen het bos en de woestijn.', '#9ad8ff');
      this.bc({ t: 'ev', k: 'tpwake', x: r1(this.world.travel.desert.x), z: r1(this.world.travel.desert.z) });
      this.sendInv(P); this.markDirty();
      return;
    }
    if (this.T < (P.travelCd || 0)) return this.toast(P, 'De steen moet nog even opladen (' + Math.ceil(P.travelCd - this.T) + ' s).', '#bbb');
    P.travel = { from: k, to: k === 'desert' ? 'forest' : 'desert', until: this.T + TRAVEL.sec, hurt: P.lastHurt };
    this.endFishing(P);
    this.bc({ t: 'ev', k: 'tpstart', id: P.id, from: k, sec: TRAVEL.sec });
  }

  /** Per tik voor een speler die aan het reizen is. */
  updateTravel(P) {
    const t = P.travel; if (!t) return;
    const st = this.world.travel[t.from];
    if (P.dead || P.lastHurt !== t.hurt || len(st.x - P.x, st.z - P.z) > TRAVEL.range + 0.6) {
      P.travel = null; this.bc({ t: 'ev', k: 'tpfail', id: P.id });
      return;
    }
    if (this.T < t.until) return;
    P.travel = null; P.travelCd = this.T + TRAVEL.cooldown;
    const to = this.world.travel[t.to], a = Math.random() * Math.PI * 2;
    const from = { x: P.x, z: P.z };
    P.x = to.x + Math.cos(a) * 1.8; P.z = to.z + Math.sin(a) * 1.8; P.y = this.world.heightAt(P.x, P.z);
    P.lastInT = this.T; P.posLock = this.T + 0.4; P.wasDesert = inDesert(P.x, P.z);   // geen 'welkom op het eiland' en geen extra reis in de statistiek
    if (P.dog && P.dog.state !== 'wild') { P.dog.x = P.x + 1.2; P.dog.z = P.z; }
    P.u.save.stats.travels = (P.u.save.stats.travels | 0) + 1; bump('travel');
    P.conn.send({ t: 'correct', x: r2(P.x), y: r2(P.y), z: r2(P.z) });
    this.bc({ t: 'ev', k: 'tp', id: P.id, fx: r1(from.x), fz: r1(from.z), x: r1(P.x), z: r1(P.z) });
    this.markDirty();
  }
}
