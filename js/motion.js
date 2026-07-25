/* ══════════════════════════════════════════════════════════════════════════
   Scroll choreography and the ambient layer.

   Two motion budgets, deliberately kept apart:
     ambient  — slow, continuous, never resolves (drift, grain, marquee, float)
     reactive — 200-400ms, fires on intent only (tilt, magnet, reveals)
   The eye is never asked to track two fast things at once. That's the whole
   reason this reads as cinematic rather than busy.
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DS = window.DS;
  const q = (s, r) => (r || document).querySelector(s);
  const qa = (s, r) => Array.from((r || document).querySelectorAll(s));

  gsap.registerPlugin(ScrollTrigger, SplitText, ScrambleTextPlugin);

  /* ── Cold open ──────────────────────────────────────────────────────────── */

  const cold = q('#coldopen');
  const SEEN = 'ds-cold-open-seen';

  function coldOpen(then) {
    if (!cold) return then();

    if (DS.reduced || sessionStorage.getItem(SEEN)) {
      cold.remove();
      return then();
    }
    sessionStorage.setItem(SEEN, '1');

    const fill = q('#coldopenFill');
    const pct = q('#coldopenPct');
    const counter = { v: 0 };

    gsap
      .timeline({ onComplete: () => { cold.remove(); then(); } })
      .to(fill, { width: '100%', duration: 1.1, ease: 'power2.inOut' })
      .to(counter, {
        v: 100, duration: 1.1, ease: 'power2.inOut',
        onUpdate: () => { pct.textContent = String(Math.round(counter.v)).padStart(2, '0') + '%'; },
      }, 0)
      .to('.coldopen__inner', { opacity: 0, duration: 0.25 }, '+=0.1')
      .to('.coldopen__shutter--t', { yPercent: -100, duration: 0.7, ease: 'power4.inOut' }, '-=0.1')
      .to('.coldopen__shutter--b', { yPercent: 100, duration: 0.7, ease: 'power4.inOut' }, '<')
      .set(cold, { autoAlpha: 0 }, '-=0.25');
  }

  /* ── Smooth scroll ──────────────────────────────────────────────────────── */

  let smoother = null;
  if (!DS.reduced && !DS.touch && typeof ScrollSmoother !== 'undefined') {
    smoother = ScrollSmoother.create({
      wrapper: '#smooth-wrapper',
      content: '#smooth-content',
      smooth: 1.1,
      effects: false,
      normalizeScroll: false,
    });
    DS.smoother = smoother;
  }

  function scrollTo(target) {
    const el = typeof target === 'string' ? document.getElementById(target) : target;
    if (!el) return;
    if (smoother) smoother.scrollTo(el, true, 'top top');
    else el.scrollIntoView({ behavior: DS.reduced ? 'auto' : 'smooth', block: 'start' });
  }

  qa('[data-scrollto]').forEach((a) =>
    a.addEventListener('click', (e) => { e.preventDefault(); scrollTo(a.dataset.scrollto); })
  );

  /* ── Hero reel wall ─────────────────────────────────────────────────────── */

  function buildWall() {
    const wall = q('#wall');
    if (!wall || DS.reduced || !DS.works.length) return [];

    const cols = qa('.wall__col', wall);
    // Nine is plenty behind a mask at 30% opacity, and it keeps the wall from
    // pulling all fourteen posters a second time just to be scenery.
    const pool = DS.works.slice(0, 9);
    // Round-robin so the first few cells (the ones we let play) span all three
    // columns rather than stacking up in one.
    const buckets = cols.map(() => []);
    pool.forEach((w, i) => buckets[i % cols.length].push(w));

    const perCol = cols.map(() => []);
    cols.forEach((col, ci) => {
      const list = buckets[ci].length ? buckets[ci] : pool;
      // Duplicated once so the column can wrap seamlessly.
      for (let pass = 0; pass < 2; pass++) {
        list.forEach((w) => {
          const cell = document.createElement('div');
          cell.className = 'wall__cell';
          cell.innerHTML =
            `<img src="${w.poster}" alt="" loading="lazy" decoding="async">` +
            `<video src="${w.preview}" muted loop playsinline preload="none"></video>`;
          col.appendChild(cell);
          if (pass === 0) perCol[ci].push(cell);
        });
      }
    });

    // Interleave across columns so the handful we actually play is spread over
    // all three, rather than leaving the last column as still images.
    const cells = [];
    const deepest = Math.max(...perCol.map((c) => c.length));
    for (let row = 0; row < deepest; row++) {
      for (const col of perCol) if (col[row]) cells.push(col[row]);
    }

    // Drift: each column loops over exactly half its own height.
    cols.forEach((col) => {
      const half = col.scrollHeight / 2;
      if (!half) return;
      const up = col.dataset.dir === 'up';
      const wrap = gsap.utils.wrap(-half, 0);
      gsap.set(col, { y: up ? 0 : -half });
      gsap.to(col, {
        y: up ? `-=${half}` : `+=${half}`,
        duration: 34 + Math.random() * 16,
        ease: 'none',
        repeat: -1,
        modifiers: { y: gsap.utils.unitize(wrap) },
      });
    });

    return cells;
  }

  const wallCells = buildWall();

  function wallPlay(on) {
    if (DS.governor.stills) return;
    const vids = wallCells.slice(0, DS.governor.max).map((c) => c.querySelector('video'));
    vids.forEach((v) => (on ? DS.governor.request(v) : DS.governor.release(v)));
  }

  const hero = q('#hero');
  let heroOnScreen = true;
  let stageOwnsVideo = false;

  if (hero && wallCells.length) {
    ScrollTrigger.create({
      trigger: hero,
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (self) => {
        heroOnScreen = self.isActive;
        wallPlay(heroOnScreen && !stageOwnsVideo);
      },
    });
  }

  // The reel stage takes the video budget while it's on screen and hands it
  // back on the way out. Without this the two sections evict each other's
  // videos every frame and the browser aborts half the range requests.
  DS.on('stage', (active) => {
    stageOwnsVideo = active;
    wallPlay(!active && heroOnScreen);
  });

  /* ── Hero text + parallax ───────────────────────────────────────────────── */

  function heroReveal() {
    if (DS.reduced) return;

    const name = q('#heroName');
    if (name) {
      const split = SplitText.create(name, { type: 'chars', mask: 'chars', aria: 'auto' });
      gsap.from(split.chars, {
        yPercent: 115, duration: 0.9, ease: 'power4.out', stagger: 0.028,
      });
    }

    gsap.from(['.hero .eyebrow', '.hero__line', '.hero__sub', '.hero__cta'], {
      y: 22, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.08, delay: 0.25,
    });
    gsap.from('.wall', { opacity: 0, scale: 1.08, duration: 1.6, ease: 'power3.out' });
  }

  /* Three layers, tiny offsets. Depth, not movement — 12px is the whole range. */
  if (hero && !DS.reduced && !DS.touch) {
    const layers = [
      { el: q('.hero__leak'), amt: 26 },
      { el: q('#wall'), amt: 14 },
      { el: q('.hero__body'), amt: -7 },
    ].filter((l) => l.el);

    const setters = layers.map((l) => ({
      x: gsap.quickTo(l.el, 'x', { duration: 0.9, ease: 'power3' }),
      y: gsap.quickTo(l.el, 'y', { duration: 0.9, ease: 'power3' }),
      amt: l.amt,
    }));

    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      setters.forEach((s) => { s.x(nx * s.amt); s.y(ny * s.amt); });
    }, { passive: true });
  }

  /* Leaving the hero: the wall tips back and flies past rather than just fading,
     so the reels feel like they carry through into the work section. */
  if (hero && !DS.reduced) {
    gsap.to('.wall', {
      scale: 1.25, rotateX: 12, opacity: 0, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 },
    });
    gsap.to('.hero__body', {
      y: -60, opacity: 0.15, ease: 'none',
      scrollTrigger: { trigger: hero, start: 'center top', end: 'bottom top', scrub: 0.6 },
    });
  }

  /* Light leak — very slow, never lands anywhere. */
  if (!DS.reduced) {
    gsap.to('.hero__leak', {
      xPercent: 12, yPercent: -8, scale: 1.15,
      duration: 18, ease: 'sine.inOut', repeat: -1, yoyo: true,
    });
  }

  /* ── Marquee ────────────────────────────────────────────────────────────── */

  (function marquee() {
    const row = q('#marqueeRow');
    if (!row || DS.reduced) return;

    const items = [
      { t: 'digibeez.in', client: true },
      { t: 'Premiere Pro' },
      { t: 'reddoormedia.co', client: true },
      { t: 'DaVinci Resolve' },
      { t: 'karly.closedit', client: true },
      { t: 'After Effects' },
      { t: 'Instagram Creators', client: true },
      { t: 'Photoshop' },
    ];

    const render = () =>
      items
        .map((i) => `<span class="marquee__item${i.client ? ' is-client' : ''}">${i.t}</span>`)
        .join('');
    row.innerHTML = render() + render();

    const half = row.scrollWidth / 2;
    const wrap = gsap.utils.wrap(-half, 0);
    const tl = gsap.to(row, {
      x: `-=${half}`, duration: 32, ease: 'none', repeat: -1,
      modifiers: { x: gsap.utils.unitize(wrap) },
    });

    // Scroll faster and the marquee leans into it. Small, but it makes the page
    // feel like it's responding to you rather than playing to itself.
    ScrollTrigger.create({
      onUpdate: (self) => {
        const v = gsap.utils.clamp(-3, 3, self.getVelocity() / 480);
        gsap.to(tl, { timeScale: 1 + Math.abs(v), duration: 0.4, overwrite: true });
        gsap.to(row, { skewX: -v * 1.6, duration: 0.5, ease: 'power2.out', overwrite: 'auto' });
      },
    });
  })();

  /* ── Section reveals ────────────────────────────────────────────────────── */

  if (!DS.reduced) {
    qa('.section__head').forEach((head) => {
      const h2 = q('.h2', head);
      if (h2) {
        SplitText.create(h2, {
          type: 'lines', mask: 'lines', aria: 'auto', autoSplit: true,
          onSplit(self) {
            return gsap.from(self.lines, {
              yPercent: 115, duration: 0.85, ease: 'power4.out', stagger: 0.07,
              scrollTrigger: { trigger: head, start: 'top 80%', once: true },
            });
          },
        });
      }
      const lede = q('.lede', head);
      if (lede) {
        gsap.from(lede, {
          y: 20, opacity: 0, duration: 0.7, ease: 'power3.out', delay: 0.12,
          scrollTrigger: { trigger: head, start: 'top 80%', once: true },
        });
      }
    });

    gsap.from('.step', {
      y: 34, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.06,
      scrollTrigger: { trigger: '.steps', start: 'top 82%', once: true },
    });

    gsap.from('.work__controls', {
      y: 18, opacity: 0, duration: 0.6, ease: 'power3.out',
      scrollTrigger: { trigger: '.work__controls', start: 'top 88%', once: true },
    });
  }

  /* Eyebrows burn in like a slate. */
  qa('[data-scramble]').forEach((el) => {
    const text = el.textContent;
    if (DS.reduced) return;
    ScrollTrigger.create({
      trigger: el, start: 'top 88%', once: true,
      onEnter: () =>
        gsap.to(el, {
          duration: 0.9,
          scrambleText: { text, chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·', speed: 0.6 },
        }),
    });
  });

  /* ── Tool tiles ─────────────────────────────────────────────────────────── */

  (function tools() {
    const tiles = qa('.tool');
    if (!tiles.length) return;

    if (!DS.reduced) {
      gsap.from(tiles, {
        y: 40, opacity: 0, rotateY: -28, duration: 0.7, ease: 'power3.out', stagger: 0.05,
        scrollTrigger: { trigger: '#toolgrid', start: 'top 82%', once: true },
      });

      // Each tile breathes on its own offset so the grid never pulses in unison.
      tiles.forEach((t, i) => {
        gsap.to(t, {
          y: -6, duration: 3 + (i % 4) * 0.55, ease: 'sine.inOut',
          repeat: -1, yoyo: true, delay: i * 0.22,
        });
      });
    }

    if (DS.touch || DS.reduced) return;
    tiles.forEach((tile) => {
      const rx = gsap.quickTo(tile, 'rotateX', { duration: 0.4, ease: 'power3' });
      const ry = gsap.quickTo(tile, 'rotateY', { duration: 0.4, ease: 'power3' });
      tile.addEventListener('pointermove', (e) => {
        const r = tile.getBoundingClientRect();
        rx(-((e.clientY - r.top) / r.height - 0.5) * 14);
        ry(((e.clientX - r.left) / r.width - 0.5) * 16);
      });
      tile.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  })();

  /* ── Reel tilt (grid view only — cylinder cards are already angled) ─────── */

  if (!DS.touch && !DS.reduced) {
    const stage = q('#stage');
    let active = null;
    let rx = null, ry = null;

    stage.addEventListener('pointerover', (e) => {
      const card = e.target.closest('.reel');
      if (!card || card === active) return;
      if (!stage.classList.contains('is-grid')) return;
      active = card;
      card.style.willChange = 'transform';
      rx = gsap.quickTo(card, 'rotateX', { duration: 0.4, ease: 'power3' });
      ry = gsap.quickTo(card, 'rotateY', { duration: 0.4, ease: 'power3' });
    });

    stage.addEventListener('pointermove', (e) => {
      if (!active || !rx || !stage.classList.contains('is-grid')) return;
      const r = active.getBoundingClientRect();
      rx(-((e.clientY - r.top) / r.height - 0.5) * 11);
      ry(((e.clientX - r.left) / r.width - 0.5) * 11);
    });

    stage.addEventListener('pointerout', (e) => {
      const card = e.target.closest('.reel');
      if (!card || card !== active) return;
      if (rx) { rx(0); ry(0); }
      // Drop the compositor hint once the tween that needed it has finished.
      gsap.delayedCall(0.45, () => { card.style.willChange = ''; });
      active = null; rx = null; ry = null;
    });
  }

  /* ── Magnetic buttons ───────────────────────────────────────────────────── */

  if (!DS.touch && !DS.reduced) {
    qa('.btn').forEach((btn) => {
      const x = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3' });
      const y = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3' });
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        x((e.clientX - (r.left + r.width / 2)) * 0.28);
        y((e.clientY - (r.top + r.height / 2)) * 0.42);
      });
      btn.addEventListener('pointerleave', () => { x(0); y(0); });
    });
  }

  /* ── Timeline scrubber ──────────────────────────────────────────────────── */

  (function timeline() {
    const rail = q('#timeline');
    const track = q('#timelineTrack');
    const head = q('#timelineHead');
    const tc = q('#timelineTc');
    if (!rail || !track || !head) return;

    const clips = qa('.timeline__clip', track);
    clips.forEach((c) =>
      c.addEventListener('click', () => scrollTo(c.dataset.target))
    );

    // Read as MM:SS:FF at 24fps over a notional 90-second "runtime". It is a
    // progress indicator wearing an editor's clothes.
    const TOTAL_F = 90 * 24;
    const frames = (p) => {
      const f = Math.round(p * TOTAL_F);
      const mm = String(Math.floor(f / (24 * 60))).padStart(2, '0');
      const ss = String(Math.floor(f / 24) % 60).padStart(2, '0');
      const ff = String(f % 24).padStart(2, '0');
      return `${mm}:${ss}:${ff}`;
    };

    const vertical = () => window.matchMedia('(min-width: 1025px)').matches;

    ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const p = gsap.utils.clamp(0, 1, self.progress);
        if (tc) tc.textContent = frames(p);
        const box = track.getBoundingClientRect();
        if (vertical()) {
          gsap.set(head, { y: p * (box.height - 8), x: 0 });
        } else {
          gsap.set(head, { x: p * (box.width - 8), y: 0 });
        }
      },
    });

    // Highlight whichever section is actually on screen.
    clips.forEach((clip) => {
      const target = document.getElementById(clip.dataset.target);
      if (!target) return;
      ScrollTrigger.create({
        trigger: target,
        start: 'top 55%',
        end: 'bottom 45%',
        onToggle: (self) => clip.classList.toggle('is-on', self.isActive),
      });
    });
  })();

  /* ── Go ─────────────────────────────────────────────────────────────────── */

  coldOpen(() => {
    heroReveal();
    ScrollTrigger.refresh();
  });

  // Fonts change line-breaks; re-measure once they land so pinned/scrubbed
  // triggers aren't computed against the fallback metrics.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
})();
