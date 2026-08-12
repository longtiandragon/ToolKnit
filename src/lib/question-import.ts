import type { QuestionType, StudyDocument } from '@/types'
import { questionTemplate } from './question-template'
import { createQuestionReviewState } from './question-review'

export const MAX_QUESTION_IMPORT_CHARS = 1_000_000
export const MAX_QUESTION_IMPORT_ROWS = 2_000

export interface QuestionImportRow {
  line: number
  title: string
  source: string
  stem: string
  answer: string
  explanation: string
  wrongAnswer: string
  errorReason: string
  subject: string
  questionType: QuestionType
  difficulty: number
  tags: string[]
  errorTypes: string[]
}

export interface QuestionImportIssue { line: number; message: string; preview: string }
export interface QuestionImportParseResult {
  rows: QuestionImportRow[]
  issues: QuestionImportIssue[]
  format: 'table' | 'simple'
  truncated: boolean
}

export type QuestionImportDuplicatePolicy = 'skip' | 'copy'
export interface QuestionImportPreparation {
  documents: StudyDocument[]
  importedCount: number
  skippedCount: number
  reviewCardCount: number
}

const HEADER_ALIASES: Record<string, string> = {
  title: 'title', name: 'title', 标题: 'title', 题目标题: 'title',
  source: 'source', origin: 'source', reference: 'source', 来源: 'source', 出处: 'source', 题目来源: 'source',
  stem: 'stem', question: 'stem', prompt: 'stem', 题干: 'stem', 题目: 'stem',
  answer: 'answer', solution: 'answer', 答案: 'answer', 正确答案: 'answer', 结论: 'answer',
  explanation: 'explanation', analysis: 'explanation', rationale: 'explanation', 解析: 'explanation', 正确思路: 'explanation',
  wronganswer: 'wrongAnswer', attempt: 'wrongAnswer', 我的答案: 'wrongAnswer', 错误答案: 'wrongAnswer', 错误做法: 'wrongAnswer',
  errorreason: 'errorReason', mistake: 'errorReason', 错因: 'errorReason', 错误原因: 'errorReason',
  subject: 'subject', category: 'subject', 学科: 'subject', 分类: 'subject',
  type: 'questionType', questiontype: 'questionType', 题型: 'questionType', 类型: 'questionType',
  difficulty: 'difficulty', level: 'difficulty', 难度: 'difficulty',
  tag: 'tags', tags: 'tags', 标签: 'tags', 知识点: 'tags',
  errortype: 'errorTypes', errortypes: 'errorTypes', 错误类型: 'errorTypes', 错误分类: 'errorTypes',
}

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/[\s_\-/]+/g, '')
}

function list(value = '') {
  return [...new Set(value.split(/[；;|、\n]/).map(item => item.trim()).filter(Boolean))].slice(0, 50)
}

function questionType(value: string): QuestionType {
  const normalized = value.trim().toLocaleLowerCase('en-US')
  if (['algorithm', 'algo', '算法', '编程'].includes(normalized)) return 'algorithm'
  if (['math', '数学'].includes(normalized)) return 'math'
  if (['science', '理科', '物理', '化学', '生物'].includes(normalized)) return 'science'
  return 'general'
}

interface DelimitedRecord { line: number; fields: string[]; preview: string }

/** Parses quoted CSV/TSV records, including paragraphs with embedded newlines. */
function parseDelimitedRecords(source: string, delimiter: '\t' | ',') {
  const records: DelimitedRecord[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let recordLine = 1
  const pushRecord = () => {
    fields.push(field.trim())
    const preview = fields.join(delimiter).replace(/\s+/g, ' ').slice(0, 160)
    if (fields.some(value => value.trim())) records.push({ line: recordLine, fields, preview })
    fields = []
    field = ''
    recordLine = line
  }
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1 }
      else quoted = !quoted
    } else if (character === delimiter && !quoted) {
      fields.push(field.trim()); field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      line += 1
      pushRecord()
    } else {
      field += character
      if (character === '\n') line += 1
    }
  }
  if (field || fields.length) pushRecord()
  return records
}

function rowFromFields(fields: string[], mapping: Record<string, number>, line: number): QuestionImportRow {
  const at = (key: string) => fields[mapping[key] ?? -1]?.trim() ?? ''
  const parsedDifficulty = Number.parseInt(at('difficulty'), 10)
  return {
    line,
    title: at('title'),
    source: at('source'),
    stem: at('stem'),
    answer: at('answer'),
    explanation: at('explanation'),
    wrongAnswer: at('wrongAnswer'),
    errorReason: at('errorReason'),
    subject: at('subject') || '未分类',
    questionType: questionType(at('questionType')),
    difficulty: Number.isFinite(parsedDifficulty) ? Math.min(5, Math.max(1, parsedDifficulty)) : 3,
    tags: list(at('tags')),
    errorTypes: list(at('errorTypes')),
  }
}

function validRow(row: QuestionImportRow) {
  if (!row.stem) return '缺少题干'
  if (row.title.length > 180) return '标题超过 180 个字符'
  if (row.source.length > 2_000) return '来源超过 2,000 个字符'
  if (row.stem.length > 20_000) return '题干超过 20,000 个字符'
  if (row.answer.length > 40_000 || row.explanation.length > 40_000) return '答案或解析超过 40,000 个字符'
  if (row.wrongAnswer.length > 20_000 || row.errorReason.length > 20_000) return '错误做法或错因超过 20,000 个字符'
  return ''
}

function simpleRow(text: string, line: number): QuestionImportRow {
  const split = text.split(/\s+(?:=>|→|::)\s+/, 2)
  return {
    line, title: '', source: '', stem: split[0]?.trim() ?? '', answer: split[1]?.trim() ?? '', explanation: '', wrongAnswer: '', errorReason: '',
    subject: '未分类', questionType: 'general', difficulty: 3, tags: [], errorTypes: [],
  }
}

export function parseQuestionImport(source: string): QuestionImportParseResult {
  const bounded = source.slice(0, MAX_QUESTION_IMPORT_CHARS).replace(/^\uFEFF/, '')
  const sourceTruncated = bounded.length !== source.length
  const firstLine = bounded.split(/\r?\n/, 1)[0] ?? ''
  const delimiter: '\t' | ',' | undefined = firstLine.includes('\t') ? '\t' : firstLine.includes(',') ? ',' : undefined
  const records = delimiter
    ? parseDelimitedRecords(bounded, delimiter).filter(record => !record.preview.trimStart().startsWith('#'))
    : bounded.split(/\r?\n/).map((text, index) => ({ line: index + 1, fields: [text.trim()], preview: text.trim() })).filter(record => record.preview && !record.preview.startsWith('#'))
  const firstFields = records[0]?.fields ?? []
  const headerMapping = Object.fromEntries(firstFields.flatMap((field, index) => {
    const key = HEADER_ALIASES[normalizedHeader(field)]
    return key ? [[key, index]] : []
  })) as Record<string, number>
  const hasHeader = headerMapping.stem !== undefined
  const candidates = records.slice(hasHeader ? 1 : 0, (hasHeader ? 1 : 0) + MAX_QUESTION_IMPORT_ROWS)
  const rows: QuestionImportRow[] = []
  const issues: QuestionImportIssue[] = []
  for (const candidate of candidates) {
    const row = delimiter
      ? rowFromFields(candidate.fields, hasHeader ? headerMapping : { stem: 0, answer: 1, explanation: 2, subject: 3, tags: 4 }, candidate.line)
      : simpleRow(candidate.preview, candidate.line)
    const error = validRow(row)
    if (error) issues.push({ line: candidate.line, message: error, preview: candidate.preview.slice(0, 160) })
    else rows.push(row)
  }
  const truncated = sourceTruncated || records.length - Number(hasHeader) > MAX_QUESTION_IMPORT_ROWS
  if (sourceTruncated) issues.unshift({ line: 0, message: '输入超过 1,000,000 字符，只解析了前半部分', preview: '' })
  else if (truncated) issues.unshift({ line: 0, message: '单次最多解析 2,000 道题，其余内容未处理', preview: '' })
  return { rows, issues, format: delimiter ? 'table' : 'simple', truncated }
}

function titleFor(row: QuestionImportRow) {
  if (row.title.trim()) return row.title.trim()
  return row.stem.replace(/^#+\s*/, '').split(/\r?\n/, 1)[0].trim().slice(0, 72) || '未命名题目'
}

function duplicateKey(title: string, stem: string) {
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')
  return `${normalize(title)}\u0000${normalize(stem)}`
}

export function prepareQuestionImport(
  rows: QuestionImportRow[],
  existing: StudyDocument[],
  policy: QuestionImportDuplicatePolicy,
  answerReview: boolean,
  errorReview: boolean,
  idFactory: () => string = () => crypto.randomUUID(),
  now = new Date().toISOString(),
): QuestionImportPreparation {
  const known = new Set(existing.filter(document => document.kind === 'question').map(document => duplicateKey(document.title, document.questionDetails?.stem ?? '')))
  const documents: StudyDocument[] = []
  let skippedCount = 0
  let reviewCardCount = 0
  for (const row of rows) {
    const title = titleFor(row)
    const key = duplicateKey(title, row.stem)
    if (policy === 'skip' && known.has(key)) { skippedCount += 1; continue }
    known.add(key)
    const review = answerReview && Boolean(row.answer.trim() || row.explanation.trim()) ? createQuestionReviewState(now) : undefined
    const error = errorReview && Boolean(row.wrongAnswer.trim() || row.errorReason.trim()) ? createQuestionReviewState(now) : undefined
    reviewCardCount += Number(Boolean(review)) + Number(Boolean(error))
    documents.push({
      id: idFactory(), title, kind: 'question', questionType: row.questionType, subject: row.subject, tags: row.tags,
      difficulty: row.difficulty, content: questionTemplate(title),
      questionDetails: { source: row.source, stem: row.stem, answer: row.answer, explanation: row.explanation, wrongAnswer: row.wrongAnswer, errorReason: row.errorReason },
      createdAt: now, updatedAt: now, reviewEnabled: Boolean(review || error), ...(review ? { review } : {}),
      ...(error ? { reviewFacets: { error } } : {}), errorTypes: row.errorTypes,
    })
  }
  return { documents, importedCount: documents.length, skippedCount, reviewCardCount }
}
