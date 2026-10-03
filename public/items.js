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
  return rollSwordOfRarity(ri, rnd);
}

/** Zwaard van een vaste zeldzaamheid (winkel). */
export function rollSwordOfRarity(ri, rnd = Math.random) {
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
  { key: 'troll',  name: 'Bosmonster',    hp: 90, dmg: 16, speed: 2.9, r: 0.95, score: 30, minWave: 4, weight: 2, atkCd: 1.6 },
  { key: 'reus',   name: 'Woudreus',   hp: 420, dmg: 30, speed: 3.3, r: 1.7, score: 150, minWave: 99, weight: 0, atkCd: 2.0 },
  { key: 'schutter', name: 'Skeletschutter', hp: 20, dmg: 9, speed: 3.4, r: 0.5, score: 14, minWave: 3, weight: 3, atkCd: 2.4, ranged: true },
  { key: 'sluiper',  name: 'Sluiper',        hp: 16, dmg: 13, speed: 6.4, r: 0.45, score: 16, minWave: 5, weight: 2, atkCd: 1.3, stealth: true },
  { key: 'jager',    name: 'Hondenjager',    hp: 60, dmg: 12, speed: 4.6, r: 0.6, score: 22, minWave: 6, weight: 2, atkCd: 1.2, hunter: true },
];
/** Golfmodificaties: soms krijgt een golf een extra eigenschap (en meer beloning). */
export const WAVE_MODS = [
  { id: 'snel',    name: 'Snelle golf', desc: 'Monsters zijn 25% sneller', spd: 1.25 },
  { id: 'pantser', name: 'Gepantserd',  desc: '60% meer levens, iets trager', hp: 1.6, spd: 0.9 },
  { id: 'zwerm',   name: 'Zwerm',       desc: 'De helft meer monsters met minder levens', count: 1.5, hp: 0.7 },
  { id: 'woest',   name: 'Woeste golf', desc: 'Monsters doen 30% meer schade', dmg: 1.3 },
];
export const HEAVY_MUL = 2.2, ROLL_CD = 1.0, ROLL_IFRAME = 0.45, BLOCK_MELEE = 0.3;
export const ANIMALS = [
  { key: 'konijn',    name: 'Konijn',    hp: 8,  speed: 7.5, flee: 15, meat: 1, r: 0.3 },
  { key: 'hert',      name: 'Hert',      hp: 24, speed: 9.5, flee: 22, meat: 3, r: 0.6 },
  { key: 'everzwijn', name: 'Everzwijn', hp: 42, speed: 5.5, flee: 0,  meat: 4, r: 0.6, dmg: 11, fights: true },
  { key: 'gerbil',    name: 'Gerbil',    hp: 5,  speed: 8.0, flee: 12, meat: 1, r: 0.22, desert: true },
  { key: 'kangoeroe', name: 'Kangoeroe', hp: 30, speed: 10,  flee: 18, meat: 4, r: 0.55, dmg: 9, fights: true, desert: true },
];

/* ---------------------------------------------------------------- woestijn: faraobeelden en goud */
export const STATUES = [
  { k: 'brons',  name: 'Bronzen faraobeeld',      icon: '🟫', value: 15,  w: 60, color: '#c98a4a' },
  { k: 'zilver', name: 'Zilveren faraobeeld',     icon: '⬜', value: 40,  w: 28, color: '#d8dee6' },
  { k: 'goud',   name: 'Gouden faraobeeld',       icon: '🟨', value: 100, w: 10, color: '#f2c14e' },
  { k: 'masker', name: 'Gouden masker van de farao', icon: '👑', value: 300, w: 2, color: '#ffd27a' },
];
export const statueOf = k => STATUES.find(x => x.k === k);
export const DIG_SEC = 2.6, DIG_SEC_SHOVEL = 1.3, MOUND_BACK = 360;
/** Bazaar van Farid (woestijnhaven): beelden verkopen voor goud, spullen kopen met goud of hout. */
export const BAZAAR = [
  { id: 'shovel', name: 'Schep',           icon: '🪏', cost: 20, cur: 'wood', desc: 'Graaf twee keer zo snel en vind vaker een beeld.' },
  { id: 'dates',  name: 'Zak dadels',      icon: '🌴', cost: 2,  cur: 'gold', desc: '4 vlees: eten voor onderweg.' },
  { id: 'wood',   name: 'Stapel hout',     icon: '🪵', cost: 5,  cur: 'gold', desc: '60 hout (genoeg voor een paar boten).' },
  { id: 'water',  name: 'Oasewater',       icon: '🧪', cost: 3,  cur: 'gold', desc: 'Twee helende drankjes.' },
];

// ---------------------------------------------------------------- winkel
// Alles kost hout. De server controleert prijs, afstand en limieten; de client toont alleen deze lijst.
export const SHIELD_REDUCE = [0, 0.12, 0.24, 0.36];   // minder schade per schildniveau
export const AXE_LEVELS = 3;                          // bijl-upgrades: +1 schade op bomen, +2 op wezens per niveau
export const MAX_POTIONS = 5;
export const SHOP = [
  { id: 'meat1',   group: 'Eten',      name: 'Vlees',            desc: 'Eet het tegen honger (R).', cost: 3,   kind: 'meat', n: 1 },
  { id: 'meat5',   group: 'Eten',      name: 'Vleespakket',      desc: 'Vijf stukken vlees.',       cost: 13,  kind: 'meat', n: 5 },
  { id: 'potion',  group: 'Drankjes',  name: 'Helende drank',    desc: 'Herstelt 50 gezondheid (Q). Je kunt er 5 dragen.', cost: 8, kind: 'potion' },
  { id: 'shield1', group: 'Uitrusting', name: 'Houten schild',   desc: '12% minder schade.',        cost: 20,  kind: 'shield', level: 1 },
  { id: 'shield2', group: 'Uitrusting', name: 'Beslagen schild', desc: '24% minder schade.',        cost: 60,  kind: 'shield', level: 2 },
  { id: 'shield3', group: 'Uitrusting', name: 'IJzeren schild',  desc: '36% minder schade.',        cost: 140, kind: 'shield', level: 3 },
  { id: 'rod',     group: 'Uitrusting', name: 'Vishengel',     desc: 'Vis aan de waterkant (E). Vis geeft je hond een boost (G).', cost: 25, kind: 'rod' },
  { id: 'axe1',    group: 'Uitrusting', name: 'Scherpe bijl',    desc: 'Hakt sneller, doet meer schade.', cost: 15, kind: 'axe', level: 1 },
  { id: 'axe2',    group: 'Uitrusting', name: 'Gesmede bijl',    desc: 'Nog scherper.',             cost: 40,  kind: 'axe', level: 2 },
  { id: 'axe3',    group: 'Uitrusting', name: 'Meesterbijl',     desc: 'De beste bijl van de smid.', cost: 90, kind: 'axe', level: 3 },
  { id: 'sword1',  group: 'Zwaarden',  name: 'Zwaard van goede kwaliteit', desc: 'Willekeurig zwaard, zeldzaamheid Goed.',     cost: 30,  kind: 'sword', rarity: 1 },
  { id: 'sword2',  group: 'Zwaarden',  name: 'Zeldzaam zwaard',  desc: 'Willekeurig zwaard, zeldzaamheid Zeldzaam.', cost: 85,  kind: 'sword', rarity: 2 },
  { id: 'sword3',  group: 'Zwaarden',  name: 'Episch zwaard',    desc: 'Willekeurig zwaard, zeldzaamheid Episch.',   cost: 220, kind: 'sword', rarity: 3 },
  { id: 'sword4',  group: 'Zwaarden',  name: 'Legendarisch zwaard', desc: 'Willekeurig zwaard, zeldzaamheid Legendarisch.', cost: 600, kind: 'sword', rarity: 4 },
  { id: 'gsword',  group: 'Voor goud', name: 'Farao-zwaard',     desc: 'Legendarisch zwaard, betaald met goud uit de woestijn.', cost: 250, gold: true, kind: 'sword', rarity: 4 },
  { id: 'gepic',   group: 'Voor goud', name: 'Episch zwaard',    desc: 'Willekeurig episch zwaard.', cost: 90, gold: true, kind: 'sword', rarity: 3 },
  { id: 'gwood',   group: 'Voor goud', name: 'Wagen hout',       desc: '150 hout.', cost: 10, gold: true, kind: 'wood', n: 150 },
];

// ---------------------------------------------------------------- hond (companion)
export const DOG_NAMES = ['Bas', 'Max', 'Bobby', 'Luna', 'Rakker', 'Guus', 'Sam', 'Bello', 'Pip', 'Moos', 'Kees', 'Fleur', 'Tarzan', 'Joep', 'Nala', 'Bruno'];
export const DOG_MAX_LEVEL = 10;
export const dogStats = level => ({ maxhp: 60 + 15 * (level - 1), dmg: 6 + 3 * (level - 1), speed: 8.5 });
export const dogXpNeeded = level => 30 + level * 30;
export const DOG_FURS = [0xc8903f, 0x3a2a20, 0xe8dcc8, 0x8a5a2b, 0x777777];   // kleurvarianten
export const DOG_BOOST_SEC = 60, DOG_BOOST_MAX = 180;
/** Hondenrassen: een zwerfhond heeft een ras, dat bepaalt zijn sterke kanten. */
export const DOG_BREEDS = [
  { id: 'herder', name: 'Herder',    hp: 1.0, dmg: 1.0,  spd: 1.0,  desc: 'Evenwichtig en trouw.' },
  { id: 'jacht',  name: 'Jachthond', hp: 0.9, dmg: 1.1,  spd: 1.25, desc: 'Snel en jaagt zelf op dieren in de buurt.' },
  { id: 'waak',   name: 'Waakhond',  hp: 1.45, dmg: 0.9, spd: 0.95, desc: 'Stevig: monsters dichtbij vallen hem aan in plaats van jou.' },
  { id: 'speur',  name: 'Speurneus', hp: 1.0, dmg: 0.9,  spd: 1.1,  desc: 'Vindt kisten en ertsaders van veel verder weg.' },
];
export const breedOf = id => DOG_BREEDS.find(b => b.id === id) || DOG_BREEDS[0];
export const DOG_CMDS = [
  { c: 'follow', name: 'Volg',     icon: '🐾', desc: 'Loop met me mee' },
  { c: 'stay',   name: 'Blijf',    icon: '✋', desc: 'Bewaak deze plek' },
  { c: 'attack', name: 'Val aan',  icon: '⚔️', desc: 'Val het monster aan waar je naar kijkt' },
  { c: 'seek',   name: 'Zoek',     icon: '👃', desc: 'Zoek een kist (speurneus: ook erts)' },
];
/** Gemeenschapskist: de hele kamer spaart hout voor een feestmaal. */
export const potGoal = lvl => 300 + 150 * (lvl - 1);
export const FEAST_SEC = 600;

/** Reizende handelaar: komt af en toe langs met bijzondere waren (vier per bezoek). */
export const TRADER_ITEMS = [
  { id: 'mystery', name: 'Mysterieuze kist', icon: '🎁', cost: 140, desc: 'Een zwaard, minstens zeldzaam, met grote kans op episch of legendarisch.' },
  { id: 'elixir',  name: 'Krachtelixer',     icon: '⚗️', cost: 40,  desc: '5 minuten 25% meer schade.' },
  { id: 'haste',   name: 'Windthee',         icon: '🍵', cost: 30,  desc: '3 minuten 20% sneller lopen.' },
  { id: 'ore',     name: 'Zak erts',         icon: '⛏️', cost: 45,  desc: '10 erts voor de smid.' },
  { id: 'snack',   name: 'Hondenkoekje',     icon: '🦴', cost: 35,  desc: 'Je hond krijgt 150 ervaring.' },
  { id: 'potions', name: 'Drie drankjes',    icon: '🧪', cost: 20,  desc: 'Drie helende drankjes (tot je maximum).' },
];
export const WEATHERS = [
  { k: 'helder', name: 'Helder', w: 45 },
  { k: 'regen',  name: 'Regen',  w: 25, desc: 'Vissen bijten sneller.' },
  { k: 'onweer', name: 'Onweer', w: 12, desc: 'Pas op voor de bliksem!' },
  { k: 'mist',   name: 'Mist',   w: 18, desc: 'Je ziet minder ver.' },
];
export const BIOMES = {
  forest: { name: 'Het Woud', icon: '🌲', desc: '' },
  snow:   { name: 'Het Sneeuwveld', icon: '❄️', desc: 'Het is koud: je krijgt 30% sneller honger, behalve bij een kampvuur.' },
  swamp:  { name: 'Het Moeras', icon: '🐸', desc: 'Je loopt langzamer door de modder. Er groeit veel vis.' },
  dark:   { name: 'Het Duistere Bos', icon: '🌑', desc: 'Kisten bevatten hier betere zwaarden.' },
  desert: { name: 'Het Woestijneiland', icon: '🏜️', desc: 'Graaf in zandbergen naar faraobeelden en verkoop ze bij Farid voor goud.' },
};
