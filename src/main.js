// main.js
// Entry point. Imports styles, then wires each module together.
// The real work lives in the other files; this one only decides the order.

import 'lenis/dist/lenis.css' // small helper styles Lenis needs (e.g. height: auto on <html>)
import './style.css'

import { initSmoothScroll, initHeroIntro, initReveals, initStory, refreshAfterFonts } from './scroll.js'
import { initHero } from './hero.js'
import { initPlayground } from './playground.js'
import { initCharts } from './charts.js'

// Smooth scrolling + the hero's entrance.
const lenis = initSmoothScroll()
initHeroIntro()

// The live hero canvas and the pinned scroll story.
// (Created before the reveals so ScrollTrigger measures the pin first:
// ScrollTriggers are refreshed in creation order.)
initHero(document.querySelector('.hero'))
initStory(document.querySelector('#story'))

initReveals()
refreshAfterFonts()

// The playground, and the two charts that follow it.
const playground = initPlayground(document.querySelector('#playground'))
initCharts(playground)

// Dev-only console helpers.
// import.meta.env.DEV is true under `npm run dev` and false in `npm run build`,
// and the dynamic import() means the test file isn't even bundled for production.
//   runKmeansTests()                     run the test suite
//   km.runToConvergence(data.blobs(), 4) poke at the algorithm directly
//   playground.state                     the playground's live state
//   lenis.scrollTo('#playground')        drive the smooth scroller
if (import.meta.env.DEV) {
  window.lenis = lenis
  window.playground = playground
  Promise.all([import('./kmeans.test.js'), import('./kmeans.js'), import('./data.js')]).then(
    ([tests, km, data]) => {
      window.runKmeansTests = tests.runKmeansTests
      window.km = km
      window.data = data
      console.log('%cDev helpers ready: runKmeansTests(), km, data, playground, lenis', 'font-family:monospace')
    },
  )
}
