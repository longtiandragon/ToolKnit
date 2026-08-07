# ToolKnit

> 把每一次卡住，织成下一次会的东西。

ToolKnit 是一个 Windows 优先、本地优先的学习工作台：收集图片、PDF、文本和代码；整理为带来源的 Markdown 错题；使用间隔复习回到真正薄弱的知识点。

## 当前可运行功能

- 统一收集箱：拖入、导入或从剪贴板收集图片、PDF、文本和代码。
- 本地资料索引与去重演示、结构化 Markdown 错题、实时预览和标签。
- 今日复习队列、四档评分、知识点薄弱度面板。
- 长代码图分片 PNG 导出；安全批处理任务预览。
- 可选 OCR/公式引擎与自带 OpenAI 兼容 API 配置入口。

## 开发

```powershell
pnpm install
pnpm dev
```

安装 Rust stable 后可运行：

```powershell
pnpm tauri dev
```

## 数据与隐私

真实桌面资料库结构位于 `ToolKnitVault/`；其原始资料、Markdown 和数据库都不应提交到 Git。详见 [PRIVACY.md](PRIVACY.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

Apache-2.0.
