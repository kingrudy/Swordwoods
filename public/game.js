// Multiplayer-client: zet de 3D-wereld op, koppelt alle onderdelen aan elkaar en draait de hoofdlus.
// Elk onderdeel staat in een eigen bestand en krijgt hetzelfde gedeelde object `g` mee (status, scène, server, ...).
import * as THREE from 'three';
import { createWorld, WATER, WORLD, MAP } from './world.js';
import { MONSTERS } from './items.js';
import * as M from './models.js';
import * as CH from './characters.js';
import { createGraphics, QUALITY } from './graphics.js';
import { createAudio } from './audio.js';
import { Particles } from './particles.js';
import { createHud } from './hud.js';
import { createBuildSystem } from './buildmode.js';
import { createWorldFx } from './worldfx.js';
import { createSocial } from './social.js';
import { createDesert } from './desert.js';
import { createScenery } from './scenery.js';
import { createEntities } from './entities.js';
import { createEffects } from './effects.js';
import { createFishing } from './fishing.js';
import { createPlayer } from './player.js';
import { createUi } from './ui.js';
import { createPanels, GFX_KEY } from './panels.js';
import { createInteract } from './interact.js';
import { createControls } from './controls.js';
import { createSettings } from './settings.js';
import { $, nextFrame } from './util.js';

export async function startGame({ net, joined, user }) {
  const W = createWorld(joined.room.seed), myId = joined.you.id;
  // telefoon/tablet: aanraakbesturing en lichtere graphics
  const qTouch = new URLSearchParams(location.search).get('touch');
  const isTouch = qTouch === '1' || (qTouch !== '0' && (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches)));
  if (isTouch) document.body.classList.add('touch');

  /* ---------------------------------------------------------------- renderer, scènes en camera's */
  let gfxChosen = null; try { gfxChosen = localStorage.getItem(GFX_KEY); } catch {}
  const startQ = QUALITY[gfxChosen] ? gfxChosen : (isTouch ? 'laag' : 'hoog');
  const renderer = new THREE.WebGLRenderer({ antialias: startQ !== 'laag', powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = startQ === 'laag' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;
  $('game').appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1200); camera.rotation.order = 'YXZ';
  const handScene = new THREE.Scene(), handCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 10);   // eigen hand, altijd vooraan
  const G = createGraphics({ renderer, scene, camera, handScene, handCam, quality: startQ, serverOffset: joined.now ? joined.now - Date.now() : 0 });
  G.applyQuality(startQ);
  G.setHeightFn(W.heightAt);
  { const tq = new URLSearchParams(location.search).get('tijd'); if (tq !== null && tq !== '') G.setTimeOfDay(parseFloat(tq)); }

  /* ---------------------------------------------------------------- gedeelde status */
  const AU = createAudio();
  const g = {
    net, joined, user, myId, W, M, CH, G, AU, sfx: AU.sfx, tone: AU.tone, music: AU.music,
    renderer, scene, camera, handScene, handCam, isTouch,
    particles: {
      chips: new Particles(scene, 0xc89a5e, 0.11, 300), leaves: new Particles(scene, 0x4c8f36, 0.14, 300, false, 3),
      sparkles: new Particles(scene, 0xffe08a, 0.16, 400, true, -1.5), blood: new Particles(scene, 0xb8332d, 0.13, 300, false, 12),
      splash: new Particles(scene, 0xcfeaff, 0.12, 200, false, 9), sand: new Particles(scene, 0xe2c27e, 0.2, 400, false, 6),
      frost: new Particles(scene, 0xe6f6ff, 0.15, 300, true, 4), gas: new Particles(scene, 0x8fe060, 0.22, 300, false, -0.6),
    },
    // start met zicht op de winkel
    player: { x: joined.you.x, y: joined.you.y, z: joined.you.z, vy: 0, vx: 0, vz: 0, yaw: Math.atan2(-(W.shop.x - joined.you.x), -(W.shop.z - joined.you.z)), pitch: 0, onGround: true, bob: 0 },
    inv: { wood: 0, meat: 0, potions: 0, fish: 0, ore: 0, xp: 0, tal: {}, daily: null, ach: {}, tut: 999, up: { shield: 0, axe: 0, rod: 0 }, swords: [], equip: 0, stats: {} },
    you: { hp: 100, hu: 80, sc: 0, rs: 0 },
    wave: { n: 0, ph: 0, t: 0, left: 0 },
    names: new Map(joined.players.map(p => [p.id, p.name])), looks: new Map(joined.players.map(p => [p.id, p.look | 0])),
    keys: {}, virt: { x: 0, y: 0, sprint: false, toggle: false, attack: false, jump: false, px: 0, py: 0, pattack: false, pjump: false, psprint: false },
    // vlaggen: dood, muis vast (of zacht spelen), paneel open, eigen hengel in het water, schudden van de camera
    dead: false, locked: false, soft: false, shopOpen: false, fishing: null, shake: 0, myDog: null, time: 0,
  };
  const { player, inv } = g, C = g.particles;

  /* ---------------------------------------------------------------- onderdelen (volgorde: wie berichten eerst moet zien, eerst) */
  g.ui = createUi(g);
  g.settings = createSettings(g);
  g.scenery = await createScenery(g);
  g.ents = createEntities(g);
  g.fx = createEffects(g);
  g.fish = createFishing(g);
  g.pl = createPlayer(g);
  const onPanel = on => g.panels.panel(on);
  g.hud = createHud({
    W, WORLD, MAP, WATER, player, net, myId, names: g.names, isTouch, chestObjs: g.scenery.chestObjs, remotes: g.ents.remotes, dogs: g.ents.dogs, mons: g.ents.mons, colorForName: M.colorForName,
    extraMarkers: () => [...g.bs.markers(), ...g.wfx.markers(), ...g.soc.markers(), ...g.des.markers(), ...g.scenery.markers()],
    sfxChat: () => g.tone(880, 0.08, 'triangle', 0.05),
    onChatOpen: () => { for (const k in g.keys) g.keys[k] = false; player.vx = player.vz = 0; },
  });
  const shared = { scene, M, W, G, net, player, inv, heightAt: W.heightAt, camera, joined, myId, sfx: g.sfx, toast: g.ui.toast, banner: g.ui.banner, sparkles: C.sparkles, chips: C.chips };
  g.bs = createBuildSystem({
    ...shared, myName: joined.you.name, treeObjs: g.scenery.treeObjs, isTouch, WATER,
    onToggle: on => { if (on) g.pl.resetSwing(); g.ui.renderInv(); },
    onBoat: m => g.des && g.des.onBoat(m), riderPos: id => g.des ? g.des.riderPos(id) : null,
  });
  g.wfx = createWorldFx({ ...shared, CH, onPanel });
  g.soc = createSocial({
    ...shared, names: g.names, remotes: g.ents.remotes, mons: g.ents.mons, dogs: g.ents.dogs, hud: g.hud, addPopup: g.fx.addPopup, flash: g.ents.flash,
    onOreFound: i => { const r = g.scenery.oreObjs[i]; if (r) r.seen = true; }, onPanel,
  });
  g.des = createDesert({ ...shared, WATER, anis: g.ents.anis, remotes: g.ents.remotes, builds: () => g.bs.builds, onPanel });
  g.panels = createPanels(g);
  g.inter = createInteract(g);
  g.ctl = createControls(g);
  await nextFrame();

  /* ---------------------------------------------------------------- geluid: muziek, omgeving en voetstappen */
  let lastStep = 0;
  function updateSound(dt, time) {
    const { music, sfx, wfx, wave } = g;
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) {
      const boss = wave.ph === 1 && [...g.ents.mons.values()].some(e => MONSTERS[e.type].boss);
      music.setMood(boss ? 'boss' : wave.ph === 1 ? 'fight' : G.state.night > 0.5 ? 'night' : 'calm');
      music.setOctave(wfx.biome === 'snow' ? 5 : wfx.biome === 'dark' ? -2 : 0);
      const w = wfx.weather; AU.ambience(w === 'regen' ? 1 : w === 'onweer' ? 1.3 : 0, (wfx.biome === 'snow' ? 0.8 : 0) + (w === 'onweer' ? 0.6 : w === 'mist' ? 0.2 : 0.1));
      if (!g.dead && Math.random() < 0.18) { if (G.state.night > 0.5) (Math.random() < 0.85 ? sfx.cricket : sfx.owl)(); else if (w === 'helder' && wfx.biome !== 'snow') sfx.bird(); }
    }
    const ph = Math.floor(player.bob / Math.PI);
    if (ph !== lastStep) { lastStep = ph; if (player.onGround && Math.hypot(player.vx, player.vz) > 1.5 && !g.dead) sfx.step(wfx.biome); }
  }

  /* ---------------------------------------------------------------- hoofdlus */
  function update(dt, time) {
    g.time = time;
    g.ctl.pollPad(dt); g.hud.update(dt); g.bs.update(dt, time); g.wfx.update(dt, time); g.soc.update(dt, time); g.des.update(dt, time);
    updateSound(dt, time);
    g.pl.update(dt, time);
    g.ents.update(dt, time);
    g.fx.update(dt, time);
    g.scenery.update(dt, time);
    g.fish.update(dt, time);
    g.inter.update();
    g.ui.update(dt, time);
    for (const p of Object.values(C)) p.update(dt);
  }

  /* ---------------------------------------------------------------- start */
  g.ui.renderInv(); g.ui.renderVitals(); g.pl.rebuildHeld();
  $('hud').classList.add('on');
  $('veil').querySelector('h2').textContent = 'Welkom, ' + user;
  $('veil').querySelector('p').textContent = 'Kamer: ' + joined.room.name + '. Klik om te beginnen. Het spel loopt door als je pauzeert.';
  $('btn-resume').textContent = isTouch ? 'Tik om te starten' : 'Start';
  CH.preload(['chest', 'deer', 'knight', 'barbarian', 'mage', 'rogue', 'skeleton_minion', 'skeleton_rogue', 'forest_monster', 'merchant', 'crossbow', 'skeleton_mage', 'skeleton_warrior', 'rogue_hooded'],
    name => { g.scenery.onRigReady(name); g.ents.onRigReady(name); });
  g.ctl.showVeil(true);
  g.ui.welcome();
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const dbg = window.__game;
    if (!(dbg && dbg.pause)) update(dt, now / 1000);
    if (!(dbg && dbg.pause) || dbg.forceRender) { G.render(); g.panels.fpsCheck(dt); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // voor tests en debuggen in de console
  window.__game = {
    g, pause: false, forceRender: false, update, renderOnce: () => G.render(),
    W, net, myId, scene, camera, renderer, G, CH, get isTouch() { return g.isTouch; }, player, inv, you: g.you, wave: g.wave,
    remotes: g.ents.remotes, mons: g.ents.mons, anis: g.ents.anis, dogs: g.ents.dogs, treeObjs: g.scenery.treeObjs, chestObjs: g.scenery.chestObjs,
    fx: g.fx.fx, bobbers: g.fish.bobbers, findWater: g.fish.findWater, getFishing: () => g.fishing,
    hud: g.hud, bs: g.bs, wfx: () => g.wfx, soc: () => g.soc, des: () => g.des, music: g.music, getAudio: () => AU.ctx,
    interact: () => g.inter.interact(), prompt: () => $('prompt').classList.contains('on') ? $('prompt').innerHTML : '', action: () => g.inter.current,
    startSwing: h => g.pl.startSwing(h), swingT: () => g.pl.swingT, chargeLevel: () => g.pl.chargeLevel(), feedDog: () => g.ctl.feedDog(),
    openShop: () => g.panels.openShop(), closeShop: r => g.panels.closeShop(r), pauseGame: () => g.ctl.pauseGame(),
    getLocked: () => [g.locked, g.soft], findWildDog: () => g.ents.findWildDog(), mountItem: e => g.ents.mountItem(e),
    getMerchant: () => g.scenery.merchant, virt: g.virt, gp: g.ctl.gp, pollPad: dt => g.ctl.pollPad(dt),
    tryOpen: () => { const o = g.scenery.findChest(); if (o && !g.dead) net.send({ t: 'open', i: o.c.idx }); },
  };
  net.flush();      // berichten die tijdens het laden binnenkwamen (inventaris, snapshots) alsnog verwerken
}
