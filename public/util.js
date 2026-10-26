// Kleine hulpjes die door veel bestanden gebruikt worden (client én server; `$` alleen in de browser).
export const $ = id => document.getElementById(id);
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const ease = t => t * t * (3 - 2 * t);
/** m:ss */
export const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
/** Laat de browser even ademen tijdens het laden. */
export const nextFrame = () => new Promise(r => setTimeout(r, 0));
/** Kijkrichting (x,z) bij een yaw. */
export const fwdOf = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
/** Ligt (tx,tz) binnen afstand d van (x,z) en ongeveer voor je (cosinus ≥ minDot)? Geeft de afstand of -1. */
export function inFront(x, z, yaw, tx, tz, maxD, minDot) {
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
  if (d > maxD) return -1;
  const f = fwdOf(yaw);
  return (dx * f.x + dz * f.z) / (d || 1) >= minDot ? d : -1;
}
