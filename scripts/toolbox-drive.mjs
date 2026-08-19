/*
 * Drives the toolbox board through the states that only exist mid-interaction.
 *
 * The board is almost entirely arrangement: blocks expand, blocks and tools are
 * dragged, menus reorder and hide, and every one of those has a persisted
 * consequence. A screenshot of `/` shows none of it — it shows the default
 * layout, which is the one state that was never in doubt. So this actually
 * expands, drags, right-clicks and reloads, and captures each step.
 *
 * Uses the Chrome already installed on the machine; no browser download.
 *
 *   pnpm dev            # in another terminal, 127.0.0.1:1421
 *   node scripts/toolbox-drive.mjs [dark|light]
 *
 * Browser-only: no Vault, so 常用/最近使用 are seeded through localStorage the
 * same way the app would have written them.
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const BASE = 'http://127.0.0.1:1421/#'
const OUT = join(process.env.TEMP || '.', 'toolbox-board')

mkdirSync(OUT, { recursive: true })

/* A complete, valid persisted workspace with pinned tools and a usage history,
   so both personal strips are populated. It must satisfy the same validator the
   app uses on boot (`parsePersistedWorkspace`), or the store silently discards
   it and the strips come up empty for reasons that look like a UI bug. The key
   is one of the historical `toolknit:` names the README still documents. */
const STORE_KEY = 'toolknit:workspace:v1'

const SEED = {
  sources: [],
  documents: [],
  jobs: [],
  aiProfiles: [],
  recipes: [],
  pipelineRecipes: [],
  activeVaultName: '我的 KnitspaceVault',
  favorites: [
    { toolId: 'local-ocr', order: 0, shortcut: 1 },
    { toolId: 'pdf-merge', order: 1, shortcut: 2 },
    { toolId: 'code-image', order: 2, shortcut: 3 },
    { toolId: 'subtitle-editor', order: 3, shortcut: 4 },
  ],
  toolUsages: [
    { toolId: 'developer-json', route: '/developer-tools', usedAt: '2026-08-18T09:00:00.000Z' },
    { toolId: 'image-concat', route: '/visual', usedAt: '2026-08-18T08:00:00.000Z' },
    { toolId: 'scroll-capture', route: '/visual', usedAt: '2026-08-18T07:00:00.000Z' },
  ],
}

async function run() {
  const theme = process.argv[2] === 'light' ? 'light' : 'dark'
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const context = await browser.newContext({ viewport: { width: 1600, height: 950 } })
  await context.addInitScript(
    ([value, seed, key]) => {
      window.localStorage.setItem('knitspace:theme', value)
      /* Seed once. `addInitScript` runs before *every* navigation, so writing
         unconditionally would replay the seed on reload and wipe whatever the
         board had just persisted — which reads exactly like the arrangement
         failing to save. */
      if (!window.localStorage.getItem(key)) window.localStorage.setItem(key, JSON.stringify(seed))
    },
    [theme, SEED, STORE_KEY],
  )
  const page = await context.newPage()
  const shots = []
  console.log(`theme: ${theme}`)

  const shot = async (label) => {
    const file = join(OUT, `${theme}-${String(shots.length + 1).padStart(2, '0')}-${label}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots.push(file)
    console.log('  captured', label)
  }

  const settle = (ms = 500) => page.waitForTimeout(ms)
  /* `section.panel`, not `section`: the app shell's own top bar is a section
     too, and its 后退/前进 buttons carry `aria-expanded`, so a looser selector
     picks the shell instead of the block. */
  const block = (label) => page.locator('section.panel', { has: page.locator(`b:text-is("${label}")`) }).first()
  const blockTitle = (label) => block(label).locator('header button[aria-expanded], header button[aria-haspopup=menu]').first()
  const blockTitles = () => page.locator('section.panel > header b').allInnerTexts()

  // ── The default board ──────────────────────────────────────────────────
  console.log('flow: 默认看板')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await settle(1200)
  await shot('default')
  console.log('  blocks:', (await blockTitles()).join(' · '))

  // ── Expanding a workbench ──────────────────────────────────────────────
  console.log('flow: 展开 PDF 工作台')
  await blockTitle('PDF 工作台').click()
  await settle(600)
  await shot('pdf-expanded')

  // ── Reordering a tool inside a block, by keyboard ──────────────────────
  console.log('flow: 块内工具排序 (Alt + →)')
  const firstTool = block('PDF 工作台').locator('a[draggable=true]').first()
  const before = await firstTool.innerText()
  await firstTool.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await settle(500)
  const after = await block('PDF 工作台').locator('a[draggable=true]').first().innerText()
  console.log(`  first tool: ${before.split('\n')[0]} → ${after.split('\n')[0]}`)
  await shot('tool-reordered')

  // ── A block menu ───────────────────────────────────────────────────────
  console.log('flow: 工作台右键菜单')
  await blockTitle('开发者工具').click({ button: 'right' })
  await settle(400)
  await shot('block-menu')

  console.log('flow: 移到最前')
  await page.locator('[role=menuitem]', { hasText: '移到最前' }).click()
  await settle(600)
  console.log('  order now:', (await blockTitles()).slice(0, 4).join(' · '))
  await shot('block-moved-top')

  // ── Hiding, and the way back ───────────────────────────────────────────
  console.log('flow: 隐藏一个工作台')
  await block('处理历史').locator('button[aria-label$="操作"]').click()
  await settle(400)
  await page.locator('[role=menuitem]', { hasText: '从工具箱隐藏' }).click()
  await settle(700)
  await shot('block-hidden')

  // ── Keyboard-only menu: Shift+F10 and Escape ───────────────────────────
  console.log('flow: Shift+F10 打开菜单并 Escape 关闭')
  await blockTitle('媒体转换台').focus()
  await page.keyboard.press('Shift+F10')
  await settle(400)
  await shot('menu-from-keyboard')
  const menuFocused = await page.evaluate(() => document.activeElement?.getAttribute('role'))
  console.log('  focus moved into menu:', menuFocused === 'menuitem')
  await page.keyboard.press('Escape')
  await settle(300)
  const restored = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded') !== null)
  console.log('  focus restored to trigger:', restored)

  // ── The arrangement has to survive a reload ────────────────────────────
  console.log('flow: 重新加载后保持')
  await page.reload({ waitUntil: 'networkidle' })
  await settle(1200)
  console.log('  order after reload:', (await blockTitles()).slice(0, 4).join(' · '))
  console.log('  hidden strip present:', await page.locator('text=已隐藏').first().isVisible())
  await shot('after-reload')

  // ── Search collapses the board ─────────────────────────────────────────
  console.log('flow: 搜索')
  await page.locator('input[type=search]').fill('压缩')
  await settle(600)
  await shot('search')

  await page.locator('input[type=search]').fill('')
  await settle(400)

  // ── Reset ──────────────────────────────────────────────────────────────
  console.log('flow: 恢复默认排版')
  await page.locator('button:has-text("恢复默认排版")').click()
  await settle(700)
  console.log('  order after reset:', (await blockTitles()).slice(0, 4).join(' · '))
  await shot('after-reset')

  // ── A category route ───────────────────────────────────────────────────
  console.log('flow: 分类路由 /c/pdf')
  await page.goto(`${BASE}/c/pdf`, { waitUntil: 'networkidle' })
  await settle(900)
  await shot('category-pdf')

  // ── The Tauri minimum window ───────────────────────────────────────────
  console.log('flow: 900 × 680 最小窗口')
  await page.setViewportSize({ width: 900, height: 680 })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await settle(900)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log('  horizontal overflow:', overflow, 'px')
  await shot('min-window')

  await browser.close()
  console.log(`\n${shots.length} shots in ${OUT}`)
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
