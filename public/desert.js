// Het Woestijneiland aan de clientkant: terrein, palmen-decor, zandbergen om te graven, de bazaar van Farid,
// faraobeelden en goud, en varen met de boot.
import * as THREE from 'three';
import { STATUES, statueOf, BAZAAR } from './items.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function createDesert(ctx) {
  const { scene, M, W, G, net, player, inv, heightAt, WATER, sfx, sparkles, chips, toast, banner, myId } = ctx;
  const D = W.desert;

  /* ---------------------------------------------------------------- terrein (eigen mesh naast het bos-eiland) */
  {
    const S = D.r * 2 + 50, SEG = 150, geo = new THREE.PlaneGeometry(S, S, SEG, SEG); geo.rotateX(-Math.PI / 2); geo.translate(D.cx, 0, D.cz);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nor.getY(i), n = W.vnoise(x * 0.3, z * 0.3);
      let c = [0.86 + 0.05 * n, 0.72 + 0.05 * n, 0.47 + 0.04 * n];
      const shade = sstep(0.98, 0.8, ny); c = c.map((v, k) => v - shade * [0.12, 0.12, 0.08][k]);         // schaduwkant van duinen
      const wet = 1 - sstep(-0.4, 0.9, h); c = c.map((v, k) => v * (1 - wet * 0.25));                       // nat zand aan de waterkant
      const oas = Math.exp(-((x - D.oasis.x) ** 2 + (z - D.oasis.z) ** 2) / 700) * sstep(-1, 1.5, h);         // groen rond de oase
      c = c.map((v, k) => v + ([0.32, 0.5, 0.2][k] - v) * oas * 0.7);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    G.terrainDetail(mesh.material); mesh.receiveShadow = true; scene.add(mesh);
    // cactussen en botten als decor (niet om tegenaan te botsen)
    const rnd = (() => { let a = W.seed * 7 + 3; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    for (let i = 0; i < 70; i++) {
      const p = D.point(rnd, 6, D.r * 0.82, 1.2); if (!p) continue;
      if (Math.hypot(p.x - D.bazaar.x, p.z - D.bazaar.z) < 8 || D.mounds.some(m => Math.hypot(m.x - p.x, m.z - p.z) < 3)) continue;
      const c = M.buildCactus(i + 1); c.position.set(p.x, heightAt(p.x, p.z) - 0.1, p.z); scene.add(c);
    }
  }

  /* ---------------------------------------------------------------- haven en bazaar */
  const baz = M.buildBazaar(); baz.group.position.set(D.bazaar.x, D.bazaar.y - 0.05, D.bazaar.z); baz.group.rotation.y = D.bazaar.rotY; scene.add(baz.group);
  { // steiger bij de haven
    const pier = new THREE.Group(), plank = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
    for (let i = 0; i < 7; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 0.9), plank); b.position.set(0, 0, -i * 0.95); b.castShadow = true; b.receiveShadow = true; pier.add(b); }
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 6), plank); p.position.set(s * 0.95, -1.2, -i * 1.9); pier.add(p); }
    const a = Math.atan2(D.cx - D.harbor.x, D.cz - D.harbor.z);   // richting landinwaarts
    pier.position.set(D.harbor.x, Math.max(0.2, heightAt(D.harbor.x, D.harbor.z)) - 0.05, D.harbor.z); pier.rotation.y = a; scene.add(pier);
    const sign = M.makeLabel('Woestijneiland', '#ffd27a'); sign.position.set(D.harbor.x, D.harbor.y + 3.2, D.harbor.z); sign.scale.multiplyScalar(1.6); scene.add(sign);
  }
  G.addLantern(new THREE.Vector3(D.bazaar.x, D.bazaar.y + 2.6, D.bazaar.z), 0xffb060, 5, 16);

  /* ---------------------------------------------------------------- zandbergen */
  const moundObjs = D.mounds.map(m => {
    const o = M.buildMound(m.size, m.idx + 1); o.group.position.set(m.x, m.y - 0.15, m.z); o.group.rotation.y = m.rotY; scene.add(o.group);
    return { m, ...o, dug: false, seen: false, digT: 0 };
  });
  function setDug(i, dug) { const o = moundObjs[i]; if (!o) return; o.dug = dug; o.hill.visible = !dug; o.marks.visible = !dug; o.hole.visible = dug; }
  for (const i of ctx.joined.mounds || []) setDug(i, true);
  function findMound() {
    let best = null, bd = 3.2;
    for (const o of moundObjs) { const d = Math.hypot(o.m.x - player.x, o.m.z - player.z); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  let digging = null;   // { i, t, dur }
  function startDig() {
    const o = findMound(); if (!o) return false;
    if (o.dug) { toast('Hier is al gegraven. Het zand waait er over een paar minuten weer overheen.', '#bbb'); return true; }
    net.send({ t: 'dig', i: o.m.idx }); return true;
  }

  /* ---------------------------------------------------------------- beelden: oprijzend uit het zand */
  const reveals = [];
  function revealStatue(x, z, k) {
    const g = M.buildStatue(k); const y = heightAt(x, z);
    g.position.set(x, y - 1.2, z); scene.add(g);
    reveals.push({ g, x, z, y, t: 0 });
    sparkles.emit(x, y + 0.6, z, k === 'masker' ? 120 : 50, 2.5, 3.5, 1.4);
  }

  net.on('ev', m => {
    switch (m.k) {
      case 'digstart': {
        const o = moundObjs[m.i]; if (o) o.digT = m.dur;
        if (m.id === myId) { digging = { i: m.i, t: 0, dur: m.dur }; $('digbar').classList.add('on'); }
        break;
      }
      case 'digfail': digging = null; $('digbar').classList.remove('on'); toast('Je bent weggelopen: het graven is gestopt.', '#bbb'); break;
      case 'dug': {
        const o = moundObjs[m.i]; setDug(m.i, true);
        if (o) { chips.emit(o.m.x, o.m.y + 0.5, o.m.z, 40, 3, 4, 1); o.digT = 0; }
        if (m.by !== myId) break;
        digging = null; $('digbar').classList.remove('on');
        const f = m.find;
        if (f.kind === 'statue') {
          const S = statueOf(f.k); revealStatue(o.m.x, o.m.z, f.k);
          banner('🗿 ' + esc(S.name) + '!<small>' + S.value + ' goud waard · verkoop het bij Farid in de haven</small>', 4200);
          sfx.reveal(Math.min(4, 1 + STATUES.findIndex(x => x.k === f.k)));
        } else if (f.kind === 'gold') { toast('🪙 <b>' + f.n + ' goudstukken</b> in het zand!', '#f2c14e'); sfx.coin(); }
        else if (f.kind === 'scarab') toast('🪲 Een scarabee… en een oude broodkorst (+1 vlees).', '#c8b48a');
        else toast('Alleen zand. Probeer een andere zandberg.', '#bbb');
        break;
      }
      case 'moundBack': setDug(m.i, false); break;
      case 'sold': sparkles.emit(D.bazaar.x, D.bazaar.y + 1.2, D.bazaar.z, 40, 2, 2.5, 1); sfx.coin(); setTimeout(() => sfx.coin(), 150); break;
      case 'kick': { const e = ctx.anis.get(m.id); if (e) { e.kickT = 0.3; } sfx.hit(); break; }
    }
  });

  /* ---------------------------------------------------------------- bazaar-paneel */
  let bazOpen = false;
  const nearBazaar = () => Math.hypot(D.bazaar.x - player.x, D.bazaar.z - player.z) < 5.6;
  function renderBazaar() {
    const st = inv.statues || {};
    $('baz-res').textContent = '🪙 ' + (inv.gold | 0) + ' goud · 🪵 ' + inv.wood + ' hout';
    const total = STATUES.reduce((a, S) => a + (st[S.k] | 0) * S.value, 0);
    $('baz-list').innerHTML = '<div class="shop-group">Verkopen</div><div class="shop-items">' + STATUES.map(S =>
      '<div class="item"><b style="color:' + S.color + '">' + esc(S.name) + '</b><small>' + (st[S.k] | 0) + ' in je tas · ' + S.value + ' goud per stuk</small>' +
      '<button class="buy" type="button" data-sell="' + S.k + '"' + ((st[S.k] | 0) ? '' : ' disabled') + '>Verkoop</button></div>').join('') +
      '<div class="item"><b>Alles</b><small>Samen ' + total + ' goud</small><button class="buy" type="button" data-sell="all"' + (total ? '' : ' disabled') + '>Verkoop alles</button></div></div>' +
      '<div class="shop-group">Kopen</div><div class="shop-items">' + BAZAAR.map(it => {
        const have = it.cur === 'gold' ? inv.gold | 0 : inv.wood, owned = it.id === 'shovel' && inv.up.shovel;
        return '<div class="item' + (owned ? ' owned' : '') + '"><b>' + it.icon + ' ' + esc(it.name) + '</b><small>' + esc(it.desc) + '</small><button class="buy" type="button" data-bz="' + it.id + '"' + (owned || have < it.cost ? ' disabled' : '') + '>' +
          (owned ? 'Gekocht' : 'Koop · ' + it.cost + (it.cur === 'gold' ? ' goud' : ' hout')) + '</button></div>';
      }).join('') + '</div><p class="q-note">Met goud koop je ook bij Bram in de winkel op het bos-eiland (Farao-zwaard, epische zwaarden, hout).</p>';
  }
  function openBazaar() { bazOpen = true; ctx.onPanel(true); renderBazaar(); $('bazaar').classList.add('on'); }
  function closeBazaar() { if (!bazOpen) return; bazOpen = false; $('bazaar').classList.remove('on'); ctx.onPanel(false); }
  $('baz-close').onclick = closeBazaar;
  $('baz-list').addEventListener('click', e => {
    const s = e.target.closest('[data-sell]'), b = e.target.closest('[data-bz]');
    if (s && !s.disabled) net.send({ t: 'sell', k: s.dataset.sell });
    if (b && !b.disabled) net.send({ t: 'bzbuy', id: b.dataset.bz });
  });

  /* ---------------------------------------------------------------- boot */
  let sailing = null;      // boot-id
  function findBoat() {
    let best = null, bd = 4.5;
    for (const e of ctx.builds().values()) { if (e.kind !== 'boat' || e.rider) continue; const d = Math.hypot(e.x - player.x, e.z - player.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  const nearLand = () => { for (let k = 0; k < 12; k++) for (const r of [2, 3.5, 5]) if (heightAt(player.x + Math.cos(k / 12 * 6.283) * r, player.z + Math.sin(k / 12 * 6.283) * r) > WATER + 0.4) return true; return false; };
  function onBoat(m) {
    const e = ctx.builds().get(m.id);
    if (m.k === 'board') {
      if (e) e.rider = m.pid;
      if (m.pid === myId) { sailing = m.id; player.sailing = m.id; player.x = m.x; player.z = m.z; player.vx = player.vz = 0; sfx.plop(); toast('⛵ Je vaart! Stuur met de muis en W/A/S/D (of de stick). Bij de kust: E (X) om aan land te gaan.', '#9ad8ff'); }
    } else {
      if (e) e.rider = null;
      if (m.pid === myId) { sailing = null; player.sailing = null; player.vx = player.vz = 0; }
    }
  }
  const riderPos = id => {
    if (sailing === id) return { x: player.x, z: player.z, yaw: player.yaw, self: true };
    for (const [pid, e] of ctx.remotes) if (e.boatId === id) return { x: e.x, z: e.z, yaw: e.yaw };
    return null;
  };

  /* ---------------------------------------------------------------- per frame */
  let wasIn = inDesertNow();
  function inDesertNow() { return player.x > D.cx - D.r - 25; }
  function update(dt, time) {
    if (digging) {
      digging.t += dt; const k = Math.min(1, digging.t / digging.dur);
      $('digbar').firstElementChild.style.width = Math.round(k * 100) + '%';
      if (Math.random() < 0.4) { const o = moundObjs[digging.i]; if (o) chips.emit(o.m.x + (Math.random() - 0.5), o.m.y + 0.4, o.m.z + (Math.random() - 0.5), 1, 1.5, 2.5, 0.5); }
      if (Math.floor(digging.t * 3) !== Math.floor((digging.t - dt) * 3)) sfx.dig();
      if (digging.t > digging.dur + 2.5) { digging = null; $('digbar').classList.remove('on'); }
    }
    for (const o of moundObjs) {
      if (!o.seen && Math.abs(o.m.x - player.x) < 40 && Math.abs(o.m.z - player.z) < 40) o.seen = true;
      if (o.digT > 0) { o.digT -= dt; o.hill.scale.y = 0.75 * (0.85 + Math.sin(time * 30) * 0.03); } else if (!o.dug) o.hill.scale.y = 0.75;
    }
    for (let i = reveals.length - 1; i >= 0; i--) {
      const r = reveals[i]; r.t += dt;
      r.g.position.y = r.y - 1.2 + Math.min(1, r.t / 1.2) * 1.5; r.g.rotation.y += dt * 1.5;
      if (r.t > 3.4) { r.g.scale.setScalar(Math.max(0.01, 1 - (r.t - 3.4) / 0.6)); }
      if (r.t > 4) { scene.remove(r.g); reveals.splice(i, 1); }
    }
    for (const e of ctx.anis.values()) if (e.kickT > 0) { e.kickT -= dt; if (e.model.legs) for (const l of e.model.legs) l.rotation.x = -1.2; }
    const now = inDesertNow();
    if (now !== wasIn) { wasIn = now; }
    if (bazOpen && Math.floor(time) !== Math.floor(time - dt)) renderBazaar();
  }
  function markers() {
    const out = [{ x: D.bazaar.x, z: D.bazaar.z, kind: 'bazaar' }];
    for (const o of moundObjs) if (o.seen && !o.dug) out.push({ x: o.m.x, z: o.m.z, kind: 'mound' });
    return out;
  }
  function prompt(touch) {
    if (sailing) return nearLand() ? (touch ? 'Aan land gaan (X)' : '<b>E</b> · aan land gaan') : 'Varen · het Woestijneiland ligt in het oosten (zie de kaart)';
    if (digging) return 'Graven…';
    const o = findMound(); if (o) return o.dug ? 'Hier is al gegraven' : (touch ? 'Graven (X)' : '<b>E</b> · graven in de zandberg');
    if (nearBazaar()) return touch ? 'Bazaar (X)' : '<b>E</b> · bazaar van Farid';
    const b = findBoat(); if (b) return touch ? 'Instappen (X)' : '<b>E</b> · in de boot stappen';
    return null;
  }
  /** E/X: geeft true als de woestijn of de boot de actie heeft afgehandeld. */
  function interact() {
    if (sailing) { net.send({ t: 'unboard' }); return true; }
    if (findMound()) return startDig();
    if (nearBazaar()) { openBazaar(); return true; }
    const b = findBoat(); if (b) { net.send({ t: 'board', id: b.id }); return true; }
    return false;
  }
  return {
    update, markers, prompt, interact, onBoat, riderPos, renderBazaar, closeBazaar,
    get bazOpen() { return bazOpen; }, get sailing() { return sailing; }, get digging() { return !!digging; },
  };
}
