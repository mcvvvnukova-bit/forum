import '@testing-library/jest-dom/vitest'
import {afterEach} from 'vitest'
import {cleanup} from '@testing-library/react'

afterEach(cleanup)

Object.defineProperty(window, 'matchMedia', {
  value: (query: string) => ({matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() {return true}}),
})
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(window, 'ResizeObserver', {value: TestResizeObserver})
