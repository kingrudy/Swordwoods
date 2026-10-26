// Het bos-eiland: terrein, gras en rotsen, wolken, bomen (omhakken en teruggroeien), kisten, de winkel van Bram,
// de smidse en ertsaders. Alles wat hier staat is vast decor; wat het doet bepaalt de server.
import * as THREE from 'three';
import { WORLD, MAP, WATER, mulberry32 } from './world.js';
import { lerp, sstep, ease, nextFrame, inFront } from './util.js';

export async function createScenery(g) {
  const { scene, W, G, M, net, player, sfx, tone, joined } = g, { chips, leaves, sparkles } = g.particles;
  const { heightAt, slopeAt, vnoise } = W, rng = mulberry32(W.seed * 3 + 1);

  /* ---------------------------------------------------------------- terrein */
  const SEG = 240;
  const tGeo = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG); tGeo.rotateX(-Math.PI / 2);
  {
    const pos = tGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
    tGeo.computeVertexNormals();
    const nor = tGeo.attributes.normal, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i), ny = nor.getY(i);
      const n = vnoise(x * 0.15, z * 0.15) * 0.5 + vnoise(x * 0.7, z * 0.7) * 0.5;
      const grass = [0.17 + 0.09 * n, 0.40 + 0.13 * n, 0.11 + 0.05 * n], dry = [0.33, 0.40, 0.17];
      const sand = [0.55 + 0.08 * n, 0.48 + 0.07 * n, 0.30 + 0.05 * n], rock = [0.36 + 0.1 * n, 0.34 + 0.09 * n, 0.31 + 0.08 * n];
      let c = grass.map((v, k) => lerp(v, dry[k], sstep(5, 13, h) * 0.6));
      c = c.map((v, k) => lerp(v, sand[k], 1 - sstep(0.2, 1.1, h)));
      const bw = W.biomeW(x, z), land = sstep(0.4, 1.4, h);
      if (bw.dark > 0) c = c.map((v, k) => lerp(v, [0.08 + 0.04 * n, 0.19 + 0.06 * n, 0.08 + 0.03 * n][k], bw.dark * land));
      if (bw.swamp > 0) c = c.map((v, k) => lerp(v, [0.23 + 0.06 * n, 0.25 + 0.06 * n, 0.12 + 0.03 * n][k], bw.swamp * land));
      const rockT = Math.max(sstep(0.9, 0.7, ny), sstep(13, 17, h));
      c = c.map((v, k) => lerp(v, rock[k], rockT));
      if (bw.snow > 0) c = c.map((v, k) => lerp(v, [0.86 + 0.06 * n, 0.89 + 0.05 * n, 0.93 + 0.04 * n][k], bw.snow * land * (1 - rockT * 0.6)));
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  G.terrainDetail(terrain.material);
  terrain.receiveShadow = true; scene.add(terrain);
  { const half = (MAP.x1 - MAP.x0) / 2; G.createWater({ heightAt, WORLD, WATER, bounds: { x0: MAP.x0, x1: MAP.x1, z0: -half, z1: half } }); }
  await nextFrame();

  /* ---------------------------------------------------------------- gras, bloemen, rotsen en wolken (alleen sfeer) */
  {
    const dummy = new THREE.Object3D(), c = new THREE.Color();
    const TUFT_N = 14000, FLOW_N = 1400;   // dichtheid volgt de kwaliteitsinstelling
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.55, 5, 1).translate(0, 0.27, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), TUFT_N);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5).translate(0, 0.42, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), FLOW_N);
    let nt = 0, nf = 0;
    for (let tries = 0; tries < 60000 && (nt < TUFT_N || nf < FLOW_N); tries++) {
      const x = (rng() - 0.5) * (WORLD - 20), z = (rng() - 0.5) * (WORLD - 20), h = heightAt(x, z);
      if (h < 0.7 || h > 12 || slopeAt(x, z) > 0.6 || Math.hypot(x - W.shop.x, z - W.shop.z) < 3.6 || Math.hypot(x - W.smith.x, z - W.smith.z) < 3.2) continue;
      if (W.biomeW(x, z).snow > 0.55 && rng() < 0.85) continue;
      dummy.position.set(x, h - 0.03, z); dummy.rotation.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4);
      const s = 0.45 + rng() * 0.6; dummy.scale.set(s, s * (0.8 + rng() * 0.7), s); dummy.updateMatrix();
      if (nf < FLOW_N && rng() < 0.1) { flowers.setMatrixAt(nf, dummy.matrix); c.setHSL([0.0, 0.12, 0.62, 0.86, 0.15][Math.floor(rng() * 5)], 0.75, 0.62); flowers.setColorAt(nf, c); nf++; }
      else if (nt < TUFT_N) { tufts.setMatrixAt(nt, dummy.matrix); c.setHSL(0.24 + rng() * 0.06, 0.55, 0.22 + rng() * 0.12); tufts.setColorAt(nt, c); nt++; }
    }
    tufts.frustumCulled = false; flowers.frustumCulled = false; scene.add(tufts, flowers);
    G.wind(tufts.material, 'grass'); G.wind(flowers.material, 'grass'); G.registerGrass(tufts, nt); G.registerGrass(flowers, nf);

    const rocks = new THREE.InstancedMesh(M.makeBlobGeo(1, 0.38, 3.3, 0.7, [9, 7]), new THREE.MeshStandardMaterial({ color: 0x777268, roughness: 0.95 }), 260);
    let n = 0;
    for (let tries = 0; tries < 6000 && n < 260; tries++) {
      const x = (rng() - 0.5) * (WORLD - 30), z = (rng() - 0.5) * (WORLD - 30), h = heightAt(x, z);
      if (h < -0.3 || Math.hypot(x, z) < 8 || Math.hypot(x - W.shop.x, z - W.shop.z) < 7) continue;
      dummy.position.set(x, h + 0.05, z); dummy.rotation.set(rng() * 0.6, rng() * 6.28, rng() * 0.6);
      const s = 0.4 + Math.pow(rng(), 2.5) * 2.6; dummy.scale.set(s * (0.8 + rng() * 0.6), s * 0.8, s * (0.8 + rng() * 0.6)); dummy.updateMatrix();
      rocks.setMatrixAt(n++, dummy.matrix);
    }
    rocks.count = n; rocks.castShadow = true; rocks.receiveShadow = true; rocks.frustumCulled = false; scene.add(rocks);
  }
  const clouds = [];
  for (let i = 0; i < 22; i++) {
    const cg = new THREE.Group(), parts = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < parts; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), G.cloudMat), s = 9 + rng() * 12;
      m.scale.set(s * 1.3, s * 0.55, s); m.position.set((k - parts / 2) * 11 + rng() * 6, rng() * 3, (rng() - 0.5) * 12); cg.add(m);
    }
    cg.position.set((rng() - 0.5) * 900, 110 + rng() * 40, (rng() - 0.5) * 900); scene.add(cg); clouds.push(cg);
  }
  await nextFrame();

  /* ---------------------------------------------------------------- bomen */
  const kit = M.makeTreeKit(W.seed);
  for (const fm of M.getFoliageMats()) G.wind(fm, 'leaf');
  const treeObjs = W.trees.map(t => {
    const o = M.buildTree(kit, t.type, t.vi, t.scale, t.rotY, t.biome);
    o.group.position.set(t.x, t.y - 0.1, t.z); scene.add(o.group);
    return { t, ...o, felled: false, fall: null, shake: 0, stump: null };
  });
  function addStump(o) { o.stump = M.buildStump(o.t.scale); o.stump.position.set(o.t.x, o.t.y - 0.1, o.t.z); scene.add(o.stump); }
  function fellInstant(i) {
    const o = treeObjs[i]; if (!o || o.felled) return;
    o.felled = true; o.group.visible = false; addStump(o);
  }
  function fellAnimated(i, dx, dz) {
    const o = treeObjs[i]; if (!o || o.felled || o.fall) return;
    o.fall = { t: 0, dx, dz, landed: false, wait: 0 }; addStump(o);
    leaves.emit(o.t.x, o.t.y + o.height * 0.7, o.t.z, 40, 3.5, 2, 2.2); sfx.fall();
  }
  function treeBack(i) {
    const o = treeObjs[i]; if (!o) return;
    if (o.stump) { scene.remove(o.stump); o.stump = null; }
    o.felled = false; o.fall = null; o.group.quaternion.identity(); o.group.rotation.set(0, o.t.rotY, 0); o.group.visible = true;
    if (!o.group.parent) scene.add(o.group);
  }
  for (const i of joined.felled) fellInstant(i);

  /* ---------------------------------------------------------------- kisten (met zwaard dat omhoog zweeft) */
  const chestObjs = W.chests.map(c => {
    const o = M.buildChest(); o.group.position.set(c.x, c.y - 0.03, c.z); o.group.rotation.y = c.rotY; scene.add(o.group);
    return { c, ...o, opened: false, opening: false, t: 0 };
  });
  const chestOpenInstant = i => { const o = chestObjs[i]; if (!o) return; o.opened = true; o.pivot.rotation.x = o.openAngle || -1.9; o.beam.visible = false; };
  const chestReset = i => { const o = chestObjs[i]; if (!o) return; o.opened = false; o.opening = false; o.pivot.rotation.x = 0; o.beam.visible = true; };
  for (const i of joined.chests) chestOpenInstant(i);
  function upgradeChests() {        // het echte kistmodel, zodra het geladen is
    const t = g.CH.template('chest'); if (!t) return;
    for (const o of chestObjs) {
      if (o.upgraded) continue; o.upgraded = true;
      for (const ch of [...o.group.children]) if (ch !== o.beam) o.group.remove(ch);
      const m = t.scene.clone(true); m.traverse(x => { if (x.isMesh) { x.castShadow = true; x.receiveShadow = true; x.material.side = THREE.DoubleSide; } });
      o.group.add(m);
      const lid = m.getObjectByName('lidPivot');
      if (lid) { o.pivot = lid; o.openAngle = -1.75; if (o.opened && !o.opening) lid.rotation.x = o.openAngle; }
    }
  }
  function findChest() {
    let best = null, bd = 1e9;
    for (const o of chestObjs) {
      if (o.opened) continue;
      const d = inFront(player.x, player.z, player.yaw, o.c.x, o.c.z, 3.3, 0.35);
      if (d >= 0 && d < bd) { bd = d; best = o; }
    }
    return best;
  }
  let pendingReveal = null;   // de kist die jij net opende: het zwaard eruit laten zweven
  const floaters = [];
  function revealSword(sw) {
    const co = pendingReveal != null ? chestObjs[pendingReveal] : null; pendingReveal = null;
    if (!co) return;
    const mesh = M.makeSwordMesh(sw); mesh.scale.setScalar(1.6); mesh.position.set(co.c.x, co.c.y + 0.8, co.c.z); scene.add(mesh);
    floaters.push({ mesh, t: 0, life: 2.6, x: co.c.x, y: co.c.y, z: co.c.z });
  }

  /* ---------------------------------------------------------------- winkel, smidse en ertsaders */
  const shopObj = M.buildShop();
  shopObj.group.position.set(W.shop.x, W.shop.y - 0.05, W.shop.z); shopObj.group.rotation.y = W.shop.rotY; scene.add(shopObj.group);
  shopObj.group.updateMatrixWorld(true);
  G.addLantern(shopObj.group.localToWorld(new THREE.Vector3(0, 2.4, 2.4)), 0xffc070, 6, 18);
  const smithObj = M.buildSmithy();
  smithObj.group.position.set(W.smith.x, W.smith.y - 0.05, W.smith.z); smithObj.group.rotation.y = W.smith.rotY; scene.add(smithObj.group);
  smithObj.group.updateMatrixWorld(true);
  const anvilPos = smithObj.group.localToWorld(smithObj.anvil.clone()), forgePos = smithObj.group.localToWorld(smithObj.forge.clone());
  G.addLantern(forgePos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff7a2a, 5, 14);
  const nearShop = () => inFront(player.x, player.z, player.yaw, W.shop.x, W.shop.z, 5.6, 0.15) >= 0;
  const nearSmith = () => inFront(player.x, player.z, player.yaw, W.smith.x, W.smith.z, 5.2, 0.1) >= 0;
  const oreObjs = W.ores.map(o => {
    const r = M.buildOreRock(o.scale, o.rich, o.idx + 1); r.group.position.set(o.x, o.y - 0.15, o.z); r.group.rotation.y = o.rotY; scene.add(r.group);
    return { o, ...r, empty: false, shake: 0 };
  });
  const setOre = (i, empty) => { const r = oreObjs[i]; if (r) { r.empty = empty; r.veins.visible = !empty; } };
  for (const i of joined.ores || []) setOre(i, true);
  await nextFrame();

  // Bram en Gerrit worden geanimeerde figuren zodra die geladen zijn
  let merchant = null, smithRig = null, smithHammerT = 3;
  function npcRig(obj, name, height) {
    const r = g.CH.createRig(name, height); if (!r) return null;
    obj.npc.group.visible = false; r.group.position.copy(obj.npc.group.position); r.group.rotation.y = obj.npc.group.rotation.y; obj.group.add(r.group); r.loop('Idle');
    return r;
  }
  function onRigReady(name) {
    if (name === 'chest') upgradeChests();
    if (name === 'barbarian' && !smithRig) smithRig = npcRig(smithObj, 'barbarian', 1.95);
    if (name === 'merchant' && !merchant) merchant = npcRig(shopObj, 'merchant', 1.8);
  }

  /* ---------------------------------------------------------------- berichten van de server */
  net.on('ev', m => {
    switch (m.k) {
      case 'chop': {
        const o = treeObjs[m.i]; if (!o) break;
        o.shake = 0.5; chips.emit(o.t.x, o.t.y + 1.1, o.t.z, 10, 2.6, 3.2, 0.7); leaves.emit(o.t.x, o.t.y + o.height * 0.8, o.t.z, 8, 2.4, 1.5, 1.4);
        if (Math.hypot(o.t.x - player.x, o.t.z - player.z) < 30) sfx.chop();
        break;
      }
      case 'felled': fellAnimated(m.i, m.dx, m.dz); break;
      case 'treeBack': treeBack(m.i); break;
      case 'chest': { const o = chestObjs[m.i]; if (!o || o.opened) break; o.opened = true; o.opening = true; o.t = 0; o.beam.visible = false; sfx.creak(); if (m.by === g.myId) pendingReveal = m.i; break; }
      case 'chestBack': chestReset(m.i); break;
      case 'bought': sfx.coin(); if (merchant) merchant.once('Cheer'); break;
      case 'mine': {
        const r = oreObjs[m.i]; if (!r) break;
        r.shake = 0.25; chips.emit(r.o.x, r.o.y + 0.8, r.o.z, 10, 2.5, 2.5, 0.6); sparkles.emit(r.o.x, r.o.y + 0.9, r.o.z, 4, 2, 2, 0.4);
        if (Math.hypot(r.o.x - player.x, r.o.z - player.z) < 25) tone(1600 + Math.random() * 300, 0.09, 'triangle', 0.05);
        break;
      }
      case 'oreGone': setOre(m.i, true); break;
      case 'oreBack': setOre(m.i, false); break;
      case 'forged': sparkles.emit(anvilPos.x, anvilPos.y + 0.2, anvilPos.z, 40, 3, 3, 0.8); sfx.clang(); setTimeout(() => sfx.clang(), 180); break;
    }
  });
  net.on('loot', m => { if (m.sword && m.src === 'chest') revealSword(m.sword); pendingReveal = null; });

  /* ---------------------------------------------------------------- per beeld */
  const axis = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  function update(dt, time) {
    for (const o of treeObjs) {
      if (o.felled) continue;
      if (o.fall) {
        const f = o.fall;
        if (!f.landed) {
          f.t += dt / 1.3; const a = Math.pow(Math.min(1, f.t), 2.2) * (Math.PI / 2 * 0.985);
          o.group.quaternion.copy(qa.setFromAxisAngle(axis.set(f.dz, 0, -f.dx), a)).multiply(qb.setFromAxisAngle(up, o.t.rotY));
          if (f.t >= 1) { f.landed = true; chips.emit(o.t.x + f.dx * 3, o.t.y + 0.4, o.t.z + f.dz * 3, 30, 4, 2, 1); leaves.emit(o.t.x + f.dx * 3, o.t.y + 0.6, o.t.z + f.dz * 3, 20, 3, 1.5, 1.5); }
        } else { f.wait += dt; if (f.wait > 1.4) { scene.remove(o.group); o.felled = true; o.group.visible = false; } }
      } else if (o.shake > 0) {
        o.shake = Math.max(0, o.shake - dt); const s = Math.sin(time * 42) * o.shake * 0.05; o.group.rotation.x = s; o.group.rotation.z = -s * 0.7;
      }
    }
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) for (const o of treeObjs) if (!o.felled && !o.fall) o.group.visible = Math.hypot(o.t.x - player.x, o.t.z - player.z) < 250;
    for (const r of oreObjs) if (r.shake > 0) { r.shake = Math.max(0, r.shake - dt); r.group.position.x = r.o.x + Math.sin(time * 60) * r.shake * 0.12; }
    for (const o of chestObjs) {
      if (o.opening) { o.t += dt; o.pivot.rotation.x = ease(Math.min(1, o.t / 0.7)) * (o.openAngle || -1.9); if (o.t > 1) o.opening = false; }
      else if (!o.opened && o.beam.visible) o.beam.scale.x = o.beam.scale.z = 1 + Math.sin(time * 2 + o.c.idx) * 0.12;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const e = floaters[i]; e.t += dt;
      e.mesh.position.y = e.y + 0.8 + ease(Math.min(1, e.t / 1.2)) * 1.2 + Math.sin(e.t * 3) * 0.05; e.mesh.rotation.y += dt * 2.6; e.mesh.rotation.z = 0.25;
      if (e.t > e.life - 0.5) e.mesh.scale.setScalar(Math.max(0.001, (e.life - e.t) / 0.5 * 1.6));
      if (Math.random() < 0.5) sparkles.emit(e.x, e.mesh.position.y, e.z, 1, 0.6, 0.4, 1);
      if (e.t > e.life) { scene.remove(e.mesh); floaters.splice(i, 1); }
    }
    if (merchant) merchant.update(dt);
    if (smithRig && Math.hypot(W.smith.x - player.x, W.smith.z - player.z) < 60) {      // de smid slaat af en toe op het aambeeld
      smithHammerT -= dt;
      if (smithHammerT <= 0) {
        smithHammerT = 2.5 + Math.random() * 3; smithRig.once('1H_Melee_Attack_Chop', { speed: 0.9 });
        setTimeout(() => { sparkles.emit(anvilPos.x, anvilPos.y + 0.1, anvilPos.z, 12, 2, 2.5, 0.5); if (Math.hypot(W.smith.x - player.x, W.smith.z - player.z) < 25) tone(1900, 0.12, 'square', 0.025, -400); }, 420);
      }
      smithRig.update(dt);
    }
    for (const c of clouds) { c.position.x += dt * 2.2; if (c.position.x > 480) c.position.x = -480; }
  }
  /** Ertsaders voor de kaart: alleen wat je gezien hebt (of wat je hond vond). */
  function markers() {
    const out = [{ x: W.smith.x, z: W.smith.z, kind: 'smith' }];
    for (const r of oreObjs) if (!r.empty && (r.seen || (r.seen = Math.abs(r.o.x - player.x) < 40 && Math.abs(r.o.z - player.z) < 40))) out.push({ x: r.o.x, z: r.o.z, kind: 'ore' });
    return out;
  }
  return {
    treeObjs, chestObjs, oreObjs, findChest, nearShop, nearSmith, onRigReady, update, markers,
    get merchant() { return merchant; },
  };
}
