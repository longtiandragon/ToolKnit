import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const documents = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')
const review = readFileSync(new URL('../views/ReviewView.vue', import.meta.url), 'utf8')

describe('question provenance surfaces', () => {
  it('keeps source visible and actionable in the structured question inspector', () => {
    expect(documents).toContain('class="question-source-field"')
    expect(documents).toContain('{{ currentQuestionSource.hint }}')
    expect(documents).toContain('questionSourceActionLabel(currentQuestionSource)')
    expect(documents).toContain('复制来源 / 出处')
    expect(documents).toContain('role="menu" aria-label="题目结构操作"')
  })

  it('opens review Markdown links and exposes provenance in the card menu', () => {
    expect(review).toContain('@link-open="openReviewMarkdownLink"')
    expect(review).toContain("stageLocalFileHandoff('markdown', [target.path], '题目来源')")
    expect(review).toContain('v-if="currentQuestionSource.raw" role="menuitem"')
    expect(review).toContain('questionSourceActionLabel(currentQuestionSource)')
  })
})
