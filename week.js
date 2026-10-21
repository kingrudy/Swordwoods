// Weekranglijst: punten = ervaring verdiend in de huidige ISO-week. Bij de wissel van de week krijgt de top 3 goud.
import { isoWeek, weekEvent, WEEK_EVENTS, WEEK_PRIZES } from './public/progress.js';

export function createWeekly({ db, rooms, markDirty, now = () => Date.now(), log = console.log }) {
  const current = () => { const w = isoWeek(now()); return { ...w, ev: WEEK_EVENTS.find(e => e.id === process.env.WEEK_EVENT) || weekEvent(w) }; };

  function ranking(k, n = 10) {
    return Object.values(db.users)
      .filter(u => u.save && u.save.week && u.save.week.k === k && u.save.week.pts > 0)
      .sort((a, b) => b.save.week.pts - a.save.week.pts || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  /** Sluit een week af: prijzen voor de top 3 en een regel in de geschiedenis. */
  function finalize(k) {
    const top = ranking(k);
    top.slice(0, WEEK_PRIZES.length).forEach((u, i) => {
      const s = u.save, gold = WEEK_PRIZES[i];
      s.gold = (s.gold | 0) + gold;
      s.stats.weekTop3 = (s.stats.weekTop3 | 0) + 1; if (i === 0) s.stats.weekWins = (s.stats.weekWins | 0) + 1;
      if (!Array.isArray(s.notes)) s.notes = [];
      s.notes.push('🏆 Je werd ' + (i + 1) + 'e in de weekranglijst van ' + k.replace('-W', ' week ') + ': +' + gold + ' goud!');
      for (const r of rooms.values()) for (const P of r.players.values()) if (P.u === u) {   // nu online: meteen laten zien
        for (const n of s.notes.splice(0)) r.toast(P, n, '#ffd27a');
        r.sendInv(P);
      }
    });
    db.weekHist = [{ k, top: top.map(u => ({ name: u.name, pts: u.save.week.pts })) }, ...(Array.isArray(db.weekHist) ? db.weekHist : [])].slice(0, 8);
    log('Week ' + k + ' afgesloten: ' + (top.slice(0, 3).map(u => u.name).join(', ') || 'niemand'));
  }

  function tick() {
    const k = current().k;
    if (!db.weekK) { db.weekK = k; markDirty(); }
    else if (db.weekK !== k) { finalize(db.weekK); db.weekK = k; markDirty(); }
  }

  function board() {
    const w = current(), last = Array.isArray(db.weekHist) ? db.weekHist[0] : null;
    return {
      k: w.k, week: w.week, left: w.left, ev: { id: w.ev.id, icon: w.ev.icon, name: w.ev.name, desc: w.ev.desc },
      top: ranking(w.k).map(u => ({ name: u.name, pts: u.save.week.pts })),
      last: last ? { k: last.k, top: last.top.slice(0, 3) } : null,
    };
  }
  return { tick, board, finalize };
}
