import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'

// A cold start (the first test of a file) can take several seconds on a slow or busy computer. findBy... and waitFor
// wait up to 1 second by default, which made the first test of a file fail now and then. Five seconds costs nothing
// when the page is quick, because they return as soon as the thing appears.
configure({ asyncUtilTimeout: 5000 })

beforeEach(() => {
  window.localStorage.clear()
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
})
afterEach(() => cleanup())
