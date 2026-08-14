import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const reviewView = readFileSync(new URL('../views/ReviewView.vue', import.meta.url), 'utf8')

describe('desktop review layout contract', () => {
  it('puts the active card before queue-maintenance shortcuts', () => {
    const card = reviewView.indexOf('ref="reviewCard"')
    const materials = reviewView.indexOf('aria-labelledby="review-materials-title"')
    expect(card).toBeGreaterThan(-1)
    expect(materials).toBeGreaterThan(-1)
    expect(card).toBeLessThan(materials)
  })

  it('keeps long card content in a bounded scrolling body above the actions', () => {
    // Asserted structurally rather than by a literal CSS string: the card is a
    // fixed-height flex column, the body is the only part allowed to grow and
    // scroll, and the footer comes after it. That is the contract — the rating
    // buttons must not move down the screen when a question is long.
    const card = reviewView.indexOf('ref="reviewCard"')
    const body = reviewView.indexOf('ref="reviewBody"', card)
    const footer = reviewView.indexOf('<footer', body)
    expect(body).toBeGreaterThan(card)
    expect(footer).toBeGreaterThan(body)
    expect(reviewView.slice(card, body)).toMatch(/h-\[clamp\(.+\)\]/)
    expect(reviewView.slice(card, body)).toContain('flex flex-col overflow-hidden')
    expect(reviewView.slice(body, footer)).toContain('flex-1 min-h-0 overflow-auto')
  })

  it('shows every keyboard rating shortcut with an explicit readable surface', () => {
    for (const shortcut of ['1', '2', '3', '4']) expect(reviewView).toContain(`shortcut: '${shortcut}'`)
    for (const rating of ['Again', 'Hard', 'Good', 'Easy']) expect(reviewView).toContain(`  ${rating}: 'border-line`)
    expect(reviewView).toContain('<kbd class="kbd">{{ item.shortcut }}</kbd>{{ item.label }}')
  })

  it('supports a bounded, local-only active-recall draft for question cards', () => {
    expect(reviewView).toContain('v-if="currentCanDraftAnswer && !revealed"')
    expect(reviewView).toContain('maxlength="8000"')
    expect(reviewView).toContain('仅本次内存 · 不写回题库')
    expect(reviewView).toContain('@keydown.ctrl.enter="handleQuestionDraftShortcut"')
    expect(reviewView).toContain('@keydown.meta.enter="handleQuestionDraftShortcut"')
    expect(reviewView).toContain('@contextmenu.stop')
  })

  it('keeps draft comparison and retry actions inside the bounded review flow', () => {
    expect(reviewView).toContain('aria-labelledby="question-review-attempt-title"')
    expect(reviewView).toContain('v-if="!revealed && currentHasDraftAnswer"')
    expect(reviewView).toContain('v-if="revealed && currentCanRetryAnswer"')
    expect(reviewView).toContain("questionDraftAnswer.value = ''")
  })

  it('exposes the queue filter that the session state already supported', () => {
    // `reviewKindOptions` existed with styling and no markup: the only way out
    // of a filtered queue was a button inside one empty state.
    expect(reviewView).toContain('reviewKindChoices')
    expect(reviewView).toContain('label="复习队列筛选"')
    expect(reviewView).toContain('selectReviewKind($event as ReviewKind)')
  })
})
