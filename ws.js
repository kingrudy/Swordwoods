// Minimale WebSocket-server (RFC 6455) zonder npm-pakketten, met permessage-deflate (RFC 7692) zonder gedeelde
// context: elk bericht wordt los gecomprimeerd. Alleen het transport; wat de berichten betekenen staat in server.js.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFLATE_MIN = 160, TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const MAX_FRAME = 65536, MAX_BUFFER = 1 << 20, MAX_PER_SEC = 400;
/** Totaal verstuurd sinds de start: ongecomprimeerd (raw) en echt over de lijn (sent), in bytes. */
export const netStats = { raw: 0, sent: 0, since: Date.now() };

export class WsConn {
  constructor(sock, deflate = false) {
    this.deflate = deflate; this.rsv1 = false;
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = [];
    this.msgCount = 0; this.msgWindow = Date.now(); this.pongAt = Date.now(); this.closed = false;
    sock.setNoDelay(true);
    sock.on('data', d => this.onData(d));
    sock.on('close', () => this.onClose());
    sock.on('error', () => {});
  }
  /** Wordt aangeroepen met elk tekstbericht (te overschrijven). */
  onMessage(text) {}
  /** Wordt één keer aangeroepen als de verbinding weg is (te overschrijven). */
  onDisconnect() {}

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX_BUFFER) return this.kill();
    let buf = this.buf;
    while (buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1], fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80), rsv1 = !!(b0 & 0x40);
      let n = b1 & 0x7f, off = 2;
      if (n === 126) { if (buf.length < 4) break; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) break; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (n > MAX_FRAME) return this.kill();
      const ml = masked ? 4 : 0;
      if (buf.length < off + ml + n) break;
      let payload = buf.subarray(off + ml, off + ml + n);
      if (masked) { const mk = buf.subarray(off, off + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i & 3]; }
      buf = buf.subarray(off + ml + n);
      if (op === 0x8) { this.kill(); return; }                 // close
      if (op === 0x9) { this.raw(0xA, payload); continue; }    // ping -> pong
      if (op === 0xA) { this.pongAt = Date.now(); continue; }   // pong
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) this.rsv1 = rsv1 && this.deflate;
        this.frag.push(payload);
        if (fin) {
          let data = Buffer.concat(this.frag); this.frag = [];
          if (this.rsv1) { try { data = zlib.inflateRawSync(Buffer.concat([data, TAIL]), { maxOutputLength: MAX_BUFFER, finishFlush: zlib.constants.Z_SYNC_FLUSH }); } catch { return this.kill(); } }
          if (!this.countMessage()) return this.kill();
          this.onMessage(data.toString('utf8'));
          if (this.closed) return;
        }
      }
    }
    this.buf = buf;
  }
  /** Hooguit MAX_PER_SEC berichten per seconde; daarboven is het geen gewone client. */
  countMessage() {
    const now = Date.now();
    if (now - this.msgWindow >= 1000) { this.msgWindow = now; this.msgCount = 0; }
    return ++this.msgCount <= MAX_PER_SEC;
  }
  raw(op, data, rsv = 0) {
    if (this.closed || this.sock.destroyed) return;
    let hdr; const b0 = 0x80 | rsv | op;
    if (data.length < 126) hdr = Buffer.from([b0, data.length]);
    else if (data.length < 65536) { hdr = Buffer.alloc(4); hdr[0] = b0; hdr[1] = 126; hdr.writeUInt16BE(data.length, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = b0; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(data.length), 2); }
    this.sock.write(Buffer.concat([hdr, data]));
    netStats.sent += hdr.length + data.length;
  }
  /** Stuurt een object (als JSON) of een kant-en-klare string. */
  send(obj) {
    if (this.closed || this.sock.destroyed) return;
    if (this.sock.writableLength > 2e6) return;   // trage client: sla updates over
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)); netStats.raw += data.length;
    if (this.deflate && data.length >= DEFLATE_MIN) {
      const z = zlib.deflateRawSync(data, { level: 4, memLevel: 7, finishFlush: zlib.constants.Z_SYNC_FLUSH });   // eindigt op 00 00 ff ff, dat laten we weg
      return this.raw(0x1, z.subarray(0, z.length - 4), 0x40);
    }
    this.raw(0x1, data);
  }
  ping() { this.raw(0x9, Buffer.alloc(0)); }
  kill() { if (!this.closed) { try { this.sock.destroy(); } catch {} } this.onClose(); }
  onClose() { if (this.closed) return; this.closed = true; this.onDisconnect(); }
}

/**
 * Handshake voor /ws. Geeft een nieuwe verbinding van klasse Cls terug, of null als het geen geldig verzoek was.
 * Compressie alleen als de browser erom vraagt en WS_DEFLATE niet 0 is.
 */
export function acceptUpgrade(req, socket, Cls) {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  const deflate = /permessage-deflate/i.test(req.headers['sec-websocket-extensions'] || '') && process.env.WS_DEFLATE !== '0';
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n' +
    (deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '') + '\r\n');
  return new Cls(socket, deflate);
}

/** Elke 20 s een ping; wie een minuut niet antwoordt, wordt afgesloten. */
export function heartbeat(conns) {
  setInterval(() => {
    const now = Date.now();
    for (const c of conns) { if (now - c.pongAt > 60000) c.kill(); else c.ping(); }
  }, 20000).unref?.();
}
