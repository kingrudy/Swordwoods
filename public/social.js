// Samen spelen: hondencommando's, spullen geven, de gemeenschapskist en de arena (clientkant).
import * as THREE from 'three';
import { DOG_CMDS, RARITIES, MAX_POTIONS } from './items.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSocial(ctx) {
  const { scene, M, W, G, net, player, inv, names, remotes, myId, heightAt, sfx, sparkles, toast, banner } = ctx;

  /* ---------------------------------------------------------------- hondencommando's */
  let dogMenu = false;
  $('dogmenu').innerHTML = DOG_CMDS.map((c, i) => '<button type="button" data-dc="' + c.c + '"><span>' + c.icon + '</span><b>' + (i + 1) + ' · ' + c.name + '</b><small>' + c.desc + '</small></button>').join('');
  function toggleDogMenu(on = !dogMenu) {
    if (on && !inv.dog) { toast('Je hebt nog geen hond. Tem een zwerfhond met een stuk vlees.', '#bbb'); return; }
    dogMenu = on; $('dogmenu').classList.toggle('on', on);
  }
  function lookTarget() {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); let best = null, bs = -1;
    for (const e of ctx.mons.values()) {
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > 38 || d < 0.1) continue;
      const dot = (dx * fx + dz * fz) / d; if (dot < 0.85) continue;
      const sc = dot * 2 - d / 40; if (sc > bs) { bs = sc; best = e; }
    }
    return best;
  }
  function command(c) {
    toggleDogMenu(false);
    if (c === 'attack') { const t = lookTarget(); if (!t) { toast('Kijk naar een monster en geef dan het commando.', '#bbb'); return; } net.send({ t: 'dogcmd', c, id: t.id }); }
    else net.send({ t: 'dogcmd', c });
  }
  $('dogmenu').addEventListener('pointerdown', e => { const b = e.target.closest('[data-dc]'); if (b) { e.preventDefault(); e.stopPropagation(); command(b.dataset.dc); } });

  /* ---------------------------------------------------------------- gemeenschapskist */
  let pot = ctx.joined.pot || { have: 0, goal: 300, lvl: 1 }, potOpen = false;
  const potObj = M.buildChest(); potObj.group.scale.setScalar(1.6); potObj.group.position.set(W.pot.x, W.pot.y - 0.03, W.pot.z); potObj.group.rotation.y = W.pot.rotY;
  potObj.beam.visible = false; scene.add(potObj.group);
  const flag = new THREE.Group();
  { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6), new THREE.MeshStandardMaterial({ color: 0x5a3c25 })); pole.position.y = 1.7; flag.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.6), new THREE.MeshStandardMaterial({ color: 0xc0392b, side: THREE.DoubleSide })); cloth.position.set(0.52, 3.05, 0); flag.add(cloth); flag.userData.cloth = cloth; }
  flag.position.set(W.pot.x + 1.3, W.pot.y, W.pot.z - 0.6); scene.add(flag);
  const potLabel = M.makeLabel('Gemeenschapskist', '#ffd27a'); potLabel.position.set(W.pot.x, W.pot.y + 2.5, W.pot.z); scene.add(potLabel);
  const nearPot = () => Math.hypot(W.pot.x - player.x, W.pot.z - player.z) < 3.8;
  function renderPot() {
    $('pot-bar').firstElementChild.style.width = Math.round(100 * pot.have / pot.goal) + '%';
    $('pot-text').textContent = pot.have + ' / ' + pot.goal + ' hout · feestmaal ' + pot.lvl;
    $('pot-wood').textContent = '🪵 ' + inv.wood + ' hout';
    for (const b of document.querySelectorAll('#pot [data-dep]')) b.disabled = inv.wood <= 0;
  }
  function openPot() { potOpen = true; ctx.onPanel(true); renderPot(); $('pot').classList.add('on'); }
  function closePot() { if (!potOpen) return; potOpen = false; $('pot').classList.remove('on'); ctx.onPanel(false); }
  $('pot-close').onclick = closePot;
  $('pot').addEventListener('click', e => { const b = e.target.closest('[data-dep]'); if (!b) return; const v = b.dataset.dep; net.send({ t: 'deposit', n: v === 'all' ? inv.wood : +v }); });
  net.on('pot', m => {
    pot = { have: m.have, goal: m.goal, lvl: m.lvl }; if (potOpen) renderPot();
    if (m.by !== myId && m.n >= 20) toast('🍗 <b>' + esc(names.get(m.by) || '?') + '</b> stopte ' + m.n + ' hout in de gemeenschapskist (' + m.have + '/' + m.goal + ')', '#ffd27a');
  });

  /* ---------------------------------------------------------------- arena */
  const A = W.arena;
  { const g = new THREE.Group();
    const sand = new THREE.Mesh(new THREE.CircleGeometry(A.r, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xc9b07a, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false }));
    sand.position.y = 0.06; sand.renderOrder = 1; g.add(sand);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 1 });
    for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35, 0), stone); s.position.set(Math.cos(a) * A.r, 0.2, Math.sin(a) * A.r); s.castShadow = true; g.add(s); }
    for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + 0.4;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 6), new THREE.MeshStandardMaterial({ color: 0x4a3222 })); pole.position.set(Math.cos(a) * (A.r + 0.6), 1.8, Math.sin(a) * (A.r + 0.6)); g.add(pole);
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc0392b : 0x2a6aa0, side: THREE.DoubleSide })); ban.position.set(Math.cos(a) * (A.r + 0.6), 2.8, Math.sin(a) * (A.r + 0.6)); ban.rotation.y = -a; g.add(ban); }
    const lab = M.makeLabel('Arena · duels', '#ff9a6a'); lab.position.y = 4.4; lab.scale.multiplyScalar(1.4); g.add(lab);
    g.position.set(A.x, heightAt(A.x, A.z), A.z); scene.add(g);
    // zand volgt het terrein niet precies; per steen de hoogte goed zetten
    g.children.forEach(c => { if (c.geometry && c.geometry.type === 'DodecahedronGeometry') c.position.y = heightAt(A.x + c.position.x, A.z + c.position.z) - g.position.y + 0.15; });
  }
  let inArena = false;
  net.on('ev', m => {
    if (m.k === 'phit') {
      const e = m.id === myId ? null : remotes.get(m.id);
      const x = e ? e.x : player.x, z = e ? e.z : player.z;
      ctx.addPopup(x, heightAt(x, z) + 2.1, z, m.dmg + (m.heavy ? '!' : ''), '#ff7a6a'); sfx.hit();
      if (e && ctx.flash) ctx.flash(e);
    } else if (m.k === 'duel') {
      if (m.w !== myId && m.l !== myId) toast('⚔️ <b>' + esc(names.get(m.w) || '?') + '</b> wint een duel van ' + esc(names.get(m.l) || '?'), '#ff9a6a');
      if (m.w === myId) sfx.reveal(2);
    } else if (m.k === 'feast') {
      banner('🍗 FEESTMAAL!<small>Vol gegeten, 2 drankjes en 10 minuten sterker voor iedereen</small>', 4500); sfx.happy();
      sparkles.emit(W.pot.x, W.pot.y + 1.5, W.pot.z, 80, 3, 4, 1.5);
    } else if (m.k === 'dogcmd') { const d = ctx.dogs.get(m.id); if (d && d.owner === myId) sfx.bark(0, 0.7); }
    else if (m.k === 'dogfound') {
      if (m.kind === 'chest') ctx.hud.discover(m.i); else if (ctx.onOreFound) ctx.onOreFound(m.i);
      ctx.hud.pings.push({ x: m.x, z: m.z, t: performance.now() / 1000, color: '#f2c14e', name: 'hond' });
      toast('👃 Je hond heeft ' + (m.kind === 'chest' ? 'een kist' : 'een ertsader') + ' gevonden! (📍 op de kaart)', '#f2c14e');
    } else if (m.k === 'gift') { if (m.to === myId || m.from === myId) sfx.coin(); }
  });

  /* ---------------------------------------------------------------- geven (pauzemenu) */
  function renderGive(el) {
    const near = [...remotes.entries()].filter(([, e]) => !e.dead && Math.hypot(e.x - player.x, e.z - player.z) < 8);
    if (!near.length) { el.innerHTML = '<p class="q-note">Ga binnen 8 meter van een andere speler staan om iets te geven. Zo kun je ook ruilen: allebei iets geven.</p>'; return; }
    el.innerHTML = near.map(([id]) => '<div class="give-row"><b>' + esc(names.get(id) || '?') + '</b><div class="row">' +
      [['wood', 10, '🪵 10 hout'], ['wood', 50, '🪵 50'], ['meat', 1, '🍖 1 vlees'], ['fish', 1, '🐟 1 vis'], ['ore', 5, '⛏️ 5 erts'], ['potions', 1, '🧪 drankje']]
        .map(([w, n, l]) => '<button class="btn small" type="button" data-give="' + id + '" data-w="' + w + '" data-n="' + n + '"' + ((inv[w] | 0) < 1 ? ' disabled' : '') + '>' + l + '</button>').join('') +
      (inv.swords.length ? '<select data-gsel="' + id + '">' + inv.swords.map((s, i) => '<option value="' + i + '">' + esc(s.name) + (s.f ? ' +' + s.f : '') + ' (' + s.damage + ')</option>').join('') + '</select><button class="btn small" type="button" data-gsw="' + id + '">Geef zwaard</button>' : '') +
      '</div></div>').join('');
  }
  $('pt-give').addEventListener('click', e => {
    const b = e.target.closest('[data-give]'); if (b) net.send({ t: 'give', to: +b.dataset.give, what: b.dataset.w, n: +b.dataset.n });
    const s = e.target.closest('[data-gsw]'); if (s) { const sel = $('pt-give').querySelector('[data-gsel="' + s.dataset.gsw + '"]'); net.send({ t: 'give', to: +s.dataset.gsw, what: 'sword', i: +sel.value }); }
  });

  function update(dt, time) {
    flag.userData.cloth.rotation.y = Math.sin(time * 2) * 0.25;
    const ia = Math.hypot(player.x - A.x, player.z - A.z) < A.r;
    if (ia !== inArena) { inArena = ia; if (ia) toast('⚔️ <b>Arena</b>: hier kun je andere spelers uitdagen. Wie verliest staat gewoon weer buiten de ring.', '#ff9a6a'); }
    document.body.classList.toggle('arena', inArena);
    if (potOpen && Math.floor(time) !== Math.floor(time - dt)) renderPot();
  }
  function markers() { return [{ x: W.pot.x, z: W.pot.z, kind: 'pot' }, { x: A.x, z: A.z, kind: 'arena' }]; }
  return {
    update, markers, toggleDogMenu, command, nearPot, openPot, closePot, renderPot, renderGive,
    get dogMenu() { return dogMenu; }, get potOpen() { return potOpen; }, get pot() { return pot; },
  };
}
