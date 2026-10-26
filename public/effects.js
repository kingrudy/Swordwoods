// Kortlevende effecten: pijlen van schutters, waarschuwingsringen (wortels van de Woudreus, zandstralen van de farao)
// en zwevende schadegetallen.
import * as THREE from 'three';
import { clamp, fwdOf } from './util.js';

export function createEffects(g) {
  const { scene, M, W, net, player, sfx } = g, { chips, leaves, sparkles, sand } = g.particles;
  const heightAt = W.heightAt;
  const fx = [], popups = [];
  const near = (x, z, d) => Math.hypot(x - player.x, z - player.z) < d;

  function addPopup(x, y, z, text, color) {
    const s = M.makePopup(text, color); s.position.set(x, y, z); scene.add(s); popups.push({ s, t: 0, x, y, z });
  }
  /** Tekst vlak voor je eigen neus (geblokt, ontweken). */
  function popupAhead(text, color, dy) { const f = fwdOf(player.yaw); addPopup(player.x + f.x * 1.6, player.y + dy, player.z + f.z * 1.6, text, color); }

  function warnRings(m, sandblast) {
    const R = sandblast ? 2.8 : 2.4;
    for (const [x, z] of m.pts) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.3, R, 40), M.warnRingMat.clone()); ring.rotation.x = -Math.PI / 2;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 40), M.warnRingMat.clone()); fill.rotation.x = -Math.PI / 2; fill.material.opacity = 0.18;
      if (sandblast) { ring.material.color.set(0xffc35a); fill.material.color.set(0xffc35a); }
      const grp = new THREE.Group(); grp.add(ring, fill); grp.position.set(x, heightAt(x, z) + 0.08, z); scene.add(grp);
      fx.push({ kind: 'warn', mesh: grp, fill, t: 0, delay: m.delay, x, z, sand: sandblast });
    }
    if (m.pts.some(([x, z]) => near(x, z, R + 0.5))) g.ui.toast((sandblast ? '⚠️ Zandstraal' : '⚠️ Wortels') + ' onder je voeten! Rol weg (C / 🌀).', '#ff9a6a');
  }

  net.on('ev', m => {
    switch (m.k) {
      case 'shot': {
        const a = M.makeArrow(), y = heightAt(m.x, m.z) + 1.25; a.position.set(m.x, y, m.z); a.lookAt(m.x + m.vx, y, m.z + m.vz); scene.add(a);
        fx.push({ kind: 'arrow', mesh: a, vx: m.vx, vz: m.vz, life: 1.1 });
        if (near(m.x, m.z, 30)) sfx.arrow();
        break;
      }
      case 'roots': warnRings(m, false); break;
      case 'sandblast': warnRings(m, true); break;
      case 'summon': for (const [x, z] of m.pts) sparkles.emit(x, heightAt(x, z) + 0.5, z, 30, 1.5, 3, 1.2); break;
    }
  });

  function update(dt, time) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      if (f.kind === 'arrow') {
        f.mesh.position.x += f.vx * dt; f.mesh.position.z += f.vz * dt; f.life -= dt;
        if (f.life <= 0 || near(f.mesh.position.x, f.mesh.position.z, 0.6)) { scene.remove(f.mesh); fx.splice(i, 1); }
      } else if (f.kind === 'warn') {
        f.t += dt; const k = Math.min(1, f.t / f.delay);
        f.fill.scale.setScalar(Math.max(0.01, k)); f.mesh.children[0].material.opacity = 0.35 + Math.sin(time * 20) * 0.2;
        if (k < 1) continue;
        scene.remove(f.mesh); fx.splice(i, 1);
        const y = heightAt(f.x, f.z);
        if (f.sand) { sand.emit(f.x, y + 0.3, f.z, 70, 3.5, 9, 1.3); sparkles.emit(f.x, y + 1, f.z, 12, 2, 4, 0.8); }
        else {
          const r = M.makeRoots(); r.position.set(f.x, y - 2.6, f.z); scene.add(r);
          fx.push({ kind: 'roots', mesh: r, t: 0, y0: y });
          chips.emit(f.x, y + 0.3, f.z, 30, 3, 4, 1); leaves.emit(f.x, y + 0.5, f.z, 15, 2, 3, 1);
        }
        if (near(f.x, f.z, 30)) sfx.rumble();
      } else if (f.kind === 'roots') {
        f.t += dt; const up = f.t < 0.18 ? f.t / 0.18 : f.t < 1.4 ? 1 : Math.max(0, 1 - (f.t - 1.4) / 0.6);
        f.mesh.position.y = f.y0 - 2.6 * (1 - up);
        if (f.t > 2.0) { scene.remove(f.mesh); fx.splice(i, 1); }
      }
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.t += dt; p.s.position.y = p.y + p.t * 1.6; p.s.material.opacity = 1 - clamp((p.t - 0.5) / 0.4, 0, 1);
      if (p.t > 0.9) { scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); popups.splice(i, 1); }
    }
  }
  return { fx, addPopup, popupAhead, update };
}
