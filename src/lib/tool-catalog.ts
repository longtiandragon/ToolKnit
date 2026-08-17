import { personalPackEnabled } from '@/lib/build-profile'

export type CatalogGroup = 'PDF' | '图片' | '媒体' | '文本' | '整理' | '开发' | '表达' | 'AI' | '资料'

export interface ToolCatalogItem {
  id: string
  title: string
  description: string
  group: CatalogGroup
  icon: string
  to: { path: string; query?: Record<string, string> }
  keywords: string[]
  popular?: boolean
}

export interface CommandToolGroup {
  id: 'favorites' | 'recents' | 'suggested'
  label: string
  tools: ToolCatalogItem[]
}

export interface ToolWorkflow {
  id: string
  title: string
  description: string
  icon: string
  toolIds: string[]
}

/* The toolbox's own category ids, by catalogue group. Kept here rather than
   imported from `toolbox-nav`, which reads this module — and short enough that
   the duplication is cheaper than the cycle. `buildToolCategories` is the
   other half; the two are checked against each other in the tests. */
const toolboxCategoryByGroup: Record<CatalogGroup, string> = {
  PDF: 'pdf',
  图片: 'image',
  文本: 'text',
  开发: 'dev',
  媒体: 'media',
  整理: 'organize',
  表达: 'express',
  AI: 'ai',
  资料: 'source',
}

/** Where "show me where this belongs" goes. Creation and source workflows have
 * their own spaces; every other tool lives in the toolbox, on its category
 * page — which is the same grid as the home route, already filtered. */
export function toolCatalogOwnerLocation(tool: ToolCatalogItem) {
  if (tool.group === '资料') return { path: '/knowledge' }
  if ((tool.group === '表达' && tool.id !== 'utility-qrcode') || tool.group === 'AI') return { path: '/create' }
  return { path: `/c/${toolboxCategoryByGroup[tool.group]}` }
}

function fileTool(id: string, title: string, description: string, group: 'pdf' | 'image' | 'text' | 'organize', icon: string, keywords: string[], query: Record<string, string> = {}): ToolCatalogItem {
  const groupLabel = { pdf: 'PDF', image: '图片', text: '文本', organize: '整理' } as const
  return { id: `${group}-${id}${query.mode ? `-${query.mode}` : ''}`, title, description, group: groupLabel[group], icon, to: { path: '/tools', query: { group, operation: id, ...query } }, keywords }
}

function imageTool(id: string, title: string, description: string, icon: string, keywords: string[]): ToolCatalogItem {
  return { id: `image-${id}`, title, description, group: '图片', icon, to: { path: '/visual', query: { tool: id } }, keywords }
}

export const toolCatalog: ToolCatalogItem[] = [
  { id: 'universal-intake', title: '万能处理入口', description: '拖入或粘贴内容，自动推荐下一步', group: '整理', icon: 'inbox', to: { path: '/quick' }, keywords: ['快速处理', '万能', '粘贴', '拖入', '智能推荐'], popular: true },
  { id: 'tool-pipeline', title: '文本流水线', description: '把多个文本工具串成一次可复用处理', group: '整理', icon: 'task', to: { path: '/tools', query: { mode: 'pipeline' } }, keywords: ['流水线', '配方', '批处理', '自动化', 'recipe', 'pipeline'], popular: true },
  { id: 'archive-zip', title: '归档', description: 'ZIP、7Z、TAR', group: '整理', icon: 'archive', to: { path: '/tools', query: { mode: 'archive' } }, keywords: ['zip', '7z', 'tar'] },
  { id: 'local-ocr', title: '离线文字识别', description: '用 Windows 本机语言包提取截图和扫描图片文字', group: '文本', icon: 'file-text', to: { path: '/ocr' }, keywords: ['OCR', '识字', '图片文字', '扫描题', '截图', '离线', 'Windows'], popular: true },
  { ...fileTool('merge', '合并 PDF', '把多份 PDF 按顺序合成一份', 'pdf', 'merge', ['拼接', 'combine', 'merge']), popular: true },
  fileTool('split', '拆分 PDF', '把每一页导出为独立 PDF', 'pdf', 'split', ['分页', 'split']),
  fileTool('rotate', '旋转 PDF', '批量旋转 PDF 页面方向', 'pdf', 'rotate', ['方向', 'rotate']),
  fileTool('extract', '提取 PDF 页面', '按页码范围生成新的 PDF', 'pdf', 'extract', ['页码', '抽取', 'extract']),
  fileTool('reorder', '重排 PDF 页面', '按指定顺序重新组织页面', 'pdf', 'sort', ['排序', '页面顺序']),
  fileTool('watermark', 'PDF 添加水印', '添加文字水印并控制颜色和透明度', 'pdf', 'watermark', ['watermark', '版权']),
  fileTool('page-number', 'PDF 添加页码', '设置起始数字和页码位置', 'pdf', 'number', ['编号', 'page number']),
  fileTool('images-to-pdf', '图片转 PDF', '把多张图片合成一份 PDF', 'pdf', 'file-image', ['照片', 'image to pdf']),
  fileTool('pdf-to-image', 'PDF 转图片', '把 PDF 每一页渲染成 PNG、JPG 或 WebP 图片', 'pdf', 'image', ['导出图片', '渲染', 'png', 'jpg', 'webp', 'pdf to image']),
  fileTool('text', '提取 PDF 文字', '文字层/表单字段', 'pdf', 'file-text', ['文本', '复制', 'extract text']),
  fileTool('protect', 'PDF 密码', '加解密', 'pdf', 'shield', ['密码']),
  { ...imageTool('convert', '转换图片格式', 'PNG/JPG/WebP 转换预览', 'image', ['格式', 'png', 'jpg', 'webp']), popular: true },
  imageTool('resize', '缩放压缩图片', '限制最大宽度、调整质量并实时预览', 'resize', ['压缩', '尺寸', 'resize']),
  imageTool('crop', '裁剪图片', '在图片工作室实时查看裁剪结果', 'crop', ['截图', 'crop']),
  imageTool('rotate', '旋转图片', '实时预览方向并批量导出', 'rotate', ['方向', 'rotate']),
  imageTool('metadata', '元数据', 'EXIF/XMP/IPTC/GPS', 'shield', []),
  { id: 'image-mosaic', title: '图片打码', description: '拖出区域，导出时渲染成真实马赛克', group: '图片', icon: 'mosaic', to: { path: '/visual', query: { annotation: 'mosaic' } }, keywords: ['打码', '马赛克', '遮挡', '隐私', 'pixelate'] },
  { id: 'image-doodle', title: '图片涂鸦', description: '自由画笔在图上涂色标记', group: '图片', icon: 'pen', to: { path: '/visual', query: { annotation: 'pen' } }, keywords: ['涂色', '涂鸦', '画笔', '画线', '标记', 'draw'] },
  { id: 'media-desk', title: '音视频转换', description: 'FFmpeg 转换、提取与轨道管理', group: '媒体', icon: 'play', to: { path: '/media' }, keywords: ['视频', '音频', 'mp3', 'mp4', 'm4a', 'ffmpeg', '提取音频', '移除音轨', '移除字幕', '加入字幕', '音量标准化', '静音检测黑场检测'] },
  { id: 'media-clip', title: '截取音视频片段', description: '按开始与结束时间生成新的本地片段', group: '媒体', icon: 'cut', to: { path: '/media', query: { operation: 'clip' } }, keywords: ['剪辑', '裁剪视频', '截取音频', 'trim', 'clip', '录课片段'] },
  { id: 'media-speech-wav', title: '音频转语音 WAV', description: '生成适合本机转写和语音处理的 16 kHz 单声道 WAV', group: '媒体', icon: 'file-text', to: { path: '/media', query: { operation: 'transcode-wav' } }, keywords: ['wav', '16khz', '单声道', '语音预处理', '音频转码'] },
  { id: 'media-mute-video', title: '生成静音视频', description: '移除视频音轨并生成新的 H.264 MP4，原件保持不变', group: '媒体', icon: 'play', to: { path: '/media', query: { operation: 'mute-video' } }, keywords: ['视频静音', '去声音', '移除音轨', 'mute', 'silent video'] },
  { id: 'subtitle-editor', title: '字幕校对与转换', description: '本地编辑 SRT / WebVTT、平移时间轴并拆分合并字幕', group: '媒体', icon: 'file-text', to: { path: '/subtitles' }, keywords: ['字幕', 'srt', 'vtt', 'webvtt', '时间轴', '校对', '字幕转换', 'subtitle', 'caption'], popular: true },
  { id: 'local-transcription', title: '本机语音转写', description: '调用 whisper.cpp，把本地媒体转成可校对 SRT', group: '媒体', icon: 'play', to: { path: '/subtitles', query: { transcribe: '1' } }, keywords: ['语音转文字', '音频转字幕', '视频转字幕', 'whisper', 'whisper.cpp', '转写', 'transcript', 'speech to text'], popular: true },
  { ...fileTool('transform', '格式化 JSON', '整理缩进并检查 JSON 语法', 'text', 'json', ['json', '美化', '校验'], { mode: 'json' }), popular: true },
  fileTool('transform', '清理纯文本', '移除尾随空格和多余空行', 'text', 'file-text', ['trim', '空格'], { mode: 'trim' }),
  fileTool('transform', '清理 Markdown', '统一换行并压缩多余空行', 'text', 'file-code', ['markdown', 'md'], { mode: 'markdown' }),
  fileTool('transform', '删除文本重复行', '保留第一次出现的内容并清除空行', 'text', 'duplicate', ['去重', '名单', '行'], { mode: 'dedupe-lines' }),
  fileTool('transform', '自然排序文本行', '按中文、数字和字母顺序整理清单', 'text', 'sort', ['排序', '名单', '自然排序'], { mode: 'sort-lines' }),
  fileTool('transform', '提取链接与邮箱', '从长文本中汇总网址和邮箱地址', 'text', 'link', ['网址', 'url', 'email', '邮箱'], { mode: 'extract-contacts' }),
  fileTool('transform', '统计字数与段落', '本地统计字符、词语、段落和行数', 'text', 'number', ['字数', '字符', '段落', '统计'], { mode: 'statistics' }),
  fileTool('rename-report', '批量命名预览', '生成安全的重命名结果清单', 'organize', 'rename', ['rename', '编号']),
  { id: 'organize-dedupe-report', title: '文件去重扫描', description: '精确重复、相似图片、健康与目录对比', group: '整理', icon: 'search', to: { path: '/tools', query: { mode: 'file-health' } }, keywords: ['查重', '去重', '相似图片', '图片相似', '对比', 'Czkawka'] },
  { id: 'utility-qrcode', title: '二维码生成与识别', description: '把文字或网址生成二维码，也能读取图片', group: '表达', icon: 'qr-code', to: { path: '/developer-tools', query: { tool: 'qrcode' } }, keywords: ['二维码', 'QR', '扫码', '网址分享'] },
  { id: 'utility-datecalc', title: '日期计算器', description: '计算日期间隔，或向前向后推算日期', group: '整理', icon: 'calendar', to: { path: '/developer-tools', query: { tool: 'datecalc' } }, keywords: ['日期', '天数', '倒计时', '间隔', '月末'] },
  { id: 'developer-base64', title: 'Base64 编解码', description: '支持中文与 Emoji 的文本转换', group: '开发', icon: 'code', to: { path: '/developer-tools', query: { tool: 'base64' } }, keywords: ['base64', '编码', '解码'] },
  { id: 'developer-base32', title: 'Base32 编解码', description: 'RFC 4648 文本编码与解码', group: '开发', icon: 'code', to: { path: '/developer-tools', query: { tool: 'base32' } }, keywords: ['base32', 'rfc4648', '编码', '解码'] },
  { id: 'developer-base58', title: 'Base58 编解码', description: 'Bitcoin 字符表文本编码与解码', group: '开发', icon: 'binary', to: { path: '/developer-tools', query: { tool: 'base58' } }, keywords: ['base58', 'bitcoin', '编码', '解码'] },
  { id: 'developer-compress', title: 'GZip / Deflate', description: '把文本压缩为 Base64，或从 Base64 解压', group: '开发', icon: 'archive', to: { path: '/developer-tools', query: { tool: 'compress' } }, keywords: ['gzip', 'deflate', '压缩', '解压', 'base64'] },
  { id: 'developer-url', title: 'URL 编解码', description: '处理查询参数和特殊字符', group: '开发', icon: 'link', to: { path: '/developer-tools', query: { tool: 'url' } }, keywords: ['url', 'encodeURIComponent', '百分号'] },
  { id: 'developer-json', title: 'JSON 格式化与压缩', description: '格式化/压缩/JSONPath', group: '开发', icon: 'json', to: { path: '/developer-tools', query: { tool: 'json' } }, keywords: ['json', 'jsonpath'] },
  { id: 'developer-jwt', title: 'JWT 查看器', description: '本地读取 Header、Payload 与过期时间', group: '开发', icon: 'shield', to: { path: '/developer-tools', query: { tool: 'jwt' } }, keywords: ['token', 'claims', 'header', 'payload'] },
  { id: 'developer-hash', title: 'SHA-256 文本哈希', description: '生成文本内容的十六进制指纹', group: '开发', icon: 'hash', to: { path: '/developer-tools', query: { tool: 'hash' } }, keywords: ['sha256', 'hash', '摘要', '校验'] },
  { id: 'developer-uuid', title: 'UUID 批量生成', description: '一次生成最多 100 个 UUID v4', group: '开发', icon: 'fingerprint', to: { path: '/developer-tools', query: { tool: 'uuid' } }, keywords: ['guid', 'random', '唯一标识'] },
  { id: 'developer-timestamp', title: '时间戳转换', description: '秒、毫秒时间戳与日期互转', group: '开发', icon: 'clock', to: { path: '/developer-tools', query: { tool: 'timestamp' } }, keywords: ['unix', 'timestamp', '日期'] },
  { id: 'developer-radix', title: '整数进制转换', description: '支持 2 到 36 进制与超大整数', group: '开发', icon: 'binary', to: { path: '/developer-tools', query: { tool: 'radix' } }, keywords: ['binary', 'hex', '二进制', '十六进制'] },
  { id: 'developer-regex', title: '正则表达式测试', description: '查看匹配索引和捕获组', group: '开发', icon: 'regex', to: { path: '/developer-tools', query: { tool: 'regex' } }, keywords: ['regex', 'regexp', '匹配'] },
  { id: 'developer-diff', title: '文本 Diff', description: '逐行比较新增、删除和相同行', group: '开发', icon: 'diff', to: { path: '/developer-tools', query: { tool: 'diff' } }, keywords: ['diff', '比较', '差异'] },
  ...(personalPackEnabled ? [{ id: 'private-tools', title: '私人工具包', description: '用外部 JSON 清单安全运行你的本机脚本', group: '开发' as const, icon: 'terminal', to: { path: '/private-tools' }, keywords: ['python', '脚本', '自动化', 'dry run', '私人工具'], popular: true }] : []),
  { id: 'job-history', title: '处理历史', description: '回看文件、媒体和脚本任务的结果与输出位置', group: '整理', icon: 'clock', to: { path: '/history' }, keywords: ['历史', '输出', '任务记录', 'recent runs'] },
  { id: 'clipboard-history', title: '剪贴板历史', description: '重新复制、固定或归档最近收集的文本、代码和图片', group: '整理', icon: 'clipboard', to: { path: '/clipboard' }, keywords: ['剪贴板', '粘贴', '复制', '收集'] },
  { id: 'visual-card', title: '图片分享卡', description: '拼图、标题、水印与标注', group: '表达', icon: 'palette', to: { path: '/visual' }, keywords: ['拼图', '海报', '标注'], popular: true },
  { id: 'scroll-capture', title: '滚动截图拼接', description: '自动识别连续截图重叠并生成 PNG 长图', group: '表达', icon: 'sort', to: { path: '/visual', query: { tool: 'stitch' } }, keywords: ['滚动截图', '长截图', '网页截图', '拼接', 'stitch', 'overlap'], popular: true },
  imageTool('concat', '图片拼成长图', '多张图片上下或左右拼接，可留白或叠压', 'gallery', ['拼长图', '拼接', '荣誉墙', '照片墙', 'long image', 'wall']),
  { id: 'code-image', title: '代码分享图', description: '高亮并按行分页导出 PNG 或 PDF', group: '表达', icon: 'terminal', to: { path: '/code-image' }, keywords: ['代码截图', '高亮', 'code'], popular: true },
  { id: 'ai-content', title: 'AI 内容处理', description: '摘要、翻译、改写与信息提取', group: 'AI', icon: 'sparkle', to: { path: '/ai' }, keywords: ['摘要', '翻译', '改写', '邮件'] },
  { id: 'formula-image-recognition', title: '公式图片识别', description: '确认发送预览图后生成可校对的 LaTeX 草稿', group: 'AI', icon: 'math', to: { path: '/documents', query: { kind: 'note', create: 'note', mode: 'split', insert: 'formula', recognize: 'formula' } }, keywords: ['公式识别', '图片转公式', 'latex', '数学公式', 'mathpix', 'vision', '截图'] },
  { id: 'library', title: '收集与归档', description: '保存截图、PDF、文本和代码来源', group: '资料', icon: 'inbox', to: { path: '/library' }, keywords: ['资料库', '导入', 'archive'] }
]

/** Common outcomes expressed as short paths through the canonical catalog.
 * Keeping IDs here avoids a second, drifting set of tool routes and labels. */
export const toolWorkflows: ToolWorkflow[] = [
  { id: 'pdf-images', title: 'PDF 与图片互转', description: '逐页导图，或把多张图片装订成 PDF', icon: 'file-pdf', toolIds: ['pdf-pdf-to-image', 'pdf-images-to-pdf'] },
  { id: 'long-image', title: '长图与截图', description: '普通图片顺序拼接，滚动截图自动找重叠', icon: 'gallery', toolIds: ['image-concat', 'scroll-capture'] },
  { id: 'privacy-markup', title: '图片隐私与标注', description: '打码、涂画，再整理为分享卡片', icon: 'palette', toolIds: ['image-mosaic', 'image-doodle', 'visual-card'] },
  { id: 'code-text', title: '代码与文本', description: '代码长图、JSON 整理与文本差异比较', icon: 'terminal', toolIds: ['code-image', 'developer-json', 'developer-diff'] },
  { id: 'media-subtitle', title: '音视频到字幕', description: '提取语音、离线转写并继续校对字幕', icon: 'file-text', toolIds: ['media-speech-wav', 'local-transcription', 'subtitle-editor'] },
]

/** High-frequency desktop jobs exposed before the complete catalog. IDs are
 * kept here, beside the canonical metadata, so the tool space never grows a
 * second set of titles, routes or keywords that can drift out of sync. */
function searchableText(item: ToolCatalogItem) {
  return [item.title, item.description, item.group, ...item.keywords].join(' ').toLocaleLowerCase('zh-CN')
}

function normalizeToolQuery(value: string) {
  return value
    .toLocaleLowerCase('zh-CN')
    .replace(/转换成|导出成|变成|转成/g, '转')
    .replace(/拼接成|合并成|拼成/g, '拼')
    .replace(/请帮我|帮我|我想要|我需要|怎么|如何|一下/g, '')
    .replace(/多张|多个|一张|一个/g, '')
    .replace(/[把将的到为和、，。！？!?：:\s/_-]+/g, '')
}

export function searchTools(query: string, limit = 8) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return toolCatalog.filter((item) => item.popular).slice(0, Math.min(limit, 5))
  const intent = normalizeToolQuery(normalized)
  return toolCatalog
    .map((item, index) => {
      const title = item.title.toLocaleLowerCase('zh-CN')
      const content = searchableText(item)
      const compactTitle = normalizeToolQuery(title)
      const compactContent = normalizeToolQuery(content)
      const score = title === normalized || compactTitle === intent ? 0
        : title.startsWith(normalized) ? 1
          : title.includes(normalized) || compactTitle.includes(intent) ? 2
            : content.includes(normalized) || compactContent.includes(intent) || intent.includes(compactTitle) ? 3 : 99
      return { item, score, index }
    })
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item)
}

/**
 * The command palette opens far more often than a broad search is typed. Keep
 * that zero-query path intentionally small, deduplicated and entirely local:
 * pinned tools first, then recent work, then a curated fallback.
 */
export function browseCommandTools(favoriteToolIds: readonly string[], recentToolIds: readonly string[]): CommandToolGroup[] {
  const byId = new Map(toolCatalog.map((tool) => [tool.id, tool]))
  const seen = new Set<string>()
  const collect = (ids: readonly string[], limit: number) => {
    const tools: ToolCatalogItem[] = []
    for (const id of ids) {
      if (tools.length >= limit || seen.has(id)) continue
      const tool = byId.get(id)
      if (!tool) continue
      seen.add(id)
      tools.push(tool)
    }
    return tools
  }
  const favorites = collect(favoriteToolIds, 5)
  const recents = collect(recentToolIds, 5)
  const suggested = searchTools('', 5).filter((tool) => !seen.has(tool.id)).slice(0, 5)
  const groups: CommandToolGroup[] = [
    { id: 'favorites', label: '已收藏', tools: favorites },
    { id: 'recents', label: '最近使用', tools: recents },
    { id: 'suggested', label: '推荐工具', tools: suggested },
  ]
  return groups.filter((group) => group.tools.length)
}
