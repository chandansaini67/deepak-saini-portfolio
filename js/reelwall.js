/* ══════════════════════════════════════════════════════════════════════════
   The work stage: a draggable 3D cylinder of playing reels that Flips into a
   flat grid and back.

   The cylinder is plain CSS 3D — each card is rotateY(i·step) translateZ(R)
   inside a preserve-3d container, and we spin the container. backface-
   visibility:hidden means the far half never renders, which halves the work
   and happens to look right: you see the near arc, as you would with a real
   ring of screens.
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DS = window.DS;
  const stageEl = document.getElementById('stage');
  const stage3d = document.getElementById('stage3d');
  if (!stageEl || !stage3d || !DS.works.length) return;

  gsap.registerPlugin(Flip, Draggable, InertiaPlugin);

  const AUTO_DEG_PER_SEC = 4;      // ~90s per revolution — present, not busy
  const DRAG_DEG_PER_PX = 0.22;
  const FACING_DEG = 70;           // how far off-centre a card still plays

  let cards = [];
  let rotation = 0;
  let spinning = false;
  let dragging = false;
  let radius = 0;
  let onScreen = false;

  /* ── Build ──────────────────────────────────────────────────────────────── */

  const PLAY_SVG =
    '<svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">' +
    '<circle cx="32" cy="32" r="30" fill="rgba(10,10,12,.55)" stroke="rgba(255,255,255,.5)"/>' +
    '<path d="M26 21l18 11-18 11z" fill="#fff"/></svg>';

  function build() {
    const frag = document.createDocumentFragment();

    DS.works.forEach((w, i) => {
      const btn = document.createElement('button');
      btn.className = 'reel';
      btn.type = 'button';
      btn.dataset.slug = w.slug;
      btn.dataset.category = w.category;
      btn.dataset.index = String(i);

      const label = w.client ? `${w.title} for ${w.client}` : w.title;
      btn.setAttribute('aria-label', `Play ${label}, ${w.duration}`);

      const cat = DS.CATEGORY_LABEL[w.category] || w.category.toUpperCase();
      btn.innerHTML =
        '<span class="reel__media">' +
          `<img class="reel__poster" src="${w.poster}" alt="" loading="lazy" decoding="async" width="${w.width}" height="${w.height}">` +
          `<video class="reel__vid" src="${w.preview}" muted loop playsinline preload="none" aria-hidden="true"></video>` +
          `<span class="reel__badge">${w.duration}</span>` +
          (w.client ? `<span class="reel__client">${w.client}</span>` : '') +
          `<span class="reel__play">${PLAY_SVG}</span>` +
        '</span>' +
        '<span class="reel__meta">' +
          `<span class="reel__t">${w.client || w.title}</span>` +
          `<span class="reel__m">${w.duration} · ${w.aspect} · ${cat}</span>` +
        '</span>';

      frag.appendChild(btn);
    });

    stage3d.appendChild(frag);
    cards = Array.from(stage3d.querySelectorAll('.reel'));

    cards.forEach((card) => {
      card.addEventListener('click', () => {
        // A fling ends with a click event on whichever card was under the
        // pointer; ignore it so dragging never opens the player.
        if (dragging) return;
        DS.emit('open', Number(card.dataset.index));
      });
      if (!DS.touch) {
        card.addEventListener('mouseenter', () => {
          if (DS.state.view === 'grid') playCard(card);
        });
        card.addEventListener('mouseleave', () => {
          if (DS.state.view === 'grid') stopCard(card);
        });
      }
      card.addEventListener('focus', () => {
        if (DS.state.view === 'grid') playCard(card);
      });
      card.addEventListener('blur', () => {
        if (DS.state.view === 'grid') stopCard(card);
      });
    });
  }

  const shown = () => cards.filter((c) => !c.hidden);
  const videoOf = (card) => card.querySelector('.reel__vid');

  function playCard(card) {
    const v = videoOf(card);
    if (!v) return;
    // Only reveal the video layer if the governor actually started it —
    // otherwise reduced-motion / save-data visitors get an empty video element
    // faded in over a perfectly good poster.
    if (DS.governor.request(v)) card.classList.add('is-playing');
  }
  function stopCard(card) {
    const v = videoOf(card);
    if (!v) return;
    DS.governor.release(v);
    card.classList.remove('is-playing');
  }

  /* ── Cylinder geometry ──────────────────────────────────────────────────── */

  /**
   * Measured, not read from the custom property: getPropertyValue returns the
   * *specified* value for unregistered custom properties, so --reel-w comes
   * back as the literal string "clamp(110px, 14vw, 210px)" and parseFloat gives
   * NaN. offsetWidth is the laid-out width before any transform is applied,
   * which is exactly what the ring radius needs.
   */
  function cardWidth() {
    const first = shown()[0] || cards[0];
    return (first && first.offsetWidth) || 180;
  }

  function positionCylinder() {
    const list = shown();
    const n = list.length;
    if (!n) return;

    const w = cardWidth();
    const step = 360 / n;
    // Spread the ring wide enough that neighbours don't intersect; with very
    // few cards tan() blows up, so floor it at something sane.
    radius = n > 2 ? (w * 1.16) / 2 / Math.tan(Math.PI / n) : w * 0.9;
    radius = Math.max(radius, w * 0.9);

    list.forEach((card, i) => {
      const angle = i * step;
      card.style.setProperty('--a', `${angle}deg`);
      card.style.setProperty('--r', `${radius}px`);
      card.dataset.angle = String(angle);
    });
  }

  function clearCylinder() {
    cards.forEach((card) => {
      card.style.removeProperty('--a');
      card.style.removeProperty('--r');
    });
  }

  const norm = (deg) => {
    let d = deg % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  };

  function render() {
    gsap.set(stage3d, { rotationY: rotation });
  }

  /* Only cards on the near arc get to decode. Throttled — this doesn't need
     to run at 60fps, and calling play()/pause() every frame is a real cost. */
  let lastFacing = 0;
  function updateFacing(force) {
    const now = performance.now();
    if (!force && now - lastFacing < 220) return;
    lastFacing = now;

    for (const card of cards) {
      if (card.hidden) { stopCard(card); continue; }
      const d = Math.abs(norm(rotation + Number(card.dataset.angle || 0)));
      if (d < FACING_DEG) playCard(card);
      else stopCard(card);
    }
  }

  /* ── Ticker ─────────────────────────────────────────────────────────────── */

  function tick(_time, delta) {
    if (!spinning || dragging) return;
    rotation += (AUTO_DEG_PER_SEC * delta) / 1000;
    render();
    updateFacing();
  }
  gsap.ticker.add(tick);

  function startSpin() {
    if (DS.reduced || DS.state.view !== 'cylinder' || spinning) return;
    spinning = true;
    // The hero wall and this stage both want most of the governor's budget.
    // Handing off explicitly stops them evicting each other's videos in a loop,
    // which the browser reports as a stream of aborted range requests.
    DS.emit('stage', true);
    updateFacing(true);
  }
  function stopSpin() {
    if (spinning) DS.emit('stage', false);
    spinning = false;
    DS.governor.releaseAll(stage3d);
    cards.forEach((c) => c.classList.remove('is-playing'));
  }

  /* ── Drag ───────────────────────────────────────────────────────────────── */

  function initDrag() {
    if (DS.reduced) return;
    // Draggable measures its target, so the proxy has to actually be in the
    // document even though nothing ever sees it.
    const proxy = document.createElement('div');
    proxy.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;top:0;left:0';
    document.body.appendChild(proxy);
    let startRot = 0;

    Draggable.create(proxy, {
      type: 'x',
      trigger: stageEl,
      inertia: true,
      allowNativeTouchScrolling: true,   // vertical scroll must still work
      lockAxis: true,
      cursor: 'grab',
      activeCursor: 'grabbing',
      onPress() {
        if (DS.state.view !== 'cylinder') return;
        dragging = true;
        startRot = rotation;
      },
      onDrag() {
        if (DS.state.view !== 'cylinder') return;
        rotation = startRot + this.x * DRAG_DEG_PER_PX;
        render();
        updateFacing();
      },
      onThrowUpdate() {
        rotation = startRot + this.x * DRAG_DEG_PER_PX;
        render();
        updateFacing();
      },
      onRelease() {
        // Let the click handler see dragging=true for one frame, then clear.
        requestAnimationFrame(() => { dragging = false; });
      },
      onThrowComplete() { dragging = false; },
    });
  }

  /* ── View switching ─────────────────────────────────────────────────────── */

  function applyView(view, animate) {
    const state = animate ? Flip.getState(cards) : null;

    stageEl.classList.toggle('is-cylinder', view === 'cylinder');
    stageEl.classList.toggle('is-grid', view === 'grid');

    if (view === 'cylinder') {
      // Fly the cards into an un-spun ring, then start turning it. Spinning the
      // container mid-flight would drag the whole Flip sideways as it lands.
      rotation = 0;
      // Grid-mode tilt leaves an inline transform behind, which would win over
      // the CSS rule that builds the ring. Clear it before positioning.
      gsap.set(cards, { clearProps: 'transform' });
      positionCylinder();
      render();
    } else {
      clearCylinder();
      gsap.set(stage3d, { clearProps: 'transform' });
    }

    if (view === 'grid') {
      stopSpin();
      if (DS.touch) observeGrid();
    } else {
      unobserveGrid();
    }

    if (state) {
      Flip.from(state, {
        absolute: true,
        duration: 0.95,
        ease: 'power3.inOut',
        stagger: { amount: 0.35, from: 'center' },
        onComplete: () => {
          if (view === 'cylinder' && onScreen) startSpin();
        },
      });
    }
    // On first setup we deliberately don't start: the stage is far below the
    // fold, and spinning it there would decode six videos nobody can see while
    // the hero is trying to play its own.
  }

  /* ── Grid playback on touch ─────────────────────────────────────────────── */

  let io = null;
  function observeGrid() {
    if (io || DS.governor.stills) return;
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) playCard(e.target);
          else stopCard(e.target);
        }
      },
      { threshold: 0.62 }
    );
    shown().forEach((c) => io.observe(c));
  }
  function unobserveGrid() {
    if (!io) return;
    io.disconnect();
    io = null;
  }

  /* ── Filtering ──────────────────────────────────────────────────────────── */

  function applyFilter() {
    const state = Flip.getState(cards);

    cards.forEach((card, i) => {
      card.hidden = !DS.matches(DS.works[i]);
    });

    if (DS.state.view === 'cylinder') { positionCylinder(); render(); }

    Flip.from(state, {
      absolute: true,
      duration: 0.7,
      ease: 'power3.inOut',
      stagger: { amount: 0.2, from: 'center' },
      onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: 0.4 }),
      onLeave: (els) => gsap.to(els, { opacity: 0, duration: 0.25 }),
    });

    if (io) { unobserveGrid(); observeGrid(); }
    updateFacing(true);
  }

  /* ── Wire up ────────────────────────────────────────────────────────────── */

  build();
  applyView(DS.state.view, false);
  initDrag();

  DS.on('view', (v) => applyView(v, true));
  DS.on('filter', applyFilter);

  // Pause everything when the stage scrolls away, and when the tab is hidden.
  const sectionIO = new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting;
      if (onScreen) {
        if (DS.state.view === 'cylinder') startSpin();
        else if (DS.touch) observeGrid();
      } else {
        stopSpin();
        unobserveGrid();
      }
    },
    { threshold: 0.05 }
  );
  sectionIO.observe(stageEl);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSpin();
    else if (DS.state.view === 'cylinder' && onScreen) startSpin();
  });

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (DS.state.view === 'cylinder') { positionCylinder(); render(); }
    }, 160);
  });

  DS.reelwall = { playCard, stopCard, cards: () => cards, shown };
})();
