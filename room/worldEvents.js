// Buffs, ruïnes met bewakers, weer met bliksem en de reizende handelaar.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { WATER } from '../public/world.js';
import { MAX_POTIONS, TRADER_ITEMS, WEATHERS, rollSwordAtLeast } from '../public/items.js';
import { bump } from '../stats.js';
import { r1, len } from './shared.js';

export class WorldEvents {
  buff(P, k) { return P.buffs && P.buffs[k] > this.T; }

  buffInfo(P) { if (!P.buffs) return 0; const o = {}; let any = false; for (const k in P.buffs) if (P.buffs[k] > this.T) { o[k] = Math.ceil(P.buffs[k] - this.T); any = true; } return any ? o : 0; }

  ruin(P, i) {
    const R = this.world.ruins[i], st = this.ruinSt[i]; if (!R || P.dead) return;
    if (len(R.chest.x - P.x, R.chest.z - P.z) > 4.5) return;
    if (st.st === 'idle') {
      st.st = 'awake'; st.guards.clear();
      const n = Math.max(1, this.wave.n), sc = { hp: 1 + 0.25 * (n - 1), dmg: 1 + 0.1 * (n - 1) };
      const types = [0, 0, 4, n >= 4 ? 6 : 0, n >= 6 ? 2 : 0];
      types.forEach((t, k) => {
        const p = R.parts[k % R.parts.length], x = (p.x + R.x) / 2, z = (p.z + R.z) / 2;
        const m = this.spawnMonster(t, x, z, sc.hp * 1.2, sc.dmg, 1); m.guard = i; m.wave = false; m.retarget = 0; st.guards.add(m.id);
      });
      this.bc({ t: 'ev', k: 'ruin', i, st: 'awake', by: P.id });
      this.toast(P, 'De bewakers van de ruïne ontwaken! Versla ze om de kist te openen.', '#c58cff');
    } else if (st.st === 'awake') this.toast(P, 'Versla eerst de bewakers (' + st.guards.size + ' over).', '#c58cff');
    else if (st.st === 'ready') {
      st.st = 'cool'; st.until = this.T + 1200;
      const s = P.u.save, ore = 4 + Math.floor(Math.random() * 5), wood = 15 + Math.floor(Math.random() * 16);
      const sw = rollSwordAtLeast(2, 1.4);
      s.ore += ore; s.wood += wood; s.stats.dungeons++; bump('dungeon');
      this.giveSword(P, sw, 'chest');
      P.conn.send({ t: 'loot', kind: 'dungeon', ore, wood });
      this.addXp(P, 60); this.sendInv(P); this.markDirty();
      this.bc({ t: 'ev', k: 'ruin', i, st: 'cool', by: P.id });
    }
  }

  guardGone(m) {
    const st = this.ruinSt[m.guard]; if (!st) return;
    st.guards.delete(m.id);
    if (st.st === 'awake' && !st.guards.size) { st.st = 'ready'; this.bc({ t: 'ev', k: 'ruin', i: m.guard, st: 'ready' }); }
  }

  traderInfo() { const t = this.trader; return t ? { x: r1(t.x), z: r1(t.z), left: Math.ceil(t.until - this.T), stock: t.stock } : null; }

  traderBuy(P, id) {
    const t = this.trader, s = P.u.save, it = TRADER_ITEMS.find(x => x.id === id);
    if (!t || !it || !t.stock.includes(id) || P.dead || len(t.x - P.x, t.z - P.z) > 7) return;
    if (s.wood < it.cost) return this.toast(P, 'Te weinig hout.', '#ff9c8a');
    if (id === 'snack' && !P.dog) return this.toast(P, 'Je hebt geen hond bij je.', '#bbb');
    if (id === 'potions' && s.potions >= MAX_POTIONS) return this.toast(P, 'Je kunt niet meer drankjes dragen.', '#bbb');
    s.wood -= it.cost; s.stats.spent = (s.stats.spent | 0) + it.cost; bump('trader.' + id);
    P.buffs = P.buffs || {};
    switch (id) {
      case 'mystery': { const sw = rollSwordAtLeast(2, 1.8); this.giveSword(P, sw, 'chest'); break; }
      case 'elixir': P.buffs.elixir = Math.max(P.buffs.elixir || 0, this.T) + 300; break;
      case 'haste': P.buffs.haste = Math.max(P.buffs.haste || 0, this.T) + 180; break;
      case 'ore': s.ore += 10; break;
      case 'snack': this.dogXp(P.dog, 150); break;
      case 'potions': s.potions = Math.min(MAX_POTIONS, s.potions + 3); break;
    }
    this.toast(P, it.icon + ' ' + it.name + ' gekocht.', '#c58cff');
    this.sendInv(P); this.markDirty();
  }

  updateWorldEvents(dt) {
    // ruïnes die weer dichtgaan
    if (this.tickN % 20 === 0) this.ruinSt.forEach((st, i) => {
      if (st.st === 'cool' && this.T >= st.until) { st.st = 'idle'; this.bc({ t: 'ev', k: 'ruin', i, st: 'idle' }); }
      if (st.st === 'awake') for (const id of [...st.guards]) if (!this.monsters.has(id)) st.guards.delete(id);
      if (st.st === 'awake' && !st.guards.size) { st.st = 'ready'; this.bc({ t: 'ev', k: 'ruin', i, st: 'ready' }); }
    });
    // weer
    const W = this.weather;
    if (this.T >= W.until) {
      const opts = WEATHERS.filter(w => w.k === 'helder' || w.k !== W.k), tot = opts.reduce((a, w) => a + w.w, 0);
      let r = Math.random() * tot, pick = opts[0]; for (const w of opts) { if (r < w.w) { pick = w; break; } r -= w.w; }
      W.k = pick.k; W.until = this.T + (pick.k === 'helder' ? 200 + Math.random() * 200 : 120 + Math.random() * 120); W.bolt = this.T + 8;
      this.bc({ t: 'weather', k: W.k });
    }
    if (W.k === 'onweer' && this.T >= W.bolt) {          // bliksem in de buurt van een speler
      W.bolt = this.T + 10 + Math.random() * 15;
      const P = this.pickAlive();
      if (P) {
        const a = Math.random() * 6.28, d = 4 + Math.random() * 18, x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
        if (this.world.heightAt(x, z) > WATER) { this.hazards.push({ x, z, r: 3, at: this.T + 1.0, dmg: 20, bolt: true }); this.bc({ t: 'ev', k: 'bolt', x: r1(x), z: r1(z), delay: 1.0 }); }
      }
    }
    // reizende handelaar
    if (this.trader && this.T >= this.trader.until) { this.trader = null; this.traderAt = this.T + 420 + Math.random() * 300; this.bc({ t: 'trader', info: null }); }
    if (!this.trader && this.T >= this.traderAt && this.players.size) {
      const pt = this.world.landPoint(Math.random, 0, 0, 35, 120, 1.0);
      if (pt && this.world.slopeAt(pt.x, pt.z) < 0.4) {
        let clear = true; this.world.gNear(pt.x, pt.z, o => { if (len(o.x - pt.x, o.z - pt.z) < 3.5) clear = false; });
        if (clear) {
          const stock = TRADER_ITEMS.map(x => x.id).sort(() => Math.random() - 0.5).slice(0, 4);
          this.trader = { x: pt.x, z: pt.z, until: this.T + 240, stock };
          this.bc({ t: 'trader', info: this.traderInfo(), arrived: true });
        }
      } else this.traderAt = this.T + 5;
    }
  }
}
