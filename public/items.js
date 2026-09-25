// Gedeeld tussen client en server: zwaarden en buit.

export const RARITIES = [
  { name: 'Gewoon',       color: '#c9c9c9', w: 50, dmg: [4, 8],   names: ['Roestig', 'Oud', 'Eenvoudig', 'Versleten'], blade: 0x9aa0a6, emi: 0 },
  { name: 'Goed',         color: '#6fd37a', w: 28, dmg: [9, 15],  names: ['Stalen', 'Gesmede', 'Scherpe', 'Jagers'], blade: 0xc3cdd6, emi: 0 },
  { name: 'Zeldzaam',     color: '#4aa3ff', w: 14, dmg: [16, 25], names: ['Zilveren', 'Stormbrekers', 'Bosgeest', 'IJsklauw'], blade: 0x9fd0ff, emi: 0.35 },
  { name: 'Episch',       color: '#b56bff', w: 6,  dmg: [26, 40], names: ['Schaduwsnijder', 'Drakenbeet', 'Vuurtong', 'Nachtwacht'], blade: 0xcaa0ff, emi: 0.7 },
  { name: 'Legendarisch', color: '#ffb03a', w: 2,  dmg: [42, 60], names: ['Koning Aldrics', 'Zonnebrand', 'Wereldsplijter', 'Dageraad'], blade: 0xffd27a, emi: 1.1 },
];

export const BASES = [
  { name: 'Kortzwaard', len: 0.78, w: 0.075, speed: 1.25 },
  { name: 'Zwaard', len: 0.95, w: 0.09, speed: 1.0 },
  { name: 'Langzwaard', len: 1.12, w: 0.09, speed: 0.85 },
  { name: 'Slagzwaard', len: 1.0, w: 0.115, speed: 0.8 },
];

export const AXE = { type: 'axe', name: 'Houthakkersbijl', damage: 3, speed: 1 };
export const MAX_SWORDS = 8;

const lerp = (a, b, t) => a + (b - a) * t;

/** luck 0..1 schuift kansen richting zeldzamere zwaarden. */
export function rollSword(luck, rnd = Math.random) {
  const ws = RARITIES.map((r, i) => r.w * (1 + luck * i * 1.6));
  let t = rnd() * ws.reduce((a, b) => a + b, 0), ri = 0;
  for (; ri < ws.length - 1; ri++) { if (t < ws[ri]) break; t -= ws[ri]; }
  const R = RARITIES[ri], bi = Math.floor(rnd() * BASES.length), B = BASES[bi];
  return {
    type: 'sword', rarity: ri, base: bi,
    name: R.names[Math.floor(rnd() * R.names.length)] + ' ' + B.name,
    damage: Math.round(lerp(R.dmg[0], R.dmg[1], rnd())),
    speed: +(B.speed * (0.92 + rnd() * 0.16)).toFixed(2),
  };
}

/** Compacte code voor het vastgehouden item in snapshots: 0 = bijl, anders 1 + rarity*4 + base. */
export const eqCode = it => (!it || it.type === 'axe') ? 0 : 1 + it.rarity * 4 + it.base;
export const decodeEq = c => c > 0 ? { type: 'sword', rarity: Math.floor((c - 1) / 4), base: (c - 1) % 4 } : { type: 'axe' };

export function validSword(s) {
  return s && s.type === 'sword' && Number.isInteger(s.rarity) && s.rarity >= 0 && s.rarity < RARITIES.length &&
    Number.isInteger(s.base) && s.base >= 0 && s.base < BASES.length && typeof s.name === 'string' &&
    Number.isFinite(s.damage) && Number.isFinite(s.speed);
}

// Monsters en dieren (getallen die de server gebruikt; de client gebruikt alleen namen/afmetingen)
export const MONSTERS = [
  { key: 'kobold', name: 'Boskobold',    hp: 24, dmg: 6,  speed: 3.7, r: 0.5, score: 10, minWave: 1, weight: 6, atkCd: 1.1 },
  { key: 'wolf',   name: 'Schaduwwolf',  hp: 18, dmg: 8,  speed: 6.3, r: 0.55, score: 12, minWave: 2, weight: 4, atkCd: 0.8 },
  { key: 'troll',  name: 'Steentrol',    hp: 90, dmg: 16, speed: 2.9, r: 0.95, score: 30, minWave: 4, weight: 2, atkCd: 1.6 },
  { key: 'reus',   name: 'Wereldreus',   hp: 420, dmg: 30, speed: 3.3, r: 1.7, score: 150, minWave: 99, weight: 0, atkCd: 2.0 },
];
export const ANIMALS = [
  { key: 'konijn',    name: 'Konijn',    hp: 8,  speed: 7.5, flee: 15, meat: 1, r: 0.3 },
  { key: 'hert',      name: 'Hert',      hp: 24, speed: 9.5, flee: 22, meat: 3, r: 0.6 },
  { key: 'everzwijn', name: 'Everzwijn', hp: 42, speed: 5.5, flee: 0,  meat: 4, r: 0.6, dmg: 11 },
];
