// playground.js
// The interactive K-means playground: state, controls, and animation.
//
// The algorithm is run ONE HALF-STEP AT A TIME, so each part can be seen:
//
//     seed  ->  assign  ->  update  ->  assign  ->  update  -> ...  ->  done
//
// `state.next` holds which of those comes next. Step runs one; Play keeps
// running them on a timer until the centroids stop moving.
//
// There are two copies of the centroids, on purpose:
//   state.centroids  the TRUE positions the algorithm uses (jump instantly)
//   view.centroids   the positions DRAWN on screen (GSAP glides these toward
//                    the true ones, so the movement is visible)
// Keeping "what the algorithm knows" separate from "what the screen shows"
// means an animation can never corrupt the maths.

import gsap from 'gsap'
import {
  initRandom,
  initPlusPlus,
  assignPoints,
  updateCentroids,
  computeInertia,
  hasConverged,
} from './kmeans.js'
import { DATASETS, createRng } from './data.js'
import { createRenderer } from './renderer.js'
import { reduceMotion } from './scroll.js'

// One line per dataset, shown under the picker. Moons and Rings explain the failure.
const DATASET_NOTES = {
  blobs: { text: 'Well-separated, round groups. The case K-means was made for.' },
  uniform: { text: 'No real groups at all, yet K-means still returns K of them. It always finds something.' },
  moons: {
    fails: true,
    text: 'Boundaries between centroids are always straight lines, so it slices each crescent in half instead of following its curve.',
  },
  rings: {
    fails: true,
    text: 'Both rings share one centre, so distance to a centroid can’t tell the inner ring from the outer one.',
  },
}

const DATA_SEED = 7     // same dataset every visit
const MAX_POINTS = 1000 // cap on click-to-add, to keep things smooth

// Animation timings in seconds. With reduced motion, things that MOVE are
// instant; colour cross-fades stay, because a fade isn't motion.
const TIMING = reduceMotion
  ? { seed: 0, assign: 0.25, update: 0, pause: 0.6 }
  : { seed: 0.5, assign: 0.45, update: 0.75, pause: 0.3 }

/**
 * Set up the playground inside `root` (the #playground section).
 * Returns { state, onChange } so other modules (the charts, in Phase 5) can follow along.
 */
export function initPlayground(root) {
  // --- DOM references --------------------------------------------------------
  const $ = (sel) => root.querySelector(sel)
  const els = {
    canvas: $('#playground-canvas'),
    kSlider: $('#k-slider'),
    kValue: $('#k-value'),
    step: $('#btn-step'),
    play: $('#btn-play'),
    reset: $('#btn-reset'),
    note: $('#dataset-note'),
    iteration: $('#ro-iteration'),
    inertia: $('#ro-inertia'),
    points: $('#ro-points'),
    next: $('#ro-next'),
    status: $('#ro-status'),
  }

  // --- State -----------------------------------------------------------------
  const state = {
    dataset: 'blobs',
    k: Number(els.kSlider.value),
    init: root.querySelector('input[name="init"]:checked').value, // 'random' | 'plusplus'

    points: [],
    centroids: [],      // true centroid positions
    assignments: null,  // null until the first assign step
    iteration: 0,       // number of update steps completed
    inertia: null,
    history: [],        // inertia after each assign step (for the Phase 5 chart)

    next: 'seed',       // 'seed' | 'assign' | 'update' | 'done'
    playing: false,
    busy: false,        // true while a step's animation is running
  }

  // What the renderer draws. GSAP animates the numbers in here.
  const view = {
    centroids: [],          // on-screen centroid positions
    centroidScale: 0,       // 0..1, centroids grow in when seeded
    prevAssignments: null,  // colours before the latest assign step
    colorMix: 1,            // 0..1 cross-fade from prev colours to new
    trails: [],             // past positions of each centroid
  }

  // Seeded randomness for centroid initialisation: repeatable across visits,
  // but each Reset draws fresh numbers from the sequence, so you get new seeds.
  const rng = createRng(2026)

  // Bumped on every reset. An async step or play loop remembers the value it
  // started with; if it has changed when the animation finishes, the run it
  // belonged to was thrown away, so it quietly stops.
  let runId = 0

  // Tiny pub/sub so the charts can react to changes without this file knowing about them.
  const listeners = new Set()
  const emit = () => listeners.forEach((fn) => fn(state))

  // --- Rendering -------------------------------------------------------------
  // "Dirty flag" rendering: anything that changes the picture calls
  // requestRender(), and we redraw at most once per frame, only when needed.
  // GSAP's ticker is the same frame loop Lenis runs on (see scroll.js).
  let dirty = true
  const requestRender = () => {
    dirty = true
  }

  const renderer = createRenderer(els.canvas, { onResize: requestRender })

  gsap.ticker.add(() => {
    if (!dirty) return
    dirty = false
    renderer.draw({
      points: state.points,
      assignments: state.assignments,
      prevAssignments: view.prevAssignments,
      colorMix: view.colorMix,
      centroids: view.centroids,
      centroidScale: view.centroidScale,
      trails: view.trails,
      showRegions: view.centroids.length > 0,
    })
  })

  // Canvas text uses JetBrains Mono; redraw once the font has actually loaded.
  document.fonts.ready.then(requestRender)

  // --- Animation helpers -----------------------------------------------------
  /** Tween `target` with GSAP and return a Promise that resolves when it finishes. */
  function animate(target, vars) {
    return new Promise((resolve) => {
      gsap.to(target, { ...vars, onUpdate: requestRender, onComplete: resolve })
    })
  }

  /** Wait `seconds` on GSAP's clock (pauses with the tab, unlike setTimeout). */
  const wait = (seconds) => new Promise((resolve) => gsap.delayedCall(seconds, resolve))

  // --- The three half-steps --------------------------------------------------

  // 1. SEED: place K starting centroids.
  async function seed() {
    const init = state.init === 'random' ? initRandom : initPlusPlus
    state.centroids = init(state.points, state.k, rng)
    state.next = 'assign'

    view.centroids = state.centroids.map((c) => ({ x: c.x, y: c.y }))
    view.trails = state.centroids.map((c) => [{ x: c.x, y: c.y }])
    view.centroidScale = 0
    updateReadout()

    await animate(view, { centroidScale: 1, duration: TIMING.seed, ease: 'power3.out' })
  }

  // 2. ASSIGN: every point takes the colour of its nearest centroid.
  async function assign() {
    view.prevAssignments = state.assignments // null the first time, so points fade from grey
    state.assignments = assignPoints(state.points, state.centroids)
    state.inertia = computeInertia(state.points, state.centroids, state.assignments)
    state.history.push(state.inertia)
    state.next = 'update'
    updateReadout()

    view.colorMix = 0
    await animate(view, { colorMix: 1, duration: TIMING.assign, ease: 'power2.out' })
  }

  // 3. UPDATE: each centroid glides to the mean of its points.
  async function update() {
    const moved = updateCentroids(state.points, state.assignments, state.centroids)
    const converged = hasConverged(state.centroids, moved)

    state.centroids = moved
    state.iteration++
    // Inertia with the new centroids but the old assignments: already lower.
    state.inertia = computeInertia(state.points, state.centroids, state.assignments)
    state.next = converged ? 'done' : 'assign'
    if (!converged) moved.forEach((c, j) => view.trails[j].push({ x: c.x, y: c.y }))
    updateReadout()

    // Animate every on-screen centroid toward its new true position, in parallel.
    await Promise.all(
      view.centroids.map((vc, j) =>
        animate(vc, { x: moved[j].x, y: moved[j].y, duration: TIMING.update, ease: 'power3.inOut' }),
      ),
    )
  }

  // --- Step / Play / Pause / Reset --------------------------------------------

  /** Run the next half-step and wait for its animation. */
  async function step() {
    if (state.busy || state.next === 'done') return
    state.busy = true
    const myRun = runId

    if (state.next === 'seed') await seed()
    else if (state.next === 'assign') await assign()
    else await update()

    if (myRun !== runId) return // a Reset happened while we were animating
    state.busy = false
    updateReadout()
    emit()
  }

  /** Keep stepping until converged, paused, or reset. */
  async function play() {
    if (state.playing || state.next === 'done') return
    state.playing = true
    const myRun = runId
    updateReadout()

    while (state.playing && state.next !== 'done' && myRun === runId) {
      await step()
      if (state.next === 'done') break
      await wait(TIMING.pause)
    }

    if (myRun === runId) {
      state.playing = false
      updateReadout()
    }
  }

  function pause() {
    state.playing = false // the loop notices after the current step finishes
    updateReadout()
  }

  /** Throw away the current run (keeps the points). */
  function reset() {
    runId++
    gsap.killTweensOf(view)
    view.centroids.forEach((c) => gsap.killTweensOf(c))

    Object.assign(state, {
      centroids: [],
      assignments: null,
      iteration: 0,
      inertia: null,
      history: [],
      next: 'seed',
      playing: false,
      busy: false,
    })
    Object.assign(view, {
      centroids: [],
      centroidScale: 0,
      prevAssignments: null,
      colorMix: 1,
      trails: [],
    })

    updateReadout()
    requestRender()
    emit()
  }

  function loadDataset(name) {
    state.dataset = name
    state.points = DATASETS[name]({ seed: DATA_SEED })
    showNote(name)
    reset()
  }

  // --- Click to add a point ----------------------------------------------------
  function addPoint(event) {
    if (state.points.length >= MAX_POINTS) return
    const p = renderer.toData(event.clientX, event.clientY)
    state.points.push(p)

    // Mid-run: give the new point its nearest centroid straight away, and since
    // the data changed, the run is no longer converged.
    if (state.assignments) {
      const [nearest] = assignPoints([p], state.centroids)
      state.assignments.push(nearest)
      state.inertia = computeInertia(state.points, state.centroids, state.assignments)
      if (state.next === 'done') state.next = 'update'
    }

    updateReadout()
    requestRender()
    emit()
  }

  // --- Readout + note ----------------------------------------------------------
  const NEXT_LABEL = { seed: 'Seed', assign: 'Assign', update: 'Update', done: '—' }

  function updateReadout() {
    els.iteration.textContent = String(state.iteration).padStart(2, '0')
    els.inertia.textContent = state.inertia == null ? '—' : state.inertia.toFixed(3)
    els.points.textContent = state.points.length.toLocaleString()
    els.next.textContent = NEXT_LABEL[state.next]

    let status = 'Ready'
    if (state.next === 'seed') status = 'Idle'
    if (state.playing) status = 'Running'
    if (state.next === 'done') status = 'Converged'
    els.status.textContent = status
    els.status.dataset.state = status.toLowerCase()

    els.play.textContent = state.playing ? 'Pause' : 'Play'
    els.play.setAttribute('aria-pressed', String(state.playing))
    els.play.disabled = state.next === 'done'
    els.step.disabled = state.playing || state.next === 'done'
  }

  function showNote(name) {
    const { text, fails } = DATASET_NOTES[name]
    const parts = []
    if (fails) {
      const tag = document.createElement('span')
      tag.className = 'note__tag'
      tag.textContent = 'Where K-means fails. '
      parts.push(tag)
    }
    parts.push(text)
    els.note.replaceChildren(...parts)
  }

  // --- Wire up the controls ------------------------------------------------------
  els.kSlider.addEventListener('input', () => {
    state.k = Number(els.kSlider.value)
    els.kValue.textContent = `K = ${state.k}`
    reset()
  })

  root.querySelectorAll('input[name="init"]').forEach((radio) =>
    radio.addEventListener('change', () => {
      state.init = radio.value
      reset()
    }),
  )

  root.querySelectorAll('input[name="dataset"]').forEach((radio) =>
    radio.addEventListener('change', () => loadDataset(radio.value)),
  )

  els.step.addEventListener('click', step)
  els.play.addEventListener('click', () => (state.playing ? pause() : play()))
  els.reset.addEventListener('click', reset)
  els.canvas.addEventListener('click', addPoint)

  // --- Go ----------------------------------------------------------------------
  loadDataset(root.querySelector('input[name="dataset"]:checked').value)

  return {
    state,
    onChange: (fn) => listeners.add(fn),
  }
}
