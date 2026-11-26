// renderer.js
// Everything that draws onto a <canvas>. It knows nothing about K-means state
// machines or buttons. It gets handed a plain "scene" object and draws it.
//
//   const r = createRenderer(canvasEl)
//   r.draw({ points, assignments, centroids, ... })
//   r.toData(clientX, clientY)   // screen position -> data space
//
// Two coordinate systems are involved:
//   data space   points live in roughly [0, 1] x [0, 1] (see data.js)
//   CSS pixels   positions on the canvas as laid out on the page
// The "projection" converts between them. We keep the data square (one unit
// in x is the same length on screen as one unit in y) so distances look right:
// a circle of points stays a circle, and "nearest centroid" looks nearest.

/**
 * Read the cluster palette and ink colours from the CSS custom properties,
 * so style.css stays the single source of truth for colours.
 */
export function readPalette() {
  const css = getComputedStyle(document.documentElement)
  const v = (name) => css.getPropertyValue(name).trim()
  return {
    paper: v('--paper'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    clusters: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--c${i}`)),
  }
}

/** "#b5432c" -> [181, 67, 44]. Needed when writing raw pixels into ImageData. */
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Make a canvas sharp on high-DPI ("retina") screens, and keep it that way
 * as it resizes. Shared by the scatter renderer below and the charts.
 *
 * A canvas has two sizes:
 *   - its CSS size (how big it looks), set by the stylesheet
 *   - its pixel buffer (canvas.width/height), how many pixels it actually stores
 * On a screen with devicePixelRatio 2, one CSS pixel is 2x2 physical pixels.
 * If the buffer only matched the CSS size, the browser would stretch it and
 * everything would look blurry. So we make the buffer dpr times bigger, then
 * scale the drawing context by dpr, and keep drawing in CSS pixel units.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {(size: {width: number, height: number}) => void} onResize  called after every resize
 * @returns {{ ctx: CanvasRenderingContext2D, size: {width: number, height: number} }}
 */
export function setupHiDPICanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d')
  const size = { width: 0, height: 0 } // in CSS pixels; updated in place on resize

  function resize() {
    const rect = canvas.getBoundingClientRect()
    // Cap at 2: a 3x phone screen would cost 2.25x the pixels for almost no visible gain.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    size.width = rect.width
    size.height = rect.height
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // from now on, 1 unit = 1 CSS pixel
    onResize(size)
  }

  // ResizeObserver fires whenever the element's size changes: window resizes,
  // layout shifts, orientation changes. More reliable than window 'resize'.
  new ResizeObserver(resize).observe(canvas)
  resize()

  return { ctx, size }
}

/**
 * Create a renderer for one canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {Function} [options.onResize]  called after the canvas changes size (redraw there)
 * @param {number}   [options.padding]   empty margin around the data square, as a fraction
 * @param {'contain'|'cover'} [options.fit]
 *   'contain' (default): the whole data square is visible, centred.
 *   'cover': the data square fills the canvas and its edges may be cropped,
 *   like CSS background-size: cover. Used by the full-width hero. Call bounds()
 *   to find which part of data space is actually on screen.
 */
export function createRenderer(canvas, { onResize, padding = 0.07, fit = 'contain' } = {}) {
  let palette = readPalette()

  // Current size in CSS pixels, plus the projection derived from it.
  let width = 0
  let height = 0
  let side = 0 // length of the data square's edge, in CSS pixels
  let originX = 0
  let originY = 0

  const { ctx } = setupHiDPICanvas(canvas, (size) => {
    width = size.width
    height = size.height

    // Fit the data square to the canvas, centred, with padding.
    // contain: square edge = the SHORTER canvas side; cover: the LONGER one.
    const base = fit === 'cover' ? Math.max(width, height) : Math.min(width, height)
    side = base * (1 - 2 * padding)
    originX = (width - side) / 2
    originY = (height - side) / 2

    onResize?.()
  })

  // --- Projection ------------------------------------------------------------
  const toPixel = (p) => ({ x: originX + p.x * side, y: originY + p.y * side })

  /** The rectangle of data space currently visible on the canvas. */
  const bounds = () => ({
    minX: -originX / side,
    maxX: (width - originX) / side,
    minY: -originY / side,
    maxY: (height - originY) / side,
  })

  /** Convert a mouse/touch position (clientX/clientY) into data space. */
  function toData(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - originX) / side,
      y: (clientY - rect.top - originY) / side,
    }
  }

  // --- Decision regions ------------------------------------------------------
  // Tint the background by "which centroid is nearest here". The boundaries
  // between tints are always straight lines (each one is the perpendicular
  // bisector between two centroids). That is exactly why K-means can't follow
  // curved shapes like the Moons dataset.
  //
  // Doing this per screen pixel would be slow, so we compute a coarse grid
  // (one cell per CELL css pixels) into a small offscreen canvas, then let
  // drawImage scale it up. Image smoothing softens the blocky cell edges.
  const CELL = 3
  const REGION_ALPHA = 26 // out of 255, a faint wash
  const offscreen = document.createElement('canvas')
  const offCtx = offscreen.getContext('2d')

  function drawRegions(centroids, strength = 1) {
    const cols = Math.ceil(width / CELL)
    const rows = Math.ceil(height / CELL)
    if (cols === 0 || rows === 0) return
    if (offscreen.width !== cols || offscreen.height !== rows) {
      offscreen.width = cols
      offscreen.height = rows
    }

    const rgb = palette.clusters.map(hexToRgb)
    const image = offCtx.createImageData(cols, rows)
    const data = image.data // flat array: [r, g, b, a, r, g, b, a, ...]

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Centre of this cell, converted to data space.
        const dx = ((col + 0.5) * CELL - originX) / side
        const dy = ((row + 0.5) * CELL - originY) / side

        // Nearest centroid (same rule as assignPoints, inlined for speed).
        let best = 0
        let bestDist = Infinity
        for (let j = 0; j < centroids.length; j++) {
          const ex = dx - centroids[j].x
          const ey = dy - centroids[j].y
          const d = ex * ex + ey * ey
          if (d < bestDist) {
            bestDist = d
            best = j
          }
        }

        const i = (row * cols + col) * 4
        const [r, g, b] = rgb[best % rgb.length]
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = REGION_ALPHA
      }
    }

    offCtx.putImageData(image, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.globalAlpha = strength // lets the story fade the regions in
    ctx.drawImage(offscreen, 0, 0, cols * CELL, rows * CELL)
    ctx.globalAlpha = 1
  }

  // --- Assignment links ------------------------------------------------------
  // A thin ink line from each point toward the centroid it belongs to.
  // `progress` (0 to 1) is how far along the line has been drawn, so animating
  // it makes the lines "grow" out of the points. Used by the scroll story.
  function drawLinks(points, assignments, centroids, progress, alpha) {
    if (progress <= 0 || alpha <= 0 || !assignments) return
    ctx.save()
    ctx.strokeStyle = palette.ink
    ctx.lineWidth = 0.75
    ctx.globalAlpha = 0.35 * alpha
    ctx.beginPath() // one path for every line: a single stroke() is much faster than hundreds
    for (let i = 0; i < points.length; i++) {
      const c = centroids[assignments[i]]
      if (!c) continue
      const a = toPixel(points[i])
      const b = toPixel(c)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(a.x + (b.x - a.x) * progress, a.y + (b.y - a.y) * progress)
    }
    ctx.stroke()
    ctx.restore()
  }

  // --- Centroid trails -------------------------------------------------------
  // A dashed line through every past position of each centroid, so you can see
  // the path it took while converging.
  function drawTrails(trails) {
    ctx.save()
    ctx.lineWidth = 1
    ctx.globalAlpha = 0.75
    ctx.fillStyle = palette.paper

    trails.forEach((trail, j) => {
      if (trail.length < 2) return
      ctx.strokeStyle = palette.clusters[j % palette.clusters.length]

      // The dashed path.
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      trail.forEach((p, i) => {
        const { x, y } = toPixel(p)
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // A small hollow circle at each past position (not the current one).
      ctx.setLineDash([])
      for (let i = 0; i < trail.length - 1; i++) {
        const { x, y } = toPixel(trail[i])
        ctx.beginPath()
        ctx.arc(x, y, 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    })
    ctx.restore()
  }

  // --- Points ----------------------------------------------------------------
  // Each point is drawn in its previous colour, then its new colour on top at
  // opacity `colorMix`. Animating colorMix from 0 to 1 cross-fades the colours.
  // Points with no cluster yet (index -1 or no assignments) are drawn in grey ink.
  // `opacity` is either one number for every point, or an array with one value per point.
  function drawPoints(points, assignments, prevAssignments, colorMix, opacity = 1) {
    const perPoint = Array.isArray(opacity)
    const radius = width < 480 ? 2.2 : 2.7
    const colourOf = (index) =>
      index == null || index < 0 ? palette.ink2 : palette.clusters[index % palette.clusters.length]

    for (let i = 0; i < points.length; i++) {
      const alpha = perPoint ? opacity[i] : opacity
      if (alpha <= 0) continue

      const { x, y } = toPixel(points[i])
      const before = colourOf(prevAssignments?.[i])
      const after = colourOf(assignments?.[i])

      ctx.globalAlpha = alpha
      ctx.fillStyle = before
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, Math.PI * 2)
      ctx.fill()

      if (after !== before && colorMix > 0) {
        ctx.globalAlpha = colorMix * alpha
        ctx.fillStyle = after
        ctx.fill() // same path, new colour on top
      }
    }
    ctx.globalAlpha = 1
  }

  // --- Centroids -------------------------------------------------------------
  // A coloured disc with an ink outline, crosshair ticks, and a "C1"-style label.
  // `scale` (0 to 1) lets them grow in when first placed.
  function drawCentroids(centroids, scale = 1, labels = true) {
    if (scale <= 0) return
    ctx.save()
    ctx.font = '500 10px "JetBrains Mono", ui-monospace, monospace'
    ctx.textBaseline = 'middle'

    centroids.forEach((c, j) => {
      const { x, y } = toPixel(c)
      const r = 6.5 * scale
      const tick = 13 * scale

      // Crosshair
      ctx.strokeStyle = palette.ink
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x - tick, y)
      ctx.lineTo(x - r - 2, y)
      ctx.moveTo(x + r + 2, y)
      ctx.lineTo(x + tick, y)
      ctx.moveTo(x, y - tick)
      ctx.lineTo(x, y - r - 2)
      ctx.moveTo(x, y + r + 2)
      ctx.lineTo(x, y + tick)
      ctx.stroke()

      // Disc
      ctx.fillStyle = palette.clusters[j % palette.clusters.length]
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()

      // Label, fading in with the scale
      if (labels) {
        ctx.globalAlpha = scale
        ctx.fillStyle = palette.ink
        ctx.fillText(`C${j + 1}`, x + tick + 3, y - tick + 3)
        ctx.globalAlpha = 1
      }
    })
    ctx.restore()
  }

  /**
   * Draw a full frame. Every field is optional except `points`.
   *
   * @param {object} scene
   * @param {Array<{x,y}>}  scene.points
   * @param {Array<number>} [scene.assignments]      current cluster of each point
   * @param {Array<number>} [scene.prevAssignments]  cluster before the last assign step
   * @param {number}        [scene.colorMix=1]       0..1 cross-fade from prev to current colours
   * @param {Array<{x,y}>}  [scene.centroids]        positions to draw (may be mid-animation)
   * @param {number}        [scene.centroidScale=1]  0..1 grow-in for centroids
   * @param {Array<Array<{x,y}>>} [scene.trails]     past positions per centroid
   * @param {boolean}       [scene.showRegions]      tint the nearest-centroid regions
   * @param {number}        [scene.regionStrength=1] 0..1 fade for the region tint
   * @param {number|Array<number>} [scene.pointOpacity=1]  0..1 fade, for all points or per point
   * @param {{progress:number, alpha:number}} [scene.links]  point-to-centroid lines
   * @param {boolean}       [scene.labels=true]      draw "C1", "C2"... next to centroids
   */
  function draw(scene) {
    ctx.clearRect(0, 0, width, height)
    const { points, assignments, prevAssignments, colorMix = 1 } = scene
    const centroids = scene.centroids ?? []

    if (scene.showRegions && centroids.length > 0) drawRegions(centroids, scene.regionStrength ?? 1)
    if (scene.trails) drawTrails(scene.trails)
    if (scene.links) drawLinks(points, assignments, centroids, scene.links.progress, scene.links.alpha)
    drawPoints(points, assignments, prevAssignments, colorMix, scene.pointOpacity ?? 1)
    drawCentroids(centroids, scene.centroidScale ?? 1, scene.labels ?? true)
  }

  return {
    draw,
    toData,
    bounds,
    /** Re-read colours from CSS (e.g. if the theme changes). */
    refreshPalette: () => (palette = readPalette()),
  }
}
