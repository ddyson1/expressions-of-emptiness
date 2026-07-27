# the live notebook — v2 architecture

The site stops being a publication and becomes a place: one notebook, open on a
desk, that strangers write into directly. No submit buttons. Words appear as
they are typed; a few minutes of quiet later they **set into ink**.

## The one simplification that makes tonight possible

**One pen.** The notebook fills sequentially, like a real notebook: only the
first blank page is ever writable. The first ghost to start typing holds the
pen; everyone else watches the words arrive live. When the writer goes quiet,
the page sets, the pen is free, and the next blank page becomes the open page.

This removes the entire collaborative-editing problem (no CRDTs, no operational
transforms, no merge conflicts) while keeping all of the magic. Multiple
simultaneous writers on one page is a later phase, if ever — watching one
stranger write while others wait is *more* like a shared notebook, not less.

## Components

```
┌─────────────────────┐     wss / https      ┌──────────────────────────────┐
│  GitHub Pages        │ ──────────────────▶  │  Cloudflare Worker           │
│  (static shell)      │                      │   └─ Durable Object          │
│  index.html          │   GET  /nb/001       │      class Notebook          │
│  the book UI         │   WS   /nb/001/live  │      - entries[] (storage)   │
│  fonts, styles       │                      │      - pencil buffer         │
└─────────────────────┘                      │      - pen holder            │
                                              │      - presence set          │
   data/*.json = archived                     │      - alarm → ink           │
   notebooks only (git is                     └──────────────────────────────┘
   the archive shelf)
```

- **GitHub Pages** keeps serving the shell — the book, fonts, styling. Static,
  fast, free. Works read-only if the Worker is ever down (falls back to the
  last archived/snapshot JSON).
- **One Durable Object per notebook** is the room. It holds the entries, the
  in-progress pencil text, who has the pen, and who's present. WebSocket
  Hibernation keeps cost ~zero while nobody's there.
- **Git stays the archive.** When a notebook fills (48 pages), its JSON is
  committed to `data/` and the shelf lists it. The DO starts the next book.

## Protocol (WebSocket, JSON messages)

server → client
- `state`   — full snapshot on join: entries, pencil text, open page n, presence count
- `presence`— `{count}` on join/leave
- `pencil`  — `{n, text}` live as the pen-holder types
- `ink`     — `{entry}` a page has set; includes next open page n
- `pen`     — `{held: bool}` pen taken / released
- `deny`    — `{reason}` write rejected (filter, rate, killed)

client → server
- `take`    — request the pen for the open page
- `write`   — `{text}` full pencil buffer (≤600 chars; throttled client-side;
              full-buffer replace, not char ops — trivial and sufficient)
- `sign`    — `{name}` optional signature before ink (≤40 chars)
- `release` — give the pen up early

## Pencil → ink rules

- pencil text broadcasts live to everyone in the room
- **ink** happens when the pen-holder is idle **2 minutes**, disconnects, or
  releases; DO alarm enforces it
- pen auto-releases (dropping unsaved pencil) if held **90s with zero writing**
- inked entries are appended to storage and the open page advances

## Guardrails (invisible, but real)

| Layer | MVP tonight | Later |
|---|---|---|
| bots | per-IP connect throttle + honeypot field | invisible Turnstile before pen activates |
| flooding | one inked page per IP-hash per hour; write msgs throttled | tune |
| content | banned-word list on every `write`; 600-char cap | smarter filter |
| defacement | **the eraser**: owner endpoint to strike any entry (removes + reopens the page) | admin view |
| emergency | `KILLED` env flag → notebook goes read-only | — |

The eraser is the pencil-then-ink lever: nothing needs approval, but nothing is
beyond undo. Erasing after ink is possible too (entries are just DO storage).

## Identity: marks, not accounts

No accounts. A visitor may pick a **mark** (initials / short sigil, kept in
their own browser's localStorage) that signs pages they ink. Attribution
without identity. Passkeys someday if the project truly needs durable
authorship; passwords never.

## What exists already that this reuses

- the entire book UI, flip engine, tabs, data schema (`entries[] {n, name, lines}`)
- the black/red room, the write-page layout (form becomes the live pencil page)
- `data/*.json` as the archive format — unchanged
- the `workers/` PR-gate is **retired** by this (built for the submit-button
  world); its filters/rate-limit code carries over into the DO

## Tonight's build order

1. mockup sign-off (the room / contents pane / immersion / live page)
2. `workers/live/` — Worker + Notebook DO, protocol above, guardrails MVP
3. client: contents pane + immersion toggle; blank page → live pencil page
   (WS client, pencil rendering, presence line)
4. deploy together (`wrangler login` is Devin's keyboard), wire `WORKER_URL`,
   two-browser live test
5. defer: Turnstile, per-ghost cursors, archive automation, marks UI polish
