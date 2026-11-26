// main.js
// Entry point. Imports styles, then wires each module together.
// Each phase adds a line or two here; the real work lives in the other files.

import 'lenis/dist/lenis.css' // small helper styles Lenis needs (e.g. height: auto on <html>)
import './style.css'

import { initSmoothScroll, initHeroIntro, initReveals, initStory, refreshAfterFonts } from './scroll.js'
import { initHero } from './hero.js'
import { initPlayground } from './playground.js'

// Phase 1: smooth scrolling + entrance animations.
const lenis = initSmoothScroll()
initHeroIntro()

// Phase 4: the live hero canvas and the pinned scroll story.
// (Created before the reveals so ScrollTrigger measures the pin first:
// ScrollTriggers are refreshed in creation order.)
initHero(document.querySelector('.hero'))
initStory(document.querySelector('#story'))

initReveals()
refreshAfterFonts()

// Phase 3: the interactive playground.
const playground = initPlayground(document.querySelector('#playground'))

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
      window.playground = playground // inspect live state: playground.state
      console.log('%cDev helpers ready: runKmeansTests(), km, data', 'font-family:monospace')
    },
  )
}
