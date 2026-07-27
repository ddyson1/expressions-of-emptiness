/**
 * eoe-live — the live notebook engine.
 *
 * One Durable Object per notebook. One pen: only the first blank page is
 * writable, held by whoever starts typing. Words broadcast as pencil while
 * typed; after two quiet minutes they set into ink. Nothing needs approval;
 * nothing is beyond the eraser.
 *
 * WS protocol (JSON):
 *   s→c: state, presence{count}, pencil{n,text}, pen{held}, ink{entry,open}, deny{reason}
 *   c→s: take, write{text}, sign{name}, release
 */

import { DurableObject } from 'cloudflare:workers';

const BANNED = ['viagra', 'casino', 'crypto giveaway', 'http://', 'https://'];
const MAX_CHARS = 1000;
const INK_IDLE_MS = 2 * 60 * 1000;   /* quiet time before pencil sets */
const EMPTY_PEN_MS = 90 * 1000;      /* pen held but nothing written */
const ALARM_TICK_MS = 30 * 1000;
const INK_COOLDOWN_MS = 60 * 60 * 1000; /* one inked page per ip-hash per hour */

const J = { 'content-type': 'application/json' };

function corsHeaders(env, origin) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',');
  const ok = allowed.includes(origin) ? origin : allowed[0];
  return {
    'access-control-allow-origin': ok,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function keyMatches(env, given) {
  if (!env.OWNER_KEY || !given) return false;
  const a = new TextEncoder().encode(await sha256hex(given));
  const b = new TextEncoder().encode(await sha256hex(env.OWNER_KEY));
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

export class Notebook extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  /* ---------- state helpers ---------- */

  async _entries() { return (await this.ctx.storage.get('entries')) || []; }
  _pages() { return parseInt(this.env.PAGES_PER_NOTEBOOK, 10) || 48; }

  _openPage(entries) {
    const taken = new Set(entries.map((e) => e.n));
    for (let n = 1; n <= this._pages(); n++) if (!taken.has(n)) return n;
    return null; /* notebook full */
  }

  async _pencil() { return (await this.ctx.storage.get('pencil')) || null; }

  _broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch (_) { /* socket already gone */ }
    }
  }

  async _stateMsg() {
    const entries = await this._entries();
    const pencil = await this._pencil();
    return {
      t: 'state',
      id: (await this.ctx.storage.get('id')) || '001',
      pages: this._pages(),
      entries,
      open: this._openPage(entries),
      pencil: pencil ? { n: pencil.n, text: pencil.text } : null,
      presence: this.ctx.getWebSockets().length,
      killed: this.env.KILLED === 'true'
    };
  }

  /* ---------- RPC (worker-facing) ---------- */

  async getState() { return this._stateMsg(); }

  async seed(id, entries) {
    const existing = await this._entries();
    if (existing.length) return { ok: false, error: 'already seeded' };
    await this.ctx.storage.put('entries', entries);
    await this.ctx.storage.put('id', id);
    return { ok: true, count: entries.length };
  }

  async erase(n) {
    const entries = (await this._entries()).filter((e) => e.n !== n);
    await this.ctx.storage.put('entries', entries);
    this._broadcast(await this._stateMsg());
    return { ok: true, open: this._openPage(entries) };
  }

  /* ---------- websocket lifecycle (hibernation api) ---------- */

  async fetch(request) {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      g: crypto.randomUUID().slice(0, 8),
      iph: await sha256hex(ip),
      sign: '',
      lastMsg: 0
    });
    server.send(JSON.stringify(await this._stateMsg()));
    this._broadcast({ t: 'presence', count: this.ctx.getWebSockets().length });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    const att = ws.deserializeAttachment();

    /* throttle: at most ~7 messages/sec per socket */
    const now = Date.now();
    if (now - att.lastMsg < 140) return;
    att.lastMsg = now;
    ws.serializeAttachment(att);

    if (this.env.KILLED === 'true') {
      ws.send(JSON.stringify({ t: 'deny', reason: 'the notebook is resting.' }));
      return;
    }

    if (msg.t === 'take') return this._take(ws, att);
    if (msg.t === 'write') return this._write(ws, att, msg);
    if (msg.t === 'sign') return this._sign(ws, att, msg);
    if (msg.t === 'release') return this._releaseOrInk(att, true);
  }

  async webSocketClose(ws) {
    const att = (() => { try { return ws.deserializeAttachment(); } catch (_) { return null; } })();
    if (att) {
      const pencil = await this._pencil();
      if (pencil && pencil.ghost === att.g) await this._releaseOrInk(att, true);
    }
    this._broadcast({ t: 'presence', count: this.ctx.getWebSockets().length });
  }

  async webSocketError(ws) { return this.webSocketClose(ws); }

  /* ---------- the pen ---------- */

  async _take(ws, att) {
    const entries = await this._entries();
    const open = this._openPage(entries);
    if (open === null) return ws.send(JSON.stringify({ t: 'deny', reason: 'this notebook is full.' }));

    const pencil = await this._pencil();
    if (pencil && pencil.ghost !== att.g) {
      return ws.send(JSON.stringify({ t: 'deny', reason: 'a stranger already holds the pen.' }));
    }

    /* one inked page per ip-hash per hour */
    const log = (await this.ctx.storage.get('inklog')) || {};
    if (log[att.iph] && Date.now() - log[att.iph] < INK_COOLDOWN_MS) {
      return ws.send(JSON.stringify({ t: 'deny', reason: 'the notebook needs a breath — return in an hour.' }));
    }

    await this.ctx.storage.put('pencil', {
      n: open, ghost: att.g, iph: att.iph, text: '',
      taken: Date.now(), lastWrite: Date.now()
    });
    await this.ctx.storage.setAlarm(Date.now() + ALARM_TICK_MS);
    this._broadcast({ t: 'pen', held: true, n: open });
  }

  async _write(ws, att, msg) {
    const pencil = await this._pencil();
    if (!pencil || pencil.ghost !== att.g) {
      return ws.send(JSON.stringify({ t: 'deny', reason: 'you do not hold the pen.' }));
    }
    let text = String(msg.text || '').slice(0, MAX_CHARS);
    const lower = text.toLowerCase();
    if (BANNED.some((w) => lower.includes(w))) {
      return ws.send(JSON.stringify({ t: 'deny', reason: 'that cannot go on a page.' }));
    }
    pencil.text = text;
    pencil.lastWrite = Date.now();
    await this.ctx.storage.put('pencil', pencil);
    this._broadcast({ t: 'pencil', n: pencil.n, text });
  }

  async _sign(ws, att, msg) {
    att.sign = String(msg.name || '').slice(0, 40);
    ws.serializeAttachment(att);
    const pencil = await this._pencil();
    if (pencil && pencil.ghost === att.g) {
      pencil.sign = att.sign;
      await this.ctx.storage.put('pencil', pencil);
    }
  }

  async _releaseOrInk(att, force) {
    const pencil = await this._pencil();
    if (!pencil || pencil.ghost !== att.g) return;
    if (pencil.text && pencil.text.trim()) return this._ink(pencil);
    await this.ctx.storage.delete('pencil');
    this._broadcast({ t: 'pen', held: false, n: pencil.n });
  }

  async _ink(pencil) {
    const entries = await this._entries();
    const entry = {
      n: pencil.n,
      name: (pencil.sign || '').trim() || 'a stranger',
      lines: pencil.text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean).slice(0, 24),
      inked: new Date().toISOString()
    };
    entries.push(entry);
    entries.sort((a, b) => a.n - b.n);
    const log = (await this.ctx.storage.get('inklog')) || {};
    log[pencil.iph] = Date.now();
    /* persist together, then clear the pencil */
    await this.ctx.storage.put({ entries, inklog: log });
    await this.ctx.storage.delete('pencil');
    this._broadcast({ t: 'ink', entry, open: this._openPage(entries) });
  }

  async alarm() {
    const pencil = await this._pencil();
    if (!pencil) return;
    const now = Date.now();
    if (pencil.text && pencil.text.trim() && now - pencil.lastWrite >= INK_IDLE_MS) {
      return this._ink(pencil);
    }
    if ((!pencil.text || !pencil.text.trim()) && now - pencil.taken >= EMPTY_PEN_MS) {
      await this.ctx.storage.delete('pencil');
      this._broadcast({ t: 'pen', held: false, n: pencil.n });
      return;
    }
    await this.ctx.storage.setAlarm(now + ALARM_TICK_MS);
  }
}

/* ---------------- the worker (router) ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('origin') || '';
    const cors = corsHeaders(env, origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const m = url.pathname.match(/^\/nb\/(\d{3})(\/live)?$/);
    const mOwner = url.pathname.match(/^\/nb\/(\d{3})\/(erase|seed)$/);

    try {
      if (m && !m[2] && request.method === 'GET') {
        const stub = env.NOTEBOOK.getByName(m[1]);
        const state = await stub.getState();
        return new Response(JSON.stringify(state), { headers: { ...J, ...cors } });
      }

      if (m && m[2]) {
        /* websocket — hand the raw request to the DO */
        const stub = env.NOTEBOOK.getByName(m[1]);
        return stub.fetch(request);
      }

      if (mOwner && request.method === 'POST') {
        const body = await request.json();
        if (!(await keyMatches(env, body.key))) {
          return new Response(JSON.stringify({ ok: false, error: 'no' }), { status: 403, headers: { ...J, ...cors } });
        }
        const stub = env.NOTEBOOK.getByName(mOwner[1]);
        const out = mOwner[2] === 'erase'
          ? await stub.erase(parseInt(body.n, 10))
          : await stub.seed(mOwner[1], body.entries || []);
        return new Response(JSON.stringify(out), { headers: { ...J, ...cors } });
      }

      return new Response(JSON.stringify({ ok: false, error: 'not found' }), { status: 404, headers: { ...J, ...cors } });
    } catch (err) {
      console.log(JSON.stringify({ event: 'error', path: url.pathname, error: String(err) }));
      return new Response(JSON.stringify({ ok: false, error: 'engine trouble' }), { status: 500, headers: { ...J, ...cors } });
    }
  }
};
