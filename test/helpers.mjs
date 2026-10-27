// Gedeelde hulpjes voor de tests.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Lege map voor de database van een testserver. */
export const tmpData = name => path.join(os.tmpdir(), 'swordwoods-test-' + name + '-' + process.pid);
// Geen weekevent tijdens tests (anders hangen uitkomsten van de kalender af). week.test.mjs zet het zelf.
process.env.WEEK_EVENT ??= 'geen';
process.env.LOGIN_REWARD ??= '0';   // inlogbeloning uit, behalve in login.test.mjs
// Servers die een test start, gaan altijd mee dood als de test stopt (ook bij een crash), zodat de poort vrij blijft.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const kids = new Set(), origSpawn = cp.spawn;
cp.spawn = (...a) => { const c = origSpawn(...a); kids.add(c); c.on('exit', () => kids.delete(c)); return c; };
syncBuiltinESMExports();
process.on('exit', () => { for (const c of kids) try { c.kill('SIGKILL'); } catch {} });
