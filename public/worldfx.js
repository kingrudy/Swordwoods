// Wereld aan de clientkant: weer (regen, sneeuw, mist, onweer), biomen, ruïnes met kerkerkist en de reizende handelaar.
import * as THREE from 'three';
import { TRADER_ITEMS, WEATHERS, BIOMES } from './items.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createWorldFx(ctx) {
  const { scene, M, W, G, net, player, heightAt, camera, sfx, sparkles, chips, toast, banner, CH } = ctx;

  /* ---------------------------------------------------------------- neerslag */
  const N = 1400, BOX = 36, HGT = 26;
  const rainPos = new Float32Array(N * 6), rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaac4dc, transparent: true, opacity: 0.45, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  const snowPos = new Float32Array(N * 3), snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
  const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
  snow.frustumCulled = false; snow.visible = false; scene.add(snow);
  const drops = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * BOX * 2, y: Math.random() * HGT, z: (Math.random() - 0.5) * BOX * 2, s: 0.7 + Math.random() * 0.6, ph: Math.random() * 6 }));
  let weather = ctx.joined.weather || 'helder', amount = 0;
  G.setWeather(weather);
  net.on('weather', m => {
    weather = m.k; G.setWeather(weather);
    const w = WEATHERS.find(x => x.k === weather);
    if (w) toast((weather === 'helder' ? '☀️ Het klaart op.' : (weather === 'regen' ? '🌧️' : weather === 'onweer' ? '⛈️' : '🌫️') + ' <b>' + w.name + '</b>' + (w.desc ? ' · ' + w.desc : '')), '#9ad8ff');
  });

  /* ---------------------------------------------------------------- bliksem */
  const bolts = [];
  const boltMat = new THREE.LineBasicMaterial({ color: 0xf2f4ff, transparent: true, opacity: 1 });
  const warnMat = M.warnRingMat.clone(); warnMat.color.set(0xfff27a);
  net.on('ev', m => {
    if (m.k === 'bolt') {
      const ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.0, 36), warnMat.clone()); ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.x, heightAt(m.x, m.z) + 0.1, m.z); scene.add(ring);
      bolts.push({ kind: 'warn', mesh: ring, t: 0, delay: m.delay, x: m.x, z: m.z });
    } else if (m.k === 'ruin') setRuin(m.i, m.st, m.by);
  });
  function strike(x, z) {
    const y0 = heightAt(x, z), pts = [];
    let px = x, pz = z;
    for (let i = 0; i <= 14; i++) { const y = y0 + 70 - i * 5; pts.push(new THREE.Vector3(px, y, pz)); px = x + (Math.random() - 0.5) * 3 * (1 - i / 14); pz = z + (Math.random() - 0.5) * 3 * (1 - i / 14); }
    pts[pts.length - 1].set(x, y0, z);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), boltMat.clone()); scene.add(line);
    bolts.push({ kind: 'bolt', mesh: line, t: 0 });
    G.flash(); sparkles.emit(x, y0 + 0.4, z, 50, 4, 4, 0.7); chips.emit(x, y0 + 0.3, z, 20, 3, 3, 0.8);
    const d = Math.hypot(x - player.x, z - player.z);
    sfx.thunder(Math.max(0.25, 1 - d / 80));
  }

  /* ---------------------------------------------------------------- biomen */
  let biome = W.biomeAt(player.x, player.z), biomeT = 0, swampK = 1;
  function checkBiome(dt) {
    biomeT -= dt; if (biomeT > 0) return; biomeT = 0.5;
    const w = W.biomeW(player.x, player.z);
    G.setCold(w.snow);
    swampK = 1 - 0.15 * w.swamp;
    const b = W.biomeAt(player.x, player.z);
    if (b !== biome) { biome = b; const B = BIOMES[b]; toast(B.icon + ' <b>' + B.name + '</b>' + (B.desc ? '<br><small>' + B.desc + '</small>' : ''), '#c8e6ff'); }
  }

  /* ---------------------------------------------------------------- ruïnes */
  const ruinObjs = W.ruins.map((R, i) => {
    const floor = M.buildRuinFloor(5.4); floor.position.set(R.x, R.y - 0.02, R.z); scene.add(floor);
    const pillars = R.parts.map((p, k) => { const g = M.buildRuinPillar(p.h, p.rot, i * 31 + k + 1); g.position.set(p.x, p.y - 0.15, p.z); scene.add(g); return g; });
    const chest = M.buildChest(); chest.group.scale.setScalar(1.3); chest.group.position.set(R.chest.x, R.chest.y - 0.03, R.chest.z); chest.group.rotation.y = R.chest.rotY;
    chest.beam.material = M.ruinBeamMat.clone(); scene.add(chest.group);
    return { R, floor, pillars, chest, st: 'idle', seen: false, t: 0 };
  });
  function setRuin(i, st, by) {
    const o = ruinObjs[i]; if (!o) return;
    const prev = o.st; o.st = st; o.t = 0;
    const bm = o.chest.beam.material;
    bm.color.set(st === 'awake' ? 0xff3a2a : st === 'ready' ? 0xffd27a : 0xb06bff);
    o.chest.beam.visible = st !== 'cool';
    if (st === 'cool') { o.opening = true; sparkles.emit(o.R.chest.x, o.R.chest.y + 1, o.R.chest.z, 60, 2, 3, 1.2); if (by === ctx.myId) sfx.reveal(4); }
    if (st === 'idle') { o.chest.pivot.rotation.x = 0; o.opening = false; }
    if (st === 'awake' && Math.hypot(o.R.x - player.x, o.R.z - player.z) < 40) { sfx.rumble(); if (prev !== 'awake') banner('De bewakers ontwaken!<small>Versla ze om de kerkerkist te openen</small>', 3200); }
    if (st === 'ready' && Math.hypot(o.R.x - player.x, o.R.z - player.z) < 40) { sfx.happy(); toast('🏛️ De bewakers zijn verslagen. De kerkerkist kan open!', '#ffd27a'); }
  }
  (ctx.joined.ruins || []).forEach((st, i) => { if (st !== 'idle') setRuin(i, st); if (st === 'cool' && ruinObjs[i]) { ruinObjs[i].chest.pivot.rotation.x = -1.9; ruinObjs[i].opening = false; } });
  function findRuin() {
    for (const o of ruinObjs) if (Math.hypot(o.R.chest.x - player.x, o.R.chest.z - player.z) < 3.6) return o;
    return null;
  }
  const ruinPrompt = (o, touch) => o.st === 'idle' ? (touch ? 'Kerkerkist (X)' : '<b>E</b> · kerkerkist openen (bewakers ontwaken!)') : o.st === 'awake' ? 'Versla eerst de bewakers' : o.st === 'ready' ? (touch ? 'Buit pakken (X)' : '<b>E</b> · buit pakken') : 'Deze kist is al geplunderd. Kom later terug.';

  /* ---------------------------------------------------------------- reizende handelaar */
  let trader = null, traderObj = null, traderOpen = false, traderRig = null;
  function setTrader(info, arrived) {
    trader = info;
    if (!info) {
      if (traderObj) { sparkles.emit(traderObj.group.position.x, traderObj.group.position.y + 1, traderObj.group.position.z, 50, 2, 3, 1.2); scene.remove(traderObj.group); traderObj = null; traderRig = null; }
      if (traderOpen) closeTrader();
      return;
    }
    if (!traderObj) {
      traderObj = M.buildTraderCart();
      traderObj.group.position.set(info.x, heightAt(info.x, info.z) - 0.05, info.z); traderObj.group.rotation.y = Math.atan2(-info.x, -info.z);
      scene.add(traderObj.group);
      if (CH.isReady('merchant')) { traderRig = CH.createRig('merchant', 1.8); if (traderRig) { traderObj.npc.group.visible = false; traderRig.group.position.copy(traderObj.npc.group.position); traderRig.group.rotation.y = Math.PI; traderObj.group.add(traderRig.group); traderRig.loop('Idle'); } }
    }
    trader.leaveAt = performance.now() / 1000 + info.left;
    if (arrived) { toast('🧭 <b>Een reizende handelaar</b> is aangekomen! Hij blijft 4 minuten (paars op de kaart).', '#d7a8ff'); sfx.happy(); }
  }
  if (ctx.joined.trader) setTrader(ctx.joined.trader, false);
  net.on('trader', m => setTrader(m.info, m.arrived));
  const nearTrader = () => trader && Math.hypot(trader.x - player.x, trader.z - player.z) < 4.5;
  function renderTrader() {
    if (!trader) return;
    $('trader-wood').textContent = '🪵 ' + ctx.inv.wood + ' hout';
    const left = Math.max(0, Math.round(trader.leaveAt - performance.now() / 1000));
    $('trader-left').textContent = 'Vertrekt over ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    $('trader-list').innerHTML = '<div class="shop-items">' + trader.stock.map(id => {
      const it = TRADER_ITEMS.find(x => x.id === id); if (!it) return '';
      return '<div class="item"><b>' + it.icon + ' ' + esc(it.name) + '</b><small>' + esc(it.desc) + '</small><button class="buy" type="button" data-tbuy="' + it.id + '"' + (ctx.inv.wood < it.cost ? ' disabled' : '') + '>Koop · ' + it.cost + ' hout</button></div>';
    }).join('') + '</div>';
  }
  function openTrader() { if (!trader) return; traderOpen = true; ctx.onPanel(true); renderTrader(); $('trader').classList.add('on'); }
  function closeTrader() { if (!traderOpen) return; traderOpen = false; $('trader').classList.remove('on'); ctx.onPanel(false); }
  $('trader-close').onclick = () => closeTrader();
  $('trader-list').addEventListener('click', e => { const b = e.target.closest('[data-tbuy]'); if (b && !b.disabled) net.send({ t: 'tbuy', id: b.dataset.tbuy }); });

  /* ---------------------------------------------------------------- per frame */
  function update(dt, time) {
    checkBiome(dt);
    // neerslag
    const want = (weather === 'regen' || weather === 'onweer') && biome !== 'desert' ? 1 : 0;   // in de woestijn valt geen regen
    amount += (want - amount) * Math.min(1, dt * 0.5);
    const cold = G.weather.cold > 0.5;
    rain.visible = amount > 0.02 && !cold; snow.visible = amount > 0.02 && cold;
    if (rain.visible || snow.visible) {
      const n = Math.floor(N * amount * (G.quality === 'laag' ? 0.5 : 1)), cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const fall = cold ? 2.2 : weather === 'onweer' ? 26 : 20;
      for (let i = 0; i < N; i++) {
        const d = drops[i];
        d.y -= fall * d.s * dt; if (cold) { d.x += Math.sin(time * 0.8 + d.ph) * dt * 0.6; }
        if (d.y < 0) { d.y += HGT; d.x = (Math.random() - 0.5) * BOX * 2; d.z = (Math.random() - 0.5) * BOX * 2; }
        let wxp = cx + d.x, wzp = cz + d.z; const wy = cy - 8 + d.y;
        if (cold) { const o = i * 3; if (i < n) { snowPos[o] = wxp; snowPos[o + 1] = wy; snowPos[o + 2] = wzp; } else snowPos[o + 1] = -999; }
        else { const o = i * 6; if (i < n) { rainPos[o] = wxp; rainPos[o + 1] = wy; rainPos[o + 2] = wzp; rainPos[o + 3] = wxp + 0.05; rainPos[o + 4] = wy + 0.7; rainPos[o + 5] = wzp; } else { rainPos[o + 1] = rainPos[o + 4] = -999; } }
      }
      (cold ? snowGeo : rainGeo).attributes.position.needsUpdate = true;
      rain.material.opacity = 0.45 * amount;
    }
    // bliksem
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.t += dt;
      if (b.kind === 'warn') { b.mesh.material.opacity = 0.35 + Math.sin(time * 25) * 0.25; if (b.t >= b.delay) { scene.remove(b.mesh); bolts.splice(i, 1); strike(b.x, b.z); } }
      else { b.mesh.material.opacity = Math.max(0, 1 - b.t / 0.3); if (b.t > 0.3) { scene.remove(b.mesh); bolts.splice(i, 1); } }
    }
    // ruïnes
    for (const o of ruinObjs) {
      if (!o.seen && Math.abs(o.R.x - player.x) < 60 && Math.abs(o.R.z - player.z) < 60) o.seen = true;
      if (o.opening) { o.t += dt; o.chest.pivot.rotation.x = -1.9 * Math.min(1, o.t / 0.8); if (o.t > 1) o.opening = false; }
      if (o.chest.beam.visible) o.chest.beam.scale.x = o.chest.beam.scale.z = 1 + Math.sin(time * (o.st === 'awake' ? 9 : 2)) * 0.15;
    }
    if (traderRig) traderRig.update(dt);
    if (traderOpen && Math.floor(time) !== Math.floor(time - dt)) renderTrader();
  }

  function markers() {
    const out = [];
    for (const o of ruinObjs) if (o.seen) out.push({ x: o.R.x, z: o.R.z, kind: 'ruin' });
    if (trader) out.push({ x: trader.x, z: trader.z, kind: 'trader' });
    return out;
  }
  return {
    update, markers, findRuin, ruinPrompt, nearTrader, openTrader, closeTrader, renderTrader,
    get traderOpen() { return traderOpen; }, get weather() { return weather; }, get biome() { return biome; }, get swampK() { return swampK; },
    ruinObjs,
  };
}
