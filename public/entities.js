// Alles wat beweegt en van de server komt: andere spelers, monsters, dieren en honden.
// Zelfgebouwde figuren worden vervangen door geanimeerde 3D-figuren zodra die geladen zijn.
import * as THREE from 'three';
import { MONSTERS, DOG_FURS, DOG_BREEDS, decodeEq } from './items.js';
import { clamp, lerp, ease, esc, fwdOf } from './util.js';

/* ---------------------------------------------------------------- welke figuur en animaties per monstersoort */
const RIG_FOR_MONSTER = (type, id) => ({ 0: id % 2 ? 'skeleton_rogue' : 'skeleton_minion', 2: 'forest_monster', 3: 'forest_monster', 4: 'skeleton_mage', 5: 'rogue_hooded', 6: 'skeleton_warrior', 7: 'skeleton_minion', 8: 'skeleton_warrior', 9: 'forest_monster', 10: 'mage', 11: 'knight' })[type] || null;
const RIG_HEIGHT = { 0: 1.65, 2: 4.5, 3: 10, 4: 1.7, 5: 1.75, 6: 2.15, 7: 1.75, 8: 4.4, 9: 9, 10: 2.7, 11: 3.2 };   // bosmonster: hoogte inclusief de boom op zijn rug
export const CLIPS = {
  skeleton: { idle: 'Idle_Combat', walk: 'Walking_D_Skeletons', run: 'Running_C', walkSpeed: 2.2, runSpeed: 5.2, attack: '1H_Melee_Attack_Chop', atkSpeed: 1.4, die: 'Death_A', hit: 'Hit_A', spawn: 'Spawn_Ground_Skeletons' },
  forest: { idle: 'Idle', walk: 'Walk', run: 'Walk', walkSpeed: 1.6, runSpeed: 99, attack: 'Attack', atkSpeed: 1.0, die: 'Dying', hit: null, spawn: null },
};
CLIPS.archer = { ...CLIPS.skeleton, attack: '1H_Ranged_Shoot', atkSpeed: 1.3 };
CLIPS.hunter = { ...CLIPS.skeleton, attack: '2H_Melee_Attack_Chop', atkSpeed: 1.25 };
CLIPS.hero = { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', walkSpeed: 2.0, runSpeed: 5.5, attack: '1H_Melee_Attack_Chop', atkSpeed: 1.2, die: 'Death_A', hit: 'Hit_A', spawn: null };
CLIPS.witch = { ...CLIPS.hero, attack: '1H_Melee_Attack_Stab', cast: 'Taunt' };
CLIPS.knight = { ...CLIPS.hero, attack: '2H_Melee_Attack_Chop', atkSpeed: 1.0 };
CLIPS.sneak = { idle: 'Idle_Combat', walk: 'Walking_A', run: 'Running_A', walkSpeed: 2.0, runSpeed: 5.5, attack: 'Dualwield_Melee_Attack_Slice', atkSpeed: 1.3, die: 'Death_A', hit: 'Hit_A', spawn: null };
export const clipsOf = e => e.type === 2 || e.type === 3 || e.type === 9 ? CLIPS.forest : e.type === 10 ? CLIPS.witch : e.type === 11 ? CLIPS.knight : e.type === 4 ? CLIPS.archer : e.type === 5 ? CLIPS.sneak : e.type === 6 ? CLIPS.hunter : CLIPS.skeleton;
const TINT = { 6: 0xffb8a8, 7: 0xf0dcae, 10: 0x8fd08a };   // hondenjager rossig, mummie zwachtels, Sneeuwreus ijzig, Moerasheks groen
const GLOW = { 8: [0x4a3000, 0.5], 9: [0x10304a, 0.45], 10: [0x0a3a10, 0.5], 11: [0x2a0a40, 0.8] };   // farao goud, ridder paars

export function createEntities(g) {
  const { scene, W, M, CH, G, net, player, camera, names, looks, sfx } = g, { sparkles, blood } = g.particles;
  const heightAt = W.heightAt;
  const remotes = new Map(), mons = new Map(), anis = new Map(), dogs = new Map();
  const near = (x, z, d) => Math.hypot(x - player.x, z - player.z) < d;

  function makeEntBase(model) {
    const grp = new THREE.Group(); grp.add(model.group); scene.add(grp);
    return { group: grp, body: model.group, model, x: 0, z: 0, y: 0, yaw: 0, tx: 0, tz: 0, ty: 0, tyaw: 0, phase: 0, speed: 0, hp: 1, maxhp: 1, first: true };
  }
  function killEnt(map, id) { const e = map.get(id); if (!e) return; scene.remove(e.group); if (e.bar) scene.remove(e.bar); if (e.beam) scene.remove(e.beam); map.delete(id); }

  /* ---------------------------------------------------------------- geanimeerde figuren */
  function decorateMonster(e, rig) {
    if (e.type === 4) {                     // kruisboog in de rechterhand
      const t = CH.template('crossbow'), cb = t && t.scene.getObjectByName('1H_Crossbow');
      if (cb && rig.handR) { const c = cb.clone(true); c.position.set(0, 0, 0); rig.handR.add(c); } else e.needBow = true;
    }
    if (e.type >= 5) rig.inner.traverse(o => {
      if (!o.isMesh) return;
      if (e.type === 5) { o.material.color.multiply(new THREE.Color(0x5a4a6e)); o.material.transparent = true; (e.stealthMats ||= []).push(o.material); }
      if (TINT[e.type]) o.material.color.multiply(new THREE.Color(TINT[e.type]));
      if (e.type === 8) o.material.color.multiply(new THREE.Color(0xffd27a));
      if (e.type === 11) o.material.color.multiply(new THREE.Color(0x3a3448));
      if (e.type === 9) o.material.color.setRGB(1.7, 2.0, 2.4);                     // Sneeuwreus: de donkere huid flink oplichten tot ijsblauw
      if (GLOW[e.type] && o.material.emissive) { o.material.emissive.set(GLOW[e.type][0]); o.material.emissiveIntensity = GLOW[e.type][1]; }
    });
  }
  let bossSkin = null;
  function bossLook(rig) {          // de Woudreus krijgt de tweede huid
    const apply = tex => rig.inner.traverse(o => { if (o.isMesh && o.material.name === 'Monster') { o.material.map = tex; o.material.needsUpdate = true; } });
    if (bossSkin) return apply(bossSkin);
    new THREE.TextureLoader().load(new URL('./models/forest_monster_skin2.jpg', import.meta.url).href, t => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; bossSkin = t; apply(t); });
  }
  function mountItem(e) {
    const r = e.model;
    const parent = r.kind === 'rig' ? r.handR : r.mount; if (!parent) return;
    if (e.item.parent) e.item.parent.remove(e.item);
    if (r.kind === 'rig') { const s = r.inner.scale.x; e.item.scale.setScalar(0.9 / s); e.item.rotation.set(0, Math.PI, 0); e.item.position.set(0, 0.033, 0); }
    else { e.item.scale.setScalar(0.7); e.item.rotation.set(-Math.PI / 2 + 0.3, 0, 0); e.item.position.set(0, -0.02, -0.06); }
    parent.add(e.item);
  }
  function setRig(e, rig) {
    e.group.remove(e.body); e.body = rig.group; e.group.add(rig.group);
    e.model = rig; e.flashMats = null; e.stealthMats = null;
    if (e.item) mountItem(e);
    if (e.isMon) { decorateMonster(e, rig); if (e.type === 3) bossLook(rig); }
  }
  function wantRig(e, name, height, fresh = false) {
    if (!name) return;
    if (CH.isReady(name)) { const r = CH.createRig(name, height, G.quality !== 'laag'); if (r) { setRig(e, r); if (fresh) e.spawnAnim = true; return; } }
    e.want = { name, height };
  }
  function onRigReady(name) {
    if (name === 'crossbow') for (const e of mons.values()) if (e.needBow && e.model.kind === 'rig') { e.needBow = false; decorateMonster(e, e.model); }
    for (const map of [remotes, mons, anis]) for (const e of map.values()) {
      if (!e.want || e.want.name !== name) continue;
      const r = CH.createRig(name, e.want.height, G.quality !== 'laag'); if (r) { setRig(e, r); e.want = null; }
    }
  }

  /* ---------------------------------------------------------------- beweging en animatie */
  function rigLocomotion(e, run = 5.5, walk = 2.0, idle = 'Idle', walkClip = 'Walking_A', runClip = 'Running_A') {
    const r = e.model, sp = e.speed / (r.height / 1.85);
    if (sp < 0.35) r.loop(idle);
    else if (sp < run * 0.72) r.loop(walkClip, clamp(sp / walk, 0.6, 1.8));
    else r.loop(runClip, clamp(sp / run, 0.7, 1.6));
  }
  function animateBody(e) {          // zelfgebouwde figuren: benen en armen zwaaien
    const m = e.model, amp = clamp(e.speed / 2.5, 0, 1), s = Math.sin(e.phase) * 0.75 * amp;
    if (m.kind === 'biped') {
      m.legL.rotation.x = s; m.legR.rotation.x = -s; m.armL.rotation.x = -s * 0.8;
      if (e.swingT !== undefined && e.swingT < 1) {
        const t = e.swingT; m.armR.rotation.x = t < 0.25 ? lerp(0, 0.6, ease(t / 0.25)) : lerp(0.6, -2.0, ease(clamp((t - 0.25) / 0.3, 0, 1))) * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      } else m.armR.rotation.x = s * 0.8;
    } else if (m.hop) { const h = Math.abs(Math.sin(e.phase * 0.45)) * amp; m.body.position.y = h * 0.6; for (const l of m.legs) l.rotation.x = 0.35 * amp - h * 0.9; m.tail.rotation.x = -1.25 + h * 0.4; }
    else if (m.legs) { m.legs[0].rotation.x = s; m.legs[3].rotation.x = s; m.legs[1].rotation.x = -s; m.legs[2].rotation.x = -s; }
  }
  function moveEnt(e, dt, useTy = false) {    // vloeiend naar de laatst bekende plek van de server
    const k = 1 - Math.exp(-12 * dt), ox = e.x, oz = e.z;
    if (e.first) { e.x = e.tx; e.z = e.tz; e.y = e.ty; e.yaw = e.tyaw; e.first = false; }
    e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k;
    let dy = e.tyaw - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; e.yaw += dy * k;
    const gy = heightAt(e.x, e.z); e.y = useTy ? lerp(e.y, e.ty, k) : gy;
    e.group.position.set(e.x, e.y, e.z); e.group.rotation.y = e.yaw;
    const sp = Math.hypot(e.x - ox, e.z - oz) / Math.max(dt, 1e-3);
    e.speed = lerp(e.speed, sp, 0.3); e.phase += Math.min(sp, 12) * dt * (e.model.kind === 'biped' ? 2.4 / (e.scaleF || 1) : 3.4);
  }
  function flash(e) {                 // rood oplichten bij een treffer
    if (!e.flashMats) {
      e.flashMats = [];
      e.group.traverse(o => { if (o.isMesh && o.material && o.material.emissive && !(o.material.emissiveIntensity > 1)) {
        if (!o.material.userData.own) { o.material = o.material.clone(); o.material.userData.own = true; }
        o.material.userData.e0 = [o.material.emissive.getHex(), o.material.emissiveIntensity];   // eigen gloed (farao, ridder) terugzetten na het flitsen
        e.flashMats.push(o.material);
      } });
    }
    e.flashT = 0.16;
  }
  function tickFlash(e, dt) {
    if (!(e.flashT > 0)) return;
    e.flashT = Math.max(0, e.flashT - dt); const k = e.flashT / 0.16;
    for (const m of e.flashMats) {
      if (k > 0) { m.emissive.setRGB(1, 0.15, 0.1); m.emissiveIntensity = k * 0.9; }
      else { m.emissive.setHex(m.userData.e0[0]); m.emissiveIntensity = m.userData.e0[1]; }
    }
  }
  function showBar(e) { e.bar.position.set(e.x, e.y + e.barY, e.z); e.bar.quaternion.copy(camera.quaternion); M.setBar(e.bar, e.hp / e.maxhp); }

  /* ---------------------------------------------------------------- andere spelers */
  function makeRemote(id) {
    const name = names.get(id) || 'Speler';
    const e = makeEntBase(M.buildHumanoid({ cloth: M.colorForName(name) })); e.id = id; e.eq = -1; e.sw = 0; e.swingT = 1; e.dead = 0;
    wantRig(e, CH.HEROES[(looks.get(id) | 0) % CH.HEROES.length].key, 1.8);
    const label = M.makeLabel(name, '#ffffff'); label.position.y = 2.25; e.group.add(label); e.label = label;
    // lichtzuil in de kleur van de speler, zichtbaar door de mist heen
    const col = new THREE.Color(M.colorForName(name)); { const hsl = {}; col.getHSL(hsl); col.setHSL(hsl.h, 0.95, 0.55); }
    e.beam = new THREE.Group();
    const mk = (r, op) => new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.6, 140, 14, 1, true).translate(0, 70, 0),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
    e.beam.add(mk(0.6, 0.22), mk(0.16, 0.85));
    e.beam.userData.base = [0.22, 0.85];
    e.beamLabel = M.makeLabel(name, '#' + col.getHexString()); e.beamLabel.userData.sx = e.beamLabel.scale.x; e.beamLabel.userData.sy = e.beamLabel.scale.y; e.beamLabel.material.depthTest = false; e.beamLabel.renderOrder = 14; e.beam.add(e.beamLabel);
    e.beam.frustumCulled = false; e.beam.traverse(o => { o.frustumCulled = false; o.renderOrder = 9; });
    scene.add(e.beam);
    remotes.set(id, e); return e;
  }
  function setRemoteEq(e, code) {
    e.eq = code;
    if (e.item && e.item.parent) e.item.parent.remove(e.item);
    const d = decodeEq(code);
    e.item = d.type === 'axe' ? M.makeAxeMesh() : M.makeSwordMesh(d);
    e.item.traverse(o => { o.castShadow = true; });
    mountItem(e);
  }
  function updateRemote(e, dt, time) {
    moveEnt(e, dt, true);
    if (e.swingT < 1) e.swingT = Math.min(1, e.swingT + dt / 0.45);
    if (e.model.kind === 'rig') {
      const r = e.model;
      if (e.dead && !e.wasDead) r.once('Death_A', { hold: true });
      else if (!e.dead && e.wasDead) r.unlock();
      e.wasDead = e.dead;
      if (e.swingT === 0) r.once('1H_Melee_Attack_Chop', { speed: 1.35 });
      if (!e.dead) { if (e.blocking) r.loop('Blocking'); else if (e.digging) r.loop('Interact'); else if (e.boatId) r.loop('Idle'); else rigLocomotion(e); }
      r.update(dt);
    } else {
      animateBody(e);
      e.group.rotation.z = e.dead ? Math.PI / 2 : 0; if (e.dead) e.group.position.y += 0.25;
    }
    if (!e.beam) return;
    const d = Math.hypot(e.x - player.x, e.z - player.z);
    const k = clamp((d - 10) / 15, 0, 1) * (e.dead ? 0.45 : 1) * (0.88 + Math.sin(time * 3 + e.id) * 0.12);
    e.beam.visible = k > 0.02;
    if (!e.beam.visible) return;
    e.beam.position.set(e.x, e.y, e.z);
    const [o1, o2] = e.beam.userData.base; e.beam.children[0].material.opacity = o1 * k; e.beam.children[1].material.opacity = o2 * k;
    const w = 1 + d / 22; e.beam.children[0].scale.set(w, 1, w); e.beam.children[1].scale.set(w, 1, w);   // verre zuilen iets breder, zodat ze zichtbaar blijven
    const lab = e.beamLabel; lab.position.y = 3.5 + d * 0.06; lab.material.opacity = Math.min(1, k * 1.3);
    lab.scale.set(lab.userData.sx * (1 + d / 11), lab.userData.sy * (1 + d / 11), 1);
  }

  /* ---------------------------------------------------------------- monsters en dieren */
  const seenMons = new Set();
  function makeMonster(id, type) {
    const model = M.buildMonster(type), e = makeEntBase(model); e.id = id; e.type = type; e.isMon = true; e.scaleF = type === 2 ? 1.9 : type === 3 || type === 9 ? 3.6 : type === 8 ? 2.0 : type === 11 ? 1.7 : type === 10 ? 1.4 : type === 0 ? 0.85 : 1;
    e.bar = M.makeBar(0.9 + model.height * 0.18); scene.add(e.bar); e.barY = model.height + 0.35;
    if (MONSTERS[type].boss || type === 8) { const l = M.makeLabel(MONSTERS[type].name, type === 8 ? '#ffd27a' : '#ff9a6a'); l.position.y = model.height + 1.1; l.scale.multiplyScalar(2.2); e.group.add(l); }
    wantRig(e, RIG_FOR_MONSTER(type, id), RIG_HEIGHT[type], !seenMons.has(id));   // uit de grond opstaan alleen de eerste keer
    seenMons.add(id); if (seenMons.size > 2000) seenMons.clear();
    mons.set(id, e); return e;
  }
  function makeAnimal(id, type) {
    const model = M.buildAnimal(type), e = makeEntBase(model); e.id = id; e.type = type;
    if (type === 1) wantRig(e, 'deer', 1.5);
    e.bar = M.makeBar(0.7); scene.add(e.bar); e.barY = model.height + 0.3;
    anis.set(id, e); return e;
  }
  /** Sterfanimatie afspelen en daarna weghalen; geeft true zolang hij nog bezig is. */
  function tickDying(map, e, dt, sink, sinkSpeed) {
    if (e.dying === undefined) return false;
    e.dying -= dt; if (e.model.update) e.model.update(dt);
    if (e.dying < sink) e.group.position.y -= dt * sinkSpeed;
    if (e.dying <= 0) { e.dying = undefined; killEnt(map, e.id); }
    return true;
  }
  function animateRigFar(e, dt) {    // verre figuren minder vaak animeren
    e.animAcc = (e.animAcc || 0) + dt;
    if (!near(e.x, e.z, 55) && e.animAcc <= 0.1) return;
    e.model.update(e.animAcc); e.animAcc = 0;
  }
  function updateMonster(e, dt) {
    if (tickDying(mons, e, dt, 0.6, 1.2)) return;
    moveEnt(e, dt); tickFlash(e, dt);
    if (e.model.kind === 'rig') {
      const cs = clipsOf(e);
      if (e.spawnAnim) { e.spawnAnim = false; if (cs.spawn) e.model.once(cs.spawn, { speed: 1.4 }); }
      rigLocomotion(e, cs.runSpeed, cs.walkSpeed, cs.idle, cs.walk, cs.run);
      animateRigFar(e, dt);
    } else animateBody(e);
    let hidden = false;
    if (e.type === 5) {                 // sluiper: bijna onzichtbaar tot hij dichtbij is
      const d = Math.hypot(e.x - player.x, e.z - player.z), a = clamp((10 - d) / 5, 0.1, 1);
      hidden = a < 0.5;
      if (e.stealthMats) for (const m of e.stealthMats) { m.opacity = a; m.depthWrite = a > 0.95; }
      else e.group.visible = !hidden;
      if (e.alphaOld !== a > 0.95) { e.alphaOld = a > 0.95; e.group.traverse(o => { if (o.isMesh) o.castShadow = a > 0.95; }); }
    }
    if (e.bar) { e.bar.visible = !hidden && (e.hp < e.maxhp || MONSTERS[e.type].boss || e.type === 8); if (e.bar.visible) showBar(e); }
  }
  function updateAnimal(e, dt) {
    if (tickDying(anis, e, dt, 0.5, 0.8)) return;
    moveEnt(e, dt); tickFlash(e, dt);
    if (e.model.kind === 'rig') {
      if (e.speed < 0.3) e.model.loop('idle'); else e.model.loop('run', clamp(e.speed / 9, 0.35, 1.4));
      animateRigFar(e, dt);
    } else animateBody(e);
    e.bar.visible = e.hp < e.maxhp; if (e.bar.visible) showBar(e);
  }
  function syncList(map, list, make, full) {
    const seen = new Set();
    for (const a of list) {
      const [id, type, x, z, yaw, hp, maxhp] = a; seen.add(id);
      const e = map.get(id) || make(id, type);
      e.tx = x; e.tz = z; e.tyaw = yaw; e.hp = hp; e.maxhp = maxhp;
    }
    if (full) for (const id of [...map.keys()]) if (!seen.has(id) && !map.get(id).dying) killEnt(map, id);   // tussensnapshots bevatten alleen wat dichtbij is
  }

  /* ---------------------------------------------------------------- honden */
  function makeDog(a) {
    const [id, , , , , , owner, , , , fur] = a;
    const e = makeEntBase(M.buildDog(DOG_FURS[fur] ?? DOG_FURS[0], owner > 0)); e.id = id; e.owner = owner; e.bar = M.makeBar(0.7); scene.add(e.bar); e.barY = 1.15; e.labelKey = '';
    dogs.set(id, e); return e;
  }
  function syncDogs(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, x, z, yaw, hp, maxhp, owner, state, level, name, , boost, bi] = a; seen.add(id);
      let e = dogs.get(id);
      if (e && e.owner !== owner) { killEnt(dogs, id); e = null; }
      if (!e) e = makeDog(a);
      e.tx = x; e.tz = z; e.tyaw = yaw; e.hp = hp; e.maxhp = maxhp; e.state = state; e.level = level; e.boost = boost | 0; e.breed = (DOG_BREEDS[bi] || DOG_BREEDS[0]);
      const key = owner ? name + '|' + level + '|' + owner : '';
      if (key !== e.labelKey) {
        e.labelKey = key;
        if (e.label) { e.group.remove(e.label); e.label.material.map.dispose(); e.label = null; }
        if (owner) { const own = owner === g.myId; e.label = M.makeLabel(name + ' · ' + e.breed.name + ' · nv ' + level + (own ? '' : ' (' + (names.get(owner) || '?') + ')'), own ? '#ffd27a' : '#ffffff'); e.label.position.y = 1.25; e.group.add(e.label); }
      }
      if (owner === g.myId) { const was = g.myDog && g.myDog.down; g.myDog = { hp, max: maxhp, down: state === 2, boost: boost | 0 }; if (was !== g.myDog.down || Math.random() < 0.2) g.ui.renderDogChip(); }
    }
    for (const id of [...dogs.keys()]) if (!seen.has(id)) killEnt(dogs, id);
    if (g.inv.dog && ![...dogs.values()].some(e => e.owner === g.myId)) g.myDog = null;
  }
  function updateDog(e, dt, time) {
    moveEnt(e, dt);
    const mdl = e.model, down = e.state === 2, sit = e.state === 3;
    if (!down && !sit) animateBody(e); else for (const l of mdl.legs) l.rotation.x = 0;
    mdl.body.rotation.x = sit ? 0.5 : 0; mdl.body.position.y = sit ? 0.12 : 0;
    if (sit) { mdl.legs[2].rotation.x = mdl.legs[3].rotation.x = -1.1; mdl.legs[0].rotation.x = mdl.legs[1].rotation.x = -0.45; }
    e.group.rotation.z = down ? 1.35 : 0; if (down) e.group.position.y += 0.12;
    const happy = !down && (sit || (e.owner && e.speed < 1.5));
    mdl.tail.rotation.z = Math.sin(time * (happy ? 16 : 7)) * (happy ? 0.7 : 0.25);
    mdl.tongue.visible = !down;
    mdl.aura.visible = e.boost > 0 && !down; if (mdl.aura.visible) { mdl.aura.rotation.z += dt * 3; mdl.aura.scale.setScalar(1 + Math.sin(time * 6) * 0.08); if (Math.random() < 0.15) sparkles.emit(e.x, e.y + 0.4, e.z, 1, 0.5, 1, 0.8); }
    if (e.barkT > 0) { e.barkT -= dt; mdl.head.rotation.x = -Math.abs(Math.sin(e.barkT * 18)) * 0.3; } else mdl.head.rotation.x = down ? 0 : Math.sin(time * 2 + e.id) * 0.05;
    e.bar.visible = !!e.owner && (e.hp < e.maxhp || down); if (e.bar.visible) showBar(e);
    if (e.label) e.label.visible = near(e.x, e.z, 40);
  }
  function findWildDog() {
    let best = null, bd = 1e9;
    const f = fwdOf(player.yaw);
    for (const e of dogs.values()) {
      if (e.owner) continue;
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > 3.4 || (dx * f.x + dz * f.z) / (d || 1) < 0.3) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /* ---------------------------------------------------------------- berichten van de server */
  net.on('s', m => {
    const seen = new Set();
    for (const a of m.p) {
      const [id, x, y, z, yaw, hp, eq, dd, sw] = a;
      if (id === g.myId) continue;
      seen.add(id);
      const e = remotes.get(id) || makeRemote(id);
      e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.hp = hp; e.dead = dd; e.boatId = a[9] | 0; e.digging = !!a[10];
      if (e.eq !== eq) setRemoteEq(e, eq);
      if (e.sw !== sw) { e.sw = sw; e.swingT = 0; if (e.model.kind === 'rig') e.model.once('1H_Melee_Attack_Chop', { speed: 1.35 }); }
    }
    for (const id of [...remotes.keys()]) if (!seen.has(id)) killEnt(remotes, id);
    const full = m.f !== 0; syncList(mons, m.m, makeMonster, full); syncList(anis, m.a, makeAnimal, full); if (m.d) syncDogs(m.d);
  });
  net.on('pleave', m => killEnt(remotes, m.id));
  const rigOnce = (e, clip, opts) => { if (e && e.model.kind === 'rig' && !e.dying) e.model.once(clip, opts); };
  net.on('ev', m => {
    switch (m.k) {
      case 'bark': {
        const dx = m.x - player.x, dz = m.z - player.z, d = Math.hypot(dx, dz);
        if (d < 45) { const right = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw); sfx.bark(clamp(right / Math.max(d, 1), -0.9, 0.9), clamp(1.4 - d / 35, 0.15, 1)); }
        const e = dogs.get(m.id); if (e) e.barkT = 0.35;
        break;
      }
      case 'tamed': {
        sparkles.emit(m.x, heightAt(m.x, m.z) + 0.8, m.z, 40, 1.6, 2.2, 1.4);
        if (m.by === g.myId) { sfx.happy(); g.ui.banner('Nieuw maatje!<small>' + esc(m.name) + ' loopt nu met je mee en helpt in gevechten</small>', 4200); }
        else { const n = names.get(m.by); if (n) g.ui.toast(esc(n) + ' heeft een hond getemd: ' + esc(m.name) + '.', '#f2c14e'); }
        break;
      }
      case 'doghurt': { const e = dogs.get(m.id); if (e && e.owner === g.myId && near(e.x, e.z, 30) && Math.random() < 0.5) sfx.yelp(); break; }
      case 'dogboost': case 'doglvl': {
        const e = dogs.get(m.id); if (!e) break;
        if (m.k === 'dogboost') sparkles.emit(e.x, e.y + 0.6, e.z, 40, 1.4, 2.4, 1.4); else sparkles.emit(e.x, e.y + 0.8, e.z, 30, 1.2, 2, 1.2);
        if (e.owner === g.myId) sfx.happy();
        break;
      }
      case 'hit': {
        const map = m.e === 'm' ? mons : anis, e = map.get(m.id), gy = heightAt(m.x, m.z);
        g.fx.addPopup(m.x, gy + (e ? e.model.height : 1.2) + 0.5, m.z, m.parry ? 'Pareert! ' + m.dmg : m.dmg + (m.heavy ? '!' : ''), m.parry ? '#9aa3b5' : m.heavy ? '#ff9a3a' : m.e === 'm' ? '#ffe08a' : '#ffffff');
        if (m.parry) { sfx.clang(); if (!g.parryTip) { g.parryTip = true; g.ui.toast('🛡️ De Schaduwridder pareert van voren. Blok zijn slag (rechtermuisknop / 🛡️) zodat hij wankelt, of sla hem in de rug.', '#9ad8ff'); } }
        if (m.heavy && near(m.x, m.z, 6)) g.shake = Math.max(g.shake, 0.18);
        blood.emit(m.x, gy + (e ? e.model.height * 0.5 : 0.7), m.z, 8, 2.2, 2.5, 0.6);
        if (e) { flash(e); if (m.e === 'm' && e.model.kind === 'rig' && !e.model.busy && !e.dying) { const cs = clipsOf(e); if (cs.hit) e.model.once(cs.hit, { speed: 1.6 }); } }
        if (near(m.x, m.z, 30)) sfx.hit();
        break;
      }
      case 'shot': rigOnce(mons.get(m.id), CLIPS.archer.attack, { speed: 1.3 }); break;
      case 'sandblast': { const e = mons.get(m.id); if (e) rigOnce(e, clipsOf(e).attack, { speed: 0.7 }); break; }
      case 'summon': { const e = mons.get(m.id); if (e && e.model.kind === 'rig') e.model.once(CLIPS.forest.attack, { speed: 0.8 }); break; }
      case 'enrage': {
        const e = mons.get(m.id); if (!e) break;
        sparkles.emit(e.x, heightAt(e.x, e.z) + 2, e.z, 60, 3, 3, 1.2);
        if (near(e.x, e.z, 40)) { g.ui.banner('👑 De farao wordt woest!', 2200); sfx.rumble(); }
        break;
      }
      case 'lunge': rigOnce(mons.get(m.id), 'Dodge_Forward', { speed: 1.4 }); break;
      case 'stagger': {
        const e = mons.get(m.id); if (!e) break;
        rigOnce(e, 'Hit_A', { speed: 0.6 }); g.fx.addPopup(e.x, e.y + e.model.height + 0.8, e.z, 'Wankelt!', '#7affc8');
        sparkles.emit(e.x, e.y + 2, e.z, 40, 2, 2, 1); if (near(e.x, e.z, 30)) sfx.clang();
        break;
      }
      case 'blink': {
        const e = mons.get(m.id);
        g.particles.leaves.emit(m.x0, heightAt(m.x0, m.z0) + 1, m.z0, 40, 2.5, 2, 1.2); g.particles.leaves.emit(m.x, heightAt(m.x, m.z) + 1, m.z, 40, 2.5, 2, 1.2);
        if (e) { e.x = e.tx = m.x; e.z = e.tz = m.z; rigOnce(e, CLIPS.witch.cast, { speed: 1.2 }); }
        if (near(m.x, m.z, 30)) sfx.rumble();
        break;
      }
      case 'frost': case 'poison': { const e = mons.get(m.id); if (e) rigOnce(e, clipsOf(e) === CLIPS.witch ? CLIPS.witch.cast : clipsOf(e).attack, { speed: 0.8 }); break; }
      case 'roll': { const e = remotes.get(m.id); if (e && e.model.kind === 'rig') e.model.once('Dodge_Forward', { speed: 1.5 }); break; }
      case 'block': { const e = remotes.get(m.id); if (e) e.blocking = m.on; break; }
      case 'blocked': {
        sparkles.emit(m.x, heightAt(m.x, m.z) + 1.2, m.z, 14, 2.5, 2, 0.4);
        if (m.id === g.myId) { sfx.clang(); g.shake = Math.max(g.shake, 0.1); g.fx.popupAhead('Geblokt', '#9ad8ff', 1.6); }
        else { const e = remotes.get(m.id); if (e && e.model.kind === 'rig') e.model.once('Block_Hit', { speed: 1.4 }); if (near(m.x, m.z, 25)) sfx.clang(); }
        break;
      }
      case 'dodged': g.fx.popupAhead('Ontweken!', '#7affc8', 1.5); break;
      case 'matk': { const e = mons.get(m.id); if (e) { const cs = clipsOf(e); rigOnce(e, cs.attack, { speed: cs.atkSpeed }); } break; }
      case 'mdie': {
        const e = mons.get(m.id);
        if (e && e.model.kind === 'rig') { e.dying = clipsOf(e) === CLIPS.forest ? 2.0 : 1.8; e.model.once(clipsOf(e).die, { hold: true }); if (e.bar) { scene.remove(e.bar); e.bar = null; } }
        else killEnt(mons, m.id);
        blood.emit(m.x, heightAt(m.x, m.z) + 0.8, m.z, 30, 3.2, 3.5, 1); if (near(m.x, m.z, 40)) sfx.kill();
        break;
      }
      case 'adie': {
        const e = anis.get(m.id);
        if (e && e.model.kind === 'rig') { e.dying = 1.4; e.model.once('die', { hold: true }); if (e.bar) e.bar.visible = false; } else killEnt(anis, m.id);
        blood.emit(m.x, heightAt(m.x, m.z) + 0.4, m.z, 18, 2.5, 3, 0.8);
        break;
      }
    }
  });

  function update(dt, time) {
    for (const e of remotes.values()) updateRemote(e, dt, time);
    for (const e of mons.values()) updateMonster(e, dt);
    for (const e of dogs.values()) updateDog(e, dt, time);
    for (const e of anis.values()) updateAnimal(e, dt);
  }
  return { remotes, mons, anis, dogs, update, onRigReady, findWildDog, flash, mountItem };
}
