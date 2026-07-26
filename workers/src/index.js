/**
 * eoe-notebook — the hybrid gate for expressions-of-emptiness.com
 *
 * POST /submit  { text, name?, notebook, turnstile? }
 *   1. origin check + honeypot is client-side; here: length + content filters
 *   2. Turnstile verification (when TURNSTILE_SECRET is set)
 *   3. KV rate limit per hashed IP (MAX_PER_HOUR)
 *   4. entry stored in KV queue (pending:<uuid>)
 *   5. a GitHub PR is opened adding the entry to the notebook JSON —
 *      merging the PR is the one-tap approval that publishes the page.
 *
 * Nothing is ever auto-published: the site only shows what's in main.
 */

const BANNED = [
  // seed list — extend as needed. Matched case-insensitively on word boundaries.
  'viagra', 'casino', 'crypto giveaway', 'http://', 'https://'
];

const JSON_HEADERS = { 'content-type': 'application/json' };

function cors(env) {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}

function reply(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...cors(env) }
  });
}

async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return { ok: true, skipped: true };
  if (!token) return { ok: false };
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip })
  });
  const out = await r.json();
  return { ok: !!out.success };
}

/* ---------------- GitHub: one PR per submission ---------------- */

async function gh(env, path, init = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'authorization': `Bearer ${env.GITHUB_TOKEN}`,
      'accept': 'application/vnd.github+json',
      'user-agent': 'eoe-notebook-worker',
      ...(init.body ? JSON_HEADERS : {})
    }
  });
  if (!r.ok) throw new Error(`github ${path} -> ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function openApprovalPR(env, entry) {
  const repo = env.GITHUB_REPO;
  const file = `data/notebook-${entry.notebook}.json`;

  // base commit + current file
  const main = await gh(env, `/repos/${repo}/git/ref/heads/main`);
  const baseSha = main.object.sha;
  const cur = await gh(env, `/repos/${repo}/contents/${file}?ref=main`);
  const nb = JSON.parse(atob(cur.content.replace(/\n/g, '')));

  // next open slot
  const taken = new Set((nb.entries || []).map((e) => e.n));
  let slot = null;
  for (let n = 1; n <= nb.pages; n++) if (!taken.has(n)) { slot = n; break; }
  if (slot === null) throw new Error('notebook full — archive it and start the next');

  nb.entries.push({
    n: slot,
    name: entry.name || 'anonymous',
    lines: entry.text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean),
    submitted: entry.ts
  });
  nb.entries.sort((a, b) => a.n - b.n);

  const branch = `entry/${entry.id.slice(0, 8)}`;
  await gh(env, `/repos/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha })
  });
  await gh(env, `/repos/${repo}/contents/${file}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `entry: page ${slot} of notebook ${entry.notebook} (${nb.entries.length}/${nb.pages} filled)`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(nb, null, 2) + '\n'))),
      sha: cur.sha,
      branch
    })
  });
  const pr = await gh(env, `/repos/${repo}/pulls`, {
    method: 'POST',
    body: JSON.stringify({
      title: `page ${slot}: "${entry.text.slice(0, 48)}${entry.text.length > 48 ? '…' : ''}"`,
      head: branch,
      base: 'main',
      body: [
        `New entry for **notebook ${entry.notebook}**, page **${slot}** — signed *${entry.name || 'anonymous'}*.`,
        '', '```', entry.text, '```', '',
        `Merge to publish. Close to reject. (queue id \`${entry.id}\`)`
      ].join('\n')
    })
  });
  return { slot, pr: pr.html_url };
}

/* ---------------- the worker ---------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(env) });
    }
    if (request.method !== 'POST' || url.pathname !== '/submit') {
      return reply(env, 404, { ok: false, error: 'not found' });
    }

    try {
      const body = await request.json();
      const text = (body.text || '').trim();
      const name = (body.name || '').trim().slice(0, 40);
      const notebook = String(body.notebook || '').replace(/[^0-9]/g, '');

      /* filters */
      if (!text || text.length < 3) return reply(env, 400, { ok: false, error: 'the page is blank.' });
      if (text.length > 600) return reply(env, 400, { ok: false, error: 'too long for one page (600 max).' });
      if (!notebook) return reply(env, 400, { ok: false, error: 'unknown notebook.' });
      const lower = text.toLowerCase();
      if (BANNED.some((w) => lower.includes(w))) {
        return reply(env, 400, { ok: false, error: 'that cannot go on a page.' });
      }

      const ip = request.headers.get('cf-connecting-ip') || '0.0.0.0';

      /* bot gate */
      const ts = await verifyTurnstile(env, body.turnstile, ip);
      if (!ts.ok) return reply(env, 403, { ok: false, error: 'could not tell you from a machine — try again.' });

      /* rate limit */
      const ipKey = `rate:${await sha256hex(ip)}`;
      const count = parseInt((await env.QUEUE.get(ipKey)) || '0', 10);
      if (count >= parseInt(env.MAX_PER_HOUR, 10)) {
        return reply(env, 429, { ok: false, error: 'the notebook needs a breath — try again in an hour.' });
      }
      await env.QUEUE.put(ipKey, String(count + 1), { expirationTtl: 3600 });

      /* queue the entry */
      const entry = {
        id: crypto.randomUUID(),
        text, name, notebook,
        ip_hash: await sha256hex(ip),
        ts: new Date().toISOString()
      };
      await env.QUEUE.put(`pending:${entry.id}`, JSON.stringify(entry), {
        expirationTtl: 60 * 60 * 24 * 90
      });

      /* open the approval PR after responding — the writer needn't wait on GitHub */
      ctx.waitUntil(
        openApprovalPR(env, entry).catch((err) =>
          console.log(JSON.stringify({ event: 'pr_failed', id: entry.id, error: String(err) }))
        )
      );

      return reply(env, 200, { ok: true });
    } catch (err) {
      console.log(JSON.stringify({ event: 'submit_error', error: String(err) }));
      return reply(env, 500, { ok: false, error: 'something went wrong — try again later.' });
    }
  }
};
