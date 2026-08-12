import { describe, expect, it } from 'vitest'
import { getBoundedCacheValue, setBoundedCacheValue } from './bounded-lru-cache'

describe('bounded LRU cache', () => {
  it('evicts the least recently used item instead of every older item', () => {
    const cache = new Map<string, number>()
    setBoundedCacheValue(cache, 'first', 1, 2)
    setBoundedCacheValue(cache, 'second', 2, 2)
    expect(getBoundedCacheValue(cache, 'first')).toBe(1)
    setBoundedCacheValue(cache, 'third', 3, 2)
    expect([...cache.entries()]).toEqual([['first', 1], ['third', 3]])
  })

  it('updates an existing item without growing the cache', () => {
    const cache = new Map<string, number>()
    setBoundedCacheValue(cache, 'page', 1, 1)
    setBoundedCacheValue(cache, 'page', 2, 1)
    expect(cache).toEqual(new Map([['page', 2]]))
  })

  it('always retains the most recent entry when a bad limit is supplied', () => {
    const cache = new Map<string, number>()
    setBoundedCacheValue(cache, 'first', 1, 0)
    setBoundedCacheValue(cache, 'second', 2, Number.NaN)
    expect(cache).toEqual(new Map([['second', 2]]))
  })
})
