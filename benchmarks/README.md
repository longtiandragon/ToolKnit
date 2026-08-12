# Markdown 性能基准

运行 `pnpm benchmark:markdown` 会生成三个标准 Markdown 压力文档：`markdown-stress.md`（约 1 MB）、`markdown-stress-3mb.md`（约 3 MB）和 `markdown-stress-5mb.md`（约 5 MB）。生成文件不提交到 Git，避免把不可阅读的大型测试数据带进发布包。

每档都覆盖标题、公式块、TypeScript 代码块、Mermaid、任务列表、表格、相对图片引用和超长单行文本；规模越大，标题、公式、代码、图表和图片引用也随之增加。只生成单档时可使用 `pnpm benchmark:markdown:1mb`、`pnpm benchmark:markdown:3mb` 或 `pnpm benchmark:markdown:5mb`。用 `pnpm benchmark:markdown:check` 校验三个文件是否完整。

桌面端回归时，分别打开“源码 / 分栏 / 预览”模式，确认输入、滚动、目录跳转、右键菜单和切换页面都保持响应；超过实时预览阈值时应看到按需加载提示，而不是自动构建大 DOM。
