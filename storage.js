// Opslag van db.json: veilig schrijven (eerst een tijdelijk bestand, fsync, dan hernoemen),
// dagelijkse back-ups (gzip, standaard 7 dagen bewaard) en herstel als het bestand kapot is.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export function createStorage(dataDir, { keep = Number(process.env.BACKUP_DAYS) || 7, log = console } = {}) {
  const FILE = path.join(dataDir, 'db.json'), BDIR = path.join(dataDir, 'backups');
  fs.mkdirSync(BDIR, { recursive: true });
  const backups = () => fs.readdirSync(BDIR).filter(f => /^db-\d{4}-\d{2}-\d{2}(-\d+)?\.json\.gz$/.test(f)).sort();

  /** Laadt de database. Kapot bestand: apart zetten en de nieuwste goede back-up gebruiken (nooit stilletjes leeg beginnen). */
  function load(empty) {
    let raw;
    try { raw = fs.readFileSync(FILE, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { db: empty, source: 'nieuw' }; throw e; }
    try { return { db: Object.assign(empty, JSON.parse(raw)), source: 'db.json' }; }
    catch (e) {
      const bad = FILE + '.kapot-' + new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(FILE, bad);
      log.error('db.json is beschadigd (' + e.message + '); bewaard als ' + path.basename(bad));
      for (const b of backups().reverse()) {
        try { const db = Object.assign(empty, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BDIR, b))).toString('utf8'))); log.error('Hersteld uit back-up ' + b); return { db, source: b }; }
        catch { log.error('Back-up ' + b + ' is ook onleesbaar'); }
      }
      throw new Error('db.json is beschadigd en er is geen bruikbare back-up. Zie ' + bad);
    }
  }
  function save(db) {
    const tmp = FILE + '.tmp', data = JSON.stringify(db);
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, FILE);
  }
  /** Maakt een back-up als de laatste ouder is dan een dag (of altijd met force). Ruimt oude op. */
  function backup(force = false) {
    if (!fs.existsSync(FILE)) return null;
    const list = backups(), last = list[list.length - 1];
    if (!force && last && Date.now() - fs.statSync(path.join(BDIR, last)).mtimeMs < 23.5 * 3600 * 1000) return null;
    let name = 'db-' + new Date().toISOString().slice(0, 10) + '.json.gz';
    for (let n = 2; fs.existsSync(path.join(BDIR, name)); n++) name = 'db-' + new Date().toISOString().slice(0, 10) + '-' + n + '.json.gz';
    fs.writeFileSync(path.join(BDIR, name), zlib.gzipSync(fs.readFileSync(FILE)));
    const all = backups(); for (const old of all.slice(0, Math.max(0, all.length - keep))) fs.unlinkSync(path.join(BDIR, old));
    log.log('Back-up gemaakt: ' + name);
    return name;
  }
  return { load, save, backup, backups, dir: BDIR };
}
