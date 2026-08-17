# Knitspace Core 与 Personal Pack

## 两种构建配置

- `pnpm build` / `pnpm desktop:dev`：个人开发版，包含 Personal Pack 的清单页面与本机脚本执行器。
- `pnpm build:public`：公开前端，编译时移除 Personal Pack 路由、导航、页面 chunk 和命令桥接。
- `pnpm desktop:package:public`：GitHub 发布用桌面包，同时启用 Rust `public-core` feature，不编译私人工具执行器。
- `pnpm check:public`：只接受带有 `build-profile.json` 的公开构建，并验证 Personal Pack 模块和命令没有进入产物。

Knitspace Core 是可以公开发布的本地优先工作台；它提供 Vault、Markdown、学习复习与创作工具，也保留可供开发者参考的本机工具清单格式。公开构建不会包含清单页面或脚本执行器，也不包含你的脚本、输入文件、输出文件、路径、模型或 API Key。

## 建议的目录边界

```text
Knitspace Core（GitHub）
├── src/
├── src-tauri/
├── examples/private-tools.manifest.example.json
├── scripts/check-public-core.mjs
└── scripts/export-public-core.mjs

Knitspace Personal Pack（工作区外的私有目录）
├── personal-tools.json
├── scripts/
├── templates/
└── local-data/
```

在个人开发版中，可复制 [示例清单](examples/private-tools.manifest.example.json) 到工作区外的私有目录，再到“私人工具包”页手动选择它。清单的 `executable`、`arguments` 和字段完全由你控制；脚本必须把单个 JSON 对象写到 stdout。会修改文件的操作必须同时给出 `previewArguments`，并会先经过预览、参数一致性检查和确认对话框。

## 发布前检查

```powershell
pnpm check:release-version
pnpm test
pnpm build:public
pnpm check:public
cargo test --manifest-path src-tauri/Cargo.toml
pnpm check:rust:clippy
pnpm check:rust:clippy:public
pnpm desktop:package:public
```

`check:public` 会检查当前发布白名单中的已跟踪与未跟踪源码，以及 `dist` / Tauri 静态资源；它会拒绝 Vault、个人包、模型、私有 JSON 清单、个人用户目录和高置信度密钥内容。`.gitignore` 也默认忽略这些位置。

推送 `v*` 标签时，发布工作流还会要求标签与 `package.json`、Cargo 包和 Tauri 配置中的版本完全一致。Vite 的 `__APP_VERSION__` 直接读取 `package.json`，不再单独维护。工作流只发布 Public Core 的 NSIS 安装包，并生成只含安装包文件名的 `SHA256SUMS.txt`；在安装包所在目录可用 `sha256sum -c SHA256SUMS.txt` 校验。

当前 Windows 安装包尚未配置代码签名证书，首次下载可能触发 Microsoft Defender SmartScreen 提示。在签名与干净虚拟机安装/升级/卸载验证完成前，发布版本应标记为 Beta 或 RC，不能宣称为稳定版。

Clippy 对基线之外的所有警告使用 `-D warnings`。脚本里暂时放行的 lint 名称对应接入 Clippy 前就存在的代码债务；清理相应旧代码后应同步删除放行项，不能借此新增同类问题。

## 导出干净的公开仓库

当前开发仓库曾经记录过个人绝对路径，因此不要把它的既有 Git 历史直接发布。使用一个不存在、位于工作区外的新目录导出源码快照：

```powershell
pnpm check:public
pnpm export:public -- --output=F:\KnitspacePublic
cd F:\KnitspacePublic
git init
git add .
```

导出器只复制明确允许公开的源码和文档，不复制 `.git`、Vault、个人包、构建产物或 QA 截图，并生成 `PUBLIC_SNAPSHOT.json` 说明来源提交和 `historyIncluded: false`。`pnpm check:public-history` 可审计旧历史；它在发现旧个人路径时会失败，这是要求新建公开仓库的证据，不应通过改写当前开发历史来规避。
