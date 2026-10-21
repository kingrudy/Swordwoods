// Moderatie: dempen, verbannen, chatlog en meldingen. Wordt gebruikt door de server en de kamers.
const chatLog = [];        // laatste 300 chatberichten (alleen in het geheugen)
export function logChat(room, name, text) {
  chatLog.push({ at: Date.now(), room, name, text });
  if (chatLog.length > 300) chatLog.shift();
}
export const recentChat = () => chatLog.slice(-300);
export const modOf = u => (u.mod && typeof u.mod === 'object') ? u.mod : (u.mod = {});
export function mutedUntil(u) { const m = u && u.mod; return m && m.mutedUntil > Date.now() ? m.mutedUntil : 0; }
export const isBanned = u => !!(u && u.mod && u.mod.banned);
const fmt = t => new Date(t).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
export const muteText = u => 'Je bent gedempt tot ' + fmt(mutedUntil(u)) + '. Je kunt nu niet chatten.';
