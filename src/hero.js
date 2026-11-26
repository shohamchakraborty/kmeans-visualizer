// hero.js
// The live canvas behind the hero title: points drift across the page and
// settle into clusters while K-means runs on them in real time. Then they
// scatter, and it starts again with new clusters.
//
// The loop, one cycle:
//   1. SETTLE (7s)        points drift from scattered positions into blobs.
//                         Every 0.9s K-means does one assign + update on wherever
//                         the points are right now, so the centroids chase the
//                         points as they gather.
//   2. HOLD (about 4s)    rounds keep running on the still points. At 8.6s a
//                         "second opinion" checks for a better answer (see
//                         secondOpinion). The status reads "Converged" once a
//                         round changes nothing.
//   3. SCATTER (about 4s) colours fade, centroids shrink away, points drift apart.
//
// Unlike the story (which replays a recorded run), this runs K-means live on
// moving data, so it never repeats exactly.

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  initPlusPlus,
  assignPoints,
  updateCentroids,
  hasConverged,
  computeInertia,
  runToConvergence,
  squaredDistance,
} from './kmeans.js'
import { createRng, gaussian } from './data.js'
import { createRenderer } from './renderer.js'
import { reduceMotion } from './scroll.js'

const N = 150 // points
const K = 4   // clusters
const TICK = 0.9 // seconds between K-means rounds while settling

export function initHero(section) {
  const canvas = section.querySelector('#hero-canvas')
  const els = {
    points: section.querySelector('#hero-points'),
    iteration: section.querySelector('#hero-iteration'),
    status: section.querySelector('#hero-status'),
  }
  const rng = createRng(11)

  // Live point positions. GSAP tweens these objects directly.
  const points = []

  // K-means state (true values) and what's drawn (animated values).
  let centroids = []
  let iteration = 0
  const view = {
    centroids: [],
    centroidScale: 0,
    assignments: null,
    prevAssignments: null,
    colorMix: 1,
  }

  // --- Rendering -------------------------------------------------------------
  let dirty = true
  const requestRender = () => {
    dirty = true
  }

  // 'cover' fills the whole hero with data space, not just a centred square.
  const renderer = createRenderer(canvas, { fit: 'cover', padding: 0, onResize: requestRender })

  gsap.ticker.add(() => {
    if (!dirty) return
    dirty = false
    renderer.draw({
      points,
      assignments: view.assignments,
      prevAssignments: view.prevAssignments,
      colorMix: view.colorMix,
      centroids: view.centroids,
      centroidScale: view.centroidScale,
      pointOpacity: 0.8, // a touch lighter, so the title stays the focus
      labels: false,
    })
  })

  // --- Readout ---------------------------------------------------------------
  els.points.textContent = N
  const setIteration = (n) => {
    iteration = n
    els.iteration.textContent = String(n).padStart(2, '0')
  }
  const setStatus = (text) => {
    els.status.textContent = text
  }

  // --- Where to put things ---------------------------------------------------
  // bounds() is the slice of data space visible on screen, which depends on the
  // hero's aspect ratio. Everything is placed inside it (minus a margin).
  function randomPoint(margin = 0.04) {
    const b = renderer.bounds()
    return {
      x: lerp(b.minX + margin, b.maxX - margin, rng()),
      y: lerp(b.minY + margin, b.maxY - margin, rng()),
    }
  }

  /**
   * Rectangles (in data space) around the hero's small text: the lead paragraph,
   * the readout and the labels. Clusters may settle behind the huge title (big
   * type stays readable over small dots), but not behind body-size text.
   */
  function textZones(margin) {
    return [...section.querySelectorAll('.hero__lead, .hero__readout, .hero__cue, .hero__fig')].map((el) => {
      const r = el.getBoundingClientRect()
      const topLeft = renderer.toData(r.left, r.top)
      const bottomRight = renderer.toData(r.right, r.bottom)
      return {
        minX: topLeft.x - margin,
        maxX: bottomRight.x + margin,
        minY: topLeft.y - margin,
        maxY: bottomRight.y + margin,
      }
    })
  }

  /** K blob centres spread across the screen, then each point gets a spot in a blob. */
  function blobTargets() {
    const b = renderer.bounds()
    // Scale everything by the SHORTER visible side, so a tall phone screen
    // (narrow in x) gets the same proportions as a wide desktop one (short in y).
    const s = Math.min(b.maxX - b.minX, b.maxY - b.minY)
    const spread = s * 0.05
    const zones = textZones(spread * 2.5) // keep about 2.5 standard deviations clear
    const inZone = (c) => zones.some((z) => c.x > z.minX && c.x < z.maxX && c.y > z.minY && c.y < z.maxY)

    // Rejection sampling: propose a random centre, keep it only if it's clear of
    // the text and far enough from the other centres. After many failures, relax
    // the rules rather than loop forever (e.g. on a very small screen).
    const centres = []
    for (let attempt = 0; centres.length < K && attempt < 600; attempt++) {
      const c = {
        x: lerp(b.minX + s * 0.12, b.maxX - s * 0.12, rng()),
        y: lerp(b.minY + s * 0.15, b.maxY - s * 0.15, rng()),
      }
      const farEnough = centres.every((o) => Math.hypot(o.x - c.x, o.y - c.y) > s * 0.3)
      if ((farEnough && !inZone(c)) || attempt > 450) centres.push(c)
    }
    return points.map((_, i) => {
      const c = centres[i % K]
      return { x: c.x + gaussian(rng) * spread, y: c.y + gaussian(rng) * spread }
    })
  }

  // --- Empty-cluster rescue ----------------------------------------------------
  // Centroids are seeded while the points are still scattered, so as blobs form
  // a centroid can be left with no points at all. Our updateCentroids leaves an
  // empty cluster where it is, so it would sit there forever. scikit-learn's fix:
  // move it onto the point that is currently worst served (farthest from its own
  // centroid). That point is likely in a blob that is sharing a centroid.
  function rescueEmptyClusters(assignments) {
    const counts = new Array(K).fill(0)
    assignments.forEach((a) => counts[a]++)

    counts.forEach((count, j) => {
      if (count > 0) return
      let farthest = 0
      let farthestDist = -1
      points.forEach((p, i) => {
        const d = squaredDistance(p, centroids[assignments[i]])
        if (d > farthestDist) {
          farthestDist = d
          farthest = i
        }
      })
      centroids[j] = { x: points[farthest].x, y: points[farthest].y }
      assignments[farthest] = j
    })
  }

  // --- One K-means round on the points' CURRENT positions --------------------
  let pointsSettled = false

  function kmeansRound() {
    const assignments = assignPoints(points, centroids)
    rescueEmptyClusters(assignments)
    const next = updateCentroids(points, assignments, centroids)
    const converged = hasConverged(centroids, next, 1e-4)
    if (!converged) setIteration(iteration + 1)
    // Only claim convergence once the data has stopped moving AND a round changed nothing.
    setStatus(converged && pointsSettled ? 'Converged' : 'Settling')
    centroids = next
    show(assignments)
  }

  /** Recolour (cross-fade) and glide the drawn centroids to the true ones. */
  function show(assignments) {
    view.prevAssignments = view.assignments
    view.assignments = assignments
    view.colorMix = 0
    // overwrite: 'auto' kills any older tween still animating the same property,
    // so two overlapping animations never fight over one centroid.
    gsap.to(view, { colorMix: 1, duration: 0.5, ease: 'power2.out', overwrite: 'auto', onUpdate: requestRender })
    view.centroids.forEach((vc, j) =>
      gsap.to(vc, {
        x: centroids[j].x,
        y: centroids[j].y,
        duration: TICK * 0.9,
        ease: 'power2.inOut',
        overwrite: 'auto',
        onUpdate: requestRender,
      }),
    )
  }

  // --- A second opinion (scikit-learn's n_init) --------------------------------
  // Even with the rescue, K-means can settle into a LOCAL minimum: e.g. one
  // centroid parked between two blobs while another blob has two centroids.
  // No assign/update round can fix that. The standard remedy is to run K-means
  // several times from fresh seeds and keep the lowest-inertia answer
  // (scikit-learn's n_init parameter). Simulating 400 hero cycles: without this,
  // about 83% found all four blobs; with 3 restarts, all of them did.
  const RESTARTS = 3

  function secondOpinion() {
    const currentInertia = computeInertia(points, centroids, assignPoints(points, centroids))
    let best = null
    for (let r = 0; r < RESTARTS; r++) {
      const result = runToConvergence(points, K, { rng })
      if (!best || result.inertia < best.inertia) best = result
    }
    if (best.inertia >= currentInertia * 0.95) return // already (about) as good: keep it

    setStatus('Restarting')
    centroids = matchOrder(centroids, best.centroids)
    show(assignPoints(points, centroids))
  }

  /**
   * Reorder `next` so next[j] is the new centroid nearest the old centroids[j].
   * Without this, centroid 0 might fly across the screen to where centroid 2
   * should be, and whole blobs would swap colours. Greedy: take the closest
   * old/new pair, then the closest remaining pair, and so on.
   */
  function matchOrder(old, next) {
    const pairs = []
    old.forEach((o, i) => next.forEach((n, j) => pairs.push({ i, j, d: squaredDistance(o, n) })))
    pairs.sort((a, b) => a.d - b.d)

    const result = new Array(old.length)
    const used = new Set()
    for (const { i, j } of pairs) {
      if (result[i] || used.has(j)) continue
      result[i] = next[j]
      used.add(j)
    }
    return result
  }

  // --- The cycle ----------------------------------------------------------------
  let current = null // the running timeline, so it can be paused off-screen

  function settle() {
    setIteration(0)
    setStatus('Settling')
    pointsSettled = false
    const targets = blobTargets()
    const tl = gsap.timeline({ onUpdate: requestRender, onComplete: scatter })

    // Points drift to their targets, each starting at a slightly different time
    // (up to 1.5s late, so every point has arrived by 1.5 + 5.5 = 7s).
    points.forEach((p, i) => {
      tl.to(p, { x: targets[i].x, y: targets[i].y, duration: 5.5, ease: 'power2.inOut' }, rng() * 1.5)
    })
    tl.call(() => (pointsSettled = true), null, 7)

    // Seed centroids on wherever the points are now, and grow them in.
    tl.call(
      () => {
        centroids = initPlusPlus(points, K, rng)
        view.centroids = centroids.map((c) => ({ x: c.x, y: c.y }))
        view.assignments = null
        view.prevAssignments = null
      },
      null,
      0.3,
    )
    tl.fromTo(view, { centroidScale: 0 }, { centroidScale: 1, duration: 0.6, ease: 'power3.out' }, 0.3)

    // K-means rounds while the points are moving, and on through the hold, so a
    // rescued centroid has time to find its blob. Once converged, rounds change
    // nothing, so the picture simply holds still.
    for (let t = 1.1; t < 11; t += TICK) tl.call(kmeansRound, null, t)
    tl.call(secondOpinion, null, 8.6) // after the points have stopped (7s) and a couple of rounds
    tl.to({}, { duration: 0.8 }) // a beat after the last round, then scatter

    current = tl
  }

  function scatter() {
    setStatus('Scattering')
    const tl = gsap.timeline({ onUpdate: requestRender, onComplete: settle })

    // Colours fade back to grey: "after" = no cluster (grey), cross-faded in.
    view.prevAssignments = view.assignments
    view.assignments = null
    tl.fromTo(view, { colorMix: 0 }, { colorMix: 1, duration: 1.2, ease: 'power1.inOut' }, 0)
    tl.to(view, { centroidScale: 0, duration: 0.8, ease: 'power2.in' }, 0)

    points.forEach((p) => {
      const q = randomPoint()
      tl.to(p, { x: q.x, y: q.y, duration: 3.5, ease: 'power2.inOut' }, 0.3 + rng() * 0.8)
    })

    current = tl
  }

  // --- Start ------------------------------------------------------------------
  for (let i = 0; i < N; i++) points.push(randomPoint())

  if (reduceMotion) {
    // No drifting: show one settled, converged result.
    const targets = blobTargets()
    targets.forEach((t, i) => Object.assign(points[i], t))
    const result = runToConvergence(points, K, { rng })
    view.centroids = result.centroids
    view.assignments = result.assignments
    view.centroidScale = 1
    setIteration(result.iterations)
    setStatus('Converged')
    return
  }

  settle()

  // Pause the loop while the hero is off-screen: no point animating what nobody sees.
  ScrollTrigger.create({
    trigger: section,
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (self) => (self.isActive ? current?.resume() : current?.pause()),
  })
}

function lerp(a, b, t) {
  return a + (b - a) * t
}
