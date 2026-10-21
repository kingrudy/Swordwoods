// Eenvoudige deeltjes (spaanders, bladeren, vonken, bloed, spatten) met één gedeelde puntentextuur.
import * as THREE from 'three';

let dotTexCache = null;
const dotTex = () => dotTexCache || (dotTexCache = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})());
export class Particles {
  constructor(scene, color, size, max, additive = false, gravity = 9) {
    this.max = max; this.gravity = gravity; this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); this.attr = g.attributes.position;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ color, size, map: dotTex(), alphaTest: 0.05, sizeAttenuation: true, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
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

