// scroll.js
// Smooth scrolling (Lenis) + scroll-driven animation (GSAP ScrollTrigger).
//
// How the pieces fit:
//   - Lenis intercepts wheel/touch input and eases the page's scroll position
//     toward the target over several frames (that's the "smooth" feel).
//   - ScrollTrigger watches the scroll position to start, scrub or pin animations.
//   - Both need to agree on *when* a frame happens and *where* the page is,
//     so we drive Lenis from GSAP's ticker and tell ScrollTrigger every time
//     Lenis moves the page.

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'

gsap.registerPlugin(ScrollTrigger)

// Read the OS-level "reduce motion" setting once at startup.
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// One easing curve for the whole site. "power3.out" starts fast and
// decelerates into place, with no overshoot or bounce.
const EASE = 'power3.out'

/**
 * Set up Lenis and sync it with GSAP. Returns the Lenis instance,
 * or null if the user prefers reduced motion (native scrolling is used instead).
 */
export function initSmoothScroll() {
  if (reduceMotion) return null

  const lenis = new Lenis({
    lerp: 0.1, // each frame, move 10% of the remaining distance (higher = snappier)
    // Make <a href="#id"> links scroll smoothly too, stopping 68px early
    // (44px masthead + 24px breathing room) so the sticky header doesn't cover the target.
    anchors: { offset: -68 },
  })

  // 1. Whenever Lenis changes the scroll position, ScrollTrigger re-checks its triggers.
  lenis.on('scroll', ScrollTrigger.update)

  // 2. Drive Lenis from GSAP's ticker (one requestAnimationFrame loop for everything).
  //    GSAP gives time in seconds; Lenis expects milliseconds.
  gsap.ticker.add((time) => lenis.raf(time * 1000))

  // 3. GSAP normally "smooths over" long frames (e.g. after a tab switch) by
  //    pretending less time passed. That would make Lenis and GSAP disagree,
  //    so we turn it off.
  gsap.ticker.lagSmoothing(0)

  return lenis
}

/**
 * Hero entrance: the title, lead and readout fade up in a short stagger.
 * CSS hides [data-hero] (visibility: hidden) so nothing flashes before this runs.
 * autoAlpha animates opacity AND flips visibility back on as soon as opacity > 0.
 */
export function initHeroIntro() {
  gsap.from('[data-hero]', {
    autoAlpha: 0,
    y: reduceMotion ? 0 : 28,
    duration: reduceMotion ? 0.6 : 1.1,
    ease: EASE,
    stagger: 0.08,
    delay: 0.1,
  })
}

/**
 * Any element with [data-reveal] fades (and, with motion allowed, rises 24px)
 * into place the first time its top crosses 85% of the viewport height.
 */
export function initReveals() {
  gsap.utils.toArray('[data-reveal]').forEach((el) => {
    gsap.from(el, {
      autoAlpha: 0,
      y: reduceMotion ? 0 : 24,
      duration: reduceMotion ? 0.5 : 0.9,
      ease: EASE,
      scrollTrigger: {
        trigger: el,
        start: 'top 85%',
        once: true, // play once, then the ScrollTrigger removes itself
      },
    })
  })
}

/**
 * ScrollTrigger measures element positions up front. Web fonts loading in later
 * change text heights and shift those positions, so re-measure once fonts are ready.
 */
export function refreshAfterFonts() {
  document.fonts.ready.then(() => ScrollTrigger.refresh())
}
