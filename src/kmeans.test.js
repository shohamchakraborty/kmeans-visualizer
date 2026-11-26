// kmeans.test.js
// A tiny, dependency-free test suite you run in the browser console:
//
//     runKmeansTests()
//
// It's only loaded by the dev server (see main.js), so it never ships in the build.
// Each test is a small, hand-checkable example. Where possible, the expected
// answer is something you can work out on paper.

import {
  squaredDistance,
  initRandom,
  initPlusPlus,
  assignPoints,
  updateCentroids,
  computeInertia,
  hasConverged,
  runToConvergence,
} from './kmeans.js'
import { createRng, DATASETS, blobs } from './data.js'

// --- minimal test harness ---------------------------------------------------

class Skip extends Error {}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function close(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps
}

function samePoint(a, b, eps = 1e-9) {
  return a && b && close(a.x, b.x, eps) && close(a.y, b.y, eps)
}

const fmt = (v) => JSON.stringify(v)

// Fails with a friendly message if a student function hasn't been written yet.
function implemented(value, name) {
  assert(value !== undefined, `${name} returned undefined. Not implemented yet?`)
  return value
}

// True once both student functions return something.
function studentCodeReady() {
  const pts = [{ x: 0, y: 0 }]
  const cs = [{ x: 0, y: 0 }]
  try {
    return assignPoints(pts, cs) !== undefined && updateCentroids(pts, [0], cs) !== undefined
  } catch {
    return true // it exists and does something; let the real tests report the error
  }
}

// --- the tests ----------------------------------------------------------------

export function runKmeansTests() {
  const results = []
  const test = (group, name, fn) => {
    try {
      fn()
      results.push({ group, name, status: 'PASS' })
    } catch (err) {
      const status = err instanceof Skip ? 'SKIP' : 'FAIL'
      results.push({ group, name, status, message: err.message })
    }
  }
  const needsStudentCode = () => {
    if (!studentCodeReady()) throw new Skip('needs assignPoints + updateCentroids')
  }

  // A line of four points: two near x=0, two near x=10. Easy to check by hand.
  const line = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 10, y: 0 },
    { x: 11, y: 0 },
  ]

  // ---- helpers ----
  test('helpers', 'squaredDistance (0,0)->(3,4) is 25', () => {
    assert(squaredDistance({ x: 0, y: 0 }, { x: 3, y: 4 }) === 25, 'expected 25')
  })

  // ---- assignPoints ----
  test('assignPoints', 'each point goes to its nearest centroid', () => {
    const got = implemented(assignPoints(line, [{ x: 0, y: 0 }, { x: 10, y: 0 }]), 'assignPoints')
    assert(fmt(got) === fmt([0, 0, 1, 1]), `expected [0,0,1,1], got ${fmt(got)}`)
  })

  test('assignPoints', 'order of centroids matters: indices follow the centroid array', () => {
    const got = implemented(assignPoints(line, [{ x: 10, y: 0 }, { x: 0, y: 0 }]), 'assignPoints')
    assert(fmt(got) === fmt([1, 1, 0, 0]), `expected [1,1,0,0], got ${fmt(got)}`)
  })

  test('assignPoints', 'ties go to the lower index', () => {
    const got = implemented(
      assignPoints([{ x: 5, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      'assignPoints',
    )
    assert(fmt(got) === '[0]', `(5,0) is equally far from both; expected [0], got ${fmt(got)}`)
  })

  test('assignPoints', 'works in 2D, not just along a line', () => {
    const pts = [{ x: 1, y: 9 }, { x: 9, y: 1 }, { x: 8, y: 8 }]
    const cs = [{ x: 0, y: 10 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    const got = implemented(assignPoints(pts, cs), 'assignPoints')
    assert(fmt(got) === fmt([0, 1, 2]), `expected [0,1,2], got ${fmt(got)}`)
  })

  test('assignPoints', 'a single centroid gets every point', () => {
    const got = implemented(assignPoints(line, [{ x: 100, y: 100 }]), 'assignPoints')
    assert(fmt(got) === fmt([0, 0, 0, 0]), `expected [0,0,0,0], got ${fmt(got)}`)
  })

  test('assignPoints', 'returns a new array and does not modify its inputs', () => {
    const pts = structuredClone(line)
    const cs = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    const before = fmt([pts, cs])
    const got = implemented(assignPoints(pts, cs), 'assignPoints')
    assert(Array.isArray(got), 'should return an array')
    assert(got.length === pts.length, `length should be ${pts.length}, got ${got.length}`)
    assert(fmt([pts, cs]) === before, 'points or centroids were modified')
  })

  // ---- updateCentroids ----
  test('updateCentroids', 'each centroid moves to the mean of its points', () => {
    const got = implemented(
      updateCentroids(line, [0, 0, 1, 1], [{ x: 0, y: 0 }, { x: 10, y: 0 }]),
      'updateCentroids',
    )
    assert(
      samePoint(got[0], { x: 0.5, y: 0 }) && samePoint(got[1], { x: 10.5, y: 0 }),
      `expected [(0.5,0),(10.5,0)], got ${fmt(got)}`,
    )
  })

  test('updateCentroids', 'mean of an uneven cluster in 2D', () => {
    // Mean of (0,0), (3,0), (0,3) is (1,1).
    const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 3 }, { x: 50, y: 50 }]
    const got = implemented(
      updateCentroids(pts, [0, 0, 0, 1], [{ x: 9, y: 9 }, { x: 0, y: 0 }]),
      'updateCentroids',
    )
    assert(samePoint(got[0], { x: 1, y: 1 }), `cluster 0: expected (1,1), got ${fmt(got[0])}`)
    assert(samePoint(got[1], { x: 50, y: 50 }), `cluster 1: expected (50,50), got ${fmt(got[1])}`)
  })

  test('updateCentroids', 'an empty cluster keeps its old position (no NaN)', () => {
    const old = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 7, y: 7 }] // nobody is assigned to cluster 2
    const got = implemented(updateCentroids(line, [0, 0, 1, 1], old), 'updateCentroids')
    assert(got.length === 3, `expected 3 centroids, got ${got.length}`)
    assert(
      Number.isFinite(got[2]?.x) && Number.isFinite(got[2]?.y),
      `cluster 2 became ${fmt(got[2])}. Did you divide by zero?`,
    )
    assert(samePoint(got[2], { x: 7, y: 7 }), `expected (7,7), got ${fmt(got[2])}`)
  })

  test('updateCentroids', 'returns new objects and does not modify its inputs', () => {
    const pts = structuredClone(line)
    const asg = [0, 0, 1, 1]
    const old = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 7, y: 7 }]
    const before = fmt([pts, asg, old])
    const got = implemented(updateCentroids(pts, asg, old), 'updateCentroids')
    assert(got !== old, 'should return a new array, not the same one')
    assert(
      got.every((c, j) => c !== old[j]),
      'returned centroid objects should be copies. Later phases animate centroids, so sharing objects causes bugs',
    )
    assert(fmt([pts, asg, old]) === before, 'points, assignments or centroids were modified')
  })

  // ---- computeInertia ----
  test('computeInertia', 'sum of squared distances to assigned centroids', () => {
    // Each point is 0.5 from its centroid: 4 x 0.5² = 1
    const got = computeInertia(line, [{ x: 0.5, y: 0 }, { x: 10.5, y: 0 }], [0, 0, 1, 1])
    assert(close(got, 1), `expected 1, got ${got}`)
  })

  // ---- initialisation ----
  test('initRandom', 'picks k distinct data points, reproducibly', () => {
    const pts = blobs({ n: 50, seed: 1 })
    const a = initRandom(pts, 5, createRng(123))
    const b = initRandom(pts, 5, createRng(123))
    assert(a.length === 5, `expected 5 centroids, got ${a.length}`)
    assert(fmt(a) === fmt(b), 'same seed should give the same centroids')
    assert(a.every((c) => pts.some((p) => samePoint(p, c))), 'every centroid should be a data point')
    assert(new Set(a.map(fmt)).size === 5, 'centroids should be distinct')
  })

  test('initRandom', 'k larger than n returns n centroids', () => {
    assert(initRandom(line, 10, createRng(1)).length === 4, 'expected 4')
  })

  test('initPlusPlus', 'picks k data points, reproducibly', () => {
    const pts = blobs({ n: 50, seed: 1 })
    const a = initPlusPlus(pts, 5, createRng(123))
    const b = initPlusPlus(pts, 5, createRng(123))
    assert(a.length === 5, `expected 5 centroids, got ${a.length}`)
    assert(fmt(a) === fmt(b), 'same seed should give the same centroids')
    assert(a.every((c) => pts.some((p) => samePoint(p, c))), 'every centroid should be a data point')
  })

  test('initPlusPlus', 'spreads seeds out: two far-apart groups get one seed each', () => {
    // 20 points near (0,0) and 20 near (100,100). With D² weighting, the second
    // seed is overwhelmingly likely to land in the other group. Try 50 seeds.
    const rng = createRng(9)
    const pts = []
    for (let i = 0; i < 20; i++) pts.push({ x: rng(), y: rng() })
    for (let i = 0; i < 20; i++) pts.push({ x: 100 + rng(), y: 100 + rng() })
    for (let seed = 1; seed <= 50; seed++) {
      const [c0, c1] = initPlusPlus(pts, 2, createRng(seed))
      const sameGroup = (c0.x < 50) === (c1.x < 50)
      assert(!sameGroup, `seed ${seed}: both centroids landed in the same group`)
    }
  })

  // ---- convergence ----
  test('hasConverged', 'true when nothing moved, false when something did', () => {
    const a = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    assert(hasConverged(a, structuredClone(a)) === true, 'identical centroids should count as converged')
    assert(hasConverged(a, [{ x: 0, y: 0 }, { x: 1 + 1e-9, y: 1 }]) === true, 'a 1e-9 wobble is within tolerance')
    assert(hasConverged(a, [{ x: 0, y: 0 }, { x: 1.01, y: 1 }]) === false, 'a 0.01 move is not converged')
  })

  // ---- end to end (needs your two functions) ----
  test('runToConvergence', 'converges on blobs, and inertia never goes up', () => {
    needsStudentCode()
    const pts = blobs({ seed: 42 })
    const r = runToConvergence(pts, 4, { rng: createRng(42) })
    assert(r.converged, `did not converge within ${r.iterations} iterations`)
    for (let i = 1; i < r.history.length; i++) {
      assert(
        r.history[i] <= r.history[i - 1] + 1e-12,
        `inertia went UP at iteration ${i}: ${r.history[i - 1]} -> ${r.history[i]}`,
      )
    }
  })

  test('runToConvergence', 'the result is a fixed point (one more step changes nothing)', () => {
    needsStudentCode()
    const pts = blobs({ seed: 42 })
    const r = runToConvergence(pts, 4, { rng: createRng(42) })
    assert(fmt(assignPoints(pts, r.centroids)) === fmt(r.assignments), 'assignments would still change')
    const again = updateCentroids(pts, r.assignments, r.centroids)
    assert(hasConverged(r.centroids, again), 'centroids would still move')
  })

  test('runToConvergence', 'K-means++ and Random both work on every dataset', () => {
    needsStudentCode()
    for (const [name, make] of Object.entries(DATASETS)) {
      const pts = make({ seed: 3 })
      for (const init of ['random', 'plusplus']) {
        const r = runToConvergence(pts, 4, { init, rng: createRng(3) })
        assert(r.converged, `${name}/${init}: did not converge`)
        assert(Number.isFinite(r.inertia), `${name}/${init}: inertia is ${r.inertia}`)
        assert(r.assignments.every((a) => a >= 0 && a < 4), `${name}/${init}: bad cluster index`)
      }
    }
  })

  test('runToConvergence', 'more clusters means lower inertia (the elbow idea)', () => {
    needsStudentCode()
    const pts = blobs({ seed: 42 })
    const k1 = runToConvergence(pts, 1, { rng: createRng(1) }).inertia
    const k4 = runToConvergence(pts, 4, { rng: createRng(1) }).inertia
    assert(k4 < k1, `expected inertia(K=4) < inertia(K=1), got ${k4} vs ${k1}`)
  })

  // ---- datasets ----
  test('data', 'every dataset is reproducible and well-formed', () => {
    for (const [name, make] of Object.entries(DATASETS)) {
      const a = make({ n: 100, seed: 5 })
      const b = make({ n: 100, seed: 5 })
      const c = make({ n: 100, seed: 6 })
      assert(a.length === 100, `${name}: expected 100 points, got ${a.length}`)
      assert(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), `${name}: non-finite coordinate`)
      assert(fmt(a) === fmt(b), `${name}: same seed gave different data`)
      assert(fmt(a) !== fmt(c), `${name}: different seeds gave identical data`)
    }
  })

  // --- report ---------------------------------------------------------------
  const style = {
    PASS: 'color:#5f7a35',
    FAIL: 'color:#b5432c;font-weight:bold',
    SKIP: 'color:#8c877c',
  }
  let currentGroup = ''
  for (const r of results) {
    if (r.group !== currentGroup) {
      currentGroup = r.group
      console.log(`\n${currentGroup}`)
    }
    console.log(`  %c${r.status}%c  ${r.name}${r.message ? `\n        ${r.message}` : ''}`, style[r.status], '')
  }

  const count = (s) => results.filter((r) => r.status === s).length
  const summary = { passed: count('PASS'), failed: count('FAIL'), skipped: count('SKIP') }
  console.log(`\n${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`)
  return summary
}
