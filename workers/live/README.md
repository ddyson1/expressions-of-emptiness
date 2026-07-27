# eoe-live — deploy

The live notebook engine (see ../../ARCHITECTURE.md). One-time setup:

```sh
cd workers/live
npx wrangler login                 # Devin's keyboard — authorize in browser
npx wrangler secret put OWNER_KEY  # invent a long random phrase; this is the eraser key
npx wrangler deploy                # prints https://eoe-live.<subdomain>.workers.dev
```

Seed notebook 001 with the existing entries (once):

```sh
cd ../..   # repo root
python3 - <<'EOF'
import json, urllib.request
nb = json.load(open('data/notebook-001.json'))
body = json.dumps({'key': input('OWNER_KEY: '), 'entries': nb['entries']}).encode()
req = urllib.request.Request('https://WORKER_URL/nb/001/seed', body, {'content-type': 'application/json'})
print(urllib.request.urlopen(req).read().decode())
EOF
```

Then set `WORKER_URL` in `index.html` to the deployed origin and push.

## The eraser

Strike any entry (removes it and reopens its page):

```sh
curl -X POST https://WORKER_URL/nb/001/erase \
  -H 'content-type: application/json' \
  -d '{"key":"<OWNER_KEY>","n":<page number>}'
```

## Kill switch

`wrangler.jsonc` → `"KILLED": "true"` → `npx wrangler deploy`. The notebook
goes read-only ("the notebook is resting").
