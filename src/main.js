// main.js
// Entry point. Imports styles, then wires each module together.
// Each phase adds a line or two here; the real work lives in the other files.

import 'lenis/dist/lenis.css' // small helper styles Lenis needs (e.g. height: auto on <html>)
import './style.css'

import { initSmoothScroll, initHeroIntro, initReveals, refreshAfterFonts } from './scroll.js'

// Phase 1: smooth scrolling + entrance animations.
const lenis = initSmoothScroll()
initHeroIntro()
initReveals()
refreshAfterFonts()

// Handy for debugging in the console: window.lenis.scrollTo('#playground')
window.lenis = lenis

// Phase 2: dev-only console helpers.
// import.meta.env.DEV is true under `npm run dev` and false in `npm run build`,
// and the dynamic import() means the test file isn't even bundled for production.
//   runKmeansTests()                     run the test suite
//   km.runToConvergence(data.blobs(), 4) poke at the algorithm directly
if (import.meta.env.DEV) {
  Promise.all([import('./kmeans.test.js'), import('./kmeans.js'), import('./data.js')]).then(
    ([tests, km, data]) => {
      window.runKmeansTests = tests.runKmeansTests
      window.km = km
      window.data = data
      console.log('%cDev helpers ready: runKmeansTests(), km, data', 'font-family:monospace')
    },
  )
}
