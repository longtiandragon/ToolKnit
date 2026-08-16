# Knitspace / ToolKnit：对话交接文档

> 用途：把本文件和下面的“给新对话的启动提示”一起提供给新的 Codex 对话。
>
> 更新日期：2026-08-16（Asia/Shanghai）
>
> 工作区：当前仓库根目录

## 给新对话的启动提示

```text
请继续维护当前仓库。先完整阅读 AGENTS.md 和 docs\CODEX_HANDOFF_2026-08-16.md；如果当前会话仍能访问用户最初提供的需求附件，也一并阅读，然后检查 git status。不要重置、覆盖或删除当前脏工作区中的现有改动。

这是一个 Tauri 2 + Vue 3 + TypeScript + Rust + SQLite 的本地优先个人数字工作台。用户要它替代自己高频使用的 Typora、Obsidian、Anki、XMind、Visio、图片/文件/音视频工具及私人脚本的“重复工作流”，而不是复制完整产品。

前端可以持续改进，但应以现有 Knitspace 产品语言、真实桌面工作流和可验证的使用体验为基线。可以按任务需要选择设计方法、技能和协作方式；最终方案需要回到现有代码、数据边界、性能门槛和产品信息架构中验证，不为堆功能制造孤立页面。

当前核心功能实现约 80–85%，个人桌面 Beta 成熟度约 70–75%，GitHub 正式发布成熟度约 60–65%。优先做真实运行验证、工作流收敛、发布拆分与文档，而不是盲目新增模块。
```

## 1. 产品目标与边界

原始目标来自用户在 Codex 会话中提供的需求附件；附件不属于仓库，也不应提交用户目录路径。

产品定位：一套**本地优先的个人数字工作台**。数据应优先留在本机 Vault；长 Markdown 应保持普通 `.md` 文件可被 Typora/Obsidian 打开；结构化单词、题目、复习、事件保存在 SQLite；大型二进制附件保存在 Vault 目录而非 SQLite BLOB。

“完成”不等于替代完整 Typora、Obsidian、Anki、XMind、Visio 或 Photoshop。真正目标是覆盖用户高频重复流程：

1. 写、读、搜索、管理大 Markdown；
2. 记录单词、题目、错题，并按 FSRS 复习；
3. 把 Markdown 变成思维导图/图表，做轻量图片标注与代码长图；
4. 处理 PDF、图片、音视频、文件与开发者文本；
5. 番茄钟、记录、纪念日、私人 Python 脚本；
6. 作为真正的 Windows 桌面应用稳定启动和使用。

## 2. 项目协作与产品准则

- 前端允许修改。调整颜色、字体、密度、组件或交互模式时，应先说明目标与影响，通过现有页面、真实内容和桌面尺寸验证一致性；较大的视觉改版应形成明确方案，而不是在单个页面中悄然引入第二套设计语言。
- 设计研究、技能与工具按任务适配度选择。外部建议是输入，不是产品规范；采用前需要结合 Knitspace 的本地优先定位、中文桌面场景、可访问性、性能和现有组件体系进行取舍。
- 任务可以由主流程独立完成，也可以在边界清晰时并行拆分。并行工作必须明确文件与责任范围，避免覆盖共享工作区中的现有修改，并由主流程统一审阅、验证和整合结果。
- 优先解决真实桌面端体验、数据安全、稳定性和工作流收敛；新增能力应接入五空间、全局搜索或既有工作流，避免形成不可发现的孤立页面。
- 桌面端不能只是把网页塞进窗口：应确保 Tauri 打包/开发启动使用正确的本地资源流程；此前用户曾看到 Edge 的 `127.0.0.1 拒绝连接` 页面。
- 功能不能只在“今天”页面可见；五个空间与全局搜索应能发现真实能力。
- 用户喜欢 Typora 的右键菜单密度与层次，期望编辑器、预览、文件条目、工具输出等都可用右键和 `Shift+F10`。
- 用户曾提供 AI API Key 用于 DeepSeek 测试。**不要把 Key 复制、写入文件、输出到终端或提交 Git。**它已在旧聊天记录中暴露，建议用户以后轮换 Key。

## 3. 技术栈与当前命名

- 前端：Vue 3、TypeScript、Pinia、Vue Router、UnoCSS。
- 桌面端：Tauri 2、Rust。
- 本地数据：SQLite + FTS5 + Markdown Vault + `assets` 文件夹。
- 编辑器：CodeMirror 6。
- Markdown：markdown-it、KaTeX、highlight.js、Mermaid、Markmap。
- 画布/标注：Vue Konva。
- 文件/PDF/图像：pdf-lib、pdfjs、Web Workers。

当前外显产品名是 **Knitspace**；Rust 凭据库服务名称和部分内部标识仍使用历史名称 **ToolKnit**。这些内部标识不是永久冻结项：需要统一时，应先建立引用清单，设计新旧标识的兼容读取或一次性迁移，覆盖凭据、Vault、事件、备份、文件关联和升级路径，并用测试与真实安装验证迁移结果。

## 4. 已完成的核心能力

### 4.1 五空间信息架构与全局入口

已将主导航整理为：

- 今天
- 知识库
- 创作
- 复习
- 工具

同时具备或已接入：

- `Ctrl+K` 命令搜索/入口发现；
- 快速捕获；
- 全文搜索；
- 最近使用；
- 收藏；
- 导航、工作流卡片、文档、工具输出等的右键菜单/键盘菜单。

关键文件：

- `src/components/AppRail.vue`
- `src/lib/workspace-navigation.ts`
- `src/views/KnowledgeSpaceView.vue`
- `src/views/CreateView.vue`
- `src/views/DashboardView.vue`

### 4.2 SQLite Vault、迁移、备份与搜索

已具备：

- SQLite 作为桌面端主要数据源；
- 标准 Markdown Vault；
- 数据库 schema 迁移（当前 `SCHEMA_VERSION = 23`）；
- 浏览器旧数据一次性迁移；
- localStorage 中旧 Today 时间线迁移到 SQLite；
- Markdown 文件写入恢复、外部 Markdown 监听与冲突处理；
- 自动备份、恢复、归档完整性验证；
- 标题、正文、词义、资料等的 FTS 搜索；
- 收藏、最近打开、关系、活动、处理任务持久化；
- 处理任务发生应用重启时，旧 session 的 active job 正确标记为中断，而不是每次 `VaultService::open()` 都误中断当前任务。

关键文件：

- `src-tauri/src/vault.rs`
- `src-tauri/src/lib.rs`
- `src/stores/workbench.ts`
- `src/lib/workspace-persistence.ts`
- `src/lib/personal-event-migration.ts`
- `src/lib/native.ts`

重要设计决策：**不要**在 `VaultService::open()` 中自动恢复/取消 queued 或 running 的任务；每个 Tauri command 都可能重新 open Vault，会误判当前任务。恢复必须是一次性 hydration/startup 路径，并以 `owner_session` 判断旧进程。

### 4.3 大 Markdown / Typora 高频工作流

已具备：

- CodeMirror 源码、阅读、分栏模式；
- Markdown Worker 分块解析；
- 块 hash/缓存和未变块 DOM 复用；
- 大文档渐进预览；
- 可见区域附近才处理 KaTeX、代码高亮、Mermaid 和图片；
- 保存时尽量保留 YAML Frontmatter、相对图片路径与未知 Markdown 原文；
- 外部 Markdown 文件树、标签、双链、反向链接、全文搜索；
- 编辑器和预览区 Typora 风格右键菜单（复制 Markdown/HTML/纯文本、粘贴纯文本、代码块、插入等）；
- Markdown 1/3/5 MB 基准和渲染预算检查。

关键文件：

- `src/views/DocumentsView.vue`
- `src/components/LargeTextEditor.vue`
- `src/components/MarkdownContent.vue`
- `src/lib/progressive-markdown-preview.ts`
- `src/workers/markdown-preview.worker.ts`
- `scripts/generate-markdown-benchmark.mjs`
- `scripts/run-markdown-render-benchmark.mjs`

仍需真实桌面运行验证：长时间编辑真实用户 Markdown、外部文件变更、巨大图片/公式/代码块的感受是否符合预期。测试通过不等于 Typora 体验完全等价。

### 4.4 单词、题目、错题与复习

已具备：

- 单词词形、发音、多词性、多义项、例句、搭配、近义/易混词；
- 单词复习卡：词义、拼写、例句填空、近义/易混；
- 每个方向是独立 FSRS 卡片；
- 题目字段：题干、类型、来源、正确答案、解析、错误做法、错因、难度、附件、关联知识点；
- 题目答案回忆卡与错因复盘卡；
- 题目批量导入、附件管理；
- 原生紧凑复习队列、评分、撤销、历史、学习分析；
- 今天页和复习页都能展示待复习。

关键文件：

- `src/views/VocabularyView.vue`
- `src/components/VocabularyImportDialog.vue`
- `src/views/DocumentsView.vue`
- `src/views/ReviewView.vue`
- `src/lib/vocabulary-review.ts`
- `src/lib/vocabulary-import.ts`
- `src/lib/question-review.ts`
- `src/lib/review-session.ts`
- `src/lib/native-review-session.ts`
- `src-tauri/src/vault.rs`

最近完成：第四张单词卡 `comparison`（近义/易混）。它已贯通类型、导入、编辑、复习前后、原生队列和 Rust 持久化；不要回退成只在前端显示。

### 4.5 创作、图片、代码与图表

已具备：

- Markdown → Markmap 思维导图；
- Mermaid 图表；
- Vue Konva 自由画布和图片标注；
- 图片裁剪、缩放、拼接/长图；
- 代码截图/代码长图；
- 代码工作室的纯文本粘贴/复制往返、无文件名语法识别，以及午夜/深林/纸页三套完整窗口主题；
- PDF 和图像工具；
- OCR、字幕、媒体处理等桌面能力探针和页面。

关键文件：

- `src/views/VisualStudioView.vue`
- `src/components/AnnotationCanvas.vue`
- `src/views/CodeImageView.vue`
- `src/views/BatchView.vue`
- `src/views/MediaDeskView.vue`
- `src/views/OcrView.vue`
- `src/workers/image-concat.worker.ts`
- `src/workers/image-stitch.worker.ts`

### 4.6 生活、历史与私人工具

已具备：

- 番茄钟、专注/时间事件、纪念日；
- 时间线历史、分页、统计；
- 统一处理任务历史（PDF、图片、媒体、AI、私人工具）；
- 个人脚本工具协议、预览/干跑/取消/日志/输出目录（私有功能应在 Public Core 构建排除）。

关键文件：

- `src/components/TodayFocus.vue`
- `src/lib/focus-ledger.ts`
- `src/views/HistoryView.vue`
- `src/views/ToolboxView.vue`
- `src-tauri/src/private_tools.rs`
- `src/lib/private-tool-workflows.ts`

### 4.7 AI 调用链与安全边界

已具备：

- 桌面端 API Key 存 Windows 凭据库，不写 SQLite/localStorage；
- 浏览器开发预览只把 Key 放在 `sessionStorage`；
- AI 连接测试、取消、超时；
- DeepSeek V4 请求显式关闭默认 thinking，避免 UI 收到空内容；
- 最近增加的 Rust 后端边界：配置 ID、模型名、服务地址、消息数量/大小、响应体（16 MB）校验；远程端点必须 HTTPS，仅 loopback 允许 HTTP。

关键文件：

- `src/lib/ai.ts`
- `src/lib/native.ts`
- `src/views/AiStudioView.vue`
- `src/views/SettingsView.vue`
- `src-tauri/src/vault.rs`（约 58、778、8430、8462、8902 行）

注意：不要使用旧聊天里出现的 Key；不能把它写入新文件或命令行参数。

## 5. 当前验证状态（2026-08-16）

以下命令在当前工作区已成功：

```powershell
pnpm test
# 138 个测试文件 / 606 个测试通过

cd src-tauri
cargo test
# 102 通过，5 个需要 Windows 环境或会短暂写入系统状态的测试忽略

# 本轮又在真实 Windows 环境逐个执行了上述 5 个 ignored 测试，全部通过
cargo test window_capture_tests::captures_a_real_visible_window -- --ignored --nocapture
cargo test windows_ocr::tests::recognizes_a_real_local_png_without_uploading_it -- --ignored --nocapture
cargo test private_tools::tests::private_tool_cancellation_helper -- --ignored --nocapture
cargo test external_markdown_tests::external_markdown_workspace_uses_windows_recycle_bin -- --ignored --nocapture
cargo test vault::tests::windows_credential_manager_round_trip -- --ignored --nocapture

cd ..
pnpm build
pnpm build:public
pnpm check:public
pnpm check:startup
cd src-tauri
cargo check --features public-core
```

验证观察：

- Public Core 检查曾报告：485 个发布文件没有个人路径或高置信度密钥；
- 启动资源预算通过：约 107.11 KB gzip；
- `git diff --check` 通过（Windows 的 LF/CRLF 提示不是 whitespace error）。

这些结果证明静态、单元与构建健康；下方的追加验证进一步覆盖了真实 Windows 桌面启动与当前用户 NSIS 安装、窗口捕获、本地 OCR、FFmpeg、系统凭据库、文件关联与外部 Markdown 回收站行为。**它们仍不证明干净环境安装/卸载、Whisper 模型和所有用户文件都已完成验收。**

### 2026-08-16 本轮追加的真实验证

- `pnpm desktop:dev` 已实际启动 Vite、Rust 和 `target\debug\knitspace.exe`；通过 Windows Graphics Capture 确认窗口内加载的是 Knitspace 知识库及真实长 Markdown，不是 `ERR_CONNECTION_REFUSED` 页面。
- `pnpm desktop:package:debug` 已生成 `src-tauri\target\debug\bundle\nsis\Knitspace_0.1.0_x64-setup.exe`。
- 在确认 1421 端口没有 Vite 监听后，直接启动调试打包生成的 `target\debug\knitspace.exe`，窗口仍完整显示 Knitspace 工具箱、55 个工具和常用工作流；生产资源不依赖开发服务器。
- 端到端真实输出验证通过：PDF 多文件逐页转 PNG/JPG（含透明软蒙版与网格着色 PDF）、图片横向/纵向拼成长图、统一尺寸/统一宽度、图片打码/涂色/文字/拖动/整体缩放/全屏及 PNG 导出。
- Markdown 1/3/5 MB 性能门槛通过；本机本轮结果的冷解析平均约 23.3/46.8/66.2 ms，热预览约 3.6/7.9/15.4 ms。
- 生产前端在 1366×768 与 1920×1080 两档视口检查通过：页面无横向溢出，五空间导航、主工作区与常用工作流均可见。
- Public Core 构建与隔离检查通过：485 个发布候选文件未发现个人路径或高置信度密钥；启动资源约 107.61 KB gzip。
- 现有 Git 历史检查按预期失败，命中 3 个历史提交中的用户目录路径，因此**不能直接公开当前仓库**。已验证 `export:public` 可导出 485 个文件且不携带 `.git` 历史；同时修复了 Windows 跨盘导出目标被误判为工作区内部的问题。
- Rust 默认测试：102 通过、5 个环境/系统状态测试忽略；随后在当前 Windows 机器逐个执行这 5 个 ignored 测试，真实窗口捕获、本地离线 OCR、外部工具取消、外部 Markdown 送入 Windows 回收站、Windows Credential Manager 合成凭据写入/读回/删除均通过。凭据测试使用唯一随机 QA 标识与非真实密钥，并验证删除后不再存在。`cargo check --features public-core` 通过。
- 本机已探测到 `C:\ffmpeg\bin\ffmpeg.exe`（2025-05-26 构建）；真实 Tauri 媒体台已读取一段由测试生成的 3 秒 MP4，并通过应用的后台 FFmpeg 链路生成 `pcm_s16le / 16 kHz / 单声道 / 3.008 秒` WAV。输入与输出均位于独立临时 QA 目录，测试后已把默认输出目录恢复为原值。未在 `PATH` 中发现 `whisper`、`whisper-cli` 或 `whisper.cpp` 命令。
- 用户授权后已在当前 Windows 用户下真实运行 NSIS：安装器显示成功，卸载列表出现 `Knitspace 0.1.0`，主机安装路径为 `%LOCALAPPDATA%\Knitspace`，桌面快捷方式位于当前用户的实际 Desktop 目录。安装版 `knitspace.exe` 已独立启动并显示 55 个工具、五个常用工作流与完整本地界面。
- 安装器为 `.md`、`.mdx`、`.markdown`、`.mkd` 注册的打开命令均指向主机安装版。当前用户已有受 Windows 哈希保护的 `.md -> Typora.md` UserChoice，安装器没有强行覆盖；通过主机安装版显式传入 `.md` 已成功载入真实交接文档。没有现有 UserChoice 的 `.mdx` 已通过 Windows Shell 关联启动 Knitspace，并成功载入同内容的临时 QA 副本。
- 最初从有包身份的 Codex 界面直接启动安装器时，Windows 将写入虚拟化到 Codex `LocalCache`；随后从无包身份的主机进程重新运行同一安装器，才完成上述真实主机安装。`LocalCache` 中的虚拟化副本只用于记录这一环境边界，清理前需单独确认。

仍未冒充完成的人工项：在干净 Windows 账户/虚拟机中实际运行安装、卸载与升级覆盖，125%/150% 系统缩放，Whisper CLI/模型配置，用户自己的外部 Markdown 和连续一周日常使用。当前机器的系统缩放为 100%；当前用户安装、系统凭据库、本地 OCR、文件关联与真实 FFmpeg 转换链路已验证，但还不能代替干净账户、其他缩放档位或用户实际媒体文件的完整工作流。这些项目需要真实环境、系统状态变更或用户数据，不能由单元测试代替。

## 6. 当前工作区状态：非常重要

工作树是**脏的，而且有大量此前已有的功能改动**。不要执行：

```powershell
git reset --hard
git checkout -- .
```

也不要为了“干净”而删除未跟踪的测试/脚本。它们可能是尚未提交但需要保留的成果。

当前重要修改范围包括：

- `src-tauri/src/lib.rs`
- `src-tauri/src/vault.rs`
- `src/App.vue`
- 多个 `src/components/`、`src/views/`、`src/lib/`、`src/workers/` 文件；
- 新增测试和 worker：`image-concat`、处理任务持久化、今日事件迁移、复习分析/会话、活动/专注分页、工具箱右键菜单等；
- 未跟踪的 `scripts/*.mjs` 多为人工/自动 UI 驱动检查脚本，先审阅再决定保留或删除。

最近这一轮只对 `src-tauri/src/vault.rs` 做了新的 AI 输入/响应有界校验及 3 个 Rust 测试；其余大部分 diff 是更早的实现，不要误认为都属于这一次修改。

## 7. 已知问题、未验证项与优先级

### P0：真实桌面运行（本轮已完成开发版、打包资源与当前用户安装烟雾测试）

此前用户截图显示桌面窗口内打开 Edge 风格的 `127.0.0.1` 拒绝连接页面。本轮结论：

1. `pnpm desktop:dev` 可以正确启动 Vite + Tauri，并显示真实 Knitspace 窗口；
2. 调试打包产物在 Vite 端口关闭时仍能加载嵌入资源；
3. `ERR_CONNECTION_REFUSED` 对应开发壳失去 `beforeDevCommand` 启动的 Vite，而不是 NSIS 安装包必须联网；
4. README 已区分 `desktop:dev` 开发壳和 `desktop:package:debug` 独立安装包。

当前用户 Desktop 已生成 Knitspace 快捷方式；后续日常入口应使用该安装版，不要继续使用依赖 Vite 的旧开发壳快捷方式。

### P1：用真实一周工作流收敛产品

让用户用真实内容跑以下 5–8 条流程，并记录每一步的摩擦：

- 打开已有大 Markdown → 编辑公式/代码 → 保存 → 用 Typora/Obsidian 再打开；
- 从截图/资料建立一道错题 → 加附件 → 答案/错因复习；
- 导入一个多义单词 → 复习四种卡片；
- 代码转长图并复制/导出；
- 图片/PDF/媒体工具输入、取消、重试、历史打开输出；
- 番茄钟 → 今天页 → 历史/统计；
- 私人 Python 脚本 dry run → 执行 → 看日志/输出。

原则：发现重复入口、空壳卡片、难找功能时，优先合并/暴露/删除，而不是继续新增页面。

### P2：整体 UX 与性能真实 QA（自动化部分已完成）

- 在 1366×768、1920×1080、125%/150% Windows 缩放下检查；
- 观察字体、背景、边框对比和右键菜单位置/键盘焦点；
- 大 Markdown、超多单词、长任务历史、数百文件的滚动和首屏；
- 确认媒体/PDF/OCR 不把大文件错误地塞入 renderer 内存；
- 通过已有基准保持 Markdown 1/3/5 MB 性能门槛。

本轮已经完成约 1242×822 的真实桌面窗口、1440×900 工具流程、真实 Tauri→FFmpeg 媒体转换和 Markdown 三档基准；当前 Windows 系统缩放实测为 100%，125%/150% 仍需人工切换系统设置后确认。

### P3：GitHub 发布准备（构建隔离与快照导出已验证）

- 不要直接把这条私有项目历史推到公开仓库；原目标要求最后提取一个干净的公开仓库或用 export 工具导出 Public Core；
- 完成产品命名统一策略（Knitspace 与 ToolKnit）；
- 清理私人脚本、路径、数据、API Key、个人模板；
- 编写 README、安装说明、开发说明、隐私说明、贡献说明；
- 生成 Windows 安装包并用干净环境安装测试；
- 决定是否提供 Personal Pack 的单独私有说明，而不是把它藏在 CSS/菜单中。

当前仓库历史明确不适合直接公开；应使用 `pnpm export:public -- --output=<新目录>` 导出无历史快照，再在新目录初始化全新 Git 仓库。不要尝试清洗或强推当前私有历史。

## 8. 推荐下一步（不要同时开太多线）

1. **干净环境安装验收**：当前用户真实安装与关联启动已经通过；仍需在干净 Windows 账户或虚拟机检查卸载、升级覆盖及没有既有 UserChoice 时的 `.md` 默认打开行为。
2. **真实一周工作流**：优先用用户自己的 Markdown、错题、词表和媒体文件，记录摩擦再修，不再通过新增孤立页面“补功能”。
3. **系统缩放与本机能力**：人工切换 125%/150%，并用用户实际安装的 OCR 语言包、FFmpeg 和 Whisper 模型验证。
4. **公开仓库**：从 `export:public` 的无历史快照初始化新仓库，补发布截图和版本说明；不要直接公开当前仓库。

## 9. 常用命令

```powershell
# 前端开发
pnpm dev

# Tauri 开发版（建议先验证它）
pnpm desktop:dev

# 前端测试、生产构建
pnpm test
pnpm build

# Markdown 性能门槛
pnpm benchmark:markdown:gate

# Public Core
pnpm build:public
pnpm check:public

# Rust
Set-Location src-tauri
cargo test
cargo check --features public-core

# Windows 调试安装包（生成产物，耗时较长）
Set-Location ..
pnpm desktop:package:debug
```

## 10. 修改代码时的原则

1. 先检查当前实现、调用链和用户数据边界，再决定修改范围；文档、代码与真实行为冲突时，以验证结果为准并同步修正文档。
2. 保留工作区中的既有修改。编辑应保持范围清晰、易于审阅；修改后检查 diff，并执行与风险相称的测试、构建或桌面验证。
3. 前端优先复用现有 `PageHeader`、`SectionCard`、`AppIcon`、菜单定位与键盘 helper。需要改变设计语言时，应以跨页面方案、设计变量和视觉回归统一落地。
4. 所有新增右键菜单都要处理：鼠标右键、`Shift+F10`/菜单键、Escape、焦点恢复、菜单位置夹紧。
5. 大数据页面优先紧凑 summary、懒加载、分页、Worker、虚拟列表或可见区渲染；不要将整个 Vault 全量放进 Pinia reactive state。
6. 新增或调整桌面数据必须考虑：schema 迁移、浏览器数据导入、备份/恢复、删除与孤儿附件、FTS 更新、公开版 feature gate、失败恢复和数据量边界。
7. 修改 Rust 迁移时，迁移版本和测试必须同步；处理任务的重启恢复应位于一次性 hydration/startup 边界，避免普通 command 重开 Vault 时误判当前任务。
8. 修改产品名、协议名、存储键、目录、凭据服务或备份格式时，先盘点生产者、消费者和历史数据；通过双读/迁移、版本化测试、升级验证和可回滚步骤完成收敛。
9. 可按任务复杂度选择单线程或并行协作。拆分任务时明确接口、文件所有权和验收标准，最终统一检查跨模块一致性。

## 11. 完成度的正确理解

不要把“测试通过”误报为“整个产品完成”。目前更准确的口径是：

| 口径 | 估计 |
|---|---:|
| 原始目标中的核心功能实现 | 80–85% |
| 用户可连续日常使用的 Windows 桌面 Beta | 70–75% |
| 可安心公开发布到 GitHub 的产品成熟度 | 60–65% |

剩余工作主要不是几十个新页面，而是：真实桌面运行验证、真实工作流收敛、体验打磨、性能压力验证、公开发布拆分和文档。
