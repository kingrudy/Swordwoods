// Accounts: registreren, inloggen, sessies (tokens), wachtwoord wijzigen, een rem op te veel pogingen
// en de ranglijst van alle tijden. Wachtwoorden worden gehasht met scrypt; de database is gewoon `db`.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ensureSave } from './room.js';
import { isBanned } from './moderation.js';

const scrypt = promisify(crypto.scrypt);
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const USER_RE = /^[A-Za-z0-9_-]{3,16}$/;
const SESSION_MS = 30 * 24 * 3600 * 1000;
export const hashPw = async (pw, salt) => (await scrypt(pw, salt, 64)).toString('hex');
const sameHash = (a, b) => crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

export function createAccounts({ db, markDirty }) {
  function newSession(key) {
    const token = crypto.randomBytes(24).toString('hex');
    db.sessions[sha(token)] = { u: key, exp: Date.now() + SESSION_MS };
    markDirty();
    return token;
  }
  function userByToken(token) {
    if (typeof token !== 'string') return null;
    const s = db.sessions[sha(token)];
    if (!s) return null;
    if (s.exp < Date.now()) { delete db.sessions[sha(token)]; return null; }
    return db.users[s.u] || null;
  }
  async function register(name, pw) {
    if (typeof name !== 'string' || !USER_RE.test(name)) return { err: 'Gebruikersnaam: 3-16 tekens (letters, cijfers, _ of -).' };
    if (typeof pw !== 'string' || pw.length < 6 || pw.length > 72) return { err: 'Wachtwoord: minimaal 6 tekens.' };
    const key = name.toLowerCase();
    if (db.users[key]) return { err: 'Die gebruikersnaam is al in gebruik.' };
    const salt = crypto.randomBytes(16).toString('hex');
    const u = { name, salt, hash: await hashPw(pw, salt), created: Date.now(), save: {} };
    if (db.users[key]) return { err: 'Die gebruikersnaam is al in gebruik.' };   // tijdens het hashen kan iemand anders hem net hebben genomen
    db.users[key] = u; ensureSave(u);
    return { token: newSession(key), name };
  }
  async function login(name, pw) {
    const key = typeof name === 'string' ? name.toLowerCase() : '';
    const u = db.users[key];
    const h = await hashPw(typeof pw === 'string' ? pw.slice(0, 72) : '', u ? u.salt : 'x'.repeat(32));   // ook zonder account even lang rekenen
    if (!u || !sameHash(h, u.hash)) return { err: 'Onjuiste gebruikersnaam of wachtwoord.' };
    if (isBanned(u)) return { err: 'Dit account is geblokkeerd door de beheerder.' + (u.mod.reason ? ' Reden: ' + u.mod.reason : '') };
    return { token: newSession(key), name: u.name };
  }
  /** Wachtwoord wijzigen met het oude wachtwoord; andere sessies (andere apparaten) worden uitgelogd. */
  async function changePassword(token, oldPw, newPw) {
    const u = userByToken(token);
    if (!u) return { code: 401, err: 'Log opnieuw in.' };
    if (limited('pw' + u.name)) return { code: 429, err: 'Te veel pogingen. Probeer het over een minuut opnieuw.' };
    if (!sameHash(await hashPw(String(oldPw || '').slice(0, 72), u.salt), u.hash)) return { code: 400, err: 'Je huidige wachtwoord klopt niet.' };
    const pw = String(newPw || ''); if (pw.length < 6 || pw.length > 72) return { code: 400, err: 'Nieuw wachtwoord: minimaal 6 tekens.' };
    u.salt = crypto.randomBytes(16).toString('hex'); u.hash = await hashPw(pw, u.salt);
    const keep = sha(token), key = u.name.toLowerCase();
    for (const [h, s] of Object.entries(db.sessions)) if (s.u === key && h !== keep) delete db.sessions[h];
    markDirty();
    return { code: 200, ok: true };
  }

  // maximaal 15 pogingen per minuut per sleutel (IP-adres, of 'pw' + naam)
  const attempts = new Map();
  function limited(key) {
    const now = Date.now(), arr = (attempts.get(key) || []).filter(t => now - t < 60000);
    arr.push(now); attempts.set(key, arr);
    return arr.length > 15;
  }
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of attempts) if (!arr.some(t => now - t < 60000)) attempts.delete(k);
    for (const [h, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[h];
  }, 600000).unref();

  function leaderboard() {
    return Object.values(db.users)
      .map(u => ({ name: u.name, bestWave: u.save?.stats?.bestWave | 0, score: u.save?.stats?.score | 0, kills: u.save?.stats?.kills | 0 }))
      .filter(x => x.score > 0 || x.bestWave > 0)
      .sort((a, b) => b.bestWave - a.bestWave || b.score - a.score).slice(0, 10);
  }
  return { register, login, userByToken, changePassword, limited, leaderboard };
}
