// scroll.js
// Smooth scrolling (Lenis) + scroll-driven animation (GSAP ScrollTrigger),
// including the pinned four-step story.
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
import { initRandom, assignPoints, updateCentroids, hasConverged, computeInertia } from './kmeans.js'
import { blobs, createRng } from './data.js'
import { createRenderer } from './renderer.js'

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

// ===========================================================================
// THE PINNED STORY
// ===========================================================================
//
// The idea in one sentence: the canvas is a pure function of five numbers,
// and scrolling moves those numbers.
//
//   story.scatter  0 -> 1   step 1: points appear on the page
//   story.seed     0 -> 1   step 2: K centroids grow in
//   story.lines    0 -> 1   step 3a: lines grow from each point to its centroid
//   story.colour   0 -> 1   step 3b: points take their cluster's colour
//   story.iter     0 -> N   step 4: N update+assign rounds (precomputed)
//
// Each number is tweened by a "scrubbed" ScrollTrigger, which ties the tween's
// progress directly to the scroll position instead of to time. Scroll down and
// it plays; scroll up and it plays backwards. Because the picture is computed
// from these numbers every frame (never built up step by step), reversing is
// automatically clean: there's no leftover state to undo.

// Seeds picked by searching for a run that starts badly (two seeds in one blob),
// visibly travels for 6 iterations, and still ends at the best answer.
const STORY = { n: 160, k: 4, dataSeed: 36, initSeed: 13 }
const STEP_NAMES = ['Scatter', 'Seed', 'Assign', 'Update']

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const lerp = (a, b, t) => a + (b - a) * t
const smooth = gsap.parseEase('power2.inOut') // returns a function: 0..1 -> eased 0..1

/**
 * Run K-means once and record every intermediate state, so the story can
 * scrub through them in either direction.
 * centroids[i] and assignments[i] are the state after i update rounds.
 */
function recordRun(points, k, rng) {
  const centroids = [initRandom(points, k, rng)]
  const assignments = [assignPoints(points, centroids[0])]

  for (let i = 0; i < 50; i++) {
    const next = updateCentroids(points, assignments[i], centroids[i])
    if (hasConverged(centroids[i], next)) break // nothing moved: done
    centroids.push(next)
    assignments.push(assignPoints(points, next))
  }
  return { centroids, assignments }
}

/**
 * Where the reader's eye is, as a % down the viewport. Steps are "read" as they
 * cross these lines. On mobile the pinned figure covers the top half of the
 * screen, so the lines sit lower.
 */
const isMobile = () => window.matchMedia('(max-width: 760px)').matches
const focusLines = () =>
  isMobile()
    ? { active: 85, start: 98, end: 74, lastEnd: 62 }
    : { active: 55, start: 75, end: 40, lastEnd: 10 }

/**
 * Build the pinned scroll story.
 * @param {HTMLElement} section  the #story section
 */
export function initStory(section) {
  const figure = section.querySelector('.story__figure')
  const canvas = section.querySelector('#story-canvas')
  const stepList = section.querySelector('.story__steps')
  const steps = gsap.utils.toArray(section.querySelectorAll('.step'))
  const stepLabel = section.querySelector('#story-step')
  const readout = section.querySelector('#story-readout')

  // --- Precompute everything ---------------------------------------------------
  const points = blobs({ n: STORY.n, centers: STORY.k, seed: STORY.dataSeed })
  const run = recordRun(points, STORY.k, createRng(STORY.initSeed))
  const N = run.centroids.length - 1 // number of update rounds that moved something

  // For the "scatter" step: each point gets a random moment to appear (0..0.75 of
  // the step) and a small offset it drifts in from, like ink dots landing on paper.
  const scatterRng = createRng(STORY.dataSeed + 1)
  const appearAt = points.map(() => scatterRng() * 0.75)
  const driftFrom = points.map((p) => {
    const angle = scatterRng() * Math.PI * 2
    return { x: p.x + Math.cos(angle) * 0.04, y: p.y + Math.sin(angle) * 0.04 }
  })

  // --- The five numbers the scroll position controls ---------------------------
  const story = { scatter: 0, seed: 0, lines: 0, colour: 0, iter: 0 }

  // --- Rendering ---------------------------------------------------------------
  let dirty = true
  const requestRender = () => {
    dirty = true
  }
  const renderer = createRenderer(canvas, { onResize: requestRender })
  let lastReadout = ''

  /** Turn the five numbers into a scene for the renderer. */
  function buildScene() {
    const s = story

    // Step 1: each point fades in during its own slice of the scatter progress,
    // drifting the last few pixels into place.
    const pointOpacity = appearAt.map((t) => clamp01((s.scatter - t) / 0.25))
    const drawnPoints = points.map((p, i) => {
      const e = smooth(pointOpacity[i])
      return { x: lerp(driftFrom[i].x, p.x, e), y: lerp(driftFrom[i].y, p.y, e) }
    })

    // Step 4: which round are we in, and how far through it?
    // The first half of each round moves the centroids, the second half recolours.
    let centroids = run.centroids[0]
    let assignments = run.assignments[0]
    let prevAssignments = null
    let colorMix = s.colour
    let trails = null
    let iteration = 0

    if (N > 0 && s.iter > 0) {
      const round = Math.min(Math.floor(s.iter), N - 1) // 0..N-1
      const f = s.iter - round                            // 0..1 within this round
      const move = smooth(clamp01(f * 2))
      const recolour = smooth(clamp01(f * 2 - 1))

      const from = run.centroids[round]
      const to = run.centroids[round + 1]
      centroids = from.map((c, j) => ({ x: lerp(c.x, to[j].x, move), y: lerp(c.y, to[j].y, move) }))
      prevAssignments = run.assignments[round]
      assignments = run.assignments[round + 1]
      colorMix = recolour
      iteration = round + (move > 0.5 ? 1 : 0)

      // Each centroid's path so far: every past position, then where it is now.
      trails = centroids.map((c, j) => [
        ...run.centroids.slice(0, round + 1).map((past) => past[j]),
        c,
      ])
    }

    updateReadout(iteration, centroids, colorMix > 0.5 ? assignments : prevAssignments ?? assignments)

    return {
      points: drawnPoints,
      pointOpacity,
      assignments,
      prevAssignments,
      colorMix,
      centroids,
      centroidScale: s.seed,
      trails,
      // Step 3: lines grow out, then mostly fade as the colours take over,
      // and are gone once the centroids start moving.
      links: { progress: s.lines, alpha: (1 - 0.75 * s.colour) * (1 - clamp01(s.iter * 4)) },
      showRegions: s.colour > 0,
      regionStrength: s.colour,
    }
  }

  function updateReadout(iteration, centroids, assignments) {
    let text = `Iteration ${String(iteration).padStart(2, '0')}`
    if (story.colour > 0.5) {
      text += ` / Inertia ${computeInertia(points, centroids, assignments).toFixed(3)}`
    }
    if (N > 0 && story.iter >= N - 0.001) text += ' / Converged'
    // Only touch the DOM when the text actually changes.
    if (text !== lastReadout) {
      readout.textContent = text
      lastReadout = text
    }
  }

  gsap.ticker.add(() => {
    if (!dirty) return
    dirty = false
    renderer.draw(buildScene())
  })
  document.fonts.ready.then(requestRender)

  // --- Pin the figure ------------------------------------------------------------
  // The figure stays fixed while the steps scroll past, from when it reaches its
  // resting place until the end of the step list lines up with its bottom.
  // pinSpacing: false because the figure sits beside the steps, so no extra
  // scroll space needs to be added for it.
  const mastheadHeight = () => document.querySelector('.masthead').offsetHeight
  const pinTop = () =>
    isMobile()
      ? mastheadHeight() + 8 // tucked under the masthead
      : mastheadHeight() + (window.innerHeight - mastheadHeight() - figure.offsetHeight) / 2 // centred

  ScrollTrigger.create({
    trigger: figure,
    start: () => `top ${pinTop()}px`,
    endTrigger: stepList,
    end: () => `bottom ${pinTop() + figure.offsetHeight}px`,
    pin: true,
    pinSpacing: false,
    invalidateOnRefresh: true, // re-run the start/end functions after a resize
  })

  // --- Highlight the step being read --------------------------------------------
  // Steps are stacked with no gaps, so exactly one is "active" at a time.
  steps.forEach((step, i) => {
    ScrollTrigger.create({
      trigger: step,
      start: () => `top ${focusLines().active}%`,
      end: () => `bottom ${focusLines().active}%`,
      invalidateOnRefresh: true,
      onToggle: (self) => {
        step.classList.toggle('is-active', self.isActive)
        if (!self.isActive) return
        stepLabel.textContent = `— ${STEP_NAMES[i]}`
        if (reduceMotion) jumpToStep(i)
      },
    })
  })

  // --- Reduced motion: no scrubbing, just fade between finished states ---------------
  const STEP_END = [
    { scatter: 1, seed: 0, lines: 0, colour: 0, iter: 0 },
    { scatter: 1, seed: 1, lines: 0, colour: 0, iter: 0 },
    { scatter: 1, seed: 1, lines: 1, colour: 1, iter: 0 },
    { scatter: 1, seed: 1, lines: 1, colour: 1, iter: N },
  ]

  function jumpToStep(i) {
    gsap.to(canvas, {
      opacity: 0,
      duration: 0.15,
      overwrite: true,
      onComplete: () => {
        Object.assign(story, STEP_END[i])
        requestRender()
        gsap.to(canvas, { opacity: 1, duration: 0.35 })
      },
    })
  }

  if (reduceMotion) {
    Object.assign(story, STEP_END[0]) // show the points straight away
    return
  }

  // --- Scrubbed tweens: scroll position -> the five numbers ------------------------
  // Each step's animation runs while the step's centre travels from the `start`
  // line to the `end` line, then holds while you read. scrub: 0.6 means the
  // animation takes 0.6s to catch up with the scroll position, which smooths out
  // jerky wheel input without feeling laggy.
  const scrubFor = (i, last = false) => ({
    trigger: steps[i],
    start: () => `center ${focusLines().start}%`,
    end: () => `center ${last ? focusLines().lastEnd : focusLines().end}%`,
    scrub: 0.6,
    invalidateOnRefresh: true,
  })

  gsap.fromTo(story, { scatter: 0 }, { scatter: 1, ease: 'none', onUpdate: requestRender, scrollTrigger: scrubFor(0) })

  gsap.fromTo(story, { seed: 0 }, { seed: 1, ease: 'power2.out', onUpdate: requestRender, scrollTrigger: scrubFor(1) })

  gsap
    .timeline({ onUpdate: requestRender, scrollTrigger: scrubFor(2) })
    .fromTo(story, { lines: 0 }, { lines: 1, ease: 'power1.inOut' })
    .fromTo(story, { colour: 0 }, { colour: 1, ease: 'power1.inOut' })

  // Linear here: the per-round easing is applied inside buildScene.
  gsap.fromTo(story, { iter: 0 }, { iter: N, ease: 'none', onUpdate: requestRender, scrollTrigger: scrubFor(3, true) })
}
