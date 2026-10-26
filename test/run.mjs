// Draait alle tests na elkaar: node test/run.mjs [naamfilter]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';
const filter = process.argv[2] || '';
const files = fs.readdirSync(path.join(ROOT, 'test')).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();
let failed = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join('test', f)], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  const ok = r.status === 0, out = (r.stdout || '') + (r.stderr || '');
  console.log((ok ? '✔ ' : '✘ ') + f.padEnd(24) + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  if (!ok) {
    failed.push(f);
    const tail = out.split('\n').filter(l => !l.startsWith('PASS')).slice(-25).join('\n');
    console.log(tail);
    // op GitHub als annotatie, zodat je zonder logs ziet welke test en waarom
    if (process.env.GITHUB_ACTIONS) console.log('::error title=' + f + '::' + tail.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A').slice(-3000));
  }
}
console.log(failed.length ? '\n' + failed.length + ' van ' + files.length + ' mislukt: ' + failed.join(', ') : '\nAlle ' + files.length + ' tests geslaagd.');
process.exit(failed.length ? 1 : 0);
