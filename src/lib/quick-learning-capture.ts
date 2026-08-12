import type { QuestionDetails, QuestionType } from '@/types'

export const QUICK_LEARNING_CAPTURE_LIMIT = 8_000
export const QUICK_VOCABULARY_SENSE_LIMIT = 12

export interface QuickVocabularySenseDraft {
  partOfSpeech: string
  definition: string
  examples: string[]
  collocations: string[]
  synonyms: string[]
}

export interface QuickVocabularyDraft {
  lemma: string
  language: string
  pronunciation: string
  forms: Record<string, string>
  senses: QuickVocabularySenseDraft[]
  confident: boolean
  truncated: boolean
}

export interface QuickQuestionDraft {
  title: string
  details: QuestionDetails
  questionType: QuestionType
  subject: string
  tags: string[]
  confident: boolean
  truncated: boolean
}

const POS_ALIASES: Record<string, string> = {
  n: 'noun', noun: 'noun', 名词: 'noun',
  v: 'verb', verb: 'verb', 动词: 'verb',
  adj: 'adjective', adjective: 'adjective', 形容词: 'adjective',
  adv: 'adverb', adverb: 'adverb', 副词: 'adverb',
  prep: 'preposition', preposition: 'preposition', 介词: 'preposition',
  pron: 'pronoun', pronoun: 'pronoun', 代词: 'pronoun',
  conj: 'conjunction', conjunction: 'conjunction', 连词: 'conjunction',
  num: 'numeral', numeral: 'numeral', 数词: 'numeral',
  interj: 'interjection', interjection: 'interjection', 感叹词: 'interjection',
}

const QUESTION_FIELDS: Array<[keyof QuestionDetails, RegExp]> = [
  ['source', /^(?:来源|出处|题目来源|source|reference)\s*[:：]\s*(.*)$/i],
  ['stem', /^(?:题目|题干|问题|question)\s*[:：]\s*(.*)$/i],
  ['wrongAnswer', /^(?:我的答案|错误答案|错误做法|wrong\s*answer)\s*[:：]\s*(.*)$/i],
  ['answer', /^(?:正确答案|参考答案|答案|answer)\s*[:：]\s*(.*)$/i],
  ['explanation', /^(?:解析|解答|思路|explanation)\s*[:：]\s*(.*)$/i],
  ['errorReason', /^(?:错因|错误原因|反思|error\s*reason)\s*[:：]\s*(.*)$/i],
]

function boundedSource(source: string) {
  const normalized = source.replace(/\r\n?/g, '\n').trim()
  return { value: normalized.slice(0, QUICK_LEARNING_CAPTURE_LIMIT), truncated: normalized.length > QUICK_LEARNING_CAPTURE_LIMIT }
}

function splitList(value: string, limit = 12) {
  return value.split(/[；;]|\s+[•·]\s+|\s+\|\s+/).map(item => item.trim()).filter(Boolean).slice(0, limit)
}

function appendUnique(target: string[], values: string[], limit = 12) {
  for (const value of values) {
    if (!target.includes(value)) target.push(value)
    if (target.length >= limit) break
  }
}

function blankSense(partOfSpeech = ''): QuickVocabularySenseDraft {
  return { partOfSpeech, definition: '', examples: [], collocations: [], synonyms: [] }
}

function parseLemmaLine(line: string) {
  const source = line.replace(/^(?:单词|词条|word)\s*[:：]\s*/i, '').trim()
  const pronunciation = source.match(/(?:\/[^/\n]{1,64}\/|\[[^\]\n]{1,64}\])\s*$/)?.[0] ?? ''
  const lemma = source.slice(0, pronunciation ? source.lastIndexOf(pronunciation) : source.length).trim()
  return { lemma, pronunciation }
}

function plausibleLemma(value: string) {
  if (!value || value.length > 80 || /[。！？!?；;：:,，]/.test(value)) return false
  return /^[\p{L}\p{M}'’\-]+(?:\s+[\p{L}\p{M}'’\-]+){0,3}$/u.test(value)
}

export function parseQuickVocabularyCapture(source: string): QuickVocabularyDraft | undefined {
  const bounded = boundedSource(source)
  const lines = bounded.value.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 64)
  if (!lines.length) return undefined
  const { lemma, pronunciation } = parseLemmaLine(lines[0] ?? '')
  if (!plausibleLemma(lemma)) return undefined

  const forms: Record<string, string> = {}
  const senses: QuickVocabularySenseDraft[] = []
  let current: QuickVocabularySenseDraft | undefined
  let structuredLines = pronunciation ? 1 : 0

  for (const line of lines.slice(1)) {
    const posMatch = line.match(/^(n(?:oun)?|v(?:erb)?|adj(?:ective)?|adv(?:erb)?|prep(?:osition)?|pron(?:oun)?|conj(?:unction)?|num(?:eral)?|interj(?:ection)?|名词|动词|形容词|副词|介词|代词|连词|数词|感叹词)\.?\s*(?:[:：]\s*)?(.+)$/i)
    if (posMatch) {
      structuredLines += 1
      const pos = POS_ALIASES[(posMatch[1] ?? '').toLocaleLowerCase('en-US')] ?? (posMatch[1] ?? '')
      for (const definition of splitList(posMatch[2] ?? '', QUICK_VOCABULARY_SENSE_LIMIT - senses.length)) {
        if (senses.length >= QUICK_VOCABULARY_SENSE_LIMIT) break
        current = blankSense(pos)
        current.definition = definition
        senses.push(current)
      }
      continue
    }
    const metadata = line.match(/^(例句|例|example|examples|搭配|collocation|collocations|近义|近义词|同义词|易混词|synonym|synonyms|词形|forms?)\s*[:：]\s*(.+)$/i)
    if (metadata) {
      structuredLines += 1
      const key = (metadata[1] ?? '').toLocaleLowerCase('en-US')
      const value = metadata[2] ?? ''
      if (/^(?:词形|forms?)$/i.test(key)) {
        for (const pair of splitList(value).map(item => item.match(/^([^:=：]+)\s*[:=：]\s*(.+)$/)).filter(Boolean)) {
          const label = pair?.[1]?.trim().slice(0, 32)
          const form = pair?.[2]?.trim().slice(0, 80)
          if (label && form && !['__proto__', 'prototype', 'constructor'].includes(label.toLocaleLowerCase('en-US')) && Object.keys(forms).length < 12) forms[label] = form
        }
        continue
      }
      current ??= senses[0]
      if (!current) { current = blankSense(); senses.push(current) }
      const values = splitList(value)
      if (/^(?:例句|例|examples?)$/i.test(key)) appendUnique(current.examples, values)
      else if (/^(?:搭配|collocations?)$/i.test(key)) appendUnique(current.collocations, values)
      else appendUnique(current.synonyms, values)
      continue
    }
    if (!current && senses.length < QUICK_VOCABULARY_SENSE_LIMIT && line.length <= 500) {
      for (const definition of splitList(line, QUICK_VOCABULARY_SENSE_LIMIT)) {
        current = blankSense()
        current.definition = definition
        senses.push(current)
      }
    }
  }

  if (!senses.length) senses.push(blankSense())
  const singleToken = lines.length === 1 && !lemma.includes(' ')
  const language = /[ぁ-ゟ゠-ヿ]/u.test(lemma) ? '日语' : /^[\p{Script=Latin}\p{M}'’\-\s]+$/u.test(lemma) ? '英语' : '其他'
  return { lemma, language, pronunciation, forms, senses, confident: structuredLines > 0 || singleToken, truncated: bounded.truncated || lines.length >= 64 || senses.length >= QUICK_VOCABULARY_SENSE_LIMIT }
}

function questionTypeOf(source: string): QuestionType {
  if (/```|\b(?:const|let|var|class|def|function|public|private|return)\b|复杂度|算法|代码/i.test(source)) return 'algorithm'
  if (/[∑∫√≈≠≤≥]|\$[^$]+\$|方程|函数|证明|计算/i.test(source)) return 'math'
  if (/物理|化学|生物|实验|定律/i.test(source)) return 'science'
  return 'general'
}

export function parseQuickQuestionCapture(source: string): QuickQuestionDraft | undefined {
  const bounded = boundedSource(source)
  if (!bounded.value) return undefined
  const details: QuestionDetails = { source: '', stem: '', answer: '', explanation: '', wrongAnswer: '', errorReason: '' }
  let current: keyof QuestionDetails = 'stem'
  let markerCount = 0
  let subject = '未分类'
  let tags: string[] = []

  for (const line of bounded.value.split('\n').slice(0, 160)) {
    const subjectMatch = line.match(/^(?:学科|分类|subject)\s*[:：]\s*(.+)$/i)
    if (subjectMatch) { subject = (subjectMatch[1] ?? '').trim().slice(0, 32) || subject; markerCount += 1; continue }
    const tagMatch = line.match(/^(?:标签|知识点|tags?)\s*[:：]\s*(.+)$/i)
    if (tagMatch) { tags = (tagMatch[1] ?? '').split(/[,，；;#]/).map(item => item.trim()).filter(Boolean).slice(0, 12); markerCount += 1; continue }
    const field = QUESTION_FIELDS.find(([, pattern]) => pattern.test(line))
    if (field) {
      const match = line.match(field[1])
      current = field[0]
      details[current] = match?.[1]?.trim() ?? ''
      markerCount += 1
      continue
    }
    details[current] = [details[current], line].filter(Boolean).join('\n').slice(0, QUICK_LEARNING_CAPTURE_LIMIT)
  }
  const stem = details.stem.trim() || bounded.value
  details.stem = stem
  const firstLine = stem.split('\n').find(Boolean)?.replace(/^#+\s*/, '').trim() ?? ''
  const title = firstLine.slice(0, 42) || '从快速捕获整理的题目'
  return {
    title,
    details,
    questionType: questionTypeOf(bounded.value),
    subject,
    tags,
    confident: markerCount >= 2 || /[?？]\s*$/.test(stem),
    truncated: bounded.truncated || bounded.value.split('\n').length > 160,
  }
}
