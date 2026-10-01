// Extra HUD: minikaart + grote kaart, kamerchat met snelberichten en markeringen, fps-teller.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

export const QUICK = [
  { text: 'Help!', ping: true }, { text: 'Kom hierheen!', ping: true }, { text: 'Kist gevonden!', ping: true },
  { text: 'Monsters hier!', ping: true }, { text: 'Klaar voor de golf?' }, { text: 'Bedankt!' },
];

export function createHud(ctx) {
  const { W, WORLD, WATER, player, net, myId, names, isTouch } = ctx;
  const pings = [];              // { x, z, t, color, name }
  const discovered = new Set();  // kist-indexen die je hebt gezien
  const seenDogs = new Set();

  /* ---------------------------------------------------------------- terreinkaart (één keer) */
  const N = 256, base = document.createElement('canvas'); base.width = base.height = N;
  {
    const c = base.getContext('2d'), img = c.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * WORLD, z = (j / (N - 1) - 0.5) * WORLD, h = W.heightAt(x, z), o = (j * N + i) * 4;
      let col;
      if (h < WATER - 0.2) { const d = Math.min(1, (WATER - h) / 8); col = [40 - 20 * d, 110 - 40 * d, 160 - 40 * d]; }
      else if (h < 1.0) col = [205, 190, 140];
      else if (h > 15) col = [150, 148, 140];
      else { const k = Math.min(1, h / 15); col = [70 + 40 * k, 120 + 10 * k, 60 + 20 * k]; }
      const shade = 1 + (W.heightAt(x + 2, z + 2) - h) * -0.05;
      img.data[o] = col[0] * shade; img.data[o + 1] = col[1] * shade; img.data[o + 2] = col[2] * shade; img.data[o + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    c.fillStyle = 'rgba(25,70,30,.55)';
    for (const t of W.trees) { const i = (t.x / WORLD + 0.5) * N, j = (t.z / WORLD + 0.5) * N; c.fillRect(i - 0.8, j - 0.8, 1.6, 1.6); }
  }
  const toCanvas = (x, z) => [(x / WORLD + 0.5) * N, (z / WORLD + 0.5) * N];

  /* ---------------------------------------------------------------- minikaart */
  const mini = $('minimap'), mctx = mini.getContext('2d');
  const big = $('bigmap'), bctx = big.getContext('2d');
  let bigOpen = false;
  const RANGE = 95;   // meter van midden tot rand

  function markers() {
    const out = [];
    out.push({ x: W.shop.x, z: W.shop.z, kind: 'shop' });
    for (const o of ctx.chestObjs) if (!o.opened && discovered.has(o.c.idx)) out.push({ x: o.c.x, z: o.c.z, kind: 'chest' });
    for (const [id, e] of ctx.remotes) out.push({ x: e.x, z: e.z, kind: 'player', color: ctx.colorForName(names.get(id) || '?'), label: (names.get(id) || '?')[0], dead: e.dead });
    for (const e of ctx.dogs.values()) {
      if (e.owner === myId) out.push({ x: e.x, z: e.z, kind: 'mydog' });
      else if (!e.owner && seenDogs.has(e.id)) out.push({ x: e.x, z: e.z, kind: 'wilddog' });
    }
    for (const e of ctx.mons.values()) if (Math.hypot(e.x - player.x, e.z - player.z) < 70) out.push({ x: e.x, z: e.z, kind: 'monster', boss: e.type === 3 });
    for (const m of (ctx.extraMarkers ? ctx.extraMarkers() : [])) out.push(m);
    return out;
  }
  function drawMarker(c, m, px, py, s = 1) {
    c.save(); c.translate(px, py);
    switch (m.kind) {
      case 'shop': c.fillStyle = '#4aa3ff'; c.fillRect(-4 * s, -4 * s, 8 * s, 8 * s); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.strokeRect(-4 * s, -4 * s, 8 * s, 8 * s); break;
      case 'trader': c.fillStyle = '#c58cff'; c.fillRect(-4 * s, -4 * s, 8 * s, 8 * s); c.strokeStyle = '#fff'; c.strokeRect(-4 * s, -4 * s, 8 * s, 8 * s); break;
      case 'chest': c.fillStyle = '#f2c14e'; c.beginPath(); c.arc(0, 0, 3.5 * s, 0, 7); c.fill(); c.strokeStyle = '#4b2f17'; c.stroke(); break;
      case 'ruin': c.fillStyle = '#d9d2c3'; c.beginPath(); c.moveTo(0, -5 * s); c.lineTo(5 * s, 4 * s); c.lineTo(-5 * s, 4 * s); c.fill(); break;
      case 'player': c.fillStyle = '#' + m.color.toString(16).padStart(6, '0'); c.globalAlpha = m.dead ? 0.5 : 1; c.beginPath(); c.arc(0, 0, 4.5 * s, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); break;
      case 'mydog': c.fillStyle = '#c8903f'; c.beginPath(); c.arc(0, 0, 3 * s, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.stroke(); break;
      case 'wilddog': c.fillStyle = '#e8dcc8'; c.beginPath(); c.arc(0, 0, 2.5 * s, 0, 7); c.fill(); break;
      case 'monster': c.fillStyle = m.boss ? '#ff5a2a' : '#e0413a'; c.beginPath(); c.arc(0, 0, (m.boss ? 4.5 : 2.5) * s, 0, 7); c.fill(); break;
      case 'build': c.fillStyle = m.color || '#b98a52'; c.fillRect(-2 * s, -2 * s, 4 * s, 4 * s); break;
      case 'bed': c.fillStyle = '#e58b7b'; c.fillRect(-3 * s, -2 * s, 6 * s, 4 * s); break;
    }
    c.restore();
  }
  function drawMini() {
    const S = mini.width, half = S / 2, scale = half / RANGE;   // pixels per meter
    mctx.save(); mctx.clearRect(0, 0, S, S);
    mctx.beginPath(); mctx.arc(half, half, half - 1, 0, 7); mctx.clip();
    mctx.fillStyle = '#123'; mctx.fillRect(0, 0, S, S);
    mctx.translate(half, half); mctx.rotate(player.yaw);
    const [cx, cy] = toCanvas(player.x, player.z), k = scale * WORLD / N;
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(base, -cx * k, -cy * k, N * k, N * k);
    const all = markers();
    for (const m of all) {
      const dx = (m.x - player.x) * scale, dz = (m.z - player.z) * scale;
      const d = Math.hypot(dx, dz); let px = dx, py = dz;
      if (d > half - 8) { if (m.kind !== 'shop' && m.kind !== 'player' && m.kind !== 'trader') continue; px = dx / d * (half - 8); py = dz / d * (half - 8); }
      mctx.save(); mctx.translate(px, py); mctx.rotate(-player.yaw); drawMarker(mctx, m, 0, 0); mctx.restore();
    }
    const now = performance.now() / 1000;
    for (const p of pings) {
      const dx = (p.x - player.x) * scale, dz = (p.z - player.z) * scale, d = Math.hypot(dx, dz), r = d > half - 8 ? (half - 8) / d : 1;
      const a = (now - p.t) % 1;
      mctx.strokeStyle = p.color; mctx.lineWidth = 2; mctx.globalAlpha = 1 - a;
      mctx.beginPath(); mctx.arc(dx * r, dz * r, 4 + a * 10, 0, 7); mctx.stroke(); mctx.globalAlpha = 1;
    }
    mctx.restore();
    // speler in het midden, altijd naar boven
    mctx.fillStyle = '#fff'; mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5;
    mctx.beginPath(); mctx.moveTo(half, half - 7); mctx.lineTo(half + 5, half + 5); mctx.lineTo(half, half + 2); mctx.lineTo(half - 5, half + 5); mctx.closePath(); mctx.fill(); mctx.stroke();
    mctx.strokeStyle = 'rgba(255,255,255,.35)'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(half, half, half - 1, 0, 7); mctx.stroke();
  }
  function drawBig() {
    const S = big.width, k = S / N;
    bctx.clearRect(0, 0, S, S); bctx.drawImage(base, 0, 0, S, S);
    for (const m of markers()) { const [x, y] = toCanvas(m.x, m.z); drawMarker(bctx, m, x * k, y * k, 1.6); }
    const now = performance.now() / 1000;
    for (const p of pings) { const [x, y] = toCanvas(p.x, p.z); bctx.strokeStyle = p.color; bctx.lineWidth = 3; bctx.globalAlpha = 1 - (now - p.t) % 1; bctx.beginPath(); bctx.arc(x * k, y * k, 6 + ((now - p.t) % 1) * 14, 0, 7); bctx.stroke(); bctx.globalAlpha = 1; }
    const [px, py] = toCanvas(player.x, player.z);
    bctx.save(); bctx.translate(px * k, py * k); bctx.rotate(-player.yaw);
    bctx.fillStyle = '#fff'; bctx.strokeStyle = '#000'; bctx.lineWidth = 2;
    bctx.beginPath(); bctx.moveTo(0, -11); bctx.lineTo(8, 8); bctx.lineTo(0, 3); bctx.lineTo(-8, 8); bctx.closePath(); bctx.fill(); bctx.stroke(); bctx.restore();
  }
  function toggleBig(on = !bigOpen) { bigOpen = on; $('bigmap-wrap').classList.toggle('on', on); if (on) drawBig(); }
  $('bigmap-wrap').addEventListener('pointerdown', e => { e.preventDefault(); toggleBig(false); });
  mini.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); toggleBig(true); });

  /* ---------------------------------------------------------------- chat */
  const log = $('chatlog'), panel = $('chatpanel'), input = $('chat-input');
  let chatOpen = false;
  function addLine(html) {
    const d = document.createElement('div'); d.className = 'cl'; d.innerHTML = html; log.appendChild(d);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 12000);
  }
  net.on('chat', m => {
    const col = '#' + ctx.colorForName(m.name).toString(16).padStart(6, '0');
    addLine('<b style="color:' + col + '">' + esc(m.name) + '</b> ' + esc(m.text) + (m.ping ? ' <span class="pin">📍</span>' : ''));
    if (m.ping) pings.push({ x: m.ping.x, z: m.ping.z, t: performance.now() / 1000, color: col, name: m.name });
    if (m.id !== myId && ctx.sfxChat) ctx.sfxChat();
  });
  $('chat-quick').innerHTML = QUICK.map((q, i) => '<button type="button" data-q="' + i + '">' + esc(q.text) + (q.ping ? ' 📍' : '') + '</button>').join('');
  $('chat-quick').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (!b) return; const q = QUICK[+b.dataset.q]; net.send({ t: 'chat', text: q.text, ping: !!q.ping }); closeChat(); });
  $('chat-form').addEventListener('submit', e => { e.preventDefault(); const t = input.value.trim(); if (t) net.send({ t: 'chat', text: t }); input.value = ''; closeChat(); });
  function openChat() {
    if (chatOpen) return; chatOpen = true; panel.classList.add('on'); log.classList.add('open');
    if (ctx.onChatOpen) ctx.onChatOpen();
    if (!isTouch) setTimeout(() => input.focus(), 0);
  }
  function closeChat() { if (!chatOpen) return; chatOpen = false; panel.classList.remove('on'); log.classList.remove('open'); input.blur(); if (ctx.onChatClose) ctx.onChatClose(); }
  $('chat-close').onclick = () => closeChat();

  /* ---------------------------------------------------------------- fps */
  let showFps = false; try { showFps = localStorage.getItem('sw-fps') === '1'; } catch {}
  $('fps-toggle').checked = showFps; $('fps').hidden = !showFps;
  $('fps-toggle').onchange = () => { showFps = $('fps-toggle').checked; $('fps').hidden = !showFps; try { localStorage.setItem('sw-fps', showFps ? '1' : '0'); } catch {} };
  const fpsS = { t: 0, n: 0 };

  /* ---------------------------------------------------------------- per frame */
  let acc = 0;
  function update(dt) {
    fpsS.t += dt; fpsS.n++;
    if (fpsS.t >= 0.5) { if (showFps) $('fps').textContent = Math.round(fpsS.n / fpsS.t) + ' fps'; fpsS.t = 0; fpsS.n = 0; }
    for (const o of ctx.chestObjs) if (!discovered.has(o.c.idx) && Math.abs(o.c.x - player.x) < 45 && Math.abs(o.c.z - player.z) < 45) discovered.add(o.c.idx);
    for (const e of ctx.dogs.values()) if (!e.owner && !e.first && !seenDogs.has(e.id) && Math.hypot(e.tx - player.x, e.tz - player.z) < 35) seenDogs.add(e.id);
    const now = performance.now() / 1000;
    for (let i = pings.length - 1; i >= 0; i--) if (now - pings[i].t > 12) pings.splice(i, 1);
    acc += dt;
    if (acc > 1 / 15) { acc = 0; drawMini(); if (bigOpen) drawBig(); }
  }
  return { markers, update, openChat, closeChat, toggleBig, get chatOpen() { return chatOpen; }, get bigOpen() { return bigOpen; }, pings, addLine };
}
