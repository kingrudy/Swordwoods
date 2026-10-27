// Reisstenen aan de clientkant: de twee stenen tonen (oplichtend zodra je ze geactiveerd hebt), de reis zelf
// (voortgangsbalk, licht) en de aanwijzing voor E. Wat er mag beslist de server (room/travel.js).
import * as THREE from 'three';
import { TRAVEL } from './items.js';

export function createTravel(g) {
  const { scene, W, M, net, player, inv, sfx } = g, { sparkles } = g.particles;
  const stones = {};
  for (const [k, t] of Object.entries(W.travel)) {
    const o = M.buildTravelStone(); o.group.position.set(t.x, t.y - 0.15, t.z); scene.add(o.group);
    stones[k] = { ...o, t, k, charge: 0 };
  }
  for (const t of Object.values(W.travel)) g.G.addLantern(new THREE.Vector3(t.x, t.y + 3, t.z), 0x6fb0ff, 3, 12);

  /** De steen waar je naast staat. */
  function near() {
    for (const s of Object.values(stones)) if (Math.hypot(s.t.x - player.x, s.t.z - player.z) < TRAVEL.range) return s;
    return null;
  }
  function prompt(s, touch) {
    const key = (short, long) => touch ? short + ' (X)' : '<b>E</b> · ' + long;
    if (!inv.travel) return s.k === 'desert' ? key('Reissteen activeren', 'reissteen activeren') + ' · ' + TRAVEL.cost + ' goud' : 'Deze reissteen slaapt nog. Activeer eerst de steen op het Woestijneiland.';
    return key('Reizen', s.k === 'desert' ? 'reizen naar het bos' : 'reizen naar het Woestijneiland');
  }
  net.on('ev', m => {
    switch (m.k) {
      case 'tpwake': sparkles.emit(m.x, W.heightAt(m.x, m.z) + 3, m.z, 80, 2.5, 3, 1.5); sfx.reveal(3); break;
      case 'tpstart': {
        const s = stones[m.from]; if (s) s.charge = m.sec;
        if (m.id === g.myId) g.ui.actionBar('Reizen… blijf staan', m.sec);
        break;
      }
      case 'tpfail': if (m.id === g.myId) { g.ui.actionBar(null); g.ui.toast('Je bewoog of werd geraakt: de reis is afgebroken.', '#bbb'); } for (const s of Object.values(stones)) s.charge = 0; break;
      case 'tp': {
        sparkles.emit(m.fx, W.heightAt(m.fx, m.fz) + 1, m.fz, 60, 2, 3, 1.2); sparkles.emit(m.x, W.heightAt(m.x, m.z) + 1, m.z, 60, 2, 3, 1.2);
        for (const s of Object.values(stones)) s.charge = 0;
        if (m.id === g.myId) { g.ui.actionBar(null); sfx.reveal(2); g.ui.banner(W.travel && Math.abs(m.x - W.travel.desert.x) < 10 ? '🏝️ Woestijneiland' : '🌲 Het bos', 1800); }
        break;
      }
    }
  });
  function update(dt, time) {
    for (const s of Object.values(stones)) {
      const awake = !!inv.travel;
      s.rune.emissiveIntensity = awake ? 0.9 + Math.sin(time * 2.5) * 0.3 + (s.charge > 0 ? 1.5 : 0) : 0.05;
      s.crystal.material.emissiveIntensity = awake ? 0.8 + (s.charge > 0 ? 2 : 0) : 0.15;
      s.crystal.position.y = 3.05 + Math.sin(time * 1.6) * 0.12; s.crystal.rotation.y += dt * (s.charge > 0 ? 6 : 0.8);
      if (s.charge > 0) { s.charge -= dt; if (Math.random() < 0.6) sparkles.emit(s.t.x, s.t.y + 2.5, s.t.z, 2, 1.5, 1, 0.8); }
    }
  }
  const markers = () => Object.values(stones).map(s => ({ x: s.t.x, z: s.t.z, kind: 'travel', awake: !!inv.travel }));
  return { near, prompt, update, markers, act: () => net.send({ t: 'travel' }) };
}
