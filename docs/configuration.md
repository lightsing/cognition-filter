# 配置参考与 HTTP API

本文档提供 **认知滤网（Cognition Filter）** 的本地数据文件规范、配置项说明、环境变量参考、并发限流策略以及本地 Rust Agent 的完整 HTTP API 手册。

---

## 1. 本地数据目录

Agent 将所有用户持久化数据保存在本地数据目录中：

- **默认路径（Windows）**：`%LOCALAPPDATA%\CognitionFilter`
- **默认路径（Linux / macOS）**：依次回退 `$XDG_STATE_HOME/CognitionFilter` → `$HOME/CognitionFilter` → `./CognitionFilter`
- **自定义路径**：通过环境变量 `COGNITION_FILTER_DIR` 指定。

### 数据目录文件清单

| 文件名 | 用途 | 备注 |
| --- | --- | --- |
| `runtime.json` | 模型接口、API Key、全局与站点并发覆盖配置、自动「不感兴趣」站点列表 | 首次启动自动创建；**包含明文 API Key**，Unix 下权限自动设为 `0600` |
| `rules.json` | 用户规则组（`groups`）与反馈纠错样本（`examples`，最多保留 512 条） | 首次启动从内置 `config/default-rules.json` 初始化 |
| `pairing-token` | 48 位小写十六进制本机配对口令（24 字节操作系统随机数） | 首次启动生成，用于站点脚本配对与 HMAC 签名 |
| `disabled-plugins.json` | 已禁用的站点插件 ID 列表 | 跨重启持久化禁用状态 |
| `statistics.json` | 历史累计过滤统计与各网站 token 用量 | 每 5 秒检查变更落盘，正常退出时再保存一次；不含任何卡片正文或封面 |
| `agent.lock` | 单实例文件锁 | 防止同一数据目录并发运行多个 Agent 进程 |

> 默认规则模板 `config/default-rules.json`、提示词模板 `config/prompts.json`（当前版本 `site-card-15`）以及默认运行配置 `config/runtime.json` 均在编译期嵌入可执行文件。

---

## 2. `runtime.json` 配置参考

首次启动时生成的默认内容来自 [config/runtime.json](../config/runtime.json)：

```json
{
  "model": "deepseek-flash",
  "endpoint": "https://api.deepseek.com",
  "apiKey": "",
  "providerLimits": { "deepseek-flash": 2500 },
  "modelConcurrency": 64,
  "siteScheduling": {},
  "batchSize": 1
}
```

### 字段说明

| 字段 | 类型 | 默认值 | 说明与校验规则 |
| --- | --- | --- | --- |
| `model` | `string` | `"deepseek-flash"` | 模型接口标识，随请求 `model` 字段发往服务商 |
| `endpoint` | `string` | `"https://api.deepseek.com"` | 模型服务基础地址（自动追加 `/chat/completions`）。最长 2048 字符；外部地址须为 `https`，本机地址（`127.0.0.1`、`localhost`、`[::1]`）允许 `http`；不可含凭据、查询参数或片段 |
| `apiKey` | `string` | `""` | 模型服务商 API Key（明文保存） |
| `modelConcurrency` | `integer` | `64` | 全局同时进行的模型请求数上限，范围 `1–2500` |
| `providerLimits` | `object` | `{"deepseek-flash": 2500}` | 按模型名设置的并发上限映射（每项 `1–2500`）。实际模型并发取 `min(modelConcurrency, providerLimits[model])` |
| `siteScheduling` | `object` | `{}` | 按站点 ID 保存的并发覆盖配置，例如 `{"bilibili": {"coverConcurrency": 48, "browserConcurrency": 8}}`。其中 `coverConcurrency` 范围 `1–256`，`browserConcurrency` 范围 `1–32` |
| `notInterestedSites` | `string[]` | `[]` | 开启「对被过滤卡片自动点击『内容不感兴趣』」的站点 ID 列表（仅支持声明 `supportsNotInterested: true` 的插件，如 `bilibili`） |
| `batchSize` | `integer` | `1` | 单次送审批次大小（当前逐卡送审为 `1`） |

> 通过 WebUI「配置」页保存的并发与模型设置立即生效；若手工编辑 `runtime.json`，需重启 Agent 后生效。

---

## 3. `rules.json` 结构与校验约束

`rules.json` 保存结构化的规则组与关联反馈样本：

```json
{
  "scoped": true,
  "groups": [
    {
      "id": "post-video",
      "site": "bilibili",
      "name": "网帖、问答和评论截图转视频",
      "enabled": true,
      "include": [
        "问句标题配满屏多行个人叙事或对话文字，就视为回答搬运，无需账号水印或明确写着朗读"
      ],
      "exclude": [
        "网站教程、实拍字幕、原创讲义，或偶尔引用网帖的独立讲解"
      ],
      "disabledInclude": [],
      "disabledExclude": []
    }
  ],
  "examples": []
}
```

### 字段校验约束

- **规则组数量**：最多 `24` 组。
- **`id`**：1–80 位，仅允许 ASCII 字母、数字、`-` 与 `_`，且组间不可重复。
- **`site`**：`null` 或省略表示全局生效；填写字符串时必须为合法站点 ID（1–64 位小写字母、数字或连字符）。
- **`name`**：非空，最多 `60` 个字符。
- **`include`（命中要点）**：每组 `1–8` 条，每条非空且最多 `160` 个字符（旧版迁移的 `legacy-*` 组放宽至 `280` 字符）。
- **`exclude`（保留例外）**：每组 `0–8` 条，每条非空且最多 `160` 个字符。
- **`disabledInclude` / `disabledExclude`**：分别必须为对应 `include` / `exclude` 的子集，用于在保留文本的同时临时禁用单条要点。
- **`examples`**：记录纠错生成的样本摘要，仅保留仍对应有效规则组与有效要点的记录，上限 `512` 条。

---

## 4. 环境变量参考

| 环境变量 | 适用范围 | 用途 |
| --- | --- | --- |
| `COGNITION_API_KEY` | 本地 Agent | 首次运行或迁移旧配置时初始化 API Key（优先级高于 `DEEPSEEK_API_KEY`） |
| `DEEPSEEK_API_KEY` | 本地 Agent / 评测脚本 | 使用 DeepSeek 官方服务时初始化 API Key；也是 `eval/compare.mjs --live` 的默认密钥来源 |
| `COGNITION_MODEL` | 本地 Agent | 首次运行或迁移时初始化模型标识（默认 `deepseek-flash`） |
| `COGNITION_API_BASE` | 本地 Agent | 首次运行或迁移时初始化模型服务基础地址（默认 `https://api.deepseek.com`） |
| `COGNITION_FILTER_DIR` | 本地 Agent | 自定义本地数据目录路径 |
| `BROWSER_BIN` | 浏览器回归测试 | 指定 `test/userscript.test.mjs` / `test/settings.test.mjs` 使用的 Chrome / Edge 可执行文件路径 |
| `DEEPSEEK_MODEL` | 提示词评测脚本 | 在 `eval/compare.mjs --live` 中单独指定评测使用的模型名称 |

---

## 5. 并发调度、限流与退避策略

| 层级 | 配置项 | 默认值 | 说明 |
| --- | --- | ---: | --- |
| 浏览器单页送审并发 | 站点 `browserConcurrency` | B 站 `8` / X `8` | 单个网页标签页同时在途的 `/v1/classify` 请求数（`1–32`） |
| 站点备用封面并发 | 站点 `coverConcurrency` | B 站 `48` / X `16` | 同一站点所有标签页共享的本地 Agent 备用下载并发数（`1–256`） |
| 全局模型调用并发 | `modelConcurrency` & `providerLimits` | `64` / `2500` | 所有站点共享的模型请求并发数，取两者较小值（`1–2500`） |
| 反馈反思并发 | 内置信号量 | `6` | 同时执行误杀/选卡反馈分析的最大请求数 |

### 429 限流与重试机制

- 遇到模型服务商返回 `HTTP 429` 时，同一模型的并发请求共享冷却窗口。
- 请求采用约 `0.5s`、`1s` 的指数退避并叠加随机抖动，最多额外重试 **2 次**；若服务端返回更长的 `Retry-After` 头，则优先遵守服务端指定时间。
- 封面读取与模型调用各自设有总截止时间；超出预算的卡片保持待判定遮盖状态，不会错误放行。

---

## 6. 本地 Agent HTTP API 参考

Agent 仅监听 `http://127.0.0.1:<port>`。所有请求必须满足 `Host: 127.0.0.1:<port>`，否则返回 `403 Forbidden`。默认请求体上限 `512 KiB`（`/v1/classify` 放宽至 `1 MiB`）。

### 6.1 公共发现与页面端点（无需 Bearer Token）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/.well-known/cognition-filter?nonce=<32位hex>` | 端口自动发现与质询验证。返回 `{service, protocol, port, proof}`，其中 `proof = HMAC-SHA256(token, "cognition-filter/v1\|{port}\|{nonce}")` |
| `GET` | `/` | WebUI 配对页（展示本机配对口令与站点脚本安装链接） |
| `GET` | `/settings` | WebUI 配置与站点插件管理页 |
| `GET` | `/rules` | WebUI 过滤规则编辑页 |
| `GET` | `/stats` | WebUI 过滤统计与各网站用量页 |
| `GET` | `/plugins/{site}/cognition-filter.user.js` | 分发指定站点插件的油猴脚本（已自动注入公共客户端与页面策略快照） |
| `GET` | `/cognition-filter.user.js` | B 站兼容旧安装地址 |

### 6.2 站点脚本 API（需站点配对鉴权）

鉴权头：`Authorization: CF-Port <HMAC-SHA256(token, "cognition-filter/auth/v1|{port}")>`（在默认端口 `17321` 上兼容 `Bearer <token>`）。  
站点标识头：`X-Cognition-Filter-Site: <siteId>`（省略时走 `bilibili` 兼容路径；未知站点返回 `404`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/rules` | 获取当前站点生效的规则组（全局 + 本站）、规则版本 `revision`、站点并发配置 `scheduling`、页面策略 `pagePolicy`、站点启用状态 `siteEnabled` 与自动「不感兴趣」开关 |
| `PUT` | `/v1/rules` | 按版本号 `revision` 保存规则组（并发版本冲突返回 `409 Conflict`；已禁用站点返回 `403 Forbidden`） |
| `POST` | `/v1/classify` | 提交卡片（每批 1–8 张，当前逐卡提交为 1 张）进行语义判定。返回各卡的 `{id, decision, rule?, matchedGroups?, message?, retryWhenCoverLoads?}`，`decision` 为 `allow` / `block` / `pending` |
| `POST` | `/v1/feedback` | 对刚判定的被拦卡片报告「误杀」，调用模型分析并自动补充保留例外，返回分析原因、新增要点与新 `revision` |
| `POST` | `/v1/pick` | 主动屏蔽漏网卡片，归入已有规则组（自动分析补充命中要点）或提交 `newGroup` 新建组 |
| `GET` | `/v1/status` | 返回服务运行状态、调度参数、总输入/输出/缓存命中 token，以及单列的预热指标（`warmupCalls`、`warmupInputTokens`、`warmupOutputTokens`、`warmupHitTokens`、`warmupFailures`） |

### 6.3 WebUI 管理 API（需本机 Session Token 鉴权）

鉴权头：`Authorization: Bearer <settings_token>`（由本地 WebUI 页面注入；携带非本机 `Origin` 头时返回 `403 Forbidden`）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/v1/config` | 读取当前模型地址、模型名、API Key 是否已设置（不返回明文）及并发配置 |
| `PUT` | `/v1/config` | 更新模型配置、API Key（留空则沿用旧值）与全局并发参数，触发后端平滑切换 |
| `GET` | `/v1/admin/rules` | 读取全量规则组（含所有站点）与版本号 |
| `PUT` | `/v1/admin/rules` | 保存全量规则组并触发受影响站点重新预热 |
| `GET` | `/v1/stats` | 读取本次运行与历史累计统计数据（全局汇总、按规则统计、按网站用量） |
| `GET` | `/v1/plugins` | 列出已加载和加载失败的所有站点插件清单、启用状态、脚本版本与并发覆盖配置 |
| `POST` | `/v1/plugins/scan` | 重新扫描 `plugins/` 目录，发现并加载新增的站点插件 DLL |
| `PUT` | `/v1/plugins/{site}/enabled` | 启用或禁用指定站点插件（请求体 `{"enabled": true/false}`） |
| `POST` | `/v1/plugins/{site}/reload` | 从原路径热重载指定站点 DLL，校验通过后切换快照，失败则保留原版 |
| `PUT` | `/v1/plugins/{site}/scheduling` | 保存或重置指定站点的 `browserConcurrency` 与 `coverConcurrency` 覆盖值 |
| `PUT` | `/v1/plugins/{site}/not-interested` | 开启或关闭指定站点的自动点击「内容不感兴趣」功能 |
