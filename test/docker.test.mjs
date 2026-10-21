// Bootst de Docker-image na: kopieert precies wat de Dockerfile kopieert en start de server daaruit.
// Vangt "bestand vergeten in de image" (de container stopt dan meteen).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, tmpData } from './helpers.mjs';
const stage = tmpData('docker'); fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(path.join(stage, 'app'), { recursive: true });
const glob = pat => { if (!pat.includes('*')) return [pat]; const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '[^/]*') + '$'); return fs.readdirSync(ROOT).filter(f => re.test(f)); };
for (const line of fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').split('\n')) {
  const m = line.match(/^COPY\s+(.+)$/); if (!m) continue;
  const parts = m[1].trim().split(/\s+/), dest = parts.pop();
  for (const src of parts.flatMap(glob)) {
    const from = path.join(ROOT, src), to = dest.endsWith('/') ? path.join(stage, 'app', dest, path.basename(src)) : path.join(stage, 'app', dest);
    fs.cpSync(from, to, { recursive: true });
  }
}
const srv = spawn(process.execPath, ['server.js'], { cwd: path.join(stage, 'app'), env: { ...process.env, PORT: 8129, EXTRA_PORTS: '', DATA_DIR: path.join(stage, 'data') }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', d => out += d); srv.stderr.on('data', d => out += d);
const ok = await new Promise(r => { srv.on('exit', () => r(false)); const t = setInterval(() => { if (out.includes('luistert')) { clearInterval(t); r(true); } }, 100); setTimeout(() => r(false), 8000); });
let health = null; if (ok) try { health = await (await fetch('http://localhost:8129/api/health')).json(); } catch {}
srv.kill();
console.log((ok && health && health.ok ? 'PASS' : 'FAIL') + ' server start vanuit de image-bestanden' + (ok ? ' (versie ' + (health && health.version) + ')' : '\n' + out));
process.exit(ok && health && health.ok ? 0 : 1);
