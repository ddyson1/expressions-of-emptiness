# eoe-notebook worker

The hybrid gate: strangers write on the blank page → this Worker filters
(Turnstile bot-check, rate limit, banned words) → the entry is queued in KV and
opened as a **GitHub PR** against `data/notebook-NNN.json`. **Merging the PR is
the one-tap approval** — GitHub Pages redeploys and the entry fills its page.
Closing the PR rejects it. Nothing auto-publishes.

## Deploy (one-time, ~15 min, needs Devin at the keyboard)

```sh
cd workers
npx wrangler login                       # opens browser, authorize Cloudflare
npx wrangler kv namespace create QUEUE   # paste printed id into wrangler.jsonc
npx wrangler secret put GITHUB_TOKEN     # fine-grained PAT: this repo only,
                                         #   contents:write + pull-requests:write
npx wrangler secret put TURNSTILE_SECRET # from the Turnstile widget (below)
npx wrangler deploy                      # prints the worker URL
```

Turnstile widget: Cloudflare dash → Turnstile → Add site →
domain `expressions-of-emptiness.com`, invisible/managed mode. Take the
**site key** (client) and **secret key** (worker secret above).

## Wire the site to it

In `index.html`:

1. Set `WORKER_URL` to the deployed worker origin.
2. Add the Turnstile widget to the form (site key from above):
   `<script src="https://challenges.cloudflare.com/turnstile/api.js" async defer></script>`
   plus `<div class="cf-turnstile" data-sitekey="…">` inside the form, and pass
   its token as `turnstile` in the POST body.

Until `WORKER_URL` is set, the form shows "the pen is still being made."

## Archiving a filled notebook

When the PR titled "page 48 …" merges, the notebook is full:

1. Add its id + fill date to `data/archive.json` (`{"id":"001","filled":"YYYY-MM-DD"}`).
2. Create `data/notebook-002.json` (`{"id":"002","started":…,"pages":48,"entries":[]}`).
3. Update the fetch default in `index.html`? No — it always opens the highest
   non-archived notebook only if you bump the default id there (one line).

(These three steps are deliberately manual for now — archiving should feel like
closing a book. A small script can automate it later.)

## Notes

- Rate limit: `MAX_PER_HOUR` per hashed IP (KV TTL). Tune in `wrangler.jsonc`.
- The banned-word seed list lives at the top of `src/index.js` — extend freely.
- KV queue entries expire after 90 days; the PR is the durable record.
- If a PR fails to open (GitHub down), the entry stays in KV (`pending:<id>`)
  and the failure is logged — recoverable by hand.
