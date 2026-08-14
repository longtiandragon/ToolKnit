/*
 * Headless capture of every route, used to review the visual pass without a
 * browser extension. Requires `vite` to already be serving on :1421.
 *
 *   node scripts/shoot-routes.mjs [route …]
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = process.env.SHOT_DIR || join(process.env.TEMP || '.', 'shots')

const ROUTES = [
  ['home', '/'],
  ['quick', '/quick'],
  ['knowledge', '/knowledge'],
  ['relations', '/relations'],
  ['library', '/library'],
  ['tools', '/tools'],

  ['media', '/media'],
  ['subtitles', '/subtitles'],
  ['ocr', '/ocr'],
  ['private-tools', '/private-tools'],
  ['history', '/history'],
  ['clipboard', '/clipboard'],
  ['developer-tools', '/developer-tools'],
  ['code-image', '/code-image'],
  ['visual', '/visual'],
  ['create', '/create'],
  ['ai', '/ai'],
  ['documents', '/documents'],
  ['words', '/words'],
  ['review', '/review'],
  ['lab', '/lab'],
  ['settings', '/settings'],
]

const wanted = process.argv.slice(2)
const targets = wanted.length ? ROUTES.filter(([name]) => wanted.includes(name)) : ROUTES

mkdirSync(OUT, { recursive: true })
for (const [name, route] of targets) {
  const file = join(OUT, `${name}.png`)
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1440,1000',
    '--virtual-time-budget=9000',
    `--screenshot=${file}`,
    `http://127.0.0.1:1421/#${route}`,
  ], { stdio: 'ignore' })
  console.log(name.padEnd(16), file)
}
