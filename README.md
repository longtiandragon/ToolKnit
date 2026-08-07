# ToolKnit

> Windows 本地万能工具箱：让常见文件处理、内容整理和表达输出少依赖几个网站与临时软件。

ToolKnit 以任务组织能力，而不是把所有文件或某个单一人群塞进同一个入口。默认工作流是：选择输入 → 调整参数 → 预览影响 → 生成新输出 → 查看任务历史。

## 当前状态

### 已验证

- Windows Tauri 调试版可编译启动；应用图标、SQLite 资料库基础、Credential Manager API Key 存储已具备。
- 文件处理中心：PDF 合并、按页拆分、旋转、提取/重排页面、文字层提取、中文水印、页码、图片转 PDF；图片裁剪、旋转、缩放/压缩、PNG-JPG-WebP 转换；JSON 格式化、文本/Markdown 清理；哈希去重与批量命名预览报告。
- 图片表达工作室：单图、双图、四宫格拼图，标题、水印、方框/箭头/文字标注和本地 PNG 分享卡导出。
- AI 内容工作台：摘要、翻译、改写、结构化信息提取和邮件草稿；显示实际发送载荷，结果只作为可复制/导出的草稿。
- 每次文件工具都下载/生成新输出，不覆盖输入文件，并在操作台保留本次输入、输出或错误记录。
- 收集与归档、PDF 区域框选、Markdown 笔记/错题、FSRS 复习、工具配方（复用参数）和用户自带 OpenAI 兼容 API 草稿动作。
- 代码分享工作室：按行分页导出 PNG 或分页 PDF，可自定义主题、字号、行号、水印和每页行数；超长代码不会截断。

### 实验室（不作为正式能力承诺）

- 本地 OCR 引擎与模型安装器。
- 公式识别、滚动截图、音视频处理。

实验室项目不会伪造“识别成功”或向正式资料库写入虚构结果。

## 开发

```powershell
pnpm install
pnpm dev
```

安装 Rust stable 和 Visual Studio C++ Build Tools 后：

```powershell
pnpm tauri dev
```

Windows 本地构建工具可安装到非系统盘；本项目已在 `F:\UtilityTool\VSBuildTools` 环境中验证 Rust 原生层编译。

## 数据与隐私

- 处理工具默认临时读取文件并生成新输出；长期资料可选择归档到 `ToolKnitVault`。
- API Key 仅存 Windows Credential Manager，不进入资料库、备份、日志或 Git。
- AI 仅在用户明确点击动作后发送用户选择的文本；远程地址必须使用 HTTPS，`localhost` 除外。

详见 [PRIVACY.md](PRIVACY.md)、[SECURITY.md](SECURITY.md) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

Apache-2.0.
