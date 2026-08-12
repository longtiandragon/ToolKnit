import { describe, expect, it } from 'vitest'
import { createAsyncSearchGate } from './async-search-gate'

describe('async search gate', () => {
  it('rejects an older request after a later input starts', () => {
    const gate = createAsyncSearchGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('rejects an in-flight result after the search surface closes', () => {
    const gate = createAsyncSearchGate()
    const request = gate.begin()
    gate.invalidate()
    expect(gate.isCurrent(request)).toBe(false)
  })
})
