import { ROOT, tmpData } from './helpers.mjs';
// Instellingen: standaardwaarden, grenzen en eigen toetsen (zonder browser, met een nep-opslag).
import { loadSettings, DEFAULTS, ACTIONS, keyLabel } from '../public/settings.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const store = v => ({ getItem: () => v });
const d = loadSettings(store(null));
ok(d.sens === 1 && d.fov === 72 && !d.third && d.keys.forward === 'KeyW' && d.keys.use === 'KeyE', 'standaard: W vooruit, E gebruiken, gevoeligheid 1, beeldhoek 72');
ok(new Set(Object.values(DEFAULTS.keys)).size === ACTIONS.length, 'geen dubbele standaardtoetsen');
const c = loadSettings(store(JSON.stringify({ sens: 9, fov: 10, keys: { forward: 'KeyZ' }, third: true })));
ok(c.sens === 3 && c.fov === 55 && c.third && c.keys.forward === 'KeyZ' && c.keys.back === 'KeyS', 'grenzen worden bewaakt, eigen toets blijft, de rest standaard');
ok(loadSettings(store('{kapot')).fov === 72, 'kapotte opslag: gewoon de standaard');
ok(keyLabel('KeyW') === 'W' && keyLabel('Space') === 'Spatie' && keyLabel('Digit3') === '3', 'leesbare toetsnamen');
process.exit(fails ? 1 : 0);
