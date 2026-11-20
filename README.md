# ClaudeCheck

开源、可一键自部署到 Cloudflare Workers 的 **Claude 环境与 IP 风险自检工具**。  
在登录或日常使用 Claude 前，一键排查出口地区、共享机房段、WebRTC 泄露、出口与本机时区差及 8 项浏览器本地指纹，并生成针对性排查步骤。

> **隐私说明**：所有检测均在浏览器本地完成；Cloudflare Worker 仅提供 `/api/env-check` 返回当前请求的 `request.cf` 边缘元数据，不落库、不记录日志、不需要任何 API Key 或数据库绑定。

## 一键部署到 Cloudflare Workers

零数据库、零 KV、零环境变量，Cloudflare Workers **免费额度**（10 万次/天）即可直接运行：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/gm365/ClaudeCheck)

### 为什么默认就能识别 Claude 分流出口？

`wrangler.jsonc` 默认将 Worker 命名为 `claude-check`，部署后会得到类似 `https://claude-check.<your-subdomain>.workers.dev` 的域名。  
因为域名本身包含 `claude` 关键词，如果你在代理客户端（Clash / Mihomo / Surge / Sing-box 等）里配置了 `DOMAIN-KEYWORD,claude` 规则，访问页面时 `/api/env-check` 会自动命中你的 Claude 分流节点，直接测出访问 Claude 时的真实出口。

如果你的代理只对 `claude.ai` 做了精确域名分流，也可以展开页面里的「手动核验 `claude.ai` 出口」，粘贴 `https://claude.ai/cdn-cgi/trace` 的内容完成校准。

## 终端 / Claude Code 一行自检

如果使用 Claude Code CLI 或需要在终端核验代理链路，可直接运行零依赖的 Bash 自检脚本（macOS / Linux / WSL 通用）：

```bash
curl -fsSL https://raw.githubusercontent.com/gm365/ClaudeCheck/main/scripts/check.sh | bash
```

支持传入 `--strict` 参数（检出高风险时返回非 0 退出码）：实测 `claude.ai/cdn-cgi/trace` 真实出口、机房/住宅 ASN、递归 DNS 泄露、Anthropic 核心域名真实 HTTP 状态码与延迟、终端代理环境变量及本机时区匹配。

## 检测项一览

采用**双维度独立计分（0–100，越低越安全）**，网络链路与本机环境互不混淆：

- **网络与代理风险（权重 100）**
  - 出口地区核对（权重 35）：识别是否位于 Anthropic 受限地区
  - IP 类型与纯净度（权重 25）：区分住宅宽带、云机房托管段（内置常见云/IDC/Tier-1 骨干网/VPS ASN 与住宅白名单交叉判定）及公开代理/滥用段
  - WebRTC 公网地址泄露（权重 16）：自动过滤 RFC 1918 内网段与 Clash/Mihomo Fake-IP（`198.18.0.0/15`）
  - DNS 泄露检测（权重 14）：通过随机子域探针（`bash.ws` 主源 + `edns.ip-api.com` 降级）识别递归 DNS 解析器归属地，排查本地宽带 DNS 泄露
  - Claude 域名连通性（权重 10）：实测 `claude.ai`、`api.anthropic.com`、`www.anthropic.com` 延迟
  - 出口对比视图：对照同源边缘与通用海外出口，定位分流不一致
- **本地指纹风险（权重 100）**
  - 出口与本机时区精确对照（权重 28）：按实时 UTC 偏移核对，区分跨大区错位与邻区 1 小时差
  - 浏览器语言偏好（权重 20）
  - 国产厂商特有字体（权重 14）
  - 国产壳浏览器特征（权重 12）
  - 国产终端设备型号（权重 8）
  - Intl 地区设置（权重 8）
  - 常见中文字体（权重 6，自动排除 macOS 系统预装中文字体误报）
  - 时区数值偏移（权重 4）
- **一键加固**
  - 按命中项自动生成优先排查清单
  - 支持「问 AI 加固」，把本次脱敏摘要整理成提示词，一键发送给 ChatGPT / Claude / Grok / DeepSeek / Kimi / 豆包

## 本地开发与命令行部署

需要 Node.js 20+：

```bash
npm install
npm run dev      # 本地开发（前端页面预览）
npm test         # 运行单元测试与开源隔离审计
npm run build    # 构建前端静态资源到 dist/
npm run preview  # 本地模拟 Cloudflare Worker + 静态资源（含 /api/env-check）
npm run deploy   # 构建并部署到你自己的 Cloudflare 账号
```

## 可选进阶配置

- **绑定自定义域名**：推荐绑定包含 `claude` 的子域（如 `claude-check.yourdomain.com`），继续自动命中 `DOMAIN-KEYWORD,claude` 分流规则。
- **前后端分离部署**：如果你把前端挂在无 `claude` 关键词的域名下，可以单独部署一份 Worker 到 `claude-check.yourdomain.com`，在 Worker 环境变量里设置 `ALLOWED_ORIGIN=https://your-frontend.com`，并在构建前端时传入 `VITE_CLAUDE_CHECK_ENDPOINT=https://claude-check.yourdomain.com/api/env-check`。

## 目录结构

```text
├── index.html
├── wrangler.jsonc        # Cloudflare Workers Static Assets 配置（run_worker_first: ["/api/env-check"]）
├── worker/
│   └── index.js          # /api/env-check 边缘探针 + 静态资源透传
├── scripts/
│   └── check.sh          # 终端 / Claude Code 一行自检脚本
├── src/
│   ├── App.svelte        # 应用外壳与亮/暗主题切换
│   ├── app.css           # 独立设计令牌（零外部 CSS 框架依赖）
│   └── lib/
│       ├── EnvCheck.svelte
│       ├── env-check.js  # 双维度评分与探测引擎
│       └── ai-targets.js
└── tests/
    └── env-check.test.mjs
```

## License

[MIT](./LICENSE)
