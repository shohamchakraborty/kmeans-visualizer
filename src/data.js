// data.js
// Dataset generators for the visualiser.
//
// Conventions used everywhere in this project:
//   - A point is a plain object { x, y }.
//   - Coordinates live in "data space": roughly the unit square [0, 1] x [0, 1],
//     with y increasing DOWNWARD (same as the canvas). The renderer scales this
//     to pixels, so the algorithm never has to know how big the screen is.
//   - Every generator takes a `seed`. Same seed, same points, every time.

// ---------------------------------------------------------------------------
// Seeded random numbers
// ---------------------------------------------------------------------------

/**
 * Create a seeded pseudo-random number generator (the "mulberry32" algorithm).
 *
 * Math.random() can't be seeded, so every page load would give different data.
 * This returns a function that behaves like Math.random() (a float in [0, 1)),
 * but produces the exact same sequence for the same seed. That makes the demo
 * reproducible and the tests deterministic.
 *
 * How it works, roughly: it keeps a 32-bit integer `state`, adds a constant to
 * it each call, then scrambles the bits with multiplies, shifts and XORs.
 * Math.imul does 32-bit integer multiplication (normal * would use floats).
 */
export function createRng(seed = 1) {
  let state = seed >>> 0 // force to an unsigned 32-bit integer
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296 // divide by 2^32 -> [0, 1)
  }
}

/**
 * A normally distributed random number (mean 0, standard deviation 1),
 * using the Box–Muller transform: two uniform numbers in, one bell-curve number out.
 */
export function gaussian(rng) {
  // 1 - rng() is in (0, 1], so Math.log never sees 0 (log(0) = -Infinity).
  const u1 = 1 - rng()
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Blobs: `centers` round Gaussian clusters. The easy case K-means was made for.
 * Cluster centres are placed randomly, but at least `minGap` apart so the
 * blobs don't overlap into one.
 */
export function blobs({ n = 240, centers = 4, spread = 0.055, seed = 7 } = {}) {
  const rng = createRng(seed)
  const minGap = 0.26

  // Pick centres inside [0.2, 0.8] so blobs (about 3 x spread wide) stay on-screen.
  const centres = []
  let attempts = 0
  while (centres.length < centers && attempts < 1000) {
    attempts++
    const candidate = { x: 0.2 + rng() * 0.6, y: 0.2 + rng() * 0.6 }
    const farEnough = centres.every(
      (c) => Math.hypot(c.x - candidate.x, c.y - candidate.y) >= minGap,
    )
    // After many failed tries, accept anyway rather than loop forever.
    if (farEnough || attempts > 500) centres.push(candidate)
  }

  // Deal points out to the centres in turn, each one jittered by Gaussian noise.
  const points = []
  for (let i = 0; i < n; i++) {
    const c = centres[i % centres.length]
    points.push({
      x: c.x + gaussian(rng) * spread,
      y: c.y + gaussian(rng) * spread,
    })
  }
  return points
}

/**
 * Uniform: points spread evenly with no real structure.
 * K-means will still happily return K clusters. A good reminder that it
 * always finds *something*, whether or not the groups are real.
 */
export function uniform({ n = 240, seed = 7 } = {}) {
  const rng = createRng(seed)
  const points = []
  for (let i = 0; i < n; i++) {
    points.push({ x: 0.1 + rng() * 0.8, y: 0.1 + rng() * 0.8 })
  }
  return points
}

/**
 * Moons: two interlocking half-circles (like scikit-learn's make_moons).
 * K-means fails here: it can only draw straight boundaries between centroids,
 * so it slices each crescent in half instead of following its curve.
 */
export function moons({ n = 240, noise = 0.06, seed = 7 } = {}) {
  const rng = createRng(seed)
  const points = []
  const half = Math.floor(n / 2)

  for (let i = 0; i < n; i++) {
    // Spread points evenly along the arc, angle t from 0 to π.
    const upper = i < half
    const t = upper ? (i / half) * Math.PI : ((i - half) / (n - half)) * Math.PI

    // Raw moon coordinates (math convention, y up):
    //   upper moon: centred at (0, 0)
    //   lower moon: flipped and shifted to (1, 0.5) so the two interlock
    let x = upper ? Math.cos(t) : 1 - Math.cos(t)
    let y = upper ? Math.sin(t) : 0.5 - Math.sin(t)

    x += gaussian(rng) * noise
    y += gaussian(rng) * noise

    // Raw x spans about [-1, 2] and y about [-0.5, 1].
    // Scale both by the same factor (so the shape isn't squashed), centre it,
    // and flip y so "up" in the maths is "up" on screen.
    const s = 0.8 / 3
    points.push({ x: 0.1 + (x + 1) * s, y: 0.5 - (y - 0.25) * s })
  }
  return points
}

/**
 * Rings: a small circle inside a larger one.
 * K-means fails here too: both rings share the same centre, so the mean of
 * each "real" cluster is the same point, and distance to a centroid can't
 * tell inside from outside.
 */
export function rings({ n = 240, noise = 0.018, seed = 7 } = {}) {
  const rng = createRng(seed)
  const points = []
  const innerCount = Math.round(n * 0.35) // the inner ring is shorter, so it gets fewer points

  for (let i = 0; i < n; i++) {
    const inner = i < innerCount
    const radius = inner ? 0.14 : 0.36
    const angle = rng() * Math.PI * 2
    points.push({
      x: 0.5 + Math.cos(angle) * radius + gaussian(rng) * noise,
      y: 0.5 + Math.sin(angle) * radius + gaussian(rng) * noise,
    })
  }
  return points
}

// Look-up table so the UI can generate a dataset by name: DATASETS.moons({ seed: 3 })
export const DATASETS = { blobs, uniform, moons, rings }
