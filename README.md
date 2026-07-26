# expressions-of-emptiness

random digital poetry outlet — [expressions-of-emptiness.com](https://expressions-of-emptiness.com)

The site is a **black-and-red notebook in a dark room**. Drag a page corner (or use
arrow keys) to turn the pages. On desktop the open book shows a two-page spread;
on phones it turns one page at a time. Everything is set in Swinger.

No build step, no framework, no third-party requests — plain HTML/CSS/JS with
self-hosted fonts.

## Structure

```
index.html            the notebook (cover → poems → about → contact)
styles.css            palette + page styling (MiG-derived tokens, oxblood #bf382b)
js/page-flip.browser.js   StPageFlip (MIT) — the page-turn physics
fonts/                Swinger web formats + EB Garamond (OFL); desktop formats untracked
assets/favicon.svg    the ring
mockups/              design explorations that led here (incl. earlier site versions)
BRAND.md              the design system
```

## Run locally

```sh
python3 -m http.server 8790
# open http://127.0.0.1:8790
```

## Editing poems

Each poem is one `<div class="page">` block in `index.html` — a `.poem` with one
`<p>` per stanza-line and an optional `class="dim"` for the quiet lines. The verse
currently in the book is **placeholder**.

## Hosting

GitHub Pages, deploy-from-branch (`main`, root). `CNAME` points the Pages site at
expressions-of-emptiness.com; DNS lives at Squarespace.

## Font licensing

Swinger © Ronny Studio — licensed; web-embedding formats only in this repo
(`fonts/Swinger-LICENSE.txt`). EB Garamond is SIL OFL.
