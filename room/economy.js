// Erts hakken, smid, eten en drinken, de winkel van Bram, kisten en zwaarden in de rugzak.
// Methodes van Room (worden in room.js op Room.prototype gezet; `this` is de kamer).
import { rollSword, rollSwordOfRarity, MAX_SWORDS, SHOP, MAX_POTIONS } from '../public/items.js';
import { XP, tal, FORGE_MAX, forgeCost, forgeGain, meltValue, swordLabel } from '../public/progress.js';
import { bump } from '../stats.js';
import { len, CFG } from './shared.js';

export class Economy {
  mine(P, o, heavy) {
    const s = P.u.save;
    this.bc({ t: 'ev', k: 'mine', i: o.idx });
    if (this.oreLeft[o.idx] <= 0) { this.toast(P, 'Deze ertsader is leeg. Hij groeit over een paar minuten terug.', '#bbb'); return; }
    const chance = 0.4 + 0.15 * tal(s, 'mijnwerker') + 0.05 * s.up.axe + (heavy ? 0.25 : 0);
    if (Math.random() >= chance) return;
    const n = o.rich && Math.random() < 0.4 ? 2 : 1;
    s.ore += n; s.stats.ore += n; this.oreLeft[o.idx]--;
    this.addXp(P, XP.ore * n); this.quest(P, 'ore', n);
    P.conn.send({ t: 'loot', kind: 'ore', n });
    if (this.oreLeft[o.idx] <= 0) { this.oreBack.set(o.idx, this.T + 300); this.bc({ t: 'ev', k: 'oreGone', i: o.idx }); }
    this.sendInv(P); this.markDirty();
  }

  nearSmith(P) { const sm = this.world.smith; return !P.dead && len(sm.x - P.x, sm.z - P.z) < 7; }

  forge(P, i) {
    const s = P.u.save, sw = s.swords[i];
    if (!sw || !this.nearSmith(P)) return;
    if ((sw.f | 0) >= FORGE_MAX) return this.toast(P, 'Dit zwaard is al +' + FORGE_MAX + '.', '#bbb');
    const c = forgeCost(sw.f | 0);
    if (s.ore < c.ore || s.wood < c.wood) return this.toast(P, 'Je hebt ' + c.ore + ' erts en ' + c.wood + ' hout nodig.', '#ff9c8a');
    s.ore -= c.ore; s.wood -= c.wood; s.stats.spent = (s.stats.spent | 0) + c.wood;
    if (!Number.isFinite(sw.d0)) sw.d0 = sw.damage;
    sw.damage += forgeGain(sw); sw.f = (sw.f | 0) + 1; bump('forge'); s.stats.forgedMax = Math.max(s.stats.forgedMax, sw.f);
    this.toast(P, '⚒️ ' + swordLabel(sw) + ' · schade ' + sw.damage, '#f2c14e');
    P.conn.send({ t: 'ev', k: 'forged', i });
    this.sendInv(P); this.markDirty();
  }

  melt(P, i) {
    const s = P.u.save, sw = s.swords[i];
    if (!sw || !this.nearSmith(P)) return;
    const n = meltValue(sw);
    s.swords.splice(i, 1); s.ore += n; bump('melt');
    if (s.equip === i + 1) s.equip = 0; else if (s.equip > i + 1) s.equip--;
    this.toast(P, swordLabel(sw) + ' omgesmolten: +' + n + ' erts', '#c8c8d0');
    this.sendInv(P); this.markDirty();
  }

  eat(P) {
    const s = P.u.save;
    if (P.dead || this.T - P.lastEat < 0.7) return;
    if (s.meat <= 0) { this.toast(P, 'Je hebt geen vlees. Jaag op dieren met je zwaard.', '#ff9c8a'); return; }
    if (P.hunger > 92) { this.toast(P, 'Je bent nog vol.', '#bbb'); return; }
    P.lastEat = this.T; s.meat--;
    P.hunger = Math.min(100, P.hunger + 30);
    P.hp = Math.min(P.mhp, P.hp + 8);
    P.conn.send({ t: 'ev', k: 'ate' });
    this.sendInv(P); this.markDirty();
  }

  drink(P) {
    const s = P.u.save;
    if (P.dead || this.T - (P.lastDrink || -9) < 1) return;
    if (s.potions <= 0) { this.toast(P, 'Je hebt geen helende drank. Koop er een in de winkel.', '#ff9c8a'); return; }
    if (P.hp >= P.mhp) { this.toast(P, 'Je gezondheid is al vol.', '#bbb'); return; }
    P.lastDrink = this.T; s.potions--; P.hp = Math.min(P.mhp, P.hp + 50);
    P.conn.send({ t: 'ev', k: 'drank' });
    this.sendInv(P); this.markDirty();
  }

  buy(P, id) {
    const s = P.u.save, it = SHOP.find(x => x.id === id), sh = this.world.shop;
    if (!it || P.dead) return;
    if (len(sh.x - P.x, sh.z - P.z) > 7.5) { this.toast(P, 'Je staat te ver van de winkel.', '#ff9c8a'); return; }
    const cur = it.gold ? 'gold' : 'wood', curName = it.gold ? 'goud' : 'hout';
    if (s[cur] < it.cost) { this.toast(P, 'Te weinig ' + curName + ': je hebt ' + s[cur] + ', dit kost ' + it.cost + '.', '#ff9c8a'); return; }
    const fail = msg => this.toast(P, msg, '#ff9c8a');
    switch (it.kind) {
      case 'meat': s.meat += it.n; break;
      case 'wood': s.wood += it.n; break;
      case 'rod':
        if (s.up.rod) return fail('Je hebt al een vishengel.');
        s.up.rod = 1; break;
      case 'potion':
        if (s.potions >= MAX_POTIONS) return fail('Je draagt al ' + MAX_POTIONS + ' drankjes.');
        s.potions++; break;
      case 'shield': case 'axe': {
        const key = it.kind, cur = s.up[key];
        if (it.level <= cur) return fail('Dat heb je al.');
        if (it.level > cur + 1) return fail('Koop eerst het vorige niveau.');
        s.up[key] = it.level; break;
      }
      case 'sword': {
        const sw = rollSwordOfRarity(it.rarity);
        if (s.swords.length >= MAX_SWORDS && sw.damage <= Math.min(...s.swords.map(x => x.damage))) return fail('Je rugzak zit vol met betere zwaarden. Niets afgerekend.');
        s[cur] -= it.cost; if (!it.gold) s.stats.spent = (s.stats.spent | 0) + it.cost; bump("buy." + it.id);
        this.giveSword(P, sw, 'shop'); this.sendInv(P); this.markDirty();
        P.conn.send({ t: 'ev', k: 'bought' });
        return;
      }
    }
    s[cur] -= it.cost; if (!it.gold) s.stats.spent = (s.stats.spent | 0) + it.cost; bump("buy." + it.id);
    P.conn.send({ t: 'ev', k: 'bought' });
    this.toast(P, it.name + ' gekocht voor ' + it.cost + ' ' + curName + '.', '#f2c14e');
    this.sendInv(P); this.markDirty();
  }

  openChest(P, idx) {
    const c = this.world.chests[idx];
    if (!c || P.dead || this.chestOpen.has(idx)) return;
    if (len(c.x - P.x, c.z - P.z) > 4.6) return;
    this.chestOpen.set(idx, this.T + CFG.chestRespawn);
    this.bc({ t: 'ev', k: 'chest', i: idx, by: P.id });
    const s = P.u.save; s.stats.chests++; this.addXp(P, XP.chest); this.quest(P, 'chest');
    const r = Math.random();
    if (r < 0.62) this.giveSword(P, rollSword(Math.min(1.3, c.luck + (c.biome === 'dark' ? 0.3 : 0))), 'chest');
    else if (r < 0.80) { const n = 4 + Math.floor(Math.random() * 6); s.wood += n; P.conn.send({ t: 'loot', kind: 'wood', n }); }
    else if (r < 0.94) { const n = 2 + Math.floor(Math.random() * 2); s.meat += n; P.conn.send({ t: 'loot', kind: 'meat', n }); }
    else P.conn.send({ t: 'loot', kind: 'empty' });
    this.sendInv(P); this.markDirty();
  }

  giveSword(P, sw, src) {
    const s = P.u.save; sw.d0 = sw.damage; sw.f = 0;
    let res = 'added', dropped = null;
    if (s.swords.length < MAX_SWORDS) s.swords.push(sw);
    else {
      let wi = 0; s.swords.forEach((x, i) => { if (x.damage < s.swords[wi].damage) wi = i; });
      if (sw.damage > s.swords[wi].damage) { dropped = s.swords[wi]; s.swords[wi] = sw; res = 'replaced'; if (s.equip - 1 === wi) s.equip = wi + 1; }
      else res = 'left';
    }
    let auto = false;
    if (res !== 'left') {
      const idx = s.swords.indexOf(sw) + 1, cur = s.equip === 0 ? 0 : (s.swords[s.equip - 1]?.damage || 0);
      if (sw.damage > cur && sw.damage >= Math.max(...s.swords.map(x => x.damage))) { s.equip = idx; auto = true; }
    }
    P.conn.send({ t: 'loot', kind: 'sword', sword: sw, res, dropped, auto, src });
  }
}
