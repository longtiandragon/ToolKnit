import { describe, expect, it } from 'vitest'
import { canRedoAnnotationHistory, canUndoAnnotationHistory, commitAnnotationHistory, createAnnotationHistory, redoAnnotationHistory, undoAnnotationHistory } from './annotation-history'
import type { CanvasAnnotation } from './annotation-canvas'

const box = (id: number, x = .2): CanvasAnnotation => ({ id, kind: 'box', x, y: .2, width: .2, height: .16, text: '', color: '#13806e' })

describe('annotation history', () => {
  it('restores creation, movement and deletion in chronological order', () => {
    let history = createAnnotationHistory()
    history = commitAnnotationHistory(history, [box(1)])
    history = commitAnnotationHistory(history, [box(1, .42)])
    history = commitAnnotationHistory(history, [])

    expect(canUndoAnnotationHistory(history)).toBe(true)
    expect(history.present).toEqual([])
    history = undoAnnotationHistory(history)
    expect(history.present[0]?.x).toBe(.42)
    history = undoAnnotationHistory(history)
    expect(history.present[0]?.x).toBe(.2)
    history = undoAnnotationHistory(history)
    expect(history.present).toEqual([])
    expect(canRedoAnnotationHistory(history)).toBe(true)
  })

  it('drops redo states after a new edit and keeps snapshots isolated', () => {
    let history = commitAnnotationHistory(createAnnotationHistory(), [box(1)])
    history = commitAnnotationHistory(history, [box(1, .5)])
    history = undoAnnotationHistory(history)
    const branched = commitAnnotationHistory(history, [box(2, .7)])

    expect(canRedoAnnotationHistory(branched)).toBe(false)
    expect(branched.present[0]?.id).toBe(2)
    expect(redoAnnotationHistory(branched)).toBe(branched)
    expect(history.present[0]?.id).toBe(1)
  })

  it('caps history and ignores an equivalent state', () => {
    let history = createAnnotationHistory()
    history = commitAnnotationHistory(history, [box(1)], 2)
    const beforeEquivalentCommit = history
    const unchanged = commitAnnotationHistory(history, [box(1)], 2)
    expect(unchanged).toBe(beforeEquivalentCommit)
    history = commitAnnotationHistory(history, [box(2)], 2)
    history = commitAnnotationHistory(history, [box(3)], 2)

    expect(history.past).toHaveLength(2)
    expect(undoAnnotationHistory(history).present[0]?.id).toBe(2)
  })
})
