// Uitnodigingen: link naar de kamer, delen via WhatsApp, het deelmenu van de telefoon of kopiëren.
const $ = id => document.getElementById(id);
let ctx = { roomId: null, roomName: '' }, onClose = null, wired = false;

export function inviteUrl(roomId) {
  const u = new URL('/', location.origin);
  if (roomId) u.searchParams.set('kamer', String(roomId));
  return u.href;
}
function message() {
  const url = inviteUrl(ctx.roomId);
  return (ctx.roomName ? 'Kom Swordwoods met me spelen! Ik zit in "' + ctx.roomName + '". ' : 'Kom Swordwoods met me spelen! ') +
    'Hak bomen, vind zwaarden en versla samen de monsters: ' + url;
}
function note(t) { $('inv-note').textContent = t; }

function wire() {
  if (wired) return; wired = true;
  $('inv-close').onclick = () => closeInvite();
  $('invite').addEventListener('pointerdown', e => { if (e.target.id === 'invite') closeInvite(); });
  $('inv-copy').onclick = async () => {
    const inp = $('inv-url');
    try { await navigator.clipboard.writeText(inp.value); note('Link gekopieerd.'); }
    catch { inp.focus(); inp.select(); try { document.execCommand('copy'); note('Link gekopieerd.'); } catch { note('Selecteer de link en kopieer hem zelf.'); } }
  };
  $('inv-share').onclick = async () => {
    try { await navigator.share({ title: 'Swordwoods', text: message(), url: inviteUrl(ctx.roomId) }); note('Gedeeld.'); }
    catch (e) { if (e && e.name !== 'AbortError') note('Delen lukt hier niet. Gebruik WhatsApp of kopieer de link.'); }
  };
  addEventListener('keydown', e => { if (e.code === 'Escape' && $('invite').classList.contains('on')) { e.stopPropagation(); closeInvite(); } }, true);
}

export function openInvite({ roomId = null, roomName = '' } = {}, closed = null) {
  wire();
  ctx = { roomId, roomName }; onClose = closed;
  $('inv-url').value = inviteUrl(roomId);
  $('inv-wa').href = 'https://wa.me/?text=' + encodeURIComponent(message());
  $('inv-share').hidden = !navigator.share;
  $('inv-desc').textContent = roomId
    ? 'Stuur deze link. Wie hem opent, logt in of maakt een account en komt direct bij jou in "' + roomName + '".'
    : 'Stuur deze link naar je vrienden. Ze maken een account en kunnen dan meteen meedoen.';
  note('');
  $('invite').classList.add('on');
}
export function closeInvite() {
  if (!$('invite').classList.contains('on')) return;
  $('invite').classList.remove('on');
  const f = onClose; onClose = null; if (f) f();
}

/** Kamer uit de uitnodigingslink (?kamer=3), eenmalig. */
export function takeInvitedRoom() {
  const p = new URLSearchParams(location.search), id = parseInt(p.get('kamer'), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}
export function clearInviteParam() {
  const u = new URL(location.href);
  if (u.searchParams.has('kamer')) { u.searchParams.delete('kamer'); history.replaceState(null, '', u.pathname + u.search + u.hash); }
}
