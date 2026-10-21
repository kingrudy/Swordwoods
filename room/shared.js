// Gedeelde instellingen en rekenhulpjes voor de kamersimulatie.
export const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
export const CFG = {
  firstWave: num(process.env.FIRST_WAVE_DELAY, 45),   // seconden tot golf 1
  waveGap: num(process.env.WAVE_GAP, 120),            // seconden tussen "laatste vijand weg" en volgende golf
  wipeDelay: 25,
  respawn: 8,
  hungerRate: num(process.env.HUNGER_RATE, 0.22),     // punten per seconde (100 -> 0 in ~7,5 min)
  treeRespawn: 240, chestRespawn: 600,
  animalTarget: 38, desertAnimals: 16,
  maxSpeed: num(process.env.MAX_SPEED, 14),   // m/s: rennen is 9, met marge voor springen en vertraging
  strays: num(process.env.STRAY_DOGS, 3), strayRespawn: 180, dogDown: 20,
  cheats: process.env.ALLOW_CHEATS === '1',   // alleen voor testen: /spawn <type> [n], /golf [mod], /hout <n>
};

export const r1 = v => Math.round(v * 10) / 10;
export const r2 = v => Math.round(v * 100) / 100;
export const len = (x, z) => Math.sqrt(x * x + z * z);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
