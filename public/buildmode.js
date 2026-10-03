// Bouwen aan de clientkant: bouwwerken tonen, botsing, vuurlicht, pijlen van torens en de bouwmodus (voorbeeld + balk).
import * as THREE from 'three';
import { BUILDS, BUILD_BY_ID, BUILD_RANGE, FIRE_RADIUS, placePoint, canPlace, pushOut, boundR } from './builds.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REMOVE = BUILDS.length;          // laatste vakje: afbreken

export function createBuildSystem(ctx) {
  const { scene, M, W, G, net, player, inv, myName, heightAt, camera } = ctx;
  const builds = new Map();            // id -> { id, kind, x, z, rot, hp, maxhp, owner, group, flames, bar }
  const felled = { has: i => !!(ctx.treeObjs[i] && ctx.treeObjs[i].felled) };
  let active = false, sel = 0, lastPlace = 0, ghost = null, ghostKind = '', cur = null, removeTarget = null;

  /* ---------------------------------------------------------------- bouwwerken tonen */
  const groundY = (B, x, z, rot) => {
    if (B.water) return ctx.WATER - 0.08;
    if (B.shape === 'circle') return heightAt(x, z);
    const c = Math.cos(rot), s = Math.sin(rot); let lo = heightAt(x, z);
    for (const [lx, lz] of [[-B.w / 2, -B.d / 2], [B.w / 2, -B.d / 2], [-B.w / 2, B.d / 2], [B.w / 2, B.d / 2]]) lo = Math.min(lo, heightAt(x + lx * c + lz * s, z - lx * s + lz * c));
    return lo - 0.04;
  };
  function add(t, fresh = false) {
    const [id, ki, x, z, rot, hp, maxhp, owner] = t, kind = BUILDS[ki].id, B = BUILD_BY_ID[kind];
    if (builds.has(id)) remove(id, false);
    const o = M.buildStructure(kind, M.colorForName(owner || '?'));
    o.group.position.set(x, groundY(B, x, z, rot), z); o.group.rotation.y = rot;
    scene.add(o.group);
    const bar = M.makeBar(Math.min(2.2, 0.8 + boundR(B) * 0.6)); bar.visible = false; scene.add(bar);
    const e = { id, kind, x, z, rot, hp, maxhp, owner, group: o.group, flames: o.flames, bar, barY: (B.h || 1.4) + 0.5, pop: fresh ? 0 : 1 };
    builds.set(id, e);
    if (fresh) { ctx.chips.emit(x, e.group.position.y + 0.5, z, 24, 2.5, 3, 0.8); ctx.sfx.chop(); }
    return e;
  }
  function remove(id, fx = true) {
    const e = builds.get(id); if (!e) return;
    scene.remove(e.group); scene.remove(e.bar); builds.delete(id);
    if (fx) { ctx.chips.emit(e.x, e.group.position.y + 0.8, e.z, 40, 3.5, 3, 1); ctx.sfx.fall(); }
  }
  for (const t of ctx.joined.builds || []) add(t);

  net.on('ev', m => {
    switch (m.k) {
      case 'bnew': add(m.b, true); break;
      case 'bgone': remove(m.id, m.how !== 'replace'); if (m.how === 'destroy') ctx.toast('Een bouwwerk is vernield.', '#ff9c8a'); break;
      case 'bhp': { const e = builds.get(m.id); if (e) { e.hp = m.hp; e.hitT = 0.25; ctx.chips.emit(e.x, e.group.position.y + 1, e.z, 6, 2, 2, 0.6); } break; }
      case 'arrow': shoot(m); break;
      case 'board': case 'unboard': { const e = builds.get(m.id); if (e) { e.x = m.x; e.z = m.z; e.rot = m.rot; e.group.rotation.y = m.rot; } if (ctx.onBoat) ctx.onBoat(m); break; }
    }
  });
  net.on('buildfail', m => { ctx.toast('🔨 ' + esc(m.msg), '#ff9c8a'); ctx.sfx.creak(); });

  /* ---------------------------------------------------------------- pijlen van torens */
  const arrowGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.9, 4).rotateX(Math.PI / 2);
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffe3a0 });
  const arrows = [];
  function shoot(m) {
    const b = builds.get(m.b); if (!b) return;
    const mesh = new THREE.Mesh(arrowGeo, arrowMat); scene.add(mesh);
    const from = new THREE.Vector3(b.x, b.group.position.y + 4.6, b.z), to = new THREE.Vector3(m.x, heightAt(m.x, m.z) + 1.0, m.z);
    arrows.push({ mesh, from, to, t: 0, dur: Math.max(0.12, from.distanceTo(to) / 45) });
    if (Math.hypot(b.x - player.x, b.z - player.z) < 35) ctx.sfx.swing();
  }

  /* ---------------------------------------------------------------- vuurlicht (vaste pool: geen shaderwissels) */
  const lights = [0, 1, 2].map(() => { const l = G.addLantern(new THREE.Vector3(0, -50, 0), 0xff9a40, 0, 14); return l; });

  /* ---------------------------------------------------------------- botsing en warmte */
  function collide(x, z, r) {
    for (const e of builds.values()) {
      const B = BUILD_BY_ID[e.kind]; if (!B.solid) continue;
      if (Math.abs(e.x - x) > boundR(B) + r + 0.3 || Math.abs(e.z - z) > boundR(B) + r + 0.3) continue;
      const q = pushOut(e, x, z, r); if (q) { x = q[0]; z = q[1]; }
    }
    return [x, z];
  }
  const nearFire = (x, z) => { for (const e of builds.values()) if (e.kind === 'campfire' && Math.hypot(e.x - x, e.z - z) < FIRE_RADIUS) return true; return false; };

  /* ---------------------------------------------------------------- bouwbalk */
  const bar = $('buildbar');
  function renderBar() {
    bar.innerHTML = BUILDS.map((B, i) => '<div class="bslot' + (i === sel ? ' sel' : '') + (inv.wood < B.cost ? ' poor' : '') + '" data-b="' + i + '"><small>' + (i + 1) + '</small><span>' + B.icon + '</span><em>' + B.cost + '</em></div>').join('') +
      '<div class="bslot rm' + (sel === REMOVE ? ' sel' : '') + '" data-b="' + REMOVE + '"><small>' + (REMOVE + 1) + '</small><span>🪓</span><em>weg</em></div>';
    const B = BUILDS[sel];
    $('buildname').innerHTML = sel === REMOVE ? '<b>Afbreken</b> · eigen bouwwerk weghalen, je krijgt tot de helft van het hout terug'
      : '<b>' + esc(B.name) + '</b> · ' + B.cost + ' hout · ' + esc(B.desc);
  }
  bar.addEventListener('pointerdown', e => { const s = e.target.closest('[data-b]'); if (!s) return; e.preventDefault(); e.stopPropagation(); select(+s.dataset.b); });
  function select(i) { sel = Math.max(0, Math.min(REMOVE, i)); renderBar(); }
  const cycle = d => select((sel + d + REMOVE + 1) % (REMOVE + 1));
  function setActive(on) {
    active = on; document.body.classList.toggle('building', on);
    if (on) renderBar(); else { if (ghost) ghost.visible = false; rmBox.visible = false; }
    if (ctx.onToggle) ctx.onToggle(on);
  }

  /* ---------------------------------------------------------------- voorbeeld */
  const okMat = new THREE.MeshBasicMaterial({ color: 0x6fe07a, transparent: true, opacity: 0.42, depthWrite: false });
  const badMat = new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.42, depthWrite: false });
  const rmBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.25, depthWrite: false, wireframe: false }));
  rmBox.visible = false; scene.add(rmBox);
  function makeGhost(kind) {
    if (ghost) scene.remove(ghost);
    ghost = M.buildStructure(kind, 0xffffff).group; ghostKind = kind;
    ghost.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.material = okMat; } });
    scene.add(ghost);
  }
  function compute() {
    const B = BUILDS[sel];
    let { x, z, rot } = placePoint(B, player.x, player.z, player.yaw);
    if (B.id === 'wall' || B.id === 'palisade') {          // muren sluiten netjes op elkaar aan
      for (const o of builds.values()) {
        if (o.kind !== 'wall' && o.kind !== 'palisade') continue;
        const O = BUILD_BY_ID[o.kind]; if (Math.hypot(o.x - x, o.z - z) > O.w / 2 + B.w / 2 + 1.6) continue;
        const dr = (((rot - o.rot) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2;
        if (Math.abs(dr) > 0.55) continue;
        const ax = Math.cos(o.rot), az = -Math.sin(o.rot), along = (x - o.x) * ax + (z - o.z) * az, side = along >= 0 ? 1 : -1, off = O.w / 2 + B.w / 2 + 0.08;
        const sx = o.x + ax * off * side, sz = o.z + az * off * side;
        if (Math.hypot(sx - x, sz - z) < 1.7) { x = sx; z = sz; rot = o.rot; break; }
      }
    }
    let why = canPlace(W, builds.values(), B.id, x, z, rot, felled);
    if (!why && inv.wood < B.cost) why = 'Je hebt ' + B.cost + ' hout nodig (nu ' + inv.wood + ')';
    return { B, x, z, rot, why };
  }
  function findRemoveTarget() {
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw); let best = null, bd = 1e9;
    for (const e of builds.values()) {
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > BUILD_RANGE || (d > 1.2 && (dx * fx + dz * fz) / d < 0.55)) continue;
      const score = d - (e.owner === myName ? 3 : 0); if (score < bd) { bd = score; best = e; }
    }
    return best;
  }
  function place() {
    if (!active || performance.now() - lastPlace < 350) return;
    lastPlace = performance.now();
    if (sel === REMOVE) {
      if (!removeTarget) return ctx.toast('Kijk naar een bouwwerk om het af te breken.', '#bbb');
      if (removeTarget.owner !== myName) return ctx.toast('Dit is van ' + esc(removeTarget.owner) + '.', '#ff9c8a');
      net.send({ t: 'unbuild', id: removeTarget.id }); return;
    }
    const c = compute();
    if (c.why) { ctx.toast('🔨 ' + esc(c.why), '#ff9c8a'); ctx.sfx.creak(); return; }
    net.send({ t: 'build', kind: c.B.id, x: +c.x.toFixed(2), z: +c.z.toFixed(2), rot: +c.rot.toFixed(3) });
  }

  /* ---------------------------------------------------------------- per frame */
  const tmp = [];
  function update(dt, time) {
    // bouwwerken: opkomen, schadebalk, vlammen
    tmp.length = 0;
    for (const e of builds.values()) {
      if (e.kind === 'boat') {                 // dobberen; wie erin zit bepaalt de plek
        const rp = ctx.riderPos ? ctx.riderPos(e.id) : null;
        if (rp) { e.x = rp.x; e.z = rp.z; e.rot = rp.yaw; e.group.rotation.y = rp.yaw; }
        const own = !!(rp && rp.self); if (e.group.userData.sail && e.group.userData.sail.visible === own) { e.group.userData.sail.visible = !own; e.group.userData.mast.visible = !own; }   // eigen zeil niet voor je neus
        e.group.position.set(e.x, ctx.WATER - 0.08 + Math.sin(time * 1.6 + e.id) * 0.06, e.z);
        e.group.rotation.z = Math.sin(time * 1.1 + e.id) * 0.04; e.group.rotation.x = Math.sin(time * 1.3 + e.id * 2) * 0.03;
      }
      if (e.pop < 1) { e.pop = Math.min(1, e.pop + dt * 3); const s = 0.3 + 0.7 * (1 - Math.pow(1 - e.pop, 3)); e.group.scale.set(1, s, 1); }
      const d = Math.hypot(e.x - player.x, e.z - player.z);
      if (e.hitT > 0) { e.hitT -= dt; e.group.position.x = e.x + Math.sin(time * 70) * 0.04 * (e.hitT / 0.25); }
      e.bar.visible = e.hp < e.maxhp && d < 30;
      if (e.bar.visible) { e.bar.position.set(e.x, e.group.position.y + e.barY, e.z); e.bar.quaternion.copy(camera.quaternion); M.setBar(e.bar, e.hp / e.maxhp); }
      if (e.flames.length) {
        if (d < 70) for (const f of e.flames) { f.scale.set(1 + Math.sin(time * 13 + e.id) * 0.08, 1 + Math.sin(time * 17 + e.id * 3) * 0.18 + Math.random() * 0.08, 1); f.rotation.y += dt * 2; }
        tmp.push([d, e]);
      }
      if (e.kind === 'tower' && e.group.userData.flag) e.group.userData.flag.rotation.y = Math.sin(time * 2 + e.id) * 0.3;
    }
    tmp.sort((a, b) => a[0] - b[0]);
    lights.forEach((l, i) => {
      const it = tmp[i];
      if (!it || it[0] > 60) { l.userData.max = 0; return; }
      const e = it[1], camp = e.kind === 'campfire';
      l.position.set(e.x, e.group.position.y + (camp ? 1.0 : 1.9), e.z);
      l.userData.max = (camp ? 4.5 : 2.0) * (0.85 + Math.sin(time * 11 + i) * 0.08 + Math.random() * 0.07);
      l.distance = camp ? 16 : 10;
    });
    if (Math.random() < dt * 6) for (const [d, e] of tmp) if (d < 40 && e.kind === 'campfire') ctx.sparkles.emit(e.x + (Math.random() - 0.5) * 0.3, e.group.position.y + 0.8, e.z + (Math.random() - 0.5) * 0.3, 1, 0.3, 1.2, 1.2);
    for (let i = arrows.length - 1; i >= 0; i--) {
      const a = arrows[i]; a.t += dt / a.dur;
      a.mesh.position.lerpVectors(a.from, a.to, Math.min(1, a.t)); a.mesh.position.y += Math.sin(Math.min(1, a.t) * Math.PI) * 0.8; a.mesh.lookAt(a.to);
      if (a.t >= 1) { scene.remove(a.mesh); arrows.splice(i, 1); }
    }

    // bouwmodus
    if (!active) return;
    const pr = $('prompt');
    if (sel === REMOVE) {
      if (ghost) ghost.visible = false;
      removeTarget = findRemoveTarget();
      rmBox.visible = !!removeTarget;
      if (removeTarget) {
        const B = BUILD_BY_ID[removeTarget.kind], h = B.h || 1.6;
        rmBox.scale.set(B.shape === 'box' ? B.w + 0.2 : B.r * 2 + 0.3, h + 0.3, B.shape === 'box' ? B.d + 0.2 : B.r * 2 + 0.3);
        rmBox.position.set(removeTarget.x, removeTarget.group.position.y + h / 2, removeTarget.z); rmBox.rotation.y = removeTarget.rot;
        rmBox.material.color.set(removeTarget.owner === myName ? 0xff4a3a : 0x888888);
      }
      pr.innerHTML = removeTarget ? (removeTarget.owner === myName ? (ctx.isTouch ? 'A' : '<b>Klik</b>') + ' · ' + esc(BUILD_BY_ID[removeTarget.kind].name.toLowerCase()) + ' afbreken' : 'Van ' + esc(removeTarget.owner)) : 'Kijk naar een eigen bouwwerk';
      pr.classList.add('on');
      return;
    }
    rmBox.visible = false;
    cur = compute();
    if (ghostKind !== cur.B.id || !ghost) makeGhost(cur.B.id);
    ghost.visible = true;
    ghost.position.set(cur.x, groundY(cur.B, cur.x, cur.z, cur.rot), cur.z); ghost.rotation.y = cur.rot;
    const mat = cur.why ? badMat : okMat;
    if (ghost.userData.mat !== mat) { ghost.userData.mat = mat; ghost.traverse(o => { if (o.isMesh) o.material = mat; }); }
    pr.innerHTML = cur.why ? '<span style="color:#ff9c8a">' + esc(cur.why) + '</span>' : (ctx.isTouch ? 'A' : '<b>Klik</b>') + ' · ' + esc(cur.B.name.toLowerCase()) + ' bouwen (' + cur.B.cost + ' hout)' + (ctx.isTouch ? '' : ' · <b>B</b> stoppen');
    pr.classList.add('on');
  }

  function markers() {
    const out = [];
    for (const e of builds.values()) {
      if (e.kind === 'bed') { if (e.owner === myName) out.push({ x: e.x, z: e.z, kind: 'bed' }); continue; }
      if (e.kind === 'torch') continue;
      if (e.kind === 'boat') { if (e.owner === myName) out.push({ x: e.x, z: e.z, kind: 'boat' }); continue; }
      out.push({ x: e.x, z: e.z, kind: 'build', color: e.kind === 'campfire' ? '#ff9a40' : e.kind === 'tower' ? '#e8c27a' : '#b98a52' });
    }
    return out;
  }

  return {
    builds, add, remove, collide, nearFire, update, place, select, cycle, markers,
    toggle: () => setActive(!active), setActive, renderBar,
    get active() { return active; }, get sel() { return sel; }, get cur() { return cur; },
  };
}
