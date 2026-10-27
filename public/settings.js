// Instellingen per speler (in deze browser): muisgevoeligheid, beeldhoek, omgekeerde muis, camera achter je held
// en eigen toetsen. Het tabblad Besturing in het pauzemenu laat altijd de toetsen zien die nu gelden.
import { $, esc } from './util.js';

const KEY = 'sw-settings';
/** Acties met een eigen toets: [id, omschrijving, standaardtoets]. */
export const ACTIONS = [
  ['forward', 'Vooruit', 'KeyW'], ['back', 'Achteruit', 'KeyS'], ['left', 'Links', 'KeyA'], ['right', 'Rechts', 'KeyD'],
  ['jump', 'Springen', 'Space'], ['sprint', 'Rennen', 'ShiftLeft'], ['use', 'Gebruiken (kist, winkel, vissen, opknappen…)', 'KeyE'],
  ['roll', 'Ontwijkrol', 'KeyC'], ['eat', 'Vlees eten', 'KeyR'], ['drink', 'Helende drank', 'KeyQ'], ['feed', 'Hond een vis geven', 'KeyG'],
  ['swing', 'Slaan (naast de muisknop)', 'KeyF'], ['dog', 'Hondencommando\'s', 'KeyV'], ['build', 'Bouwen', 'KeyB'],
  ['map', 'Grote kaart', 'KeyM'], ['chat', 'Chatten', 'KeyT'], ['view', 'Camera wisselen (ik / achter je held)', 'KeyH'],
];
export const DEFAULTS = { sens: 1, fov: 72, invertY: false, third: false, keys: Object.fromEntries(ACTIONS.map(([id, , k]) => [id, k])) };

/** Leesbare naam van een toets ('KeyW' -> 'W'). */
export const keyLabel = code => !code ? '—' : code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5)
  : ({ Space: 'Spatie', ShiftLeft: 'Shift', ShiftRight: 'Shift rechts', ControlLeft: 'Ctrl', AltLeft: 'Alt', Tab: 'Tab', CapsLock: 'Caps Lock', Backquote: '`', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[code] || code;

export function loadSettings(storage = globalThis.localStorage) {
  let s = {}; try { s = JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch {}
  const out = { ...DEFAULTS, ...s, keys: { ...DEFAULTS.keys, ...(s.keys || {}) } };
  out.sens = Math.min(3, Math.max(0.2, +out.sens || 1)); out.fov = Math.min(100, Math.max(55, +out.fov || 72));
  return out;
}

export function createSettings(g) {
  const S = loadSettings();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };
  /** Welke actie hoort bij deze toets (of null). */
  const actionOf = code => { for (const [id] of ACTIONS) if (S.keys[id] === code) return id; return null; };
  const isDown = id => !!g.keys[S.keys[id]];
  function applyCamera() { g.camera.fov = S.fov; g.camera.updateProjectionMatrix(); }
  applyCamera();

  let waiting = null;   // actie waarvoor we op een nieuwe toets wachten
  function renderKeys() {     // tabblad Besturing: altijd de toetsen die nu gelden
    const k = id => '<kbd>' + esc(keyLabel(S.keys[id])) + '</kbd>';
    $('pt-keys').innerHTML = '<div class="keys">' + [
      [k('forward') + k('left') + k('back') + k('right'), 'Lopen (' + k('sprint') + ' rennen, ' + k('jump') + ' springen)'],
      ['<kbd>Muis</kbd>', 'Rondkijken'],
      ['<kbd>Linkermuisknop</kbd>', 'Slaan en hakken; ingedrukt houden en loslaten = zware slag (raakt meerdere vijanden)'],
      ['<kbd>Rechtermuisknop</kbd>', 'Blokkeren met je schild (van voren 70% minder schade, pijlen helemaal)'],
      [k('roll'), 'Ontwijkrol: even onkwetsbaar'], [k('use'), 'Kist openen, winkel, hond temmen, vissen, koken, opknappen'],
      [k('eat'), 'Vlees eten tegen honger'], [k('drink'), 'Helende drank drinken'], [k('feed'), 'Je hond een vis geven (boost)'],
      ['<kbd>1</kbd>–<kbd>9</kbd> / <kbd>Scrollwiel</kbd>', 'Bijl of zwaard kiezen'], [k('swing'), 'Slaan (alternatief)'],
      [k('dog'), 'Hondencommando\'s: 1 volg, 2 blijf, 3 val aan, 4 zoek'], [k('build'), 'Bouwen met hout'],
      [k('map') + ' / ' + k('chat'), 'Grote kaart / chatten (snelberichten zetten een 📍 op de kaart)'], [k('view'), 'Camera: door je eigen ogen of achter je held'],
      ['🎮', 'Controller: linkerstick lopen, rechterstick kijken, A slaan, B springen, X gebruiken, Y eten, LT blokkeren, LB rollen, RB wapen, D-pad links drank, omhoog hond voeren, omlaag bouwen, Start pauze'],
    ].map(([a, b]) => '<span>' + a + '</span><span>' + b + '</span>').join('') + '</div><p class="q-note">Toetsen, muis en camera pas je aan bij Instellingen.</p>';
  }
  function renderSet() {
    const el = $('pt-set');
    el.innerHTML = '<div class="set-grid">' +
      '<label>Muisgevoeligheid <b>' + S.sens.toFixed(1) + '×</b><input type="range" min="0.2" max="3" step="0.1" value="' + S.sens + '" data-set="sens"></label>' +
      '<label>Beeldhoek <b>' + S.fov + '°</b><input type="range" min="55" max="100" step="1" value="' + S.fov + '" data-set="fov"></label>' +
      '<label class="chk"><input type="checkbox" data-set="invertY"' + (S.invertY ? ' checked' : '') + '> Muis omgekeerd (omhoog = omlaag kijken)</label>' +
      '<label class="chk"><input type="checkbox" data-set="third"' + (S.third ? ' checked' : '') + '> Camera achter je held (' + esc(keyLabel(S.keys.view)) + ')</label>' +
      '</div><div class="bind-list">' + ACTIONS.map(([id, label]) => '<div class="bind"><span>' + esc(label) + '</span><button class="btn small' + (waiting === id ? ' primary' : '') + '" type="button" data-bind="' + id + '">' +
        (waiting === id ? 'Druk op een toets…' : esc(keyLabel(S.keys[id]))) + '</button></div>').join('') +
      '</div><div class="row"><button class="btn small" type="button" data-reset="1">Standaard terugzetten</button></div>';
  }
  function render() { renderKeys(); if ($('pt-set')) renderSet(); }
  $('pt-set').addEventListener('input', e => {
    const t = e.target, k = t.dataset.set; if (!k) return;
    if (t.type === 'checkbox') S[k] = t.checked; else S[k] = +t.value;
    if (k === 'fov') applyCamera();
    save(); if (t.type === 'checkbox') renderSet(); else t.previousElementSibling.textContent = k === 'fov' ? S.fov + '°' : S.sens.toFixed(1) + '×';
  });
  $('pt-set').addEventListener('click', e => {
    const b = e.target.closest('[data-bind]'), r = e.target.closest('[data-reset]');
    if (b) { waiting = b.dataset.bind; renderSet(); }
    if (r) { Object.assign(S, structuredClone(DEFAULTS)); waiting = null; applyCamera(); save(); render(); }
  });
  /** Een toets terwijl we op een nieuwe toets wachten: vastleggen. Geeft true als de toets daarvoor gebruikt is. */
  function captureKey(e) {
    if (!waiting) return false;
    e.preventDefault();
    if (e.code !== 'Escape') {
      for (const [id] of ACTIONS) if (id !== waiting && S.keys[id] === e.code) S.keys[id] = S.keys[waiting];   // ruilen als hij al bezet was
      S.keys[waiting] = e.code; save();
    }
    waiting = null; render(); return true;
  }
  function toggleView() { S.third = !S.third; save(); if ($('pt-set')) renderSet(); g.ui.toast(S.third ? '🎥 Camera achter je held' : '👁️ Camera door je eigen ogen', '#bbb'); }
  render();
  return { S, actionOf, isDown, captureKey, render, toggleView, get waiting() { return waiting; } };
}
