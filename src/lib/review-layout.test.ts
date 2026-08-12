import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const reviewView = readFileSync(new URL('../views/ReviewView.vue', import.meta.url), 'utf8')

describe('desktop review layout contract', () => {
  it('puts the active card before queue-maintenance shortcuts', () => {
    expect(reviewView.indexOf('class="review-card panel"')).toBeGreaterThan(-1)
    expect(reviewView.indexOf('class="review-card panel"')).toBeLessThan(reviewView.indexOf('class="review-launchpad"'))
  })

  it('keeps long card content in a bounded scrolling body above the actions', () => {
    const body = reviewView.indexOf('class="review-card__body"')
    const footer = reviewView.indexOf('<footer>', body)
    expect(body).toBeGreaterThan(-1)
    expect(body).toBeLessThan(footer)
    expect(reviewView).toContain('height:clamp(410px,calc(100vh - 270px),650px)')
    expect(reviewView).toContain('.review-card__body{min-height:0;flex:1;overflow:auto}')
  })

  it('shows every keyboard rating shortcut with an explicit readable surface', () => {
    for (const shortcut of ['1', '2', '3', '4']) expect(reviewView).toContain(`shortcut: '${shortcut}'`)
    for (const rating of ['again', 'hard', 'good', 'easy']) expect(reviewView).toContain(`.rating-${rating}`)
    expect(reviewView).toContain('<kbd>{{ item.shortcut }}</kbd>{{ item.label }}')
  })

  it('supports a bounded, local-only active-recall draft for question cards', () => {
    expect(reviewView).toContain('v-if="currentCanDraftAnswer && !revealed"')
    expect(reviewView).toContain('maxlength="8000"')
    expect(reviewView).toContain('仅本次内存 · 不写回题库')
    expect(reviewView).toContain('@keydown.ctrl.enter="handleQuestionDraftShortcut"')
    expect(reviewView).toContain('@keydown.meta.enter="handleQuestionDraftShortcut"')
    expect(reviewView).toContain('@contextmenu.stop></textarea>')
  })

  it('keeps draft comparison and retry actions inside the bounded review flow', () => {
    expect(reviewView).toContain('class="question-review-attempt"')
    expect(reviewView).toContain('v-if="!revealed && currentHasDraftAnswer"')
    expect(reviewView).toContain('v-if="revealed && currentCanRetryAnswer"')
    expect(reviewView).toContain("questionDraftAnswer.value = ''")
  })
})
