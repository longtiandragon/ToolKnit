/*
 * Drives /documents through the states that only exist after you use it.
 *
 * The route opens on an empty library, so the editor, its toolbars, the
 * question rail and the inspector never appear in a plain screenshot. This
 * creates real documents through the page's own buttons and types into them.
 *
 *   node scripts/documents-drive.mjs [dark|light]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'documents-flow')

mkdirSync(OUT, { recursive: true })

const SAMPLE = `---
title: 图论最短路
tags: [算法, 图论]
status: 复习中
---

# 最短路三兄弟

Dijkstra 适用于**非负权**图，复杂度 \`O(m log n)\`。

## Bellman-Ford

可以处理负权边，也能检测负环。

| 算法 | 负权 | 复杂度 |
| --- | --- | --- |
| Dijkstra | 否 | O(m log n) |
| Bellman-Ford | 是 | O(nm) |

## SPFA

队列优化的 Bellman-Ford，最坏仍是 O(nm)。见 [[并查集]]。
`

async function run() {
  const theme = process.argv[2] === 'light' ? 'light' : 'dark'
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  await context.addInitScript((value) => window.localStorage.setItem('knitspace:theme', value), theme)
  const page = await context.newPage()
  const shots = []
  const shot = async (label) => {
    const file = join(OUT, `${theme}-${String(shots.length + 1).padStart(2, '0')}-${label}.png`)
    await page.screenshot({ path: file })
    shots.push(file)
    console.log('  captured', label)
  }

  console.log(`theme: ${theme}`)

  await page.goto(`${BASE}/documents?kind=note`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('notes-empty')

  await page.locator('button:has-text("新建笔记")').first().click()
  await page.waitForTimeout(900)
  await shot('note-blank')

  // Write a real document, so the outline, statistics and frontmatter fill in.
  await page.locator('button:has-text("编辑")').first().click()
  await page.waitForTimeout(700)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(SAMPLE)
  await page.waitForTimeout(1600)
  await shot('note-edit')

  await page.locator('input[aria-label="标题"]').fill('图论最短路')
  await page.waitForTimeout(500)
  await page.locator('button:has-text("分屏")').first().click()
  await page.waitForTimeout(1800)
  await shot('note-split')

  // The frontmatter strip only says anything once the YAML block exists.
  await page.locator('button[aria-controls="markdown-frontmatter-details"]').click()
  await page.waitForTimeout(600)
  await shot('note-frontmatter')
  await page.locator('button[aria-controls="markdown-frontmatter-details"]').click()

  await page.locator('button:has-text("加标签")').first().click()
  await page.waitForTimeout(400)
  await page.locator('input[placeholder*="添加标签"]').fill('最短路')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  await shot('note-tags')
  await page.keyboard.press('Escape')
  await page.locator('input[aria-label="标题"]').click()

  await page.locator('button:has-text("预览")').first().click()
  await page.waitForTimeout(1800)
  await shot('note-preview')

  // Statistics popover opens upward out of the status bar.
  await page.locator('footer[aria-label="Markdown 文档状态"] button').first().click()
  await page.waitForTimeout(600)
  await shot('note-statistics')
  await page.keyboard.press('Escape')
  await page.locator('footer[aria-label="Markdown 文档状态"] button').first().click()
  await page.waitForTimeout(300)

  // A second note, so the list has more than one row to show selection.
  await page.locator('button:has-text("新建笔记")').first().click()
  await page.waitForTimeout(900)
  await shot('note-list')

  // Questions: a different list column and a question structure rail.
  await page.goto(`${BASE}/documents?kind=question`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await shot('question-empty')
  await page.locator('button:has-text("新建错题")').first().click()
  await page.waitForTimeout(1000)
  await shot('question-new')

  await page.locator('button:has-text("题目与复习")').first().click()
  await page.waitForTimeout(900)
  await shot('question-inspector')

  await browser.close()

  const html = `<html><body style="margin:0;background:#111;font:11px sans-serif">
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;padding:4px">${shots
      .map((file) => `<figure style="margin:0"><img src="file:///${file.replace(/\\/g, '/')}" style="width:100%;display:block"><figcaption style="color:#6cf;padding:2px">${file.split(/[\\/]/).pop()}</figcaption></figure>`)
      .join('')}</div></body></html>`
  writeFileSync(join(OUT, `sheet-${theme}.html`), html)
  console.log(`\n${shots.length} states captured → ${OUT}`)
}

run().catch((error) => {
  console.error('flow failed:', error.message)
  process.exit(1)
})
