// Dunne WebSocket-laag met event-handlers en een buffer voor berichten die binnenkomen terwijl het spel nog laadt.
export class Net {
  constructor() { this.h = {}; this.buffering = false; this.buf = []; this.ws = null; }
  open() {
    if (this.ws) { this.ws.onclose = null; this.ws.onmessage = null; try { this.ws.close(); } catch {} }
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(proto + '://' + location.host + '/ws');
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Geen verbinding met de server.'));
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (this.buffering) this.buf.push(m); else this.dispatch(m);
      };
      ws.onclose = () => this.dispatch({ t: '_close' });
    });
  }
  on(type, fn) { (this.h[type] || (this.h[type] = [])).push(fn); return this; }
  dispatch(m) { for (const f of this.h[m.t] || []) f(m); }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  /** Laat gebufferde berichten los (aanroepen zodra het spel zijn handlers heeft geregistreerd). */
  flush() { this.buffering = false; const b = this.buf; this.buf = []; for (const m of b) this.dispatch(m); }
}
