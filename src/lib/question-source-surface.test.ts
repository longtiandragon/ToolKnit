import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const documents = readFileSync(new URL('../views/DocumentsView.vue', import.meta.url), 'utf8')
const review = readFileSync(new URL('../views/ReviewView.vue', import.meta.url), 'utf8')

describe('question provenance surfaces', () => {
  it('keeps source visible and actionable in the structured question inspector', () => {
    // Matched on the field itself rather than the wrapper's class name: the
    // contract is that a question's provenance has its own labelled input in
    // the inspector, not that the label is styled by `.question-source-field`.
    expect(documents).toContain('来源 / 出处')
    expect(documents).toContain('draft.questionDetails.source')
    expect(documents).toContain('data-question-field="source"')
    expect(documents).toContain('{{ currentQuestionSource.hint }}')
    expect(documents).toContain('questionSourceActionLabel(currentQuestionSource)')
    expect(documents).toContain('复制来源 / 出处')
    expect(documents).toMatch(/aria-label="题目结构操作"/)
    expect(documents).toMatch(/ref="questionStructureMenuElement"[\s\S]{0,400}?role="menu"/)
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
