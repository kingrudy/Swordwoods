// HUD: meldingen (toasts en banners), gezondheid en honger, inventaris en hotbar, golfstatus, spelerslijst,
// de uitleg voor nieuwe spelers en de pijl naar de winkel.
import { RARITIES, MONSTERS, AXE, WAVE_MODS, dogXpNeeded } from './items.js';
import { TUTORIAL, ACHIEVEMENTS, WEEK_EVENTS, levelInfo, talentPoints, spentPoints } from './progress.js';
import { renderQuests } from './progressui.js';
import { $, esc, clamp, fmt, fwdOf } from './util.js';

const BOSS_TIP = { 3: 'rol weg uit de rode cirkels', 9: 'zijn ijsstorm maakt je traag', 10: 'blijf uit haar gifwolken', 11: 'blok zijn slag, dan wankelt hij' };

export function createUi(g) {
  const { net, inv, you, wave, names, looks, player, W, sfx } = g;
  let lastPlayers = [];

  function toast(html, color = '#fff') {
    const el = document.createElement('div'); el.className = 'toast'; el.style.setProperty('--c', color); el.innerHTML = html;
    $('toasts').prepend(el);
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, 5200);
    while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
  }
  let bannerTimer = null;
  function banner(html, ms = 3200) {
    const b = $('banner'); b.innerHTML = html; b.classList.add('on');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
  }

  /** Voortgangsbalk met tekst voor een handeling die even duurt (opknappen, koken, ...). */
  let actTimer = null;
  function actionBar(label, sec) {
    const el = $('actbar'), fill = el.querySelector('i'); clearTimeout(actTimer);
    if (!label) { el.classList.remove('on'); return; }
    el.querySelector('span').textContent = label; el.classList.add('on');
    fill.style.transition = 'none'; fill.style.width = '0%'; void fill.offsetWidth;
    fill.style.transition = 'width ' + sec + 's linear'; fill.style.width = '100%';
    actTimer = setTimeout(() => el.classList.remove('on'), sec * 1000 + 600);
  }
  function renderDogChip() {
    const c = $('dogchip'), d = inv.dog, st = g.myDog;
    c.classList.toggle('on', !!d);
    if (!d) return;
    const down = st && st.down;
    c.innerHTML = '🐕 ' + esc(d.name) + ' · nv ' + d.level + (st ? (down ? ' · rust uit' : ' · ' + st.hp + '/' + st.max) : '') + (st && st.boost ? ' · <b style="color:#6fe0ff">⚡ ' + st.boost + ' s</b>' : '') +
      (d.level < 10 ? '<span class="xp"><i style="width:' + Math.round(100 * d.xp / dogXpNeeded(d.level)) + '%"></i></span>' : '');
  }
  function renderTut() {
    const el = $('tutcard'), step = TUTORIAL[inv.tut | 0];
    el.classList.toggle('on', !!step); document.body.classList.toggle('tut', !!step);
    if (!step) return;
    el.innerHTML = '<div class="tt">' + step.icon + ' <b>' + esc(step.text) + '</b><span class="st">Uitleg ' + ((inv.tut | 0) + 1) + '/' + TUTORIAL.length + '</span></div><p>' + esc(step.hint) + '</p><button type="button" id="tut-skip">Uitleg overslaan</button>';
    $('tut-skip').onclick = e => { e.stopPropagation(); net.send({ t: 'tutskip' }); };
  }
  const chip = (id, on, html) => { const c = $(id); c.classList.toggle('on', on); c.innerHTML = html; };
  function renderInv() {
    $('wood').textContent = '🪵 Hout: ' + inv.wood;
    $('meat').innerHTML = '🍖 Vlees: ' + inv.meat + ' <small style="opacity:.6">(R = eten)</small>';
    renderDogChip();
    $('potion').innerHTML = '🧪 Drank: ' + inv.potions + ' <small style="opacity:.6">(Q)</small>';
    chip('fishchip', !!(inv.up.rod || inv.fish), '🐟 Vis: ' + inv.fish + ' <small style="opacity:.6">(G = hond voeren)</small>');
    $('tb-fish').lastElementChild.textContent = inv.fish; $('tb-fish').classList.toggle('off', !inv.dog || !inv.fish);
    $('tb-eat').lastElementChild.textContent = inv.meat; $('tb-drink').lastElementChild.textContent = inv.potions;
    const nst = Object.values(inv.statues || {}).reduce((a, b) => a + b, 0);
    chip('goldchip', !!(inv.gold || nst), '🪙 Goud: ' + (inv.gold | 0) + (nst ? ' · 🗿 ' + nst + ' beeld' + (nst > 1 ? 'en' : '') : ''));
    chip('orechip', inv.ore > 0, '⛏️ Erts: ' + inv.ore + ' <small style="opacity:.6">(bij de smid)</small>');
    const L = levelInfo(inv.xp), free = talentPoints(L.level) - spentPoints(inv.tal);
    $('lvlchip').textContent = 'Niveau ' + L.level + (free > 0 ? ' · ' + free + ' talentpunt' + (free > 1 ? 'en' : '') + ' (pauzemenu)' : '');
    $('xpbar').firstElementChild.style.width = (L.need ? Math.round(100 * L.into / L.need) : 100) + '%';
    if (inv.daily) renderQuests($('questhud'), inv, true);
    const all = g.pl.items(), hb = $('hotbar'); hb.innerHTML = '';
    for (let i = 0; i < (g.isTouch ? Math.max(all.length, 2) : 9); i++) {     // op touch alleen de slots die je hebt
      const it = all[i], d = document.createElement('div');
      d.className = 'slot' + (i === inv.equip ? ' sel' : ''); d.innerHTML = '<small>' + (i + 1) + '</small>';
      if (it) {
        if (it.type === 'axe') d.innerHTML += '🪓';
        else { d.style.color = RARITIES[it.rarity].color; d.innerHTML += '<span class="gem"></span>'; if (i !== inv.equip) d.style.borderColor = RARITIES[it.rarity].color + '88'; }
      } else d.style.opacity = 0.35;
      hb.appendChild(d);
    }
    const cur = all[inv.equip] || AXE;
    $('itemname').innerHTML = cur.type === 'axe' ? '<b>Houthakkersbijl</b> · schade ' + AXE.damage
      : '<b style="color:' + RARITIES[cur.rarity].color + '">' + esc(cur.name) + (cur.f ? ' +' + cur.f : '') + '</b> · ' + RARITIES[cur.rarity].name + ' · schade ' + cur.damage + ' · snelheid ' + cur.speed;
  }
  function renderVitals() {
    $('hpbar').firstElementChild.style.width = clamp(100 * you.hp / (you.mhp || 100), 0, 100) + '%'; $('hpbar').lastElementChild.textContent = 'Gezondheid ' + Math.max(0, Math.round(you.hp)) + (g.bs && !g.dead && g.bs.nearFire(player.x, player.z) ? ' · 🔥 warm' : '');
    $('hubar').firstElementChild.style.width = clamp(you.hu, 0, 100) + '%'; $('hubar').lastElementChild.textContent = 'Honger ' + Math.round(you.hu);
    $('hubar').classList.toggle('low', you.hu < 25);
    $('score').textContent = '⭐ Punten: ' + you.sc;
    const bf = you.bf || null; chip('buffchip', !!bf, bf ? (bf.feast ? '🍗 ' + fmt(bf.feast) + ' ' : '') + (bf.elixir ? '⚗️ ' + fmt(bf.elixir) + ' ' : '') + (bf.haste ? '🍵 ' + fmt(bf.haste) : '') : '');
    const w = $('wave');
    w.classList.toggle('fight', wave.ph === 1);
    const wm = wave.ph === 1 && wave.mod ? WAVE_MODS.find(x => x.id === wave.mod) : null;
    w.innerHTML = wave.ph === 1 ? '<b>Golf ' + wave.n + '</b>' + (wm ? ' · <span style="color:#ff9a6a">' + wm.name + '</span>' : '') + ' · ' + wave.left + (wave.left === 1 ? ' vijand' : ' vijanden') + ' over'
      : (wave.n === 0 ? 'Eerste golf begint over <b>' + fmt(wave.t) + '</b>' : 'Golf ' + (wave.n + 1) + ' begint over <b>' + fmt(wave.t) + '</b>');
    $('players').innerHTML = lastPlayers.map(p => '<div class="pl' + (p.dead ? ' dead' : '') + '"><span>' + esc(names.get(p.id) || '?') + (p.id === g.myId ? ' (jij)' : '') + '</span><span class="hpb"><i style="width:' + clamp(p.id === g.myId ? you.hp : p.hp, 0, 100) + '%"></i></span></div>').join('');
  }
  /** Pijl met afstand naar de winkel. */
  function shopChip() {
    const dx = W.shop.x - player.x, dz = W.shop.z - player.z, d = Math.hypot(dx, dz), c = $('shopchip');
    c.classList.add('on');
    if (d < 9) { c.textContent = '🏪 Winkel hier'; return; }
    const f = fwdOf(player.yaw), ang = Math.atan2(dx * Math.cos(player.yaw) + dz * -Math.sin(player.yaw), dx * f.x + dz * f.z) * 180 / Math.PI;
    c.innerHTML = '<span class="arr" style="transform:rotate(' + ang.toFixed(0) + 'deg)">▲</span>🏪 Winkel · ' + Math.round(d) + ' m';
  }

  /* ---------------------------------------------------------------- berichten van de server */
  net.on('s', m => {
    lastPlayers = m.p.map(a => ({ id: a[0], hp: a[5], dead: a[7] }));
    Object.assign(you, m.y); Object.assign(wave, m.w);
    if (g.dead) $('dead-sub').textContent = g.deadNote || (you.rs > 0 ? 'Terug in het spel over ' + you.rs + ' s' + (g.deadHelp ? ' · een medespeler kan je opknappen' : '') : '');
    renderVitals();
  });
  net.on('inv', m => {
    inv.tut = m.tut | 0; renderTut();
    inv.gold = m.gold | 0; inv.statues = m.statues || {}; inv.ore = m.ore | 0; inv.xp = m.xp | 0; inv.tal = m.tal || {}; inv.daily = m.daily || null; inv.ach = m.ach || {};
    inv.wood = m.wood; inv.meat = m.meat; inv.potions = m.potions | 0; inv.up = m.up || inv.up; inv.dog = m.dog || null; inv.fish = m.fish | 0; inv.swords = m.swords; inv.equip = m.equip; inv.stats = m.stats || inv.stats;
    if (m.week) inv.week = m.week;
    renderInv(); g.pl.rebuildHeld();
  });
  net.on('toast', m => toast(esc(m.msg), m.color));
  net.on('pjoin', m => { names.set(m.id, m.name); looks.set(m.id, m.look | 0); toast('<b>' + esc(m.name) + '</b> doet mee.', '#6fd37a'); });
  net.on('pleave', m => { const n = names.get(m.id); if (n) toast(esc(n) + ' is vertrokken.', '#bbb'); names.delete(m.id); });
  net.on('wave', m => {
    if (m.ph === 1) {
      const mod = WAVE_MODS.find(x => x.id === m.mod);
      banner('GOLF ' + m.n + (m.boss ? '<small>Een baas nadert: ' + MONSTERS[m.boss === true ? 3 : m.boss].name + (BOSS_TIP[m.boss] ? ' · ' + BOSS_TIP[m.boss] : '') + '</small>' : mod ? '<small style="color:#ff9a6a">' + mod.name + ': ' + mod.desc + ' · meer beloning</small>' : '<small>' + m.count + ' monsters komen eraan</small>'), 4600);
      sfx.horn();
      if (m.ease) setTimeout(() => toast('💪 Nieuwe poging: de monsters van deze golf zijn ' + m.ease + '% zwakker.', '#9ad8ff'), 1500);
    } else if (m.wipe) banner('Iedereen is gevallen<small>Golf ' + (m.n + 1) + ' begint opnieuw</small>', 4200);
    else if (m.cleared) banner('Golf ' + m.n + ' verslagen<small>De volgende golf komt over ' + fmt(m.next) + '</small>', 4200);
  });
  net.on('loot', m => {
    if (m.kind === 'wood') toast('🪵 <b>' + m.n + ' hout</b> in de kist.', '#c89a5e');
    else if (m.kind === 'meat') toast('🍖 <b>' + m.n + ' vlees</b> in de kist.', '#e58b7b');
    else if (m.kind === 'empty') toast('De kist is leeg. Alleen stof en spinnenwebben.', '#999');
    else if (m.kind === 'dungeon') toast('🏛️ Kerkerbuit: <b>+' + m.ore + ' erts</b> en <b>+' + m.wood + ' hout</b>', '#ffd27a');
    else if (m.kind === 'ore') { toast('⛏️ <b>+' + m.n + ' erts</b>', '#c9a46a'); sfx.coin(); }
    else if (m.sword) {
      const sw = m.sword, R = RARITIES[sw.rarity];
      let html = '<b>' + esc(sw.name) + '</b><br>' + R.name + ' · schade ' + sw.damage + ' · snelheid ' + sw.speed;
      if (m.res === 'replaced') html += '<br><small>Rugzak vol: ' + esc(m.dropped.name) + ' weggegooid.</small>';
      else if (m.res === 'left') html += '<br><small>Zwakker dan wat je al hebt, achtergelaten.</small>';
      else if (m.auto) html += '<br><small>Nu je beste zwaard, automatisch uitgerust.</small>';
      const from = { monster: 'Buit van een monster!', wave: 'Golfbeloning!', shop: 'Gekocht in de winkel!' }[m.src];
      toast((from ? from + '<br>' : '') + html, R.color); sfx.reveal(sw.rarity);
    }
  });
  net.on('ev', m => {
    switch (m.k) {
      case 'ate': sfx.eat(); break;
      case 'drank': sfx.drink(); break;
      case 'quest': sfx.happy(); break;
      case 'plvl': {
        const e = m.id === g.myId ? null : g.ents.remotes.get(m.id);
        const x = e ? e.x : player.x, z = e ? e.z : player.z; g.particles.sparkles.emit(x, W.heightAt(x, z) + 1, z, 60, 1.6, 3, 1.4);
        if (m.id === g.myId) { banner('Niveau ' + m.lvl + '!<small>Besteed je talentpunt in het pauzemenu</small>', 3800); sfx.happy(); }
        break;
      }
      case 'tut': sfx.happy(); if (m.done) banner('Uitleg voltooid!<small>Je kent nu de basis. Veel plezier in Swordwoods.</small>', 4200); else toast('✔ Goed zo! Volgende stap: <b>' + esc(TUTORIAL[m.step].text) + '</b>', '#6fd37a'); break;
      case 'ach': { const A = ACHIEVEMENTS.find(a => a.id === m.id); if (A) { banner(A.icon + ' ' + esc(A.name) + '<small>Prestatie behaald: ' + esc(A.desc) + '</small>', 4200); sfx.reveal(3); } break; }
    }
  });

  /** Eenmalige tips na het laden: het weekevent, en later de honden. */
  function welcome() {
    const E = g.joined.week && WEEK_EVENTS.find(e => e.id === g.joined.week.ev);
    if (E) setTimeout(() => toast(E.icon + ' Deze week: <b>' + E.name + '</b> · ' + E.desc + '. Alle ervaring telt mee voor de weekranglijst.', '#ffd27a'), 3500);
    setTimeout(() => { if (!inv.dog) toast('Ergens in het bos zwerven honden. Hoor je geblaf? Geef een hond een stuk vlees en hij wordt je maatje.', '#c8903f'); }, 25000);
  }
  function update(dt, time) { if (Math.floor(time * 5) !== Math.floor((time - dt) * 5)) shopChip(); }
  return { toast, banner, actionBar, renderInv, renderVitals, renderTut, renderDogChip, welcome, update };
}
