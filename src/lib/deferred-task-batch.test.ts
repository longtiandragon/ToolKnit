import { describe, expect, it, vi } from 'vitest'
import { createDeferredTaskBatch, type DeferredTask, type DeferredTaskScheduler } from './deferred-task-batch'

function controlledScheduler() {
  let nextHandle = 0
  const pending = new Map<number, DeferredTask>()
  const cancelled: number[] = []
  const scheduler: DeferredTaskScheduler = {
    request(task) {
      const handle = ++nextHandle
      pending.set(handle, task)
      return handle
    },
    cancel(handle) {
      cancelled.push(handle)
      pending.delete(handle)
    },
  }
  const flushOne = () => {
    const entry = pending.entries().next().value as [number, DeferredTask] | undefined
    if (!entry) return false
    pending.delete(entry[0])
    entry[1]()
    return true
  }
  return { scheduler, pending, cancelled, flushOne }
}

describe('deferred task batch', () => {
  it('yields between DOM tasks instead of running a hydration burst', () => {
    const control = controlledScheduler()
    const calls: string[] = []
    const batch = createDeferredTaskBatch(control.scheduler)

    batch.run([() => calls.push('outline'), () => calls.push('code'), () => calls.push('math')])
    expect(calls).toEqual([])
    expect(control.pending.size).toBe(1)

    control.flushOne()
    expect(calls).toEqual(['outline'])
    expect(control.pending.size).toBe(1)

    control.flushOne()
    control.flushOne()
    expect(calls).toEqual(['outline', 'code', 'math'])
    expect(control.pending.size).toBe(0)
  })

  it('cancels stale work when a newer preview revision arrives', () => {
    const control = controlledScheduler()
    const stale = vi.fn()
    const current = vi.fn()
    const batch = createDeferredTaskBatch(control.scheduler)

    batch.run([stale, stale])
    batch.run([current])

    expect(control.cancelled).toHaveLength(1)
    while (control.flushOne()) {
      // Drain the controlled scheduler.
    }
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledOnce()
  })

  it('stops the remaining batch when the reader unmounts', () => {
    const control = controlledScheduler()
    const first = vi.fn()
    const second = vi.fn()
    const batch = createDeferredTaskBatch(control.scheduler)

    batch.run([first, second])
    control.flushOne()
    batch.clear()
    while (control.flushOne()) {
      // Drain any task that was not cancelled by the scheduler.
    }

    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
  })
})
