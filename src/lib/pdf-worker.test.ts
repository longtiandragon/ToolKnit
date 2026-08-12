import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelPdfTask, PDF_TASK_CANCELLED_MESSAGE, runPdfTask } from './pdf-worker'

class MockPdfWorker {
  static instances: MockPdfWorker[] = []
  readonly terminate = vi.fn()
  readonly postMessage = vi.fn()
  private readonly listeners = new Map<string, Array<(event: Event) => void>>()

  constructor() { MockPdfWorker.instances.push(this) }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
}

afterEach(() => {
  cancelPdfTask()
  MockPdfWorker.instances = []
  vi.unstubAllGlobals()
})

describe('PDF worker cancellation', () => {
  it('terminates the isolated worker and rejects the active task immediately', async () => {
    vi.stubGlobal('Worker', MockPdfWorker)
    const task = runPdfTask({
      operation: 'split',
      files: [{ name: 'long.pdf', data: new ArrayBuffer(8) }],
      outputName: 'knitspace', pageRange: '1', rotation: 90,
      pageNumberStart: 1, pageNumberPosition: 'bottom-center',
    }, { onOutput: () => undefined })

    expect(cancelPdfTask()).toBe(true)
    await expect(task).rejects.toThrow(PDF_TASK_CANCELLED_MESSAGE)
    expect(MockPdfWorker.instances[0]?.terminate).toHaveBeenCalledOnce()
    expect(cancelPdfTask()).toBe(false)
  })
})
