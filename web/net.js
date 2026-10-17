// WebSocket client with auto-reconnect and server-clock sync.
export class Net {
  constructor() { this.handlers = new Map(); this.ws = null; this.offset = 0; this.rtt = 9999; this.alive = false; this.room = null; this.tries = 0; this.pingTimer = null; this.closedByUs = false; }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(fn); return this; }
  emit(type, m) { for (const fn of this.handlers.get(type) || []) { try { fn(m); } catch (e) { console.error('handler', type, e); } } }

  connect(code, token) {
    this.room = { code, token }; this.closedByUs = false; this.open();
  }
  open() {
    if (!this.room) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`); this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.alive = true; ws.send(JSON.stringify({ t: 'hello', code: this.room.code, token: this.room.token || '' })); this.emit('_open', {}); this.ping(); clearInterval(this.pingTimer); this.pingTimer = setInterval(() => this.ping(), 2500); };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.serverNow && (m.t === 'welcome')) this.offset = m.serverNow - Date.now();
      if (m.t === 'pong') {
        const rtt = Date.now() - m.c;
        if (rtt <= this.rtt + 5 || this.samples === undefined) { this.rtt = Math.min(this.rtt, rtt); this.offset = m.serverNow - (m.c + rtt / 2); }
        this.samples = (this.samples || 0) + 1; if (this.samples % 8 === 0) this.rtt = 9999;   // re-measure now and then
        return;
      }
      this.emit(m.t, m);
    };
    ws.onclose = () => {
      this.alive = false; clearInterval(this.pingTimer); this.emit('_close', {});
      if (!this.closedByUs && this.room) setTimeout(() => this.open(), Math.min(4000, 400 * 2 ** this.tries++));
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }
  ping() { this.send({ t: 'ping', c: Date.now() }); }
  send(o) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(o)); return true; } return false; }
  close() { this.closedByUs = true; this.room = null; clearInterval(this.pingTimer); if (this.ws) try { this.ws.close(); } catch { /* ignore */ } }
  get serverNow() { return Date.now() + this.offset; }
}
