# ReelFetch 快捷指令 Worker（Cloudflare Workers 版）

原项目 `backend/app/main.py` 的 `POST /api/v1/shortcut/parse` 接口的 Cloudflare Workers 移植。
**只保留快捷指令解析**，去掉 yt-dlp、任务队列、文件存储等依赖。

## 架构

### 默认行为（推荐）：解析 + 手机直连下载

```
iPhone 快捷指令
    │
    ├─ POST /api/v1/shortcut/parse  ──→  Worker（解析）
    │                                         │
    │                                      调平台接口
    │                                    （抖音 / B站）
    │
    ├─ GET CDN_URL（带 Referer 头）  ──→  抖音/B站 CDN
    │                                         │
    │                                    视频直接下载
    │
    └─ 存储到相册
```

Worker **只负责解析**，视频流量直接从 CDN 到手机。快捷指令的"获取 URL 内容"可以自定义 Referer 头，所以不需要 Worker 代理。

### 可选行为：视频流经 Worker 代理

如果某些 CDN 需要更复杂的请求头伪装，设置环境变量 `PROXY_DOWNLOADS=true`：

```
npx wrangler secret put PROXY_DOWNLOADS
# 输入 true
```

开启后，`downloads[].url` 会变成 `https://worker.com/api/media/download?url=CDN_URL`，Worker 伪装成浏览器中转视频。

## 接口

### `POST /api/v1/shortcut/parse`

请求体：

```json
{ "text": "抖音/B站分享文本或链接" }
```

请求头（可选）：`X-API-Key`

响应：与原后端 `PublicParseResponse` 对齐：

```json
{
  "success": true,
  "downloads": [
    { "kind": "video", "filename": "视频标题", "url": "https://v3-web.douyin.../video.mp4" }
  ]
}
```

**注意**：默认 `downloads[].url` 是原始 CDN 链接，快捷指令下载时必须带 Referer：
- 抖音：`Referer: https://www.douyin.com/`
- B站：`Referer: https://www.bilibili.com/`

### `GET /api/media/download?url=...&filename=...`（可选代理，需 PROXY_DOWNLOADS=true）

伪装浏览器 Referer 中转视频下载。仅在默认直连失败时使用。

## 部署

```bash
cd worker-shortcut
npm install

# 必须设置：用于响应里的 task_endpoint 字段（纯信息性，不改也没关系）
npx wrangler secret put PUBLIC_BASE_URL

# 可选
npx wrangler secret put PUBLIC_API_KEY
npx wrangler secret put DOUYIN_COOKIE        # 有值时走抖音 Detail API 获取高清实况
npx wrangler secret put PROXY_DOWNLOADS       # true = 视频流经 Worker

npx wrangler deploy
```

## 快捷指令配置（关键：加 Referer）

1. 新建快捷指令 → 开启"在共享表单中显示" → 接收"URL"和"文本"
2. 添加"获取 URL 内容"操作：
   - URL：`https://reelfetch-shortcut.<子域>.workers.dev/api/v1/shortcut/parse`
   - 方法：POST，正文：JSON
   - 字段 `text`：选择"快捷指令输入"
3. 从响应中获取 `downloads` 数组
4. 遍历 `downloads` → 取 `url` → 添加"获取 URL 内容"下载：
   - **新增 Header `Referer`，值根据链接域名填**：
     - URL 包含 `douyin`：`https://www.douyin.com/`
     - URL 包含 `bilibili` / `b23`：`https://www.bilibili.com/`
   - 这一步是关键！不加 Referer 会被 CDN 拒绝
5. 下载完成后"存储到相簿"

## 文件结构

```
worker-shortcut/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts           # 入口：路由 + shortcut_parse + media_download
    ├── security.ts        # URL 提取 + SSRF 防护（Cloudflare DoH）
    ├── models.ts          # 类型定义
    ├── a_bogus/
    │   ├── index.ts       # a_bogus 签名器（Python→TS 移植）
    │   └── sm3.ts         # 国密 SM3 哈希
    └── platforms/
        ├── douyin.ts      # 抖音：Detail API + 公开分享页 fallback
        └── bilibili.ts    # Bilibili：playurl + DASH
```

## 已知限制

- **抖音 a_bogus 算法会过期**：当前基于 Chrome 139 / 版本 29.1.0，抖音更新后需要更新魔术数字
- **抖音必须先请求短链**：iOS 快捷指令无法跟踪重定向，Worker 已代为跟随
- **B站仅支持公开视频**
- **如果 CDN 校验更严格**：设 `PROXY_DOWNLOADS=true` 回退到 Worker 代理
