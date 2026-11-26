// charts.js
// Two small line charts, drawn by hand on <canvas> (no chart library):
//
//   Fig. 03  inertia per iteration  - follows the playground live
//   Fig. 04  the elbow              - inertia for K = 1..8 on the playground's data
//
// Both use createLineChart() below. It handles axes, "nice" tick values,
// the line, markers, highlighted points and a hover crosshair. Each chart also
// fills a small data table (inside <details>), so the numbers are available as
// text, not only as pixels.

import gsap from 'gsap'
import { runToConvergence } from './kmeans.js'
import { createRng } from './data.js'
import { setupHiDPICanvas, readPalette } from './renderer.js'
import { reduceMotion } from './scroll.js'

const FONT = '10px "JetBrains Mono", ui-monospace, monospace'
const MAX_K = 8

// ---------------------------------------------------------------------------
// Axis maths
// ---------------------------------------------------------------------------

/**
 * A "nice" tick step: 1, 2, 2.5 or 5 times a power of ten, chosen so that
 * about `count` steps cover `range`. People read 0 / 0.5 / 1.0 / 1.5 easily;
 * they don't read 0 / 0.437 / 0.874.
 *
 *   niceStep(17.3, 4)  -> 5      (ticks 0, 5, 10, 15, 20)
 *   niceStep(1.46, 4)  -> 0.5    (ticks 0, 0.5, 1, 1.5)
 */
export function niceStep(range, count = 4) {
  if (!(range > 0)) return 1
  const raw = range / count
  const magnitude = 10 ** Math.floor(Math.log10(raw)) // e.g. raw 0.37 -> 0.1
  const n = raw / magnitude                            // now between 1 and 10
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return nice * magnitude
}

/** Format a tick value without floating-point noise (0.30000000000000004 -> "0.3"). */
const formatTick = (v) => String(+v.toFixed(3))

/**
 * Find the elbow: the point that sits farthest below the straight line (the
 * "chord") from the first point to the last, with both axes scaled to 0..1.
 * This is the idea behind the Kneedle method.
 *
 * One twist: we measure on log(inertia), not inertia. Inertia tends to fall by a
 * FRACTION per extra cluster, so on a log scale "adding a cluster stops helping"
 * shows up as a sharp bend. On the raw scale, the huge first drop (K=1 to 2)
 * dominates and the bend lands one K too early. (On Blobs, raw scores K=3 0.550
 * vs K=4 0.546, a coin-flip; log scores K=4 0.42, a clear winner.)
 *
 * @returns {{ index: number, strength: number }}
 *   index:    position of the bend in `values` (-1 if there are too few values)
 *   strength: how far below the chord it sits (0..1). Under about 0.3 the curve
 *             is a smooth slope with no real elbow, so we say so instead of
 *             pretending there's a right answer.
 */
export function findElbow(values) {
  if (values.length < 3) return { index: -1, strength: 0 }
  const logs = values.map((v) => Math.log(Math.max(v, 1e-12))) // guard log(0)
  const n = logs.length - 1
  const top = logs[0]
  const bottom = logs[n]
  const span = top - bottom || 1

  let index = -1
  let strength = 0
  logs.forEach((v, i) => {
    const x = i / n                  // 0..1 along the K axis
    const y = (v - bottom) / span    // 0..1, so the chord runs from (0,1) to (1,0)
    const gap = 1 - x - y            // how far below the chord this point sits
    if (gap > strength) {
      strength = gap
      index = i
    }
  })
  return { index, strength }
}

const CLEAR_ELBOW = 0.3 // bend strength above which we call it a clear elbow

// ---------------------------------------------------------------------------
// A reusable line chart
// ---------------------------------------------------------------------------

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} labels
 * @param {string} labels.x      axis title for x ("Iteration", "K")
 * @param {string} labels.y      axis title for y ("Inertia")
 * @param {string} labels.empty  shown when there is no data yet
 */
function createLineChart(canvas, labels) {
  const palette = readPalette()
  const css = getComputedStyle(document.documentElement)
  const faint = css.getPropertyValue('--rule-faint').trim()

  let data = []        // [{ x, y }]
  let xRange = [0, 1]  // fixed x extent, so the axis doesn't jump as points arrive
  let highlights = []  // [{ index, label, accent }]
  let hoverIndex = -1
  const view = { reveal: 1 } // 0..1: how much of the line is drawn (for the draw-in)

  // Same dirty-flag pattern as the canvases: redraw at most once per frame.
  let dirty = true
  const requestDraw = () => {
    dirty = true
  }
  const { ctx, size } = setupHiDPICanvas(canvas, requestDraw)
  gsap.ticker.add(() => {
    if (!dirty) return
    dirty = false
    draw()
  })
  document.fonts.ready.then(requestDraw)

  // Space around the plot area for tick labels and axis titles.
  const M = { top: 26, right: 20, bottom: 42, left: 46 }

  function layout() {
    const plot = { x: M.left, y: M.top, w: size.width - M.left - M.right, h: size.height - M.top - M.bottom }
    const maxY = Math.max(...data.map((d) => d.y), 0)
    const yStep = niceStep(maxY, 4)
    const yMax = Math.max(yStep, Math.ceil(maxY / yStep) * yStep) // round the top up to a tick
    const [x0, x1] = xRange
    const sx = (x) => plot.x + ((x - x0) / (x1 - x0 || 1)) * plot.w
    const sy = (y) => plot.y + plot.h - (y / yMax) * plot.h
    return { plot, yStep, yMax, sx, sy }
  }

  function draw() {
    const { width, height } = size
    ctx.clearRect(0, 0, width, height)
    if (width < 50 || height < 50) return

    const { plot, yStep, yMax, sx, sy } = layout()
    ctx.font = FONT
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // --- Axis titles ---
    ctx.fillStyle = palette.ink3
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillText(labels.y.toUpperCase(), plot.x, M.top - 12)
    ctx.textAlign = 'right'
    ctx.fillText(labels.x.toUpperCase(), plot.x + plot.w, height - 6)

    // --- Horizontal gridlines + y tick labels (hairline, solid, recessive) ---
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 1
    for (let v = 0; v <= yMax + yStep / 2; v += yStep) {
      const y = Math.round(sy(v)) + 0.5 // +0.5 puts a 1px line exactly on a pixel row
      ctx.strokeStyle = v === 0 ? palette.ink : faint
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
      ctx.fillStyle = palette.ink3
      ctx.textAlign = 'right'
      ctx.fillText(formatTick(v), plot.x - 8, y)
    }

    // --- X tick labels (whole numbers; one per ~40px, thinned out if crowded) ---
    const [x0, x1] = xRange
    const maxTicks = Math.max(2, Math.floor(plot.w / 40))
    const xStep = Math.max(1, Math.ceil(niceStep(x1 - x0, maxTicks)))
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (let v = Math.ceil(x0); v <= x1; v += xStep) {
      ctx.fillStyle = palette.ink3
      ctx.fillText(String(v), sx(v), plot.y + plot.h + 8)
    }

    if (data.length === 0) {
      ctx.fillStyle = palette.ink3
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(labels.empty.toUpperCase(), plot.x + plot.w / 2, plot.y + plot.h / 2)
      return
    }

    // --- The line (clipped from the left, so it can "draw in") ---
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, plot.x + plot.w * view.reveal + 1, height)
    ctx.clip()

    ctx.strokeStyle = palette.ink
    ctx.lineWidth = 2
    ctx.beginPath()
    data.forEach((d, i) => (i === 0 ? ctx.moveTo(sx(d.x), sy(d.y)) : ctx.lineTo(sx(d.x), sy(d.y))))
    ctx.stroke()

    // --- Markers: only when there's room between them, so they don't merge ---
    const gap = data.length > 1 ? sx(data[1].x) - sx(data[0].x) : Infinity
    if (gap >= 12) data.forEach((d) => marker(sx(d.x), sy(d.y), 3.5, palette.ink))
    ctx.restore()

    // --- Highlighted points, with a label above (or below, near the top edge) ---
    if (view.reveal >= 1) {
      for (const h of highlights) {
        const d = data[h.index]
        if (!d) continue
        const x = sx(d.x)
        const y = sy(d.y)
        marker(x, y, 4.5, h.accent ? palette.clusters[0] : palette.ink)
        label(h.label, x, y, plot)
      }
    }

    // --- Hover: crosshair + tooltip ---
    if (hoverIndex >= 0 && data[hoverIndex]) {
      const d = data[hoverIndex]
      const x = Math.round(sx(d.x)) + 0.5
      ctx.strokeStyle = palette.ink3
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, plot.y)
      ctx.lineTo(x, plot.y + plot.h)
      ctx.stroke()
      marker(sx(d.x), sy(d.y), 5, palette.ink)
      tooltip([`${labels.x} ${d.x}`, `${labels.y} ${d.y.toFixed(3)}`], sx(d.x), sy(d.y), plot)
    }
  }

  /** A filled dot with a 2px paper-coloured ring, so it stays legible on top of the line. */
  function marker(x, y, r, fill) {
    ctx.fillStyle = palette.paper
    ctx.beginPath()
    ctx.arc(x, y, r + 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  /**
   * A short text label next to a point. Both charts fall from left to right, so
   * the empty space is above and to the RIGHT of each point (the line continues
   * below it). Near the right edge, the label flips to the left instead.
   * Measured first, so it is never clipped.
   */
  function label(text, x, y, plot) {
    ctx.font = FONT
    const w = ctx.measureText(text).width
    const fitsRight = x + 10 + w <= plot.x + plot.w
    ctx.fillStyle = palette.ink
    ctx.textAlign = fitsRight ? 'left' : 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(text, fitsRight ? x + 9 : x - 9, Math.max(y - 9, plot.y + 12))
  }

  /** A small boxed tooltip, flipped to the left if it would run off the right edge. */
  function tooltip(lines, x, y, plot) {
    ctx.font = FONT
    const pad = 7
    const lineH = 14
    const w = Math.max(...lines.map((l) => ctx.measureText(l.toUpperCase()).width)) + pad * 2
    const h = lines.length * lineH + pad * 2 - 4
    let bx = x + 12
    if (bx + w > plot.x + plot.w) bx = x - 12 - w
    const by = Math.min(Math.max(y - h / 2, plot.y), plot.y + plot.h - h)

    ctx.fillStyle = palette.paper
    ctx.strokeStyle = palette.ink
    ctx.lineWidth = 1
    ctx.fillRect(bx, by, w, h)
    ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(w), Math.round(h))
    ctx.fillStyle = palette.ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    lines.forEach((l, i) => ctx.fillText(l.toUpperCase(), bx + pad, by + pad + i * lineH))
  }

  // --- Hover tracking: snap to the nearest point along x -----------------------
  canvas.addEventListener('pointermove', (e) => {
    if (data.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const px = e.clientX - rect.left
    const { sx } = layout()
    let nearest = 0
    data.forEach((d, i) => {
      if (Math.abs(sx(d.x) - px) < Math.abs(sx(data[nearest].x) - px)) nearest = i
    })
    if (nearest !== hoverIndex) {
      hoverIndex = nearest
      requestDraw()
    }
  })
  canvas.addEventListener('pointerleave', () => {
    hoverIndex = -1
    requestDraw()
  })

  return {
    /** Replace the data. `animate` draws the line in from left to right. */
    setData(next, { x: range, highlight = [], animate = false } = {}) {
      data = next
      xRange = range
      highlights = highlight
      if (hoverIndex >= data.length) hoverIndex = -1
      if (animate && !reduceMotion) {
        gsap.fromTo(view, { reveal: 0 }, { reveal: 1, duration: 0.9, ease: 'power2.out', overwrite: true, onUpdate: requestDraw })
      } else {
        view.reveal = 1
      }
      requestDraw()
    },
    /** Change only the highlighted points (no new data). */
    setHighlights(next) {
      highlights = next
      requestDraw()
    },
  }
}

/** Fill a <tbody> with rows of text cells. */
function fillTable(tbody, rows) {
  tbody.replaceChildren(
    ...rows.map((cells) => {
      const tr = document.createElement('tr')
      cells.forEach((text) => {
        const td = document.createElement('td')
        td.textContent = text
        tr.append(td)
      })
      return tr
    }),
  )
}

// ---------------------------------------------------------------------------
// The two charts
// ---------------------------------------------------------------------------

/**
 * Wire both charts to the playground.
 * @param {{ state: object, onChange: Function }} playground  from initPlayground()
 */
export function initCharts(playground) {
  const $ = (sel) => document.querySelector(sel)

  // --- Fig. 03: inertia per iteration ----------------------------------------
  const inertiaChart = createLineChart($('#inertia-chart'), {
    x: 'Iteration',
    y: 'Inertia',
    empty: 'Press Step or Play in the playground',
  })
  const inertiaReadout = $('#inertia-readout')
  const inertiaTable = $('#inertia-table tbody')

  function updateInertia(state) {
    const history = state.history
    const data = history.map((y, x) => ({ x, y }))
    const last = data.length - 1
    // Keep at least 0..5 on the x axis, so the first few points don't fill the whole width.
    inertiaChart.setData(data, {
      x: [0, Math.max(5, last)],
      highlight: last >= 0 ? [{ index: last, label: history[last].toFixed(3), accent: true }] : [],
    })

    if (last < 0) {
      inertiaReadout.textContent = 'No run yet'
    } else {
      const drop = last > 0 ? Math.round((1 - history[last] / history[0]) * 100) : 0
      inertiaReadout.textContent = `${history[0].toFixed(3)} → ${history[last].toFixed(3)}${last > 0 ? ` / −${drop}%` : ''}`
    }
    fillTable(inertiaTable, history.map((v, i) => [String(i), v.toFixed(3)]))
  }

  // --- Fig. 04: the elbow --------------------------------------------------------
  const elbowChart = createLineChart($('#elbow-chart'), {
    x: 'K',
    y: 'Inertia',
    empty: 'Computing',
  })
  const elbowReadout = $('#elbow-readout')
  const elbowTable = $('#elbow-table tbody')
  let elbow = { values: [], bend: -1, clear: false }

  /**
   * Run K-means for K = 1..8 on the current points. Each K gets the best of 3
   * K-means++ runs (like scikit-learn's n_init), so one unlucky start doesn't put
   * a bump in the curve. A fixed seed means the same data always gives the same curve.
   */
  function computeElbow(points) {
    const rng = createRng(1)
    const values = []
    for (let k = 1; k <= MAX_K; k++) {
      let best = Infinity
      for (let run = 0; run < 3; run++) {
        best = Math.min(best, runToConvergence(points, k, { rng }).inertia)
      }
      values.push(best)
    }
    const { index, strength } = findElbow(values)
    return { values, bend: index, clear: strength >= CLEAR_ELBOW }
  }

  // Two labelled points at most: the bend, and the K chosen in the playground.
  function elbowHighlights(k) {
    const list = []
    const bendName = elbow.clear ? 'Elbow' : 'Weak bend'
    if (elbow.bend >= 0) list.push({ index: elbow.bend, label: `${bendName}: K = ${elbow.bend + 1}`, accent: false })
    if (k - 1 === elbow.bend) list[0] = { ...list[0], label: `${bendName} = your K`, accent: true }
    else list.push({ index: k - 1, label: `Your K = ${k}`, accent: true })
    return list
  }

  function updateElbowHighlight(k) {
    elbowChart.setHighlights(elbowHighlights(k))
    if (elbow.bend < 0) return
    elbowReadout.textContent = elbow.clear
      ? `Clear elbow at K = ${elbow.bend + 1} / your K = ${k}`
      : `No clear elbow / your K = ${k}`
  }

  // Recompute only when the DATA changes (new dataset or clicked points),
  // not on every step. Debounced: a burst of clicks triggers one recompute.
  let lastPoints = null
  let lastCount = -1
  let pending = null

  function maybeRecomputeElbow(state) {
    if (state.points === lastPoints && state.points.length === lastCount) {
      updateElbowHighlight(state.k) // only K changed: just move the highlight
      return
    }
    lastPoints = state.points
    lastCount = state.points.length
    pending?.kill()
    pending = gsap.delayedCall(0.2, () => {
      elbow = computeElbow(state.points)
      elbowChart.setData(
        elbow.values.map((y, i) => ({ x: i + 1, y })),
        { x: [1, MAX_K], highlight: elbowHighlights(state.k), animate: true },
      )
      updateElbowHighlight(state.k)
      fillTable(elbowTable, elbow.values.map((v, i) => [String(i + 1), v.toFixed(3)]))
    })
  }

  // --- Follow the playground ---------------------------------------------------------
  const onChange = (state) => {
    updateInertia(state)
    maybeRecomputeElbow(state)
  }
  playground.onChange(onChange)
  onChange(playground.state)
}
