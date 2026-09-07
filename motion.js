/* GSAP motion layer for the clock testimony and ballot interactions.
 * The game remains fully usable when GSAP is blocked: callers fall back to CSS. */
(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = window.gsap;
  if (!engine) return;

  document.documentElement.classList.add('gsap-ready');

  function speech(cards, activeIndex) {
    if (!cards.length || activeIndex < 0) return false;
    if (reduce) {
      engine.set(cards, { clearProps: 'transform,opacity,filter' });
      return true;
    }

    cards.forEach((card, index) => {
      let offset = index - activeIndex;
      const count = cards.length;
      if (offset > count / 2) offset -= count;
      if (offset < -count / 2) offset += count;
      const distance = Math.abs(offset);
      const isSpeaker = offset === 0;

      engine.killTweensOf(card);
      engine.fromTo(card, {
        xPercent: -50,
        yPercent: -50,
        rotationY: isSpeaker ? (index % 2 ? -72 : 72) : (offset > 0 ? -62 : 62),
        scale: Math.max(.58, .9 - distance * .08),
        opacity: 0,
        filter: 'brightness(.3) saturate(.35)',
      }, {
        xPercent: -50,
        yPercent: -50,
        rotationY: isSpeaker ? 0 : (offset > 0 ? -46 : 46),
        scale: isSpeaker ? 1.15 : Math.max(.66, 1.02 - distance * .13),
        opacity: distance > 3 ? 0 : (isSpeaker ? 1 : .72),
        filter: isSpeaker ? 'brightness(1) saturate(.92)' : 'brightness(.48) saturate(.52)',
        duration: isSpeaker ? .82 : .64,
        delay: Math.min(distance, 3) * .035,
        ease: isSpeaker ? 'power4.out' : 'power3.out',
        overwrite: true,
      });

      if (isSpeaker) {
        const name = card.querySelector('.nm');
        if (name) engine.fromTo(name, { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: .45, delay: .3, ease: 'power2.out' });
      }
    });
    return true;
  }

  function voteTray(action) {
    if (!action || reduce) return false;
    const cards = action.querySelectorAll('.vote-card');
    const box = action.querySelector('.ballot-box');
    engine.fromTo(action, { y: 90, opacity: 0 }, { y: 0, opacity: 1, duration: .48, ease: 'power3.out', overwrite: true });
    engine.fromTo(cards, { y: 45, opacity: 0, rotationY: -28 }, {
      y: 0, opacity: 1, rotationY: 0, duration: .5, stagger: .045, delay: .08, ease: 'back.out(1.35)', overwrite: true,
    });
    if (box) engine.fromTo(box, { scale: .7, opacity: 0 }, { scale: 1, opacity: 1, duration: .45, delay: .18, ease: 'back.out(1.6)' });
    return true;
  }

  function castVote(card, box, done) {
    if (!card || !box) return false;
    if (reduce) {
      engine.set(card, { opacity: 0 });
      setTimeout(done, 60);
      return true;
    }

    const cardRect = card.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const x = boxRect.left + boxRect.width / 2 - cardRect.left - cardRect.width / 2;
    const y = boxRect.top + boxRect.height / 2 - cardRect.top - cardRect.height / 2;
    engine.killTweensOf([card, box]);
    engine.timeline({ onComplete: done })
      .to(card, { y: -38, scale: 1.16, filter: 'brightness(1.35)', duration: .22, ease: 'power2.out' })
      .to(card, { x, y, scale: .08, rotation: 11, opacity: 0, duration: .58, ease: 'power3.in' })
      .to(box, { scale: 1.08, duration: .08, yoyo: true, repeat: 1, ease: 'power1.inOut' }, '-=.12');
    return true;
  }

  window.MidnightMotion = { speech, voteTray, castVote };
})();
