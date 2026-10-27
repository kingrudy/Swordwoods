// Besturing: toetsenbord en muis (pointer lock, of slepen als dat niet mag), aanraakscherm met stick en knoppen,
// en een echte controller via de Gamepad API. Vertaalt invoer naar acties van de speler, panelen en de rest.
import { openInvite, closeInvite } from './invite.js';
import { $, clamp } from './util.js';

export function createControls(g) {
  const { net, player, keys, virt, renderer, camera, handCam, G, AU, joined } = g;
  const pl = () => g.pl;
  const drag = { down: false, moved: 0 };
  const veil = $('veil');
  const showVeil = on => veil.classList.toggle('on', on);
  const clearKeys = () => { for (const k in keys) keys[k] = false; };

  /* ---------------------------------------------------------------- muis vastzetten (pointer lock) of zacht spelen */
  function enterSoft() { if (g.locked) return; g.soft = true; g.locked = true; showVeil(false); }
  function requestLock() {
    AU.resume();
    if (g.isTouch) {      // geen pointer lock op touch: direct spelen en (waar mogelijk) volledig scherm + landschap
      try { const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); if (p && p.then) p.then(() => screen.orientation?.lock?.('landscape')?.catch?.(() => {})).catch(() => {}); } catch {}
      enterSoft(); return;
    }
    const el = renderer.domElement;
    if (!el.requestPointerLock) { enterSoft(); return; }
    try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(enterSoft); } catch { enterSoft(); }
  }
  function pauseGame() {
    g.locked = false; virt.x = virt.y = 0; virt.attack = false; virt.jump = false;
    if (document.pointerLockElement) document.exitPointerLock();
    showVeil(true);
  }
  $('btn-resume').onclick = requestLock;
  $('btn-leave').onclick = () => { net.send({ t: 'leave' }); setTimeout(() => location.reload(), 150); };
  $('btn-invite').onclick = () => openInvite({ roomId: joined.room.id, roomName: joined.room.name });
  document.addEventListener('pointerlockerror', enterSoft);
  document.addEventListener('pointerlockchange', () => {
    g.locked = document.pointerLockElement === renderer.domElement;
    if (g.locked) g.soft = false;
    showVeil(!g.locked && !g.shopOpen);
    if (!g.locked) { clearKeys(); if (g.hud && g.hud.chatOpen && !g.isTouch) g.hud.closeChat(); pl().setBlock(false); pl().cancelCharge(); }
  });

  /** Rondkijken met de instellingen voor gevoeligheid en omgekeerde muis. */
  function look(dx, dy) {
    const S = g.settings.S;
    player.yaw -= dx * S.sens; player.pitch = clamp(player.pitch - dy * S.sens * (S.invertY ? -1 : 1), -1.45, 1.45);
  }

  /* ---------------------------------------------------------------- muis */
  const mouseOk = () => g.locked && !g.isTouch && !g.shopOpen;
  document.addEventListener('mousemove', e => {
    if (!mouseOk()) return;
    if (g.soft) { if (!drag.down) return; drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY); }
    look(clamp(e.movementX, -120, 120) * 0.0022, clamp(e.movementY, -120, 120) * 0.0022);
  });
  document.addEventListener('mousedown', e => {
    if (!mouseOk()) return;
    if (e.button === 2) { pl().setBlock(true); return; }
    if (e.button !== 0) return;
    if (g.soft) { drag.down = true; drag.moved = 0; }
    pl().beginCharge(e.timeStamp);
  });
  document.addEventListener('mouseup', e => {
    if (g.isTouch) return;
    if (e.button === 2) { pl().setBlock(false); return; }
    if (e.button !== 0) return;
    if (g.soft && drag.down) { drag.down = false; if (drag.moved >= 6) { pl().cancelCharge(); return; } }
    pl().releaseCharge(e.timeStamp);
  });
  document.addEventListener('contextmenu', e => { if (g.locked) e.preventDefault(); });
  document.addEventListener('wheel', e => {
    if (!g.locked || g.shopOpen) return;
    if (g.bs.active) g.bs.cycle(e.deltaY > 0 ? 1 : -1); else pl().cycleWeapon(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  /* ---------------------------------------------------------------- toetsenbord */
  const DOG_CMDS = ['follow', 'stay', 'attack', 'seek'];
  addEventListener('keydown', e => {
    const hud = g.hud, soc = g.soc, bs = g.bs;
    if (g.settings.captureKey(e)) return;                 // nieuwe toets kiezen in Instellingen
    if (hud && hud.chatOpen) { if (e.code === 'Escape') { e.preventDefault(); hud.closeChat(); } return; }   // typen in de chat
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const act = g.settings.actionOf(e.code);
    if (hud && hud.bigOpen && (e.code === 'Escape' || act === 'map')) { hud.toggleBig(false); return; }
    keys[e.code] = true;
    if (e.code === 'Space' || act === 'jump') e.preventDefault();
    if (g.shopOpen) {
      if (e.code === 'Escape') { g.panels.closeShop(false); showVeil(!g.locked); }
      else if (act === 'use' || act === 'build') g.panels.closeShop(true);
      return;
    }
    if (!g.locked) return;
    if (g.soft && e.code === 'Escape') { g.locked = false; drag.down = false; showVeil(true); clearKeys(); return; }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); hud.openChat(); return; }
    switch (act) {
      case 'use': g.inter.interact(); break;
      case 'drink': net.send({ t: 'drink' }); break;
      case 'feed': feedDog(); break;
      case 'eat': net.send({ t: 'eat' }); break;
      case 'swing': pl().startSwing(); break;
      case 'roll': pl().doRoll(); break;
      case 'map': hud.toggleBig(); break;
      case 'chat': e.preventDefault(); hud.openChat(); break;
      case 'build': bs.toggle(); break;
      case 'view': g.settings.toggleView(); break;
      case 'dog': soc.toggleDogMenu(); return;
    }
    if (soc.dogMenu && /^Digit[1-4]$/.test(e.code)) { soc.command(DOG_CMDS[+e.code[5] - 1]); return; }
    if (soc.dogMenu && e.code === 'Escape') { soc.toggleDogMenu(false); return; }
    if (/^Digit[1-9]$/.test(e.code)) { if (bs.active) bs.select(+e.code[5] - 1); else pl().equipSlot(+e.code[5] - 1); }
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('resize', () => {
    G.resize(); camera.aspect = handCam.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix(); handCam.updateProjectionMatrix();
  });
  const feedDog = () => net.send({ t: 'feeddog' });

  /* ---------------------------------------------------------------- aanraakscherm */
  function setupTouch() {
    const tz = $('tz'), stick = $('stick'), knob = $('joyknob'), R = 58;
    let joyId = null, ox = 0, oy = 0, lookId = null, lx = 0, ly = 0;
    const home = () => { stick.style.left = stick.style.top = stick.style.bottom = ''; stick.classList.remove('active', 'float'); knob.style.transform = ''; };
    tz.addEventListener('pointerdown', e => {
      if (!g.locked || g.dead || g.shopOpen) return;
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
        look((e.clientX - lx) * 0.0052, (e.clientY - ly) * 0.0052);
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
      b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); if (navigator.vibrate) try { navigator.vibrate(8); } catch {} down(e); });
      const rel = e => { if (b.classList.contains('down')) { b.classList.remove('down'); if (up) up(e); } };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('pointerleave', rel);
    };
    press('tb-atk', e => pl().beginCharge(e.timeStamp), e => pl().releaseCharge(e.timeStamp));
    press('tb-block', () => pl().setBlock(true), () => pl().setBlock(false));
    press('tb-roll', () => pl().doRoll());
    press('tb-jump', () => { virt.jump = true; }, () => { virt.jump = false; });
    press('tb-use', () => g.inter.interact());
    press('tb-eat', () => net.send({ t: 'eat' }));
    press('tb-drink', () => net.send({ t: 'drink' }));
    press('tb-fish', feedDog);
    press('tb-sprint', () => { virt.toggle = !virt.toggle; $('tb-sprint').classList.toggle('on', virt.toggle); });
    press('tb-next', () => { if (g.bs.active) g.bs.cycle(1); else pl().cycleWeapon(1); });
    press('tb-build', () => g.bs.toggle());
    press('tb-dog', () => g.soc.toggleDogMenu());
    press('tb-menu', () => { home(); pauseGame(); });
    press('tb-invite', () => { home(); pauseGame(); openInvite({ roomId: joined.room.id, roomName: joined.room.name }); });
    press('tb-chat', () => { home(); virt.x = virt.y = 0; g.hud.openChat(); });
    $('hotbar').addEventListener('pointerdown', e => { const sl = e.target.closest('.slot'); if (sl) { e.preventDefault(); pl().equipSlot([...$('hotbar').children].indexOf(sl)); } });
    document.addEventListener('contextmenu', e => e.preventDefault());
  }
  if (g.isTouch) setupTouch();
  else addEventListener('touchstart', function onFirstTouch() {       // touchscreen op een laptop of onbekend toestel: overlay alsnog aanzetten
    removeEventListener('touchstart', onFirstTouch);
    if (g.isTouch) return;
    g.isTouch = true; document.body.classList.add('touch'); setupTouch(); g.ui.renderInv();
    $('btn-resume').textContent = 'Tik om te starten';
  }, { passive: true });

  /* ---------------------------------------------------------------- controller (Gamepad API) */
  const gp = { prev: [], idx: null };
  addEventListener('gamepadconnected', e => { gp.idx = e.gamepad.index; document.body.classList.add('padconnected'); g.ui.toast('🎮 Controller verbonden. Druk op Start om te spelen.', '#6fd37a'); });
  addEventListener('gamepaddisconnected', e => {
    if (gp.idx === e.gamepad.index) { gp.idx = null; document.body.classList.remove('padconnected'); virt.px = virt.py = 0; virt.pattack = virt.pjump = virt.psprint = false; g.ui.toast('Controller losgekoppeld.', '#bbb'); }
  });
  function pollPad(dt) {
    if (gp.idx === null || !navigator.getGamepads) return;
    const p = navigator.getGamepads()[gp.idx]; if (!p) return;
    const dz = v => Math.abs(v || 0) < 0.18 ? 0 : v;
    const b = i => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
    const hit = i => b(i) && !gp.prev[i];
    if (hit(9)) {                                     // Start: pauze aan/uit
      if ($('invite').classList.contains('on')) closeInvite();
      else if (g.shopOpen) g.panels.closeShop(false);
      else if (g.locked) pauseGame(); else { showVeil(false); enterSoft(); }
    }
    if (g.shopOpen && hit(1)) g.panels.closeShop(false);
    if (g.locked && !g.dead && !g.shopOpen) {
      virt.px = dz(p.axes[0]); virt.py = dz(p.axes[1]);
      look(dz(p.axes[2]) * 2.6 * dt, dz(p.axes[3]) * 2.0 * dt);
      const atk = b(0) || b(7);
      if (atk && !virt.pattack) pl().beginCharge(); else if (!atk && virt.pattack) pl().releaseCharge();
      virt.pattack = atk; virt.pjump = b(1); virt.psprint = b(10);
      if (b(6) !== pl().blocking && !g.bs.active) pl().setBlock(b(6));
      if (hit(2)) g.inter.interact();
      if (hit(3)) net.send({ t: 'eat' });
      if (hit(14)) net.send({ t: 'drink' });
      if (hit(12)) feedDog();
      if (hit(13)) g.bs.toggle();
      if (hit(4)) { if (g.bs.active) g.bs.cycle(-1); else pl().doRoll(); }
      if (hit(5) || hit(15)) { if (g.bs.active) g.bs.cycle(1); else pl().cycleWeapon(1); }
    } else { virt.px = virt.py = 0; if (virt.pattack) pl().cancelCharge(); virt.pattack = virt.pjump = virt.psprint = false; }
    gp.prev = p.buttons.map((_, i) => b(i));
  }

  return { showVeil, requestLock, enterSoft, pauseGame, pollPad, feedDog, gp };
}
