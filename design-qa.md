# Knitspace 全应用桌面工作区重构 — Design QA

## Evidence

- Source visual truth: `<QA_TEMP>\codex-clipboard-ac525fe0-8d0c-4f03-9d1d-3f18f9e17423.png`
- Desktop implementation capture: `<WORKSPACE>\design-qa-desktop-final.png`
- Side-by-side comparison: `<WORKSPACE>\design-qa-comparison-final.png`
- All-route contact sheet: `<WORKSPACE>\design-qa-all-routes.png`
- Expanded review inspector: `<WORKSPACE>\design-qa-documents-inspector.png`
- Source pixels: 1549 × 1015. Desktop implementation pixels: 1256 × 859 including the 31 px native Windows title bar.
- CSS viewport used for browser verification: 1240 × 820, deviceScaleFactor 1. The final comparison removes the native title bar and aspect-fits the source to the 1256 × 828 app-content region without stretching.

## State

- Primary route: `#/documents?kind=question`
- Selected record: `二分答案：最小可行值`
- Default document mode: Preview. Edit and Split were exercised before returning to Preview.
- Review information drawer was checked in collapsed and expanded states.
- Supporting routes: dashboard, tools, visual, code-image, history, clipboard, developer-tools, library, notes, review, AI, settings, and lab.

## Findings

- Pass 1 found one P2 fidelity gap: the selected reference included a discoverable, collapsible review-information edge panel while the first implementation placed all metadata in the header only.
- Fix: added the right-edge `复习信息` tab and an on-demand inspector for classification, difficulty, review state, tags, local-storage context, save, and delete actions.
- Pass 2 found no actionable P0/P1/P2 mismatch. The implementation preserves the reference's desktop workspace hierarchy while using real project data instead of the mock's longer sample list.
- No route error, blank lazy-loaded view, body-level horizontal overflow, or browser console warning/error remained during the stable all-route pass.

## Required fidelity surfaces

- Fonts and typography: Windows-native Segoe UI Variable and Microsoft YaHei UI are used at readable 13–16 px UI/body sizes. The document title, Markdown headings, code, and small status text have separate optical weights and line heights. Long-form content stays within an approximately 860 px reading column.
- Spacing and layout rhythm: fixed navigation, document navigator, app bar, editor header, tags, and document canvas follow the reference's rail/list/content hierarchy. Repeated marketing heroes were removed from route bodies. Borders and 4–8 px functional radii replace nested cards and decorative shadows.
- Colors and visual tokens: deep forest navigation, warm ivory work surfaces, muted green selection states, and one emerald action color map closely to the selected direction. Contrast remains clear in selected, disabled, danger, and saved states.
- Image quality and assets: no reference imagery required replacement. Existing application icons remain code-native library icons, uploaded screenshots use `object-fit: contain`, and no generated placeholder imagery or handcrafted SVG substitute was introduced.
- Copy and content: core Chinese labels match the existing product. The selected mock's fake list population was intentionally not copied; the implementation displays the user's real local records and honest empty states.

## Markdown verification

- A shared `MarkdownContent` component now renders documents, review cards, and AI drafts.
- Verified headings, paragraphs, ordered/unordered lists, task lists, blockquotes, tables, links, responsive images, inline code, fenced highlighted code, inline math, and display math.
- Raw HTML remains disabled. External links receive `target="_blank"` and `rel="noreferrer noopener"`. Math is tokenized before rendering so code spans containing dollar signs are preserved.

## Interaction verification

- Edit, Split, and Preview modes all switch correctly; Preview remains the calm default.
- Search, content filters, list selection, metadata controls, tags, save, review inspector, and create actions remain reachable.
- All 14 route states loaded with their correct top-bar title after lazy chunks settled.
- Browser console errors/warnings: none.
- `pnpm check`: passed.
- Vitest: 7 files, 45 tests passed.

## Comparison history

- Pass 1: selected direction successfully removed the marketing heading and permanent cramped editor/preview split, but lacked the reference's contextual review affordance.
- Fix: added the collapsed/expanded review inspector without reducing the default reading width.
- Pass 2: desktop-window capture and source/implementation comparison found the typography, spacing, palette, content hierarchy, and interaction states aligned closely enough for handoff. Remaining differences are intentional data fidelity and native Windows title chrome.

## Final result

passed

## 当前知识库回归（2026-08-09）

- 现行产品名为 **Knitspace**；较早的历史截图可能保留旧名 ToolKnit，仅作演进参考，不代表当前界面。
- 使用 Chrome headless、1600 × 1000 CSS 像素和独立临时浏览器配置，等待动态路由和懒加载完成后抓取：`design-qa-current-documents-loaded.png`（真实空资料库）与 `design-qa-current-documents-editor.png`（新建笔记）。
- 两个状态均显示完整的桌面 rail / topbar / 内容区布局；空状态不会被左侧列表压缩，编辑页保留暖纸张阅读面、深绿操作层级和可展开的“关联知识”边缘检查器。
- 新增文档菜单的定位逻辑会在鼠标右键、菜单键或 Shift+F10 下相对触发控件显示；菜单初始焦点、方向键、Home/End 与 Escape 均由组件代码处理。生产构建已通过。
- 补充以独立临时资料库构造的四条文档回归：`design-qa-current-folder-tree-final.png` 显示“算法 / 二分 / 图论 / 最短路、英语”的虚拟资料夹树及其聚合数量。资料夹只保存为 Vault 元数据，不会移动外部 Markdown 源文件或破坏相对资源路径。
- 同一生产预览通过 DOM 验证：当文档标题与首个 H1 完全相同时，阅读区只保留编辑器标题，Markdown 内的重复 H1 会被视觉隐藏且不会进入大纲；原始 Markdown 内容没有被改写。
- `design-qa-current-review-final.png` 使用独立临时配置在生产预览稳定后抓取。复习卡被限制在 920px 阅读宽度，暖纸张内容面与深绿导航保持清晰层级；Space/Enter 翻面、1–4 评分、Shift+F10/菜单键和卡片右键均有可见提示与实现。
- 复习评分把完整 FSRS 卡片状态（阶段、稳定度、难度、间隔、学习步数）保存在本地 Vault 的既有 JSON 状态中；间隔型旧记录会兼容读取，首次评分后补全状态。该路径由独立单元测试覆盖。
- 真实 Tauri 调试窗口（1256 × 859，标题为 Knitspace）已以原生窗口绘制方式抓取为 `design-qa-native-window-current.png`。它验证了 Windows 标题栏、固定导航、暖色工作面、滚动内容区和深绿主操作在同一容器中的视觉关系；不会将网页截图误认为桌面端证据。
- 该长驻窗口在此次更名前启动，因此截图中的默认资料库仍显示旧名。现已在工作区解析层精确迁移 `ToolKnitVault` 的四种历史默认文案；自定义资料库名保持不变，完整重启后生效，并有单元测试覆盖。
- 五个一级空间均可通过鼠标右键、菜单键或 Shift+F10 打开同一套空间操作菜单；菜单会将焦点交给首项，支持方向键、Home/End 和 Escape 回到原导航项。菜单高度按实际操作项数参与定位计算，贴近窗口底部时不会被截断。
- 创作空间的图片标注也使用同样的桌面菜单约定：选中标注后可右键或按菜单键打开，菜单外点击关闭，Escape 恢复画布焦点；画布本身继续懒加载，避免未使用图片标注时加载 Konva。
- 今日专注记录、纪念日、资料库条目和私人工具包也已接入共享的桌面菜单辅助逻辑：菜单键 / Shift+F10、初始焦点、方向键循环、Home/End、Escape 焦点恢复及窗口边缘避让均由同一组纯函数保障并有单元测试覆盖。私人工具右键操作会绑定实际点选的工具，而不再误用当前工具。
- 代码长图预览卡与分页条同样支持鼠标右键和菜单键；预览卡获得明确焦点描边，菜单只改变局部状态，保留原有的分页缓存、逐段长图合成和任务进度更新。`prefers-reduced-motion` 现在覆盖全局 CSS 动画、过渡和滚动动效。
- 首页“常用工具”卡片、资料库的关联知识、文内双链与回链已统一为可键盘操作的桌面菜单：鼠标右键、菜单键或 Shift+F10 均可打开，支持方向键、Home/End、Escape 焦点恢复以及窗口边缘避让。Markdown 阅读区内的 `[[双链]]` 也可直接以菜单键触发，不需要先回到右侧检查器。
- 桌面模式下 Markdown 的保存恢复由“整库 JSON 快照”改为小型写前日志：普通 Ctrl+S 仅序列化当前文档；连续写入同一文档会合并为最新状态。启动时仍兼容旧版完整快照，并会在 SQLite 打开后回放未完成日志，因此大资料库不会因恢复保护而产生与文档总量成比例的保存卡顿。
- 大型 Markdown 预览的首个 Worker 结果只输出可读原码与原公式；代码高亮和 KaTeX 分别由同一个 Worker 在代码块/公式靠近视口时完成。Mermaid、外部相对图片、代码和公式都不会在长笔记初次打开时无差别占用主线程或生成无关 DOM 更新。
- 使用隔离 Chrome 配置在 1440 × 1000 CSS 像素下重新抓取 `design-qa-current-dashboard-polished.png`：今天页保持深绿导航、暖纸工作面和清晰的 13–16 px 主文本层级；“从一件小事开始”的六项启动卡移除了低价值箭头占位，中文名称均能完整显示或自然换行。
- 同尺寸 `design-qa-current-documents-empty-polished.png` 验证了空知识库：右侧不再是无信息白区，而是轻量的本地 Markdown Vault 状态，提供“新建笔记 / 打开 Markdown”两条真实工作流，且不使用额外大图或持续动画。
- 同尺寸 `design-qa-current-words-onboarding.png` 验证了空单词库：左侧退为安静的词条索引提示，右侧将首次操作收束为“补全词条 → 按词性拆义 → 加入复习”的单一路径；不再出现两处竞争的新建按钮。词条录入后仍保留列表搜索、右键与 Shift+F10 管理。
- 单词列表采用固定行高窗口化渲染，只保留视口附近的词条 DOM；搜索延后 140ms 触发，以避免连续输入时反复全量匹配。选中或由复习页跳转的词条会自动滚入可见区域。`design-qa-current-words-windowed.png` 已回归验证优化不影响桌面初始状态。
- 文档视图模式现在是可恢复的 URL 状态：`?mode=mindmap` 可直接进入 Markdown 衍生图谱，默认阅读模式不会添加无意义参数。`design-qa-current-mindmap-overview.png` 在 1440px 下验证了图谱布局、暖纸点阵画布与工作台导航关系。
- 图谱画布也已接入统一桌面菜单：鼠标右键、菜单键、Shift+F10 均会显示“适应画布 / 一级概览 / 三层展开 / 全部展开 / 重新生成”；运行时回归确认菜单首项获得焦点、Escape 恢复画布焦点，选择“一级概览”后节点数从 10 收束为 7 且菜单关闭。
- Core 与 Personal Pack 的发布边界已进入构建流程：私人工具页只接受用户手选的外部 JSON 清单，真实脚本和路径不在前端导入图或 Tauri resources 中；`pnpm check:public` 与 CI 会拒绝被追踪或打入产物的私人包、Vault、模型、密钥和私人 JSON 清单。公开示例仅展示安全预览 / 确认执行协议。
- 浏览器截图验证的是渲染层，不含 Tauri 原生窗口边框；真实桌面端仍应在发布前再走一次手动交互回归。
- 代码分享工作室的长代码布局已从 Vue 主线程的派生计算移到独立 Worker：分页、最长行、字号和每张行数在后台计算，并以 `shallowRef` 交回界面；旧请求会按版本号丢弃。`code-layout.test.ts` 覆盖空内容、Unicode 分页和超长行字号边界，避免大段源码输入时出现不必要的主线程扫描。
- 使用 180 行超长 TypeScript 样本在生产预览回归：`design-qa-current-code-image-long-top.png` 显示源码编辑区仍可横向编辑，导出卡片自动折行且从顶部可见标题栏开始展示；底部保留分页、多选和导出操作。运行时确认 Worker 已加载、布局提示正确更新，预览与分页右键菜单仍支持首项焦点与键盘操作。
- 图片表达工作室的 Konva 标注现在有上限为 60 步的内存快照历史：创建、移动/缩放、复制、置顶、删除与清空均可撤销或重做。历史只保存归一化标注几何，绝不复制原图或位图；工具栏、`Ctrl+Z`、`Ctrl+Shift+Z` 和 `Ctrl+Y` 保持同一状态。右键菜单获得焦点时快捷键也会先关闭菜单并生效。
- `design-qa-current-annotation-history.png` 用真实生成的 PNG 验证了深绿工作面、暖色画板、清晰文本层级、方框选区与桌面右键菜单；隔离浏览器运行时还确认菜单首项焦点、撤销后的重做可用，以及重做后撤销可用。
- 新增“媒体转换台”作为工具空间内的独立懒加载页面，而不是塞进批处理页：`design-qa-current-media-desk.png` 在 1440 × 1000 下验证了深绿工具导航高亮、暖纸背景与三段式“输入 → 一个输出 → 目标位置”工作流。浏览器预览会明确显示“仅桌面端可用”，不会伪造转换成功。
- 桌面桥接只把 FFprobe 元信息和最终输出路径交回界面；FFmpeg 在原生后台直接读取和写入文件。FFmpeg 与 FFprobe 必须同时可用，输出以 `-knitspace-` 命名并自动避开已有文件，原件不会被覆盖。源文件卡支持右键、菜单键与 Shift+F10 的重新读取、在文件夹显示和移除操作。
- 媒体转换现已具备可控的长任务反馈：FFmpeg 的标准进度管道会以约 220ms 节流发给桌面端，媒体页只在进度跨 2% 或超过 700ms 后同步任务历史，避免进度持久化反向造成卡顿。运行时会锁定输入、输出与任务选择，显示可访问进度条和“停止本次转换”；取消会终止进程并只删除应用自己的临时输出文件。任务中心和历史会正确显示“已取消”而非“失败”。
- `design-qa-current-media-progress.png` 复核了 1440px 下媒体页的初始桌面布局与“无桌面引擎”安全降级。浏览器不伪造本机转换的运行态；原生层以 4 条专项单元测试和实际 FFmpeg 冒烟测试覆盖进度格式、任务串行、临时 MP3 输出、安全落盘和输入哈希不变。
- 全局“任务中心”现在也会为运行中的媒体任务提供紧凑的“停止”按钮：它使用任务中保存的临时运行标识向原生层发送取消，而不是依赖仍挂载的媒体页。页面端会识别任务中心发出的取消请求，将结果归类为“已取消”；离开工具页后也不会把成功停止误记成失败。
- PDF 的合并、拆页、旋转、提取、重排、水印、页码与文字提取均改由按需创建的 `pdf-tools.worker` 执行：页面只读取输入、显示节流后的进度并保存单个输出。输入和输出 `ArrayBuffer` 均以可转移对象传递；拆页时 Worker 会等待每一页已保存的确认后才生成下一页，因此不会把长 PDF 的所有独立页面同时留在内存中。PDF 引擎不再进入工具页首屏，生产构建中 `BatchView` 为 26.24 kB，PDF Worker/阅读器仅在实际 PDF 任务启动后加载。
- 此次回归：`pnpm check` 通过（包含类型检查与生产构建），`pnpm test` 通过 19 个文件、108 条测试，`pnpm check:public` 通过。构建仍只保留既有 Mermaid 与 Cynefin 大块警告；PDF Worker 为单独产物，不引入新的首屏块警告。
- 知识库左侧文档列已改为固定 60px 行高的窗口化渲染：在滚动、筛选或通过链接打开远处文档时，DOM 只保留视口附近的缓冲行，选中项会自动滚入可见区域。输入筛选以 140ms 延后应用，仍只比较标题、分类和标签；右键、菜单键、Shift+F10 与焦点恢复均沿用原有文档菜单。`virtual-window.test.ts` 覆盖起点、空列表和尾部边界；1440 × 1000 本地预览确认资料库的暖纸背景、深绿导航和空状态入口保持完整。
- 桌面资料库启动现在只传输文档的标题、分类、标签、复习状态等摘要；左侧列表仍保留完整可辨识的信息层级，而选中笔记或进入复习时才从本机 Markdown 读取正文。阅读区会显示低干扰的“正在打开笔记”状态，复习卡加载期间会禁用评分和快捷键，避免摘要覆盖正文。用户主动导出备份时会先取得完整正文，恢复的文档则被视为已完整加载。原生资料库回归 10 项、前端 111 项测试、类型检查/生产构建与公开版隔离校验均通过；构建仅保留既有 Mermaid 与 Cynefin 体积提示。
- Markdown 性能回归基准现分为约 1 MB、3 MB、5 MB 三档；标题、公式、代码、Mermaid 与相对图片引用按全文比例分散，避免只测首屏内容。默认生成的三个文件均在 `benchmarks/generated/`（已被 Git 忽略），`pnpm benchmark:markdown:check` 已逐档验证大小、结构化块、任务列表、表格和超长单行文本。超过 768 KB 的文档继续保持“按需完整预览”策略，源码编辑、切换页面和右键操作不会自动构建整篇 DOM。
- 性能基准新增 `pnpm benchmark:markdown:gate`：三档各运行五次，以中位数降低单次调度抖动，并同时限制冷解析、热缓存、热/冷比例、预览 HTML 膨胀率和安全分段数量。预算相对本机 2026-08-10 实测值保留一个数量级以上余量（冷中位数约 16/35/61 ms，热中位数约 3/8/12 ms），目标是阻止灾难性回归而非比较不同 CI 机器的微小时间差；该门槛现已接入 GitHub CI。
- “今天”页的六个高频启动卡现在也采用统一桌面菜单：单击仍是一步执行，鼠标右键、菜单键或 Shift+F10 则显示执行、关联空间和（可用时）常用工具收藏操作。菜单按实际项数避让窗口边缘，首项自动获得焦点，方向键 / Home / End 循环导航，Escape 回到启动卡。1440 × 1000 本地预览确认暖白菜单面与深绿焦点在专注面板、启动卡和固定导航间保持清晰层级，不被滚动容器裁切；`pnpm test` 的 20 个文件、111 项测试与生产构建均通过。
- 全局 `--muted` 语义色已由 `#718178` 调整为 `#586a61`：它在暖纸背景 `#fffcf6` 上的对比度从约 4.01:1 提升至约 5.62:1。时间、元信息、状态提示和右键菜单标题在保留低层级视觉语气的同时，不再依赖过浅的灰绿色文字。
- 知识库中的空白 Markdown 不再在“预览”模式留下无反馈的大面积白区：若正文只有自动生成且会被隐藏的同名 H1，阅读区会呈现轻量本地写作启动卡；点击后切到源码模式并把焦点交给 CodeMirror。新建笔记和错题则直接以 `?mode=edit` 打开，避免首次录入绕回空预览。启动卡仅匹配无可见 Markdown 内容，不改变普通笔记、大文档的按需预览或 Worker 渲染路径。
- 复习卡已接入共享桌面菜单约定：鼠标右键、菜单键与 Shift+F10 均使用相同的窗口边缘避让；卡片通过 `aria-haspopup` / `aria-expanded` 暴露菜单状态，首项自动获得焦点，Escape 或“继续复习”会把焦点还给卡片。1440 以下桌面预览中，暖白菜单面、深绿焦点和长题目正文没有发生层叠或横向溢出。
- 全局视觉令牌补齐了 `--font-ui`，并明确复用离线中文无衬线字体链。此前有 26 处紧凑标签、工具操作和菜单文字通过未定义变量使用 `font` 简写，可能退回到继承字体；媒体转换台运行时现确认令牌与这些操作标题的计算字体完全一致，且没有桌面端横向溢出。

## 桌面 Markdown 打开入口（2026-08-10）

- 全局 `Ctrl+O`、工作区空白处右键和原生标题栏右键共用同一个系统文件选择与一次性交接流程；支持多选 `.md`、`.mdx`、`.markdown`、`.mkd`，初始化未完成时会给出明确反馈，不提前抢占资料库。
- 1280 × 720 浏览器渲染回归中，工作区菜单为 248 × 303 px，距窗口底边约 19 px，没有被滚动容器或窗口边缘裁切。首项“打开本地 Markdown”自动获得焦点，`End` 到达末项，`Escape` 关闭，`Shift+F10` 可从主工作区重新打开并在关闭后恢复 `#main-content` 焦点。
- 菜单复用暖白表面、深绿主文字和灰绿说明文字；按钮聚焦态的半透明绿色叠加后仍保持清晰文字层级。入口不展示文件绝对路径，也不把路径写入 URL、`localStorage` 或前端持久化状态。
- 浏览器回归只验证渲染和键盘层；系统文件选择器、单实例队列以及资源管理器文件关联由真实 Tauri 冷启动/已运行场景和 Debug NSIS 构建验证。

## 五空间动态工作区菜单（2026-08-10）

- 工作区空白处右键或在 `#main-content` 按 `Shift+F10`，会根据当前所属空间显示 4–5 项高频能力；公共区固定提供打开本地 Markdown、收集剪贴板、浏览全部功能和全局搜索。上下文动作引用既有导航对象，不建立第二份路由清单。
- 复习空间补齐“单词库”入口，使单词卡、题目卡与 FSRS 队列都能从该空间直接到达。单元回归保证五个空间各有 4–5 个上下文动作，并且每项都属于对应空间的导航能力。
- 1280 × 720 运行时回归逐一检查五个空间：今天/知识库菜单约 446px 高，创作/复习/工具约 483px 高，最长菜单底边约 706px，没有被窗口裁切；菜单保留 `max-height` 和纵向滚动以覆盖更矮窗口。
- “浏览全部功能”会打开按五空间分组的功能地图并把焦点交给搜索框。复习卡的全局 `Shift+F10` 监听现在只在焦点属于卡片时响应，避免与工作区菜单同时打开；标题栏也支持菜单键或 `Shift+F10`。
- 本轮生产构建仍为 4602 个模块，主入口约 175.90kB（gzip 57.19kB）；新增菜单只使用现有导航元数据、图标和 CSS，没有引入依赖或新的大块。完整前端回归为 81 个文件、343 项测试。

## 桌面文字与首屏性能门槛（2026-08-10）

- 在 1280 × 720 下逐一扫描今天、知识库、Markdown、单词、创作、复习、工具、图片、代码分享、开发工具和设置共 11 个主要路由；所有页面的文档宽度差均为 0，没有用户可见的横向滚动。代码分享页位于负坐标的节点是专用导出画布，不参与可见布局。
- 首轮扫描发现全局快速捕获快捷键为 7px，创作空间有 10 个、工具空间有 24 个可见文字低于 9px。壳层快捷键和系统条、创作最近记录/工作流标签、工具分类/状态/任务/辅助说明已提升到至少 9px；二次扫描中三处低于 9px 的可见文字均为 0。
- 深绿英雄区的低层辅助文字同时提高不透明度，浅色工作面继续使用已验证的 `--muted: #586a61`，避免只放大字号却保留灰字压灰底。字体仍来自 Segoe UI Variable、Microsoft YaHei UI 等本机链，没有增加网络字体和首屏字体请求。
- 新增 `scripts/check-startup-budget.mjs`：只解析生产 `index.html` 引用的入口资源，分别限制 JS 230KiB/75KiB gzip、CSS 460KiB/90KiB gzip，并将首屏总 gzip 限制为 165KiB。当前生产结果为 JS 171.77KiB/55.85KiB gzip、CSS 412.93KiB/73.76KiB gzip、合计 129.61KiB gzip。
- 门槛已接入 GitHub CI 的生产构建之后，并由 3 项纯函数测试覆盖入口资源识别、单项超限和总量超限。本轮完整前端回归为 82 个文件、346 项测试，Public Core 检查覆盖 339 个发布文件。

## Typora 式 Markdown 编辑右键菜单（2026-08-10）

### Evidence

- Source visual truth: `<QA_TEMP>\codex-clipboard-8e240b4f-1529-4e98-956b-04225916944c.png`
- Implementation full-window screenshot: `<QA_TEMP>\knitspace-typora-menu-copy-submenu.png`
- Focused implementation crop: `<QA_TEMP>\knitspace-typora-menu-focused.png`
- Source pixels: 453 × 265. Implementation full window: 1256 × 829. Focused implementation crop: 500 × 308.
- State: Knitspace 真实 Tauri 开发窗口，Markdown 编辑模式，全文选择，右键主菜单已打开，“复制 / 粘贴…”子菜单为可见悬停状态。
- Density normalization: 参考是菜单局部裁剪，因此对比以控件尺寸、内边距和行密度为准，不将应用工作区背景计入差异。

### Findings

- 无可执行的 P0/P1/P2 差异。实现保留了参考图的四项剪贴板快捷按钮、两行高频格式、分组行、右侧子菜单和紧凑密度。
- 客观差异可接受：参考使用冷灰白面，Knitspace 依照既有产品令牌使用暖纸白、深绿悬停和更清楚的焦点边框；参考中未落地的“插件”分组被替换为真实可用的“文档操作”。
- P3 后续打磨：如果未来引入真正的扩展系统，可再在底部加入动态插件分组；当前不用静态占位项假装已实现。

### Required fidelity surfaces

- Fonts and typography: 离线 `Microsoft YaHei UI` / `Segoe UI Variable` 字体链、11px 菜单正文和 8px 快捷键层级清楚，中文无截断。
- Spacing and layout rhythm: 236px 主面板、258px 子面板、7px 容器内边距、5px 图标间距与 35–36px 命令行重建了参考的紧凑节奏；子菜单靠近右边界时会自动向左展开。
- Colors and visual tokens: 使用 Knitspace 暖白表面、深绿主交互色和灰绿辅助文字，选择、禁用和悬停状态不只靠颜色表达。
- Image quality and assets: 参考不包含位图资产；所有操作图标复用项目既有 Lucide 组件，没有文字符号或手写 SVG 替代。
- Copy and content: 复制 Markdown、HTML 代码、去格式文字、纯文本粘贴和本地图片粘贴与参考的核心文案一致；新增任务列表、代码语言、表格、公式、Mermaid、双链、分屏和专注阅读的真实入口。

### Interaction verification

- 鼠标右键和 Shift+F10 共用编辑器菜单路径；右键选择外的位置会先移动光标，选择内部右键保留选区。
- 高频图标、复制子菜单和子菜单左向边界避让已在真实 Tauri 窗口中验证。
- 新增列表与语言化代码块命令有 Vitest 回归覆盖；Vue 类型检查和 Vite 生产构建通过。

### Comparison history

- Pass 1: 旧版为 244px 纵向文本列表，与 Typora 参考的高频图标和分层子菜单存在 P1 信息架构差异。
- Fix: 改为四宫格剪贴板工具、八项格式网格和四个真实功能子菜单，同时加入窗口边界方向判断。
- Pass 2: 同状态聚焦裁剪对比未发现可执行的 P0/P1/P2 差异。

final result: passed

## 题目来源、知识点与复习贯通（2026-08-12）

- 题目结构新增可选“来源 / 出处”，用于保存题库编号、教材章节、课程或链接。它不是孤立的界面字段：单题编辑、快速捕获、CSV / TSV 批量导入、复制导入行、桌面 Vault 元数据、全文检索与复习题面共用同一份数据；旧题和旧备份缺少字段时安全补为空值，不需要破坏性迁移。
- 知识点继续复用已有标签与实体关系，没有再建立一份会漂移的 `knowledgePoints` 数组。题目编辑头部的“标签”改为“知识点”，输入提示为“添加知识点后回车”；侧栏仍可进一步建立前置知识、相关与变式关系。
- 结构条展示 6 个可操作入口，但完成度仍只计算题干、答案、解析、错误做法和错因 5 个核心项；来源明确标注“可选”，不会让完整度失真。来源可从结构条点击、侧栏输入，也可从右键 / `Shift+F10` 的题目菜单直接定位。
- 1280 × 720 浏览器开发版实测：6 项结构条没有横向溢出，来源输入标签、占位提示和焦点样式清楚；右键菜单完整位于视口并包含“补充来源 / 出处”。批量导入用一条含来源与两个知识点的 TSV 预览，正确显示 `算法课程第 3 讲 · 数组 / 边界`，导入按钮可用；随后取消，没有写入 QA 数据。
- `ui-ux-pro-max` 的真实标签、键盘等价、可见焦点、高对比、渐进披露与大型列表有界更新原则被采用；保持 Knitspace 暖纸 / 深绿桌面视觉，没有引入在线字体、动画或常驻依赖。题目批量解析继续在 Worker 中完成，来源仅是最多 2,000 字符的短元数据。
- 回归：前端 126 个文件 / 530 项测试通过；Rust 81 项通过、4 项系统集成测试按设计忽略；类型检查、个人版与 Public Core 构建通过。首屏脚本 65.02 kB gzip、样式 80.77 kB gzip、总计 145.79 kB gzip，启动预算通过；423 个 Public Core 发布文件未发现个人路径或高置信密钥。个人开发构建已恢复到 `dist`，预览进程与临时日志已清理。

final result: passed

## 完整 Vault 恢复前只读审阅（2026-08-12）

- 完整恢复此前在选中 ZIP 后只显示通用确认文字，用户无法知道归档包含多少内容、是否比当前 Vault 更少或是否来自更新版本。现在新增原生只读体检：验证 ZIP 安全路径、重复路径、文件数量、声明展开大小、SQLite `quick_check`、schema 兼容性，以及每条文档索引是否存在对应 Markdown；不满足任一条件时不会创建安全副本，更不会触碰当前资料库。
- 体检只把归档内的 SQLite 快照流式复制到唯一临时目录，旧 schema 在临时副本上迁移后检查；Markdown、PDF、图片和其他受管原件不会解压到页面，也不会跨原生边界。临时检查结束后立即删除；归档清单最多 250,000 项、声明展开大小最多 4 TiB、SQLite 最大 8 GiB，并拒绝路径穿越、重复文件与未来 schema。
- 用户确认恢复时原生层会重新运行同一体检，防止审阅后 ZIP 被替换；随后才创建当前 Vault 的恢复前安全归档。实际解压阶段再次独立执行文件数量、总大小、重复路径和 schema 门禁，最后仍在旁路目录中完成健康检查，只有全部通过才原子交换目录。
- 设置页现在先显示“正在只读检查”，通过后打开专用恢复审阅：明确呈现 ZIP / 展开大小、文件数、schema、当前 Vault → 归档恢复后的文档与结构化内容规模，并在归档更少时用图标、文字和暖红底共同警告。四项检查结果解释 SQLite、Markdown、版本和恢复前安全副本；主要破坏性按钮与安全取消按钮语义清晰。
- 审阅对象使用 `shallowRef`，归档附件和 Markdown 不进入 Vue 深层响应式；检查和恢复均在原生阻塞线程执行，页面只接收有界计数摘要。恢复审阅属于 Settings 路由分块，没有增加首屏组件或常驻轮询。
- 1280 × 720 开发态桌面走查：审阅框为 820 × 533 px，边界 left 230 / right 1050 / top 93 / bottom 627；页面与弹窗均无横向或纵向溢出。初始焦点落在“取消，保持当前资料”，Esc 关闭后可见提示“当前资料未修改”；测试归档比当前少 23 篇文档和 91 项结构化内容时，差异警告完整可见。
- `ui-ux-pro-max` 的破坏性操作确认、明确恢复路径、进度反馈、`role=alert`、可见焦点、减少动态、有界大对象和稳定弹层原则被采用；推荐的蓝色 / 琥珀后台配色、在线 Fira 字体与营销作品集结构不符合 Knitspace 暖纸深绿的本地工作台定位，未采用。
- 回归：123 个前端测试文件 / 521 项通过；Rust 79 项通过、4 项按设计忽略；个人版与公开版生产构建通过。个人版首屏脚本 63.38 kB gzip、样式 80.83 kB gzip、总计 144.22 kB gzip，启动预算通过；419 个 Public Core 发布文件未发现个人路径或高置信密钥。预览进程已停止，1421 端口确认释放。

final result: passed

## Vault Markdown 外部修改协调（2026-08-12）

- Knitspace 自管的 `notes/<uuid>.md` 与 `questions/<uuid>.md` 现在拥有原生事件监听，不再只有“打开本机 Markdown”工作区能发现 Typora、Obsidian 等程序的修改。监听范围严格限制为两个直属目录和 UUID Markdown 文件，忽略附件、SQLite、临时写入兄弟文件；事件按文档 320 ms 合并，没有常驻轮询或正文扫描。
- 磁盘正文改变时，Rust 在同一 SQLite 事务中更新正文 hash、FTS5、Markdown 双链投影和版本历史，不反写磁盘文件，也不丢失题目答案、解析、错因、复习状态等结构化字段。外部修改前的最近索引版本会被固定为恢复点；普通自动保存仍保持原有 5 分钟合并语义。
- 当前编辑器始终拥有冲突决策权：即使原生读取期间刚开始输入，也不会被后台正文覆盖。存在草稿分歧时自动保存暂停，页面常驻显示“比较并处理 / 版本历史”；右键或 `Shift+F10` 提供同一安全入口。审阅时再次读取磁盘 hash，支持使用磁盘、草稿覆盖和“保留两份”；保留两份先逐字建立独立草稿副本，再协调原文档。
- 磁盘文件被删除时不自动重建，也不清除 SQLite 与版本历史。页面以红暖色提示自动保存已暂停，并提供明确的“用当前版本重新创建”；只有原生原子写入成功后才清除缺失状态。未打开文档只协调轻量元数据，仍保持正文按需加载。
- 修复了活动文档广播的初始化竞态：父级监听在子页面即时 watcher 运行前注册，首次打开文档也不会漏掉活动 ID。冲突预览和磁盘文档使用 `shallowRef`，大对象不进入深层响应式；差异仍由有界 Worker 在用户明确打开审阅时计算。
- 1280 × 720 开发态桌面走查：提示条为 698 × 53 px，无自身或页面横向溢出；右键菜单为 270 × 158 px，边界 left 917 / right 1187 / top 295 / bottom 453，完整位于视口，首项自动聚焦，`Shift+F10` 与鼠标右键等价。冲突对话框为 940 × 454 px，边界 left 170 / right 1110 / top 133 / bottom 587，无横向溢出，初始焦点为“继续编辑”，Esc 正常返回。
- `ui-ux-pro-max` 的明确恢复路径、`role=alert`、键盘等价、可见焦点、稳定层级、高对比和大对象浅响应式原则被采用；其蓝色 CTA、营销作品集布局、超大标题和在线字体不符合 Knitspace 暖纸深绿的本地桌面工作台定位，未采用。
- 回归：123 个前端测试文件 / 519 项通过；Rust 77 项通过、4 项按设计忽略；个人版与公开版生产构建、启动预算和 Public Core 门禁通过。个人版首屏脚本 63.36 kB gzip、样式 80.83 kB gzip、总计 144.20 kB gzip；418 个 Public Core 发布文件未发现个人路径或高置信密钥。浏览器预览进程已停止，1421 端口确认释放。

final result: passed

## P3 自由画布闭环与桌面右键验收（2026-08-11）

- 视觉能力不再必须先导入图片：新增横向 1600 × 1000、方形 1080 × 1080、竖向 1080 × 1440 三种透明空白底图，可直接添加方框、箭头和文字，并继续保存为可编辑的本地画布项目。
- “图片表达工作室”统一更名为“视觉画布工作室”；创作侧栏直接暴露工作室与“新建自由画布”两个入口，创作总览首要动作也可直接进入空白画布，避免功能只在“今天”页可见。
- 空白起点同时支持按钮、鼠标右键、菜单键和 `Shift+F10`。右键菜单明确显示三种尺寸；画布建立后仍保留项目保存、复制预览、导出、清空标注和新建项目等上下文操作。
- 画布实际导出尺寸不再固定为 1600 × 1100；预览比例、标注缩放、标题与署名渲染都跟随所选底图尺寸。背景色会计算相对亮度，在深浅背景间选择对应标题与署名颜色。
- 1240 × 820 真实 Tauri 开发窗口验证侧栏入口、空白起点、横向与竖向画布、右键菜单和键盘菜单。首轮发现竖向标题贴顶被裁切，修复后竖向画布使用独立滚动安全区，标题、右侧尺寸卡与属性输入均完整可见，无横向溢出。
- 空白底图文件名只记录受限尺寸预设，解析时校验 320–4096 px 边界；图片数组继续使用 `shallowRef`，视觉路由与 Konva 标注层继续按需加载，图片处理和长图拼接继续由 Worker 执行。VisualStudio 产物保持独立懒加载分块，没有进入首屏包。
- `ui-ux-pro-max` 的键盘等价、右键补充操作、字体背景对比、焦点可见、图像尺寸约束、懒加载与避免深层响应式开销建议被采用；其高饱和营销区块、在线展示字体和 48 px 大留白不符合 Knitspace 暖纸、深绿、紧凑桌面工作台定位，未采用。
- 回归：104 个前端测试文件 / 440 项通过；Rust 69 项通过、4 项按设计忽略；4,625 模块生产构建、138.30 KiB 首屏 gzip 预算与 381 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。开发进程树已停止，1421 端口确认释放。

final result: passed

## P2 结构化题目入口与桌面右键（2026-08-11）

- 题目页不再把核心学习字段藏在右侧检查器：编辑区新增常驻“五段题目结构”栏，直接显示题干、答案、解析、错误做法和错因的完成状态，并把下一项补充入口保持在首屏。点击任一字段会打开“题目与复习”检查器、滚动到对应输入框并聚焦。
- 题型从仅存储但不可管理的元数据提升为可见工作流：侧栏支持算法 / 编程、数学、理科和通用筛选，编辑标题区可以直接选择题型，列表行显示题型。旧题目缺少该字段时稳定归入“通用”，不会在筛选后消失。
- 五段结构继续共用一份题目数据，答案回忆卡与错因复盘卡仍保持独立 FSRS 状态；结构栏只计算五个固定字段，不扫描正文或加载重型编辑器。筛选和摘要使用 computed，列表继续虚拟化并保留 `v-memo`。
- 1240 × 820 真实 Tauri 开发窗口确认题型筛选、题型选择器、五项状态和继续补充入口均在桌面页面直接可见；暖纸表面与深绿状态色保持低饱和，字段同时使用图标、文字和完成计数，不依赖颜色单独表达。
- 结构栏鼠标右键和键盘聚焦后的 `Shift+F10` 均打开同一组六项菜单：编辑题干、编辑答案与解析、记录错误做法与错因、切换两类复习卡、去复习当前题型。首项自动聚焦，Escape 可关闭；QA 只查看现有示例题，没有保存或改变个人数据。开发进程已停止，1421 端口确认释放。
- `ui-ux-pro-max` 的表单反馈、输入可供性、键盘等价、焦点可见、语义状态、懒加载、computed 缓存与 `v-memo` 建议被采用；其检索结果中的高饱和紫色、Baloo / Comic Neue 在线字体和 48 px 营销页间距不符合 Knitspace 暖纸、深绿、本地桌面学习台定位，未采用。
- 回归：103 个前端测试文件 / 437 项通过；Rust 69 项通过、4 项按设计忽略；4,624 模块生产构建、137.91 KiB 首屏 gzip 预算与 379 个 Public Core 发布文件检查通过。`rustfmt --check src/vault.rs` 与 `git diff --check` 通过，后者仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 大文档输入保护与快速保存边界（2026-08-11）

- 现有 CodeMirror 虚拟化编辑、Markdown Worker、分段缓存、视口内代码 / KaTeX / Mermaid 延迟渲染和 768 KiB 以上手动完整预览继续保留；本轮没有重复实现已经生效的大文档预览保护。
- 审计发现编辑器虽然会合并正文更新，但键盘输入尚在 120–320 ms 合并窗口内时立刻按 `Ctrl+S`，父页面可能仍克隆旧正文；同一窗口内切换内容也可能在完整正文上送前尚未显示“未保存”。这是一处比单纯卡顿更优先的数据边界。
- 编辑器现在首个按键立即发出轻量的 pending 信号，页面马上进入未保存状态，不需要先生成多 MB 字符串；真正的完整正文按 120 / 320 / 520 / 720 ms 四档合并送往 Vue、预览、统计 Worker 与恢复草稿。状态栏会显示大文档当前采用的 0.3 / 0.5 / 0.7 秒合并更新档位。
- 保存操作会在克隆草稿前同步 `flush()` CodeMirror，因此鼠标保存和不触发 blur 的键盘保存都使用最新正文；离开页面仍会先看到未保存确认。外部文件回填编辑器时增加抑制边界，不会把程序同步误判为用户输入。
- 1 / 3 / 5 MB 性能门禁新增 CodeMirror“小改动 → 完整正文投影”测量，当前中位数分别为 0.6 / 0.8 / 0.7 ms；Markdown 冷解析中位数为 23.4 / 38.7 / 83.5 ms，热缓存中位数为 4.1 / 8.9 / 12.6 ms，三档均通过预算。基准明确不把 DOM、Vue 分发和按视口加载误算进 Worker 解析时间。
- 查找 / 替换面板的按钮与复选项由 9 px 提升至 10 px，保持暖纸背景、深绿焦点和清晰输入边界。1240 × 820 真实 Tauri 开发窗口确认编辑、分屏、预览、图谱四种模式可见；右键菜单包含剪贴板、八个高频 Markdown 格式、代码块、插入、常用工具、学习工具和文档操作，`Ctrl+F` 中文查找 / 替换面板完整显示。
- 桌面 QA 只读取现有笔记并打开菜单，没有写入测试字符、保存内容或导入 5 MB 文件，避免为验证性能污染个人 Vault。`ui-ux-pro-max` 的可读字号、可见状态、键盘等价、Worker、虚拟化、懒加载与批量更新建议被采用；其营销页布局、在线 Lora / Raleway 字体和高饱和配色未采用。
- 回归：102 个前端测试文件 / 433 项通过；Rust 69 项通过、4 项按设计忽略；4,623 模块生产构建、137.25 KiB 首屏 gzip 预算与 377 文件 Public Core 检查通过。`rustfmt --check src/vault.rs` 与 `git diff --check` 通过，后者仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 知识空间可读性与桌面任务布局（2026-08-11）

- 对“今天、知识、创作、复习、工具”五个一级空间进行了字号与层级审计；知识空间原有 31 处 7–10 px 文本，是本轮最明显的可读性短板。正文说明提升至 13 px，内容标题与任务标题提升至 11–12 px，元信息保留在 10 px，并提高暖纸背景上的深绿色文字对比。
- “从任务开始”从拥挤的侧栏改为全宽工作区：桌面端 8 个任务入口稳定排列为 4 × 2，标题、说明和“打开本机 Markdown”均完整显示；不再出现三列布局留下第九个空白格的问题。内容条目使用普通指针反馈，避免误把 `context-menu` 光标当成唯一操作方式。
- 1440、1240、1024 px 宽度下保持四列任务入口；900 px 下切换两列并隐藏次要概览卡。四档实测均无标签截断、详情截断或横向溢出，1240 × 820 下任务区高度约 112 px，没有为布局修复增加额外滚动负担。
- 内容条目鼠标右键菜单实测边界为 581–833 × 449–775，完整位于 1240 × 820 视口内，首项“继续打开”自动聚焦；Escape 可关闭，`Shift+F10` 可重新打开同一菜单。页面控制台无 warning 或 error，QA 服务器及其进程树已关闭，1421 端口确认释放。
- `ui-ux-pro-max` 的正文可读字号、文本对比、悬停反馈、语义操作和 Vue 轻量渲染建议被采用；营销页式蓝色 CTA、Caveat / Quicksand 在线字体和单列落地页结构与 Knitspace 暖纸、深绿、本地桌面工作台定位不符，未采用。
- 回归：101 个前端测试文件 / 428 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、136.15 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 本机能力页整卡入口与可读文字层级（2026-08-11）

- 本机能力卡由只有底部小按钮可点击的 `article` 改为整张语义化路由链接；页面“左键进入对应工作流”的说明现在与真实行为一致，Tab / Enter 可直接进入，鼠标右键、菜单键和 `Shift+F10` 仍打开诊断菜单而不误导航。
- 卡片可访问名称同时说明当前能力状态、左键结果和右键入口；焦点环、悬停边框、深绿动作文字与箭头继续沿用 Knitspace 的暖纸 / 深绿桌面语言，不增加图片、动效或常驻监听。
- 修正工具空间中偏小的文字层级：深绿 Hero 说明提升至 13px，卡片说明提升至 12px，诊断摘要和卡片动作提升至 11px，状态与英文标识提升至 10px；同时提高深色背景辅助文字的不透明度，减少“有内容但看不清”的情况。
- 1240 × 820 本地预览确认页面横向溢出为 0，能力卡最终 DOM 为可聚焦 `A` 元素且鼠标为 pointer；诊断菜单边界为 553–825 × 449–616.33，完整留在视口内。整卡点击进入 `#/settings?section=backup`，返回后右键与 `Shift+F10` 均重新打开同一菜单，运行日志无 warning / error。
- Tauri 开发进程、Vite 和真实 Knitspace 窗口均正常启动，但本轮 Windows 自动化连续两次未能激活新窗口句柄，因此没有把浏览器渲染截图误写成新的原生窗口证据；现有原生窗口验证仍保留，临时进程和 1421 端口已清理。
- `ui-ux-pro-max` 的功能可发现性、清晰焦点、正文对比、语义链接与键盘等价建议被采用；`frontend-design` 用于保持克制的本地工具仪表盘气质。比较营销页、Caveat / Quicksand 在线字体和高饱和蓝色 CTA 不符合 Knitspace 定位，未采用。
- 回归：101 个前端测试文件 / 428 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、136.15 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。Lab 页面继续按路由懒加载，样式 2.57 KiB gzip、脚本 5.98 KiB gzip；仅保留既有大分块提示。

final result: passed

## 画布项目接入统一内容体系（2026-08-11）

- 图片画布不再是独立功能岛：SQLite 的收藏与最近使用指针新增 `diagram` 类型，并通过 v15 无损迁移扩展原有检查约束；已有笔记、题目、单词与资料指针原样保留。
- 保存或打开画布会更新最近使用；活动画布右键菜单和创作页最近项目菜单可收藏/取消收藏。删除画布时，实体、源图目录、收藏与最近指针在原生层一致清理，前端同步移除缓存指针。
- 今天、知识库和 Ctrl+K 统一使用画布轻量摘要，只读取名称、更新时间、源图数与标注数，不读取最高 96 MB 的源图或标注正文。知识库的全部、收藏、最近与标题搜索可找回画布，快速开始区也直接暴露图片画布入口。
- 1240 × 820 Tauri 开发版实测：开发 WebView 首次白屏可用 `Ctrl+R` 在 Vite 就绪后恢复；创作空间、图片表达工作室和知识空间均正常加载，知识空间无横向溢出，新增“打开图片画布”入口可见。当前 Vault 没有画布项目，因此没有为 QA 擅自选择用户文件；真实收藏、最近和删除闭环由临时 Vault Rust 测试验证。
- `ui-ux-pro-max` 的清晰焦点、键盘可达、44 px 级交互目标、状态可见和快速加载建议用于本次检查；沿用 Knitspace 暖纸、深绿和本地字体，没有引入在线字体或营销式配色。
- 回归：100 个前端测试文件 / 425 项通过；Rust 66 项通过、4 项按设计忽略；4,621 模块生产构建通过。画布仍是按路由加载的大分块，全局摘要没有把图片依赖带入首屏。

final result: passed

## AI 内容工作台桌面重构（2026-08-10）

- 旧版深色三栏管理面板重构为与五空间一致的暖纸工作面、深绿确认区和三阶段桌面流程：选择任务、确认材料、人工复核草稿。摘要、翻译、改写、结构化提取和邮件草稿五项能力在页面左侧完整暴露。
- 主生成按钮由面板底部提升到输入区标题栏；1280 × 720 与 Tauri 最小 900 × 680 视口中均位于首屏，两个宽度都满足 `scrollWidth === clientWidth`。900px 下结果区自然排到下一行，避免把输入与输出压成不可读窄栏。
- 选择任务会通过 `?action=` 更新深链；当前配置、模型、字符数、预期产物、发送边界和未配置恢复入口都在操作发生前可见。请求失败不会抹掉上一份可用草稿，生成过程中也可继续阅读旧结果。
- 原先折叠状态仍会在每次按键时序列化整份 API 载荷；现在改为用户展开时才生成快照，正文变化只设置“需要刷新”状态，不重建大型 JSON DOM。结果 Markdown 组件只在生成草稿后异步加载。
- 草稿结果继续支持右键或 `Shift+F10`，可复制 Markdown、存入本地知识库或导出文件；菜单键盘焦点循环沿用统一桌面菜单协议。新增页面辅助文字均不低于 9px，暖纸正文与深绿状态区保留清晰对比。
- 实际交互验证：切换“中英翻译”后路由成为 `#/ai?action=translate`；载荷快照先包含原文，修改正文后显示“正文已变化 · 需要刷新”，刷新后包含新内容；无 API 配置时显示“先到设置中配置一个 OpenAI 兼容服务”。测试过程没有发起远程请求或写入用户 Vault。
- `ui-ux-pro-max` 的空状态行动指引、深链、懒加载、焦点和防裁切建议，以及 `frontend-design` 的明确视觉方向被采用；商品评论页、购买 CTA、蓝色营销色和在线 Caveat / Quicksand 字体未采用。
- 回归：83 个前端测试文件 / 348 项通过；4,603 模块生产构建、129.63 KiB 首屏 gzip 预算与 340 文件 Public Core 检查通过；`git diff --check` 退出码为 0，仅保留工作区既有 CRLF 转换提示。

final result: passed

## Public Core 干净快照发布边界（2026-08-10）

- `check:public` 不再只检查已跟踪文件名；它会从 Git 工作区收集“已跟踪 + 未跟踪但未忽略”的发布白名单文件，并扫描 Tauri 资源与 `dist`，因此当前尚未提交的新页面和 Worker 不会被漏掉。
- 内容策略会拒绝真实用户主目录、私钥块及 OpenAI / GitHub / Slack / AWS 高置信度令牌，同时允许 `C:\demo`、`F:\Vault`、`$DOCUMENT/KnitspaceVault` 与 `.env.example` 等通用测试或桌面作用域。
- 旧历史审计发现一个含 Windows 用户目录的历史提交，`check:public-history` 会明确失败并只报告提交短哈希与风险类别，不回显敏感文本，也不破坏性改写开发仓库历史。
- 新增 `export:public`：输出必须是工作区外不存在的绝对目录；导出器拒绝符号链接，只复制明确允许公开的源码和文档，生成 `PUBLIC_SNAPSHOT.json`，且从不复制 `.git`、Vault、个人包、构建产物或根目录 QA 截图。
- 真实导出 335 个文件；快照包含当前未跟踪的 `src/styles.workspace.css`，不含 `.git` 或 `design-qa-*.png`，清单明确记录 `historyIncluded: false`。
- 当前源码中的个人临时目录、工作区、Vault 与本机构建工具绝对路径均已替换为 `<QA_TEMP>`、`<QA_ARTIFACTS>`、`<WORKSPACE>`、`<VAULT_ROOT>` 或通用说明。
- 最终回归：80 个测试文件 / 338 项测试、4,601 模块生产构建、335 文件 Public Core 内容检查和 `git diff --check` 全部通过；仅保留既有 Mermaid / Cynefin 大分块提示与 CRLF 提示。

final result: passed

## 结构化词表批量导入（2026-08-10）

### Findings

- 单词库不再只能逐条录入：支持带中英文表头的 CSV / TSV、引用 CSV 和每行“单词 - 释义”的文本清单；同一词条的多个词性与释义会汇总为一个结构化实体。
- 入口同时暴露在知识库侧栏、Ctrl+K、单词页页头、列表空状态、列表页脚和首次使用引导，不依赖“今天”页面。
- 重复词可选择合并新词义或跳过；合并会保留原词义、复习状态与实体 ID，新增词义可按需直接加入 FSRS 词义复习。
- 文本限制为 1,000,000 字符、5,000 行，解析在独立 Worker 中完成；预览只挂载前 10 行，问题只展示前 4 行，避免长词表造成输入与滚动卡顿。
- 预览行支持右键或 `Shift+F10` 复制结构化行、从本次导入排除；菜单支持方向键与 Esc，Tab 焦点限制在模态层中。
- 桌面版一次调用原生批量命令，并在一个 SQLite 事务内更新实体、词义、复习卡与 FTS；任一条无效会整批回滚。浏览器预览仍使用本地有界存储。
- `VocabularySense` 新增独立常用搭配数组；SQLite v14 迁移为旧词义补充 `collocations_json` 并只重建单词 FTS。旧浏览器备份与异常恢复草稿通过克隆规范化自动补空数组。
- 单词编辑器以“例句 / 常用搭配 / 近义易混”三列呈现；批量导入识别“搭配、常用搭配、collocation”等表头，相同词性与释义会合并新搭配而不替换原复习状态。
- 常用搭配进入单词页搜索、SQLite FTS、Markdown 导出与复习答案；词条右键或 `Shift+F10` 菜单在有内容时提供“复制常用搭配”。

### Verification

- 当前开发版实测示例 TSV：3 个有效行整理为 2 个词条、3 个词义，1 个缺少释义的行明确拦截；首行右键菜单显示复制与排除操作。
- 桌面布局实测视口 1394 × 1272：弹窗 1120 × 623，正文双栏、选项与底栏均无溢出；右键菜单完全位于视口内。暖纸背景为 `rgb(245, 242, 233)`，正文为 `rgb(24, 39, 31)`，使用本机 Segoe UI Variable / Microsoft YaHei UI 字体栈。
- 搭配闭环实测：批量导入 `run a program | run locally` 后三列输入完整显示；搜索 `run a program` 可命中词条，右键菜单显示“复制常用搭配”。编辑卡宽 677 px，三列输入宽 230 / 200 / 200 px，无横向溢出；验收词条随后已删除。
- 前端全套 76 个测试文件、319 项通过；Rust v13→v14 迁移、FTS、批量回滚测试通过，Rust 全套 54 项通过、3 项环境测试忽略；生产构建 4,596 个模块与 Public Core 发布边界检查通过。

final result: passed

## 本机 Whisper 转写到字幕校对台（2026-08-10）

### Findings

- 设置新增独立“本机引擎”分区，选择 CLI / 模型只保存绝对路径；只有明确点击验证或在字幕台确认开始后才运行外部程序。
- 原生层使用参数数组而非 Shell 字符串：FFmpeg 生成隐藏的 16 kHz 单声道临时 WAV，Whisper 输出隐藏临时 SRT，验证大小后再移动为不覆盖原件的 `*-knitspace-transcript.srt`。
- 转写按“准备音轨 → 本机识别 → 载入校对台”显示阶段、百分比和可取消状态；取消会终止进程并清理临时音轨和未完成草稿，任务中心也能发送同一停止请求。
- 字幕页始终显示可折叠转写入口；未配置时给出局部恢复路径，已配置时显示媒体、模型、语言和输出边界，并在启动前再次确认。媒体卡支持右键或 `Shift+F10` 重新选择、打开位置和清除。
- 工具侧栏、Ctrl+K、工具目录与本机能力页均暴露“本机语音转写”；旧的“自动语音识别尚未接入”占位已移除。
- 设置仅持久化 CLI、模型和语言选择，不捆绑二进制或模型；Public Core 检查继续阻止模型、私人路径和密钥进入发布内容。
- `ui-ux-pro-max` 的阶段进度、局部错误恢复、非颜色状态、长路径截断与明确执行边界建议被采用；营销型高饱和色板与在线字体未采用。

### Verification

- 1280 × 720 开发版：转写展开区、未配置提示、设置跳转和原字幕导入区域同时可见；设置页能直接定位本机引擎，长路径区域有截断空间，页面控制台无错误。
- `pnpm test -- --run`：75 个测试文件、312 项全部通过；`pnpm build`：4,592 个模块通过。
- Rust：52 项通过、3 项环境测试忽略，其中本机转写新增 3 项参数、进度和取消状态测试；`pnpm check:public` 与 `git diff --check` 通过。
- 未在当前机器上运行真实 Whisper 模型，因为仓库和发布包不捆绑 CLI / 模型；实际程序与模型需要由用户在桌面设置中选择并验证。

final result: passed

## 公式图片识别与可校对 LaTeX 草稿（2026-08-10）

### Findings

- 公式图片识别被嵌入现有 Markdown 公式构建器，识别结果直接回填 LaTeX 源码与 KaTeX 即时预览，不另建孤立页面；创作侧栏、Ctrl+K 与工具目录都有独立入口。
- 原图先在后台 Worker 中缩放至最长 2048 px、转为白底 JPEG；原图上限 12 MB、实际发送上限 4 MB，主线程不承担大图重采样。
- 发送前展示实际将发送的 JPEG、尺寸和大小，并二次确认服务域名与模型；请求只携带该预览图，不附带笔记正文、文件路径或其他资料。
- 服务输出统一移除 JSON 包装、代码围栏和 `$` / `$$` / `\\[...\\]` 外壳，超过 4000 字符或空结果会拒绝回填；提示词明确把图片文字视为数据，降低视觉提示注入风险。
- 图片预览右键或 `Shift+F10` 可重新选择、复制图片名称或移除；菜单支持方向键与 Esc，不提供复制大型 data URL 等无意义操作。
- 新建笔记路由会保留一次性的 `recognize=formula` 参数，打开构建器后再清理；从入口进入时识别区直接展开，普通“插入公式”仍保持紧凑。
- `ui-ux-pro-max` 的渐进披露、明确授权、错误恢复、键盘焦点与低重排建议被采用；在线字体、营销色板和夸张展示区不适合 Knitspace 暖纸桌面工作流，未采用。

### Verification

- 1280 × 720 开发版实测：深链接创建笔记后识别区自动展开；图片入口、服务状态、隐私说明、LaTeX 编辑器和即时预览层级清楚，弹窗可在小窗口内滚动。
- 路由首次验收发现新建笔记时丢失识别展开参数，修复后增加“仅公式保留识别请求”的回归测试。
- `pnpm test`：74 个测试文件、309 项全部通过；`pnpm build`：4,591 个模块通过，新增图片处理继续复用 2.32 KB Worker。
- Rust：49 项通过、3 项环境测试忽略；`pnpm check:public`、`vue-tsc -b` 与 `git diff --check` 通过。

final result: passed

## Typora 风格编辑右键与外部工作区移动（2026-08-10）

### Findings

- Markdown 编辑区右键沿用 Typora 的“高频图标条 + 分组命令 + 二级菜单”：剪切、复制、纯文本粘贴、删除、格式、代码块和插入直接可见；复制为 Markdown / HTML、图片粘贴、学习工具与文档操作按用途渐进展开。
- 外部 Markdown 文件树补齐桌面剪切移动：项目右键“剪切以移动”，目标资料夹右键“移动到此处”，根目录使用顶部状态条；当前父目录、目录自身和子目录会禁用无效目标。
- 待移动状态同时显示图标、文字和行内标记，并可随时取消；移动成功后复用重命名事件更新已关联 Vault 文档路径，失败则保留剪切状态以便改选目标。
- 原生端校验工作区边界、符号链接、同名冲突和目录后代关系，再使用文件系统重命名完成移动；渲染层不能绕过这些保护。
- 文件树继续按需加载、固定行高虚拟化和 `v-memo`；剪切状态只保存单个项目元数据，不读取 Markdown 正文或递归扫描目录。
- `ui-ux-pro-max` 的键盘焦点、明确反馈、非颜色状态和 Vue 虚拟列表建议被采用；营销式版面、在线字体及与 Knitspace 暖纸深绿体系冲突的配色未采用。

### Verification

- 1280 × 720 开发版实测：外部工作区右键菜单完整位于视口内，目标资料夹首项为“移动“Knitspace 开发记录.md”到此处”；根目录来源显示“已在根目录”，没有无效操作。
- 同尺寸编辑区实测：右键菜单完整显示剪贴板按钮条、复制 / 粘贴、两行格式按钮、代码块、插入、常用工具、学习工具和文档操作，未被底部或右侧裁切。
- `pnpm test`：72 个测试文件、295 项全部通过；`pnpm build`：4,586 个模块通过；Rust：49 项通过、3 项环境相关测试忽略。
- `vue-tsc -b`、`cargo fmt --check` 与 `git diff --check` 通过；生产产物不含外部工作区 QA 样本字符串。

final result: passed

## 外部 Markdown 工作区文件闭环（2026-08-10）

### Evidence

- 1280 × 720 外部工作区：`<QA_ARTIFACTS>\knitspace-external-workspace.png`
- Markdown 文件右键菜单：`<QA_ARTIFACTS>\knitspace-external-workspace-menu.png`
- Windows 回收站确认层：`<QA_ARTIFACTS>\knitspace-external-workspace-recycle-confirm.png`

### Findings

- 外部 Markdown 文件右键菜单新增“创建 Markdown 副本”和“移入 Windows 回收站”；复制保留正文与扩展名，以“副本 / 副本 2…”有界查找可用名称，不递归复制大型资料夹。
- 原生端在复制、重命名和删除前统一校验工作区根目录、相对路径、规范化绝对路径、符号链接和 Markdown 扩展名，`..`、相似前缀目录及工作区根目录均不能成为越界目标。
- 删除由 Knitspace 危险操作确认层和 Windows `SHFileOperationW + FOF_ALLOWUNDO` 双层保护；若磁盘不能进入回收站，`FOF_WANTNUKEWARNING` 要求 Windows 再次警告，不会静默退化为永久删除。
- Rust 规范化产生的 `\\?\` 路径在完成边界校验后转换为 Shell 可接受的普通绝对路径，修复了真实回收站测试的 `ERROR_INVALID_LEVEL (124)`。
- 被移走的外部文件不会连带删除 Vault 文档；当前关联项立即进入“外部文件暂不可访问”，恢复磁盘文件后仍可继续同步。
- 文件树仍然按层读取、最多投影 10,000 项并使用 30 px 固定行高虚拟窗口和 `v-memo`；新增操作没有扫描正文，也没有为所有目录建立深层响应式对象。
- `ui-ux-pro-max` 的键盘可达、稳定悬停、浮层层级、高对比危险动作和非破坏性恢复建议被采用；作品集网格、在线手写字体、靛蓝/绿色营销色和移动端大卡片不适合 Knitspace 的暖纸桌面文件工作流，未采用。

### Verification

- 开发态只读 QA 文件树在 1280 × 720 下验证了两级目录、长文件名省略和菜单贴边定位；右键菜单包含打开、创建副本、重命名、资源管理器、刷新、复制路径和回收站七项，首项自动获得焦点。
- 危险确认层实际 DOM 为 `alertdialog`，明确说明 Vault 副本保留、恢复前停止同步和不可回收时的 Windows 二次警告；回归中选择取消，没有对 QA 文件树执行删除。
- 专用原生测试真实把仅由测试创建的 `recycle-qa.md` 移入 Windows 回收站并确认源路径消失；该测试默认 `ignored`，避免普通测试每次向回收站添加文件。
- `pnpm test`：72 个测试文件、294 项全部通过；Rust：49 项通过、3 项需本机能力的测试忽略；生产构建 4,586 个模块通过。
- 构建后搜索确认 `Knitspace QA`、示例目录和长标题不在 `dist/assets`；开发态 fixture 使用动态导入，不进入生产包。

final result: passed

## 编辑器异常退出恢复点（2026-08-10）

### Findings

- Markdown 文档与结构化单词的未保存内容会在输入停止后写入独立的 SQLite 恢复表；小内容延迟 1 秒，大于 1 / 4 MiB 的 Markdown 分别退避到 1.8 / 2.6 秒，不在每次按键时序列化或写盘。
- 恢复点不是正式版本：单条最多 8 MiB、全库最多 8 条，SQLite 事务负责覆盖和按时间淘汰；类型、实体 ID、JSON 与基础更新时间均需验证，旧正式版本的草稿不会覆盖后来保存的内容。
- 正常编辑只显示“未保存 · 已留恢复点”，不会反复弹出恢复提示；重新打开同一实体时才出现紧凑恢复条，可恢复为未保存修改或直接放弃。
- 文档与单词的右键 / `Shift+F10` 菜单在存在异常退出草稿时暴露“恢复异常退出草稿”和“放弃恢复点”；正常保存、明确放弃切换、删除实体和“放弃并退出”都会清理恢复点，隐藏到托盘则保留。
- 浏览器开发预览使用同一校验协议的有界 localStorage 回退，正式 Tauri 桌面版始终使用 Vault SQLite。
- `ui-ux-pro-max` 的明确恢复动作、非阻塞状态、键盘可达和错误反馈建议被采用；营销卡片网格、蓝橙 CTA、在线字体和夸张空白不符合 Knitspace，未采用。

### Verification

- Rust SQLite 测试通过：写入、读取、同实体覆盖、8 条上限淘汰、删除、损坏 JSON 拒绝和 8 MiB 上限均已验证。
- 1280 × 720 开发预览实际完成：修改 run 词义 → 等待“已留恢复点” → 刷新 → 正式内容仍为“跑；运行”且出现恢复条 → 恢复后临时内容回来 → 保存后刷新不再提示。
- 当前词条右键菜单实际出现两个恢复操作；从右键执行“放弃恢复点”后刷新，原始词义保留，QA 临时内容和恢复条均消失。
- `npm test -- --run`：71 个测试文件、288 项全部通过；`npm run build`：4,582 个模块构建通过。

final result: passed

## Markdown 未保存修改保护（2026-08-10）

### Findings

- 文档标题、分类、标签、题目字段和 Markdown 正文修改后，编辑器标题栏与当前列表行同时显示“未保存修改”；状态包含文字和圆点，不仅依赖颜色。
- 切换文档、打开版本历史、专注阅读、外部 Markdown、新建空白/模板/选区笔记、路由离开等入口统一进入“继续编辑 / 放弃修改 / 保存并继续”三向决策。
- `beforeunload` 与 Tauri 窗口关闭都能感知当前文档脏状态；即使用户以前选择“直接退出”，未保存时仍会重新询问。隐藏到托盘不会销毁编辑现场。
- 外部文件磁盘重载在覆盖未保存内容前单独确认；当前脏文档的资料夹移动和解除外部关联先保留在草稿中，不会用列表摘要覆盖正文。
- CodeMirror 更新事件携带所属文档 ID；旧编辑器卸载时迟到的防抖/失焦更新会被新文档拒绝，避免安全弹窗之后仍发生跨文档串稿。
- 脏状态使用布尔标记与固定文档 ID 比对，不在每次输入时计算全文 hash 或序列化大文档；弹窗遵守可见焦点、自然 Tab 顺序、Esc 返回编辑和减少动效设置。
- `ui-ux-pro-max` 的破坏性确认、键盘焦点、非颜色状态表达和 Vue 浅层状态建议被采用；高饱和营销区块、橙色 CTA、在线字体与作品集布局不适合 Knitspace 暖纸本地编辑器，未采用。

### Verification

- 1280 × 720 实际页面：编辑后列表行和标题栏显示“未保存”；三向弹窗完整可见，默认焦点为“继续编辑”，暖白表面与深色正文对比清晰。
- “继续编辑”保持当前 URL、当前文档和未保存正文；“放弃修改”切换到目标文档且恢复“已同步 · 本地”，验收字符串没有写入目标文档。
- 从文档页点击“今天”时，“继续编辑”阻止路由离开；再次选择“放弃修改”后才进入今天页。
- `vue-tsc --noEmit` 通过；70 个测试文件、285 项全部通过；生产构建完成 4,577 个模块，只保留既有大分块提示。

final result: passed

## Typora 式右键与文档版本历史（2026-08-10）

### Findings

- Markdown 编辑区右键保留 Typora 的高频结构：顶部剪切、复制、粘贴、删除，复制/粘贴二级菜单，八个格式按钮，以及代码块、插入、常用工具、学习工具和文档操作子菜单。
- “文档操作”新增版本历史入口；文档列表、阅读预览和更多操作菜单共用同一入口，避免功能只藏在“今天”或单独页面。
- 右侧“关联知识”更名为“文档信息”，版本历史与资料夹、关系、大纲、双链和回链处于同一文档上下文；浏览器预览明确说明版本只存在桌面 Vault，不伪造可恢复数据。
- SQLite schema v12 保存每文档最多 40 个快照；5 分钟内的连续保存合并，列表只返回标题、时间、字节数、摘要和当前状态，全文只在复制或恢复时读取。
- 恢复前先固定当前已保存版本；旧版只载入为未保存草稿。恢复草稿保留当前文档 ID、创建时间和当前外部 Markdown 关联，避免旧路径被意外复活。
- 版本卡片和菜单支持鼠标右键、`Shift+F10`、方向键与可见焦点；滚动定位遵守 `prefers-reduced-motion`，列表使用 `shallowRef`、`v-memo` 与有界长度。
- `ui-ux-pro-max` 的对比度、焦点、浮层层级、减少动画和 Vue 列表性能建议被采用；企业官网布局、蓝色 CTA、在线字体和营销式大标题不符合暖纸本地工作台，未采用。

### Verification

- 1280 × 720 实际页面：编辑器右键主菜单完整显示且未被窗口边缘截断；键盘展开“文档操作”后，7 项子菜单全部可见，“查看版本历史”具有本地标识。
- 版本历史入口能关闭右键菜单、打开“文档信息”检查器并滚动至版本区；浏览器回退显示桌面 Vault 说明，真实快照由 Rust 测试验证。
- Rust 定向测试通过：最近保存合并、强制恢复点、单一“当前”标记、快照全文读取和后续新版本均符合预期。
- `pnpm test -- --run`：69 个测试文件、281 项全部通过；新增 2 项前端恢复草稿边界测试。
- `pnpm run build` 通过，共转换 4,576 个模块；Markdown 预览/导出 Worker、Mermaid 和 PDF 仍独立分包。`git diff --check` 通过，仅有既有 CRLF 提示。

final result: passed

## Markdown 整篇输出与可打印 HTML（2026-08-10）

### Evidence

- 1280 × 720 桌面预览：文档“更多”菜单完整显示“复制整篇 Markdown”和“导出可打印 HTML”，菜单在视口内有界滚动，没有被窗口底部裁断。
- Typora 式编辑器右键：点击“文档操作”后显示整篇复制、HTML 导出与 `Ctrl+Shift+E`，同时保留查找、双链、分屏和专注入口。
- 实际导出样例包含即时编辑但尚未保存的标题、正文、公式和 Mermaid，页面返回“可打印 HTML 已导出 · 导出闭环验证.html”。
- 状态：使用与 Tauri 开发版相同的 Vite 页面、CodeMirror、Markdown Worker 和输出协议在隔离浏览器工作区验收；没有写入桌面 Vault 或更改用户文档。

### Findings

- 原有右键菜单只支持复制选区为 Markdown、HTML 或纯文本，文档菜单的“另存为并关联 Markdown”还会改变外部文件关联；现在新增独立的整篇复制和 HTML 导出，不改变原文、关联路径或 Vault 结构。
- 活动文档始终从 CodeMirror 当前缓冲区读取正文，因此 120 / 320 ms 防抖窗口内的最新输入也会进入复制和导出；非活动文档按需从 Vault 加载完整正文，不使用列表中的轻量元数据冒充内容。
- HTML 导出通过一次性 Worker 排版 Markdown、代码和公式；主线程只负责有界嵌入最多 120 张本地相对图片、按需绘制最多 60 个 Mermaid 图表和组装文件，完成后立即终止 Worker。
- 重型导出模块只在用户明确执行导出时动态加载。生产产物中入口约 3.28 KB，独立 Markdown Worker 约 448.65 KB；Mermaid 继续按需加载，不进入文档页首屏路径。
- 导出任务分为排版、图片、图表和组装四阶段，编辑器标题栏显示真实阶段与进度，任务历史同步记录输入、输出、失败详情和可重试元数据；并发导出会被明确阻止。
- 生成的 HTML 使用暖纸背景、深墨正文、本机中文字体、打印样式、响应式边距和 65–75 字符附近的阅读宽度；公式使用内置 MathML，避免单文件暗中依赖 KaTeX 字体目录，Mermaid 则写入最终 SVG。
- 文件名过滤 Windows 半角保留字符、控制字符、尾随点空格和设备保留名，同时保留合法的中文全角标点；标题和 HTML `<title>` 均进行转义。
- 文档菜单增加 `max-height: calc(100vh - 24px)`、纵向滚动、禁用态和焦点态；编辑器右键子菜单继续支持鼠标、方向键、`Shift+F10` 与 Escape，不产生新的浮层体系。
- `ui-ux-pro-max` 的多阶段进度、键盘全可达、明确焦点、稳定 z-index、按需加载和正文对比建议被采用；作品集网格、在线字体、橙色 CTA、触屏手势和营销式微动效不符合 Knitspace 本地桌面工作流，未采用。

### Verification

- 浏览器实际 DOM：文档菜单 11 个操作完整可达；右键“文档操作”子菜单 6 项完整可达；包含公式与 Mermaid 的即时缓冲正文成功导出。
- `markdown-export-document.test.ts` 覆盖独立 HTML 外壳、标题转义、打印样式、无脚本、中文 Windows 文件名、设备保留名和 120 字符边界。
- `npm test -- --reporter=dot`：68 个测试文件、279 项全部通过，退出码为 0。
- `npx vue-tsc -b --pretty false`、`npm run check:public`、1 / 3 / 5 MB Markdown 基准文件校验与 `git diff --check` 通过。
- `npx vite build` 明确退出码为 0，共转换 4,575 个模块；只保留仓库既有大分块提示。

final result: passed

## 资料来源到 LaTeX 公式草稿（2026-08-10）

### Findings

- 资料库原有“识别公式”是假入口：图片和 PDF 都显示可识别，但点击只提示引擎未安装。现在改为真实的“整理公式草稿”，保留来源页码、选区和裁剪锚点，新建标准 Markdown，并直接进入分屏与 KaTeX 即时预览。
- 自动图片转 LaTeX 仍明确列在实验室的未接入能力中；界面不再把手动公式编辑冒充成识图，也不会自动上传资料图片。
- 创作空间新增独立“LaTeX 公式编辑”卡，左键直接开始，右键或 `Shift+F10` 提供新建草稿、浏览数学笔记和检查识图边界三个动作；侧栏和 Ctrl+K 同时支持 `LaTeX`、`KaTeX`、数学公式等搜索词。
- 设置页拆开能力状态：Windows 离线 OCR 指向正式工具，公式图片识别保留诚实边界并提供本地编辑替代流程。
- 路由创建保留 `mode=split` 和一次性 `insert=formula` 请求；对话框等待异步 CodeMirror 真正挂载后才打开，并先把光标移动到 Markdown 末尾，避免公式被插到一级标题之前。
- 移除未参与真实能力判断的 `engineInstalled / setEngine / requiresEngine` 原型状态，防止页面继续根据假布尔值展示能力。
- `ui-ux-pro-max` 的功能可发现性、明确边界、右键与键盘可达、固定浮层层级和异步加载反馈被采用；企业营销导航、在线手写字体、蓝色 CTA 与夸张留白不适合 Knitspace 暖纸桌面工作台，未采用。

### Verification

- 1280 px 桌面预览显示 7 张创作工作流卡，工作区和页面均无横向溢出；公式卡右键菜单完整显示 3 项动作。
- 从创作空间进入后，URL 落到新建笔记的 `mode=split`，公式对话框自动打开；插入后正文顺序为一级标题、空行、公式块，没有覆盖原文。
- 设置页实际显示“Windows 离线 OCR”和“公式图片识别”两个独立控制，不再出现旧的“OCR 与公式识别”合并标签。

- `pnpm test`：67 个测试文件、277 项全部通过；新增路由保留、一次性插入和来源锚点 5 项测试。
- `pnpm run build` 与 `pnpm run check:public` 通过；`CreateView` 14.29 kB / gzip 5.67 kB，公式草稿纯函数没有把 KaTeX、CodeMirror 或资料正文提前打入首页；仅保留既有 Mermaid / Cynefin 大分块提示。
- `git diff --check` 通过，仅有工作区既有 CRLF 提示。

final result: passed

## Windows 本机离线 OCR 工作流（2026-08-10）

### Evidence

- 1280 × 720 完整桌面工作流：`<QA_ARTIFACTS>\knitspace-offline-ocr.png`
- 原始图片区右键菜单：`<QA_ARTIFACTS>\knitspace-offline-ocr-context-menu.png`
- 状态：实际 WinRT 解码与 OCR 烟测使用本机语言包完成；视觉样本只在 `127.0.0.1:1420` 且 `qa=preview` 时生成，不进入正式构建状态、Vault 或用户数据。

### Findings

- “离线 OCR 识别”已从实验占位升级为正式工具，并同时出现在工具空间侧栏、Ctrl+K 功能地图、工具目录与本机能力页；搜索 `OCR` 首项直达工具，不再先落到实验说明。
- 原生层使用 Windows `Windows.Media.Ocr`、系统已安装语言包和 `SoftwareBitmap`；图片不经过网络，也不要求 Knitspace 分发额外模型。
- 支持选择、桌面拖入和读取剪贴板图片；结果先进入可编辑确认区，可复制、保存为独立 Markdown 笔记或转成待整理题目，不会静默覆盖现有内容或自动归档原图。
- 输入在读取到 WebView 前先做轻量元数据探测，超过 50 MB 直接拒绝；超过 OCR 最大边长的图片在原生内存中等比缩小，原文件保持不变。Vue 只保留当前一张预览和文本结果，切换图片时立即释放旧 Object URL。
- 图片区和结果区均支持右键与 `Shift+F10`；菜单包含识别、换图、剪贴板、资源管理器、复制、存笔记、转题目与清理操作，方向键会跳过禁用项。
- 页面沿用暖纸张、深绿、本机 UI / 等宽字体和不透明浮层；错误使用 `role=alert`，长任务有明确忙碌状态，焦点轮廓和文字对比清晰。
- `ui-ux-pro-max` 的键盘可达、错误可朗读、稳定 z-index、长任务反馈、按需加载和大文件前置限制被采用；作品集网格、在线手写字体与蓝色 CTA 不符合 Knitspace 桌面学习工作流，未采用。

### Verification

- 实际 WinRT 烟测：本机生成 480 × 160 PNG，经内存流解码、`SoftwareBitmap` 转换和系统 OCR 完整执行成功，耗时约 0.23 秒且没有网络依赖。
- 桌面视觉 DOM：工具侧栏直接展示“离线 OCR 识别”；页面展示 2 个语言包、可编辑 125 字结果，以及复制、转成题目和存为笔记三条闭环动作。
- 鼠标右键菜单含 5 项图片操作；键盘在结果框按 `Shift+F10` 可打开 4 项结果操作菜单。
- Rust 定向测试 3 项通过，交互式 WinRT 烟测 1 项通过；覆盖小图原尺寸、超大图等比缩小、零尺寸拒绝和真实系统识别链路。

final result: passed

## Windows 前台窗口滚动采集闭环（2026-08-10）

### Evidence

- 1280 × 720 采集会话页面：`<QA_ARTIFACTS>\knitspace-window-capture-session.png`
- 采集中的预览右键菜单：`<QA_ARTIFACTS>\knitspace-window-capture-menu.png`
- 独立原生调试壳：`<QA_ARTIFACTS>\tauri-target-capture\debug\toolknit.exe`；与已运行的主开发版隔离构建，没有覆盖或停止原进程。

### Findings

- Windows 桌面版的滚动长图页面可按需注册 `Ctrl+Alt+P`。只有用户明确开始采集后快捷键才生效；结束会话、切换图片工具、离开页面或关闭窗口都会注销本次注册。
- 每次按键只采集当前前台窗口。Rust 使用 `GetForegroundWindow`、`GetWindowRect`、兼容 DC/位图、`BitBlt` 与 `GetDIBits` 获取顶向下 BGRA 像素，转为 RGBA 后编码 PNG；成功和失败路径都会恢复并释放 GDI 对象、DC 与窗口 DC。
- 单张窗口限制为 16,384 × 16,384 且不超过 64,000,000 像素；页面总队列仍限制为 24 张。临时 PNG 只写入应用缓存的 `scroll-captures`，最多保留 48 个符合命名规则的文件，不删除同目录中的其他文件。
- 采集过程中暂停拼接 Worker。快捷键每次只新增一张 `File` 并更新轻量计数，结束会话后才触发一次完整重叠识别，避免 24 次连续采集造成 24 次全量解码和重建。
- 属性栏显示会话状态、快捷键、当前来源窗口、当前队列和恢复操作；空画布与图片预览均可通过鼠标右键或菜单键开始/结束采集。可选择隐藏 Knitspace，并通过托盘重新显示。
- `ui-ux-pro-max` 的分步进度、错误就地恢复、可见焦点、键盘可达、Vue `shallowRef` 与副作用清理建议被采用；深色高饱和营销方案与在线字体不符合现有暖纸/深绿本地工作台，未采用。

### Verification

- `cargo check` 通过；确定性 Rust 测试覆盖 BGRA→RGBA 与只清理捕获文件的 48 项缓存策略。
- Windows 可见窗口烟测通过：创建短生命周期窗口后调用生产截图函数，取得非空窗口标题、有效宽高和严格等于 `width × height × 4` 的 RGBA 缓冲；Windows 拒绝抢焦点时仍正确采集实际前台的独立 Knitspace 调试壳。
- 图片拼接定向测试 4 项通过；`pnpm run build`、`pnpm run check:public` 与 `git diff --check` 通过。生产构建新增的全局快捷键绑定为独立小分块，滚动拼接 Worker 仍为 3.93 KB。

final result: passed

## 复习空间材料入口与菜单隔离（2026-08-10）

### Evidence

- 复习卡片与材料入口原生审计：`<QA_ARTIFACTS>\knitspace-review-materials-audit-native.png`
- 当前复习卡右键菜单：`<QA_ARTIFACTS>\knitspace-review-card-menu-native.png`
- 复习菜单与全局命令面板隔离：`<QA_ARTIFACTS>\knitspace-review-menu-isolation-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；只展开菜单检查，没有评分、延期、撤销或修改复习数据。

### Findings

- 复习引擎已经支持题目与单词多侧面卡片、FSRS 调度、四档评分及预计间隔、撤销评分、稍后再看和返回来源；本轮最明显的功能暴露缺口是页面没有持久的材料管理入口，完成队列后也容易形成操作死角。
- 主复习卡下方现在提供“管理复习材料”，直接进入题目与错题、结构化单词，并可一键记录新错题；入口同步显示材料数量和当前到期卡数量，让用户不必返回今天页寻找功能。
- 材料区保持在主卡片之后，不与当前题面、答案和评分按钮争夺注意力；桌面端使用双列，窄窗口自动切为单列，暖白表面、深绿文字和可见焦点沿用 Knitspace 的本地纸张视觉体系。
- 当前卡右键菜单继续提供返回来源、打开原始材料、复制 Markdown、撤销上一评分、稍后再看和继续复习；禁用项已从方向键、Home 和 End 的焦点循环中排除。
- 打开 `Ctrl K` 时通过全局关闭事件清理复习右键菜单，但不把焦点从命令输入框抢回卡片；原生截图确认两层菜单不会叠加。
- 队列和材料摘要只读取 Pinia 中已有的有界元数据并计算数量；题目正文仍只在当前卡需要时读取，单词路径不加载 Markdown，新增入口没有引入文件扫描、全文预取或更大的首屏 DOM。
- `ui-ux-pro-max` 的清晰进度、键盘可达、明确禁用态、按需加载、可见焦点和稳定动效建议被采用；检索出的儿童化黏土风、靛青主色和在线手写字体不符合 Knitspace 本地学习工作台，未采用。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过；FSRS、题目复习、单词复习和桌面菜单定向测试 4 个文件、15 项通过。
- `cargo test --manifest-path src-tauri\Cargo.toml`：42 项全部通过；`cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 创作空间真实继续入口（2026-08-10）

### Evidence

- 改造前创作空间原生审计：`<QA_ARTIFACTS>\knitspace-create-audit-native.png`
- 真实最近打开与动态继续按钮：`<QA_ARTIFACTS>\knitspace-create-real-recents-native.png`
- 最近创作原生右键菜单：`<QA_ARTIFACTS>\knitspace-create-recent-menu-native.png`
- 右键菜单与全局命令面板隔离：`<QA_ARTIFACTS>\knitspace-create-menu-isolation-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；只展开菜单检查，没有修改收藏或内容数据。

### Findings

- 改造前“最近创作”按笔记更新时间排列，无法表达用户真正打开过什么；现在笔记部分消费全局 `contentRecents`，并明确标注“最近打开”，视觉项目则保留真实的“最近修改”语义。
- 顶部“继续最近笔记”不再只是进入笔记列表，而是动态显示最近打开的标题，并直接进入该笔记的源码编辑模式；没有打开记录时安全回退到全部笔记。
- 最近创作支持鼠标右键与 `Shift+F10`。笔记菜单提供继续打开、源码编辑、阅读预览、思维图谱、收藏切换与复制双链；视觉项目提供继续打开与复制画布名称。
- 菜单复用全局收藏与路由能力，没有建立平行数据源；打开 `Ctrl K` 时创作空间的工作流菜单和最近创作菜单会统一关闭，避免上下文菜单穿透全局模态层。
- 最近笔记查找使用缓存的 ID 映射，合并结果限制为 4 项，视觉项目查询限制为 12 项；该入口只读取轻量元数据，不加载 Markdown 正文、附件或图片预览。
- `ui-ux-pro-max` 与 `frontend-page-design-playbook` 的真实数据语义、首屏主行动、键盘可达、边缘夹取、渐进披露和性能边界建议被采用；企业营销式蓝橙配色、在线趣味字体与卡片堆叠建议未采用，继续保持暖纸、深绿和本地中文字体体系。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过。
- `cargo test`：42 项全部通过；`cargo fmt --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## Typora 式编辑右键与全局最近使用（2026-08-10）

### Evidence

- Markdown 编辑器主右键菜单：`<QA_ARTIFACTS>\knitspace-typora-context-menu-native.png`
- 靠近右边缘时向左展开的复制/粘贴子菜单：`<QA_ARTIFACTS>\knitspace-typora-clipboard-submenu-native.png`
- 最近打开的真实内容与清空入口：`<QA_ARTIFACTS>\knitspace-content-recents-populated-native.png`
- 最近内容右键移除菜单：`<QA_ARTIFACTS>\knitspace-content-recent-menu-native.png`
- 全局命令面板层级修复后：`<QA_ARTIFACTS>\knitspace-content-recents-command-native.png`
- 状态：重新编译并启动的 Knitspace Tauri 开发版，1256 × 829；打开“思维图谱 2”产生一条真实最近记录，没有修改文档正文。

### Findings

- Markdown 编辑区右键菜单采用与 Typora 一致的工作流分组：剪切/复制/粘贴/删除快捷按钮，粗体、斜体、行内代码、链接、引用、列表和任务格式，以及复制粘贴、代码块、插入子菜单。
- Typora 的“少用插件/常用插件”被替换为含义明确的“常用工具、学习工具、文档操作”，直接暴露代码分享图、AI 草稿、片段、关联笔记、题目、查找、分屏和专注阅读；不会让真实功能藏在含糊的插件分类里。
- 复制/粘贴子菜单包含复制为 Markdown、HTML 代码、简化格式、粘贴纯文本和本地剪贴板图片。无选区的动作保持禁用；键盘方向键、右箭头、Escape 与 Shift+F10 可完整操作。
- 子菜单依据可用视口向左或向右展开；主菜单和子菜单使用暖白表面、深色正文、绿色焦点态和非透明边框，文字与背景关系在桌面截图中清晰。
- 全局“最近打开”使用 SQLite v11 的独立轻量指针，覆盖笔记、题目、单词和资料；只在实际选择变化时记录，保存当前文档不会伪造一次打开。连续快速打开以时间和新写入顺序稳定排序。
- 知识空间侧栏、筛选栏和 Ctrl K 都能发现最近内容；右键可单项移除，筛选态可整体清空。移除只删除导航历史，不删除原内容。
- 首轮桌面检查发现命令面板打开后编辑器右键菜单仍位于模态层上方；已提高全局模态层级并在打开命令面板前广播菜单关闭事件，复测截图不再出现叠层。
- 性能方面，最近记录最多 128 项，前端使用缓存键集合与元数据解析；不读取 Markdown 正文、资料预览或附件，也不新增轮询。`ui-ux-pro-max` 的深链、明确分组、可见焦点、可行动空状态和非颜色单一状态建议被采用。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过；新增最近指针去重、顺序、128 项边界、悬空项、备份 v7 与导航深链测试。
- `cargo test`：42 项全部通过；覆盖 v11 迁移、一次性浏览器迁移、真实打开、稳定排序、事务恢复、非法类型、删除联动、清空和重启持久化。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false`、`cargo fmt --check` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示。
- 真实 Tauri 开发版完成右键主菜单、键盘展开子菜单、最近筛选、单项移除和命令面板层级复测。

final result: passed

## 结构化题目附件（2026-08-10）

### Evidence

- 真实 Tauri 开发窗口中的题目编辑页：`<QA_ARTIFACTS>\knitspace-question-attachment-edit-native.png`
- 展开“题目与复习”检查器后的题目附件空状态：`<QA_ARTIFACTS>\knitspace-question-attachment-inspector-native.png`
- 状态：重新编译并启动的 Knitspace 开发版，1256 × 829；从“今天”展开“知识库”，进入“题目与错题”后完成检查，没有向现场题目临时写入 QA 附件。

### Findings

- 题目附件已经从 Markdown 正文中独立出来。题干、答案、解析和错因继续保持结构化字段；图片、PDF、音频、代码或其他文件以附件元数据关联到同一题目，实际字节只复制到当前 Vault 的 `assets/questions`。
- 添加入口位于题目编辑页右侧“题目与复习”的首屏区域，不依赖“今天”。空状态明确说明文件不会进入编辑页面；已有附件可单击在资源管理器定位，也可右键或按 Shift+F10 复制名称、定位或从题目移除。
- 单题最多 64 个附件、单文件最多 250 MB。页面默认只显示前 6 个，其余渐进展开；多选导入按顺序流式执行，避免多个大文件同时复制与散列造成磁盘和内存尖峰。
- Rust 端使用 64 KiB 缓冲流式计算 SHA-256，以题目 ID 隔离、按哈希去重，并通过临时落盘后原子改名完成写入。SQLite 只保存相对路径和摘要；渲染器仅在用户明确要求定位文件时解析真实路径。
- 删除题目会清理它管理的附件目录，单独移除附件不会影响原始文件。Vault 中缺失的附件会显示“缺失”文字、图标和暖红边界，仍可通过右键移除失效记录，不只依赖颜色。
- `ui-ux-pro-max` 的可行动空状态、渐进披露、键盘菜单、有限列表与明确本地状态被采用；营销首屏、鲜艳蓝紫色、在线字体和无限附件瀑布流建议被拒绝，继续使用暖纸、深绿与离线中文字体链。
- `computer-use` skill 因本机插件内核路径缺失无法初始化；真实桌面验收改用 WebView2 渲染子窗口的原生消息与 `PrintWindow`，没有把浏览器渲染冒充桌面结果。

### Verification

- `npm test -- --run`：59 个测试文件、245 项全部通过；新增 3 项附件图标、大小格式化、去重和 64 项边界测试。
- `cargo test`：40 项全部通过；新增端到端 Vault 测试覆盖流式导入、同题去重、跨题隔离、单附件删除和删除题目后的目录清理。
- `npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过；生产构建仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## Typora 参考菜单快捷键与原生复验（2026-08-10）

### Evidence

- 参考层级在真实桌面窗口中的根菜单：`<QA_TEMP>\knitspace-typora-reference-menu-native.png`
- 键盘进入复制 / 粘贴子菜单后的最终状态：`<QA_TEMP>\knitspace-typora-copy-submenu-keyboard-final.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829。

### Findings

- 用户补充的 Typora 参考图确认了“快捷图标矩阵 + 复制粘贴子菜单 + 格式图标矩阵 + 功能分组”的主层级；Knitspace 的根菜单在当前窗口高度内完整显示，没有把代码块、插入或扩展工具藏到视口之外。
- `Ctrl+Shift+C` 现在会复制 CodeMirror 中的 Markdown 源码选区；`Ctrl+Shift+V` 会读取系统剪贴板并以纯文本插入。普通复制与粘贴快捷键不被接管。
- 复制 / 粘贴子菜单显示的快捷键与实际行为一致。菜单靠近窗口右侧时会向左展开；禁用操作、焦点框和“本地”能力标记均清晰可辨。
- 保留“常用工具 / 学习工具 / 文档操作”而不照搬 Typora 的“常用插件 / 少用插件”命名，因为这里承载的是 Knitspace 的真实工作流，不是假插件入口。
- 本轮只增加轻量键盘意图判断，没有新增监听循环、响应式大对象或同步序列化；编辑器仍按文档模式异步加载。
- `ui-ux-pro-max` 的可见焦点、动态 ARIA、层级和固定弹层建议被采用；深色高饱和营销配色与在线字体建议被拒绝，继续使用暖纸、深绿和本机中文字体链。

### Verification

- `npm test -- --run`：54 个测试文件、225 项全部通过；新增快捷键测试覆盖 Markdown 复制、纯文本粘贴、普通粘贴不接管和 Alt 组合键不接管。
- `cargo test`：37 项全部通过；`npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过。
- 文档路由仍保持异步拆分；`DocumentsView` 为 98.32 kB / gzip 31.09 kB，`LargeTextEditor` 为 311.30 kB / gzip 101.39 kB。仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 本机能力的工具空间归属与入口闭环（2026-08-10）

### Evidence

- `/lab` 由工具空间接管后的桌面首屏：`<QA_TEMP>\knitspace-lab-tools-owned-native.png`
- 工具父级右键菜单及完整子入口：`<QA_TEMP>\knitspace-tools-parent-menu-native.png`
- 工具总览中的本机能力入口：`<QA_TEMP>\knitspace-tool-space-capability-entry-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829。

### Findings

- 修复前 `/lab` 只是一条 Ctrl+K 全局命令，不属于任何一级空间；因此进入页面后仍展开“今天”，顶部归属回退为“工作台”。现在它是“工具”的正式子路由，侧栏父级与“本机能力与实验”子项会同时显示当前位置。
- 页面标题统一为“本机能力与实验”；面包屑由现有路由归属机制自动显示“五个空间 · 工具”，不再为单页写特殊判断。
- 工具父级右键菜单现在包含本机能力入口；工具空间总览右侧增加独立能力卡，说明 Vault、FFmpeg、输出目录与实验边界，并保留私人工具包为相邻而不同的入口。
- `/lab` 从全局附加命令移入共享导航目录，Ctrl+K 仍能用 OCR、公式、FFmpeg、Vault、诊断等词搜索到它，但只生成一条命令。
- 新增路由所有者映射与回归测试：除全局设置外，每个用户功能路由必须至少归属一个五空间父级；知识与复习等共享工作流允许有多个所有者，孤儿页面会直接令测试失败。
- 页面继续使用路由懒加载，没有新增轮询、观察器或大型依赖；能力检查仍只在进入页面或主动刷新时运行。
- `ui-ux-pro-max` 的父级激活、键盘顺序、非纯色状态与懒加载建议被采用；社区落地页、深紫橙色、高饱和块状布局和在线字体建议被拒绝，继续使用暖纸、深绿与本机中文字体链。

### Verification

- `npm test`：54 个测试文件、223 项全部通过，其中导航测试新增“业务页必须有五空间归属”和 `/lab` 单命令断言。
- `cargo test`：37 项全部通过；`npx vue-tsc -b`、`npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过。
- 生产构建中 `ToolsSpaceView` 为 10.70 kB / gzip 4.57 kB；实验室异步脚本保持 12.43 kB / gzip 5.52 kB。仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 处理历史的多输出摘要与原生右键菜单（2026-08-10）

### Evidence

- 真实历史列表：`<QA_TEMP>\knitspace-history-native-current.png`
- 任务卡原生右键菜单：`<QA_TEMP>\knitspace-history-menu-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；现场 Vault 中的 3 条任务均为单输出任务，未为截图写入伪造记录。

### Findings

- 历史页已经是文件、图片、PDF、媒体和私人工具的共享结果中心，具备搜索、防抖、状态与类型筛选、重新执行、打开位置、另存、复制路径、删除确认和操作日志，不需要另造一个重复页面。
- 修复了多输出任务的真实可用性缺口：PDF 拆分等任务不再把所有文件名拼成一条无限增长的卡片文本；卡片只显示前三项并附“等 N 个文件”，结构化输出路径仍完整保留。
- 多输出任务的主按钮和右键菜单明确显示“另存首个输出…”，避免用户误以为一次会导出全部文件；“复制全部 N 个输出路径”会按行复制所有输出，不再悄悄只复制第一项。
- 单输出任务保留简洁的“另存为…”与“复制输出路径”文案。复制和删除按钮改用统一图标组件，并继续提供 `title` 与 `aria-label`，不依赖图形猜测含义。
- 原生窗口中右击任务卡可见“重新执行 / 打开输出位置 / 另存为 / 复制输出路径 / 删除历史记录”；删除项同时使用分隔、文字和危险色表达风险。
- 长列表仍采用固定行虚拟窗口、`requestAnimationFrame` 滚动节流、140ms 搜索防抖与 `v-memo`；本轮没有为多输出摘要创建额外 DOM 列表，也没有引入持续监听或大型依赖。
- `ui-ux-pro-max` 的键盘可达、状态文字、危险确认与长列表建议被采用；企业后台式网关、鲜艳营销配色、Playfair/Karla 在线字体建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- 新增 24 个 PDF 输出的单元测试，验证摘要严格为前三个文件名加总数，同时 24 条结构化路径全部保留且顺序不变。
- `pnpm test -- --run`：52 个测试文件、216 项全部通过。
- `cargo test`：37 项全部通过。
- `pnpm build`、`pnpm check:public`、`cargo fmt --check` 与相关文件的 `git diff --check` 全部通过；历史页异步产物为 11.89 kB / gzip 5.10 kB，仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## Typora 式编辑器右键与选区工具入口（2026-08-10）

### Evidence

- 无选区主菜单：`<QA_TEMP>\knitspace-typora-context-native.png`
- 选区主菜单：`<QA_TEMP>\knitspace-typora-selection-menu-native.png`
- 常用工具二级菜单：`<QA_TEMP>\knitspace-typora-selection-tools-native.png`
- 选区交接至代码分享工作室：`<QA_TEMP>\knitspace-typora-selection-to-code-image-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；通过 WebView2 渲染子窗口发送原生鼠标消息并用 `PrintWindow` 捕获。

### Findings

- 右键结构对齐 Typora 的高频顺序：剪切/复制/粘贴/删除快捷栏、复制与粘贴二级菜单、两行格式按钮、代码块、插入，以及扩展能力分组。
- 不照搬 Typora 的“少用插件/常用插件”命名；Knitspace 使用“常用工具/学习工具”，只露出与当前 Markdown 选区直接相关的能力。
- 常用工具可把选区交给代码分享图、AI 改写或固定为本地常用片段；学习工具可从选区创建独立笔记、结构化题目或 AI 要点草稿。
- AI 与跨页面工具只接收用户明确选中的文字，不默认读取整篇长文；无选区时入口保持禁用，减少误发送和大文档复制开销。
- 主菜单按新增高度重新进行视口钳制；二级菜单在右侧空间不足时自动向左展开。真实窗口已验证无选区禁用态、选区启用态、点击展开和代码选区传递。
- 菜单沿用暖纸面、深绿焦点和离线中文字体。没有采用 `ui-ux-pro-max` 搜索结果中的鲜艳青色、营销卡片或在线字体建议。

### Verification

- `pnpm test -- --run`：52 个测试文件、215 项全部通过；新增选区标题清洗与长度边界测试。
- `cargo test`：37 项全部通过。
- `pnpm build` 与 `pnpm check:public` 通过；仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 知识空间全文索引与结果右键菜单（2026-08-10）

### Evidence

- 知识空间真实桌面首屏：`<QA_TEMP>\knitspace-knowledge-index-native.png`
- 无匹配关键词的索引空状态：`<QA_TEMP>\knitspace-knowledge-fts-mermaid-native.png`
- 知识条目右键菜单：`<QA_TEMP>\knitspace-knowledge-item-menu-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；现场 Vault 的 5 个 Markdown 文件均为空，没有为截图写入伪造正文或测试笔记。

### Findings

- 旧知识空间搜索只在已经水合到渲染器的标题与元数据中做 `includes`，因此 SQLite FTS5 已经索引的 Markdown 正文、题干、答案、解析、错因、单词词义和例句在该页面不可见；现在搜索框直接复用 Vault 索引通道。
- 输入使用 140ms 防抖和请求版本门控。新关键词会使旧的未完成请求失效，组件卸载时也会清理计时器；桌面成功路径不会在 Vue 主线程扫描 Markdown 正文。
- FTS 返回数量在原生层固定有界，知识空间与本地资料名称/标签结果合并后最多展示 20 项；无查询时仍只展示最近 8 项，条目继续使用 `v-memo`。
- FTS `snippet()` 的方括号命中标记被解析为有界的纯文本片段，再由 Vue 生成 `<mark>`；没有使用 `v-html`，异常或未闭合括号也只作为文本显示。
- 搜索时明确显示“正在检索本地知识索引”，索引失败时降级为有界的标题/元数据匹配并说明原因，不出现空白或把降级结果冒充全文检索。
- 真实条目右键可“打开内容 / 创建关联笔记 / 复制标题”，Shift+F10 与方向键使用同一菜单路径；视觉继续使用暖纸表面、深绿焦点和离线中文字体。
- `ui-ux-pro-max` 的空状态、键盘可达、颜色不作为唯一提示、路由懒加载与 `v-memo` 建议被采用；竞品比较落地页、蓝色营销 CTA 和 Caveat/Quicksand 在线字体建议被拒绝。

### Verification

- 只读查询现场 `index.sqlite3`，关键词“思维图谱”返回 2 条 FTS 命中；现场文档正文为空，因此没有用虚假数据制作正文命中截图。
- 新增安全片段测试，覆盖多处命中、未闭合标记、HTML 样式文本与长度上限；既有 Rust 测试继续覆盖 Markdown 正文、结构化题目、词义、词形与例句搜索。
- `pnpm test -- --run`：53 个测试文件、219 项全部通过；`cargo test`：37 项全部通过。
- `pnpm build`、`pnpm check:public`、`cargo fmt --check` 与相关文件 `git diff --check` 全部通过；知识空间异步脚本为 13.49 kB / gzip 5.47 kB，仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 全路由可发现性与设置直达命令（2026-08-10）

### Evidence

- Ctrl+K 搜索 `backup`：`<QA_TEMP>\knitspace-command-backup-direct-native-final.png`
- Enter 直达数据与备份：`<QA_TEMP>\knitspace-command-backup-opened-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829。

### Findings

- 20 个用户页面已逐项对照五空间导航和 Ctrl+K 命令。原有主功能均可发现，但设置的五个分类被压成一个泛化“设置”结果，实验室只能从设置页底部间接进入。
- Ctrl+K 现在提供“常规设置”“剪贴板隐私”“AI 服务与凭据”“数据与备份”“版本与更新”“实验室”六个直达命令；支持 `backup`、`restore`、`api key`、`credential`、`OCR` 等熟悉词汇。
- 零查询状态仍只显示五个空间、收藏和最近使用，不把低频设置塞入默认列表；只有主动搜索时才出现直达项，因此没有扩大首屏 DOM 或增加日常认知负担。
- 路由定义抽到浏览器无关的 `appRoutes` 单一来源，Router 和可发现性测试共同使用。以后新增真实路由但没有导航或命令入口时，测试会直接失败。
- 所有页面继续使用动态 `import()`；路由元数据拆分没有提前载入任何页面组件。生产构建中实验室仍为独立 1.33 kB 异步块，重型编辑器、PDF 和画布块保持按需加载。
- `ui-ux-pro-max` 的渐进暴露、无结果引导、键盘导航与焦点建议被采用；比较表、鲜艳块、手写在线字体与滚动叙事建议被拒绝，保持 Knitspace 暖纸和深绿桌面体系。

### Verification

- 真实命令面板输入 `backup` 只返回“数据与备份”，按 Enter 后直接定位到 Vault 健康、完整归档与 JSON 快照首屏。
- `pnpm test -- --run`：52 个测试文件、215 项全部通过；可发现性测试直接遍历 Router 使用的真实路由定义。
- `cargo test`：37 项全部通过。
- `pnpm build` 与 `pnpm check:public` 通过；仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 复习空间空卡恢复与工具空间原生审查（2026-08-10）

### Evidence

- 复习空间层级与可恢复空状态：`<QA_TEMP>\knitspace-review-empty-state.png`
- 复习卡右键菜单：`<QA_TEMP>\knitspace-review-context-menu.png`
- FFmpeg 媒体转换台：`<QA_TEMP>\knitspace-audit-media-space.png`
- 39 项工具总览：`<QA_TEMP>\knitspace-audit-tools-overview.png`
- 工具卡右键菜单：`<QA_TEMP>\knitspace-tools-context-menu.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；通过 WebView2 原生渲染子窗口发送鼠标、键盘与 Ctrl+K 操作，并用 `PrintWindow` 捕获硬件加速画面。

### Findings

- 旧复习页把标题和页面说明强制隐藏，只剩一张横向空白卡；现已恢复 FSRS 页面标题、用途说明、题/词构成、进度条和明确的卡片编号层级。
- 现场检查确认空白并非 Markdown 渲染故障：SQLite 中该测试题的 `content_text`、`question_text` 以及对应 Markdown 文件均为空。页面现在把它表现为可恢复的“题干尚未填写”，保留原 FSRS 计划并直达题库补全，不再允许复制空卡或翻出空答案。
- 正常题目仍按需异步加载完整 Markdown 阅读组件；空卡和纯单词复习不会下载该技术阅读栈，避免为无内容状态支付解析、公式、代码和 Mermaid 初始化成本。
- 复习卡右键菜单提供回到题库、复制题目、稍后再看和继续复习；空题干时复制项会禁用。键盘的 Space / Enter、D、1–4、Ctrl/⌘ Z 与 Shift+F10 路径保持一致。
- 全局命令以 `ffmpeg` 直接进入媒体转换台；工具侧栏明确展示总览、文件处理、音视频、开发者、剪贴板、历史和私人工具，不依赖“今天”页才能发现。
- 工具总览实际展示 39 项能力、四个分类、收藏与最近运行；工具卡右键可以打开、收藏/取消收藏和复制名称。媒体页明确显示 FFmpeg 本机就绪、输入、输出格式和目标位置。
- `ui-ux-pro-max` 的本轮建议用于进度可见性、空状态下一步、焦点文本和懒加载路径；拒绝了与本地个人工作台不符的评分市场页、鲜艳营销色、在线字体与大幅动效建议，继续使用暖纸、深绿和本地中文字体系统。

### Verification

- `pnpm test -- --run`：51 个测试文件、213 项全部通过；新增未填写卡与仅有 front matter 的空题干判定。
- `cargo test`：36 项全部通过。
- `pnpm build`、`pnpm check:public`、`cargo fmt --check` 与 `git diff --check` 均通过；生产构建仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 全局空间命令与代码长图桌面回归（2026-08-10）

### Evidence

- 五空间空查询：`<QA_TEMP>\knitspace-command-five-spaces-real-2.png`
- `codesnap` 精准搜索：`<QA_TEMP>\knitspace-command-codesnap-precise.png`
- 从命令结果进入代码工作室：`<QA_TEMP>\knitspace-codesnap-via-command.png`
- 代码预览右键菜单：`<QA_TEMP>\knitspace-codesnap-right-menu.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829，进程 `toolknit.exe`。

### Findings

- `Ctrl+K` 空查询首组直接展示“今天、知识库、创作、复习、工具”，不再只能搜索工具；五空间及子入口与侧栏复用同一元数据目录，新增页面不会形成另一套隐藏入口。
- 查询同时理解日常叫法与替代软件名，例如“番茄、Typora、Obsidian、XMind、Visio、Codesnap、Anki、FFmpeg、私人脚本”；具体动作使用独立别名，空间只作兜底，避免一个父空间的所有子入口同时误命中。
- 真实输入 `codesnap` 只返回“代码分享工作室”和“创作”两项，代码工作室排第一；Enter 已在原生 WebView 中完成路由跳转。
- 当前恢复草稿为 14,495 行，布局 Worker 将其拆成 382 张；页面仍能滚动、切页与打开右键菜单。右键提供复制当前图、加入多选、全文连续长图和导出当前 PNG，不把常用动作重新藏回顶部工具栏。
- 命令目录只包含约三十条静态轻量元数据；文档和画布仍按原策略异步查询，图片字节、Markdown 正文和高亮结果不会进入命令面板响应式状态。

### Verification

- `pnpm test -- --run`：51 个测试文件、212 项测试全部通过；新增五空间默认结果、常用别名、精确排序和重复入口测试。
- `pnpm build`、`pnpm check:public`、`cargo test --lib`（36 项）、`cargo fmt --check` 与差异格式检查通过；构建仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed in native desktop window

## 可继续编辑的画布项目（2026-08-10）

### Findings

- 图片工作台不再只导出一张扁平 PNG：拼图布局、画面标题、背景、署名、源图和 Konva 标注可保存为画布项目，并从同一页面的“最近项目”重新打开继续编辑。
- 项目复用既有 `entities(type = diagram)` 与 `attachments` 内核；SQLite 只保存轻量元数据，源图复制到 `assets/diagrams/<项目 ID>/`，删除项目时同步清理对应资产目录。
- 工具栏直接暴露新建、项目名称、保存状态、保存和最近项目，不增加一级页面。画布空白处右键或 `Shift+F10` 提供保存、复制、导出、清空标注和新建；具体标注仍使用编辑文字、复制、置顶和删除菜单。
- 未保存状态不读取或散列图片字节，只比较表单、文件元数据与不可变标注快照。保存源图使用 Tauri 原始二进制 IPC 串行传输，避免将最多 96 MB 图片展开为巨型 JSON 数字数组；列表只返回标题、数量和更新时间，打开具体项目时才加载图片。
- 数据边界为每项目 1–4 张源图、单张 32 MB、总计 96 MB、最多 500 个标注；Rust 同时验证项目 ID、资源归属、图片魔数、SHA-256、文件大小、颜色和元数据体积。
- 项目面板延续暖纸面、深绿焦点和本地中文字体链；在深墨色创作工具栏中作为独立的浅色项目选择器，保存状态同时使用文字与圆点，不依赖颜色单独传意，并支持 `prefers-reduced-motion`。

### Verification

- `pnpm test -- --run`：51 个测试文件、207 项测试全部通过；新增画布项目状态与损坏标注归一化测试。
- `cargo test --lib`：36 项全部通过；新增测试断言 `diagram` 实体、附件数量、源图资产存在、更新后旧资产清理以及删除项目后的目录清理。
- `pnpm build`：类型检查与生产构建通过。`VisualStudioView` 54.73 kB / gzip 18.98 kB；Konva 画布继续作为独立异步块 196.17 kB / gzip 60.36 kB，不进入普通页面首屏。
- `pnpm check:public`、`cargo fmt --check` 与本次文件的差异格式检查通过。
- 最新 `src-tauri/target/debug/toolknit.exe` 已重新构建并启动，窗口标题 Knitspace、进程响应正常，开发服务器 `127.0.0.1:1420` 正在监听。内置浏览器与 Windows 控制插件共用的 JavaScript 运行内核在初始化时报告本机路径缺失，因此本次没有伪造“已点击真实窗口”的证据；真实窗口中的项目面板和右键点验仍保留为人工检查项。

final result: implementation, persistence and build passed; native visual point check pending

### 画布项目发现与深链接补充

- `Ctrl+K` 在弹层打开时才查询最多 60 条 SQLite 画布摘要；输入项目名或“画布 / 图片 / 标注”即可命中，列表只显示标题、源图数、标注数和更新时间，不读取图片字节。
- “创作”空间的最近工作现按更新时间混排 Markdown 笔记与画布项目；点击画布会进入 `/visual?project=<项目 ID>`，图片工作台保存、切换处理模式和再次打开时都会保留该可复制入口。
- 搜索和最近列表提供明确的加载、空结果与 `aria-busy` 状态；键盘继续沿用 `Ctrl+K`、方向键、Enter 与 Esc，不新增启动阶段查询。
- `pnpm test -- --run`：51 个测试文件、209 项测试通过；新增摘要排序、中文标题/通用别名搜索和深链接测试。`pnpm build`、`pnpm check:public`、`cargo test --lib`、`cargo fmt --check` 与差异格式检查均通过。

## 题目答案与错因独立复习（2026-08-10）

### Findings

- 一道题仍只保存一个结构化实体和一份 Markdown；原有 `review` 精确兼容为“答案回忆”，新增 `reviewFacets.error` 表示“错因复盘”，两者各自拥有 due 与完整 FSRS 状态。
- 题目检查器把两种方向直接放在题干、答案、错误做法和错误原因之后，不增加新页面。答案/解析为空时不会误建答案卡，错误做法/错误原因为空时不会误建错因卡，并给出就地提示。
- 1256px 桌面渲染层回归中，右侧检查器打开后状态胶囊稳定显示“2 张复习卡”；元数据行允许自然换行，胶囊本身保持单行，没有横向溢出或被挤成竖排。
- 复习队列按原子卡片计数。同一道题的答案卡显示题干与解法，错因卡显示当时的错误做法、错误原因和应该记住的原则；评分、间隔预估、撤销、暂缓、复制与右键菜单均按方向独立工作。
- SQLite 继续复用既有 `review_cards(entity_id, facet)`：`default` 保存答案卡，`error` 保存错因卡，不需要新表或第二份题目文件。旧 Vault 无需迁移即可保持原计划。
- 新增能力只包含轻量纯函数与内联检查器控件；Markdown 渲染仍按需加载。生产构建中 `DocumentsView` 为 92.07 kB / gzip 29.54 kB，未引入新的重型首屏依赖。

### Verification

- `pnpm test -- --run`：50 个测试文件、205 项测试全部通过；覆盖题目方向模型、旧数据修复、学习进度原子卡计数和不同正反面内容。
- `cargo test --lib`：35 项全部通过；原生回归确认 `default` / `error` 两张卡独立保存，移除错因方向后只删除对应卡片。
- Vue 类型检查、Vite 生产构建、Rust 格式检查与 `pnpm check:public` 均通过；构建仅保留既有 Mermaid / Cynefin 大块提示。
- 同一 Tauri 渲染层实际验证队列由 4 张增至 5 张，成功定位“算法 · 错因复盘 · 难度 3”，翻面后显示独立错误原因与四档 FSRS 间隔；右键菜单可见且控制台无错误。
- 新开发二进制已构建并启动：`src-tauri/target/debug/toolknit.exe`，窗口标题 Knitspace，进程响应正常。

final result: passed

## 外部 Markdown 工作区与文件树（2026-08-10）

### Findings

- 笔记侧栏新增明确的“Knitspace 资料库 / 外部工作区”来源切换，不再把资料夹能力隐藏在单文件打开按钮里；单文件打开仍保留为独立入口。
- 外部工作区只在展开资料夹时请求当前一层的目录元数据，点击 Markdown 后才读取正文；已有外部关联会回到同一条 Vault 笔记，不重复创建副本。
- 原生协议会拒绝绝对子路径、`..` 越界、隐藏资料夹和符号链接，只返回 `.md`、`.mdx`、`.markdown`、`.mkd` 与真实资料夹。
- 单层最多检查 5,000 个目录项、返回 500 个可用项；前端最多投影 10,000 个已展开节点，并通过固定行高虚拟窗口只挂载可见行。
- 文件树支持鼠标展开、Enter / Space、上下方向键、Home / End、左右方向键、Shift+F10 与菜单键；`aria-expanded`、`aria-selected` 和层级随状态同步。
- 文件或资料夹右键提供打开/展开、新建 Markdown、新建子资料夹、重命名、资源管理器定位、刷新层级与复制文件路径；菜单会按窗口边界避让，错误状态可原地重试。
- 根目录顶部直接暴露新建 Markdown 与新建资料夹，轻量命名对话框使用暖纸表面、深绿焦点和离线字体；错误就地显示，Escape / 点击空白关闭，Tab 焦点在对话框内循环，且未使用全屏 `backdrop-filter`。
- 新建 Markdown 未写扩展名时自动补 `.md`；原生层拒绝路径字符、隐藏名称、Windows 保留名、错误扩展名和同名覆盖。重命名资料夹会同步映射已关联的子 Markdown，名称相似的兄弟资料夹不会被误更新，当前未保存草稿也不会被旧正文覆盖。
- 工作区仅记住用户选择的根路径，不复制、索引或递归导入外部 Markdown；打开后的正文继续沿用哈希冲突检测、原生文件监听和相对图片按需读取。

### Verification

- `pnpm exec vue-tsc -b --pretty false`：通过。
- `pnpm test -- --run`：49 个测试文件、200 项测试全部通过；新增 4 项 Windows 路径映射边界测试。
- `cargo test --lib`：34 项全部通过；其中 10 项覆盖外部 Markdown、目录过滤、越界拒绝、稠密目录上限以及安全新建/重命名。
- `pnpm build` 与 `pnpm check:public`：通过；仅保留既有 Mermaid / Cynefin 大块提示。
- 开发二进制已重新构建并启动：`src-tauri/target/debug/toolknit.exe`，窗口标题 Knitspace，开发服务器 `127.0.0.1:1420` 正在监听。
- 桌面控制已识别新构建的无系统装饰 Tauri 窗口，但激活阶段仍被控制插件中断；同一开发服务器的 Tauri 渲染层已完成文档编辑页、Typora 式右键主菜单与“复制 / 粘贴…”二级菜单的可见回归，控制台无错误。外部目录选择依赖原生文件选择器，因此文件树的新建/重命名视觉仍保留为当前已打开开发窗口中的人工点验项，不以浏览器结果冒充原生选择器证据。

final result: implementation and shared renderer verified; native picker point check pending

## Markdown 文档级查找与替换（2026-08-10）

### Evidence

- 中文查找面板：`<QA_TEMP>\knitspace-editor-find-first.png`
- 查找面板与 Typora 式编辑右键并存：`<QA_TEMP>\knitspace-find-context-menu.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829，Markdown 源码编辑模式。

### Findings

- “查找”位于格式工具栏首屏；Ctrl+F 在源码/分屏中由 CodeMirror 处理，在预览模式会切到源码并聚焦查找，不再落入 WebView 浏览器查找。
- 面板提供上一个、下一个、全选匹配、区分大小写、正则、整词、单次替换和全部替换；所有内置文案与无障碍标签均已中文化。
- 面板位于编辑器顶部而非覆盖正文，暖纸背景、深绿焦点、按钮和复选框与现有视觉令牌一致；1256px 宽度下两行布局无横向溢出。
- 编辑器右键“文档操作”和文档列表右键菜单均暴露同一查找入口，Esc 关闭搜索，F3 / Shift+F3 与 Ctrl+G 延续 CodeMirror 标准键盘路径。
- 搜索扩展只进入异步 `LargeTextEditor` 产物；普通阅读、今天页和知识空间概览不加载它。选区联动最多高亮视口中的 180 处，未建立第二份全文 DOM。

### Verification

- `pnpm test`：48 个测试文件、196 项全部通过。
- `pnpm run build`：类型检查与生产构建通过；异步 `LargeTextEditor` 为 311.21 kB / gzip 101.35 kB，搜索能力没有进入首屏块。
- 1 MB、3 MB、5 MB Markdown 基准结构检查、公开版隔离检查和差异格式检查均通过。

final result: passed

## Markdown 表格与公式插入器（2026-08-10）

### Evidence

- 表格插入器：`<QA_TEMP>\knitspace-table-builder-first.png`
- 公式插入器（最终轻量遮罩）：`<QA_TEMP>\knitspace-context-to-formula-final.png`
- 右键插入菜单向上避让：`<QA_TEMP>\knitspace-insert-submenu-upward.png`
- 真实插入与选区：`<QA_TEMP>\knitspace-formula-inserted-local.png`；随后已使用 CodeMirror 撤销并由 `knitspace-formula-undone.png` 确认测试内容未保留。

### Findings

- 表格与公式不再只藏在右键二级菜单；1256 × 829 的真实 Tauri 窗口中，两项均位于格式工具栏首屏。
- 表格支持 1–8 列、1–12 个内容行、表头占位和四种对齐；有界尺寸避免误操作生成巨型文本。
- 公式支持行内 / 块级、常用 LaTeX 片段和即时 KaTeX 预览。预览限制为 4000 字符并以 100ms 防抖，只渲染当前短公式，不触发全文 Markdown Worker。
- 弹层使用暖纸面、深绿焦点和离线字体链；全屏 `backdrop-filter` 已移除，避免 WebView2 为装饰性模糊承担持续合成成本。
- 右键“插入”与“文档操作”子菜单在窗口底部改为向上展开，表格、公式和双链均保持完整可见。
- Escape 关闭并恢复编辑器焦点，Tab 在对话框内循环；插入通过单次 CodeMirror transaction 完成并选中首个可编辑内容。

### Verification

- `pnpm test`：48 个测试文件、196 项测试全部通过。
- `pnpm run build`：Vue 类型检查和 Vite 生产构建通过；仅保留既有 Mermaid / Cynefin 大块提示。
- `pnpm run check:public` 与针对本次文件的 `git diff --check` 通过。

final result: passed

## 今天空间事件隔离与完整记录入口（2026-08-10）

### Evidence

- 生活记录空状态与桌面层级：`<QA_TEMP>\knitspace-today-filtered-events-native.png`
- 300 条活动日志中仍显示旧纪念日：`<QA_TEMP>\knitspace-old-anniversary-visible-final.png`
- 纪念日右键菜单：`<QA_TEMP>\knitspace-anniversary-context-menu-native.png`
- 六条纪念日的真实计数与内部滚动：`<QA_TEMP>\knitspace-six-anniversaries-visible-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；测试结束后所有临时纪念日均已删除，SQLite 查询确认 `pomodoro/anniversary` 测试残留为 0。

### Findings

- 现场 Vault 已有 300 条 `activity` 操作日志。旧实现用一个全局 `ORDER BY ... LIMIT 80` 再在前端过滤，较早的专注与纪念日会永久留在 SQLite，却从今天页消失；大量生活记录也会反向挤压操作日志备份。
- 原生层现在提供两个固定范围查询：生活记录按 `pomodoro`、`anniversary` 各自有界读取，活动日志只读取 `activity`。两类记录不再竞争同一个 LIMIT，前端也不再接收并丢弃无关事件。
- 真实原生回归在 300 条更新的活动日志旁插入一条 2000 年纪念日；新生活通道仍立即显示它，右键可编辑或删除。该临时记录已通过 UI 删除并由数据库复核。
- 纪念日不再硬切前四条；最多 120 条按下一次到来时间排列并在卡片内部滚动，标题显示真实有界计数。较早专注记录可从最近四条展开到完整有界列表，记录行使用 `v-memo`，不会让整张今天页随列表增长。
- 计时器仍只在运行时每秒校准显示，开始、暂停、结束等交互边界才写恢复状态；切换页面后由结束时间校准，不产生每秒 SQLite/localStorage I/O。
- `ui-ux-pro-max` 的进度、空状态、键盘、低动效和长列表建议被采纳；滚动叙事、鲜艳营销块、手写在线字体被拒绝，继续使用暖纸、深绿与离线中文字体。

### Verification

- 新增 Rust 回归构造 90 条更新的活动日志、旧专注和旧纪念日，证明通用前 80 条全被活动占据时，两个过滤通道仍各自完整返回。
- `pnpm test -- --run`：51 个测试文件、213 项全部通过。
- `cargo test`：37 项全部通过。
- Vue 类型检查、`pnpm build`、`pnpm check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过；仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 设置页数据安全锚点与 Vault 恢复菜单（2026-08-10）

### Evidence

- 修复前的数据与备份锚点：`<QA_TEMP>\knitspace-settings-backup-native-before.png`
- 修复后的干净章节首屏：`<QA_TEMP>\knitspace-settings-backup-native-final.png`
- Vault 健康右键菜单：`<QA_TEMP>\knitspace-settings-vault-menu-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829。

### Findings

- 旧锚点使用 `scrollIntoView({ block: 'center' })`，点击“数据与备份”后顶部会保留上一节 AI 配置的半截页脚，容易误判页面切换失败；现改为章节起点定位，数据标题、健康卡和两种备份方式在同一首屏形成完整层级。
- 设置索引继续使用五个稳定分类，并为当前项补充 `aria-current="page"`；视觉顺序与 Tab 顺序一致。
- Vault 健康卡以标题提示右键能力。右键菜单现在同时包含完整性检查、打开位置、复制路径、创建完整归档和“从完整归档恢复…”。
- 恢复入口使用红色文本和分隔线表达风险，不只依赖颜色；执行后仍先打开 ZIP 选择器，再显示危险确认，并由原生恢复流程先创建恢复前安全归档。
- 本轮没有增加持续监听、滚动观察器或大型依赖；设置页只在打开时执行一次 Vault 健康检查，菜单和锚点操作不会引入额外渲染循环。
- `ui-ux-pro-max` 的层级、焦点、状态文本与危险确认建议被采用；比较表、鲜艳青色、营销式大块和在线字体建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- `pnpm test -- --run`：52 个测试文件、215 项全部通过。
- `cargo test`：37 项全部通过，其中完整归档恢复测试会先校验暂存 Vault，再替换现有资料。
- `pnpm build` 与 `pnpm check:public` 通过；仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## 实验室本机能力中心与诚实研究队列（2026-08-10）

### Evidence

- 首次真实能力检查（修复长版本溢出前）：`<QA_TEMP>\knitspace-capability-center-native.png`
- 修复横向滚动后的桌面首屏：`<QA_TEMP>\knitspace-capability-center-native-fixed.png`
- Vault 能力右键菜单：`<QA_TEMP>\knitspace-capability-menu-native.png`
- 尚未接入能力与替代流程：`<QA_TEMP>\knitspace-capability-research-native.png`
- 离线 OCR 研究项右键菜单：`<QA_TEMP>\knitspace-capability-research-menu-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；现场检查结果为 Vault、FFmpeg、输出目录、剪贴板 4/5 就绪，AI 未配置。

### Findings

- 旧实验室只有四张“引擎准备中 / 接口设计中 / 原型规划中”静态卡片，没有检查、入口或可执行操作；现在它是本机能力中心，页面状态来自真实 Vault、FFmpeg、输出目录、AI 配置和剪贴板设置。
- Vault 检查同时判断 SQLite 完整性、Schema 版本、缺失 Markdown 与 FTS 数量；FFmpeg 和 FFprobe 通过已有原生探针并行检查。两个检查只在打开页面或主动刷新时运行，不常驻轮询。
- 输出目录、AI 与剪贴板状态直接来自现有设置。AI 只显示配置数量，不推断 Windows 凭据是否存在；“没有 API 配置时本地功能仍可完整使用”避免把可选网络能力包装成必需依赖。
- OCR、公式识别、滚动截图与字幕转写明确归入“尚未接入的能力”，不显示虚假安装或运行按钮；每项写明当前边界，并链接到图片整理、公式编辑、代码长图或音轨提取等真实替代流程。
- 正式能力卡右键可进入对应工作流、重新执行本机检查或复制单项诊断；研究项右键只提供现有替代流程和复制边界说明。Shift+F10、方向键与 Escape 使用同一路径。
- 全量诊断复制只包含页面可见状态，不包含笔记正文、API Key 或其他密钥；状态使用图标、文字和颜色共同表达。
- 原生首轮发现 FFmpeg 长版本字符串撑出横向滚动条；能力卡内容区增加 `min-width: 0` 与有界省略后，1256 × 829 窗口已无横向溢出。
- `ui-ux-pro-max` 的加载反馈、键盘可达、深链、状态文字和固定弹层层级建议被采用；深色炫彩营销块、自动播放演示和 Fredoka/Nunito 在线字体建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- 新增能力推导测试，覆盖全部就绪、异步检查中、Vault 迁移/正文异常、缺少 FFmpeg、未设置输出、AI 未配置和剪贴板暂停。
- `pnpm test -- --run`：54 个测试文件、222 项全部通过；`cargo test`：37 项全部通过。
- `pnpm build`、`pnpm check:public`、`cargo fmt --check` 与相关文件 `git diff --check` 全部通过；实验室异步脚本 12.43 kB / gzip 5.52 kB，样式 9.91 kB / gzip 2.37 kB，仅保留既有 Mermaid / Cynefin 大块提示。

final result: passed

## Typora 式 Markdown 分层菜单键盘闭环（2026-08-10）

### Evidence

- Markdown 编辑区主右键菜单：`<QA_TEMP>\knitspace-typora-menu-root-native.png`
- 方向键打开并聚焦代码块子菜单：`<QA_TEMP>\knitspace-typora-menu-keyboard-submenu-native.png`
- 左方向键关闭子菜单并返回父项：`<QA_TEMP>\knitspace-typora-menu-keyboard-return-fixed-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829。

### Findings

- 现有菜单已经覆盖 Typora 参考中的剪切、复制、粘贴、删除、高频 Markdown 格式、复制格式、代码块与插入，并进一步连接代码分享、AI 草稿、常用片段、笔记、错题和文档操作；本轮没有重复设计菜单外观。
- 修复了隐藏子菜单参与一级方向键导航的问题：一级菜单现在只在可见一级按钮间循环，子菜单只在当前分支内部循环，不会把焦点送入不可见按钮。
- 父级分支增加真实 `aria-expanded` 状态。右方向键从父项进入子菜单并聚焦第一项；左方向键或子菜单内 Escape 只收起当前子菜单并返回父项；一级 Escape 才关闭整个菜单并把焦点还给 CodeMirror。
- 原生验证首次发现父按钮的 `focus-within` 会在左方向键返回后立刻重开子菜单；改为悬停或显式 `.open` 状态展开后复验通过。这个问题无法仅靠静态截图发现。
- 子菜单继续根据可用空间左右翻转。测试位置靠近窗口右侧时，代码语言菜单自动向左展开，完整显示且不产生页面滚动。
- 菜单状态只是一个小型字符串引用，没有新增观察器、轮询或依赖；CodeMirror、Markmap 和 AI 面板仍按模式异步加载。
- `ui-ux-pro-max` 的键盘可达、禁用状态、焦点反馈与异步组件建议被采用；作品集网格、蓝色单色、Caveat/Quicksand 在线字体建议被拒绝，继续使用暖纸、深绿和本机中文字体链。

### Verification

- `npm test`：54 个测试文件、224 项全部通过；新增分层菜单意图测试覆盖右键进入、左键返回、子级 Escape 与一级 Escape。
- `cargo test`：37 项全部通过；`npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过。
- 文档路由仍保持异步拆分；`DocumentsView` 为 98.32 kB / gzip 31.09 kB。仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 桌面主快照与长会话持久化边界（2026-08-10）

### Evidence

- 热更新后的真实桌面窗口：`<QA_TEMP>\knitspace-persistence-boundary-native.png`
- 状态：真实 Knitspace Tauri 开发窗口，1256 × 829；Vault、导航和 Markdown 编辑状态正常。

### Findings

- 代码长图草稿原先同时进入主工作区快照和独立草稿键；任何设置、活动或任务更新都会再次同步序列化整段代码。现在主快照从类型和运行时两层排除 `codeDraft`，草稿只在自身变化时写独立键。
- 保留旧主快照的一次迁移：如果旧版本只有内嵌草稿，启动时先迁移到独立键，再由后续主快照自然移除旧副本。显式 JSON 备份仍包含代码草稿，恢复后也会立即重建独立键。
- 桌面主快照继续清空由 SQLite / Vault 持有的文档、资料、单词、关系和活动缓存，因此普通 UI 操作不会把 1–5 MB Markdown 或图片预览写回 WebView 存储。
- 非终态任务更新改为 900ms 合并写入；完成、失败和取消仍通过活动记录立即落盘。应用卸载时显式冲刷，避免窗口恰好关闭时遗漏最后一段轻量状态。
- 任务历史在加载、恢复、新增和主快照四个入口均限制为最近 500 条，防止长年使用后数组与同步 JSON 无限增长。
- 代码草稿保存延迟按字符数自适应：普通草稿 450ms、十万字符以上 900ms、五十万字符以上 1500ms；离开代码长图页面时仍立即保存。
- 新增逻辑不增加轮询、观察器或大型依赖；只保留一个按需计时器，并在立即写入时主动取消待执行任务。
- `ui-ux-pro-max` 的大对象浅边界、异步反馈和长会话性能建议被采用；视频首屏、蓝黄高饱和配色和在线 Fira 字体建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- 新增 5 项持久化测试，覆盖 100 万字符草稿不进入主快照、桌面重集合剥离、500 条任务上限、进度突发合并、退出冲刷和草稿长度退避。
- `npm test -- --run`：55 个测试文件、230 项全部通过；`cargo test`：37 项全部通过。
- `npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过；仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 本地音视频片段截取（2026-08-10）

### Evidence

- 截取深链的开发版渲染结果：`<QA_TEMP>\knitspace-media-clip-renderer.png`
- 真实输入：`<QA_TEMP>\knitspace-clip-qa-input.mp4`，6 秒，62,560 字节。
- 真实输出：`<QA_TEMP>\knitspace-clip-qa-output-20260810.mp4`，2.0 秒，37,425 字节，H.264 640 × 360 + AAC。
- 视觉证据来自正在运行的 Vite 开发服务器中的同一 Tauri Vue 渲染路由 `#/media?operation=clip`；原生后端证据来自编译后的 Rust 测试与本机 FFmpeg 实际输出。当前 Codex 会话无法向 WebView2 注入模拟输入，因此没有把渲染截图误写成原生窗口交互截图。

### Findings

- 媒体工作台原先只有整份音轨提取和格式转换；现在第四种输出是“截取一个片段”，可输入秒数、`mm:ss` 或 `hh:mm:ss`，并以有界轨道显示所选区间。
- 入口不再依赖“今天”：工具空间、工具目录和 `Ctrl K` 搜索均能通过“裁剪视频”“截取音频”“trim”或“clip”发现，并支持 `/media?operation=clip` 深链；读取媒体后的右键菜单也能直接切换到截取并聚焦开始时间。
- 前后端都拒绝无法解析、逆序、短于 0.1 秒、越过源文件或长于 24 小时的区间。Rust 端必须由 FFprobe 确认至少一条音轨或视频轨，不能只相信页面参数。
- 视频片段输出为新 MP4（H.264 + 可选 AAC），纯音频输出为新 M4A；临时文件完成后才落到最终名称，停止或失败会清理临时输出。实际 1–3 秒截取生成精确 2.0 秒文件，输入 SHA-256 前后相同。
- 媒体数据始终由 FFmpeg 后台进程流式读取，不进入 WebView 内存；进度写入继续按 700ms / 2% 合并，新增页面脚本 18.29 kB / gzip 7.19 kB，样式 14.81 kB / gzip 2.79 kB。
- `ui-ux-pro-max` 的可行动空状态、深链、键盘可达和本地状态反馈建议被采用；作品集网格、鲜艳蓝色、营销首屏与在线字体建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- `npm test`：56 个测试文件、233 项全部通过；新增 3 项时间区间测试，并扩展工具检索覆盖“裁剪视频”。
- `cargo test`：38 项全部通过；新增区间边界测试覆盖负数、过短、越界与超过 24 小时。
- `npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 全部通过；仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 今天 · 本地时间账本（2026-08-10）

### Evidence

- 1256 × 829 开发版时间账本深链：`<QA_TEMP>\knitspace-focus-ledger-renderer-2.png`
- `Ctrl K → 补记时间` 的直接表单状态：`<QA_TEMP>\knitspace-focus-ledger-entry-renderer.png`
- 两张图来自正在运行的 Vite 开发服务器中的同一 Tauri Vue 渲染路由；SQLite 事件持久化由编译后的 Rust 事件测试单独验证。

### Findings

- 原有番茄钟会记录已完成时长，但无法补记离线学习、修正名称或错误时长，也没有跨天概览；现在“今天”的同一张专注卡内提供可折叠时间账本，没有新增一级空间或独立功能页。
- 七天概览按本地日历而不是 UTC 字符串分组，显示每天分钟数、本周总分钟数和记录段数；空周保持明确空状态，不伪造趋势。
- `Ctrl K` 搜索“补记时间”会直接打开并聚焦名称输入；侧栏和“今天”右键菜单中的“时间账本”只展开账本。补记表单包含名称、1–1440 分钟与本地开始时间，并拒绝未来时间。
- 历史记录继续支持键盘菜单键与右键。专注记录菜单新增“修改名称、时间和时长”，与“用相同配置再专注一次”和删除组成完整闭环；编辑会保留原记录 ID、创建时间和既有状态。
- 新记录仍使用已有 SQLite `pomodoro` 事件，不建立重复模型；浏览器预览使用既有有界恢复层。七天统计只扫描已限制的 120 条记录，并且不依赖每秒倒计时状态，因此计时跳动不会触发账本重算。
- 新增逻辑让“今天”异步页面从 38.41 kB 增至 43.64 kB（gzip 14.72 kB）；没有新增依赖、轮询、图表库或大型 SVG。
- `ui-ux-pro-max` 的可行动空状态、固定五空间、键盘焦点、深链与长列表边界建议被采用；滚动叙事、实时闪烁、蓝色单色和 Caveat/Quicksand 在线字体建议被拒绝，继续使用暖纸、深绿与离线中文字体链。

### Verification

- 新增 4 项账本测试，覆盖本地日期分组、七天窗口、空周、分钟取整与 24 小时上限；导航测试覆盖“补记时间”深链。
- `npm test`：57 个测试文件、237 项全部通过；`npm run build`、`npm run check:public` 和 `cargo fmt --check` 通过。
- Rust 事件定向回归 3 项全部通过：事件写入/删除、活动替换不覆盖专注或纪念日、不同事件流不互相挤占。
- 首轮 Rust 定向测试因 C 盘 0 MB 可用空间失败；删除 8 个仅由 QA 创建的临时 Edge 配置后释放约 145 MB，复测通过。C 盘仍接近满盘，属于当前机器的外部数据安全风险，不记为产品测试通过条件。

final result: passed

## Vault 磁盘空间健康预警（2026-08-10）

### Evidence

- 设置页真实 Tauri 开发窗口：`<QA_ARTIFACTS>\knitspace-storage-ready-native.png`
- Vault 健康卡右键菜单：`<QA_ARTIFACTS>\knitspace-storage-context-native.png`
- 本机能力与实验室：`<QA_ARTIFACTS>\knitspace-lab-storage-native.png`
- 状态：重新编译并启动的 Knitspace Tauri 开发版，1256 × 829；现场 Vault 位于 `<VAULT_ROOT>`，原生探针显示约 901 GB 可用。C 盘同期仅约 137 MB，但不会被错误地当成 Vault 所在卷。

### Findings

- 容量检查使用 Windows `GetDiskFreeSpaceExW`，不依赖 SQLite 成功打开；即使资料库因满盘无法建立连接，设置页仍可单独给出所在磁盘、剩余空间和明确动作。
- 设置页并行执行 SQLite 快速检查和磁盘探针，任一失败都不会吞掉另一项结果。低于 2 GiB 或 2% 提示“偏低”，低于 512 MiB 或 0.5% 提示“严重不足”；未知状态不再被冒充为整体健康。
- 严重、偏低、未知和正常状态同时使用图标、文字、边框与进度条，不只依赖颜色；严重状态采用 `role="alert"` 和 assertive live region，但没有闪烁动画。
- 右键 Vault 健康卡可重新检查、在资源管理器查看、复制资料库路径、复制磁盘空间诊断、创建完整归档或进入受保护的恢复操作；Shift+F10 继续复用同一菜单。
- 实验室把容量、SQLite、Markdown 正文和 FTS 合并为一张真实能力卡，并优先报告容量风险或容量探针失败。工具空间侧栏和卡片均能发现实验室，不依赖“今天”页。
- 探针只在打开设置/实验室或主动重新检查时执行，没有定时轮询、目录遍历或渲染器大对象；容量阈值是共享纯函数，设置页和实验室不会产生状态分歧。
- `ui-ux-pro-max` 的明确状态文本、图标加颜色、可行动警告、键盘菜单与渐进暴露建议被采用；营销式高饱和青色、在线字体、闪烁告警和持续轮询被拒绝，保持暖纸、深绿和离线中文字体链。
- `computer-use` skill 的运行时因当前系统资源路径不可用而未能初始化；真实窗口验收改用 WebView2 渲染子窗口的原生消息和 `PrintWindow`，没有把普通浏览器截图冒充桌面结果。

### Verification

- `npm test`：58 个测试文件、242 项全部通过；新增 4 项容量阈值测试，并扩展实验室测试覆盖“磁盘严重不足但 SQLite 同时失败”的优先级。
- `cargo test`：39 项全部通过；新增原生容量探针测试，验证数值有界且不需要打开 SQLite。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `cargo fmt --check` 通过；生产构建仅保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 全局内容收藏（2026-08-10）

### Evidence

- 知识空间收藏入口与稳定双行筛选栏：`<QA_ARTIFACTS>\knitspace-content-favorites-native.png`
- 收藏为空时的可行动说明：`<QA_ARTIFACTS>\knitspace-content-favorites-empty-native.png`
- 知识条目真实桌面右键菜单：`<QA_ARTIFACTS>\knitspace-content-favorite-menu-native.png`
- 状态：重新编译并启动的 Knitspace Tauri 开发版，1256 × 829；右键菜单只展开检查，没有执行“加入收藏”，因此未改动现场 Vault 内容。

### Findings

- 原来的“收藏”只覆盖工具，无法兑现全局入口；现在笔记、题目、结构化单词和资料统一使用 SQLite v10 的轻量收藏指针，不复制 Markdown、释义、预览或附件。
- 知识空间提供“收藏内容”侧栏深链与收藏筛选；今天提供最多 6 项收藏内容架，`Ctrl K` 无查询时也展示最多 6 项。文档、单词、资料及知识聚合列表都能通过右键或 Shift+F10 加入/取消收藏。
- 每个入口都返回原内容所在页面，不新建收藏详情页；列表同时使用星标和文字/状态背景，不只依赖颜色。空收藏说明下一步操作，不显示空白卡片。
- 收藏最多 256 项，前端用缓存键集合做常数级判断；首页和命令面板只解析现有元数据，绝不读取 Markdown 正文、资料预览或二进制文件。
- JSON 备份格式升级到 v6；桌面恢复会在文档、单词和资料落盘后，以事务完整替换收藏集合，自动跳过已经不存在的内容。删除题目、笔记或单词时对应指针一并清理。
- 真实窗口检查发现首版筛选栏在常用桌面宽度下逐字换行；已改成搜索/结果状态首行、筛选项第二行且禁止按钮内换行，并完成二次截图。
- `ui-ux-pro-max` 的深链接、可见焦点、可行动空状态、非颜色单一指示和 Vue `computed` / `v-memo` 建议被采用；营销漏斗、在线字体和高饱和红金配色建议被拒绝，继续使用暖纸、深绿和离线中文字体链。
- `computer-use` 运行时再次因内核资源路径缺失而无法初始化；桌面验收改用仅针对 Knitspace WebView2 子窗口的原生消息和 `PrintWindow`，没有把浏览器页面冒充桌面结果。

### Verification

- `npm test -- --run`：60 个测试文件、249 项全部通过；包含内容解析、去重、路由、备份 v6 与 256 项恢复上限。
- `cargo test`：41 项全部通过；覆盖 v10 迁移、一次性浏览器迁移、内容存在性校验、事务恢复、悬空指针过滤、取消收藏、删除联动和重启持久化。
- `npm run build`、`npm run check:public`、`cargo fmt --check` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示。

final result: passed

## 继续工作入口与“最近打开”（2026-08-10）

### Evidence

- `Ctrl K` 首屏的五空间与最近内容：`<QA_ARTIFACTS>\knitspace-command-continue-first-screen-native.png`
- 今天页“最近打开”三列布局修复：`<QA_ARTIFACTS>\knitspace-today-recent-layout-fixed-native.png`
- 最近文档原生右键菜单：`<QA_ARTIFACTS>\knitspace-today-recent-open-menu-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；右键菜单只展开检查，没有移除现场记录或删除内容。

### Findings

- `Ctrl K` 无查询状态把五个主空间压缩为稳定的五列入口，并将收藏内容、最近内容移动到工具分组之前；实际打开过的内容现在能在首屏直接继续，不再藏在长工具列表下方。
- 今天页原有“最近整理”按更新时间排序，不能表达用户真正打开过什么；现在只消费全局最近指针，展示笔记和题目的实际打开时间，并提供通往知识库“最近打开”筛选的深链。
- 最近文档右键或 `Shift+F10` 可阅读预览、打开源码编辑、收藏、从最近记录移除、复制双链和查看同类内容；“移除”只删除最近指针，不删除原文档。
- 打开全局命令面板时，今天页的快速入口、最近文档与收藏工具菜单会统一关闭，避免上下文菜单穿透到全局模态层上方。
- 原生截图发现 `.recent-document-module` 漏掉 12 列网格跨度，导致卡片仅占一列并逐字换行；现已在桌面端设为 4 列跨度、窄屏设为 12 列跨度，并增加 `min-width: 0` 防止长标题撑破布局。
- `ui-ux-pro-max` 的首屏可发现性、清晰层级、键盘操作、非破坏性上下文动作与稳定响应式网格建议被采用；营销式字体和高饱和配色建议被拒绝，继续使用暖纸、深绿和离线中文字体链。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过。
- `cargo test`：42 项全部通过；`cargo fmt --check` 通过。
- `npm run build`、`npm run check:public` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 全局命令面板内容右键操作（2026-08-10）

### Evidence

- 全局命令面板首屏：`<QA_ARTIFACTS>\knitspace-command-content-before-menu-native.png`
- 最近内容右键菜单与可见操作提示：`<QA_ARTIFACTS>\knitspace-command-content-menu-final-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；仅展开菜单检查，没有执行收藏、复制或移除操作。

### Findings

- 五空间、路由与工具目录已经完整互相覆盖；本轮缺口位于 `Ctrl K` 的收藏内容和最近内容：此前只能左键打开，无法在全局入口完成常用桌面操作。
- 收藏内容和最近内容现在支持鼠标右键与 `Shift+F10`；菜单提供打开内容、收藏切换、复制双链或名称、查看同类内容，最近内容额外提供“从最近打开移除”。
- 移出最近只删除 SQLite 最近指针，不删除原笔记、题目、单词或资料；收藏动作继续复用全局收藏内核，菜单没有创建第二套状态。
- 菜单使用统一的窗口边界夹取、方向键、Home/End、Esc 返回与焦点恢复逻辑；切换搜索词、关闭命令面板或点击其他区域时会同步关闭，避免悬空菜单。
- 菜单层级显式高于全局模态层，解决上下文菜单可能被遮挡的问题；标题使用省略号保护长名称，暖白背景、深绿图标和正文颜色保持清晰对比。
- 零查询路径仍只解析 Pinia 中有界的轻量元数据；右键菜单没有引入正文、附件、图片预览或额外页面包，未扩大首屏 I/O 和渲染成本。
- `ui-ux-pro-max` 的键盘可达、稳定 z-index、渐进披露、明确动作和按需加载建议被采用；作品集网格、靛青色、手写网络字体等不适合本地工作台的检索结果未采用。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过；菜单位置与键盘辅助函数定向测试 12 项通过。
- `cargo test`：42 项全部通过；`cargo fmt --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 工具空间最近任务桌面操作（2026-08-10）

### Evidence

- 工具空间原生布局与最近任务审计：`<QA_ARTIFACTS>\knitspace-tools-recent-context-audit-native.png`
- 最近任务右键菜单：`<QA_ARTIFACTS>\knitspace-tools-recent-job-menu-native.png`
- 任务菜单与全局命令面板隔离：`<QA_ARTIFACTS>\knitspace-tools-job-menu-isolation-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；只展开菜单检查，没有重跑任务、删除记录或修改输出文件。

### Findings

- 五空间、应用路由和工具目录继续保持完整互相覆盖；本轮最明显的功能暴露缺口位于工具空间右栏：工具卡已有右键，但高频的“最近任务”和“最近使用”只能左键跳转。
- 最近任务现在支持鼠标右键与 `Shift+F10`，可打开任务页面、使用原参数重新执行、打开输出位置、复制一个或多个输出路径、查看完整处理记录，以及删除历史记录。
- 删除动作继续使用统一确认对话框，只移除 Knitspace 的任务记录，不删除输入或输出文件；没有输出或无法重放的任务会呈现明确禁用态，不提供虚假可用操作。
- 最近使用工具复用工具卡的同一套上下文菜单，可直接打开、收藏切换或复制名称；收藏状态仍只有一个数据源，并会同步出现在今天和 `Ctrl K`。
- 两套菜单互斥，打开全局命令面板时统一关闭；菜单支持窗口边缘夹取、方向键、Home/End、Esc 返回和触发元素焦点恢复。原生截图确认右边缘菜单会向左展开且六项操作完整可见。
- 工具空间继续只计算最多 6 条最近任务和 5 个去重工具，输出路径仅在用户打开菜单时从已有轻量任务元数据读取；没有扫描文件、加载输出内容或扩大主页面 DOM。
- `ui-ux-pro-max` 的键盘可达、稳定层级、明确禁用态、文字与图标并用、150–300ms 反馈和性能边界建议被采用；检索出的作品集网格、动画驱动页面、蓝色 CTA 与在线手写字体不适合本地桌面工作台，未采用。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过；桌面菜单、历史列表与工具目录定向测试 13 项通过。
- `cargo test --manifest-path src-tauri\Cargo.toml`：42 项全部通过；`cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 知识空间对象级创作入口（2026-08-10）

### Evidence

- 知识空间原生布局与入口审计：`<QA_ARTIFACTS>\knitspace-knowledge-context-audit-native.png`
- Markdown 笔记对象右键菜单：`<QA_ARTIFACTS>\knitspace-knowledge-note-menu-native.png`
- 知识菜单与全局命令面板隔离：`<QA_ARTIFACTS>\knitspace-knowledge-menu-isolation-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；只展开菜单检查，没有执行收藏、移除最近、创建笔记或修改正文。

### Findings

- 知识空间已完整暴露 Markdown、题目与错题、结构化单词、资料与摘录四类内容，并提供 FTS 正文搜索、收藏、最近打开和清晰的空状态；本轮缺口是对象右键菜单只提供泛化的“打开内容”，无法直达已经实现的编辑模式。
- Markdown 笔记现在可从知识列表右键或按 `Shift+F10` 直接继续打开、进入源码编辑、阅读预览或思维图谱；题目按实际工作流提供继续打开、编辑题目以及阅读题目与解析，不向单词和资料显示无意义的编辑模式。
- 笔记、题目和单词的复制动作改为标准 `[[标题]]` 双链，资料保留纯名称复制；创建关联笔记、收藏切换和从最近使用移除继续复用统一的数据内核。
- 菜单高度按对象类型和“是否位于最近打开”动态计算，再交给统一边缘夹取函数；原生截图确认在窗口底部条目上打开时会自动向上展开，八项操作全部可见且没有遮挡。
- 菜单继续支持方向键、Home/End、Esc 与触发元素焦点恢复；打开 `Ctrl K` 时通过全局关闭事件清理菜单，但不会把焦点从命令输入框抢回知识列表。
- 零查询列表仍限制为 8 项，FTS 结果限制为 20 项并经过 140ms 防抖与异步序列门；正文由 SQLite 索引检索，页面只接收摘要，不因新增菜单读取 Markdown 全文或附件。
- `ui-ux-pro-max` 的搜索优先、清晰无结果状态、键盘可达、动态菜单边界、可读对比和 `v-memo` 建议被采用；夸张大标题、蓝色 CTA、在线无障碍字体和文档站式 FAQ 布局不符合 Knitspace 本地工作台气质，未采用。

### Verification

- `npm test -- --run`：61 个测试文件、253 项全部通过；菜单、知识搜索、双链、收藏和最近记录定向测试 17 项通过。
- `cargo test --manifest-path src-tauri\Cargo.toml`：42 项全部通过；`cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 资料库深链接与 PDF 翻页边界（2026-08-10）

### Evidence

- 资料库空状态与桌面布局：`<QA_ARTIFACTS>\knitspace-library-deeplink-native.png`
- PDF 类型与搜索状态写入工作区地址：`<QA_ARTIFACTS>\knitspace-library-filter-route-native.png`
- 原生 `Ctrl+R` 完整刷新后的状态恢复：`<QA_ARTIFACTS>\knitspace-library-deeplink-reload-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829；当前 Vault 没有资料，因此没有注入测试文件、打开资料菜单或改动用户数据。

### Findings

- 资料库原本已经具备批量导入、SQLite 轻量索引、虚拟列表、140ms 搜索防抖、标签、收藏与最近使用、来源选区、错题创建、图片编辑、代码分享、文件工具交接及对象级右键菜单；缺口是选中资料、筛选、搜索与 PDF 页码只停留在组件内存。
- 资料库状态现在规范化写入 `source`、`filter`、`q`、`page` 查询参数，并通过 `router.replace` 更新，避免连续搜索或翻页污染浏览历史；刷新、前进/后退和外部深链接都会恢复对应工作区状态。
- 非法筛选、负数页码、非数值页码和数组型查询参数会在进入 UI 前归一化；默认筛选、空搜索和第 1 页不会留在地址中，保持链接简洁。
- PDF 资料变更与页码变更已经拆开：只有更换资料时重新载入 PDF 文档，路由页码变化只重绘目标页；过时渲染任务继续取消，超大画布继续受安全像素上限约束。
- 资料列表右键菜单和预览画布右键菜单都接入全局关闭事件；打开 `Ctrl K` 时会清理局部菜单而不恢复旧焦点，避免与全局命令面板叠加。
- 列表搜索仍只过滤小型索引元数据，正文和二进制详情只在选中资料后读取；`SourceCanvas` 继续异步加载，PDF.js 没有进入资料库首屏包。
- `ui-ux-pro-max` 的深链接、空状态恢复动作、按需加载、稳定 z-index、可见焦点和键盘可达建议被采用；作品集瀑布流、夸张极简标题、蓝色 CTA 和在线字体不符合 Knitspace 本地资料工作流，未采用。

### Verification

- `npm test -- --run`：61 个测试文件、254 项全部通过；资料筛选、交接、桌面菜单、PDF Worker 和画布缩放定向测试 5 个文件、18 项通过。
- `cargo test --manifest-path src-tauri\Cargo.toml`：42 项全部通过；`cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- `npm run build`、`npm run check:public`、`npx vue-tsc -b --pretty false` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 全局快速捕获与本机草稿恢复（2026-08-10）

### Evidence

- `Ctrl+Shift+N` 从其他工作流进入快速捕获：`<QA_ARTIFACTS>\knitspace-quick-hotkey-dpi-native.png`
- 文本识别、动作建议和本机草稿状态：`<QA_ARTIFACTS>\knitspace-quick-draft-native.png`
- 动作卡片右键菜单：`<QA_ARTIFACTS>\knitspace-quick-action-menu-native.png`
- 动作菜单与全局命令面板隔离：`<QA_ARTIFACTS>\knitspace-quick-menu-isolation-native.png`
- 完整刷新后的草稿恢复：`<QA_ARTIFACTS>\knitspace-quick-draft-recovered-native.png`
- QA 草稿清理后的空状态：`<QA_ARTIFACTS>\knitspace-quick-draft-cleared-native.png`
- 状态：正在运行的 Knitspace Tauri 开发版，1256 × 829，窗口位于 150% DPI 副屏；只使用临时纯文本草稿，没有创建笔记、保存片段、导入文件或写入用户内容，QA 草稿已清除。

### Findings

- 快速捕获原本已支持文件、PDF、图片、代码、JSON、URL 和文本的本机识别，并能交接到笔记、剪贴板、资料库、代码分享、图片、PDF、开发者工具和 AI 草稿；缺口是只有可见按钮，没有真正跨页面的键盘入口，也无法恢复未提交文本。
- 全局 `Ctrl+Shift+N` 现在会关闭命令面板、任务抽屉和局部右键菜单，再进入快速捕获；顶栏按钮同时显示快捷键提示。原生验证淘汰了会被中文 Windows 输入层吞掉的 `Ctrl+Alt+N` 方案。
- 未提交纯文本会经过 180ms 防抖保存在本机，并限制为 200,000 字符；完整刷新或应用重启后恢复。文件对象仍只存在于临时交接内存，不序列化、不转成 data URL，也不写入 `localStorage`。
- 成功创建笔记、固定片段或把内容交接到目标工具后会清除草稿；用户也可通过紧邻字符统计的“丢弃草稿”立即清理。草稿状态不使用持续 `aria-live`，避免读屏器每次按键播报字符数。
- 动作卡片继续支持鼠标右键和 `Shift+F10`，可执行当前建议、整理成本地笔记、固定为常用片段、收进资料库或清空输入；打开全局命令面板时菜单同步关闭，不形成双层操作面。
- 悬停反馈由横向位移改为边框、背景和阴影变化，避免高频动作列表视觉抖动；正文、占位文字、禁用态和深绿主按钮在暖白表面上保持清晰层级。
- 150% DPI 原生截图使用窗口真实 DPI 重抓，确认双栏、顶栏、菜单和草稿状态完整可见；先前固定 96 DPI 的裁剪截图没有被误判为页面溢出。
- `ui-ux-pro-max` 的错误恢复、键盘可达、就近反馈、稳定悬停、可见焦点和动态状态建议被采用；等待名单布局、橙色 CTA、触屏手势和在线字体不符合 Knitspace 本地工作台，未采用。

### Verification

- `npm test -- --run`：61 个测试文件、256 项全部通过；捕获识别与草稿、工作区导航和桌面菜单定向测试 3 个文件、17 项通过。
- `cargo test --manifest-path src-tauri\Cargo.toml`：42 项全部通过；`cargo fmt --manifest-path src-tauri\Cargo.toml --check` 通过。
- `npx vue-tsc -b --pretty false`、`npx vite build`、`npm run check:public` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / PDF 大分块提示，diff 检查只报告仓库既有 CRLF 转换提醒。

final result: passed

## 阅读外观与长文可读性（2026-08-10）

### Evidence

- 1280 × 720 桌面设置布局与暖纸默认方案：`<QA_ARTIFACTS>\knitspace-appearance-desktop-preview.png`
- 大字、宽松行距、专注宽度、雾绿纸张与减少动态效果组合：`<QA_ARTIFACTS>\knitspace-appearance-large-mist-preview.png`
- 状态：使用与 Tauri 开发版相同的 Vite 页面、样式和工作区持久化逻辑进行隔离桌面验收；测试环境设置已恢复为舒适字号、舒展行距、平衡宽度、暖纸和正常动态效果，没有改动用户 Vault 内容。

### Findings

- 设置页新增独立“阅读与外观”入口，字号、行距、阅读宽度和纸张底色均采用三个有边界的预设，避免任意数值造成文档布局失控；减少动态效果可关闭页面入场、菜单缩放和非必要过渡。
- 设置面板采用左侧紧凑控制、右侧真实纸张预览的桌面布局；预览同时展示标题、正文、代码和引用，使字体与背景关系在保存前即可判断。1160px 以下自动退为单栏，不压缩按钮或预览文本。
- Markdown 阅读器和 CodeMirror 源码编辑器共享同一套比例变量，但保留阅读正文与等宽源码的字号差，避免代码块在大字模式下过度膨胀。阅读内容限制为 680 / 860 / 1040px，宽屏下不无限拉长单行。
- 暖纸、清白和雾绿只影响阅读与编辑表面，不给工具栏、导航和操作面板染色；正文墨色和代码块底色会随纸张成组切换，保持层次与对比。
- 外观设置进入现有工作区备份与自动保存链路；旧工作区和热更新中的旧内存对象都会回退到安全默认值，非法枚举或错误类型不会让根组件渲染失败。
- `ui-ux-pro-max` 的 65–75 字符行长、1.5–1.75 以上长文行距、减少动态效果、清晰对比和即时预览建议被采用；在线字体、黑白极简主题和高饱和蓝色主色不符合 Knitspace 的本地暖纸工作流，未采用。

### Verification

- 实际交互计算样式：大字 `18px`、宽松行距 `1.94`、专注宽度 `680px`、雾绿 `rgb(245, 247, 243)`、减少动态效果 `true`；复核后恢复默认。
- `npm test -- --run`：62 个测试文件、259 项全部通过；新增外观变量与旧内存回退 3 项测试，工作区设置迁移与异常值修复测试同步通过。
- `npx vue-tsc -b --pretty false`、`npx vite build`、`npm run check:public` 与 `git diff --check` 通过；`cargo test` 42 项与 `cargo fmt --check` 通过。生产构建只保留既有 Mermaid / PDF 大分块提示，Rust 只保留既有 Windows 导入库链接提示。

final result: passed

## 五空间功能地图与无关键词发现（2026-08-10）

### Evidence

- 1280 × 720 桌面功能地图与五空间分组：`<QA_ARTIFACTS>\knitspace-feature-map-desktop.png`
- 功能地图内“知识”空间的右键菜单：`<QA_ARTIFACTS>\knitspace-feature-map-context-menu.png`
- 状态：使用与 Tauri 开发版相同的 Vite 页面、路由和工作区导航数据进行桌面验收；没有创建、修改或删除用户 Vault 内容。

### Findings

- 路由审计确认 20 个应用路由已经归属于“今天、知识、创作、复习、工具”五个空间；真正的缺口是用户不输入关键词时，`Ctrl+K` 只显示空间与最近项目，无法浏览所有子功能。
- 命令面板新增“浏览全部功能”，以同一份 `workspaceNavGroups` 数据生成五空间功能地图，共暴露 26 个可直接到达的子功能；侧栏、命令搜索和功能地图不会维护三份容易漂移的清单。
- 默认仍保留轻量的搜索与最近项目路径，功能地图通过按钮或 `Alt+A` 按需展开；再次按下 `Alt+A` 返回最近项目，`Escape` 会先退出功能地图、再关闭命令面板。
- 每个空间标题可直接进入空间，也支持鼠标右键复用现有空间菜单。验收时发现菜单层级低于命令面板遮罩，现仅在命令面板场景将菜单提升到 `z-index: 190`，普通侧栏菜单层级保持不变。
- “阅读与外观”加入命令索引，并补充“阅读外观”连续别名，用户省略连接词也能直接命中设置页。
- 功能地图只增加少量静态导航元数据，没有引入新页面、正文扫描或重型依赖；真实内容搜索与各工作区的异步加载策略保持不变。
- `ui-ux-pro-max` 的无关键词可发现性、键盘导航、稳定悬停、明确焦点与浮层层级建议被采用；企业式巨型菜单、在线字体、营销蓝色和额外首页入口不符合 Knitspace 的本地桌面工作流，未采用。

### Verification

- 浏览器实际 DOM 验收：五个空间分别展示 4、7、6、2、7 个入口，共 26 个；`Alt+A` 往返、中文别名搜索、空间标题右键菜单均通过。
- `npm test -- --run`：62 个测试文件、260 项全部通过；工作区导航定向测试 7 项通过。
- `npx vue-tsc -b --pretty false`、`npx vite build`、`npm run check:public` 与 `git diff --check` 通过；`cargo test` 42 项与 `cargo fmt --check` 通过。生产构建只保留既有 Mermaid / PDF 大分块提示，Rust 只保留既有 Windows 导入库链接提示。

final result: passed

## Typora 式右键菜单连续编辑契约（2026-08-10）

### Evidence

- 1280 × 720 Markdown 编辑器与 Typora 式右键菜单：`<QA_ARTIFACTS>\knitspace-typora-context-focus.png`
- 状态：使用与 Tauri 开发版相同的 Vite 页面、CodeMirror 编辑器和浏览器隔离工作区进行验证；临时正文已恢复为原始 `# 未命名笔记`，没有创建 QA 文档或改动桌面 Vault。

### Findings

- 现有菜单已经覆盖 Typora 参考中的剪切、复制、纯文本粘贴、删除、复制为 Markdown / HTML、格式网格、代码块与插入分组，并扩展了本地图片、双链、学习工具、代码分享和文档操作；本轮没有复制第二套菜单。
- 审计发现编辑型命令移除菜单后没有统一恢复 CodeMirror 焦点。粗体、剪贴板、删除、格式化复制、代码块、Markdown 片段、文档双链、分屏和固定片段现在都会保留原选区并把焦点交还源码编辑器，可直接继续输入。
- 跳转代码分享、AI 工作台、新建笔记或题目等导航型动作不会抢回旧编辑器焦点；表格和公式插入器继续由模态框接管焦点，取消后再返回编辑器。
- 从右键菜单粘贴图片会在本地持久化开始时立即返回编辑器，不会等慢速文件操作结束后突然抢走用户正在使用的标题栏或其他页面；工具栏触发图片粘贴时不强制改变焦点。
- 真实键盘路径通过：`Shift+F10` 打开，`End` 到最后一项，`ArrowRight` 进入“文档操作”，`ArrowLeft` 返回父项，`Escape` 关闭菜单；禁用项会被方向键跳过。
- 菜单继续使用暖白不透明表面、深色正文、雾绿悬停和本机 UI / 等宽字体变量；图标来自统一的 `AppIcon`，悬停只改变色彩与背景，不产生布局位移。
- `ui-ux-pro-max` 的键盘全可达、明确焦点、稳定悬停、z-index 管理和按需加载建议被采用；作品集网格、夸张标题、在线 Atkinson 字体与蓝色 CTA 不符合 Knitspace 本地 Markdown 工作流，未采用。

### Verification

- 实际交互证据：执行“粗体”后活动元素为 `.cm-content[role="textbox"]`；无需点击即可继续输入，正文从 `**focus-contract**` 变为 `**Z**`。
- 子菜单证据：进入后活动项为“在当前文档中查找”，左方向键恢复到“文档操作”，Escape 后菜单节点数为 0；测试正文最终恢复为 `# 未命名笔记`。
- `npm test -- --run`：62 个测试文件、260 项全部通过；编辑器菜单、Markdown 格式和结构化插入定向测试 3 个文件、14 项通过。
- `npx vue-tsc -b --pretty false`、`npx vite build`、`npm run check:public` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Obsidian Frontmatter 兼容与属性带（2026-08-10）

### Evidence

- 1280 × 720 桌面折叠属性带：`<QA_ARTIFACTS>\knitspace-frontmatter-collapsed.png`
- 展开后的有界属性详情：`<QA_ARTIFACTS>\knitspace-frontmatter-expanded.png`
- 属性带右键菜单：`<QA_ARTIFACTS>\knitspace-frontmatter-context-menu.png`
- 阅读预览隐藏 YAML、保留正文：`<QA_ARTIFACTS>\knitspace-frontmatter-preview.png`
- 状态：使用与 Tauri 开发版相同的 Vite 页面和 CodeMirror 编辑器验收；测试正文已恢复为原始 `# 未命名笔记`，没有创建 QA 文档或改动桌面 Vault。

### Findings

- 支持 Obsidian / Typora 常见的文首 YAML Frontmatter，并兼容 BOM、CRLF、`---` 与 `...` 结束符；只读解析不会格式化、排序或重写用户的 Markdown 原文。
- 阅读预览只移除完整且位于文首的有界 Frontmatter；未闭合或超出扫描上限的内容继续作为普通 Markdown 显示，避免异常元数据吞掉整篇正文。
- 属性带默认只展示前四项和剩余数量，按需展开最多 40 项；嵌套对象和集合以安全摘要显示，解析错误有明确状态，不把大型 YAML 直接铺满编辑区。
- 属性带支持鼠标右键与 `Shift+F10`，可复制 YAML 原文、安全 JSON、跳到源码首行及展开/收起；菜单使用暖白不透明表面、清晰深色文字和稳定悬停反馈。
- Frontmatter 扫描限制为 64 KiB / 400 行，值摘要限制深度 4、集合 40 项；内容变更采用 `shallowRef` 与 140/260 ms 防抖，避免每次按键深度追踪或完整解析大文档。
- 修复相同 HTML 再次渲染时父层“正在更新预览”无法结束的问题：即使渲染字符串未改变，也会完成 DOM 增强、目录同步和 `rendered` 事件契约。
- YAML 边界扫描拆成无依赖轻量模块，Markdown Worker 未打入 `js-yaml`；产物从拆分前约 496.19 KB 回落到 451.21 KB。
- `ui-ux-pro-max` 的渐进披露、键盘焦点、浮层层级、正文对比度和大内容性能建议被采用；作品集式布局、深色橙色营销方案、在线字体和蓝色 CTA 不符合 Knitspace 的暖纸本地桌面工作流，未采用。

### Verification

- 实际交互证据：6 个属性折叠时显示前四项与 `+2`，展开显示 6 行；右键菜单首项为“复制 YAML 原文”；阅读预览只显示 `Dijkstra 最短路` 与正文，不包含 `tags:`，完成后待渲染计数为 0。
- 定向测试：2 个测试文件、21 项全部通过；覆盖常见属性、BOM/CRLF/`...`、损坏与未闭合 YAML、40 项上限及阅读预览剥离。
- `npx vue-tsc -b --pretty false`、`npx vite build` 与 `git diff --check` 通过；生产构建只保留既有 Mermaid / Cynefin 大分块提示。
- 1 / 3 / 5 MB Markdown 基准通过：冷解析平均 56.3 / 110.5 / 127 ms，热预览平均 7.4 / 15.9 / 18.9 ms；代码、公式与 Mermaid 仍按视口延迟增强。

final result: passed

## 滚动截图自动拼接工作流（2026-08-10）

### Evidence

- 1280 × 720 图片工作室滚动长图模式：`<QA_ARTIFACTS>\knitspace-scroll-stitch.jpg`
- 滚动长图预览右键菜单：`<QA_ARTIFACTS>\knitspace-scroll-stitch-menu.jpg`
- 状态：使用与 Tauri 开发版相同的 Vite 页面、OffscreenCanvas 与图片 Worker 验收；样本只在 `import.meta.env.DEV && qa=stitch` 时生成，不进入正式用户数据、Vault 或生产工作流。

### Findings

- 图片工作室新增第六种“滚动长图”模式，支持按从上到下顺序导入 2–24 张连续截图；创作空间侧栏、Ctrl+K/工具搜索和工具目录都有直接入口，实验室不再把它列为“尚未接入”。
- 相邻截图先缩成 128 像素宽的灰度采样，再在独立 Worker 中搜索重叠；主线程只接收进度和最终 PNG，不在拖动、输入或导航时执行大像素比较。
- 自动识别只裁掉高置信度重叠；低纹理、纯色或无法可靠匹配时保留整张内容并逐条标出接缝，不以错误裁剪换取表面上的无缝效果。另提供 0–70% 固定重叠比例，方便滚动距离一致的截图。
- 输出限制为最多 24 张、64,000,000 像素和 32,767 像素高度；截图宽度差异超过 20% 或结果超限时会提示分组处理，避免浏览器画布崩溃或长时间卡死。
- 右侧按顺序显示缩略图，可上移、下移和移除；生成过程中显示百分比和具体阶段。预览继续支持 Ctrl+滚轮缩放、拖动平移、实际像素和适应窗口。
- 右键或 `Shift+F10` 打开预览菜单，可复制当前长图、重新识别重叠、适应窗口和查看实际像素；复制、PNG 导出、输出目录和处理历史复用现有图片工作室链路。
- `ui-ux-pro-max` 的长任务进度、键盘可达、明确焦点、稳定浮层、正文对比度与 Vue 大对象浅层状态建议被采用；横向营销旅程、夸张大标题、Caveat 在线字体、蓝色 CTA 与缩放悬停不符合 Knitspace 桌面工作台，未采用。

### Verification

- 真实页面样本：3 张 800 × 600 连续截图，每处精确重叠 150 px；Worker 正确识别 2 处重叠并输出 800 × 1500 PNG，页面显示“重叠可信”，没有丢行或额外重复区。
- 右键菜单实际 DOM：首项“复制当前预览”，其后为“重新识别重叠”“适应窗口”“实际像素”；菜单打开后首个可用项获得焦点。
- `npm test -- --run`：64 个测试文件、268 项全部通过；新增重叠识别、低纹理安全降级、输出偏移和像素上限 3 项测试。
- `npx vue-tsc -b --pretty false`、`npx vite build`、`npm run check:public` 与 `git diff --check` 通过；滚动截图 Worker 独立为 3.93 KB，生产构建只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 结构化单词草稿安全切换（2026-08-10）

### Findings

- 单词、读音、语言、四类词形、多个词义、例句、易混词和三个复习方向的任一修改都会进入明确脏状态；标题栏与当前虚拟列表行同时显示“未保存修改”。
- 切换词条、新建单词、创建关联笔记、路由离开及窗口关闭统一复用 Markdown 编辑器的三向决策组件，不再维护风格和键盘行为不同的第二套弹窗。
- “继续编辑”保留当前词条与输入；“放弃修改”从 Pinia/SQLite 摘要重新克隆目标词条；“保存并继续”先写入本地恢复日志和 Vault 队列，再完成切换。
- 当前脏词条的右键或更多菜单首项为“保存当前修改 Ctrl+S”；菜单继续支持 `Shift+F10`、方向键与 Esc，保存入口不会埋在页面顶部之外。
- 关闭窗口事件现在使用通用编辑器脏状态，提示可正确描述“文档”或“单词”；浏览器刷新同样通过 `beforeunload` 防止误丢草稿。
- 深度监听只遍历结构化单词的小型字段集合，不对 Markdown 大字符串做哈希；单词列表继续使用固定行高虚拟窗口和 `v-memo`，新增状态不会扩大渲染范围。
- `ui-ux-pro-max` 的错误恢复、提交反馈、键盘焦点和非颜色状态表达被采用；营销比较表、橙色 CTA、在线字体和移动端 44 px 强制尺寸不适合当前桌面密度，未采用。

### Verification

- 1280 × 720 实际单词库：修改“run”的第一词义后，当前行和标题栏显示“未保存”；切换到“new word”时共享弹窗完整可见，默认焦点为“继续编辑”。
- “继续编辑”保持 `/words` 和临时词义；再次切换并选择“放弃修改”后进入目标词条、状态恢复“已同步 · 本地”；返回 run 后仍是原始“跑；运行”，验收字符串未写入。
- 脏词条更多菜单实际首项为“保存当前修改 Ctrl+S”；从单词库点击“今天”时继续编辑阻止路由，放弃后才允许离开。

final result: passed

## Markdown 多文档桌面标签（2026-08-10）

### Findings

- 文档工作区新增轻量标签栏，笔记和错题可跨类型同时打开；会话只持久化文档 ID、固定状态与打开时间，不把 Markdown 正文写入 `localStorage`。
- 标签支持单击切换、中键关闭、`Ctrl+W` 关闭当前项、`Ctrl+Tab` / `Ctrl+Shift+Tab` 循环，以及右键或 `Shift+F10` 打开“固定、复制双链、关闭其他、关闭右侧”等桌面操作。
- 关闭当前脏标签复用共享三向未保存弹窗；活动标签即时显示草稿标题，并用橙色圆点与“未保存”文字共同表达状态，不只依赖颜色。
- 标签最多保留 10 个、最多固定 9 个；新文档只淘汰最久未使用的未固定标签，避免无界 DOM、正文副本和静默挤掉固定项。
- `ui-ux-pro-max` 的稳定布局、键盘可达、非颜色状态、浮层层级和 Vue 浅层小对象状态建议被采用；营销比较页、在线字体、蓝/橙 CTA 与夸张卡片化不适合 Knitspace 的暖纸桌面工作流，未采用。

### Verification

- 1280 × 720 开发版实测：多标签不挤压编辑工具栏；活动草稿标题由“未命名笔记”即时变为“标签会话 QA”，标签同步出现“未保存”和关闭入口。
- 右键菜单包含固定标签、复制文档双链、关闭标签、关闭其他标签、关闭右侧标签；固定项在批量关闭时保留，跨笔记/错题切换会同步文档路由。
- 放弃“标签会话 QA”后资料库标题恢复且无恢复横幅；切到第一个标签再刷新，活动标签仍恢复到第一项；QA 草稿未写入 Vault，预览会话已关闭。
- `pnpm test`：72 个测试文件、293 项全部通过；`pnpm build`：4,585 个模块通过，只有既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 本地字幕校对与格式转换（2026-08-10）

### Findings

- 工具空间新增独立“字幕校对台”，不再把时间轴编辑塞进已经密集的 FFmpeg 转换页；侧栏二级入口、Ctrl+K 搜索、工具目录和实验室替代流程均可直达。
- 支持导入或粘贴 SRT / WebVTT，保留多行正文并识别 BOM、CRLF、VTT cue identifier 与时间设置；无法识别的块、时间重叠和 20,000 条截断都会明确提示。
- 时间轴支持正文搜索、毫秒级整体平移、逐条起止时间与正文校对、SRT ↔ VTT 导出；整体向前触及零点时使用同一个有效偏移量，不压缩字幕间距。
- 字幕行右键或 `Shift+F10` 可拆分、与下一条合并、在后面插入、复制正文和删除；菜单跳过禁用项并支持方向键与 Esc。
- 未导出的修改在工具栏和编辑器中同时显示；重新导入、路由离开和窗口刷新均有保护，离开弹窗复用文档与单词的三向决策组件。
- 字幕数组使用 `shallowRef`，列表采用固定 76 px 行高虚拟窗口与 `v-memo`；单次输入限制 5 MB / 20,000 条，页面不会一次挂载整份长字幕。
- `ui-ux-pro-max` 的首屏任务可见、渐进披露、非颜色状态、键盘焦点和浅层大对象建议被采用；首版过高的展示区经 1280 × 720 验收后压缩，使“解析粘贴内容”无需滚动即可使用。

### Verification

- 1280 × 720 开发版空状态实测：“选择 SRT / VTT”“新建空白字幕”、源码输入、SRT / WebVTT 切换与“解析粘贴内容”均在首屏可见。
- 载入 5 条真实 SRT 样本后，时间轴、搜索、整体平移、格式导出和右侧 cue editor 完整显示；第三条右键菜单包含拆分、合并、插入、复制和删除。
- 执行拆分后从 5 条变为 6 条，并显示“有未导出修改”；尝试前往设置时共享未保存弹窗成功拦截，选择“继续编辑”保留现场。
- `pnpm test`：73 个测试文件、301 项全部通过；`pnpm build`：4,590 个模块通过；Rust：49 项通过、3 项环境测试忽略。
- `pnpm check:public`、`vue-tsc -b` 与 `git diff --check` 通过；新增页面独立异步分块约 18.69 KB（gzip 7.86 KB）。

final result: passed

## Ctrl+K 统一本地搜索与剪贴板深链接（2026-08-10）

### Findings

- 顶栏入口由“搜索工具或操作”明确改为“搜索全部”；Ctrl+K 现在除空间、工具、笔记/题目/单词、画布外，还检索资料库轻量元数据与已水合的剪贴板摘要。
- 资料搜索只读取名称、MIME 与标签，不唤醒 PDF、图片或代码原件；剪贴板搜索只读取最多 12,000 字符的已有预览，复制时才按需解析完整内容。
- 每类即时结果最多 6 条，Vault FTS 保持 150 ms 防抖与异步序列门，画布目录仍按需载入；新增数据不会把二进制或深层响应对象带入命令面板。
- 资料搜索结果支持右键或 `Shift+F10` 打开、收藏、复制名称与查看同类；剪贴板结果深链接到精确记录，将目标置顶、滚动到视口并获得键盘焦点，随后可使用页面完整右键菜单。
- 修复剪贴板列表已有记录时仍同时渲染空状态的问题：列表和“加载更多”现在位于同一条件分支，空状态只在过滤结果确实为空时出现。
- 设置页与创作空间移除了“公式图片识别尚未接入”的过时描述，并提供明确的识别入口。
- `ui-ux-pro-max` 的“搜索即主操作”、无结果恢复建议、键盘焦点与浅层有界列表建议被采用；蓝色营销色板、在线手写字体与 Marketplace 首屏不适合现有暖纸/深绿桌面系统，未采用。

### Verification

- 1280 × 720 开发版：创建临时常用片段后，Ctrl+K 显示“剪贴板历史”分类和 1 个结果；点击后 URL 携带精确 item ID，目标卡片置顶、描边并获得焦点。
- 目标卡片右键菜单包含重新复制、整理为 Markdown 笔记、移出常用片段和删除；删除后临时样本已清理，页面只在真实零记录时显示空状态。
- `pnpm test`：75 个测试文件、312 项全部通过；`pnpm build`：4,592 个模块通过；`pnpm check:public` 与 `git diff --check` 通过。

final result: passed
## 结构化题目批量导入（2026-08-10）

- 入口：题目页标题栏、列表底部、空状态、知识库 / 复习空间与 `Ctrl+K` 都可直接打开；“新建错题”的 `＋` 支持右键或 `Shift+F10` 进入批量收集。
- 解析：CSV、TSV、TXT 在独立 Worker 中处理，单次限制 1 MB / 2,000 道；支持带换行和逗号的引号单元格，只挂载前 10 条预览。
- 结构：题干、答案、解析、错误做法、错因、学科、题型、难度、知识点与错误类型直接进入现有结构化题目模型，不把一整行伪装成 Markdown。
- 安全：默认按标题 + 完整题干跳过重复题，不覆盖已有 FSRS；Rust 在写入前验证全部 ID 和类型，SQLite 中的实体、题目字段、FTS、版本与复习卡在单个事务中提交，失败会清理未引用的新 Markdown 文件。
- 桌面交互：预览行支持右键 / `Shift+F10`，菜单首项自动聚焦并支持方向键；弹窗具备焦点循环、Esc 放弃确认和 `Ctrl+Enter` 提交。
- 视觉 QA：1394 × 1272 桌面视口中弹窗为 1120 × 613，无横向溢出或内部截断；正文 / 暖纸张对比度 13.91:1，次要文字 5.14:1；测试题只做解析预览，没有写入用户题库。
- 最终回归：前端 77 个测试文件 / 324 项测试、Rust 55 项通过 / 3 项忽略、4600 模块生产构建与 Public Core 检查均通过。

## Markdown 本地文档统计状态栏（2026-08-10）

- Markdown 编辑器新增固定 30 px 的桌面状态栏，默认只展示格式、当前模式、字符数、行数与预计阅读时间，不挤占标题栏，也不需要离开文档进入文本工具。
- 点击统计区域会在右下角展开字符、中英文、段落、标题、源码行、代码行和预计阅读时长；暖白不透明表面配深灰绿正文，状态栏实际文字颜色为 `rgb(88, 106, 97)`，没有横向溢出。
- 右键或 `Shift+F10` 可打开“查看完整统计、复制统计摘要、立即重新统计”；首项自动聚焦，`End` 可到最后一项，`Esc` 关闭后焦点返回统计按钮。
- 统计在独立 Worker 中以 220–520 ms 分级防抖执行；Vue 监听文档 ID 与正文两个原始源，不拼接或深度遍历 1–5 MB Markdown。切换文档和过期 Worker 响应均由请求序号隔离。
- 1394 × 1272 桌面视口实测：状态栏宽 840 px、高 30 px；详情面板 420 × 277 px，完整位于视口；页面 `scrollWidth === clientWidth`。
- `ui-ux-pro-max` 的渐进披露、键盘可达、明确焦点、减少动态与浅层大对象状态建议被采用；企业门户、蓝色 CTA、Caveat / Quicksand 在线字体不符合 Knitspace 暖纸/深绿本地工作台，未采用。
- 最终回归：79 个前端测试文件 / 333 项测试、1 / 3 / 5 MB Markdown 性能门槛、4601 模块生产构建和 Public Core 检查全部通过；统计 Worker 独立分块 0.98 kB，仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Windows Markdown 文件关联与单实例接管（2026-08-10）

- NSIS 安装包声明 `.md`、`.mdx`、`.markdown`、`.mkd` 为 Knitspace 可编辑文档；继续复用现有外部 Markdown 读取、监听、冲突检测和保存逻辑，没有复制第二套编辑器。
- `tauri-plugin-single-instance` 在其他插件前注册。冷启动命令行和应用已运行时的第二实例参数都会规范化、验证扩展名与文件存在性、去重并限制为最多 8 个；无文件参数的第二次启动也会显示、还原并聚焦主窗口。
- Rust 只把受支持的真实文件存进有界内存队列；前端通过一次性命令取走，再使用短期 `markdown` handoff 跳转。路由仅含 `handoff=desktop-markdown` 与递增请求号，不携带绝对路径，也不写入 `localStorage` 或 Pinia。
- 文档页消费 handoff 后立即清理路由标记，逐个复用 `openExternalMarkdownPath`；遇到未保存编辑时沿用现有三向切换保护，用户取消后不会继续打开剩余文件。
- 真实原生验证：携带第一个 Markdown 参数冷启动后，SQLite 中出现带外部文件元数据的关联笔记；应用已运行时携带第二个 Markdown 再次启动，系统始终只有 1 个 `toolknit.exe`，第二条关联笔记由原窗口写入。两条 QA 记录和对应 Vault Markdown 已在验证后精确删除，其他资料未改动。
- 当前 Windows 会话处于锁屏，GDI 截图只能得到锁屏/黑帧，因此没有把无效截图当作视觉通过证据；页面视觉沿用此前 1256 × 829 原生编辑器验收，本轮证明的是安装包与进程级工作流。
- 回归：Rust 56 项通过、3 项真实环境测试忽略；前端 80 个测试文件 / 339 项通过；4,601 模块生产构建与 335 文件 Public Core 检查通过。Debug NSIS 实际打包成功，生成约 11.2 MB 的 `Knitspace_0.1.0_x64-setup.exe`，Tauri 在打包阶段接受并写入文件关联配置。仅保留既有 Mermaid / Cynefin 大分块提示和 Rust 链接器信息提示。

final result: passed

## 原生最小窗口布局回归（2026-08-10）

- 使用同源 900 × 680 iframe 复现 Tauri 的真实最小 CSS 视口，逐页检查今天、知识、创作、复习、工具、Markdown、单词、图片表达、代码分享和设置。
- 根因是 `html, body, #app` 仍保留 980px 最小宽度，同时后加载的 1180px Knitspace 规则把 1050px 紧凑导航重新覆盖为 214px；900px 文档因此被稳定撑成 980px，不是单个页面偶发溢出。
- 根画布现允许收缩到原生窗口，且在 1050px 以下最终应用 76px 图标导航。900 × 680 实测中十个核心路由均满足 `scrollWidth === clientWidth === 900`，知识、工具、创作、文档、单词与图片工作区的主操作仍可见。
- 代码分享页唯一超出视口的元素是位于 `-9999px` 附近的离屏导出副本，它不参与用户可见布局；没有把该预渲染节点误判成页面溢出。
- 新增桌面布局契约测试，锁定 Tauri 900 × 680 下限、根画布 `min-width: 0` 与紧凑导航覆盖顺序，防止后续主题样式再次破坏原生最小窗口。
- `ui-ux-pro-max` 的固定侧栏可用宽度、断点验收和防裁切建议被采用；FAQ 落地页、夸张极简、蓝色 CTA 与在线 Caveat / Quicksand 字体不适合暖纸/深绿本地工作台，未采用。
- 回归：83 个前端测试文件 / 348 项通过；4,602 模块生产构建、129.63 KiB 首屏 gzip 预算与 340 文件 Public Core 检查通过；`git diff --check` 仅输出工作区既有 CRLF 转换提示，退出码为 0。

final result: passed

## 收集与归档工作流暴露（2026-08-10）

- 将早期“导入按钮 + 空白双栏”重组为本地资料库概览、轻量收件入口、五项固定可见工作流和资料主从视图；标注图片、离线 OCR、公式草稿、连续代码长图与错题关联不再依赖用户先选中文件才能发现。
- 工作流卡复用 `toolActions` 的接受类型作为唯一兼容规则：当前资料兼容时直接进入原有真实流程；不兼容时只切换资料筛选并定位可用资料，不会擅自创建错题或生成输出；空库会明确说明所需文件类型。
- 保留资料列表的固定行高虚拟窗口、`v-memo`、140 ms 搜索防抖和 SourceCanvas 异步加载。新增的四类计数仅遍历资料元数据，不读取 PDF、图片或代码正文；构建产物中 SourceCanvas 仍为独立异步分块。
- 资料行原有右键 / `Shift+F10` 菜单继续提供预览、收藏、最近使用、Vault 路径、文件夹定位和按类型处理；新工作流只改善入口，不复制第二套处理实现。
- 1280 × 720 与同源 900 × 680 桌面预览通过；最小窗口 `clientWidth === scrollWidth === 900`，五张工作流卡均可见，可见辅助文字无低于 9px 的项目。空库点击“识别文字”得到正确图片导入引导，未写入真实用户资料。
- `ui-ux-pro-max` 的任务可发现性、明确焦点、按需加载和防横向滚动建议被采用；竞品比较页、蓝色 CTA、在线 Caveat / Quicksand 字体与当前暖纸/深绿本地桌面系统不一致，未采用。
- 回归：83 个测试文件 / 348 项通过；4,604 模块生产构建、129.65 KiB 首屏 gzip 预算与 340 文件 Public Core 检查通过；`git diff --check` 退出码为 0。

final result: passed

## 可筛选 FSRS 复习与单词编辑热路径（2026-08-10）

- 复习页新增“全部到期 / 题目与错题 / 单词卡”三种本轮队列，计数固定显示在首屏，并通过 `?kind=question`、`?kind=word` 形成可恢复深链；切换只重置本轮索引、暂缓项与撤销状态，已经提交到 FSRS 的评分不回滚。
- 队列先合并并按到期时间排序一次，再按当前类型过滤；题目/单词数量使用单次遍历统计。单词库移除对完整词条的 `deep + flush: sync` 监听，改由编辑器输入/变更事件与新增、删除词义动作标记脏状态，避免多词义词条每次按键都深度遍历整棵对象。
- 复习卡原有右键 / `Shift+F10` 菜单、首项聚焦、翻面、1–4 评分、暂缓和撤销保留；实测题目卡右键菜单包含题库定位、Markdown 复制、暂缓和继续复习，首项自动获得焦点。
- 1280 × 720 与 900 × 680 桌面预览通过；最小窗口三种队列均可见，`clientWidth === scrollWidth === 900`。修复卡片总数旧样式 7.5px 后，可见辅助文字均不低于 9px。
- 空单词队列显示完成状态而非空白；单词输入实测立即进入“未保存修改”，测试词条通过应用确认流程精确删除，没有遗留 QA 数据。
- `ui-ux-pro-max` 的进度反馈、空状态下一步、深链、键盘焦点与缓存派生状态建议被采用；儿童教育靛蓝配色、Baloo / Comic Neue 在线字体和竞品比较页不符合 Knitspace 的大学生本地工作台定位，未采用。
- 回归：84 个测试文件 / 351 项通过；4,606 模块生产构建、129.67 KiB 首屏 gzip 预算与 342 文件 Public Core 检查通过。

final result: passed

## Windows 离线 OCR 可读性与结果热路径（2026-08-10）

- 审计剩余 `ToolKnit` 字样后确认它们只用于事件名、存储键、旧备份和内部资源兼容；用户可见产品名继续统一为 Knitspace，没有为改名破坏已有本地数据。
- OCR 顶部工具、快捷键提示、结果状态、来源页脚、结果元数据、字符统计和隐私说明的辅助文字统一提升到至少 9px；暖纸背景、深绿操作色与中文本地字体保持既有桌面视觉体系。
- 增加缓存的 `trimmedText` 派生值，识别提示、字符计数、复制、Markdown 笔记和题目转换复用同一次裁剪结果，避免同一结果在渲染与操作路径中重复执行 `trim()`。
- 来源区右键 / `Shift+F10` 菜单实测可开始离线识别、更换图片、读取剪贴板、在资源管理器查看和移除图片；结果区菜单可复制、存为 Markdown、转成待整理题目和清空，首个可用动作自动获得焦点。
- 1280 × 720 与同源 900 × 680 桌面预览通过；最小窗口 `clientWidth === scrollWidth === 900`，主识别操作仍在首屏可见，扫描后没有低于 9px 的可见辅助文字。
- QA 示例只在 `127.0.0.1:1420/1421` 且显式携带 `?qa=preview` 时启用；编辑示例结果、刷新和右键检查均未写入真实 Vault，临时最小窗口页面与开发服务已移除。
- `ui-ux-pro-max` 的任务可发现性、明确活动状态、键盘可达、按需加载和 `v-memo` 性能建议被采用；竞品比较页、儿童化造型、蓝/青/橙 CTA 与在线 Caveat / Quicksand 字体不符合 Knitspace 的暖纸/深绿本地工作台定位，未采用。
- 回归：84 个测试文件 / 351 项通过；4,606 模块生产构建、129.67 KiB 首屏 gzip 预算与 342 文件 Public Core 检查通过。

final result: passed

## 六任务本机媒体工作台与最小窗口闭环（2026-08-10）

- 媒体输出由四项扩展为六项：除 MP3、M4A、H.264 MP4 与片段截取外，新增面向本机转写的 16 kHz 单声道 PCM WAV，以及移除音轨并生成新 H.264 文件的静音视频；工具目录和 `Ctrl K` 可通过“16khz”“视频静音”等关键词直接深链进入对应任务。
- 独立的媒体操作目录集中维护标题、扩展名、所需轨道、路由恢复、拖放扩展名与输出 MIME。FFprobe 读到轨道后，无音轨文件会禁用 MP3 / M4A / WAV，无视频轨文件会禁用 MP4 / 静音视频；深链与更换文件也会回退到第一项真实可执行任务，不再等 FFmpeg 失败才提示。
- 桌面窗口拖入 MP4、MOV、MKV、MP3、WAV、M4A 等文件会直接读取第一份兼容媒体；监听器在离开页面时注销。媒体仍只传原生文件路径，FFmpeg 后台流式读取，页面不加载大文件字节，既有 220ms 进度事件与 700ms / 2% 任务历史合并策略保持不变。
- 来源右键 / `Shift+F10` 菜单会按真实轨道显示“提取音轨为 MP3、转为语音 WAV、生成静音视频、截取片段、重新读取、打开位置、移除”；输出右键继续提供打开位置、另存和复制路径。两类菜单首项自动聚焦，900 × 680 下来源菜单边界为 250–462 × 339–614，完整留在视口内。
- 1280 × 720 和同源 900 × 680 预览通过。旧 1080px 断点会把输出区推到首屏以下，现改为左侧“输入 + 输出”、右侧六任务的双列闭环；最小窗口 `clientWidth === scrollWidth === 900`，六项任务和生成按钮均可见，扫描不到低于 9px 的可见文字。
- 真实 FFmpeg 冒烟测试生成一秒音视频：新 WAV 为 `pcm_s16le / 16000 Hz / 1 channel`，静音 MP4 只含 H.264 视频轨；三份临时媒体随后按明确路径删除。QA 页面只在 `127.0.0.1:1420/1421` 且携带 `?qa=preview` 时模拟状态，不写 Vault、设置或任务历史，临时 iframe 与开发服务均已清理。
- `ui-ux-pro-max` 的任务可发现性、活动态、键盘焦点、深链、路由分包和大对象 `shallowRef` 建议被采用；竞品对比页、靛蓝学习色、在线 Caveat / Quicksand 字体与“零界面”语音优先模式不符合 Knitspace 的暖纸/深绿本地桌面工作台，未采用。
- 回归：85 个前端测试文件 / 354 项通过；4,607 模块生产构建、129.86 KiB 首屏 gzip 预算与 344 文件 Public Core 检查通过；Rust 57 项通过、3 项真实环境测试忽略。

final result: passed

## 创作空间高频动作直达与图片工作流暴露（2026-08-10）

- 创作空间首屏新增八个固定可见的高频入口：空白 Markdown、思维导图、Mermaid、LaTeX、图片标注、滚动长图、代码长图和 AI 内容；全部复用既有真实路由，不再要求用户先猜测并打开工作流右键菜单。
- 图片工作流右键 / `Shift+F10` 菜单从三项扩展为六项，补齐图片画布、滚动长图、裁剪、压缩与转换、缩放和旋转；其中滚动长图可恢复到 `/visual?tool=stitch`，实测进入后活动工具为“滚动长图识别重叠并连续拼接”。
- 八个入口由独立、可测试的静态目录提供；大型视觉项目集合改用 `shallowRef`，静态入口和工作流卡使用带菜单状态依赖的 `v-memo`，避免无关响应式深层代理与重复渲染，同时保证右键展开态即时更新。
- 1280 桌面预览与同源 900 × 680 最小窗口通过；最小窗口 `clientWidth === scrollWidth === 900`，八个入口和工作流标题均在首屏可见，可见辅助文字无低于 9px 的项目。
- 900 × 680 下图片菜单边界为 626–888 × 277–660，完整留在视口内，首个动作自动聚焦；临时最小窗口页面和 1421 开发服务均已清理，本轮检查未写入 Vault 或用户资料。
- `ui-ux-pro-max` 的任务可发现性、明确焦点、深链、按需加载、`shallowRef` 与 `v-memo` 建议被采用；竞品对比页、营销式蓝/青/橙 CTA、儿童化视觉与在线 Fredoka / Nunito 字体不符合 Knitspace 的暖纸/深绿本地桌面工作台定位，未采用。
- 回归：86 个前端测试文件 / 355 项通过；4,608 模块生产构建、129.85 KiB 首屏 gzip 预算与 346 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 工具空间八任务直达与目录一致性（2026-08-10）

- 工具目录已有 45 项本机能力，但音视频、字幕、OCR、剪贴板和开发任务容易落在前 14 项之后；工具空间现于首屏固定暴露合并 PDF、转换图片格式、离线 OCR、截取音视频、本机语音转写、格式化 JSON、JSON 开发工具和剪贴板历史八项高频任务。
- 直达区不维护第二套标题、描述或路由，只保存八个稳定 ID 并从 `toolCatalog` 解析 canonical metadata；新增契约测试锁定顺序、去重、分组覆盖和路由完整性，避免目录与首屏入口静默漂移。
- 每个直达入口复用工具卡原有使用记录、右键 / `Shift+F10` 菜单、收藏与复制名称能力；OCR 入口菜单实测包含打开、收藏和复制名称，首项自动聚焦。本机语音转写实测进入 `#/subtitles?transcribe=1`，继续复用既有字幕与 Whisper 工作流。
- 1280 × 720 与同源 900 × 680 桌面预览通过；最小窗口 `clientWidth === scrollWidth === 900`，八项入口全部可见，直达区底部为 566.94 px，分类区从 567.60 px 开始，可见辅助文字无低于 9px 的项目。
- 900 × 680 下 OCR 右键菜单边界为 568–806 × 378–546.67，完整留在视口内；临时最小窗口页面、浏览器标签和 1421 开发服务均已清理，本轮未写入 Vault 或用户资料。
- `ui-ux-pro-max` 的搜索优先、任务可发现性、语义元素、键盘可达、明确焦点和 `v-memo` 建议被采用；比较营销页、靛蓝/绿色 CTA 与在线 Caveat / Quicksand 字体不符合 Knitspace 的暖纸/深绿本地工作台定位，未采用。
- 回归：86 个前端测试文件 / 356 项通过；4,608 模块生产构建、129.92 KiB 首屏 gzip 预算与 346 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 长代码截图能力暴露与键盘菜单闭环（2026-08-10）

- 代码分享工作室顶部和预览底部现在始终显示“全文长图”；单页时保持禁用并说明“代码超过一张后自动启用”，不再把核心差异化能力直接从页面移除。说明文案同时明确自动分页、连续长图、安全高度拆分、PNG、PDF 与剪贴板复制边界。
- 预览右键菜单补齐导出全部 PNG 和导出全部为 PDF，连同复制当前图片、加入多选、复制全文连续长图及导出当前 PNG，形成六项可发现操作；多选时继续追加复制所选多图和所选连续长图，不复制已有导出实现。
- 菜单由统一 `clampMenuPosition` 按实际动作数计算高度并夹取到视口，且限制最大高度滚动；修复 `Shift+F10` 继续冒泡到全局空间菜单的问题，键盘触发后代码菜单首项“复制当前图片”稳定获得焦点，Esc 仍返回预览触发器。
- 220 行、包含超长行的 TypeScript QA 示例自动整理为 8 页，全文长图由禁用切换为可用并显示“把全部 8 张合成连续长图”；页面选择条、自动字号、长行折行与现有有界高亮 / PNG 缓存保持工作。
- 1280 × 720 与同源 900 × 680 桌面预览通过；最小窗口 `clientWidth === scrollWidth === 900`，编辑器与图片预览保持双栏，顶部 PNG / PDF / 全文长图 / 复制按钮、8 页选择条和底部操作均可见，可见辅助文字无低于 9px 的项目。
- 900 × 680 下六项代码菜单边界为 634–850 × 388–659.17，完整留在视口内；1280 × 720 下为 959–1175 × 412–683.17。菜单、设置展开态从残留蓝色改回 Knitspace 深绿焦点与暖纸背景。
- 大代码布局和长图高度估算不再用 `[...line]` 为每一行分配码点数组，改为无中间数组的 Unicode 码点计数；新增 10,000 行中英文与 Emoji 契约测试，验证行数、分页总数和源码逐字重组一致。布局仍在独立 Worker 中执行，CodeMirror、180 ms 预览防抖、串行截图和有界缓存不变。
- QA 只运行在 `127.0.0.1:1421` 浏览器域，没有调用桌面 Vault；临时 900 × 680 页面、浏览器标签和 Vite 进程已清理。
- `ui-ux-pro-max` 的长内容处理、能力可发现性、键盘顺序、清晰焦点、路由分包和大对象浅响应建议被采用；营销 Hero、鲜艳块状深色界面、绿色 CTA 与在线 JetBrains Mono / IBM Plex Sans 不符合现有暖纸/深绿本地桌面系统，未采用。
- 回归：86 个前端测试文件 / 357 项通过；4,608 模块生产构建、129.97 KiB 首屏 gzip 预算与 346 文件 Public Core 检查通过；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Typora 式 Markdown 菜单深链与 Worker 热路径（2026-08-10）

- Markdown 编辑器原有右键菜单已经覆盖剪切/复制/粘贴、八项行内格式、代码块语言、插入、常用工具、学习工具与文档操作；本轮保留这套贴近 Typora 的信息架构，没有另造一套菜单。
- 修复“交给 AI 改写 / 提炼选区要点”仍跳转已退役 `/ai-studio` 的问题，现统一进入 `/ai?action=rewrite|summarize`；深链由独立 canonical helper 管理，并通过路由契约测试确认目标页真实存在。
- 复制 Markdown 继续直接使用原始选区；复制为 HTML 或纯文本改为按需加载 Markdown 导出 Worker，在 Worker 中完成解析，再于主线程做最小 DOM 文本提取。打开菜单仍不扫描或渲染选区，避免长文档右键时阻塞界面。
- 1280 × 720 下根菜单边界为 917–1153 × 304–672，文档操作子菜单为 668.67–926.67 × 411–671.33；900 × 680 下根菜单为 603–839 × 264–632，文档操作子菜单为 354.67–612.67 × 371–631.33，均完整留在视口内且无水平溢出。
- 鼠标右键、`Shift+F10`、`End`、方向键进入子菜单和自动聚焦均通过；根菜单首项稳定聚焦“剪切选中文字”，子菜单首项稳定聚焦“在当前文档中查找”，菜单内快捷键与代码标签均不低于 9px。
- AI 改写实测进入 `#/ai?action=rewrite`，选区内容完整传入；两份浏览器域 QA 笔记均通过应用自己的文档右键菜单删除，没有写入桌面 Vault。临时最小窗口页面、浏览器标签与 1421 Vite 进程均已清理。
- `ui-ux-pro-max` 的键盘顺序、明确焦点、异步反馈、按需加载与长内容性能建议被采用；企业网关式布局、酒红/金色鲜艳块、营销页面和在线 Playfair Display / Karla 字体不符合 Knitspace 的暖纸/深绿本地桌面定位，未采用。
- 回归：87 个前端测试文件 / 358 项通过；4,609 模块生产构建、129.95 KiB 首屏 gzip 预算与 348 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 知识空间八任务直达、分类右键与本机 Markdown 深链（2026-08-11）

- 知识空间首屏新增八个固定可见的真实任务：新建 Markdown、打开本机 Markdown、记录错题、批量导入题目、录入结构化单词、批量导入词表、收进资料和复习到期内容；不再要求用户先滚到右侧“快速开始”或进入目标页寻找按钮。
- 八个入口由独立 canonical 目录统一维护；四张分类卡的右键 / `Shift+F10` 菜单复用同一目录，并各自补充浏览动作，避免页面任务条、右键菜单与 Ctrl+K 形成三套会漂移的路由元数据。
- “打开本机 Markdown”现通过 `/documents?kind=note&action=open-file` 调用桌面文件选择器，消费后立即清除 action 参数，保持标准 `.md` 外部文件流程；“录入新单词”通过 `/words?action=create` 创建结构化词条并同样清除 action，避免刷新或返回时重复执行。
- 1280 × 720 下八项任务全部位于 490.19–605.69 px；900 × 680 下位于 568.35–679.35 px，`clientWidth === scrollWidth === 900`，全部任务进入最小窗口视口且可见文字无低于 9px 的项目。
- 900 × 680 下最右侧“资料与摘录”分类菜单边界为 620–888 × 379–588，完整留在视口内，首项“浏览资料与摘录”自动聚焦；鼠标右键、`Shift+F10`、Esc 返回焦点与方向键循环均沿用统一桌面菜单协议。
- 两个深链均在浏览器域真实执行：本机 Markdown action 被消费为 `#/documents?kind=note`；新单词 action 被消费为带 word ID 的稳定详情路由。测试生成的临时 `new word` 已通过应用自己的单词右键菜单与确认框删除，没有写入桌面 Vault。
- 顺带修复 Markdown 预览多根组件无法继承父级 class 的 Vue 警告，非声明属性现在明确落在文章根节点；修复后重新打开文档页，控制台无应用 warning / error。
- `ui-ux-pro-max` 的能力可发现性、文字与图标双重提示、统一层级、键盘焦点、路由懒加载、静态目录和 `v-memo` 建议被采用；营销比较页、蓝色 CTA 与在线 Caveat / Quicksand 字体不符合 Knitspace 暖纸/深绿本地桌面定位，未采用。
- 回归：88 个前端测试文件 / 361 项通过；4,610 模块生产构建、130.12 KiB 首屏 gzip 预算与 350 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 复习空间材料直达、空状态语义与键盘菜单隔离（2026-08-11）

- 复习页在筛选与当前卡片之间新增六个固定可见的材料任务：记录错题、批量导入题目、管理题目卡、录入结构化单词、批量导入词表和管理单词卡；用户不再需要先结束复习或滚到页面底部寻找材料入口。
- 六项任务由独立 canonical 目录维护，题目与单词各三项，并补入复习空间导航所有权；它们只负责维护复习材料，不重复“全部 / 题目 / 单词”三个本轮筛选，避免两套概念混在一起。
- 无当前卡片时不再一律显示“今天已完成”：现在区分本轮完成、当前筛选为空、没有任何材料、材料存在但未启用卡片，以及卡片尚未到期五种状态；每种状态都说明原因并提供匹配的恢复动作，下次复习时间转换为分钟、小时或本地日期。
- 复习调度摘要用单次循环只返回卡片总数与最近到期时间，不建立大型派生数组；到期队列直接使用 Store 已提供的 `review` 状态排序，不再为每张卡重复查找 facet，Markdown 渲染仍只在题目卡实际出现时异步加载。
- 1280 × 720 下六项任务位于 261.45–360.45 px，当前卡从 374.11 px 开始；900 × 680 下任务位于 227.98–326.98 px，当前卡从 340.65 px 开始，`clientWidth === scrollWidth === 900`，全部入口可见且辅助文字不低于 9px。
- 900 × 680 下复习卡菜单边界为 120–336 × 167–349，完整留在视口内，首项“在题库中打开”自动聚焦。QA 发现并修复 `Shift+F10` 同时打开复习菜单和全局空间菜单的问题：菜单键现由卡片本身拦截并停止冒泡，复查时复习菜单为 1、全局菜单为 0。
- “单词卡”筛选为空时实测显示“其他类型还有 1 张到期内容”，点击后能恢复全部队列；五种空状态和下次到期文案另有纯函数契约测试。浏览器域 QA 未评分、创建或删除学习内容，桌面 Vault 未被写入；预览标签和 1421 服务已清理，控制台无应用 warning / error。
- `ui-ux-pro-max` 的空状态引导、明确进度、键盘顺序、可见焦点、稳定 key 和浅派生状态建议被采用；电商评价页、酒红/金色鲜艳块、超大营销间距与在线 Atkinson Hyperlegible 字体不符合 Knitspace 暖纸/深绿学习工作台定位，未采用。
- 回归：90 个前端测试文件 / 365 项通过；4,612 模块生产构建、130.14 KiB 首屏 gzip 预算与 354 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 字幕任务直达、同页深链与长时间轴交互（2026-08-11）

- 字幕校对台顶部新增六个始终可见的真实任务：打开 SRT / WebVTT、粘贴字幕源码、本机语音转写、新建空白字幕、SRT / VTT 互转和整体时间校准；无需先载入文件或理解时间轴，载入后才能执行的两项也会明确显示边界而不是消失。
- 工具空间和 Ctrl+K 补齐打开字幕文件、粘贴字幕源码、新建空白字幕三个入口，并继续保留本机语音转写。`/subtitles?transcribe=1` 现在监听同一组件内的 query 变化，已在字幕页时再次点击也会展开并定位；收起时 URL 恢复为 `#/subtitles`。`action=paste` 同页深链会展开粘贴面板、聚焦源码输入并在消费后清除参数。
- 粘贴源码改为可随时展开的独立面板；解析成功前保留当前时间轴，存在未导出修改时继续二次确认。新建空白字幕在已有内容时也明确确认，避免从任务入口误替换内存草稿。
- 修复切换字幕条目会覆盖右侧尚未应用编辑的问题：选择新条目前先校验并自动应用当前时间、正文草稿；实测把第一条改为“第一条字幕（已自动应用）”后直接选择第二条，第一条内容保留且状态变为“未导出”。
- 长字幕仍最多 20,000 条并使用固定行高虚拟窗口；显示序号改为一次生成原始索引数组，不再让每个可见行执行 `cues.indexOf(cue)` 回扫完整集合。时间轴新增 ↑ / ↓、PageUp / PageDown、Home / End 定位，移动后将目标滚入视口并恢复焦点。
- `Shift+F10` 在 900 × 680 下打开五项字幕菜单，边界为 504.2–733.8 × 359–579.4，首项“从正文中间拆分”自动聚焦；字幕菜单为 1、全局空间菜单为 0。方向键实测从第二条移动到第三条，焦点与活动条目一致。
- 1280 × 720 下六项任务位于 306.7–423.7 px；900 × 680 下位于 300.2–417.2 px，`clientWidth === scrollWidth === 900`，任务区最低文字为 9px。浏览器 QA 仅载入三条内存字幕，没有写入 Vault、任务历史或本机文件；标签、视口和 1421 开发服务均已清理，控制台无 warning / error。
- `ui-ux-pro-max` 的纸张式阅读、任务可发现性、深链接、明确焦点、键盘顺序、空状态引导和超过 50 项虚拟化建议被采用；作品集布局、靛蓝学习色、在线 Caveat / Quicksand 字体与鲜艳营销式 CTA 不符合 Knitspace 暖纸/深绿本地桌面定位，未采用。
- 回归：91 个前端测试文件 / 369 项通过；4,613 模块生产构建、130.25 KiB 首屏 gzip 预算与 356 文件 Public Core 检查通过；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 剪贴板深链、批量管理与筛选语义（2026-08-11）

- 工具空间与 Ctrl+K 新增“读取当前剪贴板”“新建常用片段”“常用片段”三个真实入口；`action=create-snippet` 在已经打开剪贴板页时仍会展开编辑器、聚焦输入并立即消费 action，`view=snippets|text|code|image` 与页面活动筛选双向一致。
- 页面增加批量管理模式：支持选择单条、选择当前筛选的全部结果、统一固定或取消固定，以及确认后删除所选。右键 / `Shift+F10` 菜单新增“选择这条记录”，可从既有卡片菜单直接进入批量流程，不增加独立管理页面。
- 单条删除现在也必须确认；图片记录会明确说明临时缓存将被清理、资料库独立副本不受影响。批量删除只在最后统一清理一次失去引用的缓存，避免逐条扫描活动资源路径。
- 有历史记录但图片、代码、文本、常用片段或搜索条件没有命中时，空状态改为“当前筛选没有匹配内容”，并提供清除筛选；不再误报整个剪贴板历史为空。搜索继续使用 160 ms 防抖并显示“筛选中”。
- 数据量上限仍为 500 条，但 DOM 每次只增加 24 张卡片；已有 `content-visibility:auto`、12,000 字符预览边界与完整内容按需读取继续保留。批量集合只维护 ID，切换搜索或筛选时清空，避免保留不可见选择。
- 1280 × 720 下批量选择、三条选择态和确认框均通过；确认框明确显示“删除选中的 3 条记录”，取消后记录完整保留。900 × 680 下工具栏为 768.7 × 102.4，批量栏边界为 96–864.7 × 366.7–455.7，`clientWidth === scrollWidth === 900`，可见文字最低 9px。
- 900 × 680 下剪贴板菜单边界为 668.2–887.8 × 291.5–500.9，五个动作完整留在视口内，首项“取消选择这条记录”自动聚焦；剪贴板菜单为 1、全局菜单为 0。四条浏览器域临时片段最终通过应用自己的批量确认流程删除，桌面 Vault 与系统剪贴板未被访问，标签、视口和 1421 服务均已清理，控制台无 warning / error。
- `ui-ux-pro-max` 的批量操作、分层空状态、确认删除、键盘焦点、悬停反馈和列表窗口建议被采用；夸张极简、巨型留白、青色/橙色营销 CTA 与在线 Lora / Raleway 字体不符合 Knitspace 暖纸/深绿本地桌面定位，未采用。
- 回归：92 个前端测试文件 / 372 项通过；4,614 模块生产构建、130.38 KiB 首屏 gzip 预算与 358 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 处理历史双视图、活动去噪与批量清理（2026-08-11）

- 处理历史从“任务列表 + 页底折叠日志”整理为两个明确视图：处理记录与操作日志。工具空间、侧栏子入口和 `Ctrl+K` 现在都能直达全部处理、失败任务和操作日志，不再要求先进入“今天”或滚到页面底部发现功能。
- `view=activity`、`status`、任务类型、活动类型和搜索词都写回 URL；刷新、同页切换和从全局入口进入都能恢复当前视图。非法 query 会回落到安全默认值，清除筛选会恢复稳定的 `#/history` 或 `#/history?view=activity`。
- 操作日志支持按打开工具、任务、资料、输出、剪贴板、备份和系统筛选，并能点击或用 Enter / Space 回到关联工作流；搜索只匹配用户真正看得见的标题和详情，隐藏路由不再制造看似无关的结果。
- 修复全局活动采集把每次 query 变化都记录成“打开工具”的问题：页面筛选仍执行外壳收尾逻辑，但仅当匹配的工具 ID 真正变化时新增使用记录；命令点击与路由激活在 2 秒内指向同一工具时只保留一条活动。实测连续修改三次日志筛选前后数量保持 58，不再污染时间线或触发多次 SQLite 写入。
- 处理记录新增批量管理：只允许选择已完成、失败或取消的终态任务，执行中与等待中的任务不会进入批量删除；支持全选当前筛选结果、确认后一次持久化删除。单条右键 / `Shift+F10` 菜单新增“选择此记录”，从现有桌面菜单可直接进入批量流程。
- 900 × 760 下页面、工具栏与活动列表边界均为 96–880 px，`clientWidth === scrollWidth === 900`，工具栏高 102.36 px，可见文字最低 9px；1280 × 820 下双视图和 49 条活动列表保持清晰的纸张层级。活动最多 300 条并使用 `content-visibility:auto`，任务列表继续以固定行高虚拟窗口限制 DOM。
- QA 生成一条浏览器域 JSON 文本处理记录；`Shift+F10` 菜单边界为 668–888 × 442.7–688.4，六项动作完整留在视口内，首项自动聚焦。测试发现并修复键盘菜单冒泡后，历史菜单为 1、全局空间菜单为 0；右键选择、删除确认取消、再次确认删除均通过，临时任务最终由应用自身清理，未访问桌面 Vault 或原有用户文件。
- `ui-ux-pro-max` 的 URL 反映状态、深链接、批量操作、危险操作确认、键盘焦点、对比度和 `v-memo` 建议被采用；竞品比较页、蓝色 CTA、在线 Caveat / Quicksand 字体和营销式大留白不符合 Knitspace 暖纸/深绿本地桌面定位，未采用。
- 回归：92 个前端测试文件 / 375 项通过；4,614 模块生产构建、131.25 KiB 首屏 gzip 预算与 358 文件 Public Core 检查通过；控制台无应用 warning / error，仅保留既有大分块提示。

final result: passed

## 私人工具包安全执行、可发现入口与长日志边界（2026-08-11）

- 私人工具空状态改为“准备清单 → 生成预览 → 确认执行”三步引导，并提供选择清单、复制通用模板和脚本历史；工具空间、侧栏子入口与 `Ctrl+K` 补齐加载清单、复制模板和脚本任务历史，不再只在“今天”或已加载页面中暴露能力。
- 清单校验新增 64 个工具、每工具 32 个操作、每操作 48 个字段的结构上限；会修改文件的操作必须提供非空 `previewArguments`，整数范围必须满足最小值不大于最大值，选择项必须非空且唯一。执行期间锁定工具、操作与清单切换，避免结果与当前上下文错配。
- 表单在前端即时检查必填、整数、范围和选择项，并把错误显示在对应字段旁；真实桌面测试发现 `input[type=number]` 会让 Vue 返回 number，旧校验直接调用 `trim()` 导致错误页，现统一规范化为字符串后再生成指纹、任务参数与 Rust 输入，并补回归测试。
- 修改文件工作流实测保持只读预演：预演返回计划路径但临时输出文件不存在；参数从 2 改为 3 后“确认执行”立即锁定，重新预演并经过二次确认后才在隔离目录创建输出。Rust 仍直接传递参数而不做 shell 插值，stdout 只接受单个 JSON 对象。
- 结果区把 512 KB 进程日志安全边界与 120,000 字符界面渲染边界分开：复制仍保留后端返回的完整内容，界面明确提示少渲染的字符数。900 × 680 实测发现堆叠布局会被长日志撑成超长页面，修复后结果面板固定为独立滚动视窗，约 180 KB 日志只在局部滚动，不再扩大整页布局。
- 执行中显示有语义的进度条、停止任务和锁定态；新增 Rust 子进程测试用真实测试进程验证取消标记能终止正在运行的子进程，私人工具测试 6 项通过、1 项辅助进程测试按设计忽略，完整耗时 0.19 秒。
- 工具与结果均支持鼠标右键和 `Shift+F10`：工具菜单含复制标识、复制深链、打开工具、查看该工具全部历史和重载清单；结果菜单含复制完整 JSON、复制完整日志及打开输出。900 × 680 下两类菜单都完整留在窗口内、首项自动聚焦，私人工具菜单为 1、全局空间菜单为 0。
- 真实 Tauri QA 使用独立 `io.github.longtiandragon.toolknit.qa` 标识和 1421 端口，默认 1240 宽度与 900 × 680 最小窗口均通过；修复默认宽度下工作区最小轨道造成的右侧裁切，最小窗口改为工具条、表单和结果纵向堆叠。QA 清单、脚本、输出、日志和 1421 进程均已清理，旧 1420 服务与用户 Vault 未被改动。
- `ui-ux-pro-max` 的渐进披露、危险操作确认、行内校验、URL 状态、键盘可达、进度反馈与长日志窗口建议被采用；竞品比较页、鲜艳深色块、巨大营销间距与在线 JetBrains Mono / IBM Plex Sans 字体不符合 Knitspace 暖纸/深绿本地桌面定位，未采用。
- 回归：93 个前端测试文件 / 378 项通过；4,615 模块生产构建、131.70 KiB 首屏 gzip 预算与 360 文件 Public Core 检查通过；仅保留既有大分块提示。

final result: passed

## 词表批量导入多方向复习卡（2026-08-11）

- 批量词表导入不再只能统一创建“词义”卡；写入前可独立勾选词义、拼写和例句填空三个方向，每个方向直接生成自己的 FSRS 状态，未勾选时仍只导入结构化词条，不会意外塞满今日复习队列。
- 例句填空卡只为确实含例句的词义创建。界面在提交前显示将新增的卡片总数，以及因缺少例句而未创建的数量；实测两条词义全选三个方向得到 5 张卡，并明确提示 1 条缺少例句。
- 合并已有词义时只补充缺失方向，已有到期时间、间隔、重复次数与遗忘次数保持不变；如果本次同时补入例句，可以直接补建例句填空卡。兼容旧调用的布尔参数仍只表示词义卡，不破坏已有导入与备份逻辑。
- 导入完成提示会同时报告新增词条、合并词条、复习卡和跳过行；用户在预览右键菜单中主动排除的行也会计入跳过数量，避免结果摘要与导入前统计不一致。
- 1240 × 760 下原始词表、结构化预览、三方向选择和写入摘要同屏可见；900 × 680 下弹窗边界为 10–890 × 10–670，页面与选项区 `scrollWidth === clientWidth`，长预览进入弹窗内部滚动，底部安全说明和写入按钮仍固定可见。
- 可视 QA 只在浏览器域粘贴两行临时 TSV 并切换复习方向，没有点击导入，因此未写入桌面 Vault 或改变真实复习队列；两种尺寸下控制台均无 warning / error。
- `ui-ux-pro-max` 的渐进披露、提交前摘要、明确选择状态、键盘可达、响应式局部滚动与低干扰反馈建议被采用；营销式卡片、鲜艳 CTA、在线字体和过度动效不符合 Knitspace 暖纸/深绿本地学习工作台定位，未采用。
- 回归：93 个前端测试文件 / 380 项通过；4,615 模块生产构建、131.71 KiB 首屏 gzip 预算与 360 文件 Public Core 检查通过；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 桌面开发服务与独立调试包边界（2026-08-11）

- 复现的 `ERR_CONNECTION_REFUSED` 来自 `tauri dev` 生成的开发壳：它会打开 `devUrl` 并依赖 Vite 热更新服务；直接双击这个开发期进程留下的可执行文件、或先关闭 Vite，WebView 就只能显示本机地址拒绝连接。这不代表正式桌面包“里面装了网页”，而是开发模式仍在等待它的前端调试服务。
- Vite 与 Tauri 的开发地址统一为 `127.0.0.1:1421`，并启用严格端口；新增契约测试同时读取两端配置，防止以后某一端单独改端口再次造成白屏。1420 不再作为标准开发端口。
- 脚本名称明确区分四种用途：`pnpm dev` 只做浏览器预览，`pnpm desktop:dev` 启动带热更新的桌面开发版，`pnpm desktop:package:debug` 生成可独立运行的调试安装包，`pnpm desktop:package` 生成发布安装包。README 同步说明原始开发壳不能脱离开发服务运行。
- `pnpm desktop:package:debug` 已完整执行 `beforeBuildCommand`、前端生产构建、Rust debug 编译和 NSIS 打包；打包完成时 1421 端口没有监听，产物来自 `frontendDist` 嵌入流程，不依赖运行中的 Vite 服务。为保护正式 Vault，本轮没有直接安装或启动到用户身份。
- 独立调试安装包为 `src-tauri/target/debug/bundle/nsis/Knitspace_0.1.0_x64-setup.exe`，大小 11.23 MiB，修改时间 2026-08-11 02:30:24，SHA-256 为 `DC7C35525BCE433A535214C9D0DD97EF2C0DF8EDA0DA1B4E6A6E0754822283EB`。
- 回归：93 个前端测试文件 / 381 项通过；4,615 模块生产构建、131.71 KiB 首屏 gzip 预算与 360 文件 Public Core 检查通过。补丁格式检查通过，仅报告工作区既有 LF / CRLF 提示。

final result: passed

## 资料到来源笔记闭环（2026-08-11）

- 资料库顶部任务带、详情动作区和资料右键 / `Shift+F10` 菜单均新增“整理为来源笔记”，不再要求先记住功能藏在哪个页面；文本资料的右键菜单也补齐代码分享入口。
- 新笔记沿用标准文档数据模型，默认进入“收集箱 / 资料摘记”，保存资料标识、页码和当前选区；笔记中的来源条改用通用的“来源选区 / 回到原资料”，点击可准确返回资料库的对应页。
- Markdown 资料保持正文逐字不变；代码与文本仅在创建时懒加载正文，并使用比源代码最长反引号串更长的围栏，避免长代码破坏 Markdown；图片与 PDF 生成轻量的摘录、理解和待确认骨架。标签去重并限制为 10 个，防止元数据失控。
- 创建错题和公式整理现在也继承当前页与选区，不再静默退回整份资料；创建来源笔记后记录活动，并直接进入双栏编辑预览。
- 1240 × 760 下六个高频任务单行完整显示，卡片宽 153.55 px；900 × 680 下卡片宽约 127.89 px，页面 `clientWidth === scrollWidth`，没有横向溢出。900 宽资料菜单边界为 238–456 × 339–613.67，七项动作完整留在视口内且首项自动聚焦，资料菜单为 1、全局空间菜单为 0。
- 可视 QA 使用独立的 `localhost` 浏览器域和临时剪贴板文本，完成“读取资料 → 右键整理 → 检查来源锚点 → 返回原资料”全链路；没有写入桌面 Vault，控制台无 warning / error，标准 1421 开发服务已停止。
- `ui-ux-pro-max` 的高频入口可发现性、键盘菜单、对比度、懒加载和 `v-memo` 建议被采用；`frontend-design` 用于维持暖纸、深绿、紧凑编辑型桌面界面。营销式对比页、鲜艳色块、在线字体与无意义动效不符合 Knitspace 定位，未采用。
- 回归：94 个前端测试文件 / 386 项通过；4,616 模块生产构建、131.71 KiB 首屏 gzip 预算与 362 文件 Public Core 检查通过。Markdown 性能门禁通过：1 / 3 / 5 MB 冷解析平均 21.5 / 41.5 / 67.2 ms，热预览平均 3.4 / 9.1 / 12 ms；仅保留既有大分块提示。

final result: passed

## Typora 式阅读选区右键与文档路由一致性（2026-08-11）

- 源码编辑区原有的 Typora 式右键菜单保持不变；阅读与分栏预览现在也能对明确选中的文字打开 Knitspace 菜单，不再退回浏览器菜单。菜单提供无格式复制、HTML 代码、代码分享图、常用片段、选区笔记、选区题目、AI 提炼和 AI 改写八项高频工作流。
- 无选区时仍打开文档操作；标题、双链和 Mermaid 的专用菜单继续优先。鼠标右键与 `Shift+F10` 均可使用，`Escape` 恢复预览焦点，方向键沿用统一菜单导航，避免产生另一套不可达交互。
- 预览选区在菜单打开时一次性快照文字与渲染 HTML，后续动作不再扫描整篇 DOM；文字限制 120,000 字符、HTML 限制 360,000 字符，超限时保留原阅读内容并明确提示仅截取本次工具输入，防止巨大文档选区拖慢主线程。
- 真实闭环测试发现并修复新建导航竞态：旧逻辑同时修改编辑模式和路由，模式 watcher 可能用旧文档查询覆盖新文档 ID。现在只由目标路由驱动模式变化，“从选区创建笔记”会稳定进入带真实 `document` ID 的编辑地址。
- 删除当前文档后也会把地址同步到真实回退文档；不再留下指向已删除实体的深链接。隔离 QA 中创建、删除临时笔记后，地址从被删 ID 正确切换到仍存在的原笔记，临时数据最终为 0 条。
- 1280 × 720 桌面预览中菜单为 252 × 332.04 px，边界 910–1162 × 358–690.04，完整留在视口内；首项“复制无格式文字”自动聚焦，选区菜单为 1、文档菜单为 0、全局空间菜单为 0，页面 `clientWidth === scrollWidth === 1280`。视觉保持暖纸、深绿、细边框和紧凑编辑器密度。
- QA 使用仅开发态生效的 `qa=preview-selection` 选区钩子和隔离 `localhost` 浏览器域，没有写入桌面 Vault；生成的三条临时笔记均通过应用自身删除，1421 预览服务已按确切 Vite 进程停止。
- `ui-ux-pro-max` 的键盘可达、明确焦点、错误恢复、边界菜单和大对象限流建议被采用；`frontend-design` 用于延续 Knitspace 的编辑型、纸张式、工业克制视觉。营销比较页、在线 Atkinson 字体、青橙色 CTA 和无意义动效不符合现有产品气质，未采用。
- 回归：95 个前端测试文件 / 389 项通过；4,617 模块生产构建、131.77 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。Markdown 性能门禁通过：1 / 3 / 5 MB 冷解析平均 21 / 39.5 / 66.5 ms，热预览平均 3.4 / 8.4 / 15.1 ms；仅保留既有大分块提示。

final result: passed

## 绘图工作室旋转、图层面板与桌面右键（2026-08-11）

- 标注对象新增向后兼容的旋转字段：方框与文字由 Konva 旋转手柄直接调整，吸附 45° 常用角度；箭头继续用起终点保存方向，旋转后不会引入第二套几何格式。旧项目缺少旋转字段时仍按 0° 读取。
- 画布预览、项目保存和 PNG 导出共用同一几何数据。方框/文字导出前按原点旋转，箭头导出沿转换后的端点绘制，避免预览已旋转但最终图片仍是旧方向。
- 右侧属性栏新增可折叠的标注图层面板，明确显示顶层到后层的顺序、颜色、类型和文字摘要；支持选择、上移、下移及每次 15° 旋转。首批最多挂载 40 行，更多图层按 40 个渐进展开，画布项目原有 500 标注安全上限保持不变。
- 标注右键 / `Shift+F10` 菜单补齐上移一层、下移一层、置于最前和置于最后；已在边界位置的动作会禁用。复制、层级调整、旋转和删除都写入同一不可变撤销历史。
- 1280 × 720 验收中页面 `clientWidth === scrollWidth === 1280`；图层面板为 172 × 207 px，三行标注与旋转控制完整显示。箭头右键菜单为 204 × 239.79 px，边界 1066–1270 × 398–637.79，六项操作完整留在视口内且首项自动聚焦，页面只存在一个标注菜单。
- 实际交互验证箭头右转 15° 后变换框同步更新；右键“上移一层”把顺序从“文字、箭头、方框”变为“箭头、文字、方框”，点击撤销后恢复原顺序。QA 使用仅开发态的 `qa=canvas` 本地图片与三条临时标注，不写入桌面 Vault。
- `ui-ux-pro-max` 的图层可发现性、键盘焦点、无效操作禁用、菜单边界与大列表渐进披露建议被采用；`frontend-design` 用于保持暖纸、深绿、紧凑编辑型桌面气质。视频首屏、鲜艳色块、青橙 CTA 与在线字体不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 391 项通过；4,617 模块生产构建、132.80 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。Konva 画布继续异步拆分为独立 60.36 KiB gzip 分块，仅进入图片表达工作室时加载；仅保留既有大分块提示。

final result: passed

## 外部 Markdown 工作区实时文件树同步（2026-08-11）

- 外部 Markdown 工作区新增 Tauri 原生递归目录监听；在资源管理器、Typora、Git 或其他编辑器中创建、修改、移动和删除内容后，文件树不再依赖手动整树刷新。事件只传递相对路径，隐藏目录会过滤，单批最多保留 64 条并显式标记溢出。
- 前端将 180 ms 内的文件事件合并，只刷新已经展开并完成读取的父目录；折叠、从未访问的目录不会触发磁盘读取。一次刷新最多并行读取 8 个目录，手动同步最多处理 64 个已展开层级，并在删除或移动后清理不可达缓存，避免大资料库造成主线程抖动和缓存持续增长。
- 工作区路径行新增“实时同步 / 连接中 / 手动同步”状态与手动同步按钮；底部明确说明“按需读取 · 变更只刷新已展开层级”。浏览器预览使用开发态假目录，桌面端才启用原生监听，失败时诚实降级为手动同步而不是后台轮询整棵树。
- 根目录现在支持鼠标右键、菜单键和 `Shift+F10`，菜单提供立即同步、新建 Markdown、新建资料夹、在资源管理器查看和更换工作区；首项自动聚焦。文件/目录原有菜单仍提供打开、复制、剪切移动、重命名、定位、刷新、复制路径和回收站，两套菜单打开时互斥。
- 1280 × 720 开发预览中页面 `clientWidth === scrollWidth === 1280`，没有横向溢出；根目录菜单为 244 × 213.33 px，边界 561.33–805.33 × 202–415.33，五项完整留在窗口内。展开测试目录后树项由 4 增至 6，文件菜单首项自动聚焦，根目录键盘菜单也稳定聚焦“立即同步已展开层级”。
- Rust 自动化使用临时嵌套目录真实触发 `notify` 递归监听，并验证相对路径、隐藏目录过滤、去重与 64 条边界；前端单元测试覆盖 Windows 路径归一、只刷新已加载层级和溢出限流。
- `ui-ux-pro-max` 的状态可见、键盘可达、菜单边界、渐进读取和大目录限流建议被采用；`frontend-design` 用于延续暖纸、深绿、本地字体和紧凑桌面编辑器气质。市场目录式卡片、鲜艳大色块、蓝橙 CTA 与在线字体不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 392 项通过；Rust 62 项通过、4 项按设计忽略；4,617 模块生产构建、133.04 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 外部 Markdown 工作区快速打开（2026-08-11）

- 外部工作区增加按文件名与相对路径搜索的“快速打开”，即使父资料夹尚未展开，也能直接定位深层 Markdown；搜索不读取正文、不递归导入工作区，也不把完整目录树放进 Vue 响应式状态。
- 原生扫描通过 Tauri 后台阻塞线程执行，最多检查 25,000 项、最多保存 240 个候选并返回 40 项；隐藏目录、符号链接和非 Markdown 文件会跳过，目录深度限制为 64。结果按文件名精确匹配、前缀、路径包含与路径长度排序。
- 输入防抖为 220 ms，查询带修订号，较慢的旧结果返回后会直接丢弃；中文输入 1 个字即可查找，英文与数字等待 2 个字符，避免大型工作区为每个无意义按键启动扫描。原生监听检测到文件变化时只重跑当前有效查询。
- 搜索结果保留文件名、所在资料夹和轻量大小信息；方向键从输入框进入结果并在列表移动，`Escape` 返回输入框，清除搜索后恢复原文件树和焦点。结果支持鼠标右键、菜单键和 `Shift+F10`，复用文件树的打开、副本、移动、重命名、定位、刷新、复制路径与回收站操作。
- 1280 × 720 开发预览中，未展开“算法与数据结构 / 最短路”即可找到 `Dijkstra.md`；搜索框边界为 257–542.33 × 272.67–306.67，页面 `clientWidth === scrollWidth === 1280`。结果键盘菜单边界为 264–508 × 333.33–654.67，九项操作完整留在窗口内、首项自动聚焦且同时只存在一个菜单。
- 单字“算”直接返回两个深层结果，没有出现英文短查询提示；点击清除后根目录 4 个树项恢复，焦点回到快速打开输入框。QA 只使用开发态假目录，没有读取、写入或索引用户 Vault。
- `ui-ux-pro-max` 的功能可发现性、明确焦点、深层导航、键盘可达、状态文字和大型列表限流建议被采用；`frontend-design` 用于保持暖纸、深绿、本地字体与紧凑编辑器密度。商品评价布局、蓝色 CTA、Caveat / Quicksand 在线字体与营销式卡片不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 394 项通过；Rust 63 项通过、4 项按设计忽略；4,617 模块生产构建、133.46 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 外部 Markdown 双链跨文件导航（2026-08-11）

- 外部工作区打开的 Markdown 现在可直接解析 `[[文件名]]`、`[[相对路径/文件名]]` 与 `[[文件名#标题]]`。Knitspace 内部笔记仍优先；只有当前文档确实位于已选择的外部工作区内时，才启动外部解析，避免普通内部笔记意外跳到磁盘文件。
- 导航只接受去扩展名后的完整文件名或完整相对路径精确匹配，不使用快速打开的模糊结果直接跳转。单个精确结果立即打开；多个同名文件会提示用户右键选择；没有精确结果时保留“新建内部笔记”的恢复路径。
- 双链右键、菜单键和 `Shift+F10` 菜单会异步查找同名文件，展示“打开外部 Markdown + 完整相对路径”两层信息，最多直接呈现 6 项并显式说明其余数量。菜单等待、失败和降级状态可见，异步旧结果会用修订号丢弃。
- 带标题片段的双链打开目标后复用既有路由锚点与滚动逻辑；同名候选选择也保留标题片段。开发 QA 补充深层 Dijkstra、二分边界标题和两个不同目录的“重复标题”，同时修正深层 QA 文件父目录校验。
- 1280 × 720 开发预览中，`[[二分边界#边界条件]]` 成功打开深层文件并显示“边界条件”；`[[重复标题]]` 右键菜单为 300 × 172.5 px，边界 944–1244 × 348–520.5，完全位于视口内且页面无横向溢出。首个候选自动聚焦，`Shift+F10` 同样打开菜单；选择“英语学习/重复标题.md”后正文确认为英语目录版本。
- `ui-ux-pro-max` 的明确焦点、同名选择、错误恢复、键盘可达、菜单边界和渐进披露建议被采用；`frontend-design` 用于延续暖纸、深绿、本地字体与紧凑桌面编辑器气质。营销型比较表、酒红金色主题和在线字体不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 396 项通过；Rust 63 项通过、4 项按设计忽略；4,617 模块生产构建、133.81 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 外部 Markdown 正文搜索（2026-08-11）

- 外部工作区搜索新增“名称 / 正文”显式范围切换；名称模式继续只扫路径用于快速打开，正文模式在 Tauri 后台线程读取 Markdown，返回文件名、相对目录、首个命中行号与最多 180 字符的摘要。多关键词允许分布在路径和正文中，隐藏目录、符号链接与非 Markdown 文件仍会跳过。
- 正文模式最多检查 5,000 个 Markdown、单文件最多读取 2 MiB、单次累计最多 64 MiB、最多保留 120 个候选并向页面返回 40 项。界面显示实际文件数、读取量和跳过的大文件；达到文件数、字节或结果上限时明确提示继续补充关键词，不会把扫描范围伪装成完整索引。
- 中文正文至少输入 2 个字符、其他文字至少 3 个字符，输入防抖增至 320 ms。正文磁盘任务采用单次串行扫描：当前任务执行时只记录最新查询，结束后再运行最新一次，避免停顿输入时多个 64 MiB 扫描并发争用磁盘；旧结果继续用修订号丢弃。
- 正文结果使用 59 px 三层信息密度展示文件、路径/行号和两行摘要，保留方向键、`Escape`、Home/End、右键、菜单键与 `Shift+F10`；右键继续复用打开、副本、移动、重命名、定位、刷新、复制路径和回收站操作。
- 1280 × 720 开发预览中，“松弛操作”只在正文范围找到 `Dijkstra.md` 第 5 行，底部显示“正文 · 7 个文件 / 0.1 MiB”；切换回名称范围得到 0 项，再切回正文仍恢复 1 项。页面 `clientWidth === scrollWidth === 1280`，结果行为 292 × 59 px；右键菜单为 244 × 321.33 px，边界 392–636 × 354–675.33，完整位于视口内且首项自动聚焦。
- Rust 临时目录测试真实创建嵌套 Markdown、隐藏目录、非 Markdown 与超过 2 MiB 的文件，验证递归命中、行号摘要、隐藏过滤、大文件跳过和累计字节边界。浏览器 QA 只使用开发态假目录，没有打开文件或写入桌面 Vault。
- `ui-ux-pro-max` 的范围可见、键盘焦点、结果渐进披露、状态反馈与输入性能建议被采用；`frontend-design` 用于保持暖纸、深绿、本地字体和紧凑桌面编辑器气质。企业门户布局、酒红金色主题与在线字体不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 397 项通过；Rust 64 项通过、4 项按设计忽略；4,617 模块生产构建、134.06 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 外部 Markdown 正文命中定位（2026-08-11）

- 正文搜索结果现在是完整的“查找 → 打开 → 定位”闭环：点击结果会进入轻量源码模式、把命中行居中显示，并选中该行中完整查询或最长可见关键词；普通文件名结果仍维持原来的打开行为。
- 行号与查询在组件边界前完成有限数值校正和 160 字符截断；目标通过一次性待处理状态交给 CodeMirror，不进入 URL，也不再次扫描全文。已有文档、首次关联文档和编辑器异步挂载使用同一流程，定位完成后立即释放目标。
- 搜索结果提示改为“点击打开并定位到第 N 行”；右键、菜单键和 `Shift+F10` 的首项同步改为“打开并定位到第 N 行”，不再出现右键打开后丢失行号的分叉行为。定位后使用现有本地通知反馈，不增加动画或持续高亮。
- 1280 × 720 开发预览中，“松弛操作”点击后稳定进入 `mode=edit`，CodeMirror 活动行为 `## 松弛操作`，浏览器选区为“松弛操作”，页面横向溢出为 0。键盘菜单为 244 × 321.33 px，边界 264–508 × 354–675.33，完整留在视口内且首项自动聚焦；执行菜单动作后仍选中同一命中内容。
- 可视 QA 使用开发态外部工作区假目录；打开产生的 `Dijkstra` 临时关联笔记已通过应用自身“删除文档”流程清理，外部假文件未改动。
- `ui-ux-pro-max` 的结果可预期性、可见焦点、键盘可达、无死路与 reduced-motion 建议被采用；`frontend-design` 用于延续暖纸、深绿、本地字体与紧凑编辑器气质。市场目录布局、酒红金色主题、在线字体和无意义动效不符合 Knitspace 定位，未采用。
- 回归：95 个前端测试文件 / 399 项通过；Rust 64 项通过、4 项按设计忽略；4,617 模块生产构建、134.07 KiB 首屏 gzip 预算与 364 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 本地图片导入（2026-08-11）

- Markdown 编辑工具栏把原来只面向剪贴板的按钮升级为直接可见的“本地图片”；源码编辑区的 Typora 式右键“插入”子菜单同时提供“本地图片…”与“剪贴板图片”，鼠标、菜单键和 `Shift+F10` 均可到达，不再要求用户先把文件转进剪贴板。
- 文件选择器支持 PNG、JPG、GIF、WebP、BMP、AVIF 与 ICO，一次最多接收 12 张；重复路径、非图片扩展名和超出本次数量的项目在前端边界剔除。生成的 Markdown 使用原文件名作为经过清理的 alt 文本，不暴露完整本机路径。
- 内部笔记把原始编码复制到当前文档的 `assets/documents/<document-id>`，并登记到 SQLite 附件表；外部 Markdown 把资源复制到同级 `assets`，保持与 Typora、Obsidian 可携带。两侧都以原始文件 SHA-256 命名和去重，GIF/WebP 等不会因导入而丢失动图编码。
- 图片复制、哈希和尺寸读取全部留在 Rust 端，字节不进入 Vue 响应式状态；单文件限制 12 MB、2400 万像素，并验证实际图片尺寸，空文件、伪图片和异常尺寸会拒绝。多图按顺序串行落盘，页面切换时停止继续导入，避免并发大图争抢内存和磁盘。
- 1280 × 720 开发预览中工具栏“本地图片”完整可见；`Shift+F10 → 插入` 后主菜单为 236 × 368 px、边界 572–808 × 304–672，插入子菜单为 258 × 260.33 px、边界 798.33–1056.33 × 331.33–591.67，七项完整留在视口内，页面横向溢出为 0。QA 临时笔记已通过应用自身删除。
- Rust 测试真实写入 2 × 1 PNG，验证 Vault 与外部 Markdown 两种目录策略、原始字节保持、重复导入幂等、附件登记和伪图片拒绝；`ui-ux-pro-max` 的高频功能显式暴露、键盘可达、反馈与输入限流建议被采用，`frontend-design` 用于延续暖纸、深绿和紧凑编辑器视觉。
- 回归：96 个前端测试文件 / 401 项通过；Rust 66 项通过、4 项按设计忽略；4,618 模块生产构建、134.10 KiB 首屏 gzip 预算与 366 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 图片拖入编辑器（2026-08-11）

- 源码与分屏模式的 Markdown 编辑栏现在可直接接收 Windows 文件拖放；松手前显示“插入鼠标位置 · 原文件不会移动”，落下后复用“本地图片”相同的格式、数量、尺寸、复制目录与哈希去重边界，不新增旁路文件权限。
- 拖放命中只覆盖 CodeMirror 源码栏：分屏右侧阅读预览、文档列表和其他工具页不会误接收。Tauri 的物理像素坐标按窗口缩放倍率转换为 CSS 坐标，松手时把光标移动到实际落点再插入 Markdown。
- `enter / over` 事件只保留轻量路径列表，Vue 使用 `shallowRef` 保存两项提示状态；高频 `over` 合并到每个动画帧至多一次，拖离、切换文档、切换模式和组件卸载都会取消帧并释放原生监听，避免给大文档编辑持续增加布局读取。
- 非图片文件会静默忽略；支持图片仍沿用一次最多 12 张的顺序导入，超出数量或混入不支持格式时在提示中显示跳过数量。工具栏与 Typora 式右键菜单继续作为完整键盘等价入口。
- 1280 × 720 开发预览中，拖放提示完整限制在源码栏内，未覆盖格式工具栏、文档状态栏或分屏预览；暖白半透明纸张、深绿虚线边界和本地字体与现有编辑器一致。QA 临时笔记已通过应用自身删除。
- `ui-ux-pro-max` 的状态可见、键盘等价、reduced-motion、监听清理与 Vue 浅响应建议被采用；`frontend-design` 用于保持暖纸、深绿和紧凑桌面编辑器视觉。营销页高饱和块面、酒红金色主题和在线字体不符合 Knitspace 定位，未采用。
- 回归：96 个前端测试文件 / 402 项通过；Rust 66 项通过、4 项按设计忽略；4,618 模块生产构建、134.45 KiB 首屏 gzip 预算与 366 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 阅读图片右键与大图查看（2026-08-11）

- 阅读与分屏预览中的非链接图片现在可点击或按 `Enter` 查看大图，也可通过鼠标右键、菜单键或 `Shift+F10` 打开图片操作；菜单直接暴露“查看大图、复制当前画面、复制 Markdown 引用、在图片工作室打开”，形成“导入 → 阅读 → 继续处理”的桌面闭环。
- 菜单显示图片原始像素并自动约束在窗口内；链接图片继续保留链接行为，正文选择和既有 Mermaid 右键逻辑不受影响。菜单首项自动聚焦，方向键、Home/End 与 Escape 可用，层级 160 高于既有 AI 悬浮按钮但低于大图弹层。
- 大图查看使用深绿沉浸背景与暖白工具条，支持“适应窗口 / 100%”、`0` 切换、Escape 或点击背景关闭；打开后聚焦关闭按钮，Tab/Shift+Tab 限定在查看控件内，关闭后恢复原图片焦点。窄窗口与 `prefers-reduced-motion` 均有独立处理。
- 图片仍按原有 IntersectionObserver 策略懒加载，不建立新的常驻位图缓存。只有用户明确选择复制时才创建画布，限制 2,400 万像素并复用系统 PNG 剪贴板；只有明确选择编辑时才读取当前图片，限制 32 MB，生成不含本机路径的临时文件并在未保存确认完成后送入图片工作室。
- 1280 × 720 开发预览中，右键菜单四项完整位于视口内，`Shift+F10` 可打开且首项获得焦点，修正了底部操作被悬浮 AI 按钮遮挡的问题；大图弹层布局完整。端到端验证图片工作室显示“1 张已载入”，QA 临时笔记随后已通过应用自身删除。
- `ui-ux-pro-max` 的高频操作显式暴露、键盘焦点、弹层闭环、reduced-motion、状态反馈和资源按需处理建议被采用；`frontend-design` 用于保持暖纸、深绿、本地字体与紧凑桌面工具气质。营销页式酒红主题、在线字体与装饰动画不符合 Knitspace 定位，未采用。
- 回归：96 个前端测试文件 / 403 项通过；Rust 66 项通过、4 项按设计忽略；4,618 模块生产构建、135.18 KiB 首屏 gzip 预算与 366 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 阅读选区复制为 Markdown（2026-08-11）

- 阅读与分屏预览的 Typora 式选区菜单补齐“复制为 Markdown”，排在无格式文字和 HTML 代码之前；`Ctrl+Shift+C` 在阅读选区存在时可直接执行，同一快捷键在源码编辑器中继续复制原始 Markdown，不改变普通 `Ctrl+C` 的系统行为。
- 选区转换覆盖标题、段落、加粗、斜体、删除线、行内代码、围栏代码块与语言、引用、有序/无序/任务列表、链接、图片、分隔线和表格；预览专用按钮、SVG 与 `aria-hidden` 装饰会跳过，未知元素退化为可读子文本，不把运行时 UI 复制进正文。
- 转换只在用户打开选区菜单或按下复制快捷键时执行，不进入输入、预览渲染或滚动热路径。原有纯文本 12 万字、HTML 36 万字符边界保留，新增 Markdown 18 万字符输出上限；超限会明确提示，避免一次选中超长文档时生成无界剪贴板负载。
- 1280 × 720 桌面预览中，九项选区菜单为 252 × 368.04 px，边界 909–1161 × 316–684.04，完整位于视口内且页面横向溢出为 0；首项“复制为 Markdown”自动聚焦。包含加粗和相对链接的实测剪贴板结果为 `这里包含 **加粗结论** 和 [本地链接](./guide.md)。`，菜单点击与 `Ctrl+Shift+C` 结果一致。
- QA 文档同时包含标题、引用、任务列表、代码块和表格，完成桌面菜单与剪贴板验证后已通过应用自身删除。序列化单元测试覆盖嵌套列表、复选框、反引号围栏、图片相对路径、表格转义和预览控件过滤。
- `ui-ux-pro-max` 的功能可发现性、清晰焦点、键盘等价、菜单边界、文本对比和按需计算建议被采用；`frontend-design` 用于延续暖纸、深绿、本地字体和紧凑桌面编辑器视觉。比较型营销布局、亮靛蓝配色、Caveat / Quicksand 在线字体不符合 Knitspace 定位，未采用。
- 回归：96 个前端测试文件 / 406 项通过；Rust 66 项通过、4 项按设计忽略；4,618 模块生产构建、135.18 KiB 首屏 gzip 预算与 366 文件 Public Core 检查通过。新增序列化器只进入按路由加载的 DocumentsView 分块，首屏体积未增加；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 标准链接桌面操作（2026-08-11）

- 阅读与分屏预览中的普通 Markdown 链接现在由 Knitspace 统一接管：单击或 `Enter` 打开，鼠标右键、菜单键或 `Shift+F10` 打开链接操作；菜单直接暴露“打开链接、复制链接地址、复制 Markdown 引用”，并与选区、图片、双链及图表菜单互斥。正文已有选区时继续优先呈现选区操作，避免右键语义争抢。
- 网页、邮件与电话交给桌面系统默认应用；同文档 `#标题` 会滚动并把键盘焦点送到目标标题；外部 Markdown 的相对 `.md` 链接按当前文件目录解析并继续使用既有未保存保护；其他本地附件只在桌面端交给系统。内部笔记没有磁盘基准路径时明确提示先关联本机 Markdown，不再让 WebView 把相对链接误导航到 `127.0.0.1`。
- 路径分类集中为无副作用纯函数，覆盖 Windows / POSIX 绝对路径、`file://`、查询、百分号编码与标题片段；`javascript:`、`data:`、`vbscript:` 及未知协议会阻断。链接标签和 Markdown 引用复制均经过转义，避免把预览 DOM 或本机绝对路径意外写入正文。
- 1280 × 720 开发预览中，右键菜单为 270 × 161.33 px，边界 696–966 × 395–556.33，完整留在视口内且首项“打开链接”自动聚焦；`Shift+F10` 同样打开菜单。实测剪贴板为 `[Knitspace 官网](https://example.com/docs)`；页内链接把焦点送到“边界条件”，内部笔记的 `./相邻笔记.md` 保持当前路由并显示路径保护提示。
- QA 临时笔记已通过应用自身删除。标准链接只在 Markdown 完成一次渲染后按实际锚点数量装饰，点击时才分类和解析路径，不引入常驻磁盘读取或新的响应式全文副本；5 MiB Markdown 基准为冷启动中位数 67.2 ms、热路径 12.1 ms，全部性能预算通过。
- `ui-ux-pro-max` 的焦点可见、键盘可达、状态反馈、危险协议防护、菜单边界与 Vue 浅响应建议被采用；暖纸、深绿、本地字体与紧凑桌面菜单保持 Knitspace 现有气质。搜索建议中的高饱和青色营销布局、在线字体和单列落地页结构不符合本地工作台定位，未采用。
- 回归：97 个前端测试文件 / 410 项通过；Rust 66 项通过、4 项按设计忽略；4,619 模块生产构建、135.41 KiB 首屏 gzip 预算与 368 文件 Public Core 检查通过。链接解析随按路由加载的 DocumentsView 使用；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 快速捕获结构化学习归档（2026-08-11）

- 快速捕获的文本建议不再只通向 Markdown、片段和 AI：页面直接暴露“记录为题目”，并在第一行是可信词条时暴露“录入单词”；右键、菜单键和 `Shift+F10` 菜单同时提供笔记、题目、单词与常用片段四种本地归档方向，不需要先去知识库创建空记录。
- 题目解析识别题目/题干、我的答案、正确答案、解析、错因、学科与标签；未带标记的普通段落仍可作为可恢复题干。生成后题目结构检查器中的五个富文本字段、分类和标签均已填好，补充 Markdown 的 YAML 与实体共用题型、学科、标签、难度和复习开关，不再显示旧模板默认值。
- 单词解析支持 `v. / n. / adj.` 与中文词性、分号分隔的多个独立义项、音标、词形、例句、搭配和近义/易混词；拉丁、日文假名与其他文字会推断为英语、日语或其他。已有同名词条会先确认并按“词性 + 释义”去重合并，不复制已有复习状态；新词条通过单次 SQLite 批量写入接口落库，不创建一词一文件。
- 输入最多解析 8,000 字符、64 行、12 个义项和 12 项列表；文本变化后等待 120 ms 才更新浅响应解析结果，旧定时器会取消。解析不访问磁盘、不进入全局 Store 热路径，切页时释放定时器；表单键名过滤原型污染保留字，超限后明确提示检查截断内容。
- 建议卡使用暖纸表面、深绿主动作和紧凑状态胶囊显示“5 个字段”或“4 个义项 · 2 词性”；窄窗口隐藏次要胶囊但保留完整可访问名称，`prefers-reduced-motion` 下关闭菜单与卡片动效。1280 × 720 预览页面 `clientWidth === scrollWidth === 1280`，无横向溢出。
- 单词动作右键菜单为 250 × 247.67 px，边界 999–1249 × 399–646.67，六项完整留在窗口内且首项自动聚焦；`Shift+F10` 同样打开菜单。端到端实测 `run` 形成 2 个词性、4 个义项并保留过去式、现在分词、例句和搭配；题目实测五个字段、算法分类及二分/边界标签完整写入，属性复验确认 `subject: "计算机"` 与 `tags: ["QA", "属性"]` 和实体一致。
- QA 的单词、两条题目与快速捕获草稿均通过应用自身删除，预览标签已关闭。`ui-ux-pro-max` 的高频入口可发现、明确焦点、状态反馈、低动效、输入防抖和轻量响应建议被采用；E-Ink 纸张气质延续现有暖纸/深绿主题，靛蓝营销色、Caveat / Quicksand 在线字体和比较表落地页结构未采用。
- 回归：99 个前端测试文件 / 417 项通过；Rust 66 项通过、4 项按设计忽略；4,620 模块生产构建、135.50 KiB 首屏 gzip 预算与 371 文件 Public Core 检查通过。快速学习解析只进入懒加载的 QuickIntakeView 分块；仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Markdown 富文本粘贴为 Markdown（2026-08-11）

- Markdown 源码编辑器的普通 `Ctrl+V` 现在会识别剪贴板 `text/html`，并把网页或在线文档中的标题、段落、强调、删除线、链接、图片、引用、有序/无序列表、行内代码、带语言代码块与表格转换为可继续编辑的 Markdown；纯文本剪贴板保持原样，图片仍进入既有本地附件流程。
- Typora 风格右键菜单的顶部粘贴按钮和“复制 / 粘贴…”子菜单直接暴露“粘贴并保留 Markdown 格式”；`Ctrl+Shift+V` 与“粘贴为纯文本”继续作为明确退路。菜单键与 `Shift+F10` 会打开同一菜单并聚焦第一个可用动作，复制、粘贴与图片操作没有形成第二套隐藏入口。
- 转换器不执行 HTML，也不依赖浏览器 DOM；脚本、样式、事件属性和危险协议被丢弃。输入限制 40 万字符、节点限制 2 万、嵌套限制 64 层、输出限制 30 万字符，超限会截取并提示，避免异常网页剪贴板长时间占用窗口；转换器只随按需加载的 CodeMirror 编辑器进入，不增加首屏依赖。
- 1280 × 720 开发预览中，富文本实测生成 `## 课程 **重点**`、两项有序列表和 `ts` 围栏代码块；工具栏显示“已保留标题、列表、链接和代码格式”。随后 `Ctrl+Shift+V` 对同一份 HTML 只插入两行纯文本。页面 `clientWidth === scrollWidth === 1280`，无横向溢出，页面运行日志无错误。
- 右键主菜单为 236 × 368 px，边界 917–1153 × 304–672，完整留在窗口内；粘贴子菜单六项可由方向键展开，暖纸、深绿、低饱和阴影和本地字体与现有编辑器一致。QA 临时笔记已通过应用自身确认删除，开发服务器与浏览器标签均已关闭。
- `ui-ux-pro-max` 的清晰焦点、语义按钮、键盘等价、状态反馈、输入限流、低动效与高对比建议被采用；搜索结果中的深色代码营销主题、在线 Crimson Pro / Atkinson 字体和落地页 CTA 结构不符合 Knitspace 本地桌面工作台定位，未采用。
- 回归：100 个前端测试文件 / 423 项通过；Rust 66 项通过、4 项按设计忽略；4,621 模块生产构建、135.53 KiB 首屏 gzip 预算与 373 文件 Public Core 检查通过。仅保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 工具空间可发现性与桌面目录布局（2026-08-11）

- 工具空间继续作为五个一级空间之一，45 项 PDF、图片、媒体、文本、整理、开发与脚本能力保留在统一目录；侧栏展开后可直接看到文件处理、音视频、字幕、OCR、开发工具、剪贴板、历史、私人工具与本机能力入口，不再依赖“今天”页面才能发现功能。
- 审计发现页面原有 27 处 9–10 px 文本。Hero 说明提升至 13 px，高频入口与任务标题提升至 11–12 px，说明和状态提升至 10–11 px；暖纸背景上的正文保持深绿高对比，深绿 Hero 中的说明提高不透明度。整张工具卡使用普通指针，并保留右键菜单提示，避免暗示只能通过右键操作。
- “直接开始”在 1320 px 以下改为全宽工作区，8 个高频入口以 4 × 2 排列并显示最多两行说明；“本机语音转写”说明压缩为更直接的本机工作流描述。工具目录说明也支持两行，避免只露出名称却看不到真实能力。
- 1440、1240、1024 px 下保持四列高频入口与双栏目录；900 px 下切换为两列高频入口、单栏工具目录，并隐藏次要 Hero 状态卡。四档均无标题截断、说明截断或横向溢出；1240 px 下高频区高度约 138 px，900 px 下约 276 px，布局变化不造成横向滚动。
- 1240 × 820 实测工具卡右键菜单为 238 × 170 px，边界 449–687 × 449–619，完整位于视口内且首项“打开工具”自动聚焦；Escape 可关闭，`Shift+F10` 可打开同一菜单。页面无 warning / error，临时开发服务器的完整进程树已停止，1421 端口确认释放。
- `ui-ux-pro-max` 的可读字号、4.5:1 文本对比、语义链接、清晰焦点、稳定悬停、键盘等价、路由懒加载与轻量响应建议被采用；搜索给出的高饱和深色营销页、比较表 CTA、在线 Fira 字体和 48 px 大间距不符合 Knitspace 暖纸、深绿、紧凑本地桌面工作台定位，未采用。
- 回归：101 个前端测试文件 / 428 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、136.15 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 今天空间核心信息前移与桌面密度（2026-08-11）

- 今天页重新遵循“番茄钟、纪念日、快速记录、待复习、最近文档”的核心职责：最近打开不再埋在工具任务之后，而是提升为快速入口后的“继续最近的内容”横向栏；工具任务、最近工具、资料和输出继续留在下方作为跨空间活动摘要。
- 1240 × 820 基线中，最近文档原本位于页面约 1,850 px；调整后位于约 1,002 px。Hero 从约 387 px 压缩到 333 px，页面滚动高度从约 2,308 px 降至 2,180 px；1440 px 下 Hero 为 283 px、页面约 2,045 px。视觉仍保留暖纸、深绿、快速记录和本机状态，没有变成营销式首屏。
- “继续最近的内容”在 1440 / 1240 px 使用四列，在 1024 / 900 px 提前切换两列；标题为 12 px、元信息为 10 px。1440、1240、1024、900 四档均无标题截断、说明截断或横向溢出，快速入口六项也保持完整。
- 最近文档整卡支持普通点击、鼠标右键、菜单键与 `Shift+F10`；右键菜单提供阅读预览、源码编辑、收藏、移出最近、复制双链和查看同类内容。1240 × 820 实测菜单为 244 × 282.33 px，边界 423–667 × 448–730.33，首项“阅读预览”自动聚焦并完整位于视口内。
- 最复杂的“新建笔记”快速入口菜单包含 7 项操作和模板，为 306 × 443.33 px，边界 735–1041 × 365–808.33，底部仍保留约 12 px 安全距离；Escape 与 `Shift+F10` 均通过。页面无 warning / error，临时预览进程树已停止，1421 端口确认释放。
- 收藏工具 ID 改为缓存的 `Set`，选择器不再为每张卡、每个状态重复线性扫描收藏数组；笔记数量改为缓存的 computed 归约，不再在模板每次渲染时过滤全部文档。最近内容卡使用 `v-memo`，保留浅响应视觉项目列表和 TodayFocus 每秒只更新子组件的既有边界。
- `ui-ux-pro-max` 的层级顺序、可读字号、非颜色单一反馈、语义标题、清晰焦点、键盘等价、computed 缓存与 `v-memo` 建议被采用；搜索给出的比较表落地页、高饱和区块、蓝色 CTA、Caveat / Quicksand 在线字体和 48 px 大间距不符合本地日常工作台定位，未采用。
- 回归：101 个前端测试文件 / 428 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、最新产物 136.14 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 创作空间工作流平衡与菜单边界（2026-08-11）

- 创作空间继续以 Markdown 为内容内核，并明确暴露思维图谱、Mermaid、LaTeX、图片画布与长图、代码长图和 AI 内容处理七类工作流；8 个高频入口保持直接深链，不为每项能力制造新的内容孤岛。
- Hero 正文保持 13 px 并提高深绿背景上的文字不透明度；最近创作标题、高频入口标题提升至 12 px，说明与时间提升至 10 px；工作流说明提升至 12 px、状态与入口提升至 10–11 px。整张工作流卡使用普通指针，左键打开默认任务，右键只作为更多开始方式。
- 1440 / 1240 px 三列网格改为 `2+1 / 1+1+1 / 1+2`，AI 工作台占据最后两列，消除七张卡片造成的空白格；1024 / 900 px 使用 `2 / 2 / 2 / 2` 的双列节奏。四档均无标题、说明截断或横向溢出，8 个高频入口保持四列且说明完整。
- 最近创作摘要继续通过 `shallowRef` 保存，仅在桌面端按需读取 12 个画布摘要；最近列表增加 `v-memo`，Markdown、Markmap、Mermaid、KaTeX、图片与代码编辑器仍由目标路由懒加载，创作总览不挂载任何重型编辑器。
- 修正最近创作菜单的边界估算：笔记六项与画布两项按真实 55 px 菜单行预留，分别为 387 / 167 px，并增加单元测试。此前按 39 px 估算会让靠近窗口底部的笔记菜单存在裁切风险。
- 1240 × 820 实测六项“图片表达工作室”菜单为 262 × 384.33 px，边界 966–1228 × 417–801.33，四周保持至少 12 px 安全距离，首项自动聚焦；Escape、鼠标右键与 `Shift+F10` 均通过。页面无 warning / error，临时预览进程树已停止，1421 端口确认释放。
- `ui-ux-pro-max` 的可读字号、文本对比、稳定悬停、焦点可见、键盘等价、懒加载与 `v-memo` 建议被采用；搜索给出的粉色 CTA、高饱和创意营销页、Fredoka / Nunito 在线字体、滚动吸附和 48 px 大区块不符合 Knitspace 暖纸、深绿、本地桌面创作台定位，未采用。
- 回归：101 个前端测试文件 / 429 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、最新产物 136.14 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 复习空间错因入口与会话性能（2026-08-11）

- 复习页把原本隐藏在“题目与错题”中的错因卡提升为独立筛选项，形成“全部到期 / 全部题目 / 错因卡 / 单词卡”四个入口；`#/review?kind=error` 可直接打开错因队列，空队列也会明确提示切回全部内容。
- 答案卡与错因卡继续共用同一道结构化题目，但保持独立 FSRS 状态；新增筛选只改变本轮队列，不复制材料、不修改到期计划。计数逻辑增加错因维度，并由单元测试覆盖查询归一化、筛选和一次遍历计数。
- 材料数量、已安排卡片和下一到期时间合并为一次 computed 遍历，避免题目与单词增长后为多个摘要重复扫描。Markdown 渲染器仍只在题目卡需要时异步加载，单词复习不引入完整技术文档预览栈。
- 筛选按钮正文提升至 11 px、计数提升至 10 px；准备材料区标题和说明提升至 15 / 11 px，六个工作流入口提升至 11 / 10 px，并保留暖纸背景、深绿重点色和低饱和阴影。720 px 以下四个筛选以 2 × 2 排列，避免标签拥挤。
- 1440、1240、1024、900 四档开发预览均无横向溢出；900 px 下准备材料区转为独立标题栏和两行任务入口，复习主卡仍完整占据内容区。1240 × 820 实际截图确认进度、材料入口和当前题目在首屏形成清晰层级。
- 900 × 720 实测复习卡右键菜单为 216 × 182 px，边界 480–696 × 365–547，完整位于视口内，首项“在题库中打开”自动聚焦；鼠标右键、Escape 和 `Shift+F10` 均通过。页面没有 error / warning，仅有 Vue Suspense 的框架级 info 提示；开发服务器已停止，1421 端口确认释放。
- `ui-ux-pro-max` 的可读字号、文本对比、键盘等价、进度反馈、懒加载、computed 缓存与 `v-memo` 建议被采用；搜索给出的高饱和深色 FAQ 营销页、在线 Fira 字体和落地页 CTA 结构不符合 Knitspace 本地桌面学习工作台定位，未采用。
- 回归：101 个前端测试文件 / 429 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、136.15 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Ctrl+K 全局功能地图与工具右键菜单（2026-08-11）

- Ctrl+K 继续统一五个空间、收藏、最近使用、Vault 全文结果、资料来源、剪贴板和工具目录；Alt+A 功能地图当前直接暴露 5 个空间与 51 个功能入口，不再要求用户先知道功能名称或回到“今天”页面。
- 功能地图中原有 8–9 px 的空间说明、入口文字与快捷键提升至 10–12 px，主标题提升至 15 px；暖纸表面、深绿图标和低饱和边框保持不变。1240 × 820 截图确认标题、五空间分组和功能入口层级清晰，没有采用 skill 给出的通用市场目录、橙色 CTA 或在线 Plus Jakarta Sans。
- 工具搜索结果新增桌面右键与 `Shift+F10` 菜单，提供打开工具、加入或取消收藏、复制工具说明、浏览完整工具目录四项操作；右键仍是补充操作，普通点击和星标按钮保持原行为。
- 1240 × 820 实测工具菜单为 252 × 209 px，边界 596–848 × 557–766，首项“打开工具”自动聚焦并完整位于视口内；Escape 恢复触发项焦点。内容菜单与工具菜单互斥，切换查询时会同时关闭，避免重叠弹层。
- 首轮 QA 发现 900 × 720 时命令面板底部超出视口约 13 px；修复后弹层使用 8vh 上边距、12 px 下安全距离和内部滚动。1240 × 820、1024 × 768、900 × 720 下底部分别为 754、717、682 px，均完整留在视口内，51 个入口无文字截断或横向溢出。
- 搜索结果仍有限制数量，Vault 查询保留 150 ms 防抖与异步版本门，功能地图只使用静态轻量元数据；没有加载 PDF、画布源图、Markdown 渲染器或媒体模块。`ui-ux-pro-max` 的可读字号、搜索空状态、键盘等价、焦点可见和 reduced-motion 建议被采用。
- 回归：101 个前端测试文件 / 429 项通过；Rust 66 项通过、4 项按设计忽略；4,622 模块生产构建、136.75 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## SQLite 一致性归档与 P0 数据内核审计（2026-08-11）

- 桌面端的文档、词汇、关系、资料来源、活动和剪贴板以 SQLite / Markdown Vault / 本地资源为主数据源；进入桌面 Vault 后，浏览器快照会移除这些重集合，只保留有边界的界面状态、任务摘要和一次性恢复数据。Vault 水合失败前会保留恢复快照和写入日志，成功后才清理浏览器恢复数据。
- 数据层已有版本化迁移、FTS5 全文索引、Markdown 元数据同步、嵌套目录文件监听和 `PRAGMA quick_check` 健康检查；恢复流程先解压到暂存目录、验证 Vault，再替换当前数据，并在替换前创建安全归档。备份与恢复命令通过阻塞线程池执行，不占用 Tauri 窗口主线程。
- 审计发现原备份会遍历正在写入的 `.toolknit/index.sqlite3`、`index.sqlite3-wal` 和 `index.sqlite3-shm`。这三个文件若在不同时间点被复制，可能生成表面完整、实际跨事务时刻的归档，是当前最高优先级的数据安全风险。
- 备份现在先在 Vault 外的唯一临时目录中通过 SQLite `VACUUM INTO` 生成单文件一致性快照，再用独立连接运行 `PRAGMA quick_check(1)`；只有检查结果为 `ok` 才写入 ZIP 中的 `.toolknit/index.sqlite3`。遍历 Vault 时明确跳过在线数据库及 WAL / SHM 边车文件，其他 Markdown 和资源仍按原目录结构流式写入。
- 无论成功或失败都会清理临时快照目录；归档中途失败还会删除不完整的目标 ZIP，避免用户误把半成品当成可恢复备份。新增测试会打开归档内数据库、复跑 quick check、验证文档记录，并断言 WAL / SHM 不会进入归档；首轮测试还暴露了 Windows 文件句柄未释放问题，现已通过显式关闭验证连接修复。
- 本轮没有为了展示修复而增加界面负担。`ui-ux-pro-max` 的破坏性操作确认、恢复路径、进度反馈、成功与错误状态以及避免主线程阻塞原则与现有设置页流程保持一致；其通用应用商店布局、高饱和青色和在线 Fira 字体不符合 Knitspace 暖纸、深绿、本地优先桌面工作台定位，未采用。
- 回归：101 个前端测试文件 / 429 项通过；Rust 67 项通过、4 项按设计忽略；4,622 模块生产构建与 136.75 KiB 首屏 gzip 预算通过；375 个 Public Core 发布文件未发现个人路径或高置信密钥。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## Vault 可迁移恢复闭环与桌面反馈（2026-08-11）

- 真实“创建归档 → 写入新数据并修改附件 → 恢复旧归档 → 重新打开 Vault”演练发现，`documents.markdown_path` 仍保存原机器上的绝对路径。暂存验证因此可能误读当前活跃 Vault 的同名正文，也会让跨目录或跨电脑恢复失去可移植性；这不是界面问题，而是恢复链路中的 P0 数据边界缺口。
- SQLite schema 升级至 v16，迁移会把所有文档路径规范为 `notes/<id>.md` 或 `questions/<id>.md`。新写入从源头只保存相对路径；读取层只接受 Vault 内 `notes` / `questions` 的普通路径组件，绝对路径和 `..` 越界路径不会再被数据库行或导入归档带到 Vault 外部。
- 完整恢复在替换当前目录前，会对暂存 Vault 执行迁移、`PRAGMA quick_check(1)` 和 Markdown 正文缺失检查。数据库可打开但缺少正文的归档现在会被明确拒绝，当前 Vault 保持不变；失败暂存目录仍会清理，恢复前安全归档仍会保留。
- 往返测试同时验证恢复后的 Markdown 原文、受管附件字节、FTS 旧关键词命中、新写入关键词消失、SQLite 完整性、正文缺失计数和恢复前安全归档；另有独立测试覆盖 v15 绝对路径迁移，以及“仅含 SQLite、缺 Markdown”的不完整 ZIP 拒绝路径。
- 设置页为 JSON 导出、完整归档和两类恢复增加 `working / success / error` 语义状态；错误使用 `role="alert"`，普通进度使用 `aria-live="polite"`。完整恢复期间显示“已选择归档 / 验证并保护当前数据 / 替换并重新载入”三段流程，但不伪造原生命令没有提供的百分比。
- Vault 健康卡、归档卡、保留说明和恢复流程中的 8–9 px 关键文字提升至 9–12 px，暖纸表面使用更深的次级文字色；动画支持 `prefers-reduced-motion`。两类归档仍并排对比，完整 Vault 作为主操作，JSON 快照保持次级，避免新增独立页面或重复入口。
- 1240 × 820 真实 Tauri 开发窗口确认 v16、8 个内容索引、磁盘空间、完整归档与 JSON 快照都完整可见，无横向溢出。Vault 卡鼠标右键和 `Shift+F10` 均打开同一组六项菜单，首项获得可见焦点，恢复项保持独立危险色；QA 没有点击归档或恢复，不修改个人 Vault。开发进程已停止，1421 端口确认释放。
- `ui-ux-pro-max` 的破坏性确认、错误恢复路径、语义状态、键盘等价、焦点可见、高对比与 reduced-motion 建议被采用；其作品集网格、蓝色 CTA、在线 Lora / Raleway 字体和宽松营销页留白不符合 Knitspace 暖纸、深绿、紧凑本地桌面工作台定位，未采用。
- 回归：101 个前端测试文件 / 429 项通过；Rust 69 项通过、4 项按设计忽略；4,622 模块生产构建、137.25 KiB 首屏 gzip 预算与 375 文件 Public Core 检查通过。`rustfmt --check src/vault.rs` 与 `git diff --check` 通过，后者仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 代码连续长图导出闭环与桌面菜单（2026-08-11）

- 代码分享工作室原本已经具备大文本编辑、Worker 分页、高亮缓存、连续拼接、安全高度拆分、剪贴板复制、PNG 分页和 PDF 导出，但连续长图只能复制，无法作为连续 PNG 保存。现在全文和所选页都可直接导出连续长图；超过单图 30,000 px / 60M 像素安全边界时自动输出 `code-long-01.png` 等连续文件，不丢代码行。
- 长图任务沿用三阶段真实反馈：生成代码段、合成长图分段、写入剪贴板或保存连续 PNG。只在可安全终止的生成与编码阶段显示取消；写入输出目录后不再伪装成可立即回滚。所有文件确认完成后才记录输出历史和成功提示。
- 顶部没有继续堆按钮，而是把复制全文、导出全文、复制所选和导出所选四个动作收进一个“连续长图”桌面菜单；底部只保留全文复制、全文导出和当前多图复制，所选连续长图仍能从顶部菜单和右键菜单进入。
- 代码预览右键菜单统一为暖纸背景、深绿图标和更深正文色，修复旧的半深色渐变导致的文字背景不稳定；按钮文字提升到 10–11 px，焦点边框、禁用状态、Escape 返回焦点和 `Shift+F10` 键盘等价均保留。
- 1240 × 820 真实 Tauri 窗口输入 120 行临时代码，自动得到 4 张预览。顶部连续长图菜单完整显示复制与导出；多选两页后的最复杂 10 项右键菜单位于约 950–1166 × 386–802 px，仍保留底部安全距离；键盘菜单在右上角自动夹紧并完整可见。QA 没有执行实际导出或写入文件。
- 大内容性能边界保持不变：CodeMirror 只渲染可见区域，排版扫描在 Worker，页面元数据用 `shallowRef`，高亮缓存 16 页、PNG 缓存 12 页、连续长图缓存 1 项，同时只运行一个 DOM 捕获任务；CodeImage 路由仍为独立懒加载分块，最终约 48.17 kB / 17.21 kB gzip。
- `ui-ux-pro-max` 的长内容处理、三阶段进度、键盘可达、焦点可见、稳定弹层、文本对比和 `shallowRef` 建议被采用；搜索给出的应用商店落地页、深色代码产品主视觉、绿色下载 CTA 与在线 Fira 字体不符合 Knitspace 暖纸、深绿、本地桌面工作台定位，未采用。
- 回归：104 个前端测试文件 / 441 项通过；Rust 69 项通过、4 项按设计忽略；4,625 模块生产构建、138.82 KiB 首屏 gzip 预算与 381 文件 Public Core 检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。开发进程树已停止，1421 端口确认释放。

final result: passed

## 五空间长右键菜单的窗口边界（2026-08-12）

- 静态审计确认 22 条用户路由全部由五空间、侧栏子入口或 Ctrl+K 功能目录拥有；真实桌面回归进一步发现，空间右键菜单按完整功能列表展示时，“工具”空间会超过 1240 × 820 窗口高度，末尾的私人工具、脚本历史与本机实验入口不可见。
- 导航菜单现在统一通过共享边界计算器定位，并把参与定位的高度限制为视口可用高度；菜单本体增加 `100vh - 24px` 上限、纵向滚动和滚动边界隔离。空间标题保持吸顶，长列表滚动后仍能确认当前所属空间。
- 1240 × 820 真实 Tauri 开发窗口验证：工具空间完整菜单位于窗口 12 px 安全边界内；按 `End` 后列表自动滚到最后一项“本机能力与实验”并显示清晰深绿焦点，Escape 可关闭。整个 QA 只切换视图和菜单，没有修改用户文档。
- 新样式没有引入图片、滤镜、模糊或持续动画；只对当前菜单建立一个有界滚动容器，不增加路由包或大列表响应式计算。`ui-ux-pro-max` 的键盘等价、可见焦点、弹层层级、高对比暖纸表面和避免界面溢出原则被采用。
- 回归：109 个前端测试文件 / 462 项通过；4,631 模块个人版生产构建通过，首屏脚本 61.21 kB gzip、样式 80.90 kB gzip、总计 142.11 kB gzip，保持在既有启动预算内；Public Core 构建和 393 个发布文件隐私检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；开发进程树已停止，1421 端口确认释放。

final result: passed

## 工具空间分类总数守恒与孤儿入口（2026-08-12）

- 真实桌面走查发现工具空间显示 45 个可用工具，但四张分类卡分别为 9、10、14、11，合计只有 44。漏项不是视觉误差：二维码工具被特意保留在工具空间，却仍使用“表达”分组，因此只能在全部工具或搜索中出现，无法通过任何分类找到。
- 工具空间不再维护第二套分组判断；完整目录和四个分类统一读取五空间目录的权威归属。二维码作为小型实用工具归入“开发与脚本”，而图片画布、滚动长图、代码分享和 AI 创作仍归创作空间，不会一起被误收进工具目录。
- 新增总数守恒回归：凡归属工具空间的条目都必须落入 PDF 与文件、图片与媒体、文本与整理、开发与脚本之一。以后新增工具若只增加总数却没有可见分类，测试会直接失败。
- 1240 × 820 真实 Tauri 开发窗口复核：首屏现在显示 `45 = 9 + 10 + 14 + 12`；点击“开发与脚本”得到 12 项结果，首项就是“二维码生成与识别”，无需依赖搜索或“今天”页。整个 QA 只切换空间和筛选，没有运行工具、修改收藏或写入用户内容；900 × 680 本轮未形成可靠窗口证据，不记为通过。
- `ui-ux-pro-max` 的可发现性、无死路分类、清楚文字层级、键盘焦点与轻量派生状态原则被采用；营销对比页、酒红配色和在线 Fredoka / Nunito 字体与 Knitspace 暖纸、深绿、本地桌面工作台定位不符，未采用。
- 回归：109 个前端测试文件 / 463 项通过；4,631 模块个人版与公开版生产构建通过，首屏脚本 61.21 kB gzip、样式 80.90 kB gzip、总计 142.11 kB gzip；393 个 Public Core 发布文件检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。开发进程树已停止，1421 端口确认释放。

final result: passed

## 侧栏兄弟入口唯一选中状态（2026-08-12）

- 真实 Tauri 桌面走查发现，同一路径的侧栏子入口会因包含式查询匹配同时高亮：打开 Markdown 笔记时，“Markdown 笔记”和不带查询参数的“全部学习内容”都呈现选中背景；收藏内容、最近打开、打开本机 Markdown、题目导入和创作模板也存在同类风险。
- 侧栏现在先收集同一空间内路径、查询参数与锚点均匹配的兄弟入口，再按特异度只选择一项。`/documents?kind=note&document=…` 仍稳定归入 Markdown 笔记，临时文档 ID 不会破坏高亮；但更具体的 `action=open-file`、公式识别参数、知识筛选和今天页锚点会优先于通用入口。
- 该规则只处理侧栏的派生选中态，不改写当前 URL、不删除一次性参数，也不改变五空间的路由归属、Ctrl+K 目录或右键菜单。匹配列表最多为当前空间的少量固定入口，不新增监听、网络请求、DOM 或大对象响应式开销。
- 1240 × 820 真实 Tauri 开发窗口复核：Markdown 压力文档保持阅读预览，移开鼠标后只有“Markdown 笔记”一项显示深绿选中背景，“全部学习内容”恢复普通状态；右键文档菜单仍完整位于窗口内。QA 只导航、打开和关闭菜单，没有编辑、保存、导出或删除个人内容。
- `ui-ux-pro-max` 的单一当前位置、清楚层级、可见焦点、稳定悬停和轻量派生状态原则被采用；营销对比页、蓝色 CTA、在线 Caveat / Quicksand 字体与 Knitspace 暖纸、深绿、本地桌面工作台定位不符，未采用。
- 回归：109 个前端测试文件 / 464 项通过；4,631 模块个人版与公开版生产构建通过，首屏脚本 61.43 kB gzip、样式 80.90 kB gzip、总计 142.33 kB gzip；393 个 Public Core 发布文件检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。开发进程树已停止，1421 端口确认释放。

final result: passed

## Knitspace 桌面构建身份与 DeepSeek V4 兼容（2026-08-12）

- Windows 开发版此前虽然窗口标题已经是 Knitspace，但 Rust 二进制和 npm 包仍叫 `toolknit`，因此系统进程与任务列表会继续显示旧名。现在面向用户的 npm 包、Rust package、lib target 和开发版二进制统一为 Knitspace；真实 Tauri 进程路径为 `src-tauri/target/debug/knitspace.exe`，原生窗口标题为 “Knitspace”。
- 旧版 `io.github.longtiandragon.toolknit`、`.toolknit`、`toolknit://`、localStorage 键和 Credential Manager service 继续保留，它们属于应用升级、既有 Vault、事件、备份和已保存凭据的兼容边界，不是漏改的界面品牌。新增产品身份回归会同时检查新构建名和旧兼容标识。
- 使用用户明确授权的临时 DeepSeek Key 做最小真实请求时，首次请求 HTTP 与 usage 均成功，但 V4 默认思考模式在短输出预算内只产生推理内容，最终 `content` 为空。Knitspace 只需要可复制的最终草稿，不展示推理链，因此浏览器与 Tauri 原生请求现在对 `deepseek-v4-flash/pro` 显式发送 `thinking: disabled`；其他 OpenAI 兼容模型不接收这个专用字段。
- 修正后以同一 V4 Flash Chat Completions 接口复测，固定健康检查文本完整返回。密钥只经隐藏输入进入临时进程内存，没有写入源码、配置、系统凭据库、知识库、日志或测试快照。空 `content` 也不再被静默当成成功，而会提示检查不兼容的思考模式。
- `ui-ux-pro-max` 的一致产品身份、清楚错误反馈、避免静默失败、低等待成本和可信本地状态原则被采用；面向营销页面的蓝色 CTA、在线手写字体和与暖纸深绿无关的视觉方案未用于桌面工作台。
- 回归：111 个前端测试文件 / 469 项通过；Rust 71 项通过、4 项按环境条件忽略；4,631 模块个人版与公开版生产构建通过，首屏总计 142.32 kB gzip；395 个 Public Core 发布文件隐私检查通过。构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## AI 请求透明度、超大文本边界与草稿快照（2026-08-12）

- AI 工作台原来的“查看实际发送载荷”只显示 system / user messages，遗漏 model、temperature、stream 和 DeepSeek V4 的 thinking 开关；同时桌面原生层把所有动作的 temperature 固定为 0.25。现在内容工作台的请求体由同一构造器生成，浏览器直接发送该对象，Tauri 原生层接收并校验同一 temperature，再补齐同一 DeepSeek 兼容字段。改写 / 邮件为 0.45，普通内容操作为 0.2，学习动作与公式识别也保留各自温度。
- 请求预览明确显示实际 endpoint 与完整请求体字段，但绝不显示 Authorization 或 API Key。正文、动作、配置或模型变化都会把预览标为过期；4 万字符之后只截断页面预览并说明实际请求仍使用用户确认的完整材料，避免把超长 JSON 整段挂到 DOM。
- AI 文本文件设置 4 MB 上限。浏览器 File 对象先按元数据筛选；桌面窗口拖放先调用只读 metadata 探测，类型或大小不合格时不会再调用二进制读取。编辑区再限制 100 万字符，达到 85% 后用琥珀提示；这避免意外拖入日志或数据文件时先把超大字节数组复制进 WebView。
- 生成结果保留独立的 `resultAction` 快照。用户生成“专业改写”后即使切换到翻译，导出文件名、任务参数、知识库笔记标题和标签仍按“专业改写”记录，不会把旧结果错误归类成当前新任务。结果区原有右键 / `Shift+F10` 的复制、存入知识库与导出路径保持不变。
- 1240 × 820 本地页面视觉测量：三栏宽度为 205 / 347 / 314 px，页面没有横向溢出；请求体区域 clientHeight 为 150 px、scrollHeight 为 317 px，独立滚动而不推高整页；textarea 的 `maxlength=1000000` 已落到 DOM。暖纸输入面、深绿请求预览、正文与背景对比和焦点路径保持一致。
- 本轮 Windows 停在锁屏，按桌面自动化安全规则没有尝试解锁，因此没有把本地浏览器截图冒充为新 Tauri 截图。真实 `knitspace.exe` 已成功编译运行，Rust 参数构造和边界测试通过；后续在桌面解锁时仍应补一次带已配置 DeepSeek profile 的 Tauri 请求体截图。
- `ui-ux-pro-max` 的高对比、清晰焦点、稳定三栏、可滚动有界预览、包体监控与避免一次加载全部内容原则被采用；搜索推荐的营销对比表、靛蓝 / 亮绿 CTA、在线 Caveat / Quicksand 字体不符合 Knitspace 暖纸深绿本地桌面工作台，未采用。
- 回归：112 个前端测试文件 / 472 项通过；Rust 71 项通过、4 项按环境条件忽略；4,632 模块个人版与公开版生产构建通过，首屏脚本 61.43 kB gzip、样式 80.90 kB gzip、总计 142.33 kB gzip；397 个 Public Core 发布文件隐私检查通过。构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 桌面文件入口路径直达与内存预算（2026-08-12）

- 共享文件入口原本会先探测桌面文件元数据，随后仍把完整字节数组经 Tauri IPC 复制进 WebView。资料库导入并不需要这份前端副本，却会让大 PDF、图片或批量文件额外占用数倍内存。现在资料库桌面拖放只发出通过类型检查的原始路径，按路径交给 Rust/Vault 复制、哈希和建索引；入口里的“选择文件”也转交原生文件对话框，不再退回网页文件选择器。
- 浏览器版资料库仍支持 `File` 导入，但单文件限制 64 MB、单次限制 192 MB。确实需要在前端读取字节的快速捕获、代码分享、图片画布和批处理中心分别设置用途相关的单文件与总量预算；图片画布的顶部入口和空画布入口共用 32 MB / 96 MB 边界，避免旁路绕过。
- `FileDropZone` 增加聚合预算、最多文件数、桌面路径模式、原生选择请求和 `aria-busy`。桌面读取先完成类型、单文件与总量预检，只有保留的文件才调用二进制读取；拒绝原因直接说明限制和“未载入内存”，不会在卡顿后才报错。新增算法测试覆盖稳定顺序的聚合筛选，架构契约测试固定“资料库路径分支必须先于字节读取”。
- 1240 × 820 本地页面视觉复核：资料库无横向或纵向溢出，拖入入口约 905 × 58 px；正文为 `rgb(24, 39, 31)`，暖纸表面为 `rgba(255, 254, 250, 0.64)`。入口下方直接暴露整理笔记、建立错题、标注图片、Windows OCR、整理公式和分享代码六条工作流，不依赖“今天”页或搜索。
- 真实 `knitspace.exe` 已编译并返回标题为 “Knitspace” 的原生窗口，但 Windows 捕获结果仍是锁屏。依照桌面控制安全规则，本轮没有尝试解锁或点击，也没有把浏览器截图冒充成 Tauri 实机交互证据；桌面路径行为由 TypeScript 构建、契约测试和既有 Rust 原生导入实现覆盖。
- `ui-ux-pro-max` 的渐进反馈、清楚错误状态、批量任务边界、键盘可达、暖纸高对比与避免大资源进入主线程原则被采用；搜索建议中的视频主视觉、酒红 / 金色调和在线 Righteous / Poppins 字体与 Knitspace 深绿本地桌面工作台不符，未采用。
- 回归：113 个前端测试文件 / 475 项通过；4,632 模块个人版与公开版生产构建通过，首屏脚本 61.43 kB gzip、样式 80.90 kB gzip、总计 142.33 kB gzip；397 个 Public Core 发布文件隐私检查通过。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 五空间右键快捷入口完整分层（2026-08-12）

- 功能归属审计确认五个空间的侧栏与总览页已经覆盖现有工作流，但工作区空白处的右键菜单只展示 4–5 个高频入口；公式识别、滚动拼接、AI、字幕、剪贴板、失败任务和本机实验等能力仍要依赖侧栏展开或“全部功能”，因此产生了“很多功能只能在今天看到”的感受。
- 工作区右键菜单现在采用两层结构：默认只显示当前空间的常用能力，点击“展开更多 N 项”后在原菜单内补齐该空间其余全部功能，不打开新面板、不混入其他空间，也不重复空间总览。五个空间的常用与更多集合无交叉，合并后必须与各自完整子入口集合严格相等；新增功能若未进入右键菜单，测试会直接失败。
- 展开按钮保持吸附和明确的加减状态；键盘 `End` 可到最后一项，第一次 `Escape` 只收起更多列表并把焦点还给展开按钮，第二次 `Escape` 关闭菜单并把焦点还给原工作区。菜单渲染后会按真实 DOM 尺寸再次夹紧位置，避免 Windows 缩放与边框亚像素取整造成底边裁切。
- 1240 × 820 桌面尺寸验证：创作空间展开后 10 项功能全部可见，菜单约 274 × 753 px，底部保留约 10 px；工具空间展开后承载 21 项入口，菜单约 274 × 796 px，内容在菜单内部滚动（scrollHeight 1158 px），页面无横向溢出。暖白纸面为 `rgba(255, 254, 250, 0.98)`，正文为 `rgb(24, 39, 31)`，焦点与层级清晰。
- `ui-ux-pro-max` 的渐进披露、当前空间上下文、键盘等价、可见焦点、稳定弹层与暖纸高对比原则被采用；搜索结果里的营销比较页、蓝色 CTA 和在线 Caveat / Quicksand 字体不符合 Knitspace 深绿、本地桌面工作台定位，未采用。该改动只派生少量固定导航项并复用单个有界滚动菜单，不增加网络请求、图片、持续动画或大列表响应式开销。
- 回归：113 个前端测试文件 / 476 项通过；类型检查、4,632 模块个人版与公开版生产构建通过，启动资源总计 142.02 kB gzip；398 个 Public Core 发布文件检查通过，仓库未检出高置信 API Key。`git diff --check` 通过，仅报告既有 LF/CRLF 工作区提示；构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## 复习首屏闭环与评分对比修复（2026-08-12）

- 1280 × 720、150% 缩放的五空间桌面走查确认“今天、知识、创作、复习、工具”均无横向溢出；复习页此前把“准备复习材料”放在当前卡片之前，导致真正的揭晓与评分动作落到首屏之外。现在到期卡片优先出现，队列维护与材料管理移到完成当前动作之后。
- 当前复习卡高度在该视口被约束为 450 px，正文使用独立有界滚动区：揭晓前正文高度约 215 px；长答案揭晓后 clientHeight 177 px、scrollHeight 405 px，底部评分操作仍完整可见，不会因公式、代码块或长解析把整页持续撑高。
- 评分按钮修复了旧全局样式造成的深色背景配深色文字问题。“重来、费劲、刚好、轻松”分别采用暖红、琥珀、绿色和深绿表面，并同时显示 1–4 快捷键与文字标签，信息不只依赖颜色。复习页专属加载态与答案样式改为路由懒加载，不再进入所有页面的启动样式。
- 右键与 `Shift+F10` 均能打开当前卡片菜单，菜单保持在视口内；`Escape` 关闭后焦点返回卡片。入口包括回到题库、复制 Markdown、稍后再看与继续复习，保留了桌面应用的上下文操作效率。
- Markdown 性能门禁通过：1 MB 冷渲染中位数 25.1 ms、热渲染 4.2 ms；3 MB 为 33.3 / 6.2 ms；5 MB 为 53.1 / 10.1 ms。首屏资源为脚本 61.94 kB gzip、样式 80.83 kB gzip，总计 142.77 kB gzip，启动预算通过。
- `ui-ux-pro-max` 的首要任务优先、键盘等价、可见焦点、有界滚动、高对比语义表面、懒加载与避免大内容推高布局原则被采用；营销比较页、蓝色 CTA 和在线 Caveat / Quicksand 字体与 Knitspace 暖纸深绿本地工作台定位不符，未采用。
- 回归：114 个测试文件 / 479 项通过；类型检查、4,632 模块个人版与公开版生产构建通过；399 个 Public Core 发布文件未发现个人路径或高置信度密钥。既有 Git 历史仍含旧 Windows 用户目录，因此公开发布必须使用 `pnpm export:public` 导出到全新仓库，不能直接公开当前历史。

final result: passed

## Markdown 应用级专注阅读（2026-08-12）

- 1280 × 720 桌面走查发现，原“专注阅读”只隐藏文档列表与检查器，主侧栏和 78 px 顶栏仍持续占用阅读空间；这与替代 Typora 高频阅读工作流的目标不符。现在专注状态提升到应用外壳，主侧栏与顶栏退出布局，文档工作区由约 1034 px 扩展到完整 1280 px。
- 阅读正文继续限制为 820 px 舒适行宽，并居中使用暖纸背景，不会因窗口变宽拉成长行；标题、元数据、保存状态和“退出专注”仍保留。Tauri 原生标题栏也保持可用，因此最小化、最大化、关闭和未保存提示不会被伪全屏遮蔽。
- `Esc` 可直接退出专注模式，焦点保留在同一按钮并恢复“专注阅读”文字；切换到设置等其他路由时会自动清理应用级状态，侧栏和顶栏立即恢复。进入、退出及路由切换均无横向溢出，也不保存或修改当前文档。
- 专注布局只切换少量 CSS display / width 状态，不重建 Markdown 渲染器、不重新解析正文、不增加动画。相关 CSS 随 DocumentsView 懒加载，首屏样式保持 460.00 kB raw；脚本与样式合计 142.84 kB gzip，启动预算通过。
- 同轮审计确认 Ctrl+K 的完整功能地图覆盖 52 个直接入口，五空间计数为 4 / 11 / 10 / 6 / 21；工具空间右键菜单在 1280 × 720 内保持 12 px 安全边界并内部滚动。五空间与设置页的可见文字对比扫描未发现低于 WCAG AA 阈值的普通文本。
- `ui-ux-pro-max` 的阅读行宽、可见退出、键盘等价、路由状态清理、高对比暖纸、渐进披露和路由级懒加载原则被采用；视频主视觉、蓝色 CTA 和在线 Caveat / Quicksand 字体不符合 Knitspace 本地桌面工作台定位，未采用。
- 回归：115 个测试文件 / 482 项通过；类型检查、4,633 模块个人版与公开版构建通过；400 个 Public Core 发布文件未发现个人路径或高置信度密钥。构建仍只保留既有 Mermaid / Cynefin 大分块提示。

final result: passed

## DeepSeek 真实调用与配置编辑（2026-08-12）

- 使用用户明确提供的临时凭据调用 DeepSeek 官方接口，模型列表返回 `deepseek-v4-flash` 与 `deepseek-v4-pro`；项目现有 `thinking: { type: 'disabled' }` 请求体成功返回短文本，确认当前预设与 V4 模型兼容。
- 1280 × 720 浏览器开发版完整验证两条链路：AI 内容工作台可从 99 字材料生成“三行摘要 + 关键要点”，错题页“分析错因”可返回结构化 Markdown，并只提供“复制 / 插入正文”，不会自动覆盖原题。加载态、完成态和结果渲染均正常。
- 配置页新增“编辑”入口与明确编辑态；API Key 留空会保留现有系统凭据或 Session Key。完全相同的名称、地址与模型重复保存时复用原 ID，更新配置不会再制造难以区分的同名条目；不同模型仍允许分别保存。
- 浏览器开发版密钥仅保留在当前标签页 `sessionStorage`，桌面版仍使用 Windows 凭据管理器；密钥不进入工作区备份、Markdown、源码、测试、公开构建或 QA 文档。本轮仓库高置信密钥扫描无结果，Public Core 402 个发布文件检查通过。
- `ui-ux-pro-max` 的清楚状态、可见焦点、暖纸高对比、渐进操作和避免全局启动成本原则被采用；配置编辑态样式随设置路由懒加载，没有进入首屏 CSS。启动资源为脚本 62.01 kB gzip、样式 80.83 kB gzip，总计 142.85 kB gzip，预算通过。
- 回归：116 个测试文件 / 485 项通过；类型检查、4,635 模块个人版与公开版生产构建通过。`git diff --check` 仅报告既有 LF/CRLF 工作区提示。

final result: passed

## 资料正文进入统一 FTS5 搜索（2026-08-12）

- P0 数据内核审计确认，Markdown、题目和结构化单词已经由 SQLite FTS5 检索，但 `source_records.content_text` 只存储未索引；导入的文本、代码和 PDF 提取正文因此只能按名称与已加载元数据查找。Schema v17 新增独立 `sources_fts`，把资料名称、正文和标签纳入同一本机知识搜索。
- 资料保存与 FTS 更新现在在同一 SQLite 事务内完成；标签使用独立 FTS 列，可在不读取、复制或重写大正文的情况下更新索引。旧 Vault 升级时会一次性回填既有资料，并有 v16 → v17 迁移回归证明正文可检索、schema 标记正确。
- 统一查询用 FTS5 `bm25` 合并笔记、题目、单词和资料，最多返回 30 项；渲染端继续使用 140–150 ms 防抖与过期请求门禁，不扫描大正文。资料结果直接打开资料库，关系编辑器则保持现有实体约束，不会把独立资料记录写成无效关系。
- 1280 × 720 桌面浏览器走查确认：知识空间和 `Ctrl+K` 搜索保持无溢出；搜索结果可鼠标右键或 `Shift+F10` 打开菜单，初始焦点、方向键和 `Esc` 恢复正常。菜单标题会按内容显示“题目搜索结果 / 单词搜索结果 / 资料搜索结果”，操作包括打开、收藏、复制引用与查看同类内容。
- `ui-ux-pro-max` 的搜索优先、空结果引导、懒加载、可见焦点、稳定弹层和避免大列表深层响应式原则被采用；超大营销标题、蓝色目录配色和在线 Fira 字体不符合 Knitspace 暖纸深绿桌面工作台定位，未采用。
- 回归：116 个前端测试文件 / 485 项通过；Rust 73 项通过、4 项按设计忽略；类型检查、4,635 模块个人版与公开版构建通过。首屏脚本 62.22 kB gzip、样式 80.83 kB gzip、总计 143.05 kB gzip，启动预算通过；402 个 Public Core 文件检查与仓库密钥扫描通过。

final result: passed

## 全局知识关系图谱（2026-08-12）

- 关系数据此前只在单篇文档的检查器中出现，知识库虽然显示关系总数，却没有可浏览的全局入口。新增独立“知识关系图谱”页，并从知识库英雄区、知识空间侧栏、`Ctrl+K` 功能目录和当前空间右键菜单同时暴露；直接入口总数由 52 增至 53，不再要求用户先打开某篇笔记才能发现双链与显式关系。
- 图谱以“中心内容 + 直接关系”呈现前置知识、相关内容和变式 / 对比，支持笔记、题目、结构化单词与视觉画布。节点按关联度与更新时间稳定排序，标题、分类和关系元数据之外不载入 Markdown 正文、词义详情、图片或标注载荷；目录最多渲染 80 个节点，中心最多渲染 60 条直接关系，避免大 Vault 中使用持续力导向动画或一次创建全部 DOM。
- 节点和关系卡均支持鼠标右键与 `Shift+F10`。菜单可打开内容、设为图谱中心、复制双链 / 名称或关系摘要；关系删除必须经过明确确认，并只删除关系、不删除两端内容。`Escape` 关闭后焦点返回触发节点，菜单位置按真实视口夹紧。
- 首次没有关系时自动切到“全部”节点，不再出现“已连接 0 / 0”却仍显示中心内容的矛盾状态；空态直接说明从文档检查器“关联知识”或 `[[笔记标题]]` 开始。缺失端点只显示有界提示，不自动修改原始关系记录。
- 1280 × 720 本地桌面尺寸复核：页面 `scrollWidth` 与视口均为 1280 px，没有横向溢出；节点菜单边界为 left 450 / right 702 / top 399 / bottom 568，完整位于视口内。鼠标右键后“打开内容”获得初始焦点，`Escape` 返回原节点，`Shift+F10` 可再次打开同一菜单。
- `ui-ux-pro-max` 的可发现导航、渐进披露、可见焦点、键盘等价、稳定弹层、暖纸高对比和有界列表原则被采用；推荐结果中的营销单列页、超大宣传字、金色 CTA 与在线 Fredoka / Nunito 字体不符合 Knitspace 深绿、本地桌面工作台定位，未采用。
- 回归：117 个前端测试文件 / 487 项通过；类型检查、4,639 模块个人版与公开版生产构建通过。个人版首屏脚本 62.37 kB gzip、样式 80.83 kB gzip、总计 143.20 kB gzip；公开版总计 142.85 kB gzip，启动预算均通过。Public Core 405 个发布文件未发现个人路径或高置信密钥，仓库密钥扫描通过；开发进程树已停止，1421 端口确认释放。

final result: passed

## Markdown 双链进入 SQLite 关系图谱（2026-08-12）

- 全局关系页此前虽然写着支持 `[[双链]]`，实际图谱只消费手动关系；单篇反链还通过 `instr()` 扫描每篇 Markdown 正文。Schema v18 新增 `document_wiki_links` 派生索引，保存文档时在同一 SQLite 事务内解析并替换双链记录，旧 Vault 升级时一次性回填，Markdown 文件本身不被重写。
- 解析覆盖 `[[标题]]`、`[[标题#小节]]` 与 `[[标题|别名]]`。目标只按唯一、完全一致的标题解析；同名歧义与尚未创建的目标明确计数并提示，不猜测、不自动修改数据。反链查询和全局投影现在都走索引，不再为一次查看扫描所有正文。
- 图谱会合并同方向的手动关系与 Markdown 双链，避免重复计算关联度；卡片明确区分“手动关联”“Markdown 双链”和“手动关联 + 双链”，并显示出现次数与小节。右键 / `Shift+F10` 可打开双链来源、复制引用和关系摘要；仅手动关系允许删除，双链必须回到 Markdown 源文修改，防止图谱操作暗中改写笔记。
- 性能边界保持有界：原生投影最多扫描 10,000 条索引记录并返回 2,000 条，当前 UI 请求 1,000 条；节点目录仍最多 80 个、中心最多 60 条直接关系。投影只读取标题、类型、关系元数据和双链索引，不载入 Markdown 正文、图片或视觉标注载荷。
- 1280 × 720 浏览器开发版复核：页面与关系滚动区的 `clientWidth` / `scrollWidth` 均为 1280 px，没有横向溢出；演示数据中的 2 个未解析双链以约 33 px 的单行提示呈现，未撑高主要布局。暖纸背景、深绿正文、来源标签和焦点状态保持可辨。
- `ui-ux-pro-max` 的可发现入口、深链接、来源透明、空态与错误状态、键盘等价、可见焦点、有界元数据和避免深层响应式原则被采用；营销式超大标题、金色 CTA 与在线字体不符合 Knitspace 本地桌面工作台定位，未采用。
- 回归：117 个前端测试文件 / 489 项通过；Rust 75 项通过、4 项按设计忽略；类型检查、4,639 模块个人版与公开版生产构建通过。个人版首屏总计 143.26 kB gzip，公开版 142.91 kB gzip；405 个 Public Core 文件检查与仓库高置信密钥扫描通过。`git diff --check` 通过，仅有既有 LF/CRLF 工作区提示；预览进程已停止，1421 端口确认释放。

final result: passed

## 外部 Markdown 冲突审阅与无损保留（2026-08-12）

- 外部文件监听原本可以发现磁盘变化，但当前草稿也有修改时只有“覆盖磁盘”或“放弃草稿并载入”两条破坏性路径，且保存冲突只弹出文字确认，无法先看差异。现在保存检测到并发修改会暂停自动保存并打开独立冲突审阅，不再直接询问是否强制覆盖。
- 审阅页并列显示当前草稿、磁盘版本和“保留两份”安全建议，并用统一行差异呈现首个变化附近。处理选项包括继续编辑、使用磁盘版本、用草稿覆盖磁盘和保留两份；最后三项执行前都会重新读取并核对磁盘 hash，文件在审阅期间再次变化时只刷新差异并要求重新确认，不跳过并发检查。
- “保留两份”先把当前草稿逐字保存在 Vault 的独立冲突副本中，再把原关联文档载入磁盘版本。实现时发现旧“创建独立副本”使用新 ID 调用了仅更新已有实体的 `saveDocument`，实际不会插入；现新增明确的 `insertDocument` 路径，重复 ID 会失败而不是静默覆盖，普通文档右键副本与冲突副本共用这一正确入口。
- 大文档差异只在用户明确打开审阅时计算，并在独立 Worker 中完成线性首差定位与换行统计；真正的 LCS 行差异被限制在首个变化周围最多 64 行、16,000 字符，不在主线程对 1–5 MB Markdown 做全篇 O(n²) 比较。弹窗和菜单样式随 Documents 路由懒加载；首轮全局 CSS 超出 raw 门禁 666 字节后已迁回路由分块，首屏样式恢复原预算。
- 外部文件状态条现在支持鼠标右键与 `Shift+F10`，菜单提供比较版本、立即检查、资源管理器显示、复制完整路径、另存并重新关联、断开关联。`Escape` 从冲突审阅返回“比较”按钮，从菜单返回状态条，右键始终是普通点击“比较”的补充而不是唯一入口。
- 1280 × 720 桌面尺寸复核：冲突弹窗约 940 × 502 px，边界 170–1110 × 109–611；差异区 clientWidth / scrollWidth 均为 882 px，页面 clientWidth / scrollWidth 均为 1280 px。六项文件菜单约 236 × 266 px，边界 586–822 × 311–577，完整位于视口内；暖纸表面、深绿正文、暖红删除行与绿色新增行不只依赖颜色，还同时显示 `− / +` 和双行号。
- `ui-ux-pro-max` 的安全默认、错误恢复、可见焦点、键盘等价、稳定弹层、高对比、路由分块和有界大内容处理原则被采用；其营销比较表、蓝色 CTA 与在线 Caveat / Quicksand 字体不符合 Knitspace 暖纸深绿、本地桌面工作台定位，未采用。
- 回归：118 个前端测试文件 / 493 项通过；Rust 75 项通过、4 项按设计忽略；类型检查、4,643 模块个人版与公开版生产构建通过。个人版首屏总计 143.34 kB gzip，公开版 143.01 kB gzip；409 个 Public Core 发布文件与仓库高置信密钥检查通过。`git diff --check` 通过，仅有既有 LF/CRLF 工作区提示；预览进程已停止，1421 端口确认释放。

final result: passed

## Markdown 预览 DOM 增量复用（2026-08-12）

- 性能审计确认已有 Worker 解析、180–420 ms 输入合并、按可见区域加载代码高亮 / KaTeX / 本地图片、Mermaid 懒加载与 SVG 缓存，以及按安全标题边界复用 Markdown 解析结果；剩余瓶颈是 Vue `v-html` 在每次内容变化后仍整体替换已挂载 DOM，使未变化章节重复挂载并丢失已完成的增强状态。
- 新增有界的顶层 DOM 协调器：新 HTML 先在离屏 `template` 中解析，按上次原始渲染签名寻找最长未变化前缀与后缀，只移除和插入中间变化节点。比较基于上次渲染签名而不是已被高亮、Mermaid、图片加载修改过的实时 DOM，因此不会把正常的延迟增强误判成正文变化；实时顶层结构异常时安全退回完整替换。
- 未变化节点继续保留代码高亮、公式、图表、图片加载结果及节点内部状态，不再因编辑另一节而重复进入增强队列。同名重复章节按位置比较；追加内容只插入尾部；变化章节仍使用新 DOM，避免错误保留旧文字。协调器只保存短签名数组，不持有已删除 DOM 节点。
- 1280 × 720 开发版分屏实测：在最后一节输入单个字符时复用 23 个顶层节点、仅替换 1 个节点；预览即时显示新字符，撤销后正文逐字恢复。编辑器、预览、题目结构条和右侧检查器均保持布局稳定，没有横向溢出或预览空白。
- `ui-ux-pro-max` 的增量渲染、延迟重工作业、稳定内容、可见反馈和有界状态原则被采用；没有加入装饰动画、在线字体或新的常驻依赖，暖纸 / 深绿桌面视觉保持不变。
- 回归：119 个前端测试文件 / 497 项通过；类型检查、4,644 模块个人版与公开版生产构建通过。1 / 3 / 5 MB Markdown 冷解析平均 20.5 / 34.1 / 58.3 ms，热预览平均 3.1 / 6.8 / 11 ms，编辑投影中位数 0.6 / 0.4 / 0.7 ms，全部通过性能门禁；个人版首屏总计 143.34 kB gzip，公开版 143.01 kB gzip；411 个 Public Core 发布文件未发现个人路径或高置信密钥。

final result: passed

## 结构化单词本机朗读闭环（2026-08-12）

- 结构化单词已经保存音标、词形、多词义、例句、搭配与独立 FSRS 卡片，但“读音”此前只是文本字段，学习时仍要离开 Knitspace 查发音。现在词条标题旁常驻“朗读 / 停止”按钮，列表行的鼠标右键或 `Shift+F10` 菜单也暴露同一操作，不依赖今天页或搜索入口。
- 朗读只使用 WebView / Windows 提供的本机 Speech Synthesis，不下载音频、不请求第三方词典、不写入 Vault。英语、日语、中文和韩语标签映射为稳定 BCP-47 locale；未知标签使用系统默认语音。朗读正文只取当前可见草稿的 lemma，不会把释义、例句或未保存内容之外的数据发送出去。
- 连续点击同一词条会停止当前朗读；开始新词前先取消旧队列，异步结束与错误按 revision 隔离，旧回调不会清掉新词的状态。离开页面只在本页正在朗读时取消，长词表仍沿用 60 px 固定行高虚拟窗口，没有为每行创建音频对象、监听器或响应式语音状态。
- 1280 × 720 开发版检查：标题、音标、语言、朗读、保存和更多操作保持同一紧凑头部；首轮“朗读”被压成两行，修复为不可收缩单行按钮后布局稳定。右键与 `Shift+F10` 均能打开包含“朗读单词 · 本机”的菜单，首项自动聚焦，菜单完整位于视口内。
- `ui-ux-pro-max` 的功能就地暴露、键盘等价、清楚状态、本地隐私、可见焦点、减少动态与路由懒加载原则被采用；按钮样式随 VocabularyView 路由独立分块，没有进入首屏 CSS，也没有加入在线字体、音频包或常驻依赖。
- 回归：120 个前端测试文件 / 500 项通过；类型检查、4,646 模块个人版与公开版生产构建通过。朗读语言映射、未知语言回退和只朗读 lemma 有独立测试覆盖；个人版首屏约 143.36 kB gzip，公开版 143.02 kB gzip；413 个 Public Core 发布文件未发现个人路径或高置信密钥。

final result: passed
## 单词复习答案边界与本机朗读（2026-08-12）

- 单词复习审计发现，拼写卡与例句填空卡虽然正文没有直接展示原词，但翻面前的卡片标题、音标、区域无障碍名称和右键菜单标题仍会暴露答案；右键中的“复制完整单词 Markdown”还可绕过翻面直接复制完整词条。现在标题、音标、朗读、菜单名称和复制内容统一由同一个“答案是否可见”边界驱动：词义卡以单词为题面，可直接朗读；拼写与例句卡只有翻面后才显示原词、音标与完整复制入口。
- 例句挖空不再在匹配失败时原样返回句子。英文原形会同时遮蔽常见后缀形式，非拉丁文字按文字本身替换；确实无法可靠定位答案时显示补充例句提示，避免通过未挖空的原句泄露答案。
- 单词库与复习页共用轻量本机朗读控制器。复习卡翻面后提供可见“朗读 / 停止”按钮、右键菜单项和 `P` 快捷键；切换卡片、重置队列、重新盖牌或离开页面时自动取消当前 utterance，异步结束事件用 revision 隔离，不会把下一张卡的状态清空。朗读只在明确操作后创建，不预加载语音、网络资源或大对象。
- 1280 × 720 本地浏览器实际走查：词义卡正面显示朗读；拼写卡正面区域和 `Shift+F10` 菜单均不含测试词 `serendipity`、音标或朗读入口，菜单只允许复制当前题面；翻面后这些内容与完整 Markdown 入口同时出现，按 `P` 后按钮立即切换为“停止朗读”。页面与文档宽度均为 1280 px，无横向溢出；复习卡为 920 × 450 px，菜单为 216 × 218 px，完整位于视口内。
- `ui-ux-pro-max` 的键盘等价、可见焦点、操作可发现性、高对比和减少动态状态原则被采用；搜索结果中的营销比较页、酒红 / 金色配色、在线 Atkinson 字体和大幅滚动动画不符合 Knitspace 暖纸、深绿、本地桌面工作台定位，未采用。复习专属样式仍随路由懒加载，共享朗读逻辑生成独立约 0.99 kB gzip 的按需块，未进入首屏。
- 回归：120 个前端测试文件 / 502 项通过；类型检查、4,647 模块个人版与公开版生产构建通过；首屏脚本 62.56 kB gzip、样式 80.83 kB gzip、总计 143.40 kB gzip，启动预算通过；414 个 Public Core 发布文件未发现个人路径或高置信密钥。
## 单词复习主动回忆输入闭环（2026-08-12）

- 拼写卡与可安全挖空的例句卡不再只有“心里想一下再翻面”：题面内新增单行作答、显式“检查答案”和 `Enter` 键盘入口。输入框在进入对应卡片或重新作答时自动获得焦点；输入只保留在当前组件的扁平 `ref` 中，换卡、评分、暂缓、重置或离开页面都会清空，不写入 SQLite、Vault、localStorage、复习历史或导出内容。
- 答案比较先做 NFKC、大小写、首尾标点、曲直撇号和连续空格归一化，因此全角 `Ｓｅｒｅｎｄｉｐｉｔｙ。` 可正确匹配 `serendipity`，但 `runner` 不会被误判为 `running`。例句卡由同一次正则匹配同时生成挖空题面和标准答案，`run` 在 “She is running quickly.” 中会要求实际被挖掉的 `running`；找不到可靠匹配时仍只显示安全提示，不回退到可能泄露答案的原句。
- 检查后使用图标、文字和颜色共同反馈“拼写正确 / 再看一眼正确形式 / 已直接揭晓”，并明确显示用户原答案；系统不根据字符串匹配自动替用户选择 FSRS 等级。翻面后正文只在卡片内部无动画滚动到反馈起点，评分区继续固定在首屏；长例句、释义和搭配仍由有界正文区承载。
- 翻面后可通过右键 / `Shift+F10` 菜单中的“重新作答”或 `R` 快捷键重新盖牌、清空输入并把焦点送回输入框。输入框自身的右键事件不冒泡到卡片菜单，保留系统文本编辑上下文；显式 Enter 处理会跳过 IME `isComposing` 状态，避免中文候选确认时误翻面。
- 1280 × 720 本地浏览器实际走查覆盖空输入、错误输入、正确输入、全角与标点归一化、右键重答和 `R` 重答。输入卡自动焦点为 `#word-review-answer`；翻面后反馈完整落在正文可见区域，正文 clientHeight 180 px / scrollHeight 482 px，复习卡保持 920 × 450 px，评分按钮始终可见；页面和文档宽度均为 1280 px，无横向溢出。展开后的卡片菜单为 216 × 254 px，完整位于视口内。
- `ui-ux-pro-max` 的内联反馈、键盘顺序、可见焦点、错误信息不能只依赖颜色与 4.5:1 对比原则被采用；搜索结果中的儿童化 Claymorphism、靛蓝 / 橙色、在线 Fredoka / Nunito 字体和软按压动画不符合 Knitspace 暖纸、深绿、本地桌面工作台定位，未采用。新增样式继续随 ReviewView 路由加载，不进入全局首屏 CSS；答案归一化和挖空均是当前卡片上的短字符串纯函数，没有网络、持久化或深层响应式开销。
- 回归：120 个前端测试文件 / 505 项通过；类型检查、4,647 模块个人版与公开版生产构建通过；首屏脚本 62.55 kB gzip、样式 80.83 kB gzip、总计 143.39 kB gzip，启动预算通过；414 个 Public Core 发布文件未发现个人路径或高置信密钥。

## 题目复习主动回忆与答案对照（2026-08-12）

- 题目 / 错因卡不再只有“想一下再翻面”：题干下方提供本次作答草稿，答案卡提示写结论、步骤或复杂度，错因卡提示写遗漏点与避免原则；`Ctrl / ⌘ + Enter` 或固定在卡片底部的“对照答案”翻面。草稿最多 8,000 字符，只存在当前组件的扁平 `ref`，换卡、评分、暂缓、切换队列或重置都会清空，不写入 SQLite、Vault、localStorage 或复习历史。
- 翻面后先以纯文本呈现“我的本次作答”，再显示结构化正确答案与解析，避免每次键入触发 Markdown、公式、代码高亮或图表渲染；系统不会自动比较开放题答案，也不会替用户选择 FSRS 等级。复制已翻开的题目卡时会显式包含本次作答，未翻开时仍只复制题面。
- 卡片右键 / `Shift+F10` 在有草稿时显示“清空本次作答”，翻面后显示“重新作答 · R”；执行后清空草稿、重新盖牌并把焦点送回输入框。输入框自身保留系统文本右键菜单，不冒泡到卡片菜单；IME 合成时不会被组合键误翻面。
- 首轮 1280 × 720 走查发现短题仍被通用 175 px 题面最小高度撑开，输入框要先滚动才可见；题目主动回忆态现改为 104 px 的短题最小题面，并把两个翻面动作固定在 footer。长题仍只滚动卡片正文，不撑开页面；初始正文 clientHeight 219 px / scrollHeight 261 px，翻面后 177 px / 488 px，评分区始终可见。页面 clientWidth / scrollWidth 均为 1280 px，无横向溢出。
- 翻面后卡片菜单为 216 × 218 px，边界 left 755 / right 971 / top 360 / bottom 578，完整位于视口；初始焦点落在“在题库中打开”，`Escape`、清空和重答焦点路径均正常。浏览器控制台没有 warning 或 error。
- `ui-ux-pro-max` 的单一主任务、语义化表单、可见焦点、键盘等价、高对比、减少动效和有界长内容原则被采用；其儿童化字体、夸张营销标题、黑金 CTA 和在线字体不符合 Knitspace 暖纸深绿的大学生桌面工作台定位，未采用。新增 CSS 仍随 ReviewView 路由按需加载，未进入全局首屏样式。
- 回归：120 个前端测试文件 / 507 项通过；类型检查、4,647 模块个人版与公开版生产构建通过。首屏脚本 62.54 kB gzip、样式 80.83 kB gzip、总计 143.38 kB gzip，启动预算通过；414 个 Public Core 发布文件未发现个人路径或高置信密钥。

## 每日归档状态与可发现入口（2026-08-12）

- 审计发现原生 Vault 已有每日一致性归档和最近 7 份轮换，但应用启动后把自动归档时间写入旧的混合字段，设置页又把该字段固定解释为“上次手动备份”，造成状态不可信；同时每日归档只有后台行为，没有可见的立即检查或查看最近归档入口。
- 设置模型现在分别记录手动备份与每日归档时间。旧 `lastBackupAt` 只作为“旧版最近备份记录”兼容展示，不再猜测它来自手动还是自动操作；原生 Vault 健康信息仍是最近归档路径与时间的权威来源。JSON 快照和用户选择位置的完整归档会写入显式手动时间，启动空闲归档只写入自动时间。
- 桌面设置页新增“立即检查今日归档”和“查看最近归档”，资料库健康卡右键 / `Shift+F10` 菜单也暴露同一能力。今日归档已经存在时明确提示不会重复打包或占用额外空间；执行中统一禁用互斥的创建、恢复与每日检查操作，避免同时写入归档。
- 今天页底部把被动备份文字改为可点击状态，区分“每日归档 / 手动备份 / 最近备份”，没有记录时显示“尚无备份记录”；点击直接进入 `设置 → 数据与备份`。1280 × 720 浏览器开发版实测入口可达、目标区直接进入视野，页面 `clientWidth` / `scrollWidth` 均为 1280 px；窄于 1180 px 时隐藏这项次要状态，避免底部状态条拥挤。
- `ui-ux-pro-max` 的渐进披露、状态诚实、操作可发现、键盘等价、可见焦点、高对比和路由分块原则被采用；每日归档仍在启动后 12 秒空闲窗口执行，不阻塞 Vault 恢复或首屏。设置与今天页改动继续随路由按需加载，没有把归档逻辑或大型依赖加入首屏。
- 回归：122 个前端测试文件 / 515 项通过；Rust 每日归档 2 项通过；类型检查、4,648 模块个人版与公开版生产构建通过。首屏脚本 62.61 kB gzip、样式 80.83 kB gzip、总计 143.45 kB gzip，启动预算通过；417 个 Public Core 发布文件与仓库高置信密钥扫描通过。`git diff --check` 通过，仅有既有 LF/CRLF 工作区提示。

final result: passed
# 2026-08-12 · SQLite 一次性迁移续接与恢复入口

- 数据内核：浏览器文档、单词、关联、剪贴板、收藏与最近使用不再以“目标表为空”判断迁移完成；只要完成标记未写入，下一次启动就继续补齐。
- 冲突原则：已有 SQLite 实体优先，迁移仅插入缺失 ID；不会用浏览器旧标题覆盖桌面端新内容，也不会删除本机独有的单词或关联。
- 启动性能：移除了迁移前对文档、单词、关联的第二份完整 `localStorage` JSON 复制。原 `STORE_KEY` 保留到 SQLite 接管并成功持久化后，Vault 仍先写不可变迁移归档。
- 恢复体验：启动页显示 5 段初始化进度；错误以 `role="alert"` 宣告，并提供“重试连接 / 数据与备份”。右键或 `Shift+F10` 可打开恢复菜单，首项自动聚焦，支持复制错误详情与 Escape 返回焦点。
- 视觉验证：开发版 `#/settings?section=backup&qa=vault-migration-error` 在 1280×720 下检查；恢复条保持可见、暖纸背景与棕色正文对比明确，按钮无布局抖动。右键与键盘菜单均已实际操作，重试后告警消失并出现成功提示。
- 性能门禁：首次实现触发首屏 CSS raw 预算；通过复用既有按钮样式和压缩状态样式修正，未放宽预算。最终启动资产为 202.14 kB JS raw / 64.94 kB gzip、459.84 kB CSS raw / 80.79 kB gzip，总计 145.73 kB gzip。
- 自动验证：前端 124 个文件 / 524 项测试通过；Rust 81 项通过、4 项系统集成测试按设计忽略；个人版与 Public Core 构建通过，Public Core 420 个发布文件无个人路径或高置信密钥。
## 超大 Markdown 渐进阅读与可取消挂载（2026-08-12）

- 大型 Markdown 继续保持显式加载保护；用户确认后，Worker 不再只返回一份数 MB 的 HTML 字符串，而是优先返回按安全 ATX 标题边界渲染并缓存的章节块。主线程每个动画帧最多解析、挂载 12 节或约 96 KiB HTML，正文首屏会先变得可读，后续章节再逐步铺开。
- 短文档标题会合并到首个实质章节，不会因为 `# 标题` 不足 96 字符而使整篇长文退回一次性挂载；跨章节引用式链接、未闭合围栏或其他不能安全切分的文档继续走完整解析路径，优先保证 Markdown 语义正确。
- 状态卡分为“分析文档排版”和“铺开阅读内容”两阶段；后者显示百分比、已载入章节数和稳定进度条。停止加载、返回轻量模式、切换文档或组件卸载都会取消未执行的动画帧并清理渐进 DOM，不让旧文档在后台继续占用主线程。
- 轻量保护页和状态卡都可聚焦；右键、菜单键或 `Shift+F10` 打开“大文档阅读”菜单，支持渐进加载、停止 / 返回轻量模式和返回源码。菜单首项聚焦、方向键与 Escape 沿用统一桌面菜单行为，焦点轮廓和进度条同时遵守 reduced-motion。
- 1280 × 720 浏览器开发版使用约 1,005,631 字符、240 节的临时 Markdown 实测：500 ms 时首屏已可阅读且状态为 30%（72 / 240 节），完整铺开约 1.7 秒；加载中点击停止后立即回到轻量页，`data-preview-progressive` 残留为 0。进度卡、纸张正文、右键菜单与底部状态栏没有横向溢出或视口截断；临时笔记随后通过应用自己的删除确认流程清理。
- 回归证据：前端 126 个文件 / 530 项测试通过；Rust 81 项通过、4 项环境测试忽略；5 MB Markdown 冷解析 73.3 ms、热预览 13.3 ms、编辑投影中位数 1 ms；个人构建、Public Core 构建与 423 文件发布安全检查通过。新增页面样式保持在懒加载的 `DocumentsView` 块中，首屏总量 145.67 KiB gzip，启动预算通过。

## 题目来源识别与跨空间返回（2026-08-12）

- 题目“来源 / 出处”现在统一识别普通说明、HTTP(S) 网页、Markdown 链接、本地 Markdown 与本地文件；危险协议、相对路径和含糊文本保持为不可执行文字。复习引用会转义普通文本，只为通过安全分类的来源生成链接。
- 资料库检查器会明确说明来源类型并提供“打开来源网页 / 在 Knitspace 打开 / 使用系统打开”；题目结构右键菜单同步提供复制与打开。网页交给系统浏览器，本地 Markdown 通过短时且不暴露敏感路径的交接返回 Knitspace，其他本地文件只在桌面壳中交给系统。
- 复习卡正反面都接通 Markdown 链接事件，来源可以直接打开；卡片右键 / `Shift+F10` 同样提供复制、打开来源和返回来源资料。菜单首项可聚焦，危险或浏览器环境不支持的目标只提示原因，不静默失败。
- 1280 × 720 开发版实测：检查器能把 `LeetCode 704：https://…` 识别为网页并显示可见动作；题目菜单 244 × 362 px（left 917 / right 1161 / top 334 / bottom 696），复习菜单 216 × 254 px（left 755 / right 971 / top 398 / bottom 652），均未越出视口。来源在复习正面渲染为可访问链接，页面 clientWidth / scrollWidth 均为 1280 px，控制台无 warning 或 error；测试数据已还原。
- `ui-ux-pro-max` 的渐进披露、真实标签、键盘等价、可见焦点、高对比和本地优先性能原则被采用；与现有暖纸深绿桌面语言冲突的营销式大标题、在线字体与多余动效未采用。首次构建发现 CSS raw 超预算 736 字节，随后通过复用既有题目表单与按钮样式修正，没有放宽预算。
- 回归：前端 128 个文件 / 537 项测试通过；Rust 81 项通过、4 项环境测试忽略；个人版和 Public Core 生产构建通过。首屏脚本 66.47 kB gzip、样式 80.80 kB gzip、总计 147.27 kB gzip，启动预算通过；426 个 Public Core 发布文件未发现个人路径或高置信密钥。

## AI 凭据、连接检查与可取消请求（2026-08-12）

- 审计发现 `keyring` 3.x 未显式启用平台后端时会在 Windows 使用进程内模拟存储，造成页面显示“系统凭据已保存”，但 Rust 热重载后真实请求找不到 Key。依赖现已启用 `windows-native`，写入后立即回读校验；每次连接检查前也会核实凭据是否存在，并把失效状态同步回配置卡。
- 设置页为每个 AI 配置增加最小连接检查、工作中停止、成功耗时和原始错误反馈；右键 / `Shift+F10` 菜单提供测试、编辑、复制不含 Key 的诊断以及用当前配置打开 AI 工作台。菜单在 1242 × 820 桌面窗口内完整可见，首项聚焦，Escape 可关闭。
- 原生 AI 请求使用独立请求 ID、可中止任务和 120 秒超时；AI 内容工作台与编辑器助手都提供“停止等待”，卸载组件也会取消未完成请求，避免后台悬挂和迟到结果写回旧页面。
- Windows 开发版使用 DeepSeek `deepseek-v4-flash` 实测：最小连接检查 0.9 秒成功；短文本“提炼摘要”能生成可编辑 Markdown 草稿；生成中立即停止后，页面与系统通知均显示“AI 请求已取消”。Key 只进入 Windows 凭据管理器，未进入源码、Vault、Markdown、测试日志或诊断文本。
- `ui-ux-pro-max` 的渐进披露、非颜色状态提示、键盘等价、可见停止动作和本地优先原则被采用；连接测试只发送固定的最小检查文本，不发送笔记，测试回复也不保存。
- 回归：前端 129 个文件 / 542 项测试通过；Rust 81 项通过、4 项环境测试忽略；类型检查、个人版与 Public Core 生产构建通过。首屏脚本 66.58 kB gzip、样式 80.80 kB gzip、总计 147.38 kB gzip，启动预算通过；427 个 Public Core 发布文件未发现个人路径或高置信密钥。
