# 开发、测试与提示词评测指南

本文档面向 **认知滤网（Cognition Filter）** 的贡献者与二次开发者，说明开发环境配置、工作区构建、代码规范检查、自动化测试体系以及提示词评测方法。

---

## 1. 开发环境准备

| 工具 | 版本要求 | 说明 |
| --- | --- | --- |
| **Rust 工具链** | `rust-version = "1.91"`，Edition 2024 | 见 [rust-toolchain.toml](../rust-toolchain.toml)（含 `rustfmt`、`clippy` 组件） |
| **系统 C/C++ 编译工具** | Windows MSVC 工具链 | 用于链接本地二进制文件与 `cdylib` 站点插件 |
| **Node.js** | 22 或更高版本 | 用于运行浏览器回归测试与提示词评测脚本 |
| **Chromium 浏览器** | Edge 或 Chrome | 浏览器端到端回归测试自动探测，也可用 `BROWSER_BIN` 指定 |

---

## 2. 工作区结构与构建

项目是一个 Cargo Workspace，包含核心 Agent、插件 SDK 与内置站点插件：

```toml
# Cargo.toml
[workspace]
default-members = [".", "plugins/bilibili", "plugins/x"]
members = ["sdk", "plugins/bilibili", "plugins/x"]
```

### 2.1 快速开发启动

开发阶段推荐使用带控制台日志输出的启动脚本：

```powershell
.\start.ps1
```

该脚本会自动调用 `.\build.ps1` 执行增量 `dev` 构建（关闭调试符号以加快编译速度），并将所有内置插件 DLL 复制到可执行文件同级的 `plugins/` 目录，随后直接启动 Agent。如果已编译好可执行文件且不想重新构建，可传入 `-NoBuild` 参数：

```powershell
.\start.ps1 -NoBuild
```

### 2.2 构建与打包发布版

```powershell
# 构建 dev 版（输出到 target/debug 及 target/debug/plugins）
.\build.ps1

# 构建 release 版并输出到指定分发目录
.\build.ps1 -Release -OutputDirectory dist/release
```

`build.ps1` 会使用 `--workspace --locked` 编译主程序和所有 `cdylib` 插件，并将生成的 `cognition-filter.exe` 与 `plugins/*.dll` 组织为可直接分发的目录结构：

```text
dist/release/
├── cognition-filter.exe
└── plugins/
    ├── cf_site_bilibili.dll
    └── cf_site_x.dll
```

> 在 Windows Release 构建中，主程序启用 `#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]`，无黑框后台运行并通过系统托盘交互；`dev` 构建保留控制台窗口且支持 `Ctrl+C` 退出。

---

## 3. 代码规范与静态检查

工作区在 [Cargo.toml](../Cargo.toml) 中配置了严格的 Rust 与 Clippy lints（包含 `missing-docs`、`missing-debug-implementations`、`unused-qualifications` 及多项 Clippy 规则），并配备了 [rustfmt.toml](../rustfmt.toml) 与 [.taplo.toml](../.taplo.toml)。

提交代码前请执行以下命令确保零警告通过：

```powershell
# 格式化检查
cargo fmt --all -- --check

# 严格 Clippy 检查（含所有测试与插件目标）
cargo clippy --workspace --all-targets -- -D warnings
```

---

## 4. 测试体系

### 4.1 Rust 单元测试与集成测试

覆盖端口发现与单实例锁、HMAC-SHA256 跨语言签名向量、配置加载与迁移、规则校验与版本指纹、DLL 插件加载与热重载、Axum 路由鉴权、并发限流、统计持久化等核心逻辑：

```powershell
cargo test --workspace
```

其中 `test/plugin-fixture.rs` 用于构造动态库插件测试夹具，验证异常清单、热重载切换与失败回滚行为。

### 4.2 浏览器端到端回归测试

基于 Node.js 22+ 原生测试运行器驱动真实 Chromium（Edge / Chrome）验证油猴脚本与 WebUI 交互：

```powershell
# 验证油猴脚本：端口发现、配对、卡片预遮盖、封面读取、节点复用与反馈交互
node --test test/userscript.test.mjs

# 验证本地 WebUI：配置、规则编辑、插件管理与统计页面
node --test test/settings.test.mjs
```

如需指定特定浏览器二进制文件，可先设置环境变量：

```powershell
$env:BROWSER_BIN = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
node --test test/userscript.test.mjs
```

---

## 5. 提示词工程与评测

内置提示词定义在 [config/prompts.json](../config/prompts.json) 中，包含：
- `version`：提示词版本号（变更后会纳入规则指纹，自动使旧缓存失效）。
- `compact`：生产使用的精简多模态判定提示词（要求先输出不超过 10 字可见依据，再输出命中编号）。
- `baseline`：用于对照实验的完整描述版提示词。
- `rule_turn`：用于前缀缓存预热的规则确认轮次模板。
- `false_positive` / `false_negative` / `feedback`：用于误杀反思与选卡漏放分析的提示词。

### 5.1 离线格式与契约校验（不消耗 API 额度）

`eval/` 目录下内置四套评测样本集：
- `eval/cases.json`：基础规则与自定义规则样本
- `eval/formats.json`：内容形式与立场边界样本
- `eval/holdout.json`：保留用于验证的图文组合样本
- `eval/user-feedback.json`：用户真实提供的封面与对照样本（封面图位于 `eval/covers/`）

运行离线校验以检查样本格式、图片体积及响应解析器契约：

```powershell
node eval/compare.mjs --suite eval/holdout.json
node eval/compare.mjs --suite eval/cases.json
node eval/compare.mjs --suite eval/formats.json
node eval/compare.mjs --suite eval/user-feedback.json
```

### 5.2 在线实测（调用真实视觉模型）

设置 `DEEPSEEK_API_KEY` 后，可加上 `--live` 参数向真实模型发起对照测试（比较 `baseline` 与 `compact` 两种提示词的完整标签命中率、误杀率、漏放率与每卡 token 消耗），并将详细结果写入报告文件：

```powershell
$env:DEEPSEEK_API_KEY = "你的密钥"
# 可选：单独指定评测模型（默认 deepseek-flash）
# $env:DEEPSEEK_MODEL = "deepseek-flash"

node eval/compare.mjs --live --suite eval/holdout.json --report eval/reports/holdout.json
```

最新一次完整实测结果分析见 [B 站首页过滤实测](evaluation.md)。
