import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputDirectory = resolve(projectRoot, 'benchmarks/generated')

// A single "large document" fixture is too easy to tune around. These three
// profiles exercise the same Markdown features at increasingly realistic
// vault sizes while remaining generated (and therefore out of the release).
const benchmarkProfiles = [
  { id: '1', fileName: 'markdown-stress.md', label: '1 MB', targetBytes: 1_250_000, minimumBytes: 1_100_000, maximumBytes: 1_500_000, sections: 240, formulaBlocks: 100, codeBlocks: 100, mermaidBlocks: 20, imageReferences: 16 },
  { id: '3', fileName: 'markdown-stress-3mb.md', label: '3 MB', targetBytes: 3_000_000, minimumBytes: 2_850_000, maximumBytes: 3_150_000, sections: 480, formulaBlocks: 180, codeBlocks: 180, mermaidBlocks: 40, imageReferences: 32 },
  { id: '5', fileName: 'markdown-stress-5mb.md', label: '5 MB', targetBytes: 4_850_000, minimumBytes: 4_650_000, maximumBytes: 5_000_000, sections: 720, formulaBlocks: 240, codeBlocks: 240, mermaidBlocks: 60, imageReferences: 48 },
]

function selectedProfiles() {
  const sizeArgument = process.argv.find((argument) => argument.startsWith('--size='))
  if (!sizeArgument) return benchmarkProfiles
  const profile = benchmarkProfiles.find((candidate) => candidate.id === sizeArgument.slice('--size='.length))
  if (!profile) throw new Error('未知的基准档位。可用值：--size=1、--size=3、--size=5。')
  return [profile]
}

function shouldPlaceBlock(section, sectionCount, blockCount) {
  // Distribute expensive Markdown features through the whole document. A
  // burst at the top would not exercise viewport-driven hydration later on.
  return Math.floor((section * blockCount) / sectionCount) !== Math.floor(((section - 1) * blockCount) / sectionCount)
}

function buildBenchmark(profile) {
  const blocks = [
    '---',
    `title: Knitspace ${profile.label} Markdown 压力文档`,
    'tags: [benchmark, markdown, performance]',
    `performanceProfile: ${profile.label}`,
    '---',
    '',
    `# Knitspace ${profile.label} Markdown 压力文档`,
    '',
    '> 此文件用于桌面端 Markdown 的人工性能回归：编辑、分栏预览、阅读、目录跳转与右键菜单都应保持可响应。',
    '',
    '- [x] Worker 解析',
    '- [x] 大文档按需预览',
    '- [ ] 人工记录本机渲染时间',
    '',
    '| 项目 | 目标 |',
    '| --- | --- |',
    `| 文档规模 | ${profile.label} |`,
    `| 标题 | ${profile.sections} 个以上 |`,
    `| 公式与代码 | 分别 ${profile.formulaBlocks} 个以上 |`,
    '',
  ]

  for (let section = 1; section <= profile.sections; section += 1) {
    const level = section % 9 === 0 ? '####' : section % 3 === 0 ? '###' : '##'
    blocks.push(`${level} 第 ${section} 节：算法、公式与工程记录`)
    blocks.push('这是一段用于测试编辑器增量输入、滚动与文本排版的中文正文。它混合 English identifiers、`snake_case`、链接和 [[知识网络]]，不应让单一长笔记降低桌面端操作响应。')
    blocks.push('')

    if (shouldPlaceBlock(section, profile.sections, profile.formulaBlocks)) {
      blocks.push('$$')
      blocks.push(`f_${section}(x) = \\sum_{i=1}^{n} \\frac{x_i^2 + ${section}}{1 + e^{-x_i}}`)
      blocks.push('$$')
      blocks.push('')
    }

    if (shouldPlaceBlock(section, profile.sections, profile.codeBlocks)) {
      blocks.push('```ts')
      blocks.push(`export function benchmarkBlock${section}(values: number[]) {`)
      blocks.push(`  return values.reduce((sum, value) => sum + value * ${section}, 0)`)
      blocks.push('}')
      blocks.push('```')
      blocks.push('')
    }

    if (shouldPlaceBlock(section, profile.sections, profile.mermaidBlocks)) {
      blocks.push('```mermaid')
      blocks.push('flowchart LR')
      blocks.push(`  A${section}[输入] --> B${section}[解析] --> C${section}[预览]`)
      blocks.push('```')
      blocks.push('')
    }

    if (shouldPlaceBlock(section, profile.sections, profile.imageReferences)) {
      blocks.push(`![相对路径图片 ${section}](images/benchmark-${section}.png "懒加载测试")`)
      blocks.push('')
    }
  }

  blocks.push('## 超长单行文本')
  blocks.push('x'.repeat(28_000))
  blocks.push('')
  const filler = `这段可重复正文用于将压力文档稳定维持在约 ${profile.label}；它应只影响显式加载的完整预览，不影响常规笔记的打开、输入、右键菜单与导航。`
  let size = Buffer.byteLength(blocks.join('\n'), 'utf8')
  const fillerSize = Buffer.byteLength(`${filler}\n`, 'utf8')
  while (size < profile.targetBytes) {
    blocks.push(filler)
    size += fillerSize
  }
  return `${blocks.join('\n')}\n`
}

function validate(content, profile) {
  const size = Buffer.byteLength(content, 'utf8')
  const checks = [
    [size >= profile.minimumBytes && size <= profile.maximumBytes, `大小不在 ${profile.label} 档位范围内`],
    [(content.match(/^#{1,6} /gm) ?? []).length >= profile.sections, `标题数量不足 ${profile.sections}`],
    [(content.match(/^\$\$$/gm) ?? []).length >= profile.formulaBlocks * 2, `公式块不足 ${profile.formulaBlocks}`],
    [(content.match(/^```ts$/gm) ?? []).length >= profile.codeBlocks, `代码块不足 ${profile.codeBlocks}`],
    [(content.match(/^```mermaid$/gm) ?? []).length >= profile.mermaidBlocks, `Mermaid 图表不足 ${profile.mermaidBlocks}`],
    [(content.match(/^!\[/gm) ?? []).length >= profile.imageReferences, `相对图片引用不足 ${profile.imageReferences}`],
    [content.includes('| 项目 | 目标 |') && content.includes('- [x] Worker 解析'), '缺少表格或任务列表'],
    [content.split('\n').some((line) => line.length >= 20_000), '缺少超长单行文本'],
  ]
  const failures = checks.filter(([passed]) => !passed).map(([, message]) => message)
  if (failures.length) throw new Error(`${profile.label} Markdown 基准校验失败：${failures.join('；')}`)
}

const profiles = selectedProfiles()
if (process.argv.includes('--check')) {
  for (const profile of profiles) {
    const outputPath = resolve(outputDirectory, profile.fileName)
    const content = await readFile(outputPath, 'utf8')
    validate(content, profile)
    console.log(`Markdown benchmark verified: ${profile.label} (${outputPath})`)
  }
} else {
  await mkdir(outputDirectory, { recursive: true })
  for (const profile of profiles) {
    const outputPath = resolve(outputDirectory, profile.fileName)
    const content = buildBenchmark(profile)
    validate(content, profile)
    await writeFile(outputPath, content, 'utf8')
    console.log(`Markdown benchmark generated: ${profile.label} (${Math.round(Buffer.byteLength(content, 'utf8') / 1024)} KB)`)
  }
}
