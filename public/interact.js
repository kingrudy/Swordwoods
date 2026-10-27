// Alles wat je met E (telefoon: X, controller: X) kunt doen staat in één lijst, op volgorde van voorrang.
// Dezelfde lijst bepaalt de aanwijzing in beeld, wat E doet en het icoon op de X-knop, zodat die nooit uit elkaar lopen.
import { $ } from './util.js';

export function createInteract(g) {
  const { net, inv, you } = g;
  const key = (touch, short, long) => touch ? short + ' (X)' : '<b>E</b> · ' + long;

  /** test() geeft iets terug als het hier kan; prompt(obj, touch) de tekst; act(obj) wat E doet; icon voor de X-knop. */
  const ACTIONS = [
    { id: 'reel', icon: '🎣', test: () => g.fishing,
      prompt: (f, t) => f.bite ? '<b style="color:#ffd27a;font-size:1.25em">Beet! ' + (t ? 'Tik nu op X' : 'Druk nu op E') + '</b>' : 'Wachten op een beet… ' + (t ? '(X = binnenhalen)' : '(<b>E</b> = binnenhalen)'),
      act: () => g.fish.reel() },
    { id: 'revive', icon: '❤️', test: () => {
        let best = null, bd = 2.5;
        for (const e of g.ents.remotes.values()) { if (!e.dead) continue; const d = Math.hypot(e.x - g.player.x, e.z - g.player.z); if (d < bd) { bd = d; best = e; } }
        return best;
      },
      prompt: (e, t) => (t ? 'Opknappen (X)' : '<b>E</b> · ' + (g.names.get(e.id) || 'medespeler') + ' opknappen') + ' · 3 s blijven staan',
      act: e => net.send({ t: 'revive', id: e.id }) },
    { id: 'desert', icon: '⚒️', test: () => g.des.prompt(false) !== null, prompt: (_, t) => g.des.prompt(t), act: () => g.des.interact() },
    { id: 'dog', icon: '🐕', test: () => g.ents.findWildDog(),
      prompt: (d, t) => {
        const br = d.breed ? ' (' + d.breed.name + ': ' + d.breed.desc + ')' : '';
        if (inv.dog) return 'Je hebt al een hond' + br;
        if (inv.meat <= 0) return 'Deze hond wil vlees. Jaag eerst op een dier.' + br;
        return t ? 'Hond temmen (1 vlees)' : '<b>E</b> · hond vlees geven en temmen' + br;
      },
      act: d => net.send({ t: 'tame', id: d.id }) },
    { id: 'chest', icon: '🧰', test: () => g.scenery.findChest(), prompt: (_, t) => t ? 'Kist openen' : '<b>E</b> · kist openen', act: o => net.send({ t: 'open', i: o.c.idx }) },
    { id: 'ruin', icon: '⚒️', test: () => g.wfx.findRuin(), prompt: (r, t) => g.wfx.ruinPrompt(r, t), act: r => net.send({ t: 'ruin', i: r.R.idx }) },
    { id: 'shop', icon: '🏪', test: () => g.scenery.nearShop(), prompt: (_, t) => t ? 'Winkel openen' : '<b>E</b> · winkel openen', act: () => g.panels.openShop() },
    { id: 'smith', icon: '⚒️', test: () => g.scenery.nearSmith(), prompt: (_, t) => key(t, 'Smid', 'naar de smid'), act: () => g.panels.openSmith() },
    { id: 'trader', icon: '⚒️', test: () => g.wfx.nearTrader(), prompt: (_, t) => key(t, 'Handelaar', 'reizende handelaar'), act: () => g.wfx.openTrader() },
    { id: 'pot', icon: '⚒️', test: () => g.soc.nearPot(), prompt: (_, t) => key(t, 'Gemeenschapskist', 'gemeenschapskist') + ' · ' + g.soc.pot.have + '/' + g.soc.pot.goal + ' hout', act: () => g.soc.openPot() },
    { id: 'fish', icon: '🎣', test: fresh => fresh ? g.fish.findWater() : g.fish.waterAhead(g.time),
      prompt: (_, t) => inv.up.rod ? key(t, 'Vissen', 'vissen') : 'Hier kun je vissen. Koop een vishengel in de winkel.',
      act: w => { if (inv.up.rod) g.fish.cast(w); }, dim: () => !inv.up.rod },
  ];
  function find(fresh = false) {
    for (const a of ACTIONS) { const obj = a.test(fresh); if (obj) return { a, obj }; }
    return null;
  }
  /** E / X: de eerste actie die hier kan. Werkt ook als je hengel in het water ligt, maar niet als je dood bent of een paneel open hebt. */
  function interact() {
    if (g.fishing) { g.fish.reel(); return; }
    if (g.dead || g.shopOpen) return;
    const hit = find(true); if (hit) hit.a.act(hit.obj);
  }

  let cur = null;   // wat er nu kan (voor de X-knop en de tests)
  function update() {
    const pr = $('prompt'), free = g.locked && !g.dead && !g.shopOpen;
    cur = free || (g.fishing && g.locked && !g.dead) ? find() : null;
    let html = null;
    if (g.bs.active && free) { /* bouwmodus regelt de aanwijzing zelf */ }
    else if (g.pl.rooted() && !g.dead) html = '<b style="color:#9adf6a">Vastgegroeid!</b>';
    else if (cur && (free || cur.a.id === 'reel')) html = cur.a.prompt(cur.obj, g.isTouch);
    else if (free && you.hu < 35) html = inv.meat > 0 ? '<b>R</b> · vlees eten (je hebt honger)' : 'Je hebt honger. Jaag op konijnen, herten en everzwijnen.';
    if (!(g.bs.active && free)) { if (html) { pr.innerHTML = html; pr.classList.add('on'); } else pr.classList.remove('on'); }
    if (g.isTouch) {
      const tb = $('tb-use'), usable = cur && !(cur.a.dim && cur.a.dim());
      tb.classList.toggle('dim', !usable); tb.firstElementChild.textContent = usable ? cur.a.icon : '✋';
    }
  }
  return { interact, update, get current() { return cur ? cur.a.id : null; } };
}
