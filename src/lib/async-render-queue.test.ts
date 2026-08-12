import { describe, expect, it } from 'vitest'
import { createAsyncRenderQueue } from './async-render-queue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe('createAsyncRenderQueue', () => {
  it('runs expensive work sequentially by default', async () => {
    const queue = createAsyncRenderQueue()
    const first = deferred()
    const order: string[] = []

    queue.enqueue(async () => {
      order.push('first:start')
      await first.promise
      order.push('first:end')
    })
    queue.enqueue(async () => { order.push('second') })

    await settle()
    expect(order).toEqual(['first:start'])

    first.resolve()
    await settle()
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('drops queued stale work without interrupting a renderer already in progress', async () => {
    const queue = createAsyncRenderQueue()
    const first = deferred()
    const order: string[] = []

    queue.enqueue(async () => {
      order.push('active')
      await first.promise
    })
    queue.enqueue(async () => { order.push('stale') })
    await settle()
    queue.clear()
    first.resolve()
    await settle()

    queue.enqueue(async () => { order.push('fresh') })
    await settle()
    expect(order).toEqual(['active', 'fresh'])
  })

  it('runs an explicit user request before passive queued rendering', async () => {
    const queue = createAsyncRenderQueue()
    const active = deferred()
    const order: string[] = []

    queue.enqueue(async () => {
      order.push('active:start')
      await active.promise
      order.push('active:end')
    })
    queue.enqueue(async () => { order.push('nearby') })
    queue.enqueue(async () => { order.push('requested') }, 'user')
    await settle()

    active.resolve()
    await settle()
    await settle()
    expect(order).toEqual(['active:start', 'active:end', 'requested', 'nearby'])
  })
})
