// Weergave van niveau, talenten, opdrachten en prestaties (lobby en pauzemenu).
import { levelInfo, TALENTS, talentPoints, spentPoints, questText, questIcon, ACHIEVEMENTS } from './progress.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function levelHtml(save) {
  const L = levelInfo(save.xp | 0);
  return '<div class="lvl"><b>Niveau ' + L.level + '</b><span class="lvlbar"><i style="width:' + (L.need ? Math.round(100 * L.into / L.need) : 100) + '%"></i></span><small>' +
    (L.need ? L.into + ' / ' + L.need + ' ervaring' : 'maximaal niveau') + '</small></div>';
}

/** Talentenlijst; klikken stuurt { t: 'talent', id } via send. */
export function renderTalents(el, save, send) {
  const L = levelInfo(save.xp | 0), tal = save.tal || {}, free = talentPoints(L.level) - spentPoints(tal);
  el.innerHTML = levelHtml(save) +
    '<p class="tal-free">' + (free > 0 ? '<b>' + free + '</b> talentpunt' + (free === 1 ? '' : 'en') + ' te besteden' : 'Elk nieuw niveau geeft een talentpunt.') + '</p>' +
    '<div class="tal-grid">' + TALENTS.map(T => {
      const n = tal[T.id] | 0, can = free > 0 && n < T.max;
      return '<button type="button" class="tal' + (can ? ' can' : '') + '" data-tal="' + T.id + '"' + (can ? '' : ' disabled') + '><span class="ti">' + T.icon + '</span><b>' + esc(T.name) + ' ' + n + '/' + T.max + '</b><small>' +
        esc(n ? T.desc(n) : T.desc(1) + ' per punt') + '</small></button>';
    }).join('') + '</div>' +
    (spentPoints(tal) ? '<button type="button" class="btn small" data-tal="reset">Talenten opnieuw verdelen</button>' : '');
  el.onclick = e => { const b = e.target.closest('[data-tal]'); if (b && !b.disabled) send({ t: 'talent', id: b.dataset.tal }); };
}

export function renderQuests(el, save, compact = false) {
  const d = save.daily; if (!d || !d.q) { el.innerHTML = ''; return; }
  el.innerHTML = (compact ? '' : '<p class="q-note">Elke dag drie nieuwe opdrachten. Beloning komt direct binnen.</p>') + d.q.map(q =>
    '<div class="quest' + (q.done ? ' done' : '') + '"><span>' + questIcon(q) + '</span><div><b>' + esc(questText(q)) + '</b>' +
    '<span class="qbar"><i style="width:' + Math.round(100 * Math.min(1, q.have / q.need)) + '%"></i></span><small>' + (q.done ? '✔ Voltooid' : q.have + ' / ' + q.need) +
    (compact ? '' : ' · ' + q.wood + ' hout, ' + q.xp + ' ervaring') + '</small></div></div>').join('');
}

export function renderAchievements(el, save) {
  const got = save.ach || {}, n = ACHIEVEMENTS.filter(A => got[A.id]).length;
  el.innerHTML = '<p class="q-note">' + n + ' van ' + ACHIEVEMENTS.length + ' behaald</p><div class="ach-grid">' + ACHIEVEMENTS.map(A =>
    '<div class="ach' + (got[A.id] ? ' got' : '') + '" title="' + esc(A.desc) + '"><span>' + A.icon + '</span><b>' + esc(A.name) + '</b><small>' + esc(A.desc) + '</small></div>').join('') + '</div>';
}
