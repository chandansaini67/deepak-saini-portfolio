/* ══════════════════════════════════════════════════════════════════════════
   Lightbox player.

   Opening morphs the card into the player rather than fading a modal over the
   top: Flip.getState captures where the player naturally sits, Flip.fit drops
   it onto the card's rect, then we animate back. Closing runs it in reverse,
   so the reel visibly returns to its slot.
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DS = window.DS;
  const lb = document.getElementById('lightbox');
  const frame = document.getElementById('lbFrame');
  const video = document.getElementById('lbVideo');
  const scrim = lb && lb.querySelector('.lb__scrim');
  const titleEl = document.getElementById('lbTitle');
  const metaEl = document.getElementById('lbMeta');
  const caption = lb && lb.querySelector('.lb__cap');
  if (!lb || !frame || !video) return;

  // The player must work even if the GSAP CDN is unreachable — it's the one
  // thing on the page a visitor actually came to do. Without it we just skip
  // the morph and show the modal.
  const HAS_GSAP = typeof window.gsap !== 'undefined' && !!window.Flip;
  if (HAS_GSAP) gsap.registerPlugin(Flip);

  const fade = (el, vars) => {
    if (HAS_GSAP) return gsap.to(el, vars);
    if (typeof vars.opacity === 'number') el.style.opacity = String(vars.opacity);
    if (vars.onComplete) vars.onComplete();
    return null;
  };

  let open = false;
  let current = -1;
  let opener = null;      // the card we came from, to restore focus to
  let busy = false;

  const cardFor = (index) => document.querySelector(`.reel[data-index="${index}"]`);

  /** Prev/next walk the filtered list, not everything. */
  function order() {
    return DS.works
      .map((w, i) => i)
      .filter((i) => DS.matches(DS.works[i]));
  }

  function load(index) {
    const w = DS.works[index];
    if (!w) return;
    current = index;

    video.pause();
    video.src = w.full;
    video.poster = w.poster;
    video.load();
    const p = video.play();
    if (p && p.catch) p.catch(() => {});

    const cat = DS.CATEGORY_LABEL[w.category] || w.category.toUpperCase();
    titleEl.textContent = w.client ? `${w.title} — ${w.client}` : w.title;
    metaEl.textContent = `${w.duration} · ${w.aspect} · ${cat}`;
    lb.setAttribute('aria-label', `Playing ${w.title}`);
  }

  function show(index) {
    if (open || busy) return;
    const card = cardFor(index);
    const media = card && card.querySelector('.reel__media');
    opener = card || null;

    open = true;
    busy = true;
    lb.hidden = false;
    document.body.style.overflow = 'hidden';
    if (DS.smoother) DS.smoother.paused(true);
    DS.governor.releaseAll();

    load(index);
    fade(scrim, { opacity: 1, duration: 0.35, ease: 'power2.out' });

    if (media && !DS.reduced && HAS_GSAP) {
      // Morph the video itself, not the whole frame — the frame is taller than
      // the video because of the caption, so fitting it to a 9:16 card would
      // land the video short of the card's edges.
      const state = Flip.getState(video);
      Flip.fit(video, media, { scale: true });
      Flip.from(state, {
        duration: 0.55,
        ease: 'power3.inOut',
        scale: true,
        onComplete: () => {
          gsap.set(video, { clearProps: 'transform,width,height' });
          busy = false;
        },
      });
      gsap.fromTo(caption, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, delay: 0.32 });
    } else if (HAS_GSAP) {
      gsap.fromTo(frame, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.3, onComplete: () => { busy = false; } });
    } else {
      busy = false;
    }

    document.getElementById('lbClose').focus({ preventScroll: true });
  }

  function hide() {
    if (!open || busy) return;
    busy = true;
    const media = opener && opener.querySelector('.reel__media');

    video.pause();
    fade(scrim, { opacity: 0, duration: 0.3, ease: 'power2.in' });

    const finish = () => {
      lb.hidden = true;
      video.removeAttribute('src');
      video.load();
      if (HAS_GSAP) gsap.set([frame, video, caption], { clearProps: 'all' });
      else [frame, video, caption].forEach((el) => el && el.removeAttribute('style'));
      document.body.style.overflow = '';
      if (DS.smoother) DS.smoother.paused(false);
      open = false;
      busy = false;
      if (opener) opener.focus({ preventScroll: true });
      opener = null;
    };

    fade(caption, { opacity: 0, duration: 0.18 });

    if (HAS_GSAP && media && !DS.reduced && media.getBoundingClientRect().width > 0) {
      Flip.fit(video, media, {
        scale: true,
        duration: 0.45,
        ease: 'power3.in',
        onComplete: finish,
      });
    } else {
      fade(frame, { opacity: 0, duration: 0.2, onComplete: finish });
    }
  }

  function step(dir) {
    if (busy) return;
    const list = order();
    const at = list.indexOf(current);
    if (at === -1) return;
    const next = list[(at + dir + list.length) % list.length];

    // Cross-fade the frame rather than re-morphing — we're already open, and a
    // second Flip from a card that may be behind the scrim reads as a glitch.
    fade(frame, {
      opacity: 0, duration: 0.18, ease: 'power2.in',
      onComplete: () => {
        load(next);
        opener = cardFor(next) || opener;
        fade(frame, { opacity: 1, duration: 0.25, ease: 'power2.out' });
      },
    });
  }

  /* ── Focus trap ─────────────────────────────────────────────────────────── */

  const FOCUSABLE = 'button, [href], video[controls], [tabindex]:not([tabindex="-1"])';
  function trap(e) {
    if (e.key !== 'Tab') return;
    // Not offsetParent — that is null for everything inside a position:fixed
    // ancestor, which would leave the trap with nothing to hold on to.
    const items = Array.from(lb.querySelectorAll(FOCUSABLE))
      .filter((el) => el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ── Wire up ────────────────────────────────────────────────────────────── */

  DS.on('open', show);

  document.getElementById('lbClose').addEventListener('click', hide);
  document.getElementById('lbPrev').addEventListener('click', () => step(-1));
  document.getElementById('lbNext').addEventListener('click', () => step(1));
  lb.querySelectorAll('[data-lb-close]').forEach((el) => el.addEventListener('click', hide));

  document.addEventListener('keydown', (e) => {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else trap(e);
  });

  DS.lightbox = { show, hide, isOpen: () => open };
})();
