// Opgeslagen spelersgegevens: controleren/aanvullen bij laden, dagelijkse opdrachten en talenten.
import { MAX_POTIONS, MAX_SWORDS, DOG_MAX_LEVEL, DOG_FURS, statueOf, breedOf, rollSwordAtLeast, cosmetic } from '../public/items.js';
import { levelInfo, TALENT_BY_ID, talentPoints, spentPoints, tal, today, yesterday, dailyQuests, FORGE_MAX, TUTORIAL, isoWeek, LOGIN_REWARDS } from '../public/progress.js';
import { clamp } from './shared.js';

export function ensureSave(u) {
  const s = u.save || (u.save = {});
  s.wood = s.wood | 0; s.meat = s.meat | 0; s.potions = clamp(s.potions | 0, 0, MAX_POTIONS);
  s.fish = Math.max(0, s.fish | 0);
  s.up = Object.assign({ shield: 0, axe: 0, rod: 0 }, s.up || {}); s.up.rod = clamp(s.up.rod | 0, 0, 1); s.up.shield = clamp(s.up.shield | 0, 0, 3); s.up.axe = clamp(s.up.axe | 0, 0, 3);
  if (!Array.isArray(s.swords)) s.swords = [];
  s.equip = clamp(s.equip | 0, 0, s.swords.length);
  if (s.dog && (typeof s.dog.name !== 'string' || !Number.isFinite(s.dog.level))) s.dog = null;
  if (s.dog) { s.dog.breed = breedOf(s.dog.breed).id; s.dog.level = clamp(s.dog.level | 0, 1, DOG_MAX_LEVEL); s.dog.xp = Math.max(0, s.dog.xp | 0); s.dog.fur = clamp(s.dog.fur | 0, 0, DOG_FURS.length - 1); }
  if (!Number.isInteger(s.look) || s.look < 0 || s.look > 3) { let h = 0; for (const ch of String(u.name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; s.look = h % 4; }
  s.stats = Object.assign({ kills: 0, deaths: 0, bestWave: 0, score: 0, animals: 0, trees: 0, chests: 0, playSec: 0, built: 0, bosses: 0, fish: 0, ore: 0, forgedMax: 0, quests: 0, heavyKills: 0, dungeons: 0, pvpWins: 0, pvpLosses: 0, gifts: 0, feasts: 0, voyages: 0, digs: 0, statues: 0, masks: 0, goldEarned: 0, pharaohs: 0, weekTop3: 0, weekWins: 0, revives: 0, meals: 0, travels: 0 }, s.stats || {});
  if (!s.biomes || typeof s.biomes !== 'object') s.biomes = {};
  s.xp = Math.max(0, s.xp | 0); s.ore = Math.max(0, s.ore | 0); s.gold = Math.max(0, s.gold | 0);
  s.up.shovel = clamp(s.up.shovel | 0, 0, 1);
  if (!s.statues || typeof s.statues !== 'object') s.statues = {};
  for (const k of Object.keys(s.statues)) if (!statueOf(k)) delete s.statues[k]; else s.statues[k] = Math.max(0, s.statues[k] | 0);
  if (!s.tal || typeof s.tal !== 'object') s.tal = {};
  for (const k of Object.keys(s.tal)) { const T = TALENT_BY_ID[k]; if (!T) delete s.tal[k]; else s.tal[k] = clamp(s.tal[k] | 0, 0, T.max); }
  if (spentPoints(s.tal) > talentPoints(levelInfo(s.xp).level)) s.tal = {};
  if (!s.ach || typeof s.ach !== 'object') s.ach = {};
  // uitleg: nieuwe spelers beginnen bij stap 0; wie al lang speelt slaat hem over
  if (!Number.isInteger(s.tut)) s.tut = (s.stats.kills > 20 || s.stats.playSec > 1800) ? TUTORIAL.length : 0;
  s.tut = clamp(s.tut, 0, TUTORIAL.length);
  for (const w of s.swords) { if (!Number.isFinite(w.d0)) w.d0 = w.damage; w.f = clamp(w.f | 0, 0, FORGE_MAX); }
  if (!s.cos || typeof s.cos !== 'object') s.cos = {};       // uiterlijk: wat je hebt en wat je draagt
  s.cos.own = Array.isArray(s.cos.own) ? [...new Set(s.cos.own.filter(id => cosmetic(id)))] : [];
  for (const slot of ['hat', 'cape', 'collar']) { const c = cosmetic(s.cos[slot]); s.cos[slot] = c && c.slot === slot && s.cos.own.includes(c.id) ? c.id : null; }
  s.travel = s.travel ? 1 : 0;                                // reisstenen geactiveerd
  if (!s.stash || typeof s.stash !== 'object') s.stash = {};
  for (const k of ['wood', 'meat', 'fish', 'ore']) s.stash[k] = Math.max(0, s.stash[k] | 0);
  if (!Array.isArray(s.notes)) s.notes = [];
  s.notes = s.notes.filter(n => typeof n === 'string').slice(-5);
  ensureWeek(s);
  ensureDaily(u);
  return s;
}

/** Dagelijkse opdrachten verversen als de dag om is. */
export function ensureDaily(u) {
  const s = u.save, day = today();
  if (!s.daily || s.daily.day !== day || !Array.isArray(s.daily.q)) s.daily = { day, q: dailyQuests(u.name, day) };
  return s.daily;
}

/** Talent kopen of alles terugzetten (lobby en kamer). Geeft true als er iets veranderde. */
export function applyTalent(s, id) {
  if (id === 'reset') { if (!spentPoints(s.tal)) return false; s.tal = {}; return true; }
  const T = TALENT_BY_ID[id]; if (!T) return false;
  const cur = s.tal[id] | 0, free = talentPoints(levelInfo(s.xp).level) - spentPoints(s.tal);
  if (cur >= T.max || free <= 0) return false;
  s.tal[id] = cur + 1; return true;
}

/** Weekpunten (= ervaring verdiend in deze ISO-week); een nieuwe week begint weer bij 0. */
export function ensureWeek(s, k = isoWeek().k) {
  if (!s.week || typeof s.week !== 'object' || s.week.k !== k) s.week = { k, pts: 0 };
  s.week.pts = Math.max(0, s.week.pts | 0);
  return s.week;
}

/**
 * Inlogbeloning: de eerste keer per dag (Nederlandse tijd). Een reeks van opeenvolgende dagen loopt op tot 7;
 * mis je een dag of heb je dag 7 gehad, dan begint hij weer bij 1. Geeft { day, text } als er iets is uitgedeeld.
 */
export function claimLogin(u, now = Date.now()) {
  if (process.env.LOGIN_REWARD === '0') return null;   // tests: geen beloning tussen de verwachte getallen
  const s = u.save, d = today(now);
  if (!s.login || typeof s.login !== 'object') s.login = { last: '', streak: 0 };
  if (s.login.last === d) return null;
  const streak = s.login.last === yesterday(now) && s.login.streak < LOGIN_REWARDS.length ? s.login.streak + 1 : 1;
  s.login = { last: d, streak };
  const R = LOGIN_REWARDS[streak - 1];
  s.wood += R.wood | 0; s.meat += R.meat | 0; s.gold = (s.gold | 0) + (R.gold | 0); s.ore = (s.ore | 0) + (R.ore | 0);
  s.potions = Math.min(MAX_POTIONS, s.potions + (R.potions | 0));
  let swordName = '';
  if (R.sword) {
    const sw = rollSwordAtLeast(2, 1.5); sw.d0 = sw.damage; sw.f = 0; swordName = ' (' + sw.name + ')';
    if (s.swords.length < MAX_SWORDS) s.swords.push(sw);
    else { let wi = 0; s.swords.forEach((x, i) => { if (x.damage < s.swords[wi].damage) wi = i; }); if (sw.damage > s.swords[wi].damage) s.swords[wi] = sw; }
  }
  const text = 'Inlogbeloning dag ' + streak + ' van 7: ' + R.text + swordName + '.';
  s.notes.push(R.icon + ' ' + text);
  return { day: streak, text };
}

/** Wat iemand draagt, zoals andere spelers het te zien krijgen. */
export const wearing = s => ({ hat: s.cos?.hat || null, cape: s.cos?.cape || null, collar: s.cos?.collar || null });

/** Uiterlijk kopen (met goud) of dragen/afdoen. Geeft een foutmelding terug, of null als het gelukt is. */
export function cosAction(s, op, id, slot) {
  if (op === 'wear' && !id) { if (['hat', 'cape', 'collar'].includes(slot)) s.cos[slot] = null; return null; }
  const c = cosmetic(id); if (!c) return 'Onbekend.';
  if (op === 'buy') {
    if (s.cos.own.includes(c.id)) return 'Heb je al.';
    if (c.need && (s.stats[c.need.stat] | 0) < c.need.n) return c.need.text + '.';
    if ((s.gold | 0) < c.cost) return 'Te weinig goud (' + c.cost + ' nodig).';
    s.gold -= c.cost; s.cos.own.push(c.id); s.cos[c.slot] = c.id;
    return null;
  }
  if (op === 'wear') { if (!s.cos.own.includes(c.id)) return 'Koop dit eerst.'; s.cos[c.slot] = c.id; return null; }
  return 'Onbekend.';
}
