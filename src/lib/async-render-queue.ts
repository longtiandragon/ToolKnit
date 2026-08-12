export type AsyncRenderTask = () => Promise<void>
export type AsyncRenderPriority = 'normal' | 'user'

/**
 * Keeps expensive DOM-facing work (such as Mermaid layout) from starting in a
 * burst. `clear()` deliberately keeps an already-running task alive: most
 * third-party renderers cannot be safely aborted, while stale queued work can
 * and should be discarded immediately.
 */
export function createAsyncRenderQueue(maxConcurrent = 1) {
  const limit = Math.max(1, Math.floor(maxConcurrent))
  const pending: Array<{ generation: number; task: AsyncRenderTask }> = []
  let active = 0
  let generation = 0

  function drain() {
    while (active < limit && pending.length) {
      const next = pending.shift()
      if (!next || next.generation !== generation) continue
      active += 1
      void Promise.resolve()
        .then(next.task)
        // A task should surface its own user-facing error. This guard makes a
        // single broken diagram unable to deadlock every later visible one.
        .catch(() => undefined)
        .finally(() => {
          active -= 1
          drain()
        })
    }
  }

  return {
    enqueue(task: AsyncRenderTask, priority: AsyncRenderPriority = 'normal') {
      // A menu action is an explicit request. It should be rendered ahead of
      // diagrams merely approaching the viewport, while an active renderer is
      // still allowed to finish safely.
      if (priority === 'user') pending.unshift({ generation, task })
      else pending.push({ generation, task })
      drain()
    },
    clear() {
      generation += 1
      pending.length = 0
    },
  }
}
