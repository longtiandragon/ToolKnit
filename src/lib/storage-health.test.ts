import { describe, expect, it } from 'vitest'
import { storageSpaceLevel, storageSpacePercent } from './storage-health'

const GB = 1024 ** 3
const MB = 1024 ** 2

describe('storage health', () => {
  it('marks write-starved volumes as critical before SQLite fails', () => {
    expect(storageSpaceLevel({ availableBytes: 120 * MB, totalBytes: 360 * GB })).toBe('critical')
    expect(storageSpaceLevel({ availableBytes: 3 * GB, totalBytes: 2_000 * GB })).toBe('critical')
  })

  it('uses a visible low state before the critical boundary', () => {
    expect(storageSpaceLevel({ availableBytes: 1.5 * GB, totalBytes: 100 * GB })).toBe('low')
    expect(storageSpaceLevel({ availableBytes: 5 * GB, totalBytes: 300 * GB })).toBe('low')
  })

  it('keeps healthy and missing probes distinct', () => {
    expect(storageSpaceLevel({ availableBytes: 80 * GB, totalBytes: 500 * GB })).toBe('ready')
    expect(storageSpaceLevel()).toBe('unknown')
    expect(storageSpaceLevel({ availableBytes: 2 * GB, totalBytes: 1 * GB })).toBe('unknown')
  })

  it('bounds the percentage used by the storage meter', () => {
    expect(storageSpacePercent({ availableBytes: 25 * GB, totalBytes: 100 * GB })).toBe(25)
    expect(storageSpacePercent({ availableBytes: -1, totalBytes: 100 })).toBe(0)
  })
})
