// ==UserScript==
// @name         Cognition Filter · 哔哩哔哩首页
// @namespace    cognition-filter.local
// @version      0.7.0
// @updateURL    none
// @downloadURL  none
// @description  先遮盖首页视频推荐，再按自己的自然语言规则显示通过检测的卡片
// @match        https://www.bilibili.com/*
// @run-at       document-start
// @noframes
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(() => {
  'use strict';

  /* @cognition-client-v1 */
  // The install-time snapshot masks the first paint even when the agent is offline.
  const bundledPolicy = /* @cognition-page-policy-v1 */ null;
  const cacheKey = 'cfPagePolicyV1';
  function readPolicy(value) {
    if (!value || typeof value !== 'object') return null;
    const parsed = {};
    const fragment = document.createDocumentFragment();
    for (const key of Object.keys(bundledPolicy)) {
      if (key === 'corsReadTimeoutMs') continue;
      const selector = value[key];
      if (typeof selector !== 'string' || !selector.trim() || selector.length > 2048 ||
          /[{};\\]|\/\*/.test(selector)) return null;
      try { fragment.querySelector(selector); } catch { return null; }
      parsed[key] = selector;
    }
    const timeout = value.corsReadTimeoutMs ?? bundledPolicy.corsReadTimeoutMs;
    if (!Number.isInteger(timeout) || timeout < 500 || timeout > 15000) return null;
    parsed.corsReadTimeoutMs = timeout;
    return parsed;
  }
  let policy = readPolicy(GM_getValue(cacheKey, null)) || bundledPolicy;
  let cardSelector, nativeMarker, coverSelector, titleSelector, badgeSelector;
  let layout = 0, styleNode;
  const home = () => ['/', '/index.html'].includes(location.pathname);
  let sitePaused = false;
  const applyRouteFlag = () => {
    const html = document.documentElement;
    if (html) {
      html.toggleAttribute('data-cf-home', home() && !sitePaused);
      if (html.dataset.cfLayout !== String(layout)) html.dataset.cfLayout = String(layout);
    }
  };
  function installPolicy() {
    const kinds = `:is(${policy.cards})`;
    ({ title: titleSelector, cover: coverSelector, native: nativeMarker, badge: badgeSelector } = policy);
    const content = `a[href], img, video, picture source, ${titleSelector}`;
    const skeleton = `:has(${policy.skeleton}):not(:has(${content}))`;
    cardSelector = `:is(${policy.scope}) ${kinds}:not(${kinds} *):not(${skeleton})`;
    layout++;
    const root = `html[data-cf-layout="${layout}"]`;
    const filterable = `${root}[data-cf-home] ${cardSelector}:not(${nativeMarker}):not(:has(${nativeMarker})):not([data-cf-state="native"])`;
    const mask = `${filterable}:not([data-cf-state="allow"],[data-cf-state="block"])`;
    const blocked = `${filterable}[data-cf-state="block"]`;
    const previous = styleNode;
    styleNode = GM_addStyle(`
    @keyframes cfMaskShimmer {
      0% { background-position: 100% 50% }
      100% { background-position: 0% 50% }
    }
    @keyframes cfCardReveal {
      from { opacity: 0.72 }
      to { opacity: 1 }
    }
    ${filterable}[data-cf-state="allow"] { animation: cfCardReveal 0.24s cubic-bezier(0.22, 1, 0.36, 1) }
    ${mask} { position:relative!important; visibility:hidden!important; pointer-events:none!important }
    ${mask} *, ${mask} *::before, ${mask} *::after, ${mask}::before {
      visibility:hidden!important; pointer-events:none!important }
    ${mask}::after {
      content:"等待过滤"; visibility:visible!important; position:absolute!important; inset:0!important;
      display:grid!important; place-content:center!important; padding:14px!important; box-sizing:border-box!important;
      border:1px solid rgba(15, 23, 42, 0.08)!important; border-radius:12px!important;
      color:#64748b!important;
      background:linear-gradient(110deg, #f1f5f9 28%, #f8fafc 48%, #f1f5f9 68%)!important;
      background-size:220% 100%!important;
      animation:cfMaskShimmer 2.1s ease-in-out infinite!important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,0.75)!important;
      text-align:center!important; letter-spacing:0.01em!important;
      font:500 12.5px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif!important;
      overflow:hidden!important; overflow-wrap:anywhere!important;
      pointer-events:none!important; z-index:1!important }
    @media (prefers-color-scheme: dark) {
      ${mask}::after {
        border-color:rgba(255, 255, 255, 0.08)!important;
        color:#94a3b8!important;
        background:linear-gradient(110deg, #161a22 28%, #1f2530 48%, #161a22 68%)!important;
        background-size:220% 100%!important;
        box-shadow:inset 0 1px 0 rgba(255,255,255,0.05)!important }
    }
    ${mask}[data-cf-label]::after { content:attr(data-cf-label)!important }
    ${blocked} { position:relative!important; overflow:hidden!important; isolation:isolate!important; border-radius:12px!important }
    ${blocked} > :not([data-cf-controls]) { filter:blur(30px)!important; user-select:none!important }
    ${blocked} > :not([data-cf-controls]), ${blocked} > :not([data-cf-controls]) * { pointer-events:none!important }
    ${blocked} > [data-cf-controls] { position:absolute!important; inset:0!important; display:block!important;
      pointer-events:auto!important; z-index:2147483646!important; filter:none!important }
    ${root}[data-cf-picking] ${cardSelector}, ${root}[data-cf-picking] ${cardSelector} * { cursor:crosshair!important }
    ${root}[data-cf-picking] [data-cf-highlight] {
      outline:2.5px solid #10b981!important; outline-offset:3px!important; border-radius:12px!important;
      box-shadow:0 0 0 6px rgba(16, 185, 129, 0.18)!important }
  `);
    applyRouteFlag();
    previous?.remove?.();
  }
  installPolicy();

  const records = new Map();
  const coverWaitMs = 5000;
  const failedImages = new WeakMap();
  const overlays = new WeakMap();
  const feedbackJobs = new Map();
  let autoNotInterested = false;
  let nativeFeedbackQueue = Promise.resolve();
  const nativeJobs = new WeakSet();
  const nativeTrigger = '.bili-video-card__info--no-interest';
  const nativePanel = '.bili-video-card__info--no-interest-panel:not(.bili-video-card__info--no-interest-panel--ad)';
  const contentReasons = new Set(['内容不感兴趣', '对此内容不感兴趣', '內容不感興趣', '對此內容不感興趣', 'Not interested in the content']);
  let picker;
  let epoch = 0;
  let revision = null;
  let ruleGroups = [];
  const hasActivePoints = group => group.enabled && group.include.some(point => !group.disabledInclude?.includes(point));
  let browserConcurrency = 8;
  let running = 0;
  let queueTimer = 0;
  let syncing = null;
  let active = false;
  let token = GM_getValue('pairToken', '');
  const ui = createCognitionUI({ siteName: '哔哩哔哩首页' });
  const client = createCognitionClient({
    ui,
    getToken: () => token, generation: () => epoch, currentPage: () => home() && !document.hidden,
    current: body => active && (body?.revision == null || body.revision === revision),
  });
  let pairingAttempt = 0;
  let serviceStatus = '';
  let pill = null;
  function refreshPill() {
    if (!pill) return;
    let blocked = 0;
    for (const rec of records.values()) if (rec.state === 'block') blocked++;
    pill.update({
      visible: active && !sitePaused,
      paired: Boolean(token),
      blocked,
      reviewing: running,
      error: token && revision === null ? serviceStatus : '',
    });
  }

  const nearViewport = typeof IntersectionObserver === 'function' && new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      const record = records.get(target);
      if (record) {
        record.near = isIntersecting;
        if (!isIntersecting && record.state === 'queued') {
          clearTimeout(record.coverTimer);
          record.coverTimer = 0;
          record.coverTimedOut = false;
        }
      }
    }
    schedule();
  }, { rootMargin: '360px' });

  function normalizedCover(input) {
    try {
      const url = new URL(input, 'https://www.bilibili.com');
      if (!['http:', 'https:'].includes(url.protocol) || !/^i\d+\.hdslb\.com$/.test(url.hostname)
          || !url.pathname.startsWith('/bfs/') || url.port || url.username || url.password) return '';
      return 'https://' + url.hostname + url.pathname.split('@')[0];
    } catch {
      return '';
    }
  }

  function videoId(link) {
    try {
      const url = new URL(link?.getAttribute('href') || '', 'https://www.bilibili.com/');
      if (url.hostname !== 'www.bilibili.com') return '';
      return url.pathname.match(/^\/video\/(BV[a-zA-Z0-9]+|av\d+)(?:\/|$)/)?.[1] || '';
    } catch {
      return '';
    }
  }

  const nativeCard = Symbol('native card');

  function nativeDestination(link) {
    const href = link?.getAttribute('href');
    if (!href) return false;
    try {
      const url = new URL(href, 'https://www.bilibili.com/');
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      if (['live.bilibili.com', 'cm.bilibili.com', 'cm.bilibili.cn'].includes(url.hostname)) return true;
      // An external landing page in the cover or title is outside the homepage video feed.
      return !/(^|\.)(bilibili\.com|bilibili\.cn|b23\.tv)$/.test(url.hostname);
    } catch { return false; }
  }

  function snapshot(card) {
    if (card.closest(nativeMarker) || card.querySelector(nativeMarker)) return nativeCard;
    const heading = card.querySelector(titleSelector);
    const titleLink = heading?.closest('a[href]') || heading?.querySelector('a[href]');
    const links = [...card.querySelectorAll(policy.videoLinks)];
    const imageLink = card.querySelector(policy.imageLink);
    const coverLink = imageLink || card.querySelector(coverSelector)?.closest('a[href]');
    if ([titleLink, coverLink, card.closest('a[href]')].some(nativeDestination) ||
        (!links.length && !titleLink && !coverLink && nativeDestination(card.querySelector('a[href]')))) return nativeCard;
    for (const badge of card.querySelectorAll(badgeSelector)) {
      if ([badge.textContent?.trim(), badge.getAttribute('aria-label'), badge.getAttribute('title')]
          .some(label => label === '广告' || label === '直播中')) return nativeCard;
    }
    const titleId = videoId(titleLink);
    const coverId = videoId(imageLink);
    if (titleId && coverId && titleId !== coverId) return null; // Card is being recycled.
    const labeled = links.find(link => link.title || link.getAttribute('aria-label'));
    const img = card.querySelector(coverSelector);
    const title = (heading?.textContent?.trim() || heading?.title || heading?.dataset.title ||
      heading?.getAttribute('aria-label') || titleLink?.title || labeled?.title || labeled?.getAttribute('aria-label') ||
      links.find(link => !link.children.length && link.textContent.trim())?.textContent || img?.alt || '').trim();
    const authorNode = card.querySelector(policy.author);
    const profile = card.querySelector(policy.profile);
    const author = authorNode?.textContent?.trim() || authorNode?.title?.trim() ||
      profile?.title?.trim() || (profile && !profile.childElementCount ? profile.textContent.trim() : '');
    const source = img?.closest('picture')?.querySelector('source[srcset]') || card.querySelector('picture source[srcset]');
    const cover = [img?.getAttribute('data-src'), img?.getAttribute('src'), img?.currentSrc,
      source?.getAttribute('srcset')?.trim().split(/[\s,]/)[0]].map(normalizedCover).find(Boolean) || '';
    // Promotion/room artwork may be the first part of a lazy card to arrive. A normal
    // submission can reuse that artwork, so retain videos with an actual video target.
    if (cover && !links.some(videoId) && !videoId(card.closest('a[href]')) &&
        /^\/bfs\/(?:sycp|live)\//.test(new URL(cover).pathname)) return nativeCard;
    if (!cover && !title) return null;
    // The local classifier needs a correlation key. The public video URL may appear later
    // or be absent; identity checks still compare the complete snapshot before revealing.
    const id = titleId || coverId || videoId(links[0]) || videoId(card.closest('a[href]')) ||
      ('card:' + (cover ? cover.slice(-116) : [...title].slice(0, 55).join('')));
    return { id, title, author, cover };
  }

  function thumbnail(image, width, height) {
    const scale = Math.min(1, 512 / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.56]) {
      const jpeg = canvas.toDataURL('image/jpeg', quality);
      if (jpeg.startsWith('data:image/jpeg;base64,') && jpeg.length <= 96 * 1024) return jpeg;
    }
  }

  function currentCoverReady(img, expected) {
    return Boolean(expected && img?.complete && img.naturalWidth && normalizedCover(img.currentSrc) === expected);
  }

  function currentCoverFailed(img, expected) {
    const src = img?.currentSrc || img?.getAttribute('src');
    return Boolean(expected && img?.complete && src && normalizedCover(src) === expected && failedImages.get(img) === src);
  }

  function encodeCover(image, width, height) {
    const jpeg = thumbnail(image, width, height);
    return jpeg ? { image: jpeg } : { reason: '缩略图超过大小限制' };
  }

  async function pageCover(card, expected) {
    const img = card.querySelector(coverSelector);
    if (!currentCoverReady(img, expected)) {
      if (currentCoverFailed(img, expected)) return { reason: '页面图片加载失败' };
      return { reason: img?.naturalWidth ? '当前图片与卡片封面不一致' : '页面封面尚未就绪' };
    }
    try {
      return encodeCover(img, img.naturalWidth, img.naturalHeight);
    } catch (error) {
      if (error.name !== 'SecurityError') return { reason: '页面缩略图生成失败' };
    }

    // The displayed image was loaded without CORS. Ask for the same variant with
    // CORS approval; a cache that varies on Origin can require a network round trip.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.corsReadTimeoutMs);
    let decoding = false;
    try {
      const response = await fetch(img.currentSrc, { mode: 'cors', credentials: 'omit', cache: 'force-cache',
        redirect: 'error', signal: controller.signal });
      if (!response.ok) return { reason: '图片服务返回 HTTP ' + response.status };
      if (!response.headers.get('content-type')?.startsWith('image/')) return { reason: '封面响应并非图片' };
      const blob = await response.blob();
      if (blob.size > 2 * 1024 * 1024) return { reason: '源图片超过大小限制' };
      decoding = true;
      const bitmap = await createImageBitmap(blob);
      try { return encodeCover(bitmap, bitmap.width, bitmap.height); }
      finally { bitmap.close(); }
    } catch {
      if (decoding) return { reason: '图片解码或缩放失败' };
      return { reason: controller.signal.aborted ? '跨域读取超时' : '浏览器跨域读取失败' };
    } finally { clearTimeout(timer); }
  }

  const wireCard = record => record.pageCover ? { ...record.data, pageCover: record.pageCover } : record.data;

  function clearControls(card) {
    const overlay = overlays.get(card);
    if (!overlay) return;
    overlays.delete(card);
    overlay.host.remove();
    for (const child of overlay.locked) child.inert = false;
  }

  function lockContent(card, overlay) {
    if (overlay.host.parentNode !== card) card.append(overlay.host);
    for (const child of overlay.locked) {
      if (child.parentNode !== card) { child.inert = false; overlay.locked.delete(child); }
    }
    for (const child of card.children) {
      if (child !== overlay.host && !child.inert) { child.inert = true; overlay.locked.add(child); }
    }
  }

  function showFeedback(text) {
    ui.showToast(text);
  }

  function resultMessage(reply) {
    const details = [reply.message, reply.analysis];
    for (const correction of reply.corrections || []) {
      if (typeof correction?.point === 'string') details.push((correction.groupName || '规则') + ' · ' + correction.point);
    }
    return [...new Set(details.filter(x => typeof x === 'string' && x.trim()))].join('\n');
  }

  function refreshAfterDecision(previous, next) {
    if (previous === next) return;
    GM_setValue('rulesChanged', Date.now());
    if (revision === previous) reset();
    else void syncRules();
  }

  function verdictCurrent(card, record, verdictRevision, startEpoch) {
    return active && !sitePaused && home() && card.isConnected && records.get(card) === record &&
      record.state === 'block' && !record.hold && epoch === startEpoch && revision === verdictRevision &&
      JSON.stringify(snapshot(card)) === record.key;
  }

  function blockControls(card, label) {
    const record = records.get(card);
    const verdictRevision = revision;
    const startEpoch = epoch;
    const shield = ui.createShieldHost('data-cf-controls');
    shield.message.textContent = label;
    const peek = document.createElement('button');
    peek.type = 'button';
    peek.value = 'peek';
    peek.textContent = '仍要查看';
    peek.onclick = () => {
      if (!verdictCurrent(card, record, verdictRevision, startEpoch)) return;
      record.revealed = true;
      present(card, 'block', label);
    };
    shield.actions.append(peek);
    // Keep delegated site handlers away from overlay actions and pointer movement.
    for (const event of ['click','dblclick','auxclick','contextmenu','pointerdown','pointerup','pointerover','pointermove','mouseover','keydown','keyup']) {
      shield.host.addEventListener(event, e => e.stopPropagation());
    }
    const overlay = { host: shield.host, locked: new Set() };
    overlays.set(card, overlay);
    lockContent(card, overlay);
  }

  function revealedActions(parent, card, record, owns, floating = false) {
    const verdictRevision = revision, startEpoch = epoch;
    const current = () => verdictCurrent(card, record, verdictRevision, startEpoch);
    const group = document.createElement('div');
    group.dataset.cfReviewActions = '';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Cognition Filter');
    group.style.cssText = floating
      ? 'position:absolute;top:8px;right:8px;z-index:5;display:inline-flex;flex-wrap:wrap;gap:6px;padding:5px 7px;border-radius:999px;background:rgba(18,22,30,0.78);backdrop-filter:blur(16px) saturate(180%);-webkit-backdrop-filter:blur(16px) saturate(180%);border:1px solid rgba(255,255,255,0.16);box-shadow:0 8px 24px rgba(0,0,0,0.25);color:#f8fafc;font:600 12px/1.2 -apple-system,BlinkMacSystemFont,"PingFang SC",system-ui,sans-serif'
      : 'display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px;border-top:1px solid rgba(128,128,128,0.16)';
    function button(value, text, run) {
      const item = document.createElement('button');
      item.type = 'button'; item.value = value; item.textContent = text;
      item.style.cssText = floating
        ? 'font:inherit;color:#f8fafc;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.16);border-radius:999px;padding:4px 10px;cursor:pointer'
        : 'font:inherit;font-size:12px;font-weight:600;color:inherit;background:rgba(128,128,128,0.1);border:1px solid rgba(128,128,128,0.24);border-radius:999px;padding:4px 10px;cursor:pointer';
      item.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (group.isConnected && owns() && record.revealed && current()) run();
      };
      group.append(item);
      return item;
    }
    button('mask', '重新遮盖', () => {
      record.revealed = false;
      present(card, 'block', record.view.label);
      syncNativeMenu();
    });
    const report = button('report', '反馈误杀', async () => {
      if (record.reporting || record.reported) return;
      record.contested = true;
      record.reporting = report.disabled = true;
      showFeedback('正在分析这条反馈…');
      const jobKey = JSON.stringify([verdictRevision, record.key]);
      let work = feedbackJobs.get(jobKey);
      if (!work) {
        work = client.report(wireCard(record), verdictRevision, current,
          attempt => { if (current()) showFeedback('反馈连接中断，正在重试 ' + attempt + '/2…'); }).then(reply => {
          if (!reply || !['string', 'number'].includes(typeof reply.revision) || typeof reply.message !== 'string') {
            throw new Error('反馈响应格式错误');
          }
          return reply;
        });
        feedbackJobs.set(jobKey, work);
      }
      try {
        const reply = await work;
        if (current()) {
          showFeedback(resultMessage(reply));
          record.reported = true;
        }
        if (feedbackJobs.size > 128) feedbackJobs.delete(feedbackJobs.keys().next().value);
        refreshAfterDecision(verdictRevision, reply.revision);
      } catch (error) {
        feedbackJobs.delete(jobKey);
        if (!current()) return;
        if (error.status === 409) {
          showFeedback(error.message + ' · 正在重新读取判断。');
          reset();
        } else {
          showFeedback(error.message + ' · 可再次点击反馈');
        }
      } finally {
        if (epoch === startEpoch) {
          record.reporting = false;
          record.reportButton.disabled = !!record.reported;
        }
        syncNativeMenu();
      }
    });
    record.reportButton = report;
    report.disabled = !!(record.reporting || record.reported);
    parent.append(group);
    return group;
  }

  let openMenu;
  function syncNativeMenu() {
    const owners = document.querySelectorAll(nativeTrigger + '.active');
    const card = owners.length === 1 && owners[0].closest(cardSelector);
    const record = records.get(card);
    const panels = record?.revealed && !record.hold && active && !sitePaused
      ? [...document.querySelectorAll(nativePanel)].filter(p => p.getClientRects().length) : [];
    const panel = panels.length === 1 ? panels[0] : null;
    if (openMenu && panel === openMenu.panel && record === openMenu.record && openMenu.group.parentNode === panel) {
      openMenu.group.querySelector('[value=report]').disabled = !!(record.reporting || record.reported);
      return;
    }
    openMenu?.group.remove();
    openMenu = null;
    if (!panel) return;
    const trigger = owners[0];
    const owns = () => {
      const activeTriggers = document.querySelectorAll(nativeTrigger + '.active');
      return activeTriggers.length === 1 && activeTriggers[0] === trigger && card.contains(trigger) &&
        panel.getClientRects().length && openMenu?.panel === panel;
    };
    openMenu = { panel, record, group: revealedActions(panel, card, record, owns) };
  }

  function queueNativeFeedback(card, record) {
    const id = record.data?.id;
    const trigger = card.querySelector(nativeTrigger);
    if (!autoNotInterested || record.state !== 'block' || document.hidden || !trigger ||
        !/^(BV[a-zA-Z0-9]+|av\d+)$/.test(id) || nativeJobs.has(record)) return;
    nativeJobs.add(record);
    const expectedRevision = revision;
    const valid = () => autoNotInterested && active && home() && !sitePaused && !document.hidden && !picker &&
      card.isConnected && card.contains(trigger) && records.get(card) === record && record.state === 'block' &&
      !record.revealed && !record.contested && revision === expectedRevision && JSON.stringify(snapshot(card)) === record.key;
    const visiblePanels = () => [...document.querySelectorAll(nativePanel)].filter(p => p.getClientRects().length);
    const hover = (el, type) => el?.dispatchEvent(new MouseEvent(type, { view: window }));
    const submit = async () => {
      if (!valid()) return;
      const history = GM_getValue('nativeContentFeedbackIds', []);
      if (!Array.isArray(history) || history.includes(id) || visiblePanels().length) return;
      const wrap = trigger.closest('.bili-video-card__wrap');
      if (!wrap || !card.contains(wrap)) return;
      hover(wrap, 'mouseenter');
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (!valid() || !trigger.getClientRects().length || visiblePanels().length) return;
        hover(trigger, 'mouseenter');
        // Bilibili teleports the hovered card's menu to body. Require its sole active
        // trigger as well as the exact content reason before dispatching any click.
        const option = () => {
          const panels = visiblePanels();
          const owners = document.querySelectorAll(nativeTrigger + '.active');
          if (owners.length !== 1 || owners[0] !== trigger || panels.length !== 1) return;
          const matches = [...panels[0].querySelectorAll('.bili-video-card__info--no-interest-panel--item')]
            .filter(item => contentReasons.has(item.textContent.trim()) && item.getClientRects().length);
          if (matches.length === 1) return matches[0];
        };
        for (let i = 0; i < 20 && valid(); i++) {
          const target = option();
          if (target) {
            const settings = await client.rules();
            if (!valid() || settings.autoNotInterested !== true || settings.siteEnabled === false ||
                settings.revision !== expectedRevision || option() !== target) return;
            target.click();
            GM_setValue('nativeContentFeedbackIds', [...history.slice(-511), id]);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 40));
        }
      } finally {
        hover(trigger, 'mouseleave');
        hover(wrap, 'mouseleave');
      }
    };
    nativeFeedbackQueue = nativeFeedbackQueue.then(() => navigator.locks
      ? navigator.locks.request('cognition-filter-bilibili-native-feedback', submit) : submit())
      .catch(() => {}).finally(() => nativeJobs.delete(record));
  }

  function present(card, state, label = '') {
    const record = records.get(card);
    if (record) {
      record.view = { state, label };
      if (record.hold) { state = 'pending'; label = record.hold; }
    }
    clearControls(card);
    if (label) card.dataset.cfLabel = label;
    else card.removeAttribute('data-cf-label');
    if (state === 'block' && record?.revealed) {
      state = 'allow';
      if (!card.querySelector(nativeTrigger)) {
        const host = document.createElement('div');
        host.dataset.cfControls = '';
        card.append(host);
        overlays.set(card, { host, locked: new Set(), revealed: true });
        revealedActions(host.attachShadow({mode:'closed'}), card, record, () => !card.querySelector(nativeTrigger), true);
      }
    } else if (state === 'block') blockControls(card, label);
    card.dataset.cfState = state;
    refreshPill();
  }

  function inspect(card) {
    if (!active || sitePaused || !card.isConnected || !card.matches(cardSelector)) return;
    const data = snapshot(card);
    if (data === nativeCard) {
      if (records.has(card)) forget(card);
      card.dataset.cfState = 'native';
      return;
    }
    const key = JSON.stringify(data);
    const previous = records.get(card);
    if (previous?.key === key) {
      if (previous.coverTimer) schedule();
      const overlay = overlays.get(card);
      if (previous.revealed && !previous.hold && (!!overlay === !!card.querySelector(nativeTrigger))) {
        present(card, previous.view.state, previous.view.label);
      } else if (overlay && !overlay.revealed) lockContent(card, overlay);
      return;
    }
    if (previous && picker?.record === previous) closePicker();
    clearTimeout(previous?.coverTimer);
    records.set(card, { data, key, near: previous?.near ?? !nearViewport, state: 'queued' });
    present(card, 'pending', !token ? '请在油猴菜单配对' : data ? '' : '等待卡片内容就绪');
    if (!previous && nearViewport) nearViewport.observe(card);
    schedule();
  }

  function forget(card) {
    clearTimeout(records.get(card)?.coverTimer);
    if (picker?.card === card) closePicker();
    clearControls(card);
    records.delete(card);
    if (nearViewport) nearViewport.unobserve(card);
    card.removeAttribute('data-cf-state');
    card.removeAttribute('data-cf-label');
  }

  function scan(node) {
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_NODE) return;
    if (node.matches?.(cardSelector)) inspect(node);
    node.querySelectorAll(cardSelector).forEach(inspect);
  }

  function invalidate() {
    epoch++;
    for (const [card, record] of records) {
      record.revealed = record.reporting = record.reported = false;
      record.state = 'queued';
      present(card, 'pending', !token ? '请在油猴菜单配对' : record.data ? '' : '等待卡片内容就绪');
    }
  }

  async function syncRules() {
    if (!active || !token) return false;
    if (syncing) return syncing;
    const startEpoch = epoch;
    const work = (async () => {
      try {
        const info = await client.rules();
        if (startEpoch !== epoch || !active) return false;
        if (info.siteEnabled === false) {
          autoNotInterested = false;
          if (!sitePaused) {
            sitePaused = true;
            epoch++;
            revision = null;
            ruleGroups = [];
            applyRouteFlag();
            closePicker();
            for (const card of records.keys()) forget(card);
          }
          serviceStatus = '此站点已在 WebUI 中禁用';
          return false;
        }
        if (!Array.isArray(info.groups)) throw new Error('请升级本地 agent 以使用分组规则');
        if (!info.groups.every(g => typeof g?.id === 'string' && typeof g.name === 'string' &&
            typeof g.enabled === 'boolean' && [g.include, g.exclude].every(points =>
              Array.isArray(points) && points.every(point => typeof point === 'string')))
            || !['number', 'string'].includes(typeof info.revision)) throw new Error('规则响应格式错误');
        const nextPolicy = readPolicy(info.pagePolicy);
        if (nextPolicy && JSON.stringify(nextPolicy) !== JSON.stringify(policy)) {
          const selectorsChanged = Object.keys(nextPolicy).some(key =>
            key !== 'corsReadTimeoutMs' && nextPolicy[key] !== policy[key]);
          policy = nextPolicy;
          GM_setValue(cacheKey, policy);
          if (selectorsChanged) {
            epoch++;
            closePicker();
            for (const card of records.keys()) forget(card);
            document.querySelectorAll('[data-cf-state="native"]').forEach(card => card.removeAttribute('data-cf-state'));
            installPolicy();
            if (!sitePaused) scan(document);
          }
        }
        if (sitePaused) {
          sitePaused = false;
          applyRouteFlag();
          scan(document);
        }
        if (revision !== info.revision) invalidate();
        revision = info.revision;
        ruleGroups = info.groups;
        autoNotInterested = info.autoNotInterested === true;
        if (autoNotInterested) {
          for (const [card, record] of records) queueNativeFeedback(card, record);
        }
        const bound = (value, fallback, max) => Number.isInteger(value) ? Math.min(max, Math.max(1, value)) : fallback;
        browserConcurrency = bound(info.scheduling?.browserConcurrency, 8, 32);
        for (const record of records.values()) {
          if (record.state === 'pending' && record.undispatched) record.state = 'queued';
        }
        picker?.syncGroups?.();
        schedule();
        return true;
      } catch (error) {
        if (startEpoch === epoch) {
          revision = null;
          invalidate();
          for (const card of records.keys()) present(card, 'pending', error.message + ' · 可在油猴菜单重试');
          serviceStatus = error.message;
        }
        return false;
      }
    })();
    syncing = work;
    try { return await work; }
    finally { if (syncing === work) syncing = null; }
  }

  function reset() {
    revision = null;
    syncing = null;
    invalidate();
    void syncRules();
  }

  function schedule() {
    if (!queueTimer && active && revision !== null) {
      queueTimer = setTimeout(() => { queueTimer = 0; drain(); }, 40);
    }
  }

  // Wait in the queue, before taking a review slot. A slow image must not stall its neighbors.
  function waitingForPageCover(card, record) {
    if (record.pageCover || record.coverTimedOut || !ruleGroups.some(hasActivePoints)) return false;
    const img = card.querySelector(coverSelector);
    const expected = record.data.cover;
    if (!expected && !img && !card.querySelector('picture, .bili-video-card__cover')) return false;
    if (currentCoverReady(img, expected) || currentCoverFailed(img, expected)) {
      clearTimeout(record.coverTimer);
      record.coverTimer = 0;
      return false;
    }
    if (!record.coverTimer) {
      present(card, 'pending', '等待页面加载封面');
      record.coverTimer = setTimeout(() => {
        record.coverTimer = 0;
        record.coverTimedOut = true;
        schedule();
      }, coverWaitMs);
    }
    return true;
  }

  function drain() {
    if (!active || revision === null) return;
    const slots = browserConcurrency - running;
    if (slots <= 0) return;
    const jobs = new Map();
    for (const [card, record] of records) {
      if (!record.near || !record.data || record.state !== 'queued' || !card.isConnected) continue;
      if (!jobs.has(record.key) && jobs.size >= slots) continue;
      if (waitingForPageCover(card, record)) continue;
      if (!jobs.has(record.key)) jobs.set(record.key, []);
      jobs.get(record.key).push([card, record]);
      record.state = 'loading';
    }
    for (const bindings of jobs.values()) {
      running++;
      refreshPill();
      void classify(bindings, epoch).finally(() => { running--; refreshPill(); schedule(); });
    }
  }

  async function classify(bindings, startEpoch) {
    const record = bindings[0][1];
    let result;
    let errorLabel = '检测未完成';
    let undispatched = false;
    try {
      for (const [card] of bindings) present(card, 'pending', '正在读取封面');
      const card = bindings.find(([node]) => node.querySelector(coverSelector)?.naturalWidth)?.[0] || bindings[0][0];
      const readyAtStart = currentCoverReady(card.querySelector(coverSelector), record.data.cover);
      const needsCover = ruleGroups.some(hasActivePoints);
      let image = record.pageCover;
      let label = needsCover ? '正在判定' : '正在按当前规则放行';
      if (needsCover && !image) {
        if (record.data.cover) {
          const result = await pageCover(card, record.data.cover);
          image = result.image;
          if (!image) label = result.reason + ' · 将使用备用封面地址';
        } else {
          label = '正在判定 · 未取得封面地址';
        }
      }
      record.pageCover = image;
      for (const [node, bound] of bindings) {
        if (records.get(node) !== bound || epoch !== startEpoch) continue;
        bound.pageCover = image;
        bound.waitForCover = !readyAtStart;
        present(node, 'pending', label);
      }
      if (!active || epoch !== startEpoch) return;
      result = await client.review(wireCard(record), revision,
        () => bindings.some(([card, record]) => card.isConnected && records.get(card) === record
          && JSON.stringify(snapshot(card)) === record.key));
    } catch (error) {
      if (error.status === 409 && startEpoch === epoch && active) { reset(); return; }
      errorLabel = error.message;
      undispatched = error.undispatched === true;
    }
    if (startEpoch !== epoch || !active) return;
    const decision = result?.decision || 'pending';
    const label = decision === 'block' ? '已过滤 · ' + (result.rule || '命中规则')
      : decision === 'pending' ? (result?.message || errorLabel) + ' · 可在油猴菜单重试' : '';
    for (const [card, record] of bindings) {
      if (!card.isConnected || records.get(card) !== record) continue;
      if (JSON.stringify(snapshot(card)) !== record.key) { inspect(card); continue; }
      record.state = decision;
      record.undispatched = undispatched;
      present(card, decision, label);
      if (decision === 'block') queueNativeFeedback(card, record);
      record.waitForCover &&= result?.retryWhenCoverLoads === true;
      retryLoadedCover(card);
    }
  }

  async function pair() {
    const attempt = ++pairingAttempt;
    return ui.promptPairing({
      title: '配对哔哩哔哩首页',
      subtitle: '请右键本机托盘图标，打开「配对页」，复制 48 位本机配对码并粘贴到下方。',
      verify: async secret => {
        try {
          if (!await client.pair(secret, () => attempt === pairingAttempt)) return false;
          token = secret;
          serviceStatus = '';
          reset();
          refreshPill();
          return true;
        } catch (error) {
          if (attempt === pairingAttempt) serviceStatus = error.message;
          throw error;
        }
      },
    });
  }

  function closePicker() {
    const session = picker;
    if (!session) return;
    picker = null;
    session.events.abort();
    session.highlight?.removeAttribute('data-cf-highlight');
    document.documentElement.removeAttribute('data-cf-picking');
    session.hudHost?.remove();
    session.host?.remove();
    if (session.record && records.get(session.card) === session.record) {
      const { record, card } = session;
      record.hold = '';
      present(card, record.view.state, record.view.label);
    }
  }

  function selectCard(session, card) {
    const record = records.get(card);
    if (!record?.data) return;
    session.events.abort();
    session.highlight?.removeAttribute('data-cf-highlight');
    document.documentElement.removeAttribute('data-cf-picking');
    session.hudHost?.remove();
    session.hudHost = null;
    Object.assign(session, { record, card });
    record.hold = '已选中 · 等待确认屏蔽';
    present(card, record.view.state, record.view.label);
    const preview = [record.data.title, record.data.author && ('UP · ' + record.data.author)].filter(Boolean).join(' — ');
    const sheet = ui.createPickerSheet({
      heading: '屏蔽选中的卡片',
      preview,
      onOpenRules: openRules,
      onCancel: () => { if (!session.busy) closePicker(); },
    });
    session.host = sheet.host;
    session.root = sheet.root;
    const { select, status, rulesBtn: editRules, cancelBtn: cancel, applyBtn: apply } = sheet;
    const onEscape = e => {
      if (e.key === 'Escape' && picker === session && !session.busy) {
        e.preventDefault();
        closePicker();
      }
    };
    window.addEventListener('keydown', onEscape, { capture: true });
    const origRemove = sheet.host.remove.bind(sheet.host);
    sheet.host.remove = () => {
      window.removeEventListener('keydown', onEscape, { capture: true });
      origRemove();
    };
    let selectionRevision;
    function populate() {
      const previous = select.value;
      const groups = ruleGroups.filter(hasActivePoints);
      select.replaceChildren(...groups.map(g => new Option(g.name, g.id)));
      if (groups.some(g => g.id === previous)) select.value = previous;
      select.disabled = session.busy || !groups.length;
      apply.disabled = session.busy || !groups.length;
      editRules.disabled = Boolean(session.busy);
      if (!groups.length) status.textContent = '请在 WebUI 新增或启用命中要点，再回来选择规则组。';
      else status.textContent = '';
      selectionRevision = revision;
    }
    session.syncGroups = () => { if (!session.busy && selectionRevision !== revision) populate(); };
    populate();
    apply.onclick = async () => {
      if (session.busy || picker !== session) return;
      if (records.get(card) !== record || JSON.stringify(snapshot(card)) !== record.key) { closePicker(); return; }
      if (!select.value) return;
      const body = { card: wireCard(record), revision: selectionRevision, groupId: select.value };
      const groupName = select.selectedOptions[0].text;
      session.busy = true;
      select.disabled = editRules.disabled = apply.disabled = cancel.disabled = true;
      record.hold = '正在提交屏蔽…';
      present(card, record.view.state, record.view.label);
      status.textContent = '正在分析选中的卡片…';
      try {
        const reply = await client.pick(body,
          () => picker === session && records.get(card) === record && JSON.stringify(snapshot(card)) === record.key,
          attempt => { status.textContent = '正在重试屏蔽 ' + attempt + '/2…'; });
        if (!reply || !['number', 'string'].includes(typeof reply.revision) || typeof reply.message !== 'string') {
          throw new Error('屏蔽响应格式错误');
        }
        if (picker === session && records.get(card) === record && JSON.stringify(snapshot(card)) === record.key) {
          record.state = 'block';
          record.view = { state: 'block', label: '已屏蔽 · ' + groupName };
          closePicker();
          showFeedback(resultMessage(reply));
        }
        refreshAfterDecision(body.revision, reply.revision);
        // Even an idempotent replay needs a current classification receipt for later feedback.
        if (body.revision === reply.revision && revision === reply.revision) reset();
      } catch (error) {
        if (picker !== session) return;
        if (error.status === 409) await syncRules();
        if (picker !== session) return;
        session.busy = false;
        cancel.disabled = false;
        populate();
        status.textContent = error.status === 409 ? error.message + ' · 请确认规则组后重试。' : error.message + ' · 可重试或取消';
        record.hold = '提交未完成';
        present(card, record.view.state, record.view.label);
      }
    };
  }

  async function startPicker() {
    if (!active || !document.body || picker?.busy) return;
    closePicker();
    if (!token) { showFeedback('请先连接本地 agent。'); void pair(); return; }
    if (revision === null && !await syncRules()) { showFeedback(serviceStatus); return; }
    const session = { events: new AbortController() };
    session.hudHost = ui.mountPickerBanner({ text: '点击要屏蔽的首页卡片', onCancel: closePicker });
    picker = session;
    document.documentElement.setAttribute('data-cf-picking', '');
    const options = { capture: true, signal: session.events.signal };
    function target(event) {
      const direct = event.target.closest?.(cardSelector);
      if (direct) return records.get(direct)?.data ? direct : null;
      if (!event.target.closest?.(scope)) return null;
      for (const [card, record] of records) {
        if (!record.data || !record.near) continue;
        const r = card.getBoundingClientRect();
        if (event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom) return card;
      }
      return null;
    }
    function highlight(event) {
      const card = target(event);
      if (card === session.highlight) return;
      session.highlight?.removeAttribute('data-cf-highlight');
      card?.setAttribute('data-cf-highlight', '');
      session.highlight = card;
    }
    window.addEventListener('pointermove', highlight, options);
    window.addEventListener('pointerover', highlight, options);
    for (const name of ['pointerdown','pointerup','mousedown','mouseup','click','auxclick','contextmenu']) {
      window.addEventListener(name, event => {
        const card = target(event);
        if (!card) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (name === 'click') selectCard(session, card);
      }, options);
    }
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePicker(); }
    }, options);
  }

  async function openRules() {
    try {
      const url = await client.rulesPageUrl();
      GM_openInTab(url, { active: true, setParent: false });
    } catch (error) {
      showFeedback(error.message);
    }
  }

  function route() {
    applyRouteFlag();
    if (!pill && document.body) {
      pill = ui.mountPill({ onPair: pair, onPick: startPicker, onRules: openRules, onReset: reset });
    }
    if (home()) client.offerPairing(home, pair);
    if (active === home()) { refreshPill(); return; }
    active = home();
    if (active) { scan(document); reset(); }
    else {
      revision = null;
      syncing = null;
      epoch++;
      closePicker();
      for (const card of records.keys()) forget(card);
      ui.clearToast();
    }
    refreshPill();
  }

  function retryLoadedCover(card) {
    const record = records.get(card);
    const img = card.querySelector(coverSelector);
    if (record?.state === 'pending' && record.waitForCover && img?.naturalWidth &&
        record.data?.cover && normalizedCover(img.currentSrc) === record.data.cover) {
      record.waitForCover = false;
      record.state = 'queued';
      schedule();
    }
  }

  document.addEventListener('load', event => {
    if (!active || event.target?.tagName !== 'IMG') return;
    const card = event.target.closest(cardSelector);
    if (card) { failedImages.delete(event.target); inspect(card); retryLoadedCover(card); }
  }, true);
  document.addEventListener('error', event => {
    const img = event.target;
    if (!active || img?.tagName !== 'IMG') return;
    const card = img.closest(cardSelector);
    if (card && img === card.querySelector(coverSelector)) {
      failedImages.set(img, img.currentSrc || img.getAttribute('src'));
      schedule();
    }
  }, true);
  const observer = new MutationObserver(changes => {
    route();
    syncNativeMenu();
    if (!active || sitePaused) return;
    const dirty = new Set();
    let detached = false;
    for (const change of changes) {
      const target = change.target.nodeType === Node.ELEMENT_NODE ? change.target : change.target.parentElement;
      const card = target?.closest(cardSelector);
      if (card) dirty.add(card);
      if (change.type === 'attributes' && !card && ['class','data-card-type','data-is-ad','data-goto'].includes(change.attributeName)) scan(target);
      for (const node of change.addedNodes) scan(node);
      if (change.removedNodes.length || (change.type === 'attributes' && change.attributeName === 'class')) detached = true;
    }
    dirty.forEach(inspect);
    if (detached) {
      for (const card of records.keys()) if (!card.isConnected || !card.matches(cardSelector)) forget(card);
    }
  });
  observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'href', 'src', 'srcset', 'data-src', 'title', 'alt', 'aria-label', 'role', 'data-title', 'data-card-type', 'data-goto', 'data-is-ad'] });
  window.addEventListener('popstate', route);
  window.addEventListener('pageshow', route);
  window.addEventListener('focus', () => { route(); void syncRules(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { route(); void syncRules(); } });
  setInterval(() => { route(); if (!document.hidden) void syncRules(); }, 30000);
  GM_addValueChangeListener('pairToken', (_key, _old, value, remote) => {
    if (remote) { pairingAttempt++; token = value || ''; reset(); }
  });
  GM_addValueChangeListener('rulesChanged', (_key, _old, _value, remote) => { if (remote) reset(); });
  GM_registerMenuCommand('配对本地 agent', pair);
  GM_registerMenuCommand('编辑规则', openRules);
  GM_registerMenuCommand('选择卡片进行屏蔽', startPicker);
  GM_registerMenuCommand('重试检测', reset);
  route();
})();
