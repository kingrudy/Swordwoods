// Voortgang: niveaus en talenten, dagelijkse opdrachten, prestaties en de smid. Gedeeld door server en client.
import { RARITIES } from './items.js';

/* ---------------------------------------------------------------- niveaus */
export const MAX_LEVEL = 30;
export const xpNeeded = lvl => 80 + 40 * lvl;                 // xp om van lvl naar lvl+1 te gaan
export function levelInfo(xp) {
  let lvl = 1, rest = Math.max(0, xp | 0);
  while (lvl < MAX_LEVEL && rest >= xpNeeded(lvl)) { rest -= xpNeeded(lvl); lvl++; }
  return { level: lvl, into: rest, need: lvl < MAX_LEVEL ? xpNeeded(lvl) : 0 };
}
export const XP = { kill: 1, animal: 3, tree: 4, chest: 10, fish: 5, wave: 15, build: 2, ore: 4 };   // kill: × monsterscore

/* ---------------------------------------------------------------- talenten */
export const TALENTS = [
  { id: 'kracht',      name: 'Kracht',     icon: '💪', max: 5, desc: n => '+' + n * 6 + '% schade' },
  { id: 'taai',        name: 'Taaiheid',   icon: '❤️', max: 5, desc: n => '+' + n * 10 + ' maximale gezondheid' },
  { id: 'vlug',        name: 'Vlugheid',   icon: '💨', max: 3, desc: n => '+' + n * 4 + '% loopsnelheid, rol ' + (n * 0.1).toFixed(1) + ' s eerder klaar' },
  { id: 'maag',        name: 'Ijzeren maag', icon: '🍖', max: 4, desc: n => 'honger zakt ' + n * 10 + '% langzamer' },
  { id: 'houthakker',  name: 'Houthakker', icon: '🪓', max: 3, desc: n => '+' + n + ' hout per boom' },
  { id: 'mijnwerker',  name: 'Mijnwerker', icon: '⛏️', max: 3, desc: n => '+' + n * 15 + '% kans op erts' },
  { id: 'baasje',      name: 'Baasje',     icon: '🐕', max: 3, desc: n => 'je hond +' + n * 10 + '% schade en levens' },
];
export const TALENT_BY_ID = Object.fromEntries(TALENTS.map(t => [t.id, t]));
export const talentPoints = level => Math.max(0, level - 1);
export const spentPoints = tal => Object.values(tal || {}).reduce((a, b) => a + (b | 0), 0);
export const tal = (save, id) => ((save.tal || {})[id] | 0);
export const maxHp = save => 100 + 10 * tal(save, 'taai');

/* ---------------------------------------------------------------- dagelijkse opdrachten */
export const QUEST_KINDS = [
  { kind: 'kill',   text: n => 'Versla ' + n + ' monsters',          min: 15, max: 40, icon: '🗡️' },
  { kind: 'tree',   text: n => 'Hak ' + n + ' bomen om',              min: 8,  max: 20, icon: '🌲' },
  { kind: 'animal', text: n => 'Jaag op ' + n + ' dieren',            min: 4,  max: 10, icon: '🦌' },
  { kind: 'chest',  text: n => 'Open ' + n + ' kisten',               min: 2,  max: 5,  icon: '🧰' },
  { kind: 'fish',   text: n => 'Vang ' + n + ' vissen',               min: 3,  max: 8,  icon: '🐟' },
  { kind: 'build',  text: n => 'Bouw ' + n + ' bouwwerken',           min: 3,  max: 8,  icon: '🔨' },
  { kind: 'wave',   text: n => 'Overleef golf ' + n,                  min: 4,  max: 8,  icon: '🌊', best: true },
  { kind: 'heavy',  text: n => 'Versla ' + n + ' vijanden met een zware slag', min: 5, max: 12, icon: '💥' },
  { kind: 'ore',    text: n => 'Hak ' + n + ' erts uit ertsaders',    min: 4,  max: 10, icon: '⛏️' },
  { kind: 'dig',    text: n => 'Graaf in ' + n + ' zandbergen op het Woestijneiland', min: 3, max: 8, icon: '🏜️' },
];
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export function today(now = Date.now()) {
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam' }).format(now); } catch { return new Date(now).toISOString().slice(0, 10); }
}
/** Drie opdrachten per speler per dag, altijd dezelfde voor dezelfde naam en datum. */
export function dailyQuests(name, day) {
  let h = hash(String(name).toLowerCase() + '|' + day);
  const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; h = (h + 0x9e3779b9) >>> 0; return (h % 100000) / 100000; };
  const pool = QUEST_KINDS.slice(), out = [];
  for (let i = 0; i < 3; i++) {
    const q = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const need = q.min + Math.floor(rnd() * (q.max - q.min + 1));
    out.push({ kind: q.kind, need, have: 0, done: false, wood: 15 + Math.round(need / q.max * 35), xp: 60 + Math.round(need / q.max * 90) });
  }
  return out;
}
export const questText = q => { const K = QUEST_KINDS.find(k => k.kind === q.kind); return K ? K.text(q.need) : q.kind; };
export const questIcon = q => (QUEST_KINDS.find(k => k.kind === q.kind) || {}).icon || '•';

/* ---------------------------------------------------------------- weekranglijst en weekevents */
/** ISO-week (Nederlandse tijd), bv. { k: '2026-W43', week: 43, year: 2026, left: 3 } (left = dagen tot maandag). */
export function isoWeek(now = Date.now()) {
  const [y, m, d] = today(now).split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d)), dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);                 // donderdag van deze week bepaalt het jaar
  const year = t.getUTCFullYear(), week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 864e5 + 1) / 7);
  return { k: year + '-W' + String(week).padStart(2, '0'), week, year, left: 8 - dow };
}
/** Elke week een ander event; de vermenigvuldigers gelden voor iedereen in alle kamers. */
export const WEEK_EVENTS = [
  { id: 'hout',     icon: '🪓', name: 'Houthakkersweek', desc: 'Dubbel hout van bomen',                          wood: 2 },
  { id: 'monster',  icon: '⚔️', name: 'Monsterweek',     desc: '+50% punten en ervaring voor golven, 2× zo vaak een zwaard van monsters', wave: 1.5, drop: 2 },
  { id: 'woestijn', icon: '🏜️', name: 'Woestijnweek',    desc: 'Vaker faraobeelden en dubbel goud uit zandbergen', statue: 0.1, digGold: 2 },
  { id: 'jacht',    icon: '🍖', name: 'Jachtweek',       desc: 'Dubbel vlees van dieren',                        meat: 2 },
  { id: 'vis',      icon: '🎣', name: 'Visweek',         desc: 'Vissen bijten twee keer zo snel en vaker een gouden vis', fishFast: 0.5, goldFish: 2 },
];
export const weekEvent = (w = isoWeek()) => WEEK_EVENTS[(w.year * 53 + w.week) % WEEK_EVENTS.length];
/** Beloning voor de top 3 van de weekranglijst (goud). */
export const WEEK_PRIZES = [150, 100, 60];

/* ---------------------------------------------------------------- prestaties */
const st = (s, k) => ((s.stats || {})[k] | 0);
export const ACHIEVEMENTS = [
  { id: 'eerste',     icon: '🗡️', name: 'Eerste bloed',      desc: 'Versla je eerste monster',        test: s => st(s, 'kills') >= 1 },
  { id: 'jager100',   icon: '💀', name: 'Monsterjager',      desc: 'Versla 100 monsters',             test: s => st(s, 'kills') >= 100 },
  { id: 'jager1000',  icon: '🩸', name: 'Schrik van het bos', desc: 'Versla 1000 monsters',           test: s => st(s, 'kills') >= 1000 },
  { id: 'golf5',      icon: '🌊', name: 'Stormbreker',       desc: 'Overleef golf 5',                 test: s => st(s, 'bestWave') >= 5 },
  { id: 'golf10',     icon: '🛡️', name: 'Bosbewaker',        desc: 'Overleef golf 10',                test: s => st(s, 'bestWave') >= 10 },
  { id: 'golf20',     icon: '👑', name: 'Koning van het woud', desc: 'Overleef golf 20',              test: s => st(s, 'bestWave') >= 20 },
  { id: 'reus',       icon: '🌳', name: 'Reuzendoder',       desc: 'Versla een Woudreus',             test: s => st(s, 'bosses') >= 1 },
  { id: 'bomen',      icon: '🪓', name: 'Houthakker',        desc: 'Hak 100 bomen om',                test: s => st(s, 'trees') >= 100 },
  { id: 'kisten',     icon: '🧰', name: 'Schatzoeker',       desc: 'Open 25 kisten',                  test: s => st(s, 'chests') >= 25 },
  { id: 'legende',    icon: '✨', name: 'Legende',           desc: 'Bezit een legendarisch zwaard',   test: s => (s.swords || []).some(w => w.rarity === RARITIES.length - 1) },
  { id: 'hond',       icon: '🐕', name: 'Beste vriend',      desc: 'Tem een hond',                    test: s => !!s.dog },
  { id: 'hond10',     icon: '🦴', name: 'Trouwe makker',     desc: 'Je hond bereikt niveau 10',       test: s => !!s.dog && s.dog.level >= 10 },
  { id: 'vissen',     icon: '🎣', name: 'Visser',            desc: 'Vang 25 vissen',                  test: s => st(s, 'fish') >= 25 },
  { id: 'bouwen',     icon: '🏰', name: 'Bouwmeester',       desc: 'Bouw 25 bouwwerken',              test: s => st(s, 'built') >= 25 },
  { id: 'erts',       icon: '⛏️', name: 'Mijnwerker',        desc: 'Hak 50 erts',                     test: s => st(s, 'ore') >= 50 },
  { id: 'smid',       icon: '⚒️', name: 'Meestersmid',       desc: 'Smeed een zwaard tot +5',          test: s => st(s, 'forgedMax') >= 5 },
  { id: 'dieren',     icon: '🦌', name: 'Woudjager',         desc: 'Jaag op 50 dieren',               test: s => st(s, 'animals') >= 50 },
  { id: 'uur',        icon: '⏳', name: 'Bosbewoner',        desc: 'Speel in totaal een uur',         test: s => st(s, 'playSec') >= 3600 },
  { id: 'niveau10',   icon: '⭐', name: 'Ervaren',           desc: 'Bereik niveau 10',                test: s => levelInfo(s.xp | 0).level >= 10 },
  { id: 'kerker',     icon: '🏛️', name: 'Grafrover',         desc: 'Plunder een kerkerkist',          test: s => st(s, 'dungeons') >= 1 },
  { id: 'reiziger',   icon: '🧭', name: 'Ontdekkingsreiziger', desc: 'Bezoek alle vier de gebieden',  test: s => Object.keys(s.biomes || {}).length >= 4 },
  { id: 'kampioen',   icon: '🏆', name: 'Kampioen',          desc: 'Win 10 duels in de arena',        test: s => st(s, 'pvpWins') >= 10 },
  { id: 'gul',        icon: '🎁', name: 'Gulle gever',       desc: 'Geef 5 keer iets aan een ander',  test: s => st(s, 'gifts') >= 5 },
  { id: 'feest',      icon: '🍗', name: 'Feestbeest',        desc: 'Vier een feestmaal in je kamer',  test: s => st(s, 'feasts') >= 1 },
  { id: 'zeeman',     icon: '⛵', name: 'Zeeman',            desc: 'Vaar naar het Woestijneiland',   test: s => st(s, 'voyages') >= 1 },
  { id: 'archeoloog', icon: '🗿', name: 'Archeoloog',        desc: 'Vind 10 faraobeelden',           test: s => st(s, 'statues') >= 10 },
  { id: 'mummie',     icon: '🧟', name: 'Farao gevloerd',    desc: 'Versla de mummie-farao in de piramide', test: s => st(s, 'pharaohs') >= 1 },
  { id: 'farao',      icon: '👑', name: 'Schat van de farao', desc: 'Vind het gouden masker van de farao', test: s => st(s, 'masks') >= 1 },
  { id: 'goudzoeker', icon: '💰', name: 'Goudzoeker',        desc: 'Verdien 500 goud',               test: s => st(s, 'goldEarned') >= 500 },
  { id: 'opdrachten', icon: '📅', name: 'Plichtsgetrouw',    desc: 'Voltooi 10 dagelijkse opdrachten', test: s => st(s, 'quests') >= 10 },
];

/* ---------------------------------------------------------------- uitleg voor nieuwe spelers */
// Een vaste reeks kleine opdrachten. kind = wat de server meldt (zelfde namen als bij de dagelijkse opdrachten, plus eat/buy/voyage).
export const TUTORIAL = [
  { kind: 'tree',   icon: '🌲', text: 'Hak een boom om',          hint: 'Loop naar een boom en sla erop (klik of A) tot hij valt.', wood: 10, xp: 20 },
  { kind: 'chest',  icon: '🧰', text: 'Open een kist',            hint: 'Kisten herken je aan een oranje lichtzuil. Ga ervoor staan en druk E (X).', wood: 5, xp: 25 },
  { kind: 'animal', icon: '🦌', text: 'Jaag op een dier',         hint: 'Konijnen en herten geven vlees. Pas op: everzwijnen vechten terug.', wood: 5, xp: 25 },
  { kind: 'eat',    icon: '🍖', text: 'Eet een stuk vlees',       hint: 'Druk R (of Y) als je honger hebt. Eten herstelt ook wat gezondheid.', wood: 5, xp: 15 },
  { kind: 'build',  icon: '🔥', text: 'Bouw een kampvuur',        hint: 'Druk B (🔨), kies het kampvuur en klik. Bij het vuur genees je.', wood: 15, xp: 25 },
  { kind: 'buy',    icon: '🏪', text: 'Koop iets bij Bram',       hint: 'De winkel staat vlak bij het begin (blauwe lichtzuil). Druk daar E.', wood: 10, xp: 25 },
  { kind: 'kill',   icon: '🗡️', text: 'Versla een monster',       hint: 'Monsters komen in golven. Houd de muisknop vast voor een zware slag.', wood: 15, xp: 40 },
  { kind: 'voyage', icon: '⛵', text: 'Vaar naar het Woestijneiland', hint: 'Bouw een boot (B, vakje 7) in het water bij de kust en vaar naar het oosten.', wood: 0, xp: 60 },
  { kind: 'dig',    icon: '🏜️', text: 'Graaf in een zandberg',    hint: 'Sta naast een zandberg en druk E. Misschien vind je een faraobeeld!', wood: 0, xp: 60, gold: 20 },
];

/* ---------------------------------------------------------------- smid */
export const FORGE_MAX = 5;
export const forgeCost = f => ({ ore: 2 + f * 2, wood: 15 + f * 15 });     // van +f naar +f+1
export const forgeGain = sw => Math.max(1, Math.round((sw.d0 || sw.damage) * 0.1));
export const meltValue = sw => 1 + sw.rarity * 2 + (sw.f | 0);
export const swordLabel = sw => sw.name + (sw.f ? ' +' + sw.f : '');
