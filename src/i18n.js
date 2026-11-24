'use strict';

(() => {
  const STORAGE_KEY = 'cf-lang';
  const SUPPORTED = ['zh-CN', 'en'];

  const dictionaries = {
    'zh-CN': {
      'app.name': 'Cognition Filter',
      'app.subtitle': '本地语义过滤代理',
      'skip.toContent': '跳到主要内容',
      'nav.ariaLabel': '本地 agent 导航',
      'nav.settings': '设置',
      'nav.plugins': '站点插件',
      'nav.rules': '过滤规则',
      'nav.stats': '过滤统计',
      'nav.pairing': '浏览器配对',
      'lang.label': '语言',

      'settings.pageTitle': 'Agent 设置 · Cognition Filter',
      'settings.heading': 'Agent 设置',
      'settings.lead': '配置语义过滤模型、本机并发上限与站点插件。',
      'settings.noscript': '请启用 JavaScript 以读取和保存本机设置。',
      'settings.connection.title': '模型连接',
      'settings.connection.desc': '设置兼容 OpenAI Chat Completions 接口的模型与凭据。',
      'settings.connection.modelLabel': '模型标识',
      'settings.connection.modelPlaceholder': 'deepseek-flash',
      'settings.connection.apiBaseLabel': 'API 基础地址',
      'settings.connection.apiBasePlaceholder': 'https://api.deepseek.com/',
      'settings.connection.apiBaseHint': '填写兼容接口的基础地址，agent 会追加 /chat/completions。',
      'settings.connection.apiKeyLabel': 'API 密钥',
      'settings.connection.apiKeyLoading': '正在读取密钥状态…',
      'settings.connection.apiKeyPlaceholderKeep': '留空继续使用已保存密钥',
      'settings.connection.apiKeyPlaceholderNew': '填写 API 密钥',
      'settings.keyHint.originChanged': '服务地址已更换。请为新的服务填写密钥。',
      'settings.keyHint.configured': '已设置密钥。留空继续使用原密钥，输入新值即可替换。',
      'settings.keyHint.unset': '尚未设置密钥。填写新密钥后保存。',

      'settings.schedule.title': '并发设置',
      'settings.schedule.desc': '控制全局模型请求并发上限。',
      'settings.schedule.modelLabel': '模型并发请求',
      'settings.schedule.modelHint': '1–2500 个请求',

      'settings.limits.title': '分模型限额',
      'settings.limits.desc': '为指定模型单独限制并发数。实际使用该限额与模型并发请求数中的较小值。',
      'settings.limits.modelLabel': '模型标识',
      'settings.limits.capLabel': '并发上限',
      'settings.limits.remove': '移除',
      'settings.limits.removeAria': '移除 {name}',
      'settings.limits.add': '添加模型限额',
      'settings.limits.empty': '暂无分模型限额，所有模型均使用全局并发设置。',

      'settings.actions.reload': '重新读取',
      'settings.actions.save': '保存并应用',

      'settings.badge.connecting': '正在连接',
      'settings.badge.synced': '已同步',
      'settings.badge.unsaved': '未保存草稿',
      'settings.badge.saving': '正在保存',
      'settings.badge.conflict': '配置冲突',
      'settings.badge.error': '状态异常',

      'settings.status.connecting': '正在连接本地 agent…',
      'settings.status.unpaired': '本页尚未配对。请从系统托盘打开 Agent 设置。',
      'settings.status.reloading': '正在读取配置…',
      'settings.status.loaded': '配置已读取。修改后点击“保存并应用”。',
      'settings.status.dirty': '有尚未保存的修改。',
      'settings.status.saving': '正在保存并应用…',
      'settings.status.saved': '已保存，新设置已自动应用。',
      'settings.status.savedReloadNeeded': '设置已保存。请重新读取以确认 agent 的当前配置。',
      'settings.confirmReload': '重新读取会替换当前尚未保存的修改。继续吗？',

      'settings.validation.model': '请填写有效的模型标识，例如 deepseek-flash。',
      'settings.validation.apiBase': '请填写 HTTPS 基础地址或本机 HTTP 地址。',
      'settings.validation.apiKeyOrigin': '更换服务地址时，请填写该服务的密钥。',
      'settings.validation.duplicateModel': '这个模型已有限额。',

      'settings.error.invalidResponse': '本地 agent 未返回有效配置。',
      'settings.error.incompleteConfig': '配置字段不完整。',
      'settings.error.saveUnconfirmed': 'agent 未确认保存。',
      'settings.error.unauthorized': '本页配对口令无效。请从系统托盘重新打开 Agent 设置。',
      'settings.error.conflict': '另一处已更新设置。重新读取会载入最新版本并替换当前草稿。',
      'settings.error.saveRejected': '未能保存：{message}',
      'settings.error.http': '本地 agent 未能完成请求（HTTP {status}）。',
      'settings.error.unreachable': '无法连接本地 agent。请确认它正在运行，再重新读取。',

      'plugins.title': '站点插件管理',
      'plugins.autoInterest': '对被过滤的视频自动点击「内容不感兴趣」',
      'plugins.interestOn': '{name} 已开启自动提交「内容不感兴趣」。',
      'plugins.interestOff': '{name} 已关闭自动提交「内容不感兴趣」。',
      'plugins.desc': '扫描本地插件目录、切换启用状态、重载动态库或安装用户脚本。',
      'plugins.scan': '发现新插件',
      'plugins.hint': '替换同名 DLL 后点击「重新加载」。脚本有更新时，点击安装链接在油猴中确认。',
      'plugins.enabled': '已启用',
      'plugins.disabled': '已禁用',
      'catalog.loadError': '插件加载失败',
      'plugins.versions': 'DLL {dll} · 油猴脚本 {script}',
      'plugins.installScript': '安装或更新脚本',
      'plugins.disable': '禁用',
      'plugins.enable': '启用',
      'plugins.reload': '重新加载',
      'plugins.empty': '未发现站点插件。',
      'plugins.loading': '正在读取插件…',
      'plugins.scanned': '已检查插件目录。',
      'plugins.toggledEnabled': '{name} 已启用。',
      'plugins.toggledDisabled': '{name} 已禁用。',
      'plugins.reloaded': '{name} 已重新加载。',
      'plugins.scheduling.title': '站点并发调度',
      'plugins.scheduling.coverLabel': '备用封面下载并发 (1–256)',
      'plugins.scheduling.browserLabel': '每标签页送审卡片数 (1–32)',
      'plugins.scheduling.save': '保存调度',
      'plugins.scheduling.useDefaults': '使用 DLL 默认值',
      'plugins.scheduling.unsaved': '未保存草稿',
      'plugins.scheduling.conflict': '调度版本冲突：另一处已修改此插件调度。当前草稿已保留，请放弃草稿并重新加载最新版本。',
      'plugins.scheduling.discard': '放弃草稿',
      'plugins.scheduling.discardReload': '放弃草稿并重新加载',
      'plugins.scheduling.saved': '{name} 的调度设置已保存。',
      'plugins.scheduling.reset': '{name} 已恢复为 DLL 默认调度。',
      'plugins.scheduling.reloaded': '已重新加载 {name} 的最新调度设置。',
      'plugins.scheduling.validationCover': '请输入 1 到 256 之间的整数。',
      'plugins.scheduling.validationBrowser': '请输入 1 到 32 之间的整数。',

      'rules.pageTitle': '过滤规则 · Cognition Filter',
      'rules.heading': '过滤规则',
      'rules.lead': '管理语义过滤规则组，以及每组的匹配与排除条件。',
      'rules.noscript': '请启用 JavaScript 以读取和保存过滤规则。',
      'rules.groups.title': '规则组',
      'rules.groups.desc': '最多 24 个规则组；每组包含 1–8 条匹配条件与最多 8 条排除条件。',
      'rules.groups.count': '{count} / 24 组',
      'rules.groups.add': '添加规则组',
      'rules.groups.empty': '暂无规则组。点击“添加规则组”创建第一条规则。',
      'rules.group.ariaLabel': '规则组 {index}：{name}',
      'rules.group.defaultName': '新规则组',
      'rules.group.enabled': '启用规则组',
      'rules.group.enabledAria': '启用规则组 {name}',
      'rules.group.nameLabel': '规则组名称',
      'rules.group.scope': '适用范围',
      'rules.group.global': '全局（所有网站）',
      'rules.group.namePlaceholder': '输入规则组名称（最多 60 字）',
      'rules.group.remove': '删除规则组',
      'rules.group.removeAria': '删除规则组 {name}',
      'rules.include.title': '匹配条件',
      'rules.include.add': '添加匹配条件',
      'rules.include.addAria': '为 {name} 添加匹配条件',
      'rules.include.empty': '至少需要 1 条匹配条件。',
      'rules.include.placeholder': '描述要匹配的内容',
      'rules.exclude.title': '排除条件',
      'rules.exclude.add': '添加排除条件',
      'rules.exclude.addAria': '为 {name} 添加排除条件',
      'rules.exclude.empty': '暂无排除条件。',
      'rules.exclude.placeholder': '描述应排除的例外',
      'rules.point.enabledAria': '启用第 {index} 条{kind}：{text}',
      'rules.point.textAria': '{kind}第 {index} 条内容',
      'rules.point.kindInclude': '匹配条件',
      'rules.point.kindExclude': '排除条件',
      'rules.point.remove': '移除',
      'rules.point.removeAria': '移除{kind}第 {index} 条',
      'rules.actions.reload': '重新读取',
      'rules.actions.save': '保存规则',
      'rules.badge.connecting': '正在连接',
      'rules.badge.synced': '已同步',
      'rules.badge.unsaved': '未保存草稿',
      'rules.badge.saving': '正在保存',
      'rules.badge.conflict': '规则冲突',
      'rules.badge.error': '状态异常',
      'rules.status.connecting': '正在连接本地 agent…',
      'rules.status.unpaired': '本页尚未配对。请从系统托盘打开过滤规则。',
      'rules.status.reloading': '正在读取规则…',
      'rules.status.loaded': '规则已读取。修改后点击“保存规则”。',
      'rules.status.dirty': '有尚未保存的修改。',
      'rules.status.saving': '正在保存规则…',
      'rules.status.saved': '规则已保存。',
      'rules.confirmReload': '重新读取会替换当前尚未保存的修改。继续吗？',
      'rules.validation.groupCount': '最多只能有 24 个规则组。',
      'rules.validation.groupName': '请填写 1–60 个字符的规则组名称。',
      'rules.validation.includeRange': '每个规则组必须包含 1–8 条匹配条件。',
      'rules.validation.excludeRange': '每个规则组最多包含 8 条排除条件。',
      'rules.validation.pointText': '要点不能为空。普通规则最多 160 字，迁移的旧规则最多 280 字。',
      'rules.validation.duplicatePoint': '同一列表内不能有重复的条件内容。',
      'rules.error.invalidResponse': '本地 agent 未返回有效的规则数据。',
      'rules.error.incompleteRules': '规则数据结构不完整。',
      'rules.error.unauthorized': '本页配对口令无效。请从系统托盘重新打开过滤规则。',
      'rules.error.conflict': '另一处已更新规则。当前草稿已保留，点击“重新读取”可载入最新版本并替换草稿。',
      'rules.error.saveRejected': '未能保存：{message}',
      'rules.error.http': '本地 agent 未能完成请求（HTTP {status}）。',
      'rules.error.unreachable': '无法连接本地 agent。请确认它正在运行，再重新读取。',

      'stats.pageTitle': '过滤统计 · Cognition Filter',
      'stats.heading': '过滤统计',
      'stats.lead': '查看卡片判定结果、规则命中对比与模型用量。',
      'stats.noscript': '请启用 JavaScript 以查看统计。',
      'stats.periodLabel': '统计范围',
      'stats.sites.title': '各网站用量',
      'stats.sites.site': '网站',
      'stats.sites.localRate': '本地缓存命中率',
      'stats.sites.global': '全局汇总',
      'stats.sites.legacy': '升级前（未区分网站）',
      'stats.sites.note': '本地缓存命中率按送审卡片数计算，模型前缀命中率按输入 token 计算。',
      'stats.period.total': '累计',
      'stats.period.session': '本次运行',
      'stats.freshness.loading': '正在读取…',
      'stats.freshness.updated': '更新于 {time}',
      'stats.freshness.totalFailed': '累计统计读取失败，可查看本次运行。',
      'stats.freshness.saveFailed': '最近一次保存失败，agent 将自动重试。',
      'stats.freshness.expired': '本页会话已过期，请刷新页面。',
      'stats.freshness.refreshFailed': '暂时无法刷新。',
      'stats.freshness.lastUpdated': '上次更新于 {time}。',
      'stats.freshness.unpaired': '本页尚未配对。请从系统托盘打开过滤统计。',
      'stats.unavailable': '当前统计范围暂不可用，请切换统计范围或稍后重试。',

      'stats.outcomes.title': '卡片判定',
      'stats.outcomes.cards': '收到送审',
      'stats.outcomes.block': '已屏蔽',
      'stats.outcomes.allow': '已放行',
      'stats.outcomes.pending': '返回待定',
      'stats.outcomes.blockRate': '屏蔽率',
      'stats.outcomes.cacheHits': '本地判定缓存命中',
      'stats.outcomes.breakdownLabel': '卡片判定占比',
      'stats.outcomes.note': '每次送审计一次。屏蔽率按已屏蔽和已放行的判定计算。',

      'stats.rules.title': '规则命中对比',
      'stats.rules.note': '一张卡命中多条规则时，每条各计一次。',
      'stats.rules.empty': '暂无规则',
      'stats.rules.deleted': '已删除规则 · {id}',

      'stats.usage.title': '模型用量',
      'stats.usage.callsGroup': '调用次数',
      'stats.usage.tokensGroup': 'Token 消耗与前缀缓存',
      'stats.usage.modelCalls': '逐卡送审次数',
      'stats.usage.warmupCalls': '规则预热次数',
      'stats.usage.warmupFailures': '预热失败次数',
      'stats.usage.reflectionCalls': '反馈分析次数',
      'stats.usage.inputTokens': '输入 token',
      'stats.usage.outputTokens': '输出 token',
      'stats.usage.prefixHitTokens': '前缀命中 token',
      'stats.usage.prefixRate': '前缀命中率',
      'stats.usage.warmupInputTokens': '其中预热输入 token',
      'stats.usage.prefixBarLabel': '前缀缓存命中占输入 token 比例',
      'stats.usage.note': '用量来自成功解析的模型响应，包含送审、规则预热和反馈分析。前缀命中率按输入 token 计算。',

      'stats.feedback.title': '已应用的反馈',
      'stats.feedback.reported': '误杀反馈',
      'stats.feedback.picked': '手动选卡屏蔽',

      'pairing.pageTitle': '浏览器配对 · Cognition Filter',
      'pairing.heading': '浏览器配对',
      'pairing.lead': '安装站点用户脚本，并使用本机配对码授权浏览器与托盘代理通信。',
      'pairing.noscript': '未启用 JavaScript 时仍可手动选中下方配对码并点击脚本安装链接。',
      'pairing.codeSection.title': '本机配对码',
      'pairing.codeSection.desc': '当站点脚本首次连接或提示输入配对码时，复制下方口令并粘贴确认。',
      'pairing.codeSection.label': '配对码',
      'pairing.codeSection.copy': '复制配对码',
      'pairing.codeSection.copied': '已复制',
      'pairing.status.copied': '配对码已复制到剪贴板。',
      'pairing.status.fallbackSelected': '无法自动复制。已选中配对码，请按 Ctrl+C（或 Cmd+C）手动复制。',
      'pairing.status.unavailable': '当前未检测到有效配对码，请从系统托盘重新打开配对页。',
      'pairing.scriptsSection.title': '站点用户脚本',
      'pairing.scriptsSection.desc': '需先在浏览器中安装用户脚本管理器（如 Tampermonkey 或 Violentmonkey），再点击下方链接安装或更新对应站点脚本。',
      'pairing.scriptsSection.empty': '暂无可安装的站点脚本，请在设置中确认已启用站点插件。',
      'pairing.steps.title': '配对指引',
      'pairing.steps.step1Title': '安装站点脚本',
      'pairing.steps.step1Desc': '点击上方对应站点的安装链接，并在脚本管理器中确认安装。',
      'pairing.steps.step2Title': '完成配对授权',
      'pairing.steps.step2Desc': '打开站点首页，在首次弹窗中粘贴本页口令。也可在油猴菜单选择「配对本地 agent」。已配对的脚本升级后可继续使用原口令。',
      'pairing.steps.step3Title': '通过托盘管理',
      'pairing.steps.step3Desc': '配置模型、查看统计或调整插件时，请直接从系统托盘菜单打开对应页面。',
    },

    en: {
      'app.name': 'Cognition Filter',
      'app.subtitle': 'Local Semantic Filter Agent',
      'skip.toContent': 'Skip to main content',
      'nav.ariaLabel': 'Local agent navigation',
      'nav.settings': 'Settings',
      'nav.plugins': 'Site Plugins',
      'nav.rules': 'Rules',
      'nav.stats': 'Statistics',
      'nav.pairing': 'Pairing',
      'lang.label': 'Language',

      'settings.pageTitle': 'Agent Settings · Cognition Filter',
      'settings.heading': 'Agent Settings',
      'settings.lead': 'Configure the semantic filtering model, local concurrency limits, and site plugins.',
      'settings.noscript': 'Enable JavaScript to load and save local settings.',
      'settings.connection.title': 'Model Connection',
      'settings.connection.desc': 'Configure an OpenAI-compatible Chat Completions endpoint and credentials.',
      'settings.connection.modelLabel': 'Model ID',
      'settings.connection.modelPlaceholder': 'deepseek-flash',
      'settings.connection.apiBaseLabel': 'API Base URL',
      'settings.connection.apiBasePlaceholder': 'https://api.deepseek.com/',
      'settings.connection.apiBaseHint': 'Enter a compatible base URL; the agent appends /chat/completions.',
      'settings.connection.apiKeyLabel': 'API Key',
      'settings.connection.apiKeyLoading': 'Checking saved key status…',
      'settings.connection.apiKeyPlaceholderKeep': 'Leave blank to keep saved key',
      'settings.connection.apiKeyPlaceholderNew': 'Enter API key',
      'settings.keyHint.originChanged': 'Service origin changed. Enter an API key for the new endpoint.',
      'settings.keyHint.configured': 'API key is configured. Leave blank to keep it, or enter a new value to replace it.',
      'settings.keyHint.unset': 'No API key configured yet. Enter a key and save.',

      'settings.schedule.title': 'Concurrency',
      'settings.schedule.desc': 'Control the global limit for simultaneous model requests.',
      'settings.schedule.modelLabel': 'Model requests',
      'settings.schedule.modelHint': '1–2,500 requests',

      'settings.limits.title': 'Per-Model Limits',
      'settings.limits.desc': 'Cap concurrency for specific models. Effective concurrency is the smaller of this cap and global model requests.',
      'settings.limits.modelLabel': 'Model ID',
      'settings.limits.capLabel': 'Concurrency cap',
      'settings.limits.remove': 'Remove',
      'settings.limits.removeAria': 'Remove {name}',
      'settings.limits.add': 'Add model limit',
      'settings.limits.empty': 'No per-model limits configured. All models use the global request limit.',

      'settings.actions.reload': 'Reload',
      'settings.actions.save': 'Save & Apply',

      'settings.badge.connecting': 'Connecting',
      'settings.badge.synced': 'Synced',
      'settings.badge.unsaved': 'Unsaved draft',
      'settings.badge.saving': 'Saving…',
      'settings.badge.conflict': 'Conflict',
      'settings.badge.error': 'Error',

      'settings.status.connecting': 'Connecting to local agent…',
      'settings.status.unpaired': 'This page is not paired. Open Agent Settings from the system tray.',
      'settings.status.reloading': 'Loading configuration…',
      'settings.status.loaded': 'Settings loaded. Edit fields and click Save & Apply.',
      'settings.status.dirty': 'You have unsaved changes.',
      'settings.status.saving': 'Saving and applying settings…',
      'settings.status.saved': 'Saved. New settings are active.',
      'settings.status.savedReloadNeeded': 'Settings saved. Reload to confirm the active configuration.',
      'settings.confirmReload': 'Reloading will discard your unsaved changes. Continue?',

      'settings.validation.model': 'Enter a valid model ID, e.g. deepseek-flash.',
      'settings.validation.apiBase': 'Enter an HTTPS base URL or a localhost HTTP URL.',
      'settings.validation.apiKeyOrigin': 'Enter an API key when changing the service origin.',
      'settings.validation.duplicateModel': 'This model already has a limit.',

      'settings.error.invalidResponse': 'Local agent did not return a valid configuration.',
      'settings.error.incompleteConfig': 'Configuration payload is incomplete.',
      'settings.error.saveUnconfirmed': 'Agent did not confirm save.',
      'settings.error.unauthorized': 'Pairing token is invalid for this page. Reopen Agent Settings from the system tray.',
      'settings.error.conflict': 'Settings were updated elsewhere. Reload to load the latest version and replace your draft.',
      'settings.error.saveRejected': 'Could not save: {message}',
      'settings.error.http': 'Local agent failed to complete the request (HTTP {status}).',
      'settings.error.unreachable': 'Unable to reach the local agent. Ensure it is running and reload.',

      'plugins.title': 'Site Plugins',
      'plugins.autoInterest': 'Automatically mark filtered videos as “Not interested in the content”',
      'plugins.interestOn': 'Automatic “Not interested” feedback enabled for {name}.',
      'plugins.interestOff': 'Automatic “Not interested” feedback disabled for {name}.',
      'plugins.desc': 'Scan the local plugins directory, toggle availability, reload DLLs, or install userscripts.',
      'plugins.scan': 'Scan Plugins',
      'plugins.hint': 'Click Reload after replacing a DLL with the same name. When a script updates, use the install link to confirm in your userscript manager.',
      'plugins.enabled': 'Enabled',
      'plugins.disabled': 'Disabled',
      'catalog.loadError': 'Plugin failed to load',
      'plugins.versions': 'DLL {dll} · Userscript {script}',
      'plugins.installScript': 'Install / Update Script',
      'plugins.disable': 'Disable',
      'plugins.enable': 'Enable',
      'plugins.reload': 'Reload',
      'plugins.empty': 'No site plugins found.',
      'plugins.loading': 'Loading plugins…',
      'plugins.scanned': 'Plugin directory scanned.',
      'plugins.toggledEnabled': '{name} enabled.',
      'plugins.toggledDisabled': '{name} disabled.',
      'plugins.reloaded': '{name} reloaded.',
      'plugins.scheduling.title': 'Site Scheduling',
      'plugins.scheduling.coverLabel': 'Fallback cover downloads (1–256)',
      'plugins.scheduling.browserLabel': 'Cards per tab (1–32)',
      'plugins.scheduling.save': 'Save Scheduling',
      'plugins.scheduling.useDefaults': 'Use DLL Defaults',
      'plugins.scheduling.unsaved': 'Unsaved draft',
      'plugins.scheduling.conflict': 'Scheduling conflict: updated elsewhere. Draft preserved—discard draft and reload latest values.',
      'plugins.scheduling.discard': 'Discard Draft',
      'plugins.scheduling.discardReload': 'Discard & Reload',
      'plugins.scheduling.saved': 'Scheduling saved for {name}.',
      'plugins.scheduling.reset': '{name} reset to DLL defaults.',
      'plugins.scheduling.reloaded': 'Reloaded latest scheduling for {name}.',
      'plugins.scheduling.validationCover': 'Enter an integer from 1 to 256.',
      'plugins.scheduling.validationBrowser': 'Enter an integer from 1 to 32.',

      'rules.pageTitle': 'Filter Rules · Cognition Filter',
      'rules.heading': 'Filter Rules',
      'rules.lead': 'Manage semantic filtering rule groups with include and exclude criteria.',
      'rules.noscript': 'Enable JavaScript to load and save filter rules.',
      'rules.groups.title': 'Rule Groups',
      'rules.groups.desc': 'Up to 24 rule groups, each with 1–8 include points and up to 8 exclude points.',
      'rules.groups.count': '{count} / 24 groups',
      'rules.groups.add': 'Add Group',
      'rules.groups.empty': 'No rule groups yet. Click Add Group to create one.',
      'rules.group.ariaLabel': 'Rule group {index}: {name}',
      'rules.group.defaultName': 'New Rule Group',
      'rules.group.enabled': 'Enabled',
      'rules.group.enabledAria': 'Enable group {name}',
      'rules.group.nameLabel': 'Group name',
      'rules.group.scope': 'Applies to',
      'rules.group.global': 'Global (all sites)',
      'rules.group.namePlaceholder': 'Group name (max 60 chars)',
      'rules.group.remove': 'Remove Group',
      'rules.group.removeAria': 'Remove group {name}',
      'rules.include.title': 'Include Points',
      'rules.include.add': 'Add Include',
      'rules.include.addAria': 'Add include point to {name}',
      'rules.include.empty': 'At least 1 include point is required.',
      'rules.include.placeholder': 'Describe content to match',
      'rules.exclude.title': 'Exclude Points',
      'rules.exclude.add': 'Add Exclude',
      'rules.exclude.addAria': 'Add exclude point to {name}',
      'rules.exclude.empty': 'No exclude points.',
      'rules.exclude.placeholder': 'Describe exception to exclude',
      'rules.point.enabledAria': 'Enable {kind} point {index}: {text}',
      'rules.point.textAria': '{kind} point {index} text',
      'rules.point.kindInclude': 'include',
      'rules.point.kindExclude': 'exclude',
      'rules.point.remove': 'Remove',
      'rules.point.removeAria': 'Remove {kind} point {index}',
      'rules.actions.reload': 'Reload',
      'rules.actions.save': 'Save Rules',
      'rules.badge.connecting': 'Connecting',
      'rules.badge.synced': 'Synced',
      'rules.badge.unsaved': 'Unsaved draft',
      'rules.badge.saving': 'Saving…',
      'rules.badge.conflict': 'Conflict',
      'rules.badge.error': 'Error',
      'rules.status.connecting': 'Connecting to local agent…',
      'rules.status.unpaired': 'This page is not paired. Open Filter Rules from the system tray.',
      'rules.status.reloading': 'Loading rules…',
      'rules.status.loaded': 'Rules loaded. Edit groups and click Save Rules.',
      'rules.status.dirty': 'You have unsaved changes.',
      'rules.status.saving': 'Saving rules…',
      'rules.status.saved': 'Rules saved.',
      'rules.confirmReload': 'Reloading will discard your unsaved changes. Continue?',
      'rules.validation.groupCount': 'Maximum 24 rule groups allowed.',
      'rules.validation.groupName': 'Enter a group name (1–60 characters).',
      'rules.validation.includeRange': 'Each group must have 1–8 include points.',
      'rules.validation.excludeRange': 'Each group may have at most 8 exclude points.',
      'rules.validation.pointText': 'Enter up to 160 characters, or 280 for a migrated legacy rule.',
      'rules.validation.duplicatePoint': 'Duplicate text in the same list is not allowed.',
      'rules.error.invalidResponse': 'Local agent did not return valid rules data.',
      'rules.error.incompleteRules': 'Rules payload is incomplete.',
      'rules.error.unauthorized': 'Pairing token is invalid for this page. Reopen Filter Rules from the system tray.',
      'rules.error.conflict': 'Rules were updated elsewhere. Your draft is preserved—reload to load the latest version and replace your draft.',
      'rules.error.saveRejected': 'Could not save: {message}',
      'rules.error.http': 'Local agent failed to complete the request (HTTP {status}).',
      'rules.error.unreachable': 'Unable to reach the local agent. Ensure it is running and reload.',

      'stats.pageTitle': 'Filtering Statistics · Cognition Filter',
      'stats.heading': 'Filtering Statistics',
      'stats.lead': 'Review card filtering outcomes, rule comparisons, and model token efficiency.',
      'stats.noscript': 'Enable JavaScript to view statistics.',
      'stats.periodLabel': 'Scope',
      'stats.sites.title': 'Usage by site',
      'stats.sites.site': 'Website',
      'stats.sites.localRate': 'Local cache hit rate',
      'stats.sites.global': 'All sites',
      'stats.sites.legacy': 'Before upgrade (site unknown)',
      'stats.sites.note': 'Local cache hits are divided by submitted cards. Model prefix hits are divided by input tokens.',
      'stats.period.total': 'Cumulative',
      'stats.period.session': 'Current Session',
      'stats.freshness.loading': 'Loading…',
      'stats.freshness.updated': 'Updated {time}',
      'stats.freshness.totalFailed': 'Failed to load cumulative stats; Current Session is available.',
      'stats.freshness.saveFailed': 'Last stats save failed; the agent will retry automatically.',
      'stats.freshness.expired': 'Page session expired. Reload from the system tray.',
      'stats.freshness.refreshFailed': 'Unable to refresh right now.',
      'stats.freshness.lastUpdated': 'Last updated {time}.',
      'stats.freshness.unpaired': 'This page is not paired. Open Filtering Statistics from the system tray.',
      'stats.unavailable': 'The selected scope is currently unavailable. Switch scope or try again shortly.',

      'stats.outcomes.title': 'Filtering Outcomes',
      'stats.outcomes.cards': 'Submitted',
      'stats.outcomes.block': 'Blocked',
      'stats.outcomes.allow': 'Allowed',
      'stats.outcomes.pending': 'Pending',
      'stats.outcomes.blockRate': 'Block Rate',
      'stats.outcomes.cacheHits': 'Local Cache Hits',
      'stats.outcomes.breakdownLabel': 'Outcome Distribution',
      'stats.outcomes.note': 'Counted once per submission. Block rate is computed over blocked and allowed verdicts.',

      'stats.rules.title': 'Rule Comparisons',
      'stats.rules.note': 'When one card matches multiple rules, each rule is counted once.',
      'stats.rules.empty': 'No rules recorded',
      'stats.rules.deleted': 'Deleted rule · {id}',

      'stats.usage.title': 'Model Usage',
      'stats.usage.callsGroup': 'Call Volume',
      'stats.usage.tokensGroup': 'Token Accounting & Prefix Cache',
      'stats.usage.modelCalls': 'Card Evaluations',
      'stats.usage.warmupCalls': 'Rule Warmups',
      'settings.usage.warmupFailures': 'Warmup Failures',
      'stats.usage.warmupFailures': 'Warmup Failures',
      'stats.usage.reflectionCalls': 'Feedback Analyses',
      'stats.usage.inputTokens': 'Input Tokens',
      'stats.usage.outputTokens': 'Output Tokens',
      'stats.usage.prefixHitTokens': 'Prefix Cache Hits',
      'stats.usage.prefixRate': 'Prefix Hit Rate',
      'stats.usage.warmupInputTokens': 'Warmup Input Tokens',
      'stats.usage.prefixBarLabel': 'Prefix cache share of input tokens',
      'stats.usage.note': 'Usage reflects successfully parsed model responses across evaluations, rule warmups, and feedback analyses. Prefix hit rate is over input tokens.',

      'stats.feedback.title': 'Applied Feedback',
      'stats.feedback.reported': 'False Positives Reported',
      'stats.feedback.picked': 'Manual Card Blocks',

      'pairing.pageTitle': 'Browser Pairing · Cognition Filter',
      'pairing.heading': 'Browser Pairing',
      'pairing.lead': 'Install site userscripts and authorize your browser to communicate with the local tray agent.',
      'pairing.noscript': 'With JavaScript disabled, you can still manually select the pairing code below and click the script install links.',
      'pairing.codeSection.title': 'Local Pairing Code',
      'pairing.codeSection.desc': 'Copy and paste this code when a site userscript prompts to pair with your local agent.',
      'pairing.codeSection.label': 'Pairing code',
      'pairing.codeSection.copy': 'Copy Pairing Code',
      'pairing.codeSection.copied': 'Copied',
      'pairing.status.copied': 'Pairing code copied to clipboard.',
      'pairing.status.fallbackSelected': 'Automatic copy unavailable. The code is selected—press Ctrl+C (or Cmd+C) to copy.',
      'pairing.status.unavailable': 'No active pairing code detected on this page. Reopen the pairing page from the system tray.',
      'pairing.scriptsSection.title': 'Site Userscripts',
      'pairing.scriptsSection.desc': 'Install a userscript manager (such as Tampermonkey or Violentmonkey) first, then click a link below to install or update each site script.',
      'pairing.scriptsSection.empty': 'No site scripts available. Verify at least one site plugin is enabled in settings.',
      'pairing.steps.title': 'Pairing Steps',
      'pairing.steps.step1Title': 'Install site scripts',
      'pairing.steps.step1Desc': 'Open the install links above and confirm installation in your userscript manager.',
      'pairing.steps.step2Title': 'Authorize pairing',
      'pairing.steps.step2Desc': 'Open the site homepage and paste the code into the first-use prompt. To reopen it, choose “配对本地 agent” (Pair local agent) in the userscript menu. Existing pairings carry over after script updates.',
      'pairing.steps.step3Title': 'Manage from tray',
      'pairing.steps.step3Desc': 'Use the system tray icon anytime to open Agent Settings and Filtering Statistics.',
    },
  };

  // Remove accidental extra key in en if present so dictionaries stay strictly parallel
  delete dictionaries.en['settings.usage.warmupFailures'];

  function readStoredLang() {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return SUPPORTED.includes(saved) ? saved : '';
    } catch {
      return '';
    }
  }

  function writeStoredLang(lang) {
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore storage errors in restricted contexts.
    }
  }

  function detectLang() {
    const stored = readStoredLang();
    if (stored) return stored;
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || ''];
    for (const raw of candidates) {
      const lower = String(raw).toLowerCase();
      if (lower.startsWith('zh')) return 'zh-CN';
      if (lower.startsWith('en')) return 'en';
    }
    return 'en';
  }

  let currentLang = detectLang();
  const listeners = new Set();

  function interpolate(template, params) {
    if (!params) return template;
    return template.replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) =>
      Object.hasOwn(params, name) ? String(params[name]) : ''
    );
  }

  function t(key, params) {
    const dict = dictionaries[currentLang] || dictionaries.en;
    const fallback = dictionaries.en;
    const template = Object.hasOwn(dict, key)
      ? dict[key]
      : (Object.hasOwn(fallback, key) ? fallback[key] : key);
    return interpolate(template, params);
  }

  function parseParams(raw) {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Apply translations to static or server-injected DOM nodes using:
   * - data-i18n="translation.key" (sets textContent)
   * - data-i18n-params='{"name":"..."}' (optional interpolation values)
   * - data-i18n-attr="placeholder:key,aria-label:key" (sets attributes)
   */
  function apply(root = document) {
    if (!root || !root.querySelectorAll) return;
    if (root === document) {
      document.documentElement.lang = currentLang;
      const titleMeta = document.querySelector('meta[name="cf-title-key"]');
      if (titleMeta?.content) {
        document.title = t(titleMeta.content);
      }
      const select = document.getElementById('lang-select');
      if (select && select.value !== currentLang) {
        select.value = currentLang;
      }
    }

    for (const el of root.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key, parseParams(el.getAttribute('data-i18n-params')));
      }
    }

    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
      const spec = el.getAttribute('data-i18n-attr');
      if (!spec) continue;
      const params = parseParams(el.getAttribute('data-i18n-params'));
      for (const pair of spec.split(',')) {
        const sep = pair.indexOf(':');
        if (sep <= 0) continue;
        const attr = pair.slice(0, sep).trim();
        const key = pair.slice(sep + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key, params));
      }
    }
  }

  function setLang(next) {
    if (!SUPPORTED.includes(next) || next === currentLang) return;
    currentLang = next;
    writeStoredLang(next);
    apply(document);
    for (const fn of listeners) {
      try { fn(currentLang); } catch { /* Keep switching resilient */ }
    }
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat(currentLang).format(value);
  }

  function formatPercent(part, total) {
    if (!total) return '—';
    return new Intl.NumberFormat(currentLang, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(part / total);
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat(currentLang, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  }

  function init() {
    apply(document);
    const select = document.getElementById('lang-select');
    if (select) {
      select.value = currentLang;
      select.addEventListener('change', () => setLang(select.value));
    }
  }

  window.cfI18n = {
    getLang: () => currentLang,
    setLang,
    t,
    apply,
    onChange,
    formatNumber,
    formatPercent,
    formatTime,
    dictionaries,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
