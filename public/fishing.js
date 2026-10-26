// Vissen aan de clientkant: waterkant zoeken, de dobber van iedereen, een beet melden en binnenhalen.
// De server bepaalt wanneer een vis bijt; g.fishing is je eigen hengel in het water ({ x, z, bite }).
import { WATER } from './world.js';
import { fwdOf } from './util.js';

export function createFishing(g) {
  const { scene, M, W, net, player, sfx } = g, { splash, sparkles } = g.particles;
  const bobbers = new Map();
  let lastWater = null, lastCheck = -1;

  /** Diep water recht voor je, tussen 2,5 en 6,5 m. */
  function findWater() {
    const f = fwdOf(player.yaw);
    for (let d = 2.5; d <= 6.5; d += 0.5) {
      const x = player.x + f.x * d, z = player.z + f.z * d;
      if (W.heightAt(x, z) < WATER - 0.25) return { x, z };
    }
    return null;
  }
  /** Zelfde als findWater, maar hooguit 4x per seconde echt gezocht (wordt elk beeld gevraagd voor de aanwijzing). */
  function waterAhead(time) {
    const q = Math.floor(time * 4); if (q !== lastCheck) { lastCheck = q; lastWater = findWater(); }
    return lastWater;
  }
  const cast = w => net.send({ t: 'cast', x: +w.x.toFixed(2), z: +w.z.toFixed(2) });
  const reel = () => net.send({ t: 'reel' });

  net.on('ev', m => {
    switch (m.k) {
      case 'cast': {
        const b = M.makeBobber(); b.position.set(m.x, WATER, m.z); scene.add(b);
        const old = bobbers.get(m.id); if (old) scene.remove(old.mesh);
        bobbers.set(m.id, { mesh: b, x: m.x, z: m.z, dip: 0, t: 0 });
        if (m.id === g.myId) { g.fishing = { x: m.x, z: m.z, bite: false }; g.pl.rebuildHeld(); sfx.plop(); }
        splash.emit(m.x, WATER + 0.05, m.z, 10, 1.2, 1.8, 0.5);
        break;
      }
      case 'bite': {
        if (g.fishing) g.fishing.bite = true;
        const b = bobbers.get(g.myId); if (b) b.dip = 1.6;
        sfx.bite(); if (navigator.vibrate) try { navigator.vibrate([60, 40, 60]); } catch {}
        break;
      }
      case 'bob': { const b = bobbers.get(m.id); if (b) b.dip = 1.6; break; }
      case 'caught': {
        const f = g.fishing;
        if (f) { splash.emit(f.x, WATER + 0.1, f.z, m.gold ? 40 : 22, 2, 3.2, 0.8); if (m.gold) sparkles.emit(f.x, WATER + 0.5, f.z, 30, 1.2, 2.5, 1.2); }
        sfx.catch(m.gold);
        break;
      }
      case 'fishend': {
        const b = bobbers.get(m.id); if (b) { scene.remove(b.mesh); bobbers.delete(m.id); }
        if (m.id === g.myId) { g.fishing = null; g.pl.rebuildHeld(); }
        break;
      }
    }
  });

  function update(dt, time) {
    for (const b of bobbers.values()) {
      b.t += dt; if (b.dip > 0) b.dip = Math.max(0, b.dip - dt);
      const dip = b.dip > 0 ? -0.12 - Math.abs(Math.sin(b.t * 22)) * 0.1 : 0;
      b.mesh.position.y = WATER + Math.sin(time * 0.6) * 0.06 + Math.sin(b.t * 2.4) * 0.025 + dip;
      const r = b.mesh.userData.ring; r.scale.setScalar(1 + (b.t * 0.8 % 1) * 2); r.material.opacity = 0.5 * (1 - (b.t * 0.8 % 1));
      if (b.dip > 0 && Math.random() < 0.3) splash.emit(b.x, WATER + 0.05, b.z, 2, 0.8, 1.2, 0.4);
    }
  }
  return { bobbers, findWater, waterAhead, cast, reel, update };
}
