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
