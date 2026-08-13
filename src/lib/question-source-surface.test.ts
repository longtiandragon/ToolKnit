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
    // Matched without pinning attribute order: the contract is that copying
    // the provenance is a menu item and only appears when there is a source.
    expect(review).toMatch(/v-if="currentQuestionSource\.raw"[^>]*role="menuitem"[^>]*>复制来源 \/ 出处</)
    expect(review).toContain('questionSourceActionLabel(currentQuestionSource)')
  })
})
