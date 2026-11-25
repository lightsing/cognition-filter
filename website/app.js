'use strict';

(() => {
  const LANG_KEY = 'cf-pages-lang';
  const THEME_KEY = 'cf-pages-theme';

  const i18n = {
    'zh-CN': {
      'meta.title': '认知滤网 Cognition Filter · 本地优先的多模态网页语义过滤工具',
      'a11y.skip': '跳到主要内容',
      'brand.name': '认知滤网',
      'nav.features': '核心特性',
      'nav.architecture': '架构与安全',
      'nav.plugins': '站点插件',
      'nav.webui': '本地 WebUI',
      'nav.eval': '实测数据',
      'nav.quickstart': '快速开始',
      'hero.eyebrow': 'Rust 本地 Agent · 多模态视觉语义 · 先遮盖后判定',
      'hero.title': '在污染视线前，<br>把信息流还给自己。',
      'hero.desc': '<strong>认知滤网（Cognition Filter）</strong>通过「本地 Rust Agent + 站点 DLL 插件 + 油猴脚本」协同工作。卡片出现即施加占位遮罩，综合标题、作者与封面视觉语义判定——精准拦截情绪挑动与截图搬运视频，Cookie 与 API Key 始终留在你的电脑。',
      'hero.download': '下载 Windows 版 v0.11.0',
      'hero.quickstart': '5 分钟快速上手',
      'hero.releaseNotes': 'Release 说明',
      'hero.metric1Label': '实测完整标签命中',
      'hero.metric1Sub': '0% 漏放误行',
      'hero.metric2Label': '紧凑提示词省流',
      'hero.metric2Sub': '+ 站点 KV 前缀预热',
      'hero.metric3Label': '隐私与安全边界',
      'hero.metric3Sub': 'HMAC 双向配对',
      'demo.tabBili': '哔哩哔哩首页',
      'demo.tabX': 'X 首页时间线',
      'demo.replay': '重放过滤流程',
      'demo.statusReady': '已配对本地 Agent · 3 组规则生效中',
      'demo.statusRunning': '正在按视口优先级逐卡送审…',
      'demo.hint': '点击遮罩卡片的「仍要查看」体验误杀反馈',
      'demo.maskedLabel': '待检测 · 已预遮盖',
      'demo.maskedSub': '未完成前绝不闪现',
      'demo.matchedLabel': '命中：{rule}',
      'demo.blurSub': '30px 高斯模糊已生效',
      'demo.reveal': '仍要查看',
      'demo.remask': '重新遮盖',
      'demo.reportFp': '反馈误杀',
      'demo.fpApplied': '<strong>已追加保留例外：</strong>「{point}」',
      'demo.allowBadge': '已放行',
      'demo.nativeBadge': '广告 / 直播 · 原生跳过 (0 Token)',
      'features.tag': '为什么不是关键词屏蔽',
      'features.title': '真正读懂封面与语境的四重机制',
      'features.lead': '关键词正则无法分辨「制造对立」与「理性辟谣」，也看不见封面上满屏的聊天与回答截图。认知滤网从呈现机制到规则进化全面重构过滤体验。',
      'features.f1Title': '先遮盖，后判定 · 零闪屏护眼盾',
      'features.f1Desc': '卡片进入 DOM 瞬间施加不透明占位，靠近视口的卡片优先排队送审，明确放行后才显露内容。封面懒加载期间（最多等待 5 秒）不占送审并发名额，证据不足或超时的卡片保持待判定，绝不「先闪现再隐藏」。',
      'features.f2Title': '标题、昵称与封面联合判断',
      'features.f2Desc': '合看标题/正文、作者昵称和缩略图（X 支持最多 4 张配图与视频海报），自然语言编写「命中要点」与「保留例外」，一眼区分实拍科普与网帖截图搬运。',
      'features.f3Title': '误杀反思与选卡屏蔽闭环',
      'features.f3Desc': '展开命中卡片点击「反馈误杀」，或通过油猴菜单「选择卡片进行屏蔽」，模型会自动提炼可泛化的视觉与文本边界，生成可编辑的例外或命中要点写入规则组。',
      'features.f4Title': '按站点前缀预热 + 三级缓存与并发调度',
      'features.f4Desc': '使用 DeepSeek 等兼容接口时，Agent 为每个启用站点独立预热「全局 + 本站规则」KV Cache 前缀，逐卡判定从规则确认轮次直接分叉；叠加 24 小时 1,024 条内存判定缓存与页面缓存读图，大幅压低 Token 成本与网络延迟。',
      'arch.tag': '工程架构与隐私边界',
      'arch.title': '点击任意链路节点，查看安全与并发设计',
      'arch.lead': '所有敏感凭证与账号状态严格隔离。浏览器 Cookie 不出页面，API Key 不出本机。',
      'arch.s1Title': '浏览器油猴脚本',
      'arch.s1Sub': 'DOM 遮罩与页面读图',
      'arch.s2Title': '端口发现与配对',
      'arch.s2Sub': 'LCG 序列 + HMAC 校验',
      'arch.s3Title': 'Rust 本地 Agent',
      'arch.s3Sub': '调度、缓存与 SSRF 守卫',
      'arch.s4Title': '视觉大模型 API',
      'arch.s4Sub': 'KV 预热与结构化输出',
      'plugins.tag': '原生 DLL 插件架构 v1',
      'plugins.title': '开箱即用双站点，几分钟扩展任意信息流',
      'plugins.lead': '每个网站封装为自包含的原生动态库（内嵌清单 JSON 与油猴脚本模板），支持 WebUI 热重载、独立并发额度与站点专属规则。',
      'plugins.biliName': '哔哩哔哩首页',
      'plugins.biliF1': '优先直读页面已渲染封面缩略图，失败后匿名跨域缓存读取，最终兜底 Agent 白名单 CDN 下载（i0/i1/i2.hdslb.com）。',
      'plugins.biliF2': '本机识别并跳过广告位与直播间；内置「网帖、问答和评论截图转视频」专属规则。',
      'plugins.biliF3': '可选开启对命中卡片自动点击「内容不感兴趣」，联动账号原生推荐反馈。',
      'plugins.xName': 'X 首页时间线',
      'plugins.xF1': '支持「为你推荐」与「正在关注」时间线，自动跳过推广广告与非首页路由。',
      'plugins.xF2': '提取作者与最多 8,192 个 UTF-16 单元可见正文，支持纯文字帖及最多 4 张配图/视频静态预览。',
      'plugins.xF3': '与 B 站共享全局规则同时享有独立的站点规则、前缀预热、缓存与用量统计。',
      'sdk.copy': '复制片段',
      'sdk.copied': '已复制',
      'sdk.foot': '编译后放入 plugins/ 目录，在 WebUI 点击「发现新插件」即可生效，支持热重载且校验失败自动回退。',
      'sdk.docsLink': '阅读插件接口文档 →',
      'webui.tag': '自带双语本地控制台',
      'webui.title': '从规则编排到 Token 归因，一切尽在掌握',
      'webui.lead': '双击 Windows 托盘漏斗图标即可打开本地 WebUI，支持简体中文 / English 实时切换与深浅色自适应。',
      'webui.tabRules': '过滤规则',
      'webui.tabStats': '过滤统计',
      'webui.tabPlugins': '站点插件',
      'webui.tabPairing': '浏览器配对',
      'eval.tag': '真实模型实测验证',
      'eval.title': '先写依据再输出标签，准确率更高、Token 更省',
      'eval.lead': '基于 DeepSeek deepseek-flash 对 43 张人工标注卡片（含 22 张真实封面与合成对照）进行的对照组实测结果。',
      'eval.exact': '完整标签精确匹配',
      'eval.falseAllow': '四个测试集漏放率',
      'eval.tokenDrop': '总 Token 消耗降幅',
      'eval.barBase': '对照版提示词 (Baseline)',
      'eval.barCompact': '精简依据版提示词 (Compact)',
      'eval.footnote': '注：精简版要求模型先用 ≤10 字写出可见依据，再输出全部命中规则编号，显著提升了多标签组合的召回表现。完整报告见 docs/evaluation.md。',
      'eval.suiteHeading': '分测试集表现（Compact 最终版）',
      'eval.s1Name': '用户封面与保留对照 (8 张)',
      'eval.s2Name': '形式与立场边界 (6 张)',
      'eval.s3Name': '保留图文验证集 (6 张)',
      'eval.s4Name': '无图基础与自定义规则 (23 张)',
      'eval.reportLink': '查看完整实测与误差分析 →',
      'start.tag': '三步开启清净浏览',
      'start.title': '从下载到完成配对，只需 3 分钟',
      'start.step1Title': '启动 Agent 并填写密钥',
      'start.step1Desc': '运行 Windows 安装包，然后从开始菜单打开 Cognition Filter。双击任务栏托盘漏斗图标打开配置页，填入 DeepSeek 或任意兼容视觉模型的 API Key。',
      'start.step2Title': '安装站点油猴脚本',
      'start.step2Desc': '在浏览器安装 Tampermonkey，右键托盘选择「打开配对页」，点击安装「哔哩哔哩首页」或「X 首页时间线」脚本，并复制 48 位本机配对码。',
      'start.step3Title': '刷新首页粘贴配对码',
      'start.step3Desc': '打开 B 站或 X 首页并刷新，在首次弹窗粘贴本机配对码即可开始过滤。支持随时在网页内点击「反馈误杀」或「选卡屏蔽」持续调优。',
      'cta.title': '准备好过滤信息流噪音了吗？',
      'cta.desc': 'Windows x64 发布包已内置 Rust Agent 主程序与 B 站、X 双站点插件（约 2.64 MB）。',
      'cta.download': '立即下载 v0.11.0 (MSI)',
      'cta.guide': '阅读用户手册',
      'docs.label': '完整文档导航：',
      'docs.userGuide': '用户使用手册',
      'docs.arch': '系统架构与安全',
      'docs.config': '配置与 HTTP API',
      'docs.plugins': '站点插件开发',
      'docs.dev': '开发与评测',
      'footer.copy': '认知滤网 Cognition Filter · 本地优先的多模态网页语义过滤工具',
    },
    en: {
      'meta.title': 'Cognition Filter · Local-First Multimodal Semantic Feed Filter',
      'a11y.skip': 'Skip to main content',
      'brand.name': 'Cognition Filter',
      'nav.features': 'Features',
      'nav.architecture': 'Architecture',
      'nav.plugins': 'Site Plugins',
      'nav.webui': 'WebUI',
      'nav.eval': 'Evaluation',
      'nav.quickstart': 'Quick Start',
      'hero.eyebrow': 'Local Rust Agent · Vision Semantics · Mask First, Reveal Later',
      'hero.title': 'Reclaim your feed<br>before noise hits your eyes.',
      'hero.desc': '<strong>Cognition Filter</strong> pairs a local Rust agent, native DLL site plugins, and Tampermonkey userscripts. Cards are masked the instant they enter the DOM and evaluated across title, author, and cover imagery—keeping your cookies and API key strictly on your machine.',
      'hero.download': 'Download Windows v0.11.0',
      'hero.quickstart': '3-Minute Quick Start',
      'hero.releaseNotes': 'Release Notes',
      'hero.metric1Label': 'Exact Label Accuracy',
      'hero.metric1Sub': '0% False Allow Rate',
      'hero.metric2Label': 'Compact Prompt Savings',
      'hero.metric2Sub': '+ Per-Site KV Warmup',
      'hero.metric3Label': 'Local Security Boundary',
      'hero.metric3Sub': 'HMAC-SHA256 Pairing',
      'demo.tabBili': 'Bilibili Home',
      'demo.tabX': 'X Timeline',
      'demo.replay': 'Replay Pipeline',
      'demo.statusReady': 'Paired with local agent · 3 rule groups active',
      'demo.statusRunning': 'Evaluating viewport cards sequentially…',
      'demo.hint': 'Click "Reveal" on blurred cards to try false-positive feedback',
      'demo.maskedLabel': 'Pending · Masked',
      'demo.maskedSub': 'Zero flash before verdict',
      'demo.matchedLabel': 'Matched: {rule}',
      'demo.blurSub': '30px Gaussian blur applied',
      'demo.reveal': 'Reveal',
      'demo.remask': 'Re-mask',
      'demo.reportFp': 'Report Misfilter',
      'demo.fpApplied': '<strong>Added exclude rule:</strong> "{point}"',
      'demo.allowBadge': 'Allowed',
      'demo.nativeBadge': 'Ad / Live · Native Skip (0 Tokens)',
      'features.tag': 'Beyond Keyword Filters',
      'features.title': 'Four Pillars of Semantic Feed Filtering',
      'features.lead': 'Regex cannot tell rage-bait apart from debunking, nor read walls of Q&A screenshots inside thumbnails. Cognition Filter rethinks feed hygiene from rendering to rule evolution.',
      'features.f1Title': 'Mask First, Evaluate Later · Zero-Flash Shield',
      'features.f1Desc': 'Cards receive an opaque placeholder the moment they appear. Near-viewport cards queue first and unhide only on an explicit allow verdict. Lazy-loading covers wait up to 5s without burning concurrency slots.',
      'features.f2Title': 'Multimodal Title, Author & Thumbnail Analysis',
      'features.f2Desc': 'Evaluates title/body text, creator handle, and cover images together (up to 4 photos or video posters on X) against natural-language include & exclude criteria.',
      'features.f3Title': 'Human-in-the-Loop Rule Refinement',
      'features.f3Desc': 'Report false positives on any revealed card or pick missed cards straight from the page. The model reflects on visual and textual evidence to generate editable exclude or include points.',
      'features.f4Title': 'Per-Site Prefix Warmup & 3-Tier Scheduling',
      'features.f4Desc': 'Warms each enabled site’s "Global + Site Rules" KV cache prefix independently on DeepSeek-compatible endpoints, backed by a 1,024-entry 24h in-memory cache and shared 429 cooldowns.',
      'arch.tag': 'Engineering & Privacy Boundaries',
      'arch.title': 'Inspect Every Stage of the Local Pipeline',
      'arch.lead': 'Credentials and browser sessions never cross boundaries. Cookies stay in the browser; API keys never leave localhost.',
      'arch.s1Title': 'Browser Userscript',
      'arch.s1Sub': 'DOM masking & page canvas read',
      'arch.s2Title': 'Port Discovery & HMAC',
      'arch.s2Sub': '33-port LCG + challenge-response',
      'arch.s3Title': 'Local Rust Agent',
      'arch.s3Sub': 'Scheduling, cache & SSRF guard',
      'arch.s4Title': 'Vision LLM API',
      'arch.s4Sub': 'KV prefix warmup & JSON schema',
      'plugins.tag': 'Native DLL Plugin Interface v1',
      'plugins.title': 'Two Built-In Sites, Ready for Custom Feeds',
      'plugins.lead': 'Each site compiles into a self-contained native DLL embedding its JSON manifest and userscript template—hot-reloadable from the WebUI with isolated schedules.',
      'plugins.biliName': 'Bilibili Desktop Home',
      'plugins.biliF1': 'Reads rendered cover thumbnails directly from browser memory first, falls back to anonymous CORS cache fetch, then whitelisted agent CDN download.',
      'plugins.biliF2': 'Natively skips ads and live streams on the client; ships with a dedicated Q&A / comment screenshot-video rule.',
      'plugins.biliF3': 'Optional auto "Not Interested" feedback on blocked cards to train your account feed.',
      'plugins.xName': 'X Home Timeline',
      'plugins.xF1': 'Supports "For You" and "Following" timelines while automatically skipping promoted tweets and non-home routes.',
      'plugins.xF2': 'Extracts author and up to 8,192 UTF-16 units of visible text, supporting text-only posts and up to 4 images or video posters.',
      'plugins.xF3': 'Shares global rules with Bilibili while keeping independent site rules, prefix warmup, cache, and token accounting.',
      'sdk.copy': 'Copy Snippet',
      'sdk.copied': 'Copied',
      'sdk.foot': 'Drop compiled DLLs into plugins/ and click "Scan Plugins" in the WebUI. Hot-reloads safely with automatic rollback on invalid manifests.',
      'sdk.docsLink': 'Plugin Interface Docs →',
      'webui.tag': 'Built-In Bilingual Console',
      'webui.title': 'Rules, Plugin Schedules & Token Attribution in One Place',
      'webui.lead': 'Double-click the Windows tray icon anytime to launch the local WebUI with instant Chinese / English switching and adaptive light/dark themes.',
      'webui.tabRules': 'Filter Rules',
      'webui.tabStats': 'Statistics',
      'webui.tabPlugins': 'Site Plugins',
      'webui.tabPairing': 'Pairing',
      'eval.tag': 'Live Model Benchmark',
      'eval.title': 'Evidence-First Prompts Cut Tokens While Raising Multi-Label Recall',
      'eval.lead': 'Controlled A/B benchmark on DeepSeek deepseek-flash across 43 human-labeled cards (22 with real & synthetic covers).',
      'eval.exact': 'Exact Label-Set Match',
      'eval.falseAllow': 'False Allow Across 4 Suites',
      'eval.tokenDrop': 'Total Token Reduction',
      'eval.barBase': 'Baseline Prompt',
      'eval.barCompact': 'Compact Evidence-First Prompt',
      'eval.footnote': 'The compact prompt instructs the model to output ≤10 characters of visible evidence before emitting all matched rule indices. Full report in docs/evaluation.md.',
      'eval.suiteHeading': 'Breakdown by Suite (Compact)',
      'eval.s1Name': 'User Covers & Controls (8 cards)',
      'eval.s2Name': 'Format & Stance Boundaries (6 cards)',
      'eval.s3Name': 'Holdout Image+Text Suite (6 cards)',
      'eval.s4Name': 'Text-Only Base & Custom Rules (23 cards)',
      'eval.reportLink': 'View Full Evaluation Report →',
      'start.tag': 'Up and Running in 3 Steps',
      'start.title': 'From Download to Filtered Feeds in 3 Minutes',
      'start.step1Title': 'Launch Agent & Set API Key',
      'start.step1Desc': 'Run the Windows installer, then open Cognition Filter from the Start menu. Double-click the tray funnel icon and configure your DeepSeek or compatible vision model API key.',
      'start.step2Title': 'Install Site Userscripts',
      'start.step2Desc': 'Install Tampermonkey, right-click the tray icon → "Open Pairing Page", install the Bilibili or X userscript, and copy your 48-char pairing code.',
      'start.step3Title': 'Paste Pairing Code on Homepage',
      'start.step3Desc': 'Refresh Bilibili or X home and paste the pairing code in the prompt. Refine rules anytime via in-page false-positive reports or manual card picking.',
      'cta.title': 'Ready to filter out feed noise?',
      'cta.desc': 'The Windows x64 archive bundles the Rust agent and both Bilibili & X site plugins (~2.64 MB).',
      'cta.download': 'Download v0.11.0 (MSI)',
      'cta.guide': 'Read User Guide',
      'docs.label': 'Documentation:',
      'docs.userGuide': 'User Guide',
      'docs.arch': 'Architecture & Security',
      'docs.config': 'Config & HTTP API',
      'docs.plugins': 'Plugin SDK',
      'docs.dev': 'Development & Eval',
      'footer.copy': 'Cognition Filter · Local-First Multimodal Semantic Feed Filter',
    },
  };

  let lang = detectInitialLang();
  let theme = detectInitialTheme();
  let activeSite = 'bilibili';
  let activeStage = 'userscript';
  let activeCode = 'manifest';
  let activeScreen = 'rules';
  let demoCardsState = {};
  let demoTimers = [];

  function detectInitialLang() {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'zh-CN' || saved === 'en') return saved;
    } catch { /* ignore */ }
    const nav = (navigator.language || '').toLowerCase();
    return nav.startsWith('zh') ? 'zh-CN' : 'en';
  }

  function detectInitialTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* ignore */ }
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function t(key, vars) {
    const dict = i18n[lang] || i18n['zh-CN'];
    let text = dict[key] ?? i18n['zh-CN'][key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, v);
      }
    }
    return text;
  }

  function applyI18n() {
    document.documentElement.lang = lang;
    document.title = t('meta.title');
    const langLabel = document.getElementById('lang-label');
    if (langLabel) langLabel.textContent = lang === 'zh-CN' ? 'EN' : '中文';

    for (const el of document.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      const val = t(key);
      if (val.includes('<')) el.innerHTML = val;
      else el.textContent = val;
    }

    renderDemoFeed();
    renderArchDetail();
    renderSdkCode();
    renderWebUIScreen();
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme);
  }

  /* ---------- Interactive Demo Data ---------- */
  const demoCatalog = {
    bilibili: {
      'zh-CN': [
        {
          id: 'b1',
          kind: 'block',
          thumbClass: 'thumb-screenshot',
          thumbTag: '问答截图 · 42 条评论拼贴',
          thumbLines: ['网友1：五五分流后普高名额再降…', '网友2：2023→2026 人数断崖对比…'],
          title: '中考五五分流为什么分不下去了？',
          author: '热点搬运观察 · 3.8万播放',
          rule: '鼓吹对立相关 · 截图转视频',
          fpPoint: '包含政策数据出处与客观教育解读，并非纯情绪拼贴',
        },
        {
          id: 'b2',
          kind: 'allow',
          thumbClass: 'thumb-vlog',
          thumbTag: '户外实拍 · 12:40',
          thumbLines: ['[海钓实拍现场] 潮汐风向复盘', '两小时零渔获的线组排查'],
          title: '最让我破防的一次海钓：实拍两小时没上鱼，到底是哪一步出了错？',
          author: '阿海钓鱼日记 · 6.4万播放',
          verdictNote: '实拍经验复盘',
        },
        {
          id: 'b3',
          kind: 'block',
          thumbClass: 'thumb-rage',
          thumbTag: '大字情绪标题 · 阶层叙事',
          thumbLines: ['「50块解决绝大部分麻烦」', '把钱给基层，什么事都好谈？'],
          title: '生活经验 | 五十块钱消费可以解决绝大部分麻烦，把钱给基层劳动者',
          author: '人情世故切片 · 11.2万播放',
          rule: '鼓吹对立相关',
          fpPoint: '记录真实服务消费礼仪与合规收费说明，不鼓吹特权通融',
        },
        {
          id: 'b4',
          kind: 'native',
          thumbClass: 'thumb-ad',
          thumbTag: '商业推广 / 直播间',
          thumbLines: ['[原生推广位]', '本地直接识别，不发送给大模型'],
          title: '某品牌春季新品限时体验活动',
          author: '推广卡片 · 本机跳过',
        },
      ],
      en: [
        {
          id: 'b1',
          kind: 'block',
          thumbClass: 'thumb-screenshot',
          thumbTag: 'Q&A Screenshot · Stitched',
          thumbLines: ['Comment #1: High school quota drops…', 'Comment #2: 2023 vs 2026 panic chart…'],
          title: 'Why Is the 50/50 High School Track Failing?',
          author: 'HotTake Digest · 38K views',
          rule: 'Division Bait · Screenshot Video',
          fpPoint: 'Cites official policy data with balanced educational analysis',
        },
        {
          id: 'b2',
          kind: 'allow',
          thumbClass: 'thumb-vlog',
          thumbTag: 'Outdoor Vlog · 12:40',
          thumbLines: ['[Real Sea Fishing Footage]', '2 hours zero catch rig debugging'],
          title: 'My Most Frustrating Sea Fishing Trip: 2 Hours Zero Catch Breakdown',
          author: 'Ahai Fishing Log · 64K views',
          verdictNote: 'Real vlog review',
        },
        {
          id: 'b3',
          kind: 'block',
          thumbClass: 'thumb-rage',
          thumbTag: 'Bold Text · Class Framing',
          thumbLines: ['"$7 tip solves everything"', 'Pay frontline workers to bypass rules?'],
          title: 'Life Hack | Fifty Yuan Tips Solve Almost Every Hassle',
          author: 'Social Hacks · 112K views',
          rule: 'Division Bait',
          fpPoint: 'Explains standard tipping etiquette and itemized service charges',
        },
        {
          id: 'b4',
          kind: 'native',
          thumbClass: 'thumb-ad',
          thumbTag: 'Promoted / Live Room',
          thumbLines: ['[Native Ad Slot]', 'Skipped locally · zero LLM cost'],
          title: 'Spring Hardware Launch Livestream',
          author: 'Sponsored · Skipped Locally',
        },
      ],
    },
    x: {
      'zh-CN': [
        {
          id: 'x1',
          kind: 'block',
          thumbClass: 'thumb-rage',
          thumbTag: '纯文字帖 · 情绪煽动',
          thumbLines: ['「某个群体根本不配谈公平」', '引用截图拉踩 · 4800+ 转发'],
          title: '又是经典站队帖：非黑即白的二元对立话术加上去上下文聊天截图…',
          author: '@viral_outrage · 为你推荐',
          rule: '鼓吹对立相关',
          fpPoint: '理性讨论公共议题的事实核查与多方论证引用',
        },
        {
          id: 'x2',
          kind: 'allow',
          thumbClass: 'thumb-vlog',
          thumbTag: '工程实践 · 图表对比',
          thumbLines: ['Prompt KV-Cache Hit Rate: 91%', 'Compact schema cuts 15.9% tokens'],
          title: '我们如何通过按站点独立预热 KV Cache 将多模态过滤成本压低到每卡不足 200 输入 token',
          author: '@rust_systems · 正在关注',
          verdictNote: '技术经验分享',
        },
        {
          id: 'x3',
          kind: 'block',
          thumbClass: 'thumb-screenshot',
          thumbTag: '地缘政治 · 多图海报',
          thumbLines: ['[2 张配图 + 竞选演讲海报]', '政党路线争议与选区投票分析'],
          title: '最新大选民调与某政党议会法案攻防全梳理（附现场四张图表）',
          author: '@policy_watch · 为你推荐',
          rule: '政治相关',
          fpPoint: '虚构影视剧情介绍或普通市政办事流程指引',
        },
        {
          id: 'x4',
          kind: 'native',
          thumbClass: 'thumb-ad',
          thumbTag: 'Promoted Tweet',
          thumbLines: ['[placementTracking]', '本机检测为广告，直接跳过'],
          title: 'Cloud GPU 限时特惠促销',
          author: '广告推广 · 本机跳过',
        },
      ],
      en: [
        {
          id: 'x1',
          kind: 'block',
          thumbClass: 'thumb-rage',
          thumbTag: 'Text-Only · Outrage Bait',
          thumbLines: ['"Group X never deserves fairness"', 'Out-of-context screenshot · 4.8K RTs'],
          title: 'Classic tribal outrage bait framing everyday disagreements as group warfare…',
          author: '@viral_outrage · For You',
          rule: 'Division Bait',
          fpPoint: 'Fact-check thread quoting opposing claims strictly for rebuttal',
        },
        {
          id: 'x2',
          kind: 'allow',
          thumbClass: 'thumb-vlog',
          thumbTag: 'Engineering · 1 Chart',
          thumbLines: ['Prompt KV-Cache Hit Rate: 91%', 'Compact schema cuts 15.9% tokens'],
          title: 'How per-site KV cache warmup cut our multimodal card evaluation tokens by 15.9%',
          author: '@rust_systems · Following',
          verdictNote: 'Engineering post',
        },
        {
          id: 'x3',
          kind: 'block',
          thumbClass: 'thumb-screenshot',
          thumbTag: 'Politics · 4 Media Items',
          thumbLines: ['[Campaign Rally Poster]', 'Election poll & party platform clash'],
          title: 'Full breakdown of this week’s parliamentary election vote and campaign strategy',
          author: '@policy_watch · For You',
          rule: 'Politics',
          fpPoint: 'Fictional movie plot or mundane municipal permit procedure',
        },
        {
          id: 'x4',
          kind: 'native',
          thumbClass: 'thumb-ad',
          thumbTag: 'Promoted Tweet',
          thumbLines: ['[placementTracking]', 'Skipped locally before API call'],
          title: 'Enterprise Cloud GPU Promo',
          author: 'Promoted · Skipped Locally',
        },
      ],
    },
  };

  function resetDemoCards() {
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    const cards = demoCatalog[activeSite][lang];
    demoCardsState = {};
    cards.forEach((c) => {
      demoCardsState[c.id] = {
        phase: c.kind === 'native' ? 'native' : 'masked',
        revealed: false,
        fpSent: false,
      };
    });
    const statusEl = document.getElementById('demo-pipeline-text');
    if (statusEl) statusEl.textContent = t('demo.statusRunning');
    renderDemoFeed();

    cards.forEach((c, idx) => {
      if (c.kind === 'native') return;
      const timer = setTimeout(() => {
        if (!demoCardsState[c.id]) return;
        demoCardsState[c.id].phase = c.kind;
        renderDemoFeed();
        if (idx === cards.length - 2 || idx === cards.length - 1) {
          if (statusEl) statusEl.textContent = t('demo.statusReady');
        }
      }, 420 + idx * 360);
      demoTimers.push(timer);
    });
  }

  function renderDemoFeed() {
    const container = document.getElementById('demo-feed');
    if (!container) return;
    const cards = demoCatalog[activeSite][lang];

    container.innerHTML = cards.map((card) => {
      const state = demoCardsState[card.id] || { phase: card.kind, revealed: false, fpSent: false };
      let domState = state.phase;
      if (state.phase === 'block' && state.revealed) domState = 'revealed';

      let overlay = '';
      if (state.phase === 'masked') {
        overlay = `
          <div class="feed-overlay overlay-masked">
            <div class="skeleton-pulse"></div>
            <span class="rule-pill" style="background:var(--accent-soft);color:var(--accent);border-color:var(--line-strong)">${t('demo.maskedLabel')}</span>
            <span class="overlay-sub">${t('demo.maskedSub')}</span>
          </div>`;
      } else if (state.phase === 'block' && !state.revealed) {
        overlay = `
          <div class="feed-overlay overlay-blocked">
            <span class="rule-pill">${t('demo.matchedLabel', { rule: card.rule })}</span>
            <span class="overlay-sub">${t('demo.blurSub')}</span>
            <button class="mini-btn" type="button" data-action="reveal" data-id="${card.id}">${t('demo.reveal')}</button>
          </div>`;
      }

      let footer = '';
      if (card.kind === 'allow') {
        footer = `<span class="verdict-chip chip-allow">✓ ${t('demo.allowBadge')} · ${card.verdictNote}</span>`;
      } else if (card.kind === 'native') {
        footer = `<span class="verdict-chip chip-native">${t('demo.nativeBadge')}</span>`;
      } else if (state.revealed) {
        footer = `
          <span class="verdict-chip chip-revealed">${card.rule}</span>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="mini-btn" type="button" data-action="remask" data-id="${card.id}">${t('demo.remask')}</button>
            <button class="mini-btn mini-btn-warn" type="button" data-action="fp" data-id="${card.id}">${t('demo.reportFp')}</button>
          </div>`;
      }

      const fpBanner = state.fpSent
        ? `<div class="feedback-toast">${t('demo.fpApplied', { point: card.fpPoint })}</div>`
        : '';

      return `
        <article class="feed-card" data-state="${domState}">
          ${overlay}
          <div class="feed-card-body">
            <div class="feed-thumb ${card.thumbClass}">
              <span class="thumb-tag">${card.thumbTag}</span>
              <div class="thumb-quote-lines">
                ${card.thumbLines.map((line) => `<span>${line}</span>`).join('')}
              </div>
            </div>
            <div class="feed-info">
              <h4 class="feed-title">${card.title}</h4>
              <div class="feed-author">${card.author}</div>
              ${fpBanner}
              <div class="feed-verdict-row">${footer}</div>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  /* ---------- Interactive Architecture Data ---------- */
  const archDetails = {
    userscript: {
      'zh-CN': {
        title: '01 · 浏览器油猴脚本（DOM 遮罩与页面读图）',
        desc: '脚本在 document-start 阶段即注入样式规则，推荐卡片一进入 DOM 就处于不可见占位状态，彻底消除先闪现后隐藏的视觉污染。',
        points: [
          '接近视口优先队列：优先送审用户即将滚动到的卡片，降低首屏感知延迟。',
          '三级封面获取：优先直读页面渲染图片生成 JPEG 缩略图（≤96 KiB）→ 匿名跨域缓存读图 → 最后兜底给 Agent 传白名单地址。',
          '节点复用校验：传入 DOM 世代（generation）与当前页校验回调，防止虚拟滚动复用节点后将旧判定贴到新卡片上。',
        ],
        spec: `// 卡片状态机
native  -> 本机识别广告/直播，直接跳过
masked  -> 占位遮盖 (visibility: hidden)
allow   -> 解除遮罩，展示卡片
block   -> filter: blur(30px) + 规则标签
pending -> 保持遮盖，网络错误指数退避重试`,
      },
      en: {
        title: '01 · Browser Userscript (DOM Masking & Canvas Capture)',
        desc: 'Injects CSS at document-start so recommendation cards are masked the instant they mount, preventing any flicker before evaluation completes.',
        points: [
          'Viewport-priority queue: cards near the user viewport evaluate first for snappy scrolling.',
          '3-tier thumbnail capture: local canvas JPEG (≤96 KiB) → anonymous CORS cache read → agent CDN fallback.',
          'Virtual-scroll guard: checks DOM binding generation and active route before applying late responses.',
        ],
        spec: `// Card State Machine
native  -> Local ad/live skip (0 API calls)
masked  -> Opaque placeholder (visibility: hidden)
allow   -> Unmask card immediately
block   -> filter: blur(30px) + rule badge
pending -> Stay masked; backoff retry on network error`,
      },
    },
    discovery: {
      'zh-CN': {
        title: '02 · 自动端口发现与 HMAC-SHA256 双向配对',
        desc: '彻底解决本地端口被其他程序占用或 Windows 保留端口冲突问题，同时防止恶意本地进程冒充 Agent 窃取浏览信息。',
        points: [
          '确定性 33 端口序列：优先尝试 17321，失败后通过固定 LCG 算法在 49152–65535 依次探测最多 32 个高位端口（56635, 62072, 64881…）。',
          '质询-响应验真：脚本携带 32 位随机 hex nonce 访问 /.well-known/cognition-filter，Agent 返回 HMAC-SHA256 签名 proof。',
          '双通道权限隔离：脚本使用派生凭据 CF-Port 仅访问过滤端点；WebUI 管理接口另用每次启动随机生成的 settings_token。',
        ],
        spec: `GET /.well-known/cognition-filter?nonce=<32-hex>
proof = HMAC-SHA256(token, "cognition-filter/v1|{port}|{nonce}")
auth  = CF-Port HMAC-SHA256(token, "cognition-filter/auth/v1|{port}")
// Host 严格校验 127.0.0.1:{port}，管理接口额外校验 Origin`,
      },
      en: {
        title: '02 · Deterministic Port Discovery & HMAC-SHA256 Pairing',
        desc: 'Eliminates port conflicts cleanly while proving to the browser script that the localhost listener truly owns the pairing secret.',
        points: [
          '33-port sequence: tries 17321 first, then 32 deterministic LCG ports in 49152–65535 (56635, 62072, 64881…).',
          'Challenge-response: userscript sends a 32-hex nonce to /.well-known/cognition-filter and verifies the HMAC proof locally.',
          'Privilege separation: scripts hold port-derived CF-Port tokens; WebUI admin endpoints use an ephemeral settings_token + Origin check.',
        ],
        spec: `GET /.well-known/cognition-filter?nonce=<32-hex>
proof = HMAC-SHA256(token, "cognition-filter/v1|{port}|{nonce}")
auth  = CF-Port HMAC-SHA256(token, "cognition-filter/auth/v1|{port}")
// Strict Host: 127.0.0.1:{port} & Origin enforcement`,
      },
    },
    agent: {
      'zh-CN': {
        title: '03 · 本地 Rust Agent（三级并发调度、缓存与 SSRF 防护）',
        desc: '基于 Tokio + Axum 构建的单实例后台守护程序（agent.lock 互斥），统一协调站点插件、规则存储、封面下载、缓存与限流。',
        points: [
          '三层并发信号量：页面送审并发（默认 8）、站点备用封面并发（watch channel，B 站默认 48）、全局模型并发与分模型上限（默认 64 / 2500）。',
          '1,024 条 / 24 小时内存 LRU 缓存：键包含站点 ID、卡片文字、图片字节 SHA-256、生效规则集与模型指纹，任意规则变动即自动失效。',
          '严格防 SSRF 封面下载：仅在页面无法读图时触发，强制 HTTPS、无凭据/查询参数/非默认端口，并精确匹配清单 hosts 与 pathPattern 正则。',
        ],
        spec: `%LOCALAPPDATA%\\CognitionFilter\\
├── runtime.json          # 模型配置、API Key 与站点并发覆盖
├── rules.json            # 规则组（最多24组）与纠错样本（≤512条）
├── pairing-token         # 48位十六进制本机密钥
├── disabled-plugins.json # 跨重启站点禁用列表
└── statistics.json       # 按站点与规则归因统计（5s 周期落盘）`,
      },
      en: {
        title: '03 · Local Rust Agent (3-Tier Scheduler, Cache & SSRF Guard)',
        desc: 'Single-instance Tokio + Axum daemon (locked via agent.lock) orchestrating DLL plugins, rules, fallback image fetches, caching, and rate limits.',
        points: [
          '3-tier concurrency: per-tab browserConcurrency (default 8), per-site coverConcurrency (default 48), and global/provider model limits.',
          '1,024-entry / 24h in-memory cache keyed by site, text, cover SHA-256, active rule revision, and model fingerprint.',
          'Strict SSRF guard: fallback cover fetches enforce HTTPS-only, no query/credentials, and regex-validated hosts/pathPattern from site.json.',
        ],
        spec: `%LOCALAPPDATA%\\CognitionFilter\\
├── runtime.json          # Model config, API key & site scheduling
├── rules.json            # Up to 24 rule groups & ≤512 feedback examples
├── pairing-token         # 48-hex OS-random pairing secret
├── disabled-plugins.json # Persistent disabled plugin IDs
└── statistics.json       # Per-site & per-rule usage ledger (5s flush)`,
      },
    },
    model: {
      'zh-CN': {
        title: '04 · 视觉大模型与站点前缀预热（KV Cache）',
        desc: '兼容 DeepSeek 及任何支持图片输入与 JSON 输出的 OpenAI Chat Completions 接口，通过结构化提示词兼顾高准确度与低费率。',
        points: [
          '按站点独立预热：为每个启用站点单独发送「全局规则 + 本站规则」确认轮次，每张卡从此确认轮次分叉，显著提高服务端前缀缓存命中率。',
          '共享 429 冷却窗与指数退避：遇限流时同模型并发共享冷却窗口，按 ~0.5s / ~1s 加随机抖动重试，尊重服务端 Retry-After 头。',
          '抗注入提示词：明确将标题、昵称和图片文字视为待测素材，严格校验响应 JSON 与规则边界；先输出 ≤10 字依据再输出编号。',
        ],
        spec: `// 模型精简输出契约 (site-card-15)
{"e":"网评拼贴、群体分层","v":[[2,3]]}

// 统计透明：/v1/status 单列预热指标
warmupCalls | warmupInputTokens | warmupHitTokens | warmupFailures`,
      },
      en: {
        title: '04 · Vision LLM & Per-Site Prefix Warmup (KV Cache)',
        desc: 'Works with DeepSeek or any OpenAI-compatible multimodal endpoint supporting JSON output, engineered for accuracy and token efficiency.',
        points: [
          'Independent site warmup: pre-warms "Global + Site Rules" once per enabled DLL; every card forks from that confirmation turn for high KV cache hits.',
          'Shared 429 cooldown: concurrent requests on the same model share rate-limit windows and retry with jittered backoff (honoring Retry-After).',
          'Prompt-injection resilient: treats card text & OCR text strictly as untrusted data and enforces strict JSON + rule-index validation.',
        ],
        spec: `// Compact JSON Output Contract (site-card-15)
{"e":"Comment collage, division","v":[[2,3]]}

// Full observability via /v1/status:
warmupCalls | warmupInputTokens | warmupHitTokens | warmupFailures`,
      },
    },
  };

  function renderArchDetail() {
    const el = document.getElementById('arch-detail');
    if (!el) return;
    const data = archDetails[activeStage][lang];
    el.innerHTML = `
      <div>
        <h3>${data.title}</h3>
        <p>${data.desc}</p>
        <ul class="arch-points">
          ${data.points.map((p) => `<li>${p}</li>`).join('')}
        </ul>
      </div>
      <pre class="arch-spec-box">${data.spec}</pre>
    `;
  }

  /* ---------- SDK Code Snippets ---------- */
  const sdkSnippets = {
    manifest: `{
  "id": "x",
  "name": "X 首页时间线",
  "version": "0.2.0",
  "textPostLimit": 8192,
  "scheduling": { "browserConcurrency": 8, "coverConcurrency": 16 },
  "pagePolicy": {
    "timeline": "[data-testid=primaryColumn]",
    "post": "article[data-testid=tweet]",
    "text": "[data-testid=tweetText]",
    "author": "[data-testid=User-Name]"
  },
  "cover": {
    "hosts": ["pbs.twimg.com"],
    "pathPattern": "/(?:media/[A-Za-z0-9_-]+|(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|card_img)/[A-Za-z0-9_/-]+)\\\\.(?:jpg|jpeg|png|webp)",
    "referer": "https://x.com/"
  }
}`,
    rust: `// Cargo.toml: cf-site-sdk = { path = "../../sdk" }
// crate-type = ["cdylib"]

// src/lib.rs
cf_site_sdk::export_site!(
    include_bytes!("../site.json"),
    include_bytes!("../x.user.js"),
);

// Build & install into plugins/
// cargo build --release`,
    cabi: `/* sdk/cf_site.h — Language-agnostic C ABI v1 */
#pragma once
#include <stddef.h>
#include <stdint.h>

/* kind 0: UTF-8 manifest JSON (max 64 KiB)
   kind 1: UTF-8 userscript template (max 2 MiB)
   Host never frees the returned pointer. */
CF_EXPORT const uint8_t *CF_CALL
cf_site_resource_v1(uint32_t kind, size_t *length);`,
    userscript: `// ==UserScript==
// @name         Reader · Cognition Filter
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==
(() => {
  'use strict';
  /* @cognition-client-v1 */
  const client = createCognitionClient();

  async function reviewCard(id, title, author, pageCover, revision, current) {
    return client.review({ id, title, author, pageCover }, revision, current);
  }
})();`,
  };

  function renderSdkCode() {
    const el = document.getElementById('sdk-code');
    if (el) el.textContent = sdkSnippets[activeCode];
  }

  /* ---------- WebUI Preview Screens ---------- */
  const ruleToggles = { politics: true, division: true, 'post-video': true };

  function renderWebUIScreen() {
    const vp = document.getElementById('webui-viewport');
    if (!vp) return;
    const zh = lang === 'zh-CN';

    if (activeScreen === 'rules') {
      const groups = [
        {
          id: 'politics',
          name: zh ? '政治相关' : 'Politics',
          scope: zh ? '全局（所有网站）' : 'Global (all sites)',
          inc: zh
            ? ['以政治人物的政治活动、政党、选举或政治制度为主题', '以政府决策、公共政策或地缘政治为主题']
            : ['Topics centered on politicians, elections, parties, or governance', 'Government policy or geopolitical conflict'],
          exc: zh
            ? ['虚构剧情、普通办事流程，或个人故事中顺带提及政治']
            : ['Fictional plots, mundane errands, or passing mentions'],
        },
        {
          id: 'division',
          name: zh ? '鼓吹对立相关' : 'Division Bait',
          scope: zh ? '全局（所有网站）' : 'Global (all sites)',
          inc: zh
            ? ['煽动群体敌意、贬低或站队', '升学/就业问句配编号评论拼贴渲染群体淘汰焦虑']
            : ['Inciting group hostility, stereotyping, or tribalism', 'Anxiety-baiting collage of numbered comments'],
          exc: zh
            ? ['中性报道、核查反驳、劝和或就事论事的政策解释']
            : ['Neutral reporting, fact-checking, or policy explanation'],
        },
        {
          id: 'post-video',
          name: zh ? '网帖、问答和评论截图转视频' : 'Screenshot-to-Video',
          scope: 'bilibili',
          inc: zh
            ? ['问句标题配满屏多行个人叙事或对话文字', '社交平台评论截图作视频主体（可见头像/点赞线索）']
            : ['Question title + full-screen Q&A text narration', 'Social media comment screenshots as video subject'],
          exc: zh
            ? ['网站教程、实拍字幕、原创讲义，或偶尔引用网帖的独立讲解']
            : ['Tutorials, live-action vlogs, or original commentary'],
        },
      ];
      vp.innerHTML = `
        <div class="mock-grid mock-grid-3">
          ${groups.map((g) => `
            <div class="mock-card">
              <div class="mock-card-head">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${g.name}</strong>
                  <span class="mock-scope">${g.scope}</span>
                </div>
                <label class="mock-toggle">
                  <input type="checkbox" data-rule-toggle="${g.id}" ${ruleToggles[g.id] ? 'checked' : ''}>
                  <span>${zh ? (ruleToggles[g.id] ? '已启用' : '已停用') : (ruleToggles[g.id] ? 'Enabled' : 'Disabled')}</span>
                </label>
              </div>
              <div style="font-size:0.78rem;font-weight:700;color:var(--accent);margin-bottom:4px">${zh ? '命中要点 (Include)' : 'Include Points'}</div>
              <ul class="mock-points">${g.inc.map((p) => `<li>${p}</li>`).join('')}</ul>
              <div style="font-size:0.78rem;font-weight:700;color:var(--text-muted);margin:10px 0 4px">${zh ? '保留例外 (Exclude)' : 'Exclude Points'}</div>
              <ul class="mock-points">${g.exc.map((p) => `<li>${p}</li>`).join('')}</ul>
            </div>
          `).join('')}
        </div>`;
    } else if (activeScreen === 'stats') {
      vp.innerHTML = `
        <div class="mock-stats-row">
          <div class="mock-stat-box"><span>${zh ? '收到送审' : 'Submitted'}</span><strong>1,482</strong></div>
          <div class="mock-stat-box"><span>${zh ? '屏蔽率' : 'Block Rate'}</span><strong style="color:var(--danger)">28.4%</strong></div>
          <div class="mock-stat-box"><span>${zh ? '本地缓存命中' : 'Local Cache Hits'}</span><strong style="color:var(--accent)">34.6%</strong></div>
          <div class="mock-stat-box"><span>${zh ? '模型前缀命中率' : 'Prefix Hit Rate'}</span><strong style="color:var(--accent-2)">89.2%</strong></div>
        </div>
        <table class="mock-table">
          <thead>
            <tr>
              <th>${zh ? '网站' : 'Site'}</th>
              <th>${zh ? '收到送审' : 'Submitted'}</th>
              <th>${zh ? '规则预热' : 'Warmups'}</th>
              <th>${zh ? '本地缓存率' : 'Local Cache'}</th>
              <th>${zh ? '前缀命中率' : 'Prefix Hit'}</th>
              <th>${zh ? '输入 Token' : 'Input Tokens'}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>哔哩哔哩首页 (bilibili)</td><td>964</td><td>3</td><td>36.1%</td><td>90.4%</td><td>218,450</td></tr>
            <tr><td>X 首页时间线 (x)</td><td>518</td><td>2</td><td>31.8%</td><td>86.9%</td><td>112,840</td></tr>
            <tr style="font-weight:700;color:var(--accent)"><td>${zh ? '全局汇总' : 'All Sites'}</td><td>1,482</td><td>5</td><td>34.6%</td><td>89.2%</td><td>331,290</td></tr>
          </tbody>
        </table>`;
    } else if (activeScreen === 'plugins') {
      vp.innerHTML = `
        <div class="mock-grid mock-grid-3">
          <div class="mock-card">
            <div class="mock-card-head">
              <strong>哔哩哔哩首页 (bilibili)</strong>
              <span class="mock-scope">${zh ? '已启用' : 'Enabled'}</span>
            </div>
            <p style="margin:0 0 10px;font-size:0.82rem;color:var(--text-muted)">DLL 0.8.0 · Userscript 0.7.0 · cf_site_bilibili.dll</p>
            <div class="pill-row">
              <span>browserConcurrency: 8</span>
              <span>coverConcurrency: 48</span>
              <span>${zh ? '自动不感兴趣: 可配置' : 'Auto Not-Interested: Supported'}</span>
            </div>
          </div>
          <div class="mock-card">
            <div class="mock-card-head">
              <strong>X 首页时间线 (x)</strong>
              <span class="mock-scope">${zh ? '已启用' : 'Enabled'}</span>
            </div>
            <p style="margin:0 0 10px;font-size:0.82rem;color:var(--text-muted)">DLL 0.2.0 · Userscript 0.2.0 · cf_site_x.dll</p>
            <div class="pill-row">
              <span>browserConcurrency: 8</span>
              <span>coverConcurrency: 16</span>
              <span>textPostLimit: 8192</span>
            </div>
          </div>
        </div>`;
    } else {
      vp.innerHTML = `
        <div class="mock-card">
          <div class="mock-card-head">
            <strong>${zh ? '本机配对码（48 位十六进制密钥）' : 'Local Pairing Code (48-hex Secret)'}</strong>
            <span class="mock-scope">HMAC-SHA256</span>
          </div>
          <div style="padding:12px 14px;border-radius:8px;background:var(--bg);border:1px solid var(--line-strong);font-family:var(--font-mono);font-size:0.95rem;letter-spacing:0.06em;overflow-wrap:anywhere;margin-bottom:12px">
            4f9a8c12e7b03d519a64c20f8b17e3d49201a5c7e8f3b210
          </div>
          <p style="margin:0;font-size:0.84rem;color:var(--text-muted)">
            ${zh
              ? '脚本（0.4.0+）会自动沿 17321 与 32 个候选高位端口探测并通过质询签名验证本机 Agent，端口变更无需重新配对。'
              : 'Userscripts (0.4.0+) automatically probe 17321 and 32 deterministic fallback ports with HMAC challenge verification—no re-pairing needed if the port shifts.'}
          </p>
        </div>`;
    }
  }

  /* ---------- Event Wiring ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    applyI18n();
    resetDemoCards();

    document.getElementById('lang-toggle')?.addEventListener('click', () => {
      lang = lang === 'zh-CN' ? 'en' : 'zh-CN';
      try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
      applyI18n();
      resetDemoCards();
    });

    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
      applyTheme();
    });

    const menuToggle = document.getElementById('menu-toggle');
    const drawer = document.getElementById('mobile-drawer');
    menuToggle?.addEventListener('click', () => {
      const open = drawer.hidden;
      drawer.hidden = !open;
      menuToggle.setAttribute('aria-expanded', String(open));
    });
    drawer?.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') {
        drawer.hidden = true;
        menuToggle?.setAttribute('aria-expanded', 'false');
      }
    });

    document.querySelectorAll('.demo-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeSite = btn.dataset.site;
        document.querySelectorAll('.demo-tab').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        resetDemoCards();
      });
    });

    document.getElementById('replay-demo')?.addEventListener('click', resetDemoCards);

    document.getElementById('demo-feed')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      const entry = demoCardsState[id];
      if (!entry) return;
      if (action === 'reveal') entry.revealed = true;
      else if (action === 'remask') { entry.revealed = false; entry.fpSent = false; }
      else if (action === 'fp') entry.fpSent = true;
      renderDemoFeed();
    });

    document.querySelectorAll('.arch-node').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeStage = btn.dataset.stage;
        document.querySelectorAll('.arch-node').forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-selected', String(on));
        });
        renderArchDetail();
      });
    });

    document.querySelectorAll('.code-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeCode = btn.dataset.code;
        document.querySelectorAll('.code-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderSdkCode();
      });
    });

    document.getElementById('copy-code')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      try {
        await navigator.clipboard.writeText(sdkSnippets[activeCode]);
        btn.textContent = t('sdk.copied');
        setTimeout(() => { btn.textContent = t('sdk.copy'); }, 1500);
      } catch { /* ignore */ }
    });

    document.querySelectorAll('.webui-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeScreen = btn.dataset.screen;
        document.querySelectorAll('.webui-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        renderWebUIScreen();
      });
    });

    document.getElementById('webui-viewport')?.addEventListener('change', (e) => {
      const id = e.target?.dataset?.ruleToggle;
      if (!id) return;
      ruleToggles[id] = e.target.checked;
      renderWebUIScreen();
    });
  });
})();
