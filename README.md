# Deepak Saini — Video Editor Portfolio

A single-page portfolio for a short-form video editor. Dark editing-suite theme,
a draggable 3D wall of self-hosted reels that Flips into a grid, and a scroll
position that reads as a timeline playhead.

**Live:** https://chandansaini67.github.io/deepak-saini-portfolio

## Run it

Open `index.html` in a browser. That's it — no build step, and the manifest is a
plain script rather than JSON so it works straight off the disk.

To serve it properly (needed if you want to test video range-requests):

```bash
npx serve .
```

## What's where

```
index.html            all eight sections
css/styles.css        design tokens + every style
js/main.js            capability flags, filter state, video playback governor
js/motion.js          GSAP scroll choreography + the ambient layer
js/reelwall.js        the 3D cylinder, drag-to-spin, cylinder<->grid Flip
js/lightbox.js        the player, its morph-open, keyboard and focus trap
js/cursor.js          custom cursor
data/works.js         GENERATED — the reel manifest
media/preview/        6s silent loops, ~0.4MB each (the grid/cylinder)
media/full/           the watchable versions, with sound (the lightbox)
media/poster/         one JPG per reel
tools/                the media pipeline (see below)
```

## Adding new reels

1. Add an entry to `tools/sources.json` — a Drive file ID, a `slug`, a
   `category` (`real-estate` or `food-cafe`), and a `title`.
2. `node tools/fetch-drive.js` — downloads into `media/src/` (gitignored).
3. `node tools/encode.js` — builds all three derivatives, rewrites
   `data/works.js`, and refuses to finish if the critical path blows its budget.

`--force` re-encodes files that already exist.

### Two budgets, on purpose

`encode.js` asserts against two different numbers because they protect
different things:

- **Critical path (10MB)** — posters + previews. Every visitor downloads these,
  so this is the one that matters for how fast the page feels.
- **Total (200MB)** — includes the full videos, which are `preload="none"` and
  only ever fetched when somebody clicks a specific reel. Squeezing these would
  just mean shipping an editor's work looking compressed.

## Motion

Two layers, kept deliberately apart:

- **Ambient** — slow, continuous, never resolves: the drifting hero wall, film
  grain, marquee, light leak, floating tool tiles.
- **Reactive** — 200–400ms, only on intent: card tilt, magnetic buttons, the
  Flip transitions, the lightbox morph.

Never more than one reactive animation at a time, which is what stops it
tipping from cinematic into busy.

GSAP 3.13 via CDN (`ScrollTrigger`, `ScrollSmoother`, `Flip`, `Draggable`,
`InertiaPlugin`, `SplitText`, `ScrambleText`). Every plugin is free for
commercial use since Webflow acquired GSAP — no licence key needed.

## Degrading

- `prefers-reduced-motion` → a complete static site. Grid only, posters only, no
  drift, no grain flicker, no smooth scroll, no custom cursor. Every reel still
  opens and plays.
- Touch → grid instead of the cylinder, max 2 videos decoding, no cursor, no
  smooth scroll.
- `Save-Data` → posters only.
- No JavaScript → a message pointing at Instagram and WhatsApp.

## Contact details in the markup

WhatsApp `+91 93509 72226` and Instagram
[`@deepak.sainii__`](https://www.instagram.com/deepak.sainii__), both hardcoded
in `index.html`. Search for `wa.me` to change the number.

## Still to fill in

- `TODO` in the tools section: confirm which of After Effects / Illustrator /
  Audition / Lightroom Deepak actually works in, and delete the rest.
- Bio copy is written from what was known at build time — swap in his own words.
