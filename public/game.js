// Multiplayer-client: rendert de wereld, stuurt invoer naar de server en toont wat de server meldt.
import * as THREE from 'three';
import { createWorld, HALF, WATER, WORLD, mulberry32 } from './world.js';
import { RARITIES, BASES, MONSTERS, ANIMALS, AXE, decodeEq, MAX_SWORDS, SHOP, MAX_POTIONS, DOG_FURS, dogXpNeeded } from './items.js';
  let fishing = null;   // eigen hengel in het water: { x, z, bite }
import * as M from './models.js';
import { openInvite, closeInvite } from './invite.js';

const $ = id => document.getElementById(id);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = t => t * t * (3 - 2 * t);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nextFrame = () => new Promise(r => setTimeout(r, 0));

export async function startGame({ net, joined, user }) {
  const seed = joined.room.seed, myId = joined.you.id;
  const W = createWorld(seed);
  const { heightAt, slopeAt, vnoise } = W;
  const rng = mulberry32(seed * 3 + 1);
  // Telefoon/tablet: aanraakbesturing en lichtere graphics
  const qTouch = new URLSearchParams(location.search).get('touch');
  let isTouch = qTouch === '1' || (qTouch !== '0' && (matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches)));
  const LOW = isTouch;
  if (isTouch) document.body.classList.add('touch');

  /* ================================================================ renderer, scenes */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, LOW ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;
  $('game').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 1200);
  camera.rotation.order = 'YXZ';
  const handScene = new THREE.Scene();
  const handCam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.02, 10);

  const HORIZON = new THREE.Color(0xcfe3ef);
  scene.fog = new THREE.Fog(HORIZON, 70, 270);
  const sunDir = new THREE.Vector3(0.55, 0.62, 0.35).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3d7fd0) }, horizon: { value: HORIZON }, sun: { value: sunDir } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sun; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0, 0.92, 0.7) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);

  scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x9bb872, 1.5));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
  const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 220;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  handScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.6));
  const handSun = new THREE.DirectionalLight(0xfff3dc, 2.4); handSun.position.set(1, 2, 1.5); handScene.add(handSun);

  /* ================================================================ terrein */
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
      let c = grass.map((g, k) => lerp(g, dry[k], sstep(5, 13, h) * 0.6));
      c = c.map((v, k) => lerp(v, sand[k], 1 - sstep(0.2, 1.1, h)));
      const rockT = Math.max(sstep(0.9, 0.7, ny), sstep(13, 17, h));
      c = c.map((v, k) => lerp(v, rock[k], rockT));
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    tGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const terrain = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true; scene.add(terrain);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 3).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x2f6f9a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.86 }));
  water.position.y = WATER; scene.add(water);
  await nextFrame();

  // gras, bloemen, rotsen, wolken (alleen sfeer)
  {
    const dummy = new THREE.Object3D(), c = new THREE.Color();
    const TUFT_N = LOW ? 5000 : 14000, FLOW_N = LOW ? 600 : 1400;
    const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.09, 0.55, 5, 1).translate(0, 0.27, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), TUFT_N);
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 5).translate(0, 0.42, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), FLOW_N);
    let nt = 0, nf = 0;
    for (let tries = 0; tries < 60000 && (nt < TUFT_N || nf < FLOW_N); tries++) {
      const x = (rng() - 0.5) * (WORLD - 20), z = (rng() - 0.5) * (WORLD - 20), h = heightAt(x, z);
      if (h < 0.7 || h > 12 || slopeAt(x, z) > 0.6 || Math.hypot(x - W.shop.x, z - W.shop.z) < 3.6) continue;
      dummy.position.set(x, h - 0.03, z); dummy.rotation.set((rng() - 0.5) * 0.4, rng() * 6.28, (rng() - 0.5) * 0.4);
      const s = 0.45 + rng() * 0.6; dummy.scale.set(s, s * (0.8 + rng() * 0.7), s); dummy.updateMatrix();
      if (nf < FLOW_N && rng() < 0.1) { flowers.setMatrixAt(nf, dummy.matrix); c.setHSL([0.0, 0.12, 0.62, 0.86, 0.15][Math.floor(rng() * 5)], 0.75, 0.62); flowers.setColorAt(nf, c); nf++; }
      else if (nt < TUFT_N) { tufts.setMatrixAt(nt, dummy.matrix); c.setHSL(0.24 + rng() * 0.06, 0.55, 0.22 + rng() * 0.12); tufts.setColorAt(nt, c); nt++; }
    }
    tufts.count = nt; flowers.count = nf; tufts.frustumCulled = false; flowers.frustumCulled = false; scene.add(tufts, flowers);

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
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, depthWrite: false });
    for (let i = 0; i < 22; i++) {
      const g = new THREE.Group(), parts = 4 + Math.floor(rng() * 4);
      for (let k = 0; k < parts; k++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat), s = 9 + rng() * 12;
        m.scale.set(s * 1.3, s * 0.55, s); m.position.set((k - parts / 2) * 11 + rng() * 6, rng() * 3, (rng() - 0.5) * 12); g.add(m);
      }
      g.position.set((rng() - 0.5) * 900, 110 + rng() * 40, (rng() - 0.5) * 900); scene.add(g); clouds.push(g);
    }
  }
  await nextFrame();

  /* ================================================================ bomen en kisten */
  const kit = M.makeTreeKit(seed);
  const treeObjs = W.trees.map(t => {
    const o = M.buildTree(kit, t.type, t.vi, t.scale, t.rotY);
    o.group.position.set(t.x, t.y - 0.1, t.z); scene.add(o.group);
    return { t, ...o, felled: false, fall: null, shake: 0, stump: null };
  });
  function fellInstant(i) {
    const o = treeObjs[i]; if (!o || o.felled) return;
    o.felled = true; o.group.visible = false;
    o.stump = M.buildStump(o.t.scale); o.stump.position.set(o.t.x, o.t.y - 0.1, o.t.z); scene.add(o.stump);
  }
  function fellAnimated(i, dx, dz) {
    const o = treeObjs[i]; if (!o || o.felled || o.fall) return;
    o.fall = { t: 0, dx, dz, landed: false, wait: 0 };
    o.stump = M.buildStump(o.t.scale); o.stump.position.set(o.t.x, o.t.y - 0.1, o.t.z); scene.add(o.stump);
    leaves.emit(o.t.x, o.t.y + o.height * 0.7, o.t.z, 40, 3.5, 2, 2.2); sfx.fall();
  }
  function treeBack(i) {
    const o = treeObjs[i]; if (!o) return;
    if (o.stump) { scene.remove(o.stump); o.stump = null; }
    o.felled = false; o.fall = null; o.group.quaternion.identity(); o.group.rotation.set(0, o.t.rotY, 0); o.group.visible = true;
    if (!o.group.parent) scene.add(o.group);
  }
  const chestObjs = W.chests.map(c => {
    const o = M.buildChest(); o.group.position.set(c.x, c.y - 0.03, c.z); o.group.rotation.y = c.rotY; scene.add(o.group);
    return { c, ...o, opened: false, opening: false, t: 0 };
  });
  function chestOpenInstant(i) { const o = chestObjs[i]; if (!o) return; o.opened = true; o.pivot.rotation.x = -1.9; o.beam.visible = false; }
  function chestReset(i) { const o = chestObjs[i]; if (!o) return; o.opened = false; o.opening = false; o.pivot.rotation.x = 0; o.beam.visible = true; }
  for (const i of joined.felled) fellInstant(i);
  for (const i of joined.chests) chestOpenInstant(i);
  const shopObj = M.buildShop();
  shopObj.group.position.set(W.shop.x, W.shop.y - 0.05, W.shop.z); shopObj.group.rotation.y = W.shop.rotY; scene.add(shopObj.group);
  await nextFrame();

  /* ================================================================ deeltjes en geluid */
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  class Particles {
    constructor(color, size, max, additive = false, gravity = 9) {
      this.max = max; this.gravity = gravity; this.n = 0;
      this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.attr = g.attributes.position;
      this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dotTex, alphaTest: 0.05, sizeAttenuation: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      this.points.frustumCulled = false;
      for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;
      scene.add(this.points);
    }
    emit(x, y, z, count, speed, up = 3, life = 0.8) {
      for (let k = 0; k < count; k++) {
        const i = this.n++ % this.max;
        this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
        const a = Math.random() * 6.28, s = Math.random() * speed;
        this.vel[i * 3] = Math.cos(a) * s; this.vel[i * 3 + 1] = up * (0.4 + Math.random()); this.vel[i * 3 + 2] = Math.sin(a) * s;
        this.life[i] = life * (0.6 + Math.random() * 0.6);
      }
    }
    update(dt) {
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -9999; continue; }
        this.life[i] -= dt; this.vel[i * 3 + 1] -= this.gravity * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      this.attr.needsUpdate = true;
    }
  }
  const chips = new Particles(0xc89a5e, 0.11, 300);
  const leaves = new Particles(0x4c8f36, 0.14, 300, false, 3);
  const sparkles = new Particles(0xffe08a, 0.16, 400, true, -1.5);
  const blood = new Particles(0xb8332d, 0.13, 300, false, 12);
  const splash = new Particles(0xcfeaff, 0.12, 200, false, 9);

  let actx = null;
  const audio = () => { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = false; } } return actx || null; };
  function tone(f, d, type = 'sine', v = 0.08, slide = 0, delay = 0) {
    const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, v = 0.15, fc = 900) {
    const a = audio(); if (!a) return; const len = Math.floor(a.sampleRate * d), buf = a.createBuffer(1, len, a.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = a.createBufferSource(); s.buffer = buf; const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc;
    const g = a.createGain(); g.gain.value = v; s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    swing: () => noise(0.16, 0.06, 2500),
    chop: () => { noise(0.12, 0.28, 700); tone(150, 0.12, 'triangle', 0.22, -70); },
    hit: () => { noise(0.1, 0.22, 1800); tone(220, 0.1, 'square', 0.08, -120); },
    hurt: () => { noise(0.25, 0.3, 500); tone(110, 0.25, 'sawtooth', 0.12, -60); },
    fall: () => { noise(0.9, 0.3, 350); tone(80, 0.6, 'sine', 0.25, -40); },
    creak: () => tone(140, 0.5, 'sawtooth', 0.05, 90),
    bark: (pan = 0, vol = 1) => {
      const a = audio(); if (!a) return;
      for (const [dl, f] of [[0, 520], [0.16, 470]]) {
        const t = a.currentTime + dl, o = a.createOscillator(), g = a.createGain(), p = a.createStereoPanner ? a.createStereoPanner() : null;
        o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.11);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
        const flt = a.createBiquadFilter(); flt.type = 'bandpass'; flt.frequency.value = 900; flt.Q.value = 1.2;
        o.connect(flt).connect(g); if (p) { p.pan.value = pan; g.connect(p).connect(a.destination); } else g.connect(a.destination);
        o.start(t); o.stop(t + 0.15);
      }
    },
    plop: () => { noise(0.12, 0.12, 1400); tone(420, 0.1, 'sine', 0.06, -200); },
    bite: () => { noise(0.25, 0.22, 2200); tone(880, 0.12, 'square', 0.06); tone(1175, 0.16, 'square', 0.06, 0, 0.12); },
    catch: gold => { noise(0.3, 0.2, 1800); for (let i = 0; i < (gold ? 6 : 3); i++) tone(700 + i * 140, 0.14, 'triangle', 0.07, 0, 0.1 + i * 0.07); },
    yelp: () => tone(900, 0.18, 'triangle', 0.06, 500),
    happy: () => { for (let i = 0; i < 4; i++) tone(660 + i * 110, 0.12, 'triangle', 0.06, 0, i * 0.07); },
    coin: () => { tone(988, 0.08, 'square', 0.05); tone(1319, 0.16, 'square', 0.05, 0, 0.08); },
    drink: () => { noise(0.2, 0.1, 900); tone(260, 0.2, 'sine', 0.08, 140); },
    eat: () => { noise(0.08, 0.12, 1200); tone(300, 0.09, 'triangle', 0.08, 120, 0.09); },
    kill: () => tone(180, 0.25, 'triangle', 0.1, -100),
    horn: () => { tone(120, 1.2, 'sawtooth', 0.09, 10); tone(180, 1.2, 'sawtooth', 0.06, 10, 0.02); },
    reveal: ri => { const base = [523, 587, 659, 784, 1047][ri]; for (let i = 0; i < 3 + ri; i++) tone(base * (1 + i * 0.25), 0.5, 'triangle', 0.07, 0, i * 0.09); },
  };

  /* ================================================================ status en HUD */
  const player = { x: joined.you.x, y: joined.you.y, z: joined.you.z, vy: 0, vx: 0, vz: 0, yaw: Math.atan2(-(W.shop.x - joined.you.x), -(W.shop.z - joined.you.z)), pitch: 0, onGround: true, bob: 0 };   // start met zicht op de winkel
  const inv = { wood: 0, meat: 0, potions: 0, fish: 0, up: { shield: 0, axe: 0, rod: 0 }, swords: [], equip: 0, stats: {} };
  const you = { hp: 100, hu: 80, sc: 0, rs: 0 };
  const wave = { n: 0, ph: 0, t: 0, left: 0 };
  const names = new Map(joined.players.map(p => [p.id, p.name]));
  let dead = false, shake = 0, pendingReveal = null, lastPlayers = [];
  const items = () => [AXE, ...inv.swords];

  function toast(html, color = '#fff') {
    const el = document.createElement('div'); el.className = 'toast'; el.style.setProperty('--c', color); el.innerHTML = html;
    $('toasts').prepend(el);
    setTimeout(() => { el.style.opacity = 0; setTimeout(() => el.remove(), 700); }, 5200);
    while ($('toasts').children.length > 5) $('toasts').lastChild.remove();
  }
  let bannerTimer = null;
  function banner(html, ms = 3200) {
    const b = $('banner'); b.innerHTML = html; b.classList.add('on');
    clearTimeout(bannerTimer); bannerTimer = setTimeout(() => b.classList.remove('on'), ms);
  }
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  let myDogHp = null;
  function renderDogChip() {
    const c = $('dogchip'), d = inv.dog;
    c.classList.toggle('on', !!d);
    if (!d) return;
    const down = myDogHp && myDogHp.down;
    c.innerHTML = '🐕 ' + esc(d.name) + ' · nv ' + d.level + (myDogHp ? (down ? ' · rust uit' : ' · ' + myDogHp.hp + '/' + myDogHp.max) : '') + (myDogHp && myDogHp.boost ? ' · <b style="color:#6fe0ff">⚡ ' + myDogHp.boost + ' s</b>' : '') +
      (d.level < 10 ? '<span class="xp"><i style="width:' + Math.round(100 * d.xp / dogXpNeeded(d.level)) + '%"></i></span>' : '');
  }
  function renderInv() {
    $('wood').textContent = '🪵 Hout: ' + inv.wood;
    $('meat').innerHTML = '🍖 Vlees: ' + inv.meat + ' <small style="opacity:.6">(R = eten)</small>';
    renderDogChip();
    $('potion').innerHTML = '🧪 Drank: ' + inv.potions + ' <small style="opacity:.6">(Q)</small>';
    const fc = $('fishchip'); fc.classList.toggle('on', !!(inv.up.rod || inv.fish)); fc.innerHTML = '🐟 Vis: ' + inv.fish + ' <small style="opacity:.6">(G = hond voeren)</small>';
    $('tb-fish').lastElementChild.textContent = inv.fish; $('tb-fish').classList.toggle('off', !inv.dog || !inv.fish);
    $('tb-eat').lastElementChild.textContent = inv.meat; $('tb-drink').lastElementChild.textContent = inv.potions;
    const all = items(), hb = $('hotbar'); hb.innerHTML = '';
    for (let i = 0; i < (isTouch ? Math.max(all.length, 2) : 9); i++) {     // op touch alleen de slots die je hebt
      const it = all[i], d = document.createElement('div');
      d.className = 'slot' + (i === inv.equip ? ' sel' : ''); d.innerHTML = '<small>' + (i + 1) + '</small>';
      if (it) {
        if (it.type === 'axe') d.innerHTML += '🪓';
        else { d.style.color = RARITIES[it.rarity].color; d.innerHTML += '<span class="gem"></span>'; if (i !== inv.equip) d.style.borderColor = RARITIES[it.rarity].color + '88'; }
      } else d.style.opacity = 0.35;
      hb.appendChild(d);
    }
    const cur = all[inv.equip] || AXE;
    $('itemname').innerHTML = cur.type === 'axe' ? '<b>Houthakkersbijl</b> · schade ' + AXE.damage
      : '<b style="color:' + RARITIES[cur.rarity].color + '">' + esc(cur.name) + '</b> · ' + RARITIES[cur.rarity].name + ' · schade ' + cur.damage + ' · snelheid ' + cur.speed;
  }
  function renderVitals() {
    $('hpbar').firstElementChild.style.width = clamp(you.hp, 0, 100) + '%'; $('hpbar').lastElementChild.textContent = 'Gezondheid ' + Math.max(0, Math.round(you.hp));
    $('hubar').firstElementChild.style.width = clamp(you.hu, 0, 100) + '%'; $('hubar').lastElementChild.textContent = 'Honger ' + Math.round(you.hu);
    $('hubar').classList.toggle('low', you.hu < 25);
    $('score').textContent = '⭐ Punten: ' + you.sc;
    const w = $('wave');
    w.classList.toggle('fight', wave.ph === 1);
    w.innerHTML = wave.ph === 1 ? '<b>Golf ' + wave.n + '</b> · ' + wave.left + (wave.left === 1 ? ' vijand' : ' vijanden') + ' over'
      : (wave.n === 0 ? 'Eerste golf begint over <b>' + fmt(wave.t) + '</b>' : 'Golf ' + (wave.n + 1) + ' begint over <b>' + fmt(wave.t) + '</b>');
    $('players').innerHTML = lastPlayers.map(p => '<div class="pl' + (p.dead ? ' dead' : '') + '"><span>' + esc(names.get(p.id) || '?') + (p.id === myId ? ' (jij)' : '') + '</span><span class="hpb"><i style="width:' + clamp(p.id === myId ? you.hp : p.hp, 0, 100) + '%"></i></span></div>').join('');
  }

  /* ================================================================ vastgehouden item */
  const hand = new THREE.Group(); hand.scale.setScalar(0.5); handScene.add(hand);
  let heldMesh = null, heldKey = '';
  function rebuildHeld() {
    const it = items()[inv.equip] || AXE, key = fishing ? 'rod' : it.type === 'axe' ? 'axe' : it.rarity + ':' + it.base;
    if (key === heldKey && heldMesh) return; heldKey = key;
    if (heldMesh) hand.remove(heldMesh);
    heldMesh = fishing ? M.makeRodMesh() : it.type === 'axe' ? M.makeAxeMesh() : M.makeSwordMesh(it);
    heldMesh.traverse(o => { o.castShadow = false; }); hand.add(heldMesh);
  }
  function equipSlot(i) {
    if (i < 0 || i > inv.swords.length) return;
    inv.equip = i; renderInv(); rebuildHeld(); net.send({ t: 'equip', i });
  }

  /* ================================================================ andere wezens */
  const remotes = new Map(), mons = new Map(), anis = new Map();
  const popups = [];
  function makeEntBase(model, type) {
    const g = model.group; scene.add(g);
    return { group: g, model, x: 0, z: 0, y: 0, yaw: 0, tx: 0, tz: 0, ty: 0, tyaw: 0, phase: 0, speed: 0, hp: 1, maxhp: 1, first: true };
  }
  function animateBody(e, dt) {
    const m = e.model, amp = clamp(e.speed / 2.5, 0, 1), s = Math.sin(e.phase) * 0.75 * amp;
    if (m.kind === 'biped') {
      m.legL.rotation.x = s; m.legR.rotation.x = -s; m.armL.rotation.x = -s * 0.8;
      if (e.swingT !== undefined && e.swingT < 1) {
        const t = e.swingT; m.armR.rotation.x = t < 0.25 ? lerp(0, 0.6, ease(t / 0.25)) : lerp(0.6, -2.0, ease(clamp((t - 0.25) / 0.3, 0, 1))) * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      } else m.armR.rotation.x = s * 0.8;
    } else if (m.legs) { m.legs[0].rotation.x = s; m.legs[3].rotation.x = s; m.legs[1].rotation.x = -s; m.legs[2].rotation.x = -s; }
  }
  function moveEnt(e, dt, useTy = false) {
    const k = 1 - Math.exp(-12 * dt), ox = e.x, oz = e.z;
    if (e.first) { e.x = e.tx; e.z = e.tz; e.y = e.ty; e.yaw = e.tyaw; e.first = false; }
    e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k;
    let dy = e.tyaw - e.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; e.yaw += dy * k;
    const gy = heightAt(e.x, e.z); e.y = useTy ? lerp(e.y, e.ty, k) : gy;
    e.group.position.set(e.x, e.y, e.z); e.group.rotation.y = e.yaw;
    const sp = Math.hypot(e.x - ox, e.z - oz) / Math.max(dt, 1e-3);
    e.speed = lerp(e.speed, sp, 0.3); e.phase += Math.min(sp, 12) * dt * (e.model.kind === 'biped' ? 2.4 / (e.scaleF || 1) : 3.4);
  }
  function makeRemote(id) {
    const name = names.get(id) || 'Speler';
    const model = M.buildHumanoid({ cloth: M.colorForName(name) });
    const e = makeEntBase(model); e.id = id; e.eq = -1; e.sw = 0; e.swingT = 1; e.dead = 0;
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
    if (e.item) e.model.mount.remove(e.item);
    const d = decodeEq(code);
    e.item = d.type === 'axe' ? M.makeAxeMesh() : M.makeSwordMesh(d);
    e.item.scale.setScalar(0.7); e.item.rotation.x = -Math.PI / 2 + 0.3; e.item.position.set(0, -0.02, -0.06);
    e.item.traverse(o => { o.castShadow = true; }); e.model.mount.add(e.item);
  }
  function makeMonster(id, type) {
    const model = M.buildMonster(type), e = makeEntBase(model); e.id = id; e.type = type; e.scaleF = type === 2 ? 1.9 : type === 3 ? 3.6 : type === 0 ? 0.85 : 1;
    e.bar = M.makeBar(0.9 + model.height * 0.18); scene.add(e.bar); e.barY = model.height + 0.35;
    if (type === 3) { const l = M.makeLabel(MONSTERS[3].name, '#ff9a6a'); l.position.y = model.height + 1.1; l.scale.multiplyScalar(2.2); e.group.add(l); }
    mons.set(id, e); return e;
  }
  function makeAnimal(id, type) {
    const model = M.buildAnimal(type), e = makeEntBase(model); e.id = id; e.type = type;
    e.bar = M.makeBar(0.7); scene.add(e.bar); e.barY = model.height + 0.3;
    anis.set(id, e); return e;
  }
  function killEnt(map, id) { const e = map.get(id); if (!e) return; scene.remove(e.group); if (e.bar) scene.remove(e.bar); if (e.beam) scene.remove(e.beam); map.delete(id); }
  const dogs = new Map();
  function makeDog(a) {
    const [id, , , , , , owner, , , , fur] = a;
    const model = M.buildDog(DOG_FURS[fur] ?? DOG_FURS[0], owner > 0);
    const e = makeEntBase(model); e.id = id; e.owner = owner; e.bar = M.makeBar(0.7); scene.add(e.bar); e.barY = 1.15; e.labelKey = '';
    dogs.set(id, e); return e;
  }
  function syncDogs(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, x, z, yaw, hp, maxhp, owner, state, level, name, , boost] = a; seen.add(id);
      let e = dogs.get(id);
      if (e && e.owner !== owner) { killEnt(dogs, id); e = null; }
      if (!e) e = makeDog(a);
      e.tx = x; e.tz = z; e.tyaw = yaw; e.hp = hp; e.maxhp = maxhp; e.state = state; e.level = level; e.boost = boost | 0;
      const key = owner ? name + '|' + level + '|' + owner : '';
      if (key !== e.labelKey) {
        e.labelKey = key;
        if (e.label) { e.group.remove(e.label); e.label.material.map.dispose(); e.label = null; }
        if (owner) { const own = owner === myId; e.label = M.makeLabel(name + ' · nv ' + level + (own ? '' : ' (' + (names.get(owner) || '?') + ')'), own ? '#ffd27a' : '#ffffff'); e.label.position.y = 1.25; e.group.add(e.label); }
      }
      if (owner === myId) { const was = myDogHp && myDogHp.down; myDogHp = { hp: hp, max: maxhp, down: state === 2, boost: boost | 0 }; if (was !== myDogHp.down || Math.random() < 0.2) renderDogChip(); }
    }
    for (const id of [...dogs.keys()]) if (!seen.has(id)) killEnt(dogs, id);
    if (inv.dog && ![...dogs.values()].some(e => e.owner === myId)) myDogHp = null;
  }
  function findWildDog() {
    const f = fwd(); let best = null, bd = 1e9;
    for (const e of dogs.values()) {
      if (e.owner) continue;
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > 3.4 || (dx * f.x + dz * f.z) / (d || 1) < 0.3) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function syncList(map, list, make) {
    const seen = new Set();
    for (const a of list) {
      const [id, type, x, z, yaw, hp, maxhp] = a; seen.add(id);
      const e = map.get(id) || make(id, type);
      e.tx = x; e.tz = z; e.tyaw = yaw; e.hp = hp; e.maxhp = maxhp;
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) killEnt(map, id);
  }
  function addPopup(x, y, z, text, color) {
    const s = M.makePopup(text, color); s.position.set(x, y, z); scene.add(s); popups.push({ s, t: 0, x, y, z });
  }

  net.on('s', m => {
    lastPlayers = m.p.map(a => ({ id: a[0], hp: a[5], dead: a[7] }));
    const seen = new Set();
    for (const a of m.p) {
      const [id, x, y, z, yaw, hp, eq, dd, sw] = a;
      if (id === myId) continue;
      seen.add(id);
      const e = remotes.get(id) || makeRemote(id);
      e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.hp = hp; e.dead = dd;
      if (e.eq !== eq) setRemoteEq(e, eq);
      if (e.sw !== sw) { e.sw = sw; e.swingT = 0; }
    }
    for (const id of [...remotes.keys()]) if (!seen.has(id)) killEnt(remotes, id);
    syncList(mons, m.m, makeMonster); syncList(anis, m.a, makeAnimal); if (m.d) syncDogs(m.d);
    Object.assign(you, m.y); Object.assign(wave, m.w);
    if (dead) $('dead-sub').textContent = you.rs > 0 ? 'Terug in het spel over ' + you.rs + ' s' : '';
    renderVitals();
    const hint = $('prompt');
  });
  net.on('inv', m => {
    inv.wood = m.wood; inv.meat = m.meat; inv.potions = m.potions | 0; inv.up = m.up || inv.up; inv.dog = m.dog || null; inv.fish = m.fish | 0; inv.swords = m.swords; inv.equip = m.equip; inv.stats = m.stats || inv.stats;
    renderInv(); rebuildHeld(); if (shopOpen) renderShop();
  });
  net.on('toast', m => toast(esc(m.msg), m.color));
  net.on('pjoin', m => { names.set(m.id, m.name); toast('<b>' + esc(m.name) + '</b> doet mee.', '#6fd37a'); });
  net.on('pleave', m => { const n = names.get(m.id); if (n) toast(esc(n) + ' is vertrokken.', '#bbb'); killEnt(remotes, m.id); names.delete(m.id); });
  net.on('hurt', m => {
    $('vignette').classList.add('on'); setTimeout(() => $('vignette').classList.remove('on'), 90);
    shake = 0.35; sfx.hurt();
  });
  net.on('dead', m => { dead = true; $('dead').classList.add('on'); $('dead-sub').textContent = 'Terug in het spel over ' + m.in + ' s'; });
  net.on('respawn', m => {
    dead = false; $('dead').classList.remove('on');
    player.x = m.x; player.z = m.z; player.y = heightAt(m.x, m.z); player.vx = player.vz = player.vy = 0; player.onGround = true;
    toast('Je bent terug in het spel.', '#6fd37a');
  });
  net.on('wave', m => {
    if (m.ph === 1) {
      banner('GOLF ' + m.n + (m.boss ? '<small>Een baas nadert: ' + MONSTERS[3].name + '</small>' : '<small>' + m.count + ' monsters komen eraan</small>'), 4200);
      sfx.horn();
    } else if (m.wipe) banner('Iedereen is gevallen<small>Golf ' + (m.n + 1) + ' begint opnieuw</small>', 4200);
    else if (m.cleared) banner('Golf ' + m.n + ' verslagen<small>De volgende golf komt over ' + fmt(m.next) + '</small>', 4200);
  });
  net.on('loot', m => {
    if (m.kind === 'wood') toast('🪵 <b>' + m.n + ' hout</b> in de kist.', '#c89a5e');
    else if (m.kind === 'meat') toast('🍖 <b>' + m.n + ' vlees</b> in de kist.', '#e58b7b');
    else if (m.kind === 'empty') toast('De kist is leeg. Alleen stof en spinnenwebben.', '#999');
    else {
      const sw = m.sword, R = RARITIES[sw.rarity];
      let html = '<b>' + esc(sw.name) + '</b><br>' + R.name + ' · schade ' + sw.damage + ' · snelheid ' + sw.speed;
      if (m.res === 'replaced') html += '<br><small>Rugzak vol: ' + esc(m.dropped.name) + ' weggegooid.</small>';
      else if (m.res === 'left') html += '<br><small>Zwakker dan wat je al hebt, achtergelaten.</small>';
      else if (m.auto) html += '<br><small>Nu je beste zwaard, automatisch uitgerust.</small>';
      if (m.src === 'monster') html = 'Buit van een monster!<br>' + html; else if (m.src === 'wave') html = 'Golfbeloning!<br>' + html; else if (m.src === 'shop') html = 'Gekocht in de winkel!<br>' + html;
      toast(html, R.color); sfx.reveal(sw.rarity);
      const co = pendingReveal != null && m.src === 'chest' ? chestObjs[pendingReveal] : null;
      if (co) {
        const mesh = M.makeSwordMesh(sw); mesh.scale.setScalar(1.6); mesh.position.set(co.c.x, co.c.y + 0.8, co.c.z); scene.add(mesh);
        floaters.push({ mesh, t: 0, life: 2.6, x: co.c.x, y: co.c.y, z: co.c.z });
      }
    }
    pendingReveal = null;
  });
  const floaters = [];
  const bobbers = new Map();
  net.on('ev', m => {
    switch (m.k) {
      case 'chop': { const o = treeObjs[m.i]; if (!o) break; o.shake = 0.5; chips.emit(o.t.x, o.t.y + 1.1, o.t.z, 10, 2.6, 3.2, 0.7); leaves.emit(o.t.x, o.t.y + o.height * 0.8, o.t.z, 8, 2.4, 1.5, 1.4); if (Math.hypot(o.t.x - player.x, o.t.z - player.z) < 30) sfx.chop(); break; }
      case 'felled': fellAnimated(m.i, m.dx, m.dz); break;
      case 'treeBack': treeBack(m.i); break;
      case 'chest': { const o = chestObjs[m.i]; if (!o || o.opened) break; o.opened = true; o.opening = true; o.t = 0; o.beam.visible = false; sfx.creak(); if (m.by === myId) pendingReveal = m.i; break; }
      case 'chestBack': chestReset(m.i); break;
      case 'ate': sfx.eat(); break;
      case 'drank': sfx.drink(); break;
      case 'bought': sfx.coin(); break;
      case 'bark': {
        const dx = m.x - player.x, dz = m.z - player.z, d = Math.hypot(dx, dz);
        if (d < 45) { const right = dx * Math.cos(player.yaw) - dz * Math.sin(player.yaw); sfx.bark(clamp(right / Math.max(d, 1), -0.9, 0.9), clamp(1.4 - d / 35, 0.15, 1)); }
        const e = dogs.get(m.id); if (e) e.barkT = 0.35;
        break;
      }
      case 'tamed': {
        sparkles.emit(m.x, heightAt(m.x, m.z) + 0.8, m.z, 40, 1.6, 2.2, 1.4);
        if (m.by === myId) { sfx.happy(); banner('Nieuw maatje!<small>' + esc(m.name) + ' loopt nu met je mee en helpt in gevechten</small>', 4200); }
        else { const n = names.get(m.by); if (n) toast(esc(n) + ' heeft een hond getemd: ' + esc(m.name) + '.', '#f2c14e'); }
        break;
      }
      case 'doghurt': { const e = dogs.get(m.id); if (e && e.owner === myId && Math.hypot(e.x - player.x, e.z - player.z) < 30 && Math.random() < 0.5) sfx.yelp(); break; }
      case 'cast': {
        const b = M.makeBobber(); b.position.set(m.x, WATER, m.z); scene.add(b);
        const old = bobbers.get(m.id); if (old) scene.remove(old.mesh);
        bobbers.set(m.id, { mesh: b, x: m.x, z: m.z, dip: 0, t: 0 });
        if (m.id === myId) { fishing = { x: m.x, z: m.z, bite: false }; rebuildHeld(); sfx.plop(); }
        splash.emit(m.x, WATER + 0.05, m.z, 10, 1.2, 1.8, 0.5);
        break;
      }
      case 'bite': {
        if (fishing) fishing.bite = true;
        const b = bobbers.get(myId); if (b) b.dip = 1.6;
        sfx.bite(); if (navigator.vibrate) try { navigator.vibrate([60, 40, 60]); } catch {}
        break;
      }
      case 'bob': { const b = bobbers.get(m.id); if (b) b.dip = 1.6; break; }
      case 'caught': {
        if (fishing) { splash.emit(fishing.x, WATER + 0.1, fishing.z, m.gold ? 40 : 22, 2, 3.2, 0.8); if (m.gold) sparkles.emit(fishing.x, WATER + 0.5, fishing.z, 30, 1.2, 2.5, 1.2); }
        sfx.catch(m.gold);
        break;
      }
      case 'fishend': {
        const b = bobbers.get(m.id); if (b) { scene.remove(b.mesh); bobbers.delete(m.id); }
        if (m.id === myId) { fishing = null; rebuildHeld(); }
        break;
      }
      case 'dogboost': { const e = dogs.get(m.id); if (e) sparkles.emit(e.x, e.y + 0.6, e.z, 40, 1.4, 2.4, 1.4); if (e && e.owner === myId) sfx.happy(); break; }
      case 'doglvl': { const e = dogs.get(m.id); if (e) sparkles.emit(e.x, e.y + 0.8, e.z, 30, 1.2, 2, 1.2); if (e && e.owner === myId) sfx.happy(); break; }
      case 'hit': {
        const map = m.e === 'm' ? mons : anis, e = map.get(m.id), gy = heightAt(m.x, m.z);
        addPopup(m.x, gy + (e ? e.model.height : 1.2) + 0.5, m.z, m.dmg, m.e === 'm' ? '#ffe08a' : '#ffffff');
        blood.emit(m.x, gy + (e ? e.model.height * 0.5 : 0.7), m.z, 8, 2.2, 2.5, 0.6);
        if (Math.hypot(m.x - player.x, m.z - player.z) < 30) sfx.hit();
        break;
      }
      case 'mdie': killEnt(mons, m.id); blood.emit(m.x, heightAt(m.x, m.z) + 0.8, m.z, 30, 3.2, 3.5, 1); if (Math.hypot(m.x - player.x, m.z - player.z) < 40) sfx.kill(); break;
      case 'adie': killEnt(anis, m.id); blood.emit(m.x, heightAt(m.x, m.z) + 0.4, m.z, 18, 2.5, 3, 0.8); break;
    }
  });
  net.on('_close', () => { /* main.js toont de melding */ });

  /* ================================================================ invoer */
  const keys = {}; let locked = false, soft = false, shopOpen = false;
  const virt = { x: 0, y: 0, sprint: false, toggle: false, attack: false, jump: false, px: 0, py: 0, pattack: false, pjump: false, psprint: false };
  const drag = { down: false, moved: 0 };
  const veil = $('veil');
  function showVeil(on) { veil.classList.toggle('on', on); }
  function enterSoft() { if (locked) return; soft = true; locked = true; showVeil(false); }
  function requestLock() {
    audio(); if (actx && actx.state === 'suspended') actx.resume();
    if (isTouch) {      // geen pointer lock op touch: direct spelen en (waar mogelijk) volledig scherm + landschap
      try { const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape')?.catch?.(() => {})).catch(() => {}); } catch {}
      enterSoft(); return;
    }
    const el = renderer.domElement;
    if (!el.requestPointerLock) { enterSoft(); return; }
    try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(enterSoft); } catch { enterSoft(); }
  }
  $('btn-resume').onclick = requestLock;
  $('btn-leave').onclick = () => { net.send({ t: 'leave' }); setTimeout(() => location.reload(), 150); };
  document.addEventListener('pointerlockerror', enterSoft);
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    if (locked) soft = false;
    showVeil(!locked && !shopOpen);
    if (!locked) for (const k in keys) keys[k] = false;
  });
  document.addEventListener('mousemove', e => {
    if (!locked || isTouch || shopOpen) return;
    if (soft) { if (!drag.down) return; drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); }
    player.yaw -= clamp(e.movementX, -120, 120) * 0.0022;
    player.pitch = clamp(player.pitch - clamp(e.movementY, -120, 120) * 0.0022, -1.45, 1.45);
  });
  document.addEventListener('mousedown', e => {
    if (!locked || e.button !== 0 || isTouch || shopOpen) return;
    if (soft) { drag.down = true; drag.moved = 0; } else startSwing();
  });
  document.addEventListener('mouseup', e => { if (!isTouch && soft && drag.down && e.button === 0) { drag.down = false; if (drag.moved < 6) startSwing(); } });
  document.addEventListener('wheel', e => { if (!locked || shopOpen) return; const n = items().length; equipSlot((inv.equip + (e.deltaY > 0 ? 1 : -1) + n) % n); }, { passive: true });
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space') e.preventDefault();
    if (shopOpen) {
      if (e.code === 'Escape') { closeShop(false); showVeil(!locked); }
      else if (e.code === 'KeyE' || e.code === 'KeyB') closeShop(true);
      return;
    }
    if (!locked) return;
    if (soft && e.code === 'Escape') { locked = false; drag.down = false; showVeil(true); for (const k in keys) keys[k] = false; return; }
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyQ') net.send({ t: 'drink' });
    if (e.code === 'KeyG') feedDog();
    if (e.code === 'KeyR') net.send({ t: 'eat' });
    if (e.code === 'KeyF') startSwing();
    if (/^Digit[1-9]$/.test(e.code)) equipSlot(+e.code[5] - 1);
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight); camera.aspect = handCam.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix(); handCam.updateProjectionMatrix();
  });

  const swing = { t: 1, cd: 0 };
  function startSwing() {
    if (dead || shopOpen || fishing || swing.t < 1 || swing.cd > 0) return;
    const it = items()[inv.equip] || AXE;
    swing.t = 0; swing.cd = 0.5 / (it.speed || 1) * 0.92;
    sfx.swing(); net.send({ t: 'swing' });
  }
  const fwd = () => ({ x: -Math.sin(player.yaw), z: -Math.cos(player.yaw) });
  function findChest() {
    const f = fwd(); let best = null, bd = 1e9;
    for (const o of chestObjs) {
      if (o.opened) continue;
      const dx = o.c.x - player.x, dz = o.c.z - player.z, d = Math.hypot(dx, dz);
      if (d > 3.3 || (dx * f.x + dz * f.z) / (d || 1) < 0.35) continue;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function tryOpen() { if (dead) return; const o = findChest(); if (o) net.send({ t: 'open', i: o.c.idx }); }
  function nearShop() {
    const dx = W.shop.x - player.x, dz = W.shop.z - player.z, d = Math.hypot(dx, dz);
    if (d > 5.6) return false;
    const f = fwd(); return (dx * f.x + dz * f.z) / (d || 1) > 0.15;
  }
  function findWater() {
    const f = fwd();
    for (let d = 2.5; d <= 6.5; d += 0.5) {
      const x = player.x + f.x * d, z = player.z + f.z * d;
      if (heightAt(x, z) < WATER - 0.25) return { x, z };
    }
    return null;
  }
  const feedDog = () => net.send({ t: 'feeddog' });
  function interact() {
    if (fishing) { net.send({ t: 'reel' }); return; } if (dead || shopOpen) return; const wd = findWildDog(); if (wd) net.send({ t: 'tame', id: wd.id }); else if (findChest()) tryOpen(); else if (nearShop()) openShop(); else { const w = inv.up.rod ? findWater() : null; if (w) net.send({ t: 'cast', x: +w.x.toFixed(2), z: +w.z.toFixed(2) }); } }

  /* ================================================================ winkel */
  const shopEl = $('shop');
  function renderShop() {
    $('shop-wood').textContent = '🪵 ' + inv.wood + ' hout';
    let html = '', group = '';
    for (const it of SHOP) {
      if (it.group !== group) { group = it.group; html += (html ? '</div>' : '') + '<div class="shop-group">' + group + '</div><div class="shop-items">'; }
      let state = 'ok', label = 'Koop · ' + it.cost + ' hout';
      if (it.kind === 'shield' || it.kind === 'axe') {
        const cur = inv.up[it.kind];
        if (it.level <= cur) { state = 'owned'; label = 'Gekocht'; } else if (it.level > cur + 1) { state = 'locked'; label = 'Koop eerst niveau ' + (it.level - 1); }
      } else if (it.kind === 'potion' && inv.potions >= MAX_POTIONS) { state = 'owned'; label = 'Vol (' + MAX_POTIONS + ')'; }
      const dis = state !== 'ok' || inv.wood < it.cost;
      const col = it.kind === 'sword' ? RARITIES[it.rarity].color : '';
      html += '<div class="item' + (state === 'owned' ? ' owned' : '') + '"><b>' + (col ? '<span class="rar" style="color:' + col + '"></span>' : '') + esc(it.name) + '</b><small>' + esc(it.desc) + '</small>' +
        '<button class="buy" type="button" data-buy="' + it.id + '"' + (dis ? ' disabled' : '') + '>' + label + '</button></div>';
    }
    $('shop-list').innerHTML = html + '</div>';
  }
  function openShop() {
    if (shopOpen || dead) return;
    shopOpen = true; player.vx = player.vz = 0; virt.x = virt.y = 0; virt.attack = false; virt.jump = false;
    renderShop(); shopEl.classList.add('on'); showVeil(false);
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function closeShop(relock = true) {
    if (!shopOpen) return;
    shopOpen = false; shopEl.classList.remove('on');
    if (relock && !isTouch && !soft) requestLock();
  }
  $('shop-close').onclick = () => closeShop(true);
  $('shop-list').addEventListener('click', e => { const b = e.target.closest('[data-buy]'); if (b && !b.disabled) net.send({ t: 'buy', id: b.dataset.buy }); });

  /* ================================================================ aanraakbesturing */
  function pauseGame() {
    locked = false; virt.x = virt.y = 0; virt.attack = false; virt.jump = false;
    if (document.pointerLockElement) document.exitPointerLock();
    showVeil(true);
  }
  function inviteFromGame() {
    pauseGame();
    openInvite({ roomId: joined.room.id, roomName: joined.room.name });
  }
  $('btn-invite').onclick = () => openInvite({ roomId: joined.room.id, roomName: joined.room.name });
  const cycleWeapon = d => { const n = items().length; if (n > 1) equipSlot((inv.equip + d + n) % n); };

  function setupTouch() {
    const tz = $('tz'), stick = $('stick'), knob = $('joyknob'), R = 58;
    let joyId = null, ox = 0, oy = 0, lookId = null, lx = 0, ly = 0;
    const home = () => { stick.style.left = stick.style.top = stick.style.bottom = ''; stick.classList.remove('active', 'float'); knob.style.transform = ''; };
    tz.addEventListener('pointerdown', e => {
      if (!locked || dead || shopOpen) return;
      e.preventDefault(); try { tz.setPointerCapture(e.pointerId); } catch {}
      if (e.clientX < innerWidth * 0.45 && joyId === null) {
        joyId = e.pointerId;
        const r = stick.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (Math.hypot(e.clientX - cx, e.clientY - cy) < r.width * 0.75) { ox = cx; oy = cy; }       // op de stick: vaste plek
        else {                                                                                   // ergens anders links: stick springt naar je duim
          ox = e.clientX; oy = e.clientY; stick.classList.add('float');
          stick.style.left = (ox - r.width / 2) + 'px'; stick.style.top = (oy - r.height / 2) + 'px'; stick.style.bottom = 'auto';
        }
        stick.classList.add('active'); move(e);
      } else if (lookId === null) { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
    });
    function move(e) {
      let dx = e.clientX - ox, dy = e.clientY - oy; const d = Math.hypot(dx, dy);
      virt.sprint = d > R * 1.25;
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      virt.x = dx / R; virt.y = dy / R; knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    }
    tz.addEventListener('pointermove', e => {
      if (e.pointerId === joyId) move(e);
      else if (e.pointerId === lookId) {
        player.yaw -= (e.clientX - lx) * 0.0052; player.pitch = clamp(player.pitch - (e.clientY - ly) * 0.0052, -1.45, 1.45);
        lx = e.clientX; ly = e.clientY;
      }
    });
    const end = e => {
      if (e.pointerId === joyId) { joyId = null; virt.x = virt.y = 0; virt.sprint = false; home(); }
      if (e.pointerId === lookId) lookId = null;
    };
    tz.addEventListener('pointerup', end); tz.addEventListener('pointercancel', end);
    const press = (id, down, up) => {
      const b = $(id);
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); if (navigator.vibrate) try { navigator.vibrate(8); } catch {} down(); });
      const rel = () => { if (b.classList.contains('down')) { b.classList.remove('down'); if (up) up(); } };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    };
    press('tb-atk', () => { virt.attack = true; startSwing(); }, () => { virt.attack = false; });
    press('tb-jump', () => { virt.jump = true; }, () => { virt.jump = false; });
    press('tb-use', () => interact());
    press('tb-eat', () => net.send({ t: 'eat' }));
    press('tb-drink', () => net.send({ t: 'drink' }));
    press('tb-fish', feedDog);
    press('tb-sprint', () => { virt.toggle = !virt.toggle; $('tb-sprint').classList.toggle('on', virt.toggle); });
    press('tb-next', () => cycleWeapon(1));
    press('tb-menu', () => { home(); pauseGame(); });
    press('tb-invite', () => { home(); inviteFromGame(); });
    $('hotbar').addEventListener('pointerdown', e => { const sl = e.target.closest('.slot'); if (sl) { e.preventDefault(); equipSlot([...$('hotbar').children].indexOf(sl)); } });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ================================================================ echte controller (Gamepad API) */
  const gp = { prev: [], idx: null };
  addEventListener('gamepadconnected', e => { gp.idx = e.gamepad.index; document.body.classList.add('padconnected'); toast('🎮 Controller verbonden. Druk op Start om te spelen.', '#6fd37a'); });
  addEventListener('gamepaddisconnected', e => {
    if (gp.idx === e.gamepad.index) { gp.idx = null; document.body.classList.remove('padconnected'); virt.px = virt.py = 0; virt.pattack = virt.pjump = virt.psprint = false; toast('Controller losgekoppeld.', '#bbb'); }
  });
  function pollPad(dt) {
    if (gp.idx === null || !navigator.getGamepads) return;
    const p = navigator.getGamepads()[gp.idx]; if (!p) return;
    const dz = v => Math.abs(v || 0) < 0.18 ? 0 : v;
    const b = i => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
    const hit = i => b(i) && !gp.prev[i];
    if (hit(9)) {                                     // Start: pauze aan/uit
      if ($('invite').classList.contains('on')) closeInvite();
      else if (shopOpen) closeShop(false);
      else if (locked) pauseGame(); else { showVeil(false); enterSoft(); }
    }
    if (shopOpen && hit(1)) closeShop(false);
    if (locked && !dead && !shopOpen) {
      virt.px = dz(p.axes[0]); virt.py = dz(p.axes[1]);
      player.yaw -= dz(p.axes[2]) * 2.6 * dt; player.pitch = clamp(player.pitch - dz(p.axes[3]) * 2.0 * dt, -1.45, 1.45);
      virt.pattack = b(0) || b(7); virt.pjump = b(1); virt.psprint = b(10);
      if (hit(2)) interact();
      if (hit(3)) net.send({ t: 'eat' });
      if (hit(6)) net.send({ t: 'drink' });
      if (hit(12)) feedDog();
      if (hit(4)) cycleWeapon(-1);
      if (hit(5)) cycleWeapon(1);
    } else { virt.px = virt.py = 0; virt.pattack = virt.pjump = virt.psprint = false; }
    gp.prev = p.buttons.map((_, i) => b(i));
  }
  if (isTouch) setupTouch();
  else addEventListener('touchstart', function onFirstTouch() {       // touchscreen op een laptop of onbekend toestel: overlay alsnog aanzetten
    removeEventListener('touchstart', onFirstTouch);
    if (isTouch) return;
    isTouch = true; document.body.classList.add('touch'); setupTouch(); renderInv();
    $('btn-resume').textContent = 'Tik om te starten';
  }, { passive: true });

  /* ================================================================ update */
  let sendT = 0;
  function update(dt, time) {
    pollPad(dt);
    if (locked && !dead && !shopOpen) {
      const f = fwd(), rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
      const iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0) - virt.y - virt.py;   // joystick omhoog = vooruit
      const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + virt.x + virt.px;
      let wx = f.x * iz + rx * ix, wz = f.z * iz + rz * ix;
      let wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
      const run = keys.ShiftLeft || keys.ShiftRight || virt.sprint || virt.toggle || virt.psprint;
      const sp = (run ? 9 : 5.4) * wl, k = Math.min(1, dt * (player.onGround ? 11 : 2.5));
      player.vx += (wx * sp - player.vx) * k; player.vz += (wz * sp - player.vz) * k;
      let nx = player.x + player.vx * dt, nz = player.z + player.vz * dt;
      const deep = (x, z) => heightAt(x, z) < WATER - 0.35;
      if (deep(nx, player.z)) nx = player.x; if (deep(nx, nz)) nz = player.z;
      const lim = HALF - 10, rr = Math.hypot(nx, nz); if (rr > lim) { nx *= lim / rr; nz *= lim / rr; }
      W.gNear(nx, nz, o => {
        if (o.type && treeObjs[o.idx].felled) return;
        const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz), min = o.r + 0.38;
        if (d < min && d > 0.0001) { nx = o.x + dx / d * min; nz = o.z + dz / d * min; }
      });
      player.x = nx; player.z = nz;
      const gnd = heightAt(player.x, player.z);
      if (player.onGround) {
        if (gnd < player.y - 0.7) player.onGround = false;
        else { player.y = gnd; if (keys.Space || virt.jump || virt.pjump) { player.vy = 7.6; player.onGround = false; } }
      }
      if (!player.onGround) { player.vy -= 22 * dt; player.y += player.vy * dt; if (player.y <= gnd && player.vy <= 0) { player.y = gnd; player.vy = 0; player.onGround = true; } }
      player.bob += Math.hypot(player.vx, player.vz) * dt * 1.7;
    }
    const speed = Math.hypot(player.vx, player.vz);
    const bobY = player.onGround ? Math.sin(player.bob * 2) * 0.045 * Math.min(1, speed / 5) : 0;
    shake = Math.max(0, shake - dt);
    const eye = dead ? 0.4 : 1.7;
    camera.position.set(player.x + (Math.random() - 0.5) * shake * 0.2, player.y + eye + bobY, player.z + (Math.random() - 0.5) * shake * 0.2);
    camera.rotation.y = player.yaw; camera.rotation.x = dead ? -0.9 : player.pitch;
    sun.position.set(player.x + sunDir.x * 100, sunDir.y * 100 + player.y, player.z + sunDir.z * 100);
    sun.target.position.set(player.x, player.y, player.z); sky.position.copy(camera.position);

    // positie naar de server (15x per seconde)
    sendT += dt;
    if (sendT >= 1 / 15) { sendT = 0; if (!dead) net.send({ t: 'in', x: +player.x.toFixed(2), y: +player.y.toFixed(2), z: +player.z.toFixed(2), yaw: +player.yaw.toFixed(3), pitch: +player.pitch.toFixed(3) }); }

    // zwaai-animatie (eigen hand)
    const it = items()[inv.equip] || AXE;
    swing.cd = Math.max(0, swing.cd - dt);
    if (swing.t < 1) swing.t = Math.min(1, swing.t + dt * (it.speed || 1) / 0.5);
    const t = swing.t; let off = 0, thrust = 0;
    if (t < 1) {
      if (t < 0.2) off = lerp(0, 0.4, ease(t / 0.2));
      else if (t < 0.45) { const u = ease((t - 0.2) / 0.25); off = lerp(0.4, -1.25, u); thrust = u; }
      else { off = lerp(-1.25, 0, ease((t - 0.45) / 0.55)); thrust = 1 - ease((t - 0.45) / 0.55); }
    }
    const sway = Math.sin(player.bob * 2) * 0.012 * Math.min(1, speed / 5);
    hand.position.set(0.34 + sway, -0.3 + Math.abs(sway) - thrust * 0.05, -0.55 - thrust * 0.1);
    hand.rotation.set(-0.35 + off, -0.25 * thrust, 0.32 - thrust * 0.5 + (it.type === 'sword' ? 0.1 : 0));
    hand.visible = !dead;

    // wezens
    for (const e of remotes.values()) {
      moveEnt(e, dt, true);
      if (e.swingT < 1) e.swingT = Math.min(1, e.swingT + dt / 0.45);
      animateBody(e, dt);
      e.group.rotation.z = e.dead ? Math.PI / 2 : 0; if (e.dead) e.group.position.y += 0.25;
      if (e.beam) {
        const d = Math.hypot(e.x - player.x, e.z - player.z);
        const k = clamp((d - 10) / 15, 0, 1) * (e.dead ? 0.45 : 1) * (0.88 + Math.sin(time * 3 + e.id) * 0.12);
        e.beam.visible = k > 0.02;
        if (e.beam.visible) {
          e.beam.position.set(e.x, e.y, e.z);
          const [o1, o2] = e.beam.userData.base; e.beam.children[0].material.opacity = o1 * k; e.beam.children[1].material.opacity = o2 * k;
          const w = 1 + d / 22; e.beam.children[0].scale.set(w, 1, w); e.beam.children[1].scale.set(w, 1, w);   // verre zuilen iets breder, zodat ze zichtbaar blijven
          const lab = e.beamLabel; lab.position.y = 3.5 + d * 0.06; lab.material.opacity = Math.min(1, k * 1.3);
          lab.scale.set(lab.userData.sx * (1 + d / 11), lab.userData.sy * (1 + d / 11), 1);
          lab.material.map.needsUpdate = false;
        }
      }
    }
    for (const e of mons.values()) {
      moveEnt(e, dt); animateBody(e, dt);
      e.bar.visible = e.hp < e.maxhp || e.type === 3;
      if (e.bar.visible) { e.bar.position.set(e.x, e.y + e.barY, e.z); e.bar.quaternion.copy(camera.quaternion); M.setBar(e.bar, e.hp / e.maxhp); }
    }
    for (const e of dogs.values()) {
      moveEnt(e, dt);
      const mdl = e.model, down = e.state === 2, sit = e.state === 3;
      if (!down && !sit) animateBody(e, dt); else for (const l of mdl.legs) l.rotation.x = 0;
      mdl.body.rotation.x = sit ? 0.5 : 0; mdl.body.position.y = sit ? 0.12 : 0;
      if (sit) { mdl.legs[2].rotation.x = mdl.legs[3].rotation.x = -1.1; mdl.legs[0].rotation.x = mdl.legs[1].rotation.x = -0.45; }
      e.group.rotation.z = down ? 1.35 : 0; if (down) e.group.position.y += 0.12;
      const happy = !down && (sit || (e.owner && e.speed < 1.5));
      mdl.tail.rotation.z = Math.sin(time * (happy ? 16 : 7)) * (happy ? 0.7 : 0.25);
      mdl.tongue.visible = !down;
      mdl.aura.visible = e.boost > 0 && !down; if (mdl.aura.visible) { mdl.aura.rotation.z += dt * 3; mdl.aura.scale.setScalar(1 + Math.sin(time * 6) * 0.08); if (Math.random() < 0.15) sparkles.emit(e.x, e.y + 0.4, e.z, 1, 0.5, 1, 0.8); }
      if (e.barkT > 0) { e.barkT -= dt; mdl.head.rotation.x = -Math.abs(Math.sin(e.barkT * 18)) * 0.3; } else mdl.head.rotation.x = down ? 0 : Math.sin(time * 2 + e.id) * 0.05;
      e.bar.visible = !!e.owner && (e.hp < e.maxhp || down);
      if (e.bar.visible) { e.bar.position.set(e.x, e.y + e.barY, e.z); e.bar.quaternion.copy(camera.quaternion); M.setBar(e.bar, e.hp / e.maxhp); }
      if (e.label) e.label.visible = Math.hypot(e.x - player.x, e.z - player.z) < 40;
    }
    for (const e of anis.values()) {
      moveEnt(e, dt); animateBody(e, dt);
      e.bar.visible = e.hp < e.maxhp;
      if (e.bar.visible) { e.bar.position.set(e.x, e.y + e.barY, e.z); e.bar.quaternion.copy(camera.quaternion); M.setBar(e.bar, e.hp / e.maxhp); }
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.t += dt; p.s.position.y = p.y + p.t * 1.6; p.s.material.opacity = 1 - clamp((p.t - 0.5) / 0.4, 0, 1);
      if (p.t > 0.9) { scene.remove(p.s); p.s.material.map.dispose(); p.s.material.dispose(); popups.splice(i, 1); }
    }

    // bomen
    for (const o of treeObjs) {
      if (o.felled) continue;
      if (o.fall) {
        const f = o.fall;
        if (!f.landed) {
          f.t += dt / 1.3; const a = Math.pow(Math.min(1, f.t), 2.2) * (Math.PI / 2 * 0.985);
          o.group.quaternion.setFromAxisAngle(new THREE.Vector3(f.dz, 0, -f.dx), a).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.t.rotY));
          if (f.t >= 1) { f.landed = true; chips.emit(o.t.x + f.dx * 3, o.t.y + 0.4, o.t.z + f.dz * 3, 30, 4, 2, 1); leaves.emit(o.t.x + f.dx * 3, o.t.y + 0.6, o.t.z + f.dz * 3, 20, 3, 1.5, 1.5); }
        } else { f.wait += dt; if (f.wait > 1.4) { scene.remove(o.group); o.felled = true; o.group.visible = false; } }
      } else if (o.shake > 0) {
        o.shake = Math.max(0, o.shake - dt); const s = Math.sin(time * 42) * o.shake * 0.05; o.group.rotation.x = s; o.group.rotation.z = -s * 0.7;
      }
    }
    if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) for (const o of treeObjs) if (!o.felled && !o.fall) o.group.visible = Math.hypot(o.t.x - player.x, o.t.z - player.z) < 250;

    // kisten
    for (const o of chestObjs) {
      if (o.opening) { o.t += dt; o.pivot.rotation.x = -ease(Math.min(1, o.t / 0.7)) * 1.9; if (o.t > 1) o.opening = false; }
      else if (!o.opened && o.beam.visible) o.beam.scale.x = o.beam.scale.z = 1 + Math.sin(time * 2 + o.c.idx) * 0.12;
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const e = floaters[i]; e.t += dt;
      e.mesh.position.y = e.y + 0.8 + ease(Math.min(1, e.t / 1.2)) * 1.2 + Math.sin(e.t * 3) * 0.05; e.mesh.rotation.y += dt * 2.6; e.mesh.rotation.z = 0.25;
      if (e.t > e.life - 0.5) e.mesh.scale.setScalar(Math.max(0.001, (e.life - e.t) / 0.5 * 1.6));
      if (Math.random() < 0.5) sparkles.emit(e.x, e.mesh.position.y, e.z, 1, 0.6, 0.4, 1);
      if (e.t > e.life) { scene.remove(e.mesh); floaters.splice(i, 1); }
    }

    // aanwijzing
    if ((virt.attack || virt.pattack) && locked && !dead && !shopOpen) startSwing();
    const wd = locked && !dead && !shopOpen ? findWildDog() : null;
    const pr = $('prompt'), ch = !wd && locked && !dead && !shopOpen ? findChest() : null, sh = !wd && !ch && locked && !dead && !shopOpen && nearShop();
    const wat = !fishing && !wd && !ch && !sh && locked && !dead && !shopOpen && Math.floor(time * 4) !== Math.floor((time - dt) * 4) ? findWater() : (update.lastWat || null);
    if (!fishing && !wd && !ch && !sh && locked && !dead && !shopOpen) update.lastWat = wat; else update.lastWat = null;
    if (isTouch) { const tb = $('tb-use'); const fishOk = fishing || (wat && inv.up.rod); tb.classList.toggle('dim', !(ch || sh || wd || fishOk)); tb.firstElementChild.textContent = fishing ? '🎣' : wd ? '🐕' : sh ? '🏪' : ch ? '🧰' : fishOk ? '🎣' : '✋'; }
    if (fishing && locked && !dead) {
      pr.innerHTML = fishing.bite ? '<b style="color:#ffd27a;font-size:1.25em">Beet! ' + (isTouch ? 'Tik nu op X' : 'Druk nu op E') + '</b>' : 'Wachten op een beet… ' + (isTouch ? '(X = binnenhalen)' : '(<b>E</b> = binnenhalen)');
      pr.classList.add('on');
    } else if (!wd && !ch && !sh && update.lastWat) {
      pr.innerHTML = inv.up.rod ? (isTouch ? 'Vissen (X)' : '<b>E</b> · vissen') : 'Hier kun je vissen. Koop een vishengel in de winkel.'; pr.classList.add('on');
    } else
    if (wd) {
      const txt = inv.dog ? 'Je hebt al een hond' : inv.meat > 0 ? 'hond vlees geven en temmen' : 'Deze hond wil vlees. Jaag eerst op een dier.';
      pr.innerHTML = inv.dog || inv.meat <= 0 ? txt : (isTouch ? 'Hond temmen (1 vlees)' : '<b>E</b> · ' + txt); pr.classList.add('on');
    } else
    if (ch) { pr.innerHTML = isTouch ? 'Kist openen' : '<b>E</b> · kist openen'; pr.classList.add('on'); }
    else if (sh) { pr.innerHTML = isTouch ? 'Winkel openen' : '<b>E</b> · winkel openen'; pr.classList.add('on'); }
    else if (locked && !dead && !shopOpen && you.hu < 35) { pr.innerHTML = inv.meat > 0 ? '<b>R</b> · vlees eten (je hebt honger)' : 'Je hebt honger. Jaag op konijnen, herten en everzwijnen.'; pr.classList.add('on'); }
    else pr.classList.remove('on');

    if (Math.floor(time * 5) !== Math.floor((time - dt) * 5)) {
      const dx = W.shop.x - player.x, dz = W.shop.z - player.z, d = Math.hypot(dx, dz), chip = $('shopchip');
      chip.classList.add('on');
      if (d < 9) chip.textContent = '🏪 Winkel hier';
      else {
        const f = fwd(), ang = Math.atan2(dx * Math.cos(player.yaw) + dz * -Math.sin(player.yaw), dx * f.x + dz * f.z) * 180 / Math.PI;
        chip.innerHTML = '<span class="arr" style="transform:rotate(' + ang.toFixed(0) + 'deg)">▲</span>🏪 Winkel · ' + Math.round(d) + ' m';
      }
    }
    for (const b of bobbers.values()) {
      b.t += dt; if (b.dip > 0) b.dip = Math.max(0, b.dip - dt);
      const dip = b.dip > 0 ? -0.12 - Math.abs(Math.sin(b.t * 22)) * 0.1 : 0;
      b.mesh.position.y = WATER + Math.sin(time * 0.6) * 0.06 + Math.sin(b.t * 2.4) * 0.025 + dip;
      const r = b.mesh.userData.ring; r.scale.setScalar(1 + (b.t * 0.8 % 1) * 2); r.material.opacity = 0.5 * (1 - (b.t * 0.8 % 1));
      if (b.dip > 0 && Math.random() < 0.3) splash.emit(b.x, WATER + 0.05, b.z, 2, 0.8, 1.2, 0.4);
    }
    for (const c of clouds) { c.position.x += dt * 2.2; if (c.position.x > 480) c.position.x = -480; }
    water.position.y = WATER + Math.sin(time * 0.6) * 0.06;
    chips.update(dt); leaves.update(dt); sparkles.update(dt); blood.update(dt); splash.update(dt);
  }

  /* ================================================================ start */
  renderInv(); renderVitals(); rebuildHeld();
  $('hud').classList.add('on');
  $('veil').querySelector('h2').textContent = 'Welkom, ' + user;
  $('veil').querySelector('p').textContent = 'Kamer: ' + joined.room.name + '. Klik om te beginnen. Het spel loopt door als je pauzeert.';
  $('btn-resume').textContent = isTouch ? 'Tik om te starten' : 'Start';
  showVeil(true);
  setTimeout(() => { if (!inv.dog) toast('Ergens in het bos zwerven honden. Hoor je geblaf? Geef een hond een stuk vlees en hij wordt je maatje.', '#c8903f'); }, 25000);
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!(window.__game && window.__game.pause)) update(dt, now / 1000);
    if (!(window.__game && window.__game.pause) || window.__game.forceRender) { renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(handScene, handCam); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__game = { findWater, bobbers, getFishing: () => fishing, feedDog, renderer, camera, dogs, findWildDog, pollPad, gp, isTouch, virt, openShop, closeShop, interact, W, pause: false, forceRender: false, update, player, inv, you, wave, remotes, mons, anis, treeObjs, chestObjs, W, net, startSwing, tryOpen, renderOnce: () => { renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(handScene, handCam); } };
  net.flush();      // berichten die tijdens het laden binnenkwamen (inventaris, snapshots) alsnog verwerken
}
