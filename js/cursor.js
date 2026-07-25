/* ══════════════════════════════════════════════════════════════════════════
   Custom cursor — a disc that trails the pointer slightly and becomes a PLAY
   target over reels. Pointer devices only; never on touch or reduced motion.
   ══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const DS = window.DS;
  if (DS.touch || DS.reduced || typeof window.gsap === 'undefined') return;

  const el = document.getElementById('cursor');
  if (!el) return;

  const setX = gsap.quickTo(el, 'x', { duration: 0.32, ease: 'power3' });
  const setY = gsap.quickTo(el, 'y', { duration: 0.32, ease: 'power3' });

  window.addEventListener(
    'pointermove',
    (e) => {
      setX(e.clientX);
      setY(e.clientY);
    },
    { passive: true }
  );

  // Delegated so it keeps working for cards injected after load.
  document.addEventListener('pointerover', (e) => {
    const reel = e.target.closest('.reel');
    const link = e.target.closest('a, button, [role="tab"]');
    el.classList.toggle('is-play', !!reel);
    el.classList.toggle('is-link', !reel && !!link);
  });

  document.addEventListener('pointerdown', () => gsap.to(el, { scale: 0.82, duration: 0.15 }));
  document.addEventListener('pointerup', () => gsap.to(el, { scale: 1, duration: 0.25 }));

  // Hide when the pointer leaves the window entirely.
  document.addEventListener('pointerleave', () => gsap.to(el, { opacity: 0, duration: 0.2 }));
  document.addEventListener('pointerenter', () => gsap.to(el, { opacity: 1, duration: 0.2 }));
})();
