// Balansstatistieken: tellers over alle kamers heen, bewaard in db.json (geen persoonsgegevens).
let S = { since: Date.now(), c: {} };
export function initStats(obj) { S = obj && obj.c ? obj : { since: Date.now(), c: {} }; return S; }
export function bump(key, n = 1) { S.c[key] = (S.c[key] || 0) + n; }
export function maxOf(key, v) { if (!(S.c[key] >= v)) S.c[key] = v; }
export const statsData = () => S;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GROUPS = [
  ['kill.', 'Monsters verslagen (per soort)'], ['death.', 'Spelers gevallen (oorzaak)'], ['wave.reached.', 'Golven gehaald (hoogste golf per kamer, per keer)'],
  ['wipe.', 'Hele kamer gevallen bij golf'], ['buy.', 'Winkelaankopen'], ['trader.', 'Handelaar-aankopen'], ['build.', 'Gebouwd'], ['quest.', 'Opdrachten voltooid'],
  ['mod.', 'Golfmodificaties gespeeld'], ['', 'Overig'],
];
/** Eenvoudige HTML-pagina met tabellen en balkjes, plus een paar afgeleide getallen voor balanceren. */
export function statsHtml(version) {
  const c = S.c, keys = Object.keys(c).sort();
  const used = new Set();
  const avg = (sum, n) => n ? (c[sum] / c[n]).toFixed(1) : '–';
  let html = '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swordwoods · balans</title><style>' +
    'body{font:14px system-ui,sans-serif;background:#0e1a12;color:#e8efe6;margin:0;padding:20px}h1{margin:0 0 4px}p{color:#9fb0a0}section{background:#16241a;border-radius:12px;padding:12px 16px;margin:12px 0;max-width:820px}' +
    'table{width:100%;border-collapse:collapse}td{padding:3px 6px;border-bottom:1px solid #223326}td.n{text-align:right;font-variant-numeric:tabular-nums;width:90px}.bar{height:8px;background:#f2c14e;border-radius:4px}</style></head><body>' +
    '<h1>Swordwoods · balansstatistieken</h1><p>Versie ' + esc(version) + ' · geteld sinds ' + new Date(S.since).toLocaleString('nl-NL') + '. Alleen totalen, geen spelersgegevens.</p>';
  const derived = [
    ['Gemiddelde golfduur (s)', avg('waveSec', 'waves')], ['Golven gespeeld', c.waves | 0], ['Speeltijd (uur)', ((c.playSec || 0) / 3600).toFixed(1)], ['Sessies (kamer betreden)', c.sessions | 0],
    ['Gemiddelde sessie (min)', c.sessions ? ((c.playSec || 0) / 60 / c.sessions).toFixed(1) : '–'], ['Kills per val', c['deaths'] ? ((c.kills || 0) / c.deaths).toFixed(1) : '–'], ['Hoogste golf ooit', c['wave.max'] | 0],
  ];
  html += '<section><h2>Kerngetallen</h2><table>' + derived.map(([k, v]) => '<tr><td>' + k + '</td><td class="n">' + v + '</td></tr>').join('') + '</table></section>';
  // dodelijkheid per monster: hoeveel spelers vallen per 100 kills van die soort
  const mons = keys.filter(k => k.startsWith('kill.')).map(k => k.slice(5));
  if (mons.length) html += '<section><h2>Dodelijkheid per monster</h2><p>Spelers gevallen door deze soort per 100 verslagen exemplaren. Hoog = misschien te sterk.</p><table>' +
    mons.map(m => { const k = c['kill.' + m] | 0, d = c['death.' + m] | 0, r = k ? d / k * 100 : 0; return '<tr><td>' + esc(m) + '</td><td class="n">' + r.toFixed(1) + '</td><td><div class="bar" style="width:' + Math.min(100, r * 2) + '%"></div></td></tr>'; }).join('') + '</table></section>';
  for (const [pre, title] of GROUPS) {
    const ks = keys.filter(k => !used.has(k) && k.startsWith(pre) && (pre || !k.includes('.') || true));
    if (!ks.length) continue;
    ks.forEach(k => used.add(k));
    const max = Math.max(...ks.map(k => c[k]), 1);
    html += '<section><h2>' + title + '</h2><table>' + ks.map(k => '<tr><td>' + esc(k.slice(pre.length)) + '</td><td class="n">' + Math.round(c[k]) + '</td><td><div class="bar" style="width:' + (100 * c[k] / max) + '%"></div></td></tr>').join('') + '</table></section>';
  }
  return html + '</body></html>';
}
