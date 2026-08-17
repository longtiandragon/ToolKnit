# 受限网页抓取威胁模型

更新日期：2026-08-18（Asia/Shanghai）

## 边界与目标

此能力只为“用户明确输入一个公开 HTTPS 网页 → 获取有限 HTML → 在本机提取正文 → 用户确认后存为笔记”服务。它不是通用下载器、浏览器、代理或爬虫，不执行 JavaScript，不携带登录态、Cookie、凭据、自定义 Header 或来源页信息。

前端不能直接抓取。所有网络访问由 Rust 命令执行，并且每个 HTML/图片 URL 都经过同一套校验、DNS 解析、IP 审核和连接固定流程。

## 主要威胁与控制

| 威胁 | 控制 | 失败方式 |
| --- | --- | --- |
| `file:`、`http:`、自定义协议访问本机或明文网络 | 只接受 `https:` | 请求前拒绝 |
| URL 内用户名/密码、非标准端口 | 禁止用户信息，只允许 443 | 请求前拒绝 |
| SSRF 到 localhost、局域网、链路本地、保留或文档地址 | 解析全部 A/AAAA；任一地址不是公开单播即整体拒绝 | 请求前拒绝 |
| DNS 重绑定 / 检查后换地址 | 审核解析结果后，用 reqwest 的域名解析覆盖把连接固定到已审核地址 | 不让 HTTP 客户端再次自由解析 |
| 重定向绕过 | 禁用自动重定向，不跟随 `Location` | 提示用户粘贴最终 HTTPS 地址 |
| 慢连接或不结束的响应 | 连接与整体请求超时 | 中止并报错 |
| 超大 HTML、伪造 `Content-Length` | 先检查长度，再分块读取，HTML 上限 2 MiB | 超限立即停止 |
| 压缩炸弹 | 请求 `identity`，拒绝非 identity `Content-Encoding` | 不解压响应 |
| 类型伪装 | HTML 只接受 `text/html` / `application/xhtml+xml`；图片使用 MIME 白名单并核对文件签名与尺寸 | 类型不符即拒绝 |
| HTML 主动内容 | HTML 只作为字符串交给现有解析器；丢弃 script/style/iframe 等，不插入 DOM，不执行事件属性 | 仅生成可编辑 Markdown |
| 跟踪像素和批量图片滥用 | 图片本地化默认不勾选；只处理正文候选内用户确认的有限图片，限制单张、总量和数量 | 单图失败不改写其链接 |
| 路径穿越与覆盖 | 下载写入本次运行独占的应用缓存目录，固定安全文件名；再复用 Vault 图片导入器做哈希、尺寸、文档归属和目标路径校验；临时目录始终清理 | 不接受远端文件名作为磁盘路径，不覆盖现有资源 |
| 私密数据意外外发 | 请求不发送 Vault、笔记、剪贴板或用户路径；图片抓取只访问用户确认的正文图片 URL | UI 明示将访问的主机与图片数量 |

## 明确不支持

- HTTP、FTP、`file:`、data URL、IPFS 或自定义协议。
- 登录后页面、Cookie、Basic/Bearer 凭据、自定义请求头。
- JavaScript 渲染、验证码、反爬绕过、站点批量抓取。
- 自动跟随重定向。
- SVG 等可能包含主动内容的图片。
- 将抓取成功等同于内容可信、无版权限制或无恶意信息。

## 验收

1. 单元测试覆盖协议、凭据、端口、IPv4/IPv6 内网与保留地址、混合 DNS 结果、类型和大小上限。
2. 使用本地监听服务验证 `127.0.0.1`、`::1` 和重定向目标在发请求前被拒绝。
3. 使用公开 HTTPS 测试页验证 HTML 分块读取、正文预览与无脚本执行。
4. 图片本地化验证成功、部分失败、超限、格式伪装、重启后预览和 Vault 备份恢复。
5. Public Core 构建、Rust 测试/Clippy、前端测试、启动预算和真实交互驱动全部通过。

## 设计依据

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)：协议白名单、全部 DNS 结果审核、重绑定与重定向风险。
- [reqwest redirect policy](https://docs.rs/reqwest/latest/reqwest/redirect/) 与 [ClientBuilder::resolve_to_addrs](https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html)：禁用跳转并将连接固定到已审核地址。
