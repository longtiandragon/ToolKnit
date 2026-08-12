/** A tiny revision gate for debounced searches whose underlying request cannot
 * be cancelled (for example a SQLite invoke already in flight). */
export function createAsyncSearchGate() {
  let revision = 0
  return {
    begin() { revision += 1; return revision },
    invalidate() { revision += 1 },
    isCurrent(candidate: number) { return candidate === revision },
  }
}
