# 认知滤网站点插件开发指南（接口 v1）

在 **认知滤网（Cognition Filter）** 中，每个站点插件对应一个原生动态库（DLL），声明自己的油猴脚本、页面策略、并发默认值以及可选的封面下载策略。插件负责识别页面、提取卡片、预遮盖和显示判定结果；本地 Rust agent 负责模型调用、规则、反馈、缓存、统计和配对。

内置参考实现见 [B 站首页插件](../plugins/bilibili) 与 [X 首页时间线插件](../plugins/x)。

## 创建 DLL

在工作区以外也可以独立构建插件。下面的 crate 包含四个文件，其中 `cf-site-sdk` 的路径改为本机 SDK 目录。

```toml
# Cargo.toml
[package]
name = "cf-site-reader"
version = "0.1.0"
edition = "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
cf-site-sdk = { path = "../cognition-filter/sdk" }
```

```rust
// src/lib.rs
cf_site_sdk::export_site!(
    include_bytes!("../site.json"),
    include_bytes!("../reader.user.js"),
);
```

```json
{"id":"reader","name":"Reader 推荐","version":"0.1.0"}
```

站点 ID 使用 1–64 位小写英文字母、数字或连字符，升级时保持稳定。DLL 版本使用数字和点。可用 `scriptVersion` 单独声明脚本头的 `@version`，省略时沿用 DLL 版本。构建得到的 DLL 与 agent 使用相同的操作系统、架构。将 DLL 复制到可执行文件旁的 `plugins/`，从 WebUI 的「插件管理」点击「发现新插件」，再安装油猴脚本。Windows 示例如下。

```powershell
cargo build --release
Copy-Item target/release/cf_site_reader.dll D:/workspace/cognition-filter/dist/release/plugins/
```

agent 从该专用目录加载本机原生代码，安装来源应可信。它复制脚本和清单后卸载 DLL。单个无效插件会出现在站点列表的错误信息中，其他有效插件继续加载。相同站点 ID 按文件路径排序后保留第一个。已安装的油猴脚本由浏览器管理，用同名 DLL 覆盖旧版后，在 WebUI 点击该站点的「重新加载」，即可更新 agent 使用的站点策略。仅浏览器端执行逻辑变化时才需要更新对应站点的油猴脚本。

## 清单字段速查（`site.json`）

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | `string` | 站点稳定标识，1–64 位小写字母、数字或连字符（如 `bilibili`、`x`） |
| `name` | 是 | `string` | 站点展示名称（1–200 字符） |
| `version` | 是 | `string` | 插件版本（仅数字与点，长度小于 20，如 `0.7.1`） |
| `scriptVersion` | 否 | `string` | 油猴脚本头 `@version`，省略时沿用 `version` |
| `scheduling` | 否 | `object` | `{ coverConcurrency: 1–256, browserConcurrency: 1–32 }`，缺省为 `48` 和 `8` |
| `textPostLimit` | 否 | `integer` | 声明支持纯文字帖，指定正文 UTF-16 长度上限（`1–8192`） |
| `supportsNotInterested` | 否 | `boolean` | 是否支持在 WebUI 中开启自动点击原生「内容不感兴趣」（默认 `false`） |
| `cover` | 否 | `object` | 可选的本地 Agent 备用封面下载白名单（`hosts`、`pathPattern`、`stripFrom`、`suffix`、`referer`） |
| `pagePolicy` | 否 | `object` | 随 `/v1/rules` 下发并在脚本分发时注入的站点选择器与行为策略对象 |

## 站点参数与页面策略

DLL 清单的 `scheduling` 声明 `coverConcurrency`（1–256）和 `browserConcurrency`（1–32）。旧 DLL 缺省按 48 和 8 处理。站点的所有标签页共用自己的备用下载额度。用户可在 WebUI 的插件卡片独立保存覆盖值或恢复当前 DLL 默认值，禁用、重载和重启都会保留覆盖值。

清单可提供 `pagePolicy` 对象。agent 将它随该站点已配对的 `GET /v1/rules` 返回，并在分发脚本时将模板中的 `/* @cognition-page-policy-v1 */ null` 替换为安装时快照。B 站脚本 0.5.2 会在同步时校验并应用选择器，再把策略缓存在油猴存储中，用于下一次页面首屏遮盖。从 B 站脚本 0.5.4 起，还支持 `corsReadTimeoutMs`（500–15000 毫秒），控制跨域封面读取的等待时间。字段及当前值见 [B 站清单](../plugins/bilibili/site.json)。旧脚本可继续读取站点的送审并发和适用规则。

规则组的 `site` 为 `null` 时全局生效，填写插件清单的稳定 ID 时只对该网站生效。`GET /v1/rules` 返回全局与本站规则，以及该组合的版本号。每个 DLL 单独预热，选卡、反馈和送审使用同一站点的规则版本。

## 接入油猴脚本

文件开头使用标准油猴元数据，按站点填写 `@match`。把下面的注释标记放进脚本作用域，agent 分发时会在此处嵌入客户端，同时绑定该 DLL 的站点 ID 和脚本版本。

```javascript
// ==UserScript==
// @name         Reader · Cognition Filter
// @namespace    cognition-filter.local
// @version      0.1.0
// @match        https://reader.example/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      127.0.0.1
// ==/UserScript==
(() => {
  'use strict';
  /* @cognition-client-v1 */
  const client = createCognitionClient();
  GM_registerMenuCommand('配对本地 agent', async () => {
    const secret = prompt('输入配对口令')?.trim();
    if (secret) await client.pair(secret);
  });

  // 由站点的卡片调度器在取得封面后调用，current 检查节点仍对应原卡片。
  async function reviewCard(id, title, author, pageCover, revision, current) {
    return client.review({ id, title, author, pageCover }, revision, current);
  }
  // 在首页加载或规则变化时通过 client.rules() 读取 revision 和 scheduling.browserConcurrency。
  // 页面遮盖、节点回收、用户反馈，以及调用 reviewCard 的位置见 B 站实现。
})();
```

| 方法 | 返回值和用途 |
| --- | --- |
| `pair(secret)` | 验证 agent 后保存配对凭据。 |
| `rules()` | 返回 `groups`、`revision`、`scheduling`。一页可按 `browserConcurrency` 并发。 |
| `review(card, revision, stillValid?)` | 一张卡、一个请求。返回 `{id, decision, rule?, matchedGroups?, message?, retryWhenCoverLoads?}`。`decision` 取 `allow`、`block` 或 `pending`。 |
| `rulesPageUrl()` | 返回经本次配对验证的规则页地址。脚本可用 `GM_openInTab` 在新标签页打开。B 站 DLL 随包提供此客户端。 |
| `report(card, revision, stillValid?, retrying?)` | 对刚判定的卡片报告误杀，返回分析、修正及新规则版本。 |
| `pick({card, revision, groupId}, stillValid?, retrying?)` | 把卡片归入已有组。创建组时改传 `newGroup`，其中包含 `id, name, enabled, include, exclude`。 |
| `saveRules(groups, revision)` | 按版本保存共享规则。并发编辑遇到 HTTP 409 时重新读取。 |

`card.id` 使用站内稳定标识，最长 128 个 UTF-16 单元。`title`、`author` 默认分别最多 512、128 个单元。`pageCover` 使用页面缩略图的 `data:image/jpeg;base64,...`，完整字符串最大 96 KiB。`cover` 为可选的原封面 URL。默认需要封面。文字型插件可用清单字段 `textPostLimit` 声明支持纯文字帖，其值为正文 UTF-16 长度上限（1–8192）。对于没有媒体且正文非空的帖子，送审及反馈只发送文字。存在媒体时仍提交缩略图或受支持的备用地址。X 插件的实现见 [plugins/x](../plugins/x)。重试时 `stillValid()` 用于校验当前页面与卡片；旧结果返回后，脚本也应再次检查节点。B 站实现还为客户端传入 `generation()` 和 `current(body)`，用于页面换代和规则版本检查。

## 可选的封面源

新站点可以只发页面缩略图。需要备用下载时，在清单中添加 `cover`，例如：

```json
{
  "hosts": ["images.reader.example"],
  "pathPattern": "/thumbs/[a-zA-Z0-9_-]+[.]jpg",
  "referer": "https://reader.example/"
}
```

`hosts` 精确匹配，`pathPattern` 匹配完整 URL 路径。可选的 `stripFrom` 指定一个字符，先截去它及其后的路径片段，再校验路径；`suffix` 在校验后追加。下载统一使用 HTTPS，无 URL 凭据、显式非默认端口、查询参数或片段，需要签名查询参数的站点应传页面缩略图。

## 其他语言与 HTTP

C 或 C++ 插件包含 [cf_site.h](../sdk/cf_site.h)，导出 `cf_site_resource_v1(kind, &length)`。资源 0 返回 UTF-8 清单，最多 64 KiB；资源 1 返回 UTF-8 脚本，最多 2 MiB。长度按字节计算，不含结尾 NUL。内存由插件持有，至少到 DLL 卸载时有效，不向宿主传递需要释放的堆对象。

站点脚本安装地址为 `/plugins/{id}/cognition-filter.user.js`。公共客户端访问已配对的 `/v1/rules`、`/v1/classify`、`/v1/feedback`、`/v1/pick`，自动携带 `X-Cognition-Filter-Site` 并处理探测与退避。未知站点返回 404。旧版脚本缺省站点头时走 B 站兼容路径，保留历史反馈指纹与原安装地址。

## 启用状态

已配对的脚本通过 `rules()` 同步状态。当 `siteEnabled === false` 时，应停止送审、撤掉该站点的遮盖和悬浮按钮，并保留规则同步，以便重新启用时恢复。正常规则响应兼容省略该字段。用户回到页面或前台定时同步时检查即可。已禁用站点的规则写入和反馈请求返回 403。agent 在切换 DLL 时继续完成已经接受的请求；新请求使用新快照。

WebUI 使用设置页管理凭据访问 `GET /v1/plugins`、`POST /v1/plugins/scan`、`PUT /v1/plugins/{id}/enabled`（JSON 字段 `enabled`）和 `POST /v1/plugins/{id}/reload`。重新加载只读取注册时的文件，站点 ID 须与原版本一致。
