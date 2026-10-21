// Gedeelde hulpjes voor de tests.
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Lege map voor de database van een testserver. */
export const tmpData = name => path.join(os.tmpdir(), 'swordwoods-test-' + name + '-' + process.pid);
