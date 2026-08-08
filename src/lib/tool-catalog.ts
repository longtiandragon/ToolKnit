export type CatalogGroup = 'PDF' | '图片' | '文本' | '整理' | '开发' | '表达' | 'AI' | '资料'

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

function fileTool(id: string, title: string, description: string, group: 'pdf' | 'image' | 'text' | 'organize', icon: string, keywords: string[], query: Record<string, string> = {}): ToolCatalogItem {
  const groupLabel = { pdf: 'PDF', image: '图片', text: '文本', organize: '整理' } as const
  return { id: `${group}-${id}${query.mode ? `-${query.mode}` : ''}`, title, description, group: groupLabel[group], icon, to: { path: '/tools', query: { group, operation: id, ...query } }, keywords }
}

export const toolCatalog: ToolCatalogItem[] = [
  { ...fileTool('merge', '合并 PDF', '把多份 PDF 按顺序合成一份', 'pdf', 'merge', ['拼接', 'combine', 'merge']), popular: true },
  fileTool('split', '拆分 PDF', '把每一页导出为独立 PDF', 'pdf', 'split', ['分页', 'split']),
  fileTool('rotate', '旋转 PDF', '批量旋转 PDF 页面方向', 'pdf', 'rotate', ['方向', 'rotate']),
  fileTool('extract', '提取 PDF 页面', '按页码范围生成新的 PDF', 'pdf', 'extract', ['页码', '抽取', 'extract']),
  fileTool('reorder', '重排 PDF 页面', '按指定顺序重新组织页面', 'pdf', 'sort', ['排序', '页面顺序']),
  fileTool('watermark', 'PDF 添加水印', '添加文字水印并控制颜色和透明度', 'pdf', 'watermark', ['watermark', '版权']),
  fileTool('page-number', 'PDF 添加页码', '设置起始数字和页码位置', 'pdf', 'number', ['编号', 'page number']),
  fileTool('images-to-pdf', '图片转 PDF', '把多张图片合成一份 PDF', 'pdf', 'file-image', ['照片', 'image to pdf']),
  fileTool('text', '提取 PDF 文字', '导出 PDF 已有的文字层', 'pdf', 'file-text', ['文本', '复制', 'extract text']),
  { ...fileTool('convert', '转换图片格式', '在 PNG、JPG 与 WebP 之间转换', 'image', 'image', ['格式', 'png', 'jpg', 'webp']), popular: true },
  fileTool('resize', '缩放压缩图片', '限制最大宽度并调整输出质量', 'image', 'resize', ['压缩', '尺寸', 'resize']),
  fileTool('crop', '裁剪图片', '按百分比精确裁剪图片区域', 'image', 'crop', ['截图', 'crop']),
  fileTool('rotate', '旋转图片', '批量旋转并导出新图片', 'image', 'rotate', ['方向', 'rotate']),
  { ...fileTool('transform', '格式化 JSON', '整理缩进并检查 JSON 语法', 'text', 'json', ['json', '美化', '校验'], { mode: 'json' }), popular: true },
  fileTool('transform', '清理纯文本', '移除尾随空格和多余空行', 'text', 'file-text', ['trim', '空格'], { mode: 'trim' }),
  fileTool('transform', '清理 Markdown', '统一换行并压缩多余空行', 'text', 'file-code', ['markdown', 'md'], { mode: 'markdown' }),
  fileTool('rename-report', '批量命名预览', '生成安全的重命名结果清单', 'organize', 'rename', ['rename', '编号']),
  fileTool('dedupe-report', '查找重复文件', '通过 SHA-256 找出内容相同的文件', 'organize', 'duplicate', ['去重', 'hash', 'duplicate']),
  { id: 'developer-base64', title: 'Base64 编解码', description: '支持中文与 Emoji 的文本转换', group: '开发', icon: 'code', to: { path: '/developer-tools', query: { tool: 'base64' } }, keywords: ['base64', '编码', '解码'] },
  { id: 'developer-url', title: 'URL 编解码', description: '处理查询参数和特殊字符', group: '开发', icon: 'link', to: { path: '/developer-tools', query: { tool: 'url' } }, keywords: ['url', 'encodeURIComponent', '百分号'] },
  { id: 'developer-json', title: 'JSON 格式化与压缩', description: '检查语法并切换可读或紧凑输出', group: '开发', icon: 'json', to: { path: '/developer-tools', query: { tool: 'json' } }, keywords: ['json', 'format', 'minify', '校验'] },
  { id: 'developer-jwt', title: 'JWT 查看器', description: '本地读取 Header、Payload 与过期时间', group: '开发', icon: 'shield', to: { path: '/developer-tools', query: { tool: 'jwt' } }, keywords: ['token', 'claims', 'header', 'payload'] },
  { id: 'developer-hash', title: 'SHA-256 文本哈希', description: '生成文本内容的十六进制指纹', group: '开发', icon: 'hash', to: { path: '/developer-tools', query: { tool: 'hash' } }, keywords: ['sha256', 'hash', '摘要', '校验'] },
  { id: 'developer-uuid', title: 'UUID 批量生成', description: '一次生成最多 100 个 UUID v4', group: '开发', icon: 'fingerprint', to: { path: '/developer-tools', query: { tool: 'uuid' } }, keywords: ['guid', 'random', '唯一标识'] },
  { id: 'developer-timestamp', title: '时间戳转换', description: '秒、毫秒时间戳与日期互转', group: '开发', icon: 'clock', to: { path: '/developer-tools', query: { tool: 'timestamp' } }, keywords: ['unix', 'timestamp', '日期'] },
  { id: 'developer-radix', title: '整数进制转换', description: '支持 2 到 36 进制与超大整数', group: '开发', icon: 'binary', to: { path: '/developer-tools', query: { tool: 'radix' } }, keywords: ['binary', 'hex', '二进制', '十六进制'] },
  { id: 'developer-regex', title: '正则表达式测试', description: '查看匹配索引和捕获组', group: '开发', icon: 'regex', to: { path: '/developer-tools', query: { tool: 'regex' } }, keywords: ['regex', 'regexp', '匹配'] },
  { id: 'developer-diff', title: '文本 Diff', description: '逐行比较新增、删除和相同行', group: '开发', icon: 'diff', to: { path: '/developer-tools', query: { tool: 'diff' } }, keywords: ['diff', '比较', '差异'] },
  { id: 'visual-card', title: '图片分享卡', description: '拼图、标题、水印与标注', group: '表达', icon: 'palette', to: { path: '/visual' }, keywords: ['拼图', '海报', '标注'], popular: true },
  { id: 'code-image', title: '代码分享图', description: '高亮并按行分页导出 PNG 或 PDF', group: '表达', icon: 'terminal', to: { path: '/code-image' }, keywords: ['代码截图', '高亮', 'code'], popular: true },
  { id: 'ai-content', title: 'AI 内容处理', description: '摘要、翻译、改写与信息提取', group: 'AI', icon: 'sparkle', to: { path: '/ai' }, keywords: ['摘要', '翻译', '改写', '邮件'] },
  { id: 'library', title: '收集与归档', description: '保存截图、PDF、文本和代码来源', group: '资料', icon: 'inbox', to: { path: '/library' }, keywords: ['资料库', '导入', 'archive'] }
]

function searchableText(item: ToolCatalogItem) {
  return [item.title, item.description, item.group, ...item.keywords].join(' ').toLocaleLowerCase('zh-CN')
}

export function searchTools(query: string, limit = 8) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return toolCatalog.filter((item) => item.popular).slice(0, limit)
  return toolCatalog
    .map((item, index) => {
      const title = item.title.toLocaleLowerCase('zh-CN')
      const content = searchableText(item)
      const score = title === normalized ? 0 : title.startsWith(normalized) ? 1 : title.includes(normalized) ? 2 : content.includes(normalized) ? 3 : 99
      return { item, score, index }
    })
    .filter((entry) => entry.score < 99)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item)
}
