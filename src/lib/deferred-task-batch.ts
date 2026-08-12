export type DeferredTask = () => void

export interface DeferredTaskScheduler {
  request(task: DeferredTask): number
  cancel(handle: number): void
}

function browserScheduler(): DeferredTaskScheduler {
  return {
    request(task) {
      if (typeof window.requestIdleCallback === 'function') {
        return window.requestIdleCallback(task, { timeout: 120 })
      }
      return window.setTimeout(task, 0)
    },
    cancel(handle) {
      if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    },
  }
}

/**
 * Runs DOM-enhancement work one task per browser idle turn. A new preview can
 * invalidate the remaining work immediately, so stale Markdown revisions do
 * not keep scanning a tree that Vue is about to replace.
 */
export function createDeferredTaskBatch(scheduler: DeferredTaskScheduler = browserScheduler()) {
  let generation = 0
  let handle: number | undefined

  function clear() {
    generation += 1
    if (handle !== undefined) scheduler.cancel(handle)
    handle = undefined
  }

  function run(tasks: readonly DeferredTask[]) {
    clear()
    const currentGeneration = generation
    let index = 0

    function scheduleNext() {
      if (currentGeneration !== generation || index >= tasks.length) {
        handle = undefined
        return
      }
      handle = scheduler.request(() => {
        handle = undefined
        if (currentGeneration !== generation) return
        const task = tasks[index]
        index += 1
        task?.()
        scheduleNext()
      })
    }

    scheduleNext()
  }

  return { run, clear }
}
