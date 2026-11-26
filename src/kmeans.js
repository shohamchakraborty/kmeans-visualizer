// kmeans.js
// The K-means algorithm, written from scratch. Pure functions only:
// no DOM, no canvas, no globals. Everything comes in as arguments and
// goes out as return values, which makes it easy to test and to reuse
// in the playground, the scroll story and the elbow chart.
//
// Data shapes used throughout:
//   point       { x: number, y: number }
//   points      Array<point>                 the dataset, length n
//   centroids   Array<point>                 one per cluster, length k
//   assignments Array<number>                length n; assignments[i] is the
//                                            index (0..k-1) of the centroid
//                                            that points[i] belongs to
//   rng         () => number in [0, 1)       a random source; pass a seeded one
//                                            (createRng in data.js) for repeatable runs
//
// The algorithm (Lloyd's algorithm):
//   1. Initialise: choose k starting centroids          initRandom / initPlusPlus
//   2. Assign:     each point joins its nearest centroid  assignPoints
//   3. Update:     each centroid moves to its points' mean updateCentroids
//   4. Repeat 2-3 until the centroids stop moving        hasConverged
//
// Why it always stops: inertia (see computeInertia) never goes up. The assign
// step picks the closest centroid for every point, and the update step puts
// each centroid at the spot that minimises squared distance to its points (the
// mean). There are only finitely many ways to split n points into k groups, and
// inertia never increases, so the algorithm can't cycle forever.

/**
 * Squared Euclidean distance between two points: (dx² + dy²).
 *
 * We skip the square root on purpose. sqrt is slow-ish, and it doesn't change
 * which distance is smaller (if a² < b² and both are positive, then a < b).
 * Inertia is also defined with squared distances, so this is exactly what we need.
 */
export function squaredDistance(a, b) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * INITIALISATION, RANDOM (the "Forgy" method).
 * Pick k different points from the data, uniformly at random, and use copies
 * of them as the starting centroids.
 *
 * Starting on real data points guarantees every centroid begins next to at
 * least one point. The weakness: two seeds can land in the same true cluster,
 * and K-means may then get stuck in a poor local minimum.
 *
 * @returns {Array<point>} k new centroid objects (copies, not the original points)
 */
export function initRandom(points, k, rng = Math.random) {
  const count = Math.min(k, points.length) // can't pick more distinct points than exist

  // Partial Fisher–Yates shuffle: shuffle just the first `count` slots of an
  // index list. Each pick swaps a random not-yet-chosen index into position i,
  // so no point is chosen twice.
  const indices = points.map((_, i) => i)
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (indices.length - i))
    ;[indices[i], indices[j]] = [indices[j], indices[i]]
  }

  return indices.slice(0, count).map((i) => ({ x: points[i].x, y: points[i].y }))
}

/**
 * INITIALISATION, K-MEANS++ (Arthur & Vassilvitskii, 2007).
 * Spread the starting centroids out, so they're likely to land in different clusters:
 *   1. Pick the first centroid uniformly at random from the data.
 *   2. For every point, let D(x) = distance to the NEAREST centroid chosen so far.
 *   3. Pick the next centroid at random, with probability proportional to D(x)².
 *      Far-away points are much more likely to be picked; points sitting on an
 *      existing centroid (D = 0) can never be picked.
 *   4. Repeat 2-3 until there are k centroids.
 *
 * It costs one extra pass over the data per centroid, but usually converges in
 * fewer iterations to a better answer.
 *
 * @returns {Array<point>} k new centroid objects
 */
export function initPlusPlus(points, k, rng = Math.random) {
  const count = Math.min(k, points.length)
  if (count === 0) return []

  // Step 1: the first centroid is a uniformly random data point.
  const first = points[Math.floor(rng() * points.length)]
  const centroids = [{ x: first.x, y: first.y }]

  // nearest[i] holds D(x)² for point i: squared distance to its closest centroid
  // so far. We update it each time a centroid is added, instead of recomputing
  // against every centroid from scratch.
  const nearest = points.map((p) => squaredDistance(p, first))

  while (centroids.length < count) {
    // Step 3: weighted random pick. Imagine laying the D² values end to end on a
    // number line of length `total`, throwing a dart at a random spot, and taking
    // whichever point's segment it lands in. Bigger D² = longer segment = more likely.
    const total = nearest.reduce((sum, d) => sum + d, 0)

    let chosen
    if (total === 0) {
      // Every point already sits exactly on a centroid (e.g. duplicate points).
      // Nothing is "far", so fall back to a uniform pick.
      chosen = Math.floor(rng() * points.length)
    } else {
      let dart = rng() * total
      chosen = points.length - 1 // fallback in case floating-point rounding overshoots
      for (let i = 0; i < points.length; i++) {
        dart -= nearest[i]
        if (dart < 0) {
          chosen = i
          break
        }
      }
    }

    const c = { x: points[chosen].x, y: points[chosen].y }
    centroids.push(c)

    // Step 2 again: the new centroid may now be the nearest one for some points.
    for (let i = 0; i < points.length; i++) {
      const d = squaredDistance(points[i], c)
      if (d < nearest[i]) nearest[i] = d
    }
  }

  return centroids
}

/**
 * ASSIGN STEP. >>> YOUR TURN <<<
 *
 * For every point, find the index of the centroid closest to it.
 *
 * Contract (the console tests check each of these):
 *   - Returns a NEW array of length points.length. Entry i is an integer in
 *     0..centroids.length-1: the index of the centroid nearest to points[i].
 *   - "Nearest" = smallest squaredDistance (helper above).
 *   - Ties: if two centroids are exactly equally close, pick the LOWER index.
 *   - Must not modify `points` or `centroids`.
 *
 * Think about: how many distance calculations does this do in total, in terms
 * of n (points) and k (centroids)? An interviewer will likely ask.
 *
 * @param {Array<point>} points
 * @param {Array<point>} centroids
 * @returns {Array<number>} assignments
 */
export function assignPoints(points, centroids) {
  const assignments = []

  for (let i = 0; i < points.length; i++) {
    let bestIndex = 0
    let bestDist = Infinity

    for (let j = 0; j < centroids.length; j++) {
      const d = squaredDistance(points[i], centroids[j])
      if (d < bestDist) {
        bestDist = d
        bestIndex = j
      }
    }

    assignments.push(bestIndex)
  }

  return assignments
}

/**
 * UPDATE STEP. >>> YOUR TURN <<<
 *
 * Move each centroid to the mean (average position) of the points assigned to it.
 *
 * Contract (the console tests check each of these):
 *   - Returns a NEW array with the same length as `centroids`.
 *   - Entry j is { x: mean x of points in cluster j, y: mean y of points in cluster j }.
 *   - EMPTY CLUSTER: if no point is assigned to cluster j, entry j is a copy of
 *     the old centroids[j] (it just stays where it was). This is why the old
 *     centroids are passed in. Without that rule you'd divide by zero and get NaN.
 *   - Must not modify `points`, `assignments` or `centroids`.
 *
 * Hint: it can be done in one pass over the points, plus one pass over the clusters.
 *
 * @param {Array<point>} points
 * @param {Array<number>} assignments  output of assignPoints
 * @param {Array<point>} centroids      the current centroids (for k, and empty clusters)
 * @returns {Array<point>} new centroids
 */
export function updateCentroids(points, assignments, centroids) {
  const k = centroids.length
  const sumX = new Array(k).fill(0)
  const sumY = new Array(k).fill(0)
  const count = new Array(k).fill(0)

  for (let i = 0; i < points.length; i++) {
    const c = assignments[i]
    sumX[c] += points[i].x
    sumY[c] += points[i].y
    count[c] += 1
  }

  return centroids.map((old, j) => {
    if (count[j] === 0) {
      return { x: old.x, y: old.y }
    }
    return { x: sumX[j] / count[j], y: sumY[j] / count[j] }
  })
}

/**
 * INERTIA, also called WCSS (within-cluster sum of squares).
 * The sum, over all points, of the squared distance from each point to the
 * centroid it's assigned to. Lower = tighter clusters.
 *
 * It's the number K-means is trying to minimise, which is why the inertia chart
 * should only ever go down (or stay flat) from one iteration to the next.
 *
 * @returns {number}
 */
export function computeInertia(points, centroids, assignments) {
  let total = 0
  for (let i = 0; i < points.length; i++) {
    total += squaredDistance(points[i], centroids[assignments[i]])
  }
  return total
}

/**
 * CONVERGENCE CHECK.
 * True when no centroid moved by more than `tolerance` (straight-line distance)
 * between two iterations.
 *
 * Why a tolerance instead of exact equality? Means are computed with floating-point
 * maths, which can wobble in the last decimal place. A tiny tolerance says
 * "close enough counts as not moving". In data space (about 0..1), 1e-6 is far
 * smaller than a single pixel.
 *
 * (Stopping when the centroids stop moving is equivalent to stopping when no point
 * changes cluster: same assignments means same means, which means same centroids.)
 *
 * @param {Array<point>} oldCentroids
 * @param {Array<point>} newCentroids
 * @param {number} tolerance
 * @returns {boolean}
 */
export function hasConverged(oldCentroids, newCentroids, tolerance = 1e-6) {
  if (oldCentroids.length !== newCentroids.length) return false
  const tolSq = tolerance * tolerance // compare squared values, so no sqrt needed
  return oldCentroids.every((c, j) => squaredDistance(c, newCentroids[j]) <= tolSq)
}

/**
 * RUN THE WHOLE ALGORITHM. Initialise, then assign/update until converged.
 * Used for the elbow chart and anywhere we just want the final answer.
 * (The playground calls the individual steps itself, so it can animate each one.)
 *
 * @param {Array<point>} points
 * @param {number} k
 * @param {object}   [options]
 * @param {'random'|'plusplus'} [options.init='plusplus']
 * @param {Function} [options.rng=Math.random]
 * @param {number}   [options.maxIterations=100]  safety net; real runs converge far sooner
 * @param {number}   [options.tolerance=1e-6]
 * @returns {{
 *   centroids: Array<point>,
 *   assignments: Array<number>,
 *   inertia: number,
 *   iterations: number,     // how many update steps ran
 *   converged: boolean,     // false only if it hit maxIterations first
 *   history: Array<number>  // inertia after the first assignment, then after each iteration
 * }}
 */
export function runToConvergence(points, k, options = {}) {
  const { init = 'plusplus', rng = Math.random, maxIterations = 100, tolerance = 1e-6 } = options

  if (points.length === 0 || k < 1) {
    return { centroids: [], assignments: [], inertia: 0, iterations: 0, converged: true, history: [] }
  }

  const initialise = init === 'random' ? initRandom : initPlusPlus
  let centroids = initialise(points, k, rng)
  let assignments = assignPoints(points, centroids)
  const history = [computeInertia(points, centroids, assignments)]

  let iterations = 0
  let converged = false

  while (iterations < maxIterations) {
    const next = updateCentroids(points, assignments, centroids)
    iterations++

    const stopped = hasConverged(centroids, next, tolerance)
    centroids = next
    if (stopped) {
      converged = true
      break
    }

    assignments = assignPoints(points, centroids)
    history.push(computeInertia(points, centroids, assignments))
  }

  return {
    centroids,
    assignments,
    inertia: history[history.length - 1],
    iterations,
    converged,
    history,
  }
}
