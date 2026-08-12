import type { QuestionType } from '@/types'

export interface QuestionTemplateOptions {
  questionType?: QuestionType
  subject?: string
  tags?: string[]
  difficulty?: number
  reviewEnabled?: boolean
}

function yamlString(value: string) {
  return JSON.stringify(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''))
}

export const questionTemplate = (title = '未命名错题', options: QuestionTemplateOptions = {}) => `---
schema_version: 1
title: ${yamlString(title)}
type: ${options.questionType ?? 'algorithm'}
subject: ${yamlString(options.subject?.trim() || '算法')}
tags: [${(options.tags ?? []).map(tag => yamlString(tag.trim())).filter(tag => tag !== '""').slice(0, 12).join(', ')}]
difficulty: ${Math.min(5, Math.max(1, Math.round(options.difficulty ?? 3)))}
review_enabled: ${options.reviewEnabled ?? true}
---

## 补充笔记

记录推导过程、变式、链接与实现细节。

## 复盘
`
