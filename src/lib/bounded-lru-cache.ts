/**
 * Small insertion-ordered LRU helpers for renderer-side caches.  They keep
 * expensive work reusable without allowing a long document to retain every
 * previously visited page for the lifetime of the route.
 */
export function getBoundedCacheValue<K, V>(cache: Map<K, V>, key: K) {
  const value = cache.get(key)
  if (value === undefined) return undefined
  cache.delete(key)
  cache.set(key, value)
  return value
}

export function setBoundedCacheValue<K, V>(cache: Map<K, V>, key: K, value: V, maximumEntries: number) {
  const limit = Math.max(1, Math.floor(maximumEntries) || 1)
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value as K | undefined
    if (oldest === undefined) break
    cache.delete(oldest)
  }
  return value
}
