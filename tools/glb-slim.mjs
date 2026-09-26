// Dunt een .glb uit: houdt alleen gekozen animaties, kan meshes of knopen verwijderen, en bouwt de binaire buffer
// opnieuw op met alleen gebruikte data. Geen dependencies.
//   node tools/glb-slim.mjs in.glb out.glb --keep-anims=Idle,Walking_A --no-anims --no-meshes --drop-nodes=1H_Sword,Badge_Shield
import fs from 'node:fs';

const [, , inFile, outFile, ...flags] = process.argv;
const opt = Object.fromEntries(flags.map(f => { const [k, v] = f.replace(/^--/, '').split('='); return [k, v ?? true]; }));

const buf = fs.readFileSync(inFile);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('geen glb');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), data = buf.subarray(off + 8, off + 8 + len);
  if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = data;
  off += 8 + len;
}
const j = json;

// ---- animaties
if (opt['no-anims']) delete j.animations;
else if (opt['keep-anims']) {
  const keep = String(opt['keep-anims']).split(',');
  j.animations = (j.animations || []).filter(a => keep.includes(a.name));
  const missing = keep.filter(k => !j.animations.some(a => a.name === k));
  if (missing.length) console.warn('niet gevonden:', missing.join(', '));
}

// ---- knopen met mesh weghalen (props) of alle meshes weghalen
const dropNodes = new Set(opt['drop-nodes'] ? String(opt['drop-nodes']).split(',') : []);
for (const n of j.nodes) {
  if (opt['no-meshes'] || dropNodes.has(n.name)) { delete n.mesh; delete n.skin; }
}

// ---- wat wordt nog gebruikt?
const usedMesh = new Set(j.nodes.filter(n => n.mesh !== undefined).map(n => n.mesh));
const usedSkin = new Set(j.nodes.filter(n => n.skin !== undefined).map(n => n.skin));
const acc = new Set(), mats = new Set();
[...usedMesh].forEach(mi => j.meshes[mi].primitives.forEach(p => {
  Object.values(p.attributes).forEach(a => acc.add(a)); if (p.indices !== undefined) acc.add(p.indices);
  (p.targets || []).forEach(t => Object.values(t).forEach(a => acc.add(a)));
  if (p.material !== undefined) mats.add(p.material);
}));
[...usedSkin].forEach(si => { if (j.skins[si].inverseBindMatrices !== undefined) acc.add(j.skins[si].inverseBindMatrices); });
(j.animations || []).forEach(a => a.samplers.forEach(s => { acc.add(s.input); acc.add(s.output); }));
const tex = new Set();
[...mats].forEach(mi => { const m = j.materials[mi]; JSON.stringify(m, (k, v) => { if (k === 'index' && typeof v === 'number') tex.add(v); return v; }); });
const imgs = new Set([...tex].map(t => j.textures[t].source));
const views = new Set([...acc].map(a => j.accessors[a].bufferView).filter(v => v !== undefined));
[...imgs].forEach(i => { if (j.images[i].bufferView !== undefined) views.add(j.images[i].bufferView); });

// ---- herindexeren
const remap = (arr, used) => { const m = new Map(); const out = []; (arr || []).forEach((x, i) => { if (used.has(i)) { m.set(i, out.length); out.push(x); } }); return [out, m]; };
const [meshes, mMesh] = remap(j.meshes, usedMesh);
const [skins, mSkin] = remap(j.skins, usedSkin);
const [materials, mMat] = remap(j.materials, mats);
const [textures, mTex] = remap(j.textures, tex);
const [images, mImg] = remap(j.images, imgs);
const [accessors, mAcc] = remap(j.accessors, acc);
const [bufferViews, mView] = remap(j.bufferViews, views);

// nieuwe buffer
const parts = []; let len = 0;
bufferViews.forEach(bv => {
  const src = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
  bv.byteOffset = len; bv.buffer = 0; parts.push(src); len += src.length;
});
const pad = (4 - (len % 4)) % 4; if (pad) { parts.push(Buffer.alloc(pad)); len += pad; }
const newBin = Buffer.concat(parts);

j.nodes.forEach(n => { if (n.mesh !== undefined) n.mesh = mMesh.get(n.mesh); if (n.skin !== undefined) n.skin = mSkin.get(n.skin); });
meshes.forEach(m => m.primitives.forEach(p => {
  for (const k in p.attributes) p.attributes[k] = mAcc.get(p.attributes[k]);
  if (p.indices !== undefined) p.indices = mAcc.get(p.indices);
  (p.targets || []).forEach(t => { for (const k in t) t[k] = mAcc.get(t[k]); });
  if (p.material !== undefined) p.material = mMat.get(p.material);
}));
skins.forEach(s => { if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = mAcc.get(s.inverseBindMatrices); });
(j.animations || []).forEach(a => a.samplers.forEach(s => { s.input = mAcc.get(s.input); s.output = mAcc.get(s.output); }));
accessors.forEach(a => { if (a.bufferView !== undefined) a.bufferView = mView.get(a.bufferView); });
materials.forEach(m => JSON.stringify(m, function (k, v) { if (k === 'index' && typeof v === 'number') this[k] = mTex.get(v); return v; }));
textures.forEach(t => { t.source = mImg.get(t.source); });
images.forEach(i => { if (i.bufferView !== undefined) i.bufferView = mView.get(i.bufferView); });

Object.assign(j, { meshes, skins, materials, textures, images, accessors, bufferViews, buffers: [{ byteLength: newBin.length }] });
for (const k of ['meshes', 'skins', 'materials', 'textures', 'images', 'samplers']) if (Array.isArray(j[k]) && !j[k].length) delete j[k];
if (!j.textures) delete j.samplers;

// ---- glb schrijven
let js = Buffer.from(JSON.stringify(j), 'utf8'); const jp = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(jp, 0x20)]);
const total = 12 + 8 + js.length + 8 + newBin.length;
const out = Buffer.alloc(total); let o = 0;
out.writeUInt32LE(0x46546c67, o); out.writeUInt32LE(2, o + 4); out.writeUInt32LE(total, o + 8); o += 12;
out.writeUInt32LE(js.length, o); out.writeUInt32LE(0x4e4f534a, o + 4); js.copy(out, o + 8); o += 8 + js.length;
out.writeUInt32LE(newBin.length, o); out.writeUInt32LE(0x004e4942, o + 4); newBin.copy(out, o + 8);
fs.writeFileSync(outFile, out);
console.log(outFile.split('/').pop(), (buf.length / 1024).toFixed(0) + ' kB ->', (out.length / 1024).toFixed(0) + ' kB', '| anims', (j.animations || []).length, '| meshes', (j.meshes || []).length);
