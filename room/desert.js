// Boot (in- en uitstappen), graven in zandbergen, faraobeelden en de bazaar van Farid.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER } from '../public/world.js';
import { MAX_POTIONS, STATUES, DIG_SEC, DIG_SEC_SHOVEL, MOUND_BACK, BAZAAR } from '../public/items.js';
import { bump } from '../stats.js';
import { r2, len } from './shared.js';

export class Desert {
  leaveBoat(P) {
    const b = P.boat; if (!b) return;
    P.boat = null; b.rider = null;
    this.bc({ t: 'ev', k: 'unboard', id: b.id, pid: P.id, x: r2(b.x), z: r2(b.z), rot: r2(b.rot) });
    this.saveBuilds();
  }

  board(P, id) {
    const b = this.builds.get(id);
    if (!b || b.kind !== 'boat' || P.dead || P.boat || b.rider) return;
    if (len(b.x - P.x, b.z - P.z) > 5) return;
    P.boat = b; b.rider = P.id; P.digging = null; P.blocking = false; this.endFishing(P);
    P.x = b.x; P.z = b.z; P.lastInT = this.T; P.wasDesert = null;
    this.bc({ t: 'ev', k: 'board', id: b.id, pid: P.id, x: r2(b.x), z: r2(b.z), rot: r2(b.rot) });
  }

  unboard(P) {
    const b = P.boat; if (!b) return;
    const w = this.world; let spot = null;
    for (let r = 1.5; r <= 6 && !spot; r += 0.75) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      if (w.heightAt(x, z) > WATER + 0.4 && w.slopeAt(x, z) < 1.2) { spot = { x, z }; break; }
    }
    if (!spot) return this.toast(P, 'Vaar dichter naar de kust om aan land te gaan.', '#bbb');
    this.leaveBoat(P);
    P.x = spot.x; P.z = spot.z; P.y = w.heightAt(spot.x, spot.z); P.lastInT = this.T;
    P.conn.send({ t: 'correct', x: r2(P.x), y: r2(P.y), z: r2(P.z) });
  }

  dig(P, i) {
    const m = this.world.desert.mounds[i];
    if (!m || P.dead || P.boat || P.digging) return;
    if (len(m.x - P.x, m.z - P.z) > 3.4) return;
    if (this.moundBack.has(i)) return this.toast(P, 'Hier is al gegraven. Het zand waait er over een paar minuten weer overheen.', '#bbb');
    const dur = P.u.save.up.shovel ? DIG_SEC_SHOVEL : DIG_SEC;
    P.digging = { i, until: this.T + dur };
    this.bc({ t: 'ev', k: 'digstart', id: P.id, i, dur });
  }

  finishDig(P) {
    const { i } = P.digging, m = this.world.desert.mounds[i]; P.digging = null;
    if (!m || P.dead || len(m.x - P.x, m.z - P.z) > 3.8 || this.moundBack.has(i)) { P.conn.send({ t: 'ev', k: 'digfail' }); return; }
    this.moundBack.set(i, this.T + MOUND_BACK);
    const s = P.u.save, shovel = s.up.shovel ? 1 : 0, r = Math.random();
    s.stats.digs++; bump('digs'); this.addXp(P, 6); this.quest(P, 'dig');
    let find = { kind: 'sand' };
    if (r < 0.32 + shovel * 0.08) {            // faraobeeld
      const ws = STATUES.map((x, k) => x.w * (1 + shovel * k * 0.35)), tot = ws.reduce((a, b) => a + b, 0);
      let t = Math.random() * tot, k = 0; for (; k < ws.length - 1; k++) { if (t < ws[k]) break; t -= ws[k]; }
      const S = STATUES[k];
      s.statues[S.k] = (s.statues[S.k] | 0) + 1; s.stats.statues++; if (S.k === 'masker') s.stats.masks++;
      bump('statue.' + S.k); this.addXp(P, 10 + k * 15);
      find = { kind: 'statue', k: S.k };
      if (k >= 2) this.bc({ t: 'toast', msg: P.name + ' vond een ' + S.name.toLowerCase() + '!', color: '#f2c14e' }, P);
    } else if (r < 0.72) { const n = 2 + Math.floor(Math.random() * 5); s.gold += n; s.stats.goldEarned += n; find = { kind: 'gold', n }; }
    else if (r < 0.8) { s.meat += 1; find = { kind: 'scarab' }; }
    this.bc({ t: 'ev', k: 'dug', i, by: P.id, find });
    this.sendInv(P); this.markDirty();
  }

  nearBazaar(P) { const b = this.world.desert.bazaar; return !P.dead && len(b.x - P.x, b.z - P.z) < 6.5; }

  sellStatues(P, k) {
    if (!this.nearBazaar(P)) return;
    const s = P.u.save; let gold = 0, n = 0;
    for (const S of STATUES) if (k === 'all' || k === S.k) { const c = s.statues[S.k] | 0; gold += c * S.value; n += c; s.statues[S.k] = 0; }
    if (!n) return this.toast(P, 'Je hebt geen beelden om te verkopen.', '#bbb');
    s.gold += gold; s.stats.goldEarned += gold; bump('goldSold', gold);
    P.conn.send({ t: 'ev', k: 'sold', n, gold });
    this.toast(P, '💰 Farid koopt ' + n + (n === 1 ? ' beeld' : ' beelden') + ' voor ' + gold + ' goud!', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }

  bazaarBuy(P, id) {
    const it = BAZAAR.find(x => x.id === id), s = P.u.save;
    if (!it || !this.nearBazaar(P)) return;
    if ((s[it.cur] | 0) < it.cost) return this.toast(P, 'Te weinig ' + (it.cur === 'gold' ? 'goud' : 'hout') + '.', '#ff9c8a');
    if (id === 'shovel' && s.up.shovel) return this.toast(P, 'Je hebt al een schep.', '#bbb');
    if (id === 'water' && s.potions >= MAX_POTIONS) return this.toast(P, 'Je kunt niet meer drankjes dragen.', '#bbb');
    s[it.cur] -= it.cost; bump('bazaar.' + id);
    if (id === 'shovel') s.up.shovel = 1;
    else if (id === 'dates') s.meat += 4;
    else if (id === 'wood') s.wood += 60;
    else if (id === 'water') s.potions = Math.min(MAX_POTIONS, s.potions + 2);
    this.toast(P, it.icon + ' ' + it.name + ' gekocht.', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }
}
