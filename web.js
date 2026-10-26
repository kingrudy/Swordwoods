// HTTP-hulpjes: statische spelbestanden (met gzip en cache), de build-id en JSON lezen/schrijven.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const MIME = { '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.jpg': 'image/jpeg' };
const GZIP = new Set(['.html', '.js', '.css', '.json', '.svg', '.glb']);

/**
 * Build-id: hash van de spelbestanden en de spelregels op de server. Staat in elk script-adres (/b/<id>/...),
 * zodat een browser of proxy nooit oude spelcode kan combineren met een nieuwe server.
 */
export function buildId(publicDir, serverFiles = []) {
  const h = crypto.createHash('sha256');
  const walk = d => { for (const f of fs.readdirSync(d).sort()) { const p = path.join(d, f); if (f === 'vendor') continue; if (fs.statSync(p).isDirectory()) walk(p); else h.update(f).update(fs.readFileSync(p)); } };
  for (const p of [publicDir, ...serverFiles]) {
    try { if (fs.statSync(p).isDirectory()) walk(p); else h.update(path.basename(p)).update(fs.readFileSync(p)); } catch {}
  }
  return h.digest('hex').slice(0, 10);
}

export function createStatic(publicDir, build) {
  const cache = new Map();
  return function serveStatic(req, res) {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname), versioned = false;
    const vm = /^\/b\/([A-Za-z0-9]+)(\/.*)$/.exec(p);
    if (vm) { versioned = vm[1] === build; p = vm[2]; }
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(publicDir, p));
    if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Niet gevonden'); return; }
      const ext = path.extname(file), isHtml = ext === '.html';
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': isHtml ? 'no-store, max-age=0' : (versioned || p.startsWith('/vendor/')) ? 'public, max-age=31536000, immutable' : 'no-store, max-age=0' };
      const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && GZIP.has(ext);
      const ck = file + (gz ? ':gz' : ''), hit = cache.get(ck);
      if (hit && hit.mtime === st.mtimeMs) { if (gz) headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers).end(hit.buf); return; }
      fs.readFile(file, (e, buf) => {
        if (e) { res.writeHead(500).end(); return; }
        if (isHtml) buf = Buffer.from(buf.toString('utf8').replaceAll('__BUILD__', build));
        if (gz) { buf = zlib.gzipSync(buf); headers['Content-Encoding'] = 'gzip'; }
        cache.set(ck, { mtime: st.mtimeMs, buf });
        res.writeHead(200, headers).end(buf);
      });
    });
  };
}

/** JSON-body van hooguit 4 KB. */
export function readJson(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 4096) { reject(new Error('te groot')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
export const json = (res, code, obj) => res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(obj));
export const html = (res, code, body) => res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(body);
/** IP-adres van de bezoeker (achter een reverse proxy: X-Forwarded-For). */
export const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
