// Minimal dependency-free WebSocket server (RFC 6455): text frames, ping/pong, close, fragmentation.
// Usage: attachWebSocket(httpServer, (conn, req) => { conn.on('message', (str) => ...); conn.send(obj); });
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 4 * 1024 * 1024;

class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket; this.buf = Buffer.alloc(0); this.frags = []; this.fragOp = 0;
    this.closed = false; this.lastRx = Date.now(); this.data = {};     // data: free slot for the app (room, side...)
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  finish() { if (this.closed) return; this.closed = true; this.emit('close'); try { this.socket.destroy(); } catch { /* ignore */ } }

  // droppable: skip the message if this client is badly backed up (used for 20 Hz frame spam)
  send(obj, droppable = false) {
    if (this.closed) return false;
    if (droppable && this.socket.writableLength > 512 * 1024) return false;
    this.frame(0x1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)));
    return true;
  }

  frame(op, payload) {
    const n = payload.length; let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(n, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch { this.finish(); }
  }

  ping() { if (!this.closed) this.frame(0x9, Buffer.alloc(0)); }
  close(code = 1000) { if (this.closed) return; const b = Buffer.alloc(2); b.writeUInt16BE(code); this.frame(0x8, b); setTimeout(() => this.finish(), 100); }

  onData(d) {
    this.lastRx = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], fin = !!(b0 & 0x80), op = b0 & 0x0f, masked = !!(b1 & 0x80);
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; const big = this.buf.readBigUInt64BE(2); if (big > BigInt(MAX_PAYLOAD)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_PAYLOAD) return this.close(1009);
      if (!masked) return this.close(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4), payload = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this.frame(0xa, payload); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        if (op !== 0x0) { this.frags = []; this.fragOp = op; }
        this.frags.push(payload);
        if (this.frags.reduce((n, p) => n + p.length, 0) > MAX_PAYLOAD) return this.close(1009);
        if (fin) { const msg = Buffer.concat(this.frags); this.frags = []; if (this.fragOp === 0x1) this.emit('message', msg.toString('utf8')); }
      }
    }
  }
}

export function attachWebSocket(server, onConnection) {
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    let path = ''; try { path = new URL(req.url, 'http://x').pathname; } catch { /* ignore */ }
    const key = req.headers['sec-websocket-key'];
    if (path !== '/ws' || !key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new Conn(socket);
    conns.add(conn); conn.on('close', () => conns.delete(conn));
    onConnection(conn, req);
  });
  const hb = setInterval(() => {
    const t = Date.now();
    for (const c of conns) { if (t - c.lastRx > 45000) c.finish(); else c.ping(); }
  }, 15000);
  hb.unref();
  return conns;
}
