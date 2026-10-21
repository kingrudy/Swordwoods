// Opgeslagen spelersgegevens: controleren/aanvullen bij laden, dagelijkse opdrachten en talenten.
import { MAX_POTIONS, DOG_MAX_LEVEL, DOG_FURS, statueOf, breedOf } from '../public/items.js';
import { levelInfo, TALENT_BY_ID, talentPoints, spentPoints, tal, today, dailyQuests, FORGE_MAX, TUTORIAL } from '../public/progress.js';
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
  s.stats = Object.assign({ kills: 0, deaths: 0, bestWave: 0, score: 0, animals: 0, trees: 0, chests: 0, playSec: 0, built: 0, bosses: 0, fish: 0, ore: 0, forgedMax: 0, quests: 0, heavyKills: 0, dungeons: 0, pvpWins: 0, pvpLosses: 0, gifts: 0, feasts: 0, voyages: 0, digs: 0, statues: 0, masks: 0, goldEarned: 0 }, s.stats || {});
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
