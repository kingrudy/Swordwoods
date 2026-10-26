// Panelen die het spel even stilzetten: de winkel van Bram, de smid, het pauzemenu (uitleg, talenten, opdrachten,
// geven, geluid) en de graphics-instelling, plus het automatisch lager zetten van de graphics als het te traag loopt.
import { RARITIES, SHOP, MAX_POTIONS } from './items.js';
import { levelInfo, FORGE_MAX, forgeCost, forgeGain, meltValue, talentPoints, spentPoints } from './progress.js';
import { renderTalents, renderQuests } from './progressui.js';
import { QUALITY } from './graphics.js';
import { $, esc } from './util.js';

export const GFX_KEY = 'sw-gfx';

export function createPanels(g) {
  const { net, inv, player, virt, G, AU } = g;

  /** Een paneel gaat open of dicht: speler stilzetten en de muis vrijgeven, of weer terug het spel in. */
  function panel(on) {
    if (on) {
      g.shopOpen = true; player.vx = player.vz = 0; virt.x = virt.y = 0; virt.attack = false; virt.jump = false;
      g.ctl.showVeil(false); if (document.pointerLockElement) document.exitPointerLock();
    } else { g.shopOpen = false; if (!g.isTouch && !g.soft) g.ctl.requestLock(); }
  }

  /* ---------------------------------------------------------------- winkel */
  let smithOpen = false;
  function renderShop() {
    $('shop-wood').textContent = '🪵 ' + inv.wood + ' hout' + (inv.gold ? ' · 🪙 ' + inv.gold + ' goud' : '');
    let html = '', group = '';
    for (const it of SHOP) {
      if (it.group !== group) { group = it.group; html += (html ? '</div>' : '') + '<div class="shop-group">' + group + '</div><div class="shop-items">'; }
      let state = 'ok', label = 'Koop · ' + it.cost + (it.gold ? ' goud' : ' hout');
      if (it.kind === 'shield' || it.kind === 'axe') {
        const cur = inv.up[it.kind];
        if (it.level <= cur) { state = 'owned'; label = 'Gekocht'; } else if (it.level > cur + 1) { state = 'locked'; label = 'Koop eerst niveau ' + (it.level - 1); }
      } else if (it.kind === 'potion' && inv.potions >= MAX_POTIONS) { state = 'owned'; label = 'Vol (' + MAX_POTIONS + ')'; }
      const dis = state !== 'ok' || (it.gold ? (inv.gold | 0) : inv.wood) < it.cost;
      const col = it.kind === 'sword' ? RARITIES[it.rarity].color : '';
      html += '<div class="item' + (state === 'owned' ? ' owned' : '') + '"><b>' + (col ? '<span class="rar" style="color:' + col + '"></span>' : '') + esc(it.name) + '</b><small>' + esc(it.desc) + '</small>' +
        '<button class="buy" type="button" data-buy="' + it.id + '"' + (dis ? ' disabled' : '') + '>' + label + '</button></div>';
    }
    $('shop-list').innerHTML = html + '</div>';
  }
  function openShop() {
    if (g.shopOpen || g.dead) return;
    panel(true); renderShop(); $('shop').classList.add('on');
  }
  /** Sluit wat er open is (winkel, smid, handelaar, gemeenschapskist of bazaar). */
  function closeShop(relock = true) {
    if (!g.shopOpen) return;
    if (g.wfx && g.wfx.traderOpen) { g.wfx.closeTrader(); return; }
    if (g.soc && g.soc.potOpen) { g.soc.closePot(); return; }
    if (g.des && g.des.bazOpen) { g.des.closeBazaar(); return; }
    g.shopOpen = false; smithOpen = false; $('shop').classList.remove('on'); $('smith').classList.remove('on');
    if (relock && !g.isTouch && !g.soft) g.ctl.requestLock();
  }
  $('shop-close').onclick = () => closeShop(true);
  $('shop-list').addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b && !b.disabled) net.send({ t: 'buy', id: b.dataset.buy }); });

  /* ---------------------------------------------------------------- smid */
  function renderSmith() {
    $('smith-res').textContent = '⛏️ ' + inv.ore + ' erts · 🪵 ' + inv.wood + ' hout';
    $('smith-list').innerHTML = inv.swords.length ? inv.swords.map((w, i) => {
      const f = w.f | 0, c = forgeCost(f), max = f >= FORGE_MAX, can = !max && inv.ore >= c.ore && inv.wood >= c.wood;
      return '<div class="sw-row"><div><b style="color:' + RARITIES[w.rarity].color + '">' + esc(w.name) + (f ? ' +' + f : '') + '</b><small>' + RARITIES[w.rarity].name + ' · schade ' + w.damage +
        (max ? ' · volledig gesmeed' : ' → ' + (w.damage + forgeGain(w))) + (inv.equip === i + 1 ? ' · in je hand' : '') + '</small></div>' +
        '<button class="buy" type="button" data-forge="' + i + '"' + (can ? '' : ' disabled') + '>' + (max ? '+' + FORGE_MAX : 'Smeed +' + (f + 1) + ' · ' + c.ore + ' erts, ' + c.wood + ' hout') + '</button>' +
        '<button class="buy melt" type="button" data-melt="' + i + '">Omsmelten · +' + meltValue(w) + ' erts</button></div>';
    }).join('') : '<p class="empty">Je hebt nog geen zwaarden. Zoek kisten in het bos of koop er een bij Bram.</p>';
    $('smith-list').insertAdjacentHTML('beforeend', '<p class="q-note">Erts hak je uit ertsaders: rotsen met glinsterende kristallen. Een zware slag geeft meer kans.</p>');
  }
  function openSmith() {
    if (g.shopOpen || g.dead) return;
    panel(true); smithOpen = true; renderSmith(); $('smith').classList.add('on');
  }
  $('smith-close').onclick = () => closeShop(true);
  $('smith-list').addEventListener('click', e => {
    const f = e.target.closest('[data-forge]'), m = e.target.closest('[data-melt]');
    if (f && !f.disabled) net.send({ t: 'forge', i: +f.dataset.forge });
    if (m) { const i = +m.dataset.melt; if (m.dataset.sure) net.send({ t: 'melt', i }); else { m.dataset.sure = '1'; m.textContent = 'Zeker? Tik nog eens'; } }
  });

  /* ---------------------------------------------------------------- pauzemenu */
  const veil = $('veil');
  let ptab = g.isTouch ? 'tal' : 'keys';
  function renderPauseTabs() {
    for (const b of document.querySelectorAll('#ptabs [data-pt]')) b.classList.toggle('on', b.dataset.pt === ptab);
    for (const t of ['keys', 'tal', 'quest', 'give']) $('pt-' + t).classList.toggle('on', t === ptab);
    if (ptab === 'give' && g.soc) g.soc.renderGive($('pt-give'));
    const free = talentPoints(levelInfo(inv.xp).level) - spentPoints(inv.tal);
    $('pt-free').textContent = free > 0 ? '(' + free + ')' : '';
    if (ptab === 'tal') renderTalents($('pt-tal'), inv, m => net.send(m));
    if (ptab === 'quest') renderQuests($('pt-quest'), inv);
  }
  for (const k of ['music', 'sfx']) {      // volumeregelaars
    const el = $('vol-' + k); el.value = Math.round(AU.vol[k] * 100);
    el.oninput = () => AU.setVolume(k, el.value / 100);
  }
  $('ptabs').addEventListener('click', e => { const b = e.target.closest('[data-pt]'); if (b) { ptab = b.dataset.pt; renderPauseTabs(); } });
  new MutationObserver(() => { if (veil.classList.contains('on')) renderPauseTabs(); }).observe(veil, { attributes: true, attributeFilter: ['class'] });

  /* ---------------------------------------------------------------- graphics */
  let gfxChosen = null; try { gfxChosen = localStorage.getItem(GFX_KEY); } catch {}
  function renderQuality() {
    $('gfx-row').innerHTML = Object.entries(QUALITY).map(([k, v]) => '<button type="button" class="btn small' + (G.quality === k ? ' primary' : '') + '" data-q="' + k + '">' + v.label + '</button>').join('');
  }
  $('gfx-row').addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    G.applyQuality(b.dataset.q); gfxChosen = b.dataset.q; try { localStorage.setItem(GFX_KEY, gfxChosen); } catch {}
    renderQuality();
  });
  renderQuality();
  const fps = { t: 0, n: 0, slow: 0 };
  function fpsCheck(dt) {        // te traag? dan zelf één stap lager (alleen als de speler niets heeft gekozen)
    if (gfxChosen || !g.locked || document.hidden) return;
    fps.t += dt; fps.n++;
    if (fps.t < 4) return;
    const f = fps.n / fps.t; fps.t = 0; fps.n = 0;
    fps.slow = f < 28 ? fps.slow + 1 : 0;
    if (fps.slow >= 2 && G.quality !== 'laag') {
      const next = G.quality === 'hoog' ? 'middel' : 'laag';
      G.applyQuality(next); renderQuality(); fps.slow = 0;
      g.ui.toast('Graphics op ' + QUALITY[next].label + ' gezet voor soepeler spelen. Aanpassen kan in het menu.', '#bbb');
    }
  }

  /* ---------------------------------------------------------------- opnieuw tekenen als de inventaris verandert */
  net.on('inv', () => {
    if (g.shopOpen && !smithOpen && !(g.wfx && g.wfx.traderOpen)) renderShop();
    if (smithOpen) renderSmith();
    if (g.wfx && g.wfx.traderOpen) g.wfx.renderTrader();
    if (g.des && g.des.bazOpen) g.des.renderBazaar();
    if (veil.classList.contains('on')) renderPauseTabs();
  });
  net.on('ev', m => { if (m.k === 'forged' && smithOpen) renderSmith(); });

  return { panel, openShop, closeShop, openSmith, fpsCheck };
}
