// Grafische laag: dag en nacht, lucht met sterren en maan, licht, water, wind, vuurvliegjes,
// nabewerking (gloed) en een kwaliteitsinstelling. game.js blijft verantwoordelijk voor de spelwereld.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const C = h => new THREE.Color(h);

export const CYCLE_SEC = 1200;          // één dag + nacht = 20 minuten
const DAY_FRAC = 0.7;                   // 70% dag, 30% nacht

export const QUALITY = {
  laag:   { label: 'Laag',   pr: 1,   shadow: 1024, bloom: false, grass: 0.35, flies: 40 },
  middel: { label: 'Middel', pr: 1.5, shadow: 2048, bloom: true,  grass: 0.7,  flies: 90 },
  hoog:   { label: 'Hoog',   pr: 2,   shadow: 2048, bloom: true,  grass: 1,    flies: 140 },
};

const NOISE_GLSL = `
  float gh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gvn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(gh21(i), gh21(i + vec2(1., 0.)), f.x), mix(gh21(i + vec2(0., 1.)), gh21(i + vec2(1., 1.)), f.x), f.y); }
`;

export function createGraphics({ renderer, scene, camera, handScene, handCam, quality, serverOffset = 0 }) {
  const uTime = { value: 0 };
  let q = QUALITY[quality] ? quality : 'hoog';
  let forcedT = null;                   // voor testen: vaste tijd van de dag (0..1)

  /* ---------------------------------------------------------------- lucht */
  const skyU = {
    uSun: { value: new THREE.Vector3(0, 1, 0) }, uMoon: { value: new THREE.Vector3(0, -1, 0) },
    uTop: { value: C(0x3d7fd0) }, uHor: { value: C(0xcfe3ef) }, uGlow: { value: C(0xf2a46a) },
    uNight: { value: 0 }, uTwilight: { value: 0 }, uTime,
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uSun, uMoon, uTop, uHor, uGlow; uniform float uNight, uTwilight, uTime; varying vec3 vDir;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(uHor, uTop, pow(h, 0.5));
        c = mix(c, uHor * 0.55, clamp(-d.y * 3.0, 0.0, 1.0));                    // onder de horizon iets donkerder
        // gloed van zonsopkomst en -ondergang aan de kant van de zon
        vec2 dh = normalize(d.xz + 1e-4), sh = normalize(uSun.xz + 1e-4);
        float side = pow(max(dot(dh, sh), 0.0), 3.0) * (1.0 - clamp(d.y * 2.5, 0.0, 1.0));
        c += uGlow * side * uTwilight * 0.9;
        // zon
        float sd = dot(d, uSun), sunUp = smoothstep(-0.08, 0.02, uSun.y);
        c += vec3(1.0, 0.9, 0.7) * (smoothstep(0.9990, 0.9995, sd) * 6.0 + pow(max(sd, 0.0), 14.0) * 0.25) * sunUp;
        // maan en sterren
        float md = dot(d, uMoon);
        c += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9993, 0.9996, md) * 2.5 + pow(max(md, 0.0), 300.0) * 0.25) * uNight;
        vec3 sp = d * 220.0, cell = floor(sp);
        float st = step(0.9972, h31(cell)) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5));
        st *= 0.55 + 0.45 * sin(uTime * 2.3 + h31(cell + 7.0) * 30.0);
        c += vec3(0.9, 0.95, 1.0) * st * uNight * smoothstep(0.0, 0.15, d.y) * 1.6;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
  scene.fog = new THREE.Fog(0xcfe3ef, 70, 270);

  /* ---------------------------------------------------------------- licht */
  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x9bb872, 1.5); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d2, 2.6);
  key.castShadow = true; key.shadow.mapSize.set(QUALITY[q].shadow, QUALITY[q].shadow);
  const sc = key.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 240;
  key.shadow.bias = -0.0006; key.shadow.normalBias = 0.06;
  scene.add(key, key.target);
  const handHemi = new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.6); handScene.add(handHemi);
  const handKey = new THREE.DirectionalLight(0xfff3dc, 2.4); handKey.position.set(1, 2, 1.5); handScene.add(handKey);
  const lanterns = [];   // puntlichten die 's nachts aangaan

  /* ---------------------------------------------------------------- wolken */
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.55, transparent: true, opacity: 0.9, depthWrite: false, fog: false });

  /* ---------------------------------------------------------------- water */
  let water = null;
  const waterU = {
    uTime, uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uLightCol: { value: C(0xffffff) },
    uTop: skyU.uTop, uHor: skyU.uHor, uDeep: { value: C(0x0f3f63) }, uShallow: { value: C(0x2f8aa0) },
    uHeight: { value: null }, uWorld: { value: 420 }, uWaterY: { value: -2.2 }, uAmbient: { value: 1 }, uNight: skyU.uNight,
  };
  function createWater({ heightAt, WORLD, WATER }) {
    // hoogtekaart van het terrein rond het waterpeil (voor ondiep water en schuim langs de kust)
    const N = 256, data = new Uint8Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * WORLD, z = (j / (N - 1) - 0.5) * WORLD;
      const v = clamp((heightAt(x, z) - WATER + 8) / 16, 0, 1) * 255, o = (j * N + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, N, N); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    waterU.uHeight.value = tex; waterU.uWorld.value = WORLD; waterU.uWaterY.value = WATER;
    const mat = new THREE.ShaderMaterial({
      transparent: true, fog: true, depthWrite: false,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
      vertexShader: `
        varying vec3 vW;
        #include <fog_pars_vertex>
        void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform float uTime, uWorld, uWaterY, uAmbient, uNight; uniform vec3 uLightDir, uLightCol, uTop, uHor, uDeep, uShallow; uniform sampler2D uHeight;
        varying vec3 vW;
        #include <fog_pars_fragment>
        ${NOISE_GLSL}
        void main(){
          vec2 p = vW.xz; float t = uTime;
          vec2 d1 = normalize(vec2(1.0, 0.3)), d2 = normalize(vec2(-0.4, 1.0)), d3 = normalize(vec2(0.7, -0.8));
          vec2 g = d1 * cos(dot(d1, p) * 0.35 + t * 1.1) * 0.028 + d2 * cos(dot(d2, p) * 0.6 + t * 1.5) * 0.03 + d3 * cos(dot(d3, p) * 1.3 + t * 2.3) * 0.032;
          g += vec2(gvn(p * 1.7 + t * 0.6) - gvn(p * 1.7 - t * 0.5 + 3.1), gvn(p * 2.3 + t * 0.4) - gvn(p * 2.1 - t * 0.45 + 7.7)) * 0.09;
          float dist = length(cameraPosition - vW);
          g *= mix(1.0, 0.18, smoothstep(15.0, 110.0, dist));
          vec3 n = normalize(vec3(-g.x * 3.0, 1.0, -g.y * 3.0));
          vec3 V = normalize(cameraPosition - vW);
          float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 R = reflect(-V, n);
          vec3 skyc = mix(uHor, uTop, clamp(R.y * 1.4, 0.0, 1.0));
          vec2 uv = p / uWorld + 0.5;
          float th = uWaterY - 8.0;
          if (uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0) th = texture2D(uHeight, uv).r * 16.0 - 8.0 + uWaterY;
          float depth = uWaterY - th;
          vec3 base = mix(uShallow, uDeep, smoothstep(0.2, 4.5, depth)) * uAmbient;
          vec3 col = mix(base, skyc, fres * 0.8);
          col += uLightCol * pow(max(dot(R, uLightDir), 0.0), 220.0) * 2.5 * mix(1.0, 0.4, smoothstep(30.0, 150.0, dist));
          float band = 1.0 - smoothstep(0.0, 0.6, depth);
          float fn = gvn(p * 3.0 + t * 0.8) * 0.6 + gvn(p * 7.0 - t * 0.6) * 0.4;
          float foam = band * smoothstep(0.45, 0.8, fn + band * 0.35 + sin(depth * 9.0 - t * 2.0) * 0.12);
          col = mix(col, vec3(0.93, 0.97, 1.0) * mix(1.0, 0.35, uNight), foam * 0.85);
          float alpha = max(mix(0.5, 0.92, smoothstep(0.0, 1.6, depth)), foam * 0.9);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    Object.assign(mat.uniforms, waterU);
    water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 3, WORLD * 3, 1, 1).rotateX(-Math.PI / 2), mat);
    water.position.y = WATER; water.renderOrder = 2;
    scene.add(water);
    return water;
  }

  /* ---------------------------------------------------------------- wind en terreindetail */
  function wind(material, kind) {
    material.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wo = instanceMatrix[3].xz;
        #else
          vec2 wo = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        #endif
        ${kind === 'grass'
          ? 'float sway = sin(uTime * 1.9 + wo.x * 0.35 + wo.y * 0.25) * 0.10 + sin(uTime * 3.7 + wo.x * 0.9) * 0.03; transformed.x += sway * position.y; transformed.z += sway * 0.6 * position.y;'
          : 'float sw = sin(uTime * 1.2 + wo.x * 0.2 + wo.y * 0.3); transformed += vec3(sw, 0.0, cos(uTime * 1.05 + wo.x * 0.25)) * 0.05 * (0.4 + position.y * 0.3);'}`);
    };
    material.customProgramCacheKey = () => 'wind-' + kind;
    material.needsUpdate = true;
  }
  function terrainDetail(material) {
    material.onBeforeCompile = sh => {
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWPos;\n' + NOISE_GLSL + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float dn = gvn(vWPos.xz * 0.9) * 0.55 + gvn(vWPos.xz * 3.7) * 0.3 + gvn(vWPos.xz * 11.0) * 0.15;
        diffuseColor.rgb *= 0.84 + dn * 0.3;`);
    };
    material.customProgramCacheKey = () => 'terrain-detail';
    material.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- vuurvliegjes */
  const FLY_MAX = 140, flyPos = new Float32Array(FLY_MAX * 3), flySeed = new Float32Array(FLY_MAX);
  const flyGeo = new THREE.BufferGeometry(); flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  const flyTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const flies = new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.35, map: flyTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
  flies.frustumCulled = false; scene.add(flies);
  let heightFn = () => 0, fliesReady = false;
  function resetFly(i, px, pz) {
    const a = Math.random() * 6.283, r = 4 + Math.random() * 38, x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
    flyPos[i * 3] = x; flyPos[i * 3 + 2] = z; flyPos[i * 3 + 1] = heightFn(x, z) + 0.4 + Math.random() * 2.2; flySeed[i] = Math.random() * 100;
  }

  /* ---------------------------------------------------------------- nabewerking */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.42, 0.55, 0.88);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------------------------------------------------------------- registratie */
  const grassSets = [];     // { mesh, total }
  let clouds = [];

  function applyQuality(name) {
    q = QUALITY[name] ? name : 'hoog'; const Q = QUALITY[q];
    renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
    composer.setPixelRatio(Math.min(devicePixelRatio, Q.pr));
    resize();
    if (key.shadow.mapSize.x !== Q.shadow) { key.shadow.mapSize.set(Q.shadow, Q.shadow); if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; } }
    for (const g of grassSets) g.mesh.count = Math.floor(g.total * Q.grass);
    flyGeo.setDrawRange(0, Q.flies);
    return q;
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
    bloom.setSize(innerWidth / 2, innerHeight / 2);
  }

  /* ---------------------------------------------------------------- tijd van de dag */
  function dayT() {
    if (forcedT !== null) return forcedT;
    return (((Date.now() + serverOffset) / 1000) % CYCLE_SEC) / CYCLE_SEC;
  }
  const tmpC = new THREE.Color(), sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const state = { night: 0, day: 1, elev: 1 };

  function update(dt, time, px, py, pz) {
    uTime.value = time;
    const t = dayT();
    const s = t < DAY_FRAC ? (t / DAY_FRAC) * Math.PI : Math.PI + ((t - DAY_FRAC) / (1 - DAY_FRAC)) * Math.PI;
    sunDir.set(Math.cos(s) * 0.9, Math.sin(s), 0.35).normalize();
    moonDir.copy(sunDir).multiplyScalar(-1); moonDir.y = Math.max(moonDir.y, 0.15); moonDir.normalize();
    const e = sunDir.y;
    const day = sstep(-0.12, 0.25, e), night = 1 - sstep(-0.2, 0.02, e), twi = 1 - sstep(0.0, 0.35, Math.abs(e + 0.03));
    state.night = night; state.day = day; state.elev = e;

    // kleuren
    skyU.uTop.value.copy(C(0x070d24)).lerp(C(0x2f6fd0), day).lerp(C(0x3a4f8f), twi * 0.3);
    skyU.uHor.value.copy(C(0x16213d)).lerp(C(0xb9d6ec), day).lerp(C(0xf0a068), twi * 0.5);
    skyU.uGlow.value.copy(C(0xff8a4a)).lerp(C(0xffc27a), sstep(-0.05, 0.2, e));
    skyU.uSun.value.copy(sunDir); skyU.uMoon.value.copy(moonDir); skyU.uNight.value = night; skyU.uTwilight.value = twi;
    scene.fog.color.copy(skyU.uHor.value).multiplyScalar(0.92);
    scene.fog.near = 60 + day * 30; scene.fog.far = 200 + day * 110;

    // licht: overdag de zon, 's nachts de maan
    const sunI = 3.0 * sstep(-0.03, 0.2, e), moonI = 0.5 * night;
    const L = sunI >= moonI ? sunDir : moonDir;
    key.intensity = Math.max(sunI, moonI);
    key.color.copy(sunI >= moonI ? tmpC.copy(C(0xff9a50)).lerp(C(0xfff0d2), sstep(0.0, 0.4, e)) : C(0x9fb4ff));
    key.position.set(px + L.x * 110, py + L.y * 110, pz + L.z * 110); key.target.position.set(px, py, pz);
    hemi.intensity = 0.5 + 0.65 * day;
    hemi.color.copy(C(0x5a6ea8)).lerp(C(0xcfe6ff), day).lerp(C(0xffc9a0), twi * 0.3);
    hemi.groundColor.copy(C(0x1e2530)).lerp(C(0x9bb872), day);
    handHemi.intensity = 0.55 + 0.6 * day; handKey.intensity = 0.5 + 1.2 * day; handKey.color.copy(key.color);
    for (const l of lanterns) l.intensity = l.userData.max * sstep(0.1, 0.6, night + twi * 0.4);
    sky.position.set(camera.position.x, camera.position.y, camera.position.z);

    // water
    waterU.uLightDir.value.copy(L); waterU.uLightCol.value.copy(key.color).multiplyScalar(Math.min(1, key.intensity / 1.5));
    waterU.uAmbient.value = 0.35 + 0.65 * day;

    // wolken
    cloudMat.color.copy(C(0x39435e)).lerp(C(0xffffff), day).lerp(C(0xffb08a), twi * 0.45);
    cloudMat.emissive.copy(cloudMat.color); cloudMat.emissiveIntensity = 0.25 + 0.35 * day;
    cloudMat.opacity = 0.55 + 0.35 * day;

    // vuurvliegjes
    const fl = flies.material; fl.opacity = sstep(0.2, 0.8, night) * 0.95;
    flies.visible = fl.opacity > 0.01;
    if (flies.visible) {
      if (!fliesReady) { for (let i = 0; i < FLY_MAX; i++) resetFly(i, px, pz); fliesReady = true; }
      for (let i = 0; i < FLY_MAX; i++) {
        const o = i * 3, k = flySeed[i];
        flyPos[o] += Math.sin(time * 0.7 + k) * dt * 0.6; flyPos[o + 2] += Math.cos(time * 0.6 + k * 1.3) * dt * 0.6;
        flyPos[o + 1] += Math.sin(time * 1.3 + k * 2.1) * dt * 0.25;
        if (Math.abs(flyPos[o] - px) > 44 || Math.abs(flyPos[o + 2] - pz) > 44) resetFly(i, px, pz);
      }
      fl.size = 0.28 + Math.sin(time * 5) * 0.05;
      flyGeo.attributes.position.needsUpdate = true;
    }
  }

  function render() {
    renderer.setRenderTarget(null);
    if (QUALITY[q].bloom) composer.render();
    else { renderer.clear(); renderer.render(scene, camera); }
    renderer.clearDepth();
    renderer.render(handScene, handCam);
  }

  return {
    key, state, uTime, cloudMat,
    createWater, wind, terrainDetail, update, render, resize, applyQuality,
    get quality() { return q; },
    setHeightFn(fn) { heightFn = fn; },
    registerGrass(mesh, total) { grassSets.push({ mesh, total }); mesh.count = Math.floor(total * QUALITY[q].grass); },
    registerClouds(list) { clouds = list; },
    addLantern(pos, color = 0xffc070, max = 3.5, distance = 16) {
      const l = new THREE.PointLight(color, 0, distance, 1.6); l.userData.max = max; l.position.copy(pos); scene.add(l); lanterns.push(l); return l;
    },
    setTimeOfDay(t) { forcedT = t === null ? null : ((t % 1) + 1) % 1; },
    timeOfDay: dayT,
  };
}
