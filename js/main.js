/* ══════════════════════════════════════════════════════════════════════════
   Shared state, capability flags, and the video playback governor.
   Loads first; every other script hangs off window.DS.
   ══════════════════════════════════════════════════════════════════════════ */

window.DS = (function () {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
  const saveData = !!(navigator.connection && navigator.connection.saveData);

  // Posters only when the visitor has asked for less motion or less data.
  const stills = reduced || saveData;

  const works = Array.isArray(window.WORKS) ? window.WORKS.slice() : [];

  /* ── Playback governor ───────────────────────────────────────────────────
     Browsers will happily start decoding twenty videos and then stutter. One
     global cap across the hero wall and the reel stage keeps that from
     happening; least-recently-requested gets evicted when we hit it. */
  const governor = {
    max: touch ? 2 : 6,
    // The governor owns this rather than closing over it, so callers can see
    // the policy and tests can flip it.
    stills,
    active: [],

    /** @returns {boolean} whether the video is now playing. */
    request(video) {
      if (this.stills || !video) return false;
      const i = this.active.indexOf(video);
      if (i !== -1) {
        // Already playing — refresh its position so it isn't the next evicted.
        this.active.splice(i, 1);
        this.active.push(video);
        return true;
      }
      while (this.active.length >= this.max) this.release(this.active[0]);
      this.active.push(video);
      const p = video.play();
      if (p && p.catch) p.catch(() => {});
      return true;
    },

    release(video) {
      if (!video) return;
      const i = this.active.indexOf(video);
      if (i !== -1) this.active.splice(i, 1);
      if (!video.paused) video.pause();
    },

    releaseAll(scope) {
      for (const v of this.active.slice()) {
        if (!scope || scope.contains(v)) this.release(v);
      }
    },
  };

  /* ── Tiny event bus ─────────────────────────────────────────────────────── */
  const listeners = {};
  const on = (name, fn) => ((listeners[name] = listeners[name] || []).push(fn));
  const emit = (name, data) => (listeners[name] || []).forEach((fn) => fn(data));

  /* ── Filter state ───────────────────────────────────────────────────────── */
  // The reel wall is the point of the page, so every screen opens on it —
  // phones and narrow windows included. What small screens don't get is the
  // budget to go with it: governor.max stays at 2 on touch, and reelwall.js
  // caps the ring's radius to the viewport so it can't spill off the sides.
  // Reduced motion is the one case that still opens flat.
  const state = {
    filter: 'all',
    view: reduced ? 'grid' : 'cylinder',
  };
  const matches = (w) => state.filter === 'all' || w.category === state.filter;
  const visible = () => works.filter(matches);

  const CATEGORY_LABEL = {
    'real-estate': 'REAL ESTATE',
    'local-business': 'LOCAL BUSINESS',
  };

  /* ── Boot ───────────────────────────────────────────────────────────────── */
  function boot() {
    const year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();

    if (!touch && !reduced) document.body.classList.add('has-cursor');

    // Filter chips
    const chips = Array.from(document.querySelectorAll('.chip'));
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        if (chip.classList.contains('is-on')) return;
        chips.forEach((c) => {
          const on = c === chip;
          c.classList.toggle('is-on', on);
          c.setAttribute('aria-selected', String(on));
        });
        state.filter = chip.dataset.filter;
        emit('filter', state.filter);
        announce();
      });
    });

    // Cylinder / grid toggle
    const toggle = document.getElementById('viewToggle');
    if (toggle) {
      const sync = () => {
        const isCyl = state.view === 'cylinder';
        toggle.setAttribute('aria-pressed', String(isCyl));
        toggle.querySelector('.viewtoggle__text').textContent = isCyl ? 'Reel wall' : 'Grid';
      };
      toggle.addEventListener('click', () => {
        state.view = state.view === 'cylinder' ? 'grid' : 'cylinder';
        sync();
        emit('view', state.view);
        announce();
      });
      sync();   // the markup can't know which view we started in
    }

    announce();
  }

  function announce() {
    const el = document.getElementById('workCount');
    if (!el) return;
    const n = visible().length;
    el.textContent = `${n} ${n === 1 ? 'reel' : 'reels'} shown`;
    const hint = document.getElementById('stageHint');
    if (hint) {
      hint.textContent =
        state.view === 'cylinder'
          ? (touch ? 'Swipe to spin · tap a reel to watch' : 'Drag to spin · click a reel to watch')
          : 'Click a reel to watch with sound';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return {
    reduced, touch, saveData, stills,
    works, state, visible, matches, governor,
    on, emit, announce,
    CATEGORY_LABEL,
  };
})();
