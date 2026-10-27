// De eigen speler: lopen, springen, varen, rollen, slaan (ook zwaar), blokkeren, de camera en het item in je hand.
// De positie bepaalt de client (15x per seconde naar de server); de server controleert en zet zo nodig terug.
import * as THREE from 'three';
import { WATER, clampXZ } from './world.js';
import { AXE, ROLL_CD } from './items.js';
import { tal } from './progress.js';
import { $, clamp, lerp, ease, fwdOf } from './util.js';

const HEAVY_HOLD = 0.45;   // zo lang vasthouden voor een zware slag
const SLOW_MUL = 0.55;     // ijsstorm van de Sneeuwreus

export function createPlayer(g) {
  const { W, M, net, inv, you, camera, handScene, sfx, keys, virt } = g;
  const heightAt = W.heightAt;
  const player = g.player;
  const items = () => [AXE, ...inv.swords];
  const current = () => items()[inv.equip] || AXE;
  const now = () => performance.now() / 1000;
  const rooted = () => now() < (player.rootUntil || 0);

  /* ---------------------------------------------------------------- item en schild in de hand */
  const hand = new THREE.Group(); hand.scale.setScalar(0.5); handScene.add(hand);
  const shieldHand = new THREE.Group(); shieldHand.scale.setScalar(0.55); shieldHand.visible = false; shieldHand.userData.lvl = -1; handScene.add(shieldHand);
  let heldMesh = null, heldKey = '', blockT = 0;
  function rebuildHeld() {
    const it = current(), key = g.fishing ? 'rod' : it.type === 'axe' ? 'axe' : it.rarity + ':' + it.base;
    if (key === heldKey && heldMesh) return; heldKey = key;
    if (heldMesh) hand.remove(heldMesh);
    heldMesh = g.fishing ? M.makeRodMesh() : it.type === 'axe' ? M.makeAxeMesh() : M.makeSwordMesh(it);
    heldMesh.traverse(o => { o.castShadow = false; }); hand.add(heldMesh);
  }
  function equipSlot(i) {
    if (i < 0 || i > inv.swords.length) return;
    inv.equip = i; g.ui.renderInv(); rebuildHeld(); net.send({ t: 'equip', i });
  }
  const cycleWeapon = d => { const n = items().length; if (n > 1) equipSlot((inv.equip + d + n) % n); };

  /* ---------------------------------------------------------------- slaan, zware slag, blokkeren, rollen */
  const swing = { t: 1, cd: 0, heavy: false };
  const charge = { start: null };
  let blocking = false, rollReadyAt = 0;
  function startSwing(heavy = false) {
    if (g.bs && g.bs.active && !g.dead && !g.shopOpen) { g.bs.place(); return; }
    if (g.dead || g.shopOpen || g.fishing || blocking || player.roll || player.sailing || swing.t < 1 || swing.cd > 0) return;
    const it = current();
    swing.t = 0; swing.heavy = heavy; swing.cd = 0.5 / (it.speed || 1) * 0.92 * (heavy ? 1.5 : 1);
    if (heavy) { sfx.heavy(); g.shake = Math.max(g.shake, 0.12); } else sfx.swing();
    net.send(heavy ? { t: 'swing', heavy: true } : { t: 'swing' });
  }
  function beginCharge(ts = performance.now()) {
    if (g.bs && g.bs.active) { if (!g.dead && !g.shopOpen) g.bs.place(); return; }
    if (g.dead || g.shopOpen || g.fishing || blocking) return;
    charge.start = ts;
  }
  function releaseCharge(ts = performance.now()) {          // tijdstempels van de invoer zelf: niet afhankelijk van een drukke hoofdthread
    if (charge.start === null) return;
    const held = (ts - charge.start) / 1000; charge.start = null;
    startSwing(held >= HEAVY_HOLD);
  }
  const cancelCharge = () => { charge.start = null; };
  const chargeLevel = () => charge.start === null ? 0 : clamp((performance.now() - charge.start) / 1000 / HEAVY_HOLD, 0, 1);
  function setBlock(on) {
    if (on && (g.dead || g.shopOpen || (g.bs && g.bs.active) || g.fishing)) return;
    if (on === blocking) return;
    blocking = on; charge.start = null; net.send({ t: 'block', on });
  }
  /** Richting uit toetsen, stick en controller: [vooruit, rechts]. */
  const inputDir = () => [
    (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - virt.y - virt.py,   // joystick omhoog = vooruit
    (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + virt.x + virt.px,
  ];
  function doRoll() {
    if (g.dead || g.shopOpen || player.roll || player.sailing || now() < rollReadyAt || rooted() || !g.locked) return;
    rollReadyAt = now() + ROLL_CD - 0.1 * tal(inv, 'vlug');
    const f = fwdOf(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw), [iz, ix] = inputDir();
    let dx = f.x * iz + rx * ix, dz = f.z * iz + rz * ix, l = Math.hypot(dx, dz);
    if (l < 0.2) { dx = -f.x; dz = -f.z; l = 1; }              // geen richting: achteruit rollen
    player.roll = { t: 0, dx: dx / l, dz: dz / l };
    if (blocking) setBlock(false);
    net.send({ t: 'roll' }); sfx.roll();
  }

  /* ---------------------------------------------------------------- berichten van de server */
  net.on('correct', m => { player.x = m.x; player.y = m.y; player.z = m.z; player.vx = player.vz = player.vy = 0; });
  net.on('slowed', m => { const was = now() < (player.slowUntil || 0); player.slowUntil = now() + m.s; if (!was) g.ui.toast('❄️ Bevroren: je bent even trager.', '#9adcff'); });
  net.on('rooted', m => { player.rootUntil = now() + m.s; player.roll = null; g.shake = Math.max(g.shake, 0.3); g.ui.toast('🌿 Vastgegroeid door wortels!', '#9adf6a'); });
  net.on('hurt', () => { $('vignette').classList.add('on'); setTimeout(() => $('vignette').classList.remove('on'), 90); g.shake = 0.35; sfx.hurt(); });
  net.on('dead', m => {
    g.dead = true; g.deadHelp = !!m.help; g.deadNote = null; blocking = false; charge.start = null; player.roll = null; $('dead').classList.add('on');
    $('dead-sub').textContent = 'Terug in het spel over ' + m.in + ' s' + (m.help ? ' · een medespeler kan je opknappen' : '');
  });
  net.on('respawn', m => {
    g.dead = false; $('dead').classList.remove('on');
    player.x = m.x; player.z = m.z; player.y = heightAt(m.x, m.z); player.vx = player.vz = player.vy = 0; player.onGround = true;
    g.ui.toast('Je bent terug in het spel.' + (m.lost ? ' Je bent ' + m.lost + ' hout kwijt.' : ''), '#6fd37a');
  });
  net.on('revived', m => {          // opgeknapt: op dezelfde plek verder, zonder houtverlies
    g.dead = false; $('dead').classList.remove('on'); g.ui.actionBar(null);
    player.vx = player.vz = player.vy = 0; player.onGround = true;
    g.ui.toast('❤️ ' + m.by + ' heeft je opgeknapt!', '#6fd37a'); sfx.happy();
  });
  net.on('ev', m => {
    if (m.k === 'revstart') {
      if (m.by === g.myId) g.ui.actionBar('Opknappen… blijf staan', m.dur);
      if (m.id === g.myId) $('dead-sub').textContent = g.deadNote = (g.names.get(m.by) || 'Iemand') + ' knapt je op…';
    } else if (m.k === 'revfail') {
      if (m.by === g.myId) { g.ui.actionBar(null); g.ui.toast('Te ver weg: het opknappen is gestopt.', '#bbb'); }
      if (m.id === g.myId) g.deadNote = null;
    } else if (m.k === 'revived') {
      if (m.by === g.myId) g.ui.actionBar(null);
      g.particles.sparkles.emit(m.x, heightAt(m.x, m.z) + 1, m.z, 50, 1.5, 3, 1.3);
    }
  });

  /* ---------------------------------------------------------------- per beeld */
  function move(dt) {
    const f = fwdOf(player.yaw), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw), [iz, ix] = inputDir();
    let wx = f.x * iz + rx * ix, wz = f.z * iz + rz * ix;
    let wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
    const run = keys.ShiftLeft || keys.ShiftRight || virt.sprint || virt.toggle || virt.psprint;
    const sail = !!player.sailing;
    const sp = rooted() ? 0 : sail ? 10.5 * wl : (run && !blocking ? 9 : 5.4) * wl * (blocking ? 0.45 : 1) * (1 + 0.04 * tal(inv, 'vlug')) * g.wfx.swampK * (you.bf && you.bf.haste ? 1.2 : 1) * (now() < (player.slowUntil || 0) ? SLOW_MUL : 1);
    const k = Math.min(1, dt * (player.onGround ? 11 : 2.5));
    if (player.roll) {
      const R = player.roll; R.t += dt; const v = 15 * (1 - 0.45 * R.t / 0.38);
      player.vx = R.dx * v; player.vz = R.dz * v;
      if (R.t >= 0.38) { player.roll = null; player.vx *= 0.4; player.vz *= 0.4; }
    } else { const kk = sail ? Math.min(1, dt * 1.5) : k; player.vx += (wx * sp - player.vx) * kk; player.vz += (wz * sp - player.vz) * kk; }
    let nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
    const blocked = sail ? (x, z) => heightAt(x, z) > WATER - 0.45 : (x, z) => heightAt(x, z) < WATER - 0.35;   // varen: land houdt je tegen
    if (blocked(nx, player.z)) { nx = player.x; if (sail) player.vx *= -0.2; } if (blocked(nx, nz)) { nz = player.z; if (sail) player.vz *= -0.2; }
    [nx, nz] = clampXZ(nx, nz);
    if (!sail) {
      const trees = g.scenery.treeObjs;
      W.gNear(nx, nz, o => {
        if (o.type && trees[o.idx].felled) return;
        const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz), min = o.r + 0.38;
        if (d < min && d > 0.0001) { nx = o.x + dx / d * min; nz = o.z + dz / d * min; }
      });
      [nx, nz] = g.bs.collide(nx, nz, 0.38);
    }
    player.x = nx; player.z = nz;
    const gnd = sail ? WATER + 0.12 : heightAt(player.x, player.z);
    if (sail) { player.onGround = true; player.vy = 0; }
    if (player.onGround) {
      if (gnd < player.y - 0.7) player.onGround = false;
      else { player.y = gnd; if (!sail && (keys.Space || virt.jump || virt.pjump)) { player.vy = 7.6; player.onGround = false; } }
    }
    if (!player.onGround) { player.vy -= 22 * dt; player.y += player.vy * dt; if (player.y <= gnd && player.vy <= 0) { player.y = gnd; player.vy = 0; player.onGround = true; } }
    player.bob += Math.hypot(player.vx, player.vz) * dt * 1.7;
  }

  let sendT = 0;
  function update(dt, time) {
    if (g.locked && !g.dead && !g.shopOpen && !g.hud.chatOpen) move(dt);
    const speed = Math.hypot(player.vx, player.vz);
    const bobY = player.onGround ? Math.sin(player.bob * 2) * 0.045 * Math.min(1, speed / 5) : 0;
    g.shake = Math.max(0, g.shake - dt);
    const eye = g.dead ? 0.4 : player.sailing ? 1.25 : 1.7 - (player.roll ? Math.sin(Math.min(1, player.roll.t / 0.38) * Math.PI) * 0.75 : 0) - (blocking ? 0.08 : 0);
    camera.position.set(player.x + (Math.random() - 0.5) * g.shake * 0.2, player.y + eye + bobY, player.z + (Math.random() - 0.5) * g.shake * 0.2);
    camera.rotation.y = player.yaw; camera.rotation.x = g.dead ? -0.9 : player.pitch;
    g.G.update(dt, time, player.x, player.y, player.z);

    // positie naar de server (15x per seconde)
    sendT += dt;
    if (sendT >= 1 / 15) { sendT = 0; if (!g.dead) net.send({ t: 'in', x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3) }); }

    // zwaai-animatie van de eigen hand
    const it = current();
    swing.cd = Math.max(0, swing.cd - dt);
    if (swing.t < 1) swing.t = Math.min(1, swing.t + dt * (it.speed || 1) / (swing.heavy ? 0.75 : 0.5));
    const t = swing.t, H = swing.heavy && t < 1 ? 1.6 : 1; let off = 0, thrust = 0;
    if (t < 1) {
      if (t < 0.2) off = lerp(0, 0.4 * H, ease(t / 0.2));
      else if (t < 0.45) { const u = ease((t - 0.2) / 0.25); off = lerp(0.4 * H, -1.25 * H, u); thrust = u; }
      else { off = lerp(-1.25 * H, 0, ease((t - 0.45) / 0.55)); thrust = 1 - ease((t - 0.45) / 0.55); }
    }
    const chg = chargeLevel();
    if (chg) off += 0.55 * ease(chg) + (chg >= 1 ? Math.sin(time * 40) * 0.015 : 0);       // opladen: bijl naar achteren
    blockT = clamp(blockT + (blocking ? dt : -dt) * 7, 0, 1);
    const sway = Math.sin(player.bob * 2) * 0.012 * Math.min(1, speed / 5);
    hand.position.set(0.34 + sway + blockT * 0.12, -0.3 + Math.abs(sway) - thrust * 0.05 - blockT * 0.22, -0.55 - thrust * 0.1);
    hand.rotation.set(-0.35 + off - blockT * 0.3, -0.25 * thrust * H, 0.32 - thrust * 0.5 * H + (it.type === 'sword' ? 0.1 : 0));
    hand.visible = !g.dead;
    shieldHand.visible = blockT > 0.01 && !g.dead;
    if (shieldHand.visible) { const e2 = ease(blockT); shieldHand.position.set(lerp(-0.75, -0.2, e2), lerp(-0.9, -0.28, e2), -0.62); shieldHand.rotation.set(0, lerp(0.9, 0.25, e2), 0); }
    if (shieldHand.userData.lvl !== inv.up.shield) { shieldHand.userData.lvl = inv.up.shield; shieldHand.clear(); shieldHand.add(M.makeShieldMesh(inv.up.shield)); }

    // kruisje groeit tijdens het opladen
    const cr = $('cross'); cr.style.transform = chg ? 'scale(' + (1 + chg * 2.2).toFixed(2) + ')' : ''; cr.classList.toggle('full', chg >= 1);
    if (g.isTouch && Math.floor(time * 4) !== Math.floor((time - dt) * 4)) $('tb-roll').classList.toggle('cd', now() < rollReadyAt);
  }

  return {
    update, items, current, rebuildHeld, equipSlot, cycleWeapon, startSwing, beginCharge, releaseCharge, cancelCharge, chargeLevel, setBlock, doRoll, rooted,
    resetSwing() { swing.t = 1; },
    get blocking() { return blocking; }, get swingT() { return swing.t; },
  };
}
