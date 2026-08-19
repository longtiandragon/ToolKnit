# Knitspace 路线图

更新日期：2026-08-19（Asia/Shanghai）

这份文档取代"核心功能完成 80–85%"这类单一百分比叙事。一个数字无法同时表达"工具很多"和"发布不了"，而这正是当前项目的真实状态。

所有结论都对照代码核对过，并附文件与行号。与实现冲突时以代码为准。

## 1. 四维成熟度

| 维度 | 现状 | 依据 |
| --- | --- | --- |
| 功能覆盖 | **高** | 60+ 工具条目、10 类外部引擎探测、五空间导航、Vault/FTS/FSRS 齐备（`src/lib/tool-catalog.ts`、`src-tauri/src/lib.rs:6721-6895`） |
| 工具平台一致性 | **中** | 三套互不相通的注册表；流水线只吃文本（见 §2） |
| 桌面可靠性 | **中高** | 备份、迁移、崩溃恢复、任务取消、磁盘检查齐备；崩溃日志、降级保护、临时目录清扫、窗口记忆已补，真实 Tauri 烟测已进 CI（见 §3、§4）；仍无更新通道 |
| 发布就绪 | **中** | 发布流水线已收口并带完整门槛；仍未签名、无更新通道（见 §4） |

功能覆盖已经不是瓶颈。工具平台一致性（§2）现在是最主要的一项。

## 2. 工具平台的真实形状

这一节决定了后续任何"自动化""插件化"能不能做，必须如实记录。

- **三套注册表并存，ID 不互通**：
  - `ToolDefinition`（`src/lib/tool-platform.ts:30-41`）——只有 7 个纯文本工具，仅供流水线使用。
  - `ToolCatalogItem`（`src/lib/tool-catalog.ts:5-14`）——约 60 条，只负责发现、搜索和深链接，不承载执行。
  - `ToolAction`（`src/lib/tools.ts:1-11`）——只用于快速处理页的交接标签。

  同一个 JSON 工具在两套里分别是 `text.json` 和 `text-transform-json`，没有任何代码把它们对上。

- **`ToolParameterDefinition` 已声明但零消费者**（`src/lib/tool-platform.ts:17-23`）：所有内置工具都传 `parameters: []`，没有任何 UI 渲染它。真正的 schema 驱动表单只存在于私人工具包（`src/views/PrivateToolsView.vue:536-584`）；核心工具的参数面板是逐个手写的（`src/views/BatchView.vue:42-78` 有约 35 个独立 ref）。

- **`ToolRunnerKind` 声明了 `worker | native | cli` 三类，但只有 `'worker'` 被赋值过**，而且它并不是 Worker——`runText` 在主线程同步调用 `transformText`（`src/lib/tool-platform.ts:93` → `src/lib/file-tools.ts:62`）。真实的三类执行边界都存在，但是逐个功能手工接线的，没有统一 runner 接口。

- **流水线只接受文本步骤**（`src/lib/tool-platform.ts:138-140` 硬拒绝），**且只吃一个输入文件**（`src/components/ToolPipelineView.vue:236` 的 `.slice(0, 1)`）。已有的能力是真的：12 步串联、`stop`/`skip`/`retry` 失败策略、逐步预览、配方 JSON 导入导出。但 PDF、图片、媒体都进不了流水线，它们是 BatchView 里的单操作批处理。

- **Engine Registry 只探测、不使用**（`src-tauri/src/engine_registry.rs:33-104`）：探测 10 个引擎，但只有 FFmpeg/FFprobe、7-Zip、qpdf、ExifTool、Czkawka 这 5 个真正被调用过。**LibreOffice、Tesseract、ImageMagick、yt-dlp 从未被任何代码调用**——任何依赖它们的路线图条目都是从零开始，不是"接一下就好"。

- 没有安装/更新/版本策略管理，没有共享的 CLI 参数白名单模块。参数安全靠两个机制：注册表参数是 Rust 常量并有单测约束（`engine_registry.rs:259-270`），私人工具是整参数 `${field}` 模板且不经 shell（`src-tauri/src/private_tools.rs:384-441`）。

## 3. 桌面可靠性

已具备：schema 迁移（`src-tauri/src/vault.rs`，当前 v26，单事务）、自动备份与恢复且恢复时拒绝更高 schema、编辑器崩溃草稿与文档写前日志（`src/lib/editor-crash-draft.ts`、`src/lib/desktop-document-recovery.ts`）、AI/媒体/转写/私人工具的长任务取消、Windows 磁盘空间检查、单实例聚焦、启动资源预算门槛。

以下四项曾列为缺口，现已实现：

- **崩溃日志**（`src-tauri/src/crash_log.rs`、`src/lib/crash-report.ts`）。Rust 侧装 `panic::set_hook` 并保留原 hook；前端注册 `error` 与 `unhandledrejection`。日志写在 `app_log_dir/crash.log`，有 128 KB 上限与单条 4 KB 上限，超出从最旧的整行开始裁。**所有内容先过 `redact()`**：Windows 盘符路径、UNC、POSIX 绝对路径、`file://` URL 以及长串 base64/hex 一律替换成 `<path>` / `<redacted>`，因为最值得记录的 panic 恰恰来自文件与解析代码，而它们的消息里就是用户的路径。命令 `read_crash_log` / `clear_crash_log` 让用户能读取和丢弃自己的诊断。
- **Vault 降级保护**（`vault.rs` 的 `migrate()`）。原先 `current_version >= SCHEMA_VERSION` 直接返回，新版本写过的 Vault 会被旧版本静默打开**并继续写入**。现在 `>` 直接报错并同时给出两个版本号。恢复路径不再依赖 `open()` 的副作用，改为先用 `stamped_schema_version()` 读取 schema 戳再决定，保留了针对归档的专属措辞，也把拒绝提前到了落盘之前。
- **临时目录启动清扫**（`lib.rs` 的 `sweep_stale_temporary_entries`）。在 `setup()` 这个一次性启动边界上后台执行，只删 `knitspace-` 前缀且**修改时间超过 24 小时**的条目。年龄阈值就是安全机制本身：第二个 Windows 用户会话有自己的实例，而一个 FFmpeg 或 whisper.cpp 长任务合法地会占用工作目录数小时。扫描条目数有上限，失败一律跳过。
- **窗口位置/尺寸记忆 + DPI 正确性**（`src-tauri/src/window_state.rs`）。全部以**逻辑像素**存取——在 150% 屏上保存的物理坐标拿到 100% 屏会偏出三分之二，这正是"没处理 DPI"的典型表现。恢复前会检查窗口是否仍与某块显示器有足够重叠，显示器被拔掉或分辨率变小则放弃记忆、回到默认位置，而不是把窗口还原到抓不到的地方。最大化时只更新标志、保留用户选定的还原尺寸。`Moved`/`Resized` 只写内存，磁盘写入每秒合并一次并在关闭时兜底。

仍然缺少：

- **没有更新通道**。`src-tauri/tauri.conf.json` 无 updater 配置。已经装出去的版本收不到修复。这一项需要签名密钥与分发端点，不是纯代码工作。
- **125%/150% 缩放尚未在真机验证**。代码层面已按逻辑像素处理，但自绘标题栏（`decorations: false`）在高缩放下的实际观感仍需人工确认。

## 4. 发布工作流

本节曾记录三个"现存 bug"。它们**已由 `740ec24 fix: harden public release workflow` 修复**，且该提交同时补了 `scripts/release-workflow-policy.test.mjs`、`check-release-version.test.mjs`、`write-release-checksums.test.mjs` 三个测试来防止回退。当前状态：

- **发布包不再带私人工具执行器**。`release.yml` 跑的是 `pnpm desktop:package:public`，即 `--features public-core` 构建，`load_private_tools` / `run_private_tool` / `cancel_private_tool_run` 不进发布二进制。
- **release 跑完整门槛**：`check:release-version`（版本号与推送的 `v*` tag 一致）、`test`、`benchmark:markdown:gate`、`build`、`check:startup`、`build:public`、`check:public`、两次 `cargo check`、`cargo test`、两次 clippy。
- **`SHA256SUMS.txt` 可用**。`write-release-checksums.mjs` 用 `basename()` 写相对文件名，可直接 `sha256sum -c`；工作流断言 NSIS 目录里恰好只有一个 installer，不再递归哈希整个 `bundle/`。
- **Rust 测试与 clippy 已进 CI**。`ci.yml` 含 `cargo test` 与两次 clippy，不再只有 `cargo check`。
- **真实 Tauri 自动化已进 CI**。`pnpm desktop:e2e` 构建并启动隔离的 debug 二进制，共跑 4 个 spec、10 个断言：自动化配方从 UI 写入 Vault、通过 Rust IPC 回读、WebDriver 会话重建后仍存在；智能整理只读扫描零变更；同盘移动与撤销、输入变化拒绝、目标占用不覆盖、部分失败反向回滚、跨盘复制并保留原件，以及进程被强制终止后的下一次启动恢复。崩溃场景先正常关闭 WebDriver 会话，再按 E2E IPC 返回的精确 PID 终止隔离应用，后续 worker 会启动新进程验证 pending 凭据确实被消费。测试桥、故障注入字段、全局 Tauri API 与 WebDriver 权限只在 `e2e` feature 和独立应用标识下启用，普通包和 Public Core 包不包含它们。

仍然缺少：

- **安装包未签名**。`tauri.conf.json` 无 `certificateThumbprint` / `signCommand`，SmartScreen 会拦截。需要代码签名证书，不是纯代码工作。
- **原生自动化仍未覆盖完整真机矩阵**。现有 17 个 `scripts/*-drive.mjs` 仍只是浏览器截图/QA 工具；真实 Tauri E2E 已覆盖核心文件执行、撤销、冲突、跨卷与崩溃恢复，但尚未覆盖 OneDrive 占位文件、只读/独占锁、超长路径、多 DPI、签名安装包和跨版本升级。

因此可以自动声称的范围限于上述 10 个隔离场景；OneDrive、安装与完整 Windows 真机矩阵仍必须人工验收。

## 5. 功能排期

从大量候选中收敛出四项，依据是"每周真的会用到"，不是覆盖度。

| 顺序 | 功能 | 成本 | 状态 |
| --- | --- | --- | --- |
| 1 | 拍照/扫描件矫正与增强 | 低—中 | 已实现，待真实照片 + 桌面 OCR 验收 |
| 2 | 按拍摄日期批量整理照片 | 中 | 已实现，待真实照片与跨重启回滚验收 |
| 3 | 网页正文提取为 Markdown | 中 | 3a 离线提取与 3b 受限 HTTPS 抓取已实现，待真实站点和图片本地化验收 |
| 4 | 监控文件夹 + 定时运行 | 高 | **被阻塞** |

### 5.1 拍照/扫描件矫正与增强

手机拍的笔记存在透视变形和光照不均，直接送进已有的 Windows OCR 识别率很低。在 OCR 前插入四点透视矫正 + 自动裁边 + 文字增强。

接缝干净：`src/lib/image-processing.ts` 是 84 行纯函数，`src/workers/image-process.worker.ts` 是 59 行；不联网、不改 schema、不加引擎。且 `recognize_image_bytes`（`src-tauri/src/windows_ocr.rs:322`）与前端封装 `recognizeDesktopImageBytes`（`src/lib/ocr-native.ts:4`）已存在，矫正结果可以直接以字节送进 OCR，不需要落盘。

它抬升的是**已经建成**的"拍笔记 → OCR → 错题/笔记"链路的成功率，而不是新增一条链路。

### 5.2 按拍摄日期批量整理照片

读 EXIF 拍摄时间 → 按年/月分目录 + 重命名，先预览再执行。

需要注意：ExifTool 目前**只读**（`src-tauri/src/image_metadata.rs:201`），而且项目**至今没有任何文件移动执行器**——只有生成文本报告的重命名预览（`src/lib/file-tools.ts:127`）和不写文件的目录同步预览（`src/lib/directory-sync-plan.ts`）。这会是第一个真正的破坏性文件操作，`扫描 → 预览 → 执行 → 可回滚`的模式要在这里一次性设计对，后续的实际同步执行会复用它。

### 5.3 网页正文提取为 Markdown

分两步，避免一次引入网络边界：

- **3a（无网络）**：粘贴网页源码 → 去模板正文提取 → 存为笔记。`src/lib/html-to-markdown.ts:186` 已经能把 HTML 转成 Markdown（当前用于剪贴板粘贴），缺的只是正文提取。
- **3b（受限抓取）**：Rust 侧抓取，仅 HTTPS、不执行 JS、响应体大小上限、图片本地化到 Vault。这一步要先做威胁建模，不能直接从前端 fetch。

### 5.4 监控文件夹 + 定时运行——先解阻塞

**这一项现在做不了，原因不是工作量。**

流水线只接受文本步骤且只吃一个输入文件（见 §2）。"截图文件夹新增文件 → 自动压缩 + 清 EXIF"这句话**在当前数据模型里无法表达**——没有可以放进流水线的图片步骤。

按现状直接实现 watcher 和调度器，得到的会是一个能按时触发、但没有东西可跑的调度器。正确顺序是：

1. 文件型流水线步骤（让 PDF/图片/媒体操作可以成为 `ToolDefinition`）；
2. 多文件输入 + 并发上限；
3. 每步运行日志持久化（当前 `TextPipelineStepResult` 跑完即丢，`tool-platform.ts:43-50`）；
4. 然后才是 watcher 与定时器。

前三步同时也是把 §2 那三套注册表收敛成一套的自然路径。这是一次平台重构，不是一个功能，应当在前三项功能验证过真实工作流之后再启动。

## 6. 每项功能的验收门槛

沿用 `TOOLBOX_STATUS.md` 的标准，不放宽：

1. 接入现有工具目录、搜索、深链接或工作流，不新增不可发现的孤立页面。
2. 明确输入、输出、覆盖策略、取消行为、失败恢复和权限声明。
3. 补充纯逻辑测试；跨模块任务再补 TypeScript 构建和启动预算检查。
4. 默认生成新输出；删除或移动操作必须先扫描、预览并可回收/回滚。
5. 真实桌面运行验证，且要驱动交互本身——只截静态图会漏掉全部中间态。

## 7. 与 TOOLBOX_STATUS.md 的分工

`docs/TOOLBOX_STATUS.md` 记录**已实现能力的清单**，本文件记录**成熟度判断与下一步排期**。功能落地后，能力条目写进 TOOLBOX_STATUS，本文件只更新 §5 的状态列。
