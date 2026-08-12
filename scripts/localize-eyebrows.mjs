/*
 * One-shot codemod replacing the decorative English eyebrow labels with
 * Chinese ones. The product ships in Chinese; an all-caps Latin kicker above
 * every Chinese heading read as decoration rather than as information, and it
 * forced the label into a monospace face with no CJK coverage.
 *
 * Run with `node scripts/localize-eyebrows.mjs` (add `--dry` to preview).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const LABELS = {
  '01 · CHOOSE TASK': '01 · 选择任务',
  '02 · CONFIRM INPUT': '02 · 确认输入',
  '03 · REVIEW DRAFT': '03 · 校对草稿',
  'ACTIVE RECALL': '主动回忆',
  'AVAILABLE NOW': '现在可用',
  'BYO AI · CONFIRMED CONTENT ONLY': '自带模型 · 只发送你确认过的内容',
  'CANVAS SETTINGS': '画布设置',
  'CODE SNAP STUDIO': '代码长图工作台',
  'CONFIRM ACTION': '请确认操作',
  'CONTINUE READING': '继续阅读',
  'CREATE SPACE · LOCAL FIRST': '创作空间 · 本地优先',
  'CUE EDITOR': '字幕条编辑',
  'DESKTOP PREFERENCES': '桌面偏好',
  DESTINATION: '输出位置',
  'EDITABLE RESULT': '识别结果 · 可编辑',
  'EXPLICIT CONTEXT ACTION': '上下文操作 · 需手动触发',
  'EXPORT COMPLETE': '导出完成',
  'FILE PROCESSING CENTER': '文件处理中心',
  'FOCUS NODE': '聚焦节点',
  'FOCUS SESSION': '专注时段',
  'FSRS · LOCAL REVIEW': 'FSRS · 本地复习',
  INPUT: '输入',
  'KNITSPACE LAB · LOCAL CAPABILITIES': '实验室 · 本地能力',
  'KNOWLEDGE HEALTH': '知识库健康度',
  'KNOWLEDGE RELATIONS · LOCAL METADATA': '知识关联 · 本地元数据',
  'KNOWLEDGE SPACE · LOCAL VAULT': '知识空间 · 本地库',
  'LATEST OUTPUTS': '最近产物',
  'LEARNING PULSE': '学习节奏',
  'LIFE MARKERS': '纪念日',
  'LIVE PREVIEW': '实时预览',
  'LOCAL DATA WORKBENCH': '本地数据工作台',
  'LOCAL DOCUMENT METRICS': '文档统计',
  'LOCAL DRAFT': '本地草稿',
  'LOCAL LEXICON': '本地词库',
  'LOCAL MARKDOWN VAULT': '本地 Markdown 库',
  'LOCAL MEDIA DESK': '本地媒体台',
  'LOCAL PACK': '本地工具包',
  'LOCAL SOURCE VAULT': '本地资料库',
  'LOCAL SPEECH TO TEXT': '本地语音转文字',
  'LOCAL SUBTITLE DESK': '本地字幕台',
  'LOCAL VISUAL CANVAS': '本地图像画布',
  'MAINTAIN THE QUEUE': '维护复习队列',
  'MY ATTEMPT': '我的作答',
  'NATIVE CAPABILITY': '系统原生能力',
  'NEW SNIPPET': '新建片段',
  'NEXT WORKFLOW': '下一步',
  'ONE OUTPUT': '选择输出',
  'OUTPUT SHELF': '产物架',
  'PASTE SOURCE': '粘贴源文本',
  'PERSONAL AUTOMATION PACK': '个人自动化包',
  'PINNED INSTRUMENTS': '常用工具',
  'PRIVATE CLIPBOARD': '私密剪贴板',
  'PROCESS LEDGER': '处理记录',
  'QUICK START': '快速开始',
  'QUICK TASKS': '快捷任务',
  'RECENT MATERIALS': '最近资料',
  'RECENT RUNS': '最近运行',
  'RECENT TOOLS': '最近工具',
  'RESEARCH QUEUE': '待研究',
  RESULT: '结果',
  'REVIEW SOURCES': '复习来源',
  SENSES: '义项',
  'SMART SETTINGS': '智能设置',
  'SOURCE IMAGE': '源图片',
  'STARRED CONTENT': '已收藏',
  'START HERE': '从这里开始',
  'START LOCALLY': '在本机开始',
  'START WITH A TASK': '先选一件事',
  'STRUCTURED INTAKE': '结构化导入',
  'STRUCTURED WORD': '结构化词条',
  'TASK CENTER': '任务中心',
  TIMELINE: '时间轴',
  'TODAY · LOCAL FIRST': '今天 · 本地优先',
  'TOOLS SPACE · LOCAL EXECUTION': '工具空间 · 本机执行',
  'UNIVERSAL INTAKE': '通用收集',
  'VISIBLE THREADS': '可见关联',
  VOCABULARY: '词汇',
  'WINDOWS LOCAL OCR': 'Windows 本地 OCR',
  WORKFLOWS: '工作流',
}

/** Labels that reach the template through a ternary or expression. */
const EXPRESSIONS = {
  "'UNSAVED LOCAL DRAFT'": "'未保存的本地草稿'",
  "'WINDOW BEHAVIOR'": "'窗口行为'",
  "'LOCAL REVIEW CARD'": "'本地复习卡'",
  "'LOCAL MARKDOWN'": "'本地 Markdown'",
  "'QUESTION & REVIEW'": "'题目与复习'",
  "'KNOWLEDGE LINKS'": "'知识关联'",
  "'LOCAL MARKDOWN VAULT'": "'本地 Markdown 库'",
  "'LOCAL REVIEW VAULT'": "'本地复习库'",
  "'VAULT MARKDOWN CONFLICT'": "'资料库 Markdown 冲突'",
  "'EXTERNAL MARKDOWN CONFLICT'": "'外部 Markdown 冲突'",
  "'LOCAL TOOL'": "'本地工具'",
}

const files = []
;(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (full.endsWith('.vue')) files.push(full)
  }
})('src')

const dry = process.argv.includes('--dry')
let replaced = 0
let touched = 0
const missed = new Set()

for (const file of files) {
  const original = readFileSync(file, 'utf8')

  let next = original.replace(
    /(class="eyebrow"[^>]*>)([^<]+)(<)/g,
    (whole, open, body, close) => {
      let text = body.trim()
      for (const [from, to] of Object.entries(EXPRESSIONS)) text = text.split(from).join(to)
      if (LABELS[text]) {
        replaced += 1
        return `${open}${LABELS[text]}${close}`
      }
      if (text !== body.trim()) {
        replaced += 1
        return `${open}${text}${close}`
      }
      if (/[A-Z]{3}/.test(text) && !/[一-鿿]/.test(text)) missed.add(`${file}: ${text}`)
      return whole
    },
  )

  // `LOCAL VAULT · {{ … }}` mixes a label with a counter, so it is handled here.
  next = next.replace(
    /(class="eyebrow"[^>]*>)LOCAL VAULT · /g,
    (whole, open) => {
      replaced += 1
      return `${open}本地资料库 · `
    },
  )

  if (next !== original) {
    touched += 1
    if (!dry) writeFileSync(file, next)
  }
}

console.log(`${dry ? 'dry run' : 'rewritten'}: ${replaced} labels across ${touched} files`)
if (missed.size) {
  console.log('\nstill English (expression or unmapped):')
  for (const item of missed) console.log('  ', item)
}
