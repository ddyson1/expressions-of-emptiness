# expressions of emptiness — brand

A poetry site as a physical object: **a black-and-red notebook lying in a dark
room.** You don't scroll it — you turn its pages. Every word on the site is set
in Swinger.

## The object

- **The room** — warm near-black (`#14130f`), a faint radial light from above,
  nothing else in it. No chrome outside the book; the about page and contact
  live inside as pages.
- **The notebook** — black matte cover (`#1f1d18`) with an **oxblood spine band**,
  cream paper pages (`#fffdf6` / `#f6f4ec` alternating), soft ink (`#1c1c1a`).
  Cover carries the wordmark and the byline "by dd".
- **The turn** — StPageFlip corner-drag with low shadow (matte, never glossy).
  Desktop: two-page spread. Mobile: single page.

## Type

**Swinger** (Ronny Studio, 2023) for everything — a deliberate choice, made with
the tradeoff known: it's an all-caps spiky display face, so verse is tuned as far
toward readability as the face allows (line-height 2.1, letter-spacing 0.05em,
generous sizes). EB Garamond stays self-hosted as a fallback/available face but
is currently unused.

## Color — MiG's tokens, MiG's rule

Palette borrowed from MiG's `tokens.css` ("a notebook in the dark… one oxblood
accent that means confirm and advance"):

| Token | Hex | Use |
|---|---|---|
| ground | `#14130f` | the room |
| card | `#1f1d18` | cover, endpage |
| hairline | `#36312a` | borders |
| **oxblood** | **`#bf382b`** | THE accent: spine, byline, link hover. Never `#C0392B`. |
| oxblood-bright | `#e04434` | hover states |
| near-white | `#f5f3ec` | text on dark |
| paper / paper-back | `#fffdf6` / `#f6f4ec` | pages |
| ink / ink-dim | `#1c1c1a` / `#6f6d67` | verse |

**One accent only. Do not add a second.** The accent means *advance*.

## Motion

MiG ease `cubic-bezier(0.2, 0.7, 0.2, 1)`; page flip ~800ms; everything honors
`prefers-reduced-motion` (flip time drops to instant).

## History

Earlier directions (quiet-gothic dark landing, flat minimal white page, four
dark mockups, three white mockups, custom drag prototype) are preserved under
`mockups/`. The notebook superseded them 2026-07-26.
