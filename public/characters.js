// Geanimeerde 3D-figuren (KayKit, CC0 — Kay Lousberg). Alle figuren delen één skelet en één animatiebestand.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const BASE = new URL('./models/', import.meta.url);
const loader = new GLTFLoader();
export const HEROES = [
  { key: 'knight', name: 'Ridder', icon: '🛡️' },
  { key: 'barbarian', name: 'Barbaar', icon: '🪓' },
  { key: 'mage', name: 'Magiër', icon: '🔮' },
  { key: 'rogue', name: 'Schurk', icon: '🗡️' },
];

const templates = new Map();   // naam -> { scene, height }
let clips = null;
const pending = new Map();

const byName = (root, n) => root.getObjectByName(n) || root.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
function load(file) { return new Promise((res, rej) => loader.load(new URL(file, BASE).href, res, undefined, rej)); }

export function loadAnims() {
  if (!pending.has('anims')) pending.set('anims', load('anims.glb').then(g => { clips = Object.fromEntries(g.animations.map(c => [c.name, c])); return clips; }));
  return pending.get('anims');
}
export function loadModel(name) {
  if (!pending.has(name)) pending.set(name, load(name + '.glb').then(g => {
    const scene = g.scene;
    scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; } });
    const box = new THREE.Box3().setFromObject(scene), height = box.max.y - box.min.y;
    const t = { scene, height }; templates.set(name, t); return t;
  }));
  return pending.get(name);
}
export const isReady = name => clips && templates.has(name);

/** Maakt een geanimeerd figuur. height = gewenste lengte in meters. */
export function createRig(name, height = 1.85, shadows = true) {
  const t = templates.get(name); if (!t || !clips) return null;
  const inner = SkeletonUtils.clone(t.scene);
  inner.scale.setScalar(height / t.height);
  inner.rotation.y = Math.PI;                 // modellen kijken naar +Z, het spel naar -Z
  const root = new THREE.Group(); root.add(inner);
  // eigen materiaal per figuur (voor trefferflits)
  inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.userData.own = true; o.castShadow = shadows; } });
  const mixer = new THREE.AnimationMixer(inner);
  const actions = {};
  const act = n => {
    if (!clips[n]) return null;
    return actions[n] || (actions[n] = mixer.clipAction(clips[n]));
  };
  let base = null, oneShot = null, oneShotEnd = 0, locked = false;
  const rig = {
    kind: 'rig', group: root, inner, mixer, height,
    handR: byName(inner, 'handslot.r'), handL: byName(inner, 'handslot.l'), head: byName(inner, 'head'),
    /** Doorlopende basisanimatie (stilstaan, lopen, rennen). */
    loop(n, timeScale = 1) {
      if (locked) return;
      const a = act(n); if (!a) return;
      a.timeScale = timeScale;
      if (base === a) return;
      a.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(0.18).play();
      if (base && !oneShot) base.fadeOut(0.18);
      base = a;
    },
    /** Eénmalige animatie (slaan, geraakt), daarna terug naar de basis. */
    once(n, { speed = 1, hold = false } = {}) {
      if (locked) return;
      const a = act(n); if (!a) return;
      if (oneShot && oneShot !== a) oneShot.fadeOut(0.08);
      a.reset().setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = speed;
      a.setEffectiveWeight(1).fadeIn(0.08).play();
      if (base) base.fadeOut(0.08);
      oneShot = a; oneShotEnd = a.getClip().duration / speed - 0.12;
      if (hold) locked = true;
    },
    unlock() { locked = false; if (oneShot) { oneShot.fadeOut(0.25); oneShot = null; } if (base) base.reset().fadeIn(0.25).play(); },
    update(dt) {
      mixer.update(dt);
      if (oneShot && !locked) {
        oneShotEnd -= dt;
        if (oneShotEnd <= 0) { oneShot.fadeOut(0.15); oneShot = null; if (base) base.reset().fadeIn(0.15).play(); }
      }
    },
    get busy() { return !!oneShot; },
  };
  return rig;
}

/** Laadt alles wat het spel nodig heeft; roept onReady aan zodra een figuur bruikbaar is. */
export function preload(names, onReady) {
  loadAnims().then(() => { for (const n of names) if (templates.has(n)) onReady(n); }).catch(e => console.warn('animaties laden mislukt', e));
  for (const n of names) loadModel(n).then(() => { if (clips) onReady(n); }).catch(e => console.warn('model laden mislukt', n, e));
}
