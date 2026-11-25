// ==UserScript==
// @name         Cognition Filter · X 首页时间线
// @namespace    cognition-filter.local
// @version      0.2.0
// @description  遮盖并逐帖审查 X 首页的「为你推荐」和「正在关注」时间线
// @match        https://x.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(() => {
  'use strict';
  /* @cognition-client-v1 */
  const bundled = /* @cognition-page-policy-v1 */ null;
  let policy = bundled;
  const home = () => /^\/home\/?$/.test(location.pathname) ||
    (location.pathname === '/' && Boolean(document.querySelector('[data-testid=primaryColumn] [role=tablist]')));
  let onHome = false, enabled = true, revision = null, groups = [], generation = 0;
  let concurrency = 8, running = 0, syncing, picking = false, style;
  let status = '等待本地规则';
  const posts = new Map();
  const ui = createCognitionUI({ siteName: 'X 首页时间线' });
  const client = createCognitionClient({ ui, generation: () => generation, currentPage: () => home() && !document.hidden });
  let pill = null, pickHud = null, pickSheet = null;
  const activeGroup = g => g.enabled && g.include.some(p => !g.disabledInclude?.includes(p));
  const scope = () => policy.timeline + ' ' + policy.post + ':not(article article):not([role=dialog] article)';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function refreshPill() {
    if (!pill) return;
    let blocked = 0;
    for (const rec of posts.values()) if (rec.state === 'block') blocked++;
    const paired = Boolean(GM_getValue('pairToken', ''));
    pill.update({
      visible: onHome && enabled,
      paired,
      blocked,
      reviewing: running,
      error: paired && revision === null ? status : '',
    });
  }

  function validPolicy(value) {
    return value && Object.keys(bundled).every(k => typeof value[k] === 'string' &&
      value[k].length <= 2048 && !/[{};\\]|\/\*/.test(value[k]) && CSS.supports('selector(:is(' + value[k] + '))'));
  }
  const saved = GM_getValue('xPagePolicy', null);
  if (validPolicy(saved)) policy = saved;

  function installStyle() {
    if (!document.documentElement) return;
    if (!style) {
      style = document.createElement('style');
      document.documentElement.append(style);
    }
    const post = 'html[data-cfx-home] ' + scope();
    const content = ' > :not([data-cfx-controls])';
    const masked = post + ':not([data-cfx-state="allow"],[data-cfx-state="native"],[data-cfx-state="block"])' + content;
    style.textContent = '@keyframes cfxShimmer{0%{background-position:100% 50%}100%{background-position:0% 50%}}' +
      masked + ',' + masked + ' *' +
      '{visibility:hidden!important;pointer-events:none!important}' +
      post + ':not([data-cfx-state="allow"],[data-cfx-state="native"]){position:relative!important;isolation:isolate;overflow:hidden}' +
      post + ':not([data-cfx-state="allow"],[data-cfx-state="native"],[data-cfx-state="block"]){background:linear-gradient(110deg,rgba(148,163,184,0.06) 28%,rgba(148,163,184,0.13) 48%,rgba(148,163,184,0.06) 68%);background-size:220% 100%;animation:cfxShimmer 2.1s ease-in-out infinite}' +
      post + '[data-cfx-state="block"]' + content + '{filter:blur(30px)!important;pointer-events:none!important;user-select:none}' +
      post + ' > [data-cfx-controls]{position:absolute!important;inset:0!important;display:block!important;z-index:2}' +
      'html[data-cfx-pick] ' + scope() + ':hover{outline:2.5px solid #10b981!important;outline-offset:-2px;box-shadow:inset 0 0 0 4px rgba(16,185,129,0.14)!important;cursor:crosshair}';
  }

  // Keep a complete UTF-16 character at the wire limit.
  function clip(text, n) {
    return text.length <= n ? text : text.slice(0, n - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
  }
  function postText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data;
    if (node.nodeName === 'BR') return '\n';
    if (node.nodeName === 'IMG') return node.alt || '';
    return Array.from(node.childNodes, postText).join('');
  }
  function mediaUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.origin !== 'https://pbs.twimg.com' || url.username || url.password ||
          !/^\/(media|ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|card_img)\/[A-Za-z0-9_./-]+$/.test(url.pathname)) return null;
      const ext = url.searchParams.get('format');
      const path = /\.(jpe?g|png|webp)$/i.test(url.pathname) ? url.pathname :
        /^(jpg|jpeg|png|webp)$/.test(ext) ? url.pathname + '.' + ext : '';
      return { url: url.href, fallback: path ? url.origin + path : '' };
    } catch { return null; }
  }
  function insideQuote(el, post) {
    const wrapper = el.closest("[data-testid=quoteTweet], [role=link]:not(a):not(article)");
    return el.closest(policy.post) !== post || (wrapper && wrapper !== post && post.contains(wrapper));
  }

  function permalink(post, name) {
    const candidates = [];
    for (const link of post.querySelectorAll('a[href*="/status/"]')) {
      const content = link.closest(policy.text + ",div[lang],p[lang],[data-testid='card.wrapper']");
      if (insideQuote(link, post) || (content && post.contains(content) && !name?.contains(link))) continue;
      let url;
      try { url = new URL(link.href); } catch { continue; }
      if (url.origin !== location.origin && !['https://x.com', 'https://twitter.com'].includes(url.origin)) continue;
      const match = url.pathname.match(/^\/([A-Za-z0-9_]+|i\/web)\/status\/(\d+)(?:\/(?:analytics|(?:photo|video)\/\d+))?\/?$/);
      if (!match) continue;
      const ref = { id:match[2], handle:match[1], time:link.querySelector('time') };
      if (name?.contains(link) || ref.time) return ref;
      candidates.push(ref);
    }
    if (candidates.length && candidates.every(ref => ref.id === candidates[0].id)) return candidates[0];
  }

  function snapshot(post) {
    if (post.closest(policy.promoted) || post.querySelector(policy.promoted) ||
        [...post.querySelectorAll('span')].some(el => !el.childElementCount &&
          /^(Ad|Promoted|广告|廣告|推广|推廣)$/.test(el.textContent.trim()) &&
          !el.closest(policy.text + ',' + policy.author + ',[role=link]'))) return 'native';
    const name = [...post.querySelectorAll(policy.author)].find(el => !insideQuote(el, post));
    const ref = permalink(post, name);
    const handles = name && [...name.querySelectorAll('a[href]')].filter(a => !a.getAttribute('href').includes('/status/'))
      .map(a => a.textContent.trim()).filter(Boolean);
    const author = clip(handles?.length ? [...new Set(handles)].join(' ') :
      (name?.textContent.replace(name.querySelector('time')?.textContent || '', '').trim() || ref?.handle || ''), 128);
    let bodies = [...post.querySelectorAll(policy.text)];
    if (!bodies.length) {
      bodies = [...post.querySelectorAll('div[lang], p[lang]')].filter(el =>
        !el.querySelector('div[lang],p[lang],time,' + policy.author) && !el.closest(policy.author + ',button,[role=button],[role=group]'));
    }
    const texts = bodies.map(el => {
      const text = postText(el).trim();
      return text && insideQuote(el, post) ? '引用：' + text : text;
    }).filter(Boolean);
    const preview = post.querySelector("[data-testid='card.wrapper']");
    if (preview?.textContent.trim()) texts.push(preview.textContent.trim());
    const media = [];
    for (const node of post.querySelectorAll(policy.photo + ',video[poster]')) {
      const src = mediaUrl(node.poster || node.currentSrc || node.getAttribute('src'));
      if (src && !media.some(m => m.url === src.url)) media.push({ ...src, node });
      if (media.length === 4) break;
    }
    const alt = media.map(m => m.node.alt?.trim()).filter(t => t && !/^(image|图片|圖片)$/i.test(t));
    if (alt.length) texts.push(alt.join(' · '));
    const title = clip(texts.join('\n\n'), 8192);
    const waiting = !media.length && Boolean(post.querySelector('[data-testid=tweetPhoto],' + policy.video));
    if (!title && !media.length && !waiting) return null;
    const card = { id: ref?.id || '', title, author, cover: media[0]?.fallback || '' };
    return { card, media, waiting, key: JSON.stringify([card, media.map(m => m.url), waiting]) };
  }

  async function thumbnail(media) {
    const decoded = [];
    try {
      for (const {url, node} of media) {
        if (node instanceof HTMLImageElement && !node.complete) {
          await Promise.race([node.decode().catch(() => {}), sleep(750)]);
        }
        if (node instanceof HTMLImageElement && node.complete && node.naturalWidth) {
          const sample = document.createElement('canvas');
          try {
            sample.getContext('2d').drawImage(node, 0, 0, 1, 1);
            sample.toDataURL();
            decoded.push(node);
            continue;
          } catch { /* Cross-origin image displayed without CORS. */ }
        }
        const target = new URL(url);
        target.searchParams.set('name', 'small');
        const response = await fetch(target, { credentials:'omit', mode:'cors', cache:'force-cache',
          redirect:'error', signal:AbortSignal.timeout(5000) });
        if (!response.ok) throw Error('媒体读取失败');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || blob.size > 2 * 1024 * 1024) throw Error('无法读取媒体预览');
        decoded.push(await createImageBitmap(blob));
      }
      const canvas = document.createElement('canvas');
      const cols = decoded.length === 1 ? 1 : 2;
      const rows = Math.ceil(decoded.length / cols);
      canvas.width = 640; canvas.height = rows * (640 / cols);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      decoded.forEach((img, i) => {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const tile = 640 / cols, scale = tile / Math.max(w, h);
        ctx.drawImage(img, i % cols * tile + (tile - w * scale) / 2,
          Math.floor(i / cols) * tile + (tile - h * scale) / 2, w * scale, h * scale);
      });
      for (const quality of [.78, .56, .36]) {
        const data = canvas.toDataURL('image/jpeg', quality);
        if (data.length <= 96 * 1024) return data;
      }
      throw Error('媒体缩略图过大');
    } finally { for (const img of decoded) img.close?.(); }
  }

  function current(post, rec) {
    return home() && enabled && post.isConnected && posts.get(post) === rec &&
      post.matches(scope()) && snapshot(post)?.key === rec.key;
  }
  function unlock(rec) {
    for (const child of rec.locked) child.inert = false;
    rec.locked.clear();
  }
  function clear(post, rec) {
    if (postMenu?.rec === rec) clearPostMenu();
    clearTimeout(rec.mediaTimer);
    rec.host?.remove();
    unlock(rec);
    post.removeAttribute('data-cfx-state');
    posts.delete(post);
  }
  function render(post, rec, state, message = '') {
    rec.state = state;
    const revealed = state === 'block' && rec.revealed;
    if (state === 'block') rec.blockLabel = message;
    post.dataset.cfxState = revealed ? 'allow' : state;
    if (state === 'native' || state === 'allow' || revealed) {
      rec.host?.remove(); rec.host = null;
      unlock(rec);
      refreshPill();
      return;
    }
    if (!rec.host) {
      const shield = ui.createShieldHost('data-cfx-controls');
      rec.host = shield.host;
      rec.veil = shield.veil;
      rec.message = shield.message;
      rec.actions = shield.actions;
      for (const event of ['click','pointerdown','keydown']) shield.root.addEventListener(event, e => e.stopPropagation());
    }
    rec.veil.dataset.mode = state === 'block' || state === 'error' ? 'shield' : 'quiet';
    if (rec.host.parentNode !== post) post.append(rec.host);
    for (const child of post.children) if (child !== rec.host && !child.inert) {
      child.inert = true; rec.locked.add(child);
    }
    rec.message.textContent = message;
    rec.actions.replaceChildren();
    function button(text, value, fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.value = value; b.textContent = text;
      b.onclick = async e => {
        e.preventDefault();
        if (!current(post, rec)) return;
        b.disabled = true;
        try { await fn(); }
        catch (error) { rec.message.textContent = error.message; if (error.status === 409) void sync(); }
        finally { b.disabled = false; }
      };
      rec.actions.append(b);
    }
    if (state === 'block') {
      button('仍要查看', 'peek', () => {
        rec.revealed = true;
        render(post, rec, 'block', rec.blockLabel);
        post.querySelector('[data-testid=caret]')?.focus({preventScroll:true});
      });
    } else if (state === 'error') {
      button('重试', 'retry', async () => { clear(post, rec); await sync(); scan(); });
    }
    refreshPill();
  }

  let postMenu;
  const menuSelector = '[role=menu],[data-testid=Dropdown]';
  const visibleMenus = () => [...document.querySelectorAll(menuSelector)].filter(menu =>
    menu.getClientRects().length && !menu.querySelector(menuSelector) && menu.querySelector('[role=menuitem]'));
  function clearPostMenu() {
    if (!postMenu) return;
    clearTimeout(postMenu.timer);
    postMenu.group?.remove();
    postMenu = null;
  }
  function notify(message) {
    ui.showToast(message);
  }
  function watchPostMenu(e) {
    if (postMenu?.group?.contains(e.target)) return;
    const trigger = e.target.closest?.('[data-testid=caret]');
    if (trigger && postMenu?.trigger === trigger && e.type === 'click' && e.detail === 0) return;
    clearPostMenu();
    const post = trigger?.closest(scope());
    const rec = posts.get(post);
    if (!rec?.revealed || picking || insideQuote(trigger, post) || !current(post,rec)) return;
    postMenu = { trigger, post, rec, revision, previous:new Set(visibleMenus()), timer:setTimeout(clearPostMenu, 1800) };
  }
  document.addEventListener('click', watchPostMenu, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') clearPostMenu();
    else if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-testid=caret]')) watchPostMenu(e);
  }, true);
  function syncPostMenu() {
    const session = postMenu;
    if (!session) return;
    const { post, rec, trigger } = session;
    const valid = () => current(post,rec) && revision === session.revision && rec.state === 'block';
    if (!valid() || !rec.revealed || !post.contains(trigger)) return clearPostMenu();
    const menus = visibleMenus();
    if (session.menu) {
      if (!menus.includes(session.menu) || !session.menu.contains(session.group)) clearPostMenu();
      return;
    }
    const controlledId = trigger.getAttribute('aria-controls');
    const candidates = menus.filter(menu => controlledId
      ? document.getElementById(controlledId)?.contains(menu)
      : !session.previous.has(menu));
    if (candidates.length !== 1) return;
    const menu = session.menu = candidates[0];
    clearTimeout(session.timer);
    const group = session.group = document.createElement('div');
    group.setAttribute('role','group'); group.setAttribute('aria-label','Cognition Filter');
    group.dataset.cfReviewActions = '';
    function action(label, run) {
      const button = document.createElement('button');
      button.type = 'button'; button.setAttribute('role','menuitem'); button.textContent = label;
      button.style.cssText = 'display:block;width:100%;text-align:start;font:inherit;font-weight:600;color:inherit;background:transparent;border:0;padding:12px 16px;cursor:pointer';
      button.onclick = e => {
        e.preventDefault(); e.stopPropagation();
        if (postMenu !== session || !valid() || !rec.revealed || !group.isConnected || !menu.getClientRects().length) return;
        menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
        clearPostMenu();
        run();
      };
      group.append(button);
      return button;
    }
    action('重新遮盖', () => {
      rec.revealed = false;
      render(post,rec,'block',rec.blockLabel);
      rec.actions.querySelector('button')?.focus({preventScroll:true});
    });
    const report = action('反馈误杀', async () => {
      if (rec.reporting || rec.reported) return;
      rec.reporting = true;
      notify('正在分析这条反馈…');
      try {
        const reply = await client.report(rec.wire, session.revision, valid);
        if (valid()) {
          rec.reported = true;
          notify([reply.message || '已反馈',reply.analysis].filter(Boolean).join(' · '));
        }
        await sync();
      } catch (error) {
        if (valid()) notify(error.message + ' · 可重新打开帖子菜单反馈');
        if (error.status === 409) await sync();
      } finally {
        rec.reporting = false;
        if (postMenu?.rec === rec && postMenu.report) postMenu.report.disabled = !!rec.reported;
      }
    });
    session.report = report;
    report.disabled = !!(rec.reporting || rec.reported);
    menu.append(group);
  }

  function inspect(post) {
    const snap = snapshot(post);
    const key = snap === 'native' ? 'native' : snap?.key;
    let rec = posts.get(post);
    if (rec && rec.key === key) {
      if (rec.host && (rec.host.parentNode !== post || [...post.children].some(c => c !== rec.host && !c.inert))) {
        render(post, rec, rec.state, rec.message.textContent);
      }
      return;
    }
    if (rec) clear(post, rec);
    rec = { key, snap, locked:new Set() }; posts.set(post, rec);
    if (snap === 'native') render(post, rec, 'native');
    else if (revision && !groups.some(activeGroup)) render(post, rec, 'allow');
    else if (!snap || snap.waiting) {
      render(post, rec, 'waiting', snap ? '等待媒体预览' : '等待读取帖子');
      rec.mediaTimer = setTimeout(() => {
        if (current(post, rec)) render(post, rec, 'error', snap ? '媒体预览尚未就绪' : '尚未识别到正文或配图');
      }, 5000);
    } else render(post, rec, 'queued', revision ? '等待送审' : status);
  }

  function scan() {
    if (!onHome || !enabled) return;
    for (const [post, rec] of posts) if (!post.isConnected || !post.matches(scope())) clear(post, rec);
    document.querySelectorAll(scope()).forEach(inspect);
    drain();
  }

  function drain() {
    if (!revision || !home() || !enabled) return;
    for (const [post, rec] of posts) {
      if (running >= concurrency) break;
      if (rec.state !== 'queued') continue;
      running++;
      render(post, rec, 'reviewing', '正在判定');
      void review(post, rec).finally(() => { running--; refreshPill(); drain(); });
    }
  }

  async function wireCard(rec) {
    const {card, media} = rec.snap;
    const wire = { ...card };
    if (!wire.id) {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rec.key));
      wire.id = 'content-' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
    }
    if (media.length) {
      try { wire.pageCover = await thumbnail(media); }
      catch (error) { if (media.length !== 1 || !card.cover) throw error; }
    }
    return wire;
  }

  async function review(post, rec) {
    const valid = () => current(post, rec);
    try {
      const wire = await wireCard(rec);
      if (!valid()) return;
      rec.wire = wire;
      const result = await client.review(wire, revision, valid);
      if (!valid()) return;
      render(post, rec, result.decision === 'pending' ? 'error' : result.decision,
        result.decision === 'block' ? '已过滤 · ' + (result.rule || '命中规则') : result.message);
    } catch (error) {
      if (valid()) render(post, rec, 'error', error.message || '送审失败');
      if (error.status === 409 && onHome) void sync();
    }
  }

  function reset() {
    generation++;
    for (const [post, rec] of posts) clear(post, rec);
  }
  function closePickSheet() {
    pickSheet?.host?.remove();
    pickSheet = null;
  }
  function setPicking(value) {
    picking = value;
    document.documentElement?.toggleAttribute('data-cfx-pick', value);
    pickHud?.remove();
    pickHud = value ? ui.mountPickerBanner({ text: '点击要屏蔽的帖子', onCancel: () => setPicking(false) }) : null;
    if (!value) closePickSheet();
  }
  async function openRules() {
    try { GM_openInTab(await client.rulesPageUrl(), {active:true}); }
    catch (error) { notify(error.message); }
  }
  function route() {
    if (!pill && document.body) {
      pill = ui.mountPill({
        onPair: pair,
        onPick: () => {
          if (!GM_getValue('pairToken', '')) { notify('请先连接本地 agent。'); void pair(); return; }
          if (onHome && enabled && revision) setPicking(!picking);
        },
        onRules: openRules,
        onReset: () => { reset(); void sync(); },
      });
    }
    const next = home();
    if (next) client.offerPairing(home, pair);
    if (next !== onHome) {
      onHome = next;
      revision = null; setPicking(false); reset();
      if (next) void sync();
      else ui.clearToast();
    }
    document.documentElement?.toggleAttribute('data-cfx-home', next && enabled);
    refreshPill();
  }
  async function sync() {
    if (!home()) return;
    if (syncing && syncing.generation === generation) return syncing.work;
    const start = generation;
    const work = (async () => {
      try {
        if (!GM_getValue('pairToken', '')) throw Error('请在油猴菜单配对');
        const info = await client.rules();
        if (!home() || start !== generation) return;
        const next = info.siteEnabled !== false;
        if (next && (!Array.isArray(info.groups) || !info.revision)) throw Error('本地规则响应不完整');
        const policyChanged = validPolicy(info.pagePolicy) && JSON.stringify(policy) !== JSON.stringify(info.pagePolicy);
        if (policyChanged) {
          policy = info.pagePolicy; GM_setValue('xPagePolicy', policy); installStyle();
        }
        if (enabled !== next || revision !== info.revision || policyChanged) reset();
        enabled = next; revision = info.revision; groups = info.groups || [];
        concurrency = Math.min(32, Math.max(1, Number(info.scheduling?.browserConcurrency) || 8));
        document.documentElement?.toggleAttribute('data-cfx-home', enabled);
        if (!enabled) setPicking(false);
        scan();
      } catch (error) {
        if (!home() || start !== generation) return;
        status = error.message;
        if (!enabled) return;
        if (revision) reset();
        revision = null;
        document.documentElement?.setAttribute('data-cfx-home','');
        for (const [post,rec] of posts) if (rec.state === 'queued') render(post,rec,'queued',status);
        scan();
      }
    })();
    syncing = { generation:start, work };
    try { await work; } finally { if (syncing?.work === work) syncing = null; }
  }

  document.addEventListener('click', e => {
    if (!picking || !home()) return;
    const post = e.target.closest?.(scope());
    const rec = posts.get(post);
    if (!rec || !current(post, rec) || !revision || !rec.snap?.card || rec.snap.waiting) return;
    e.preventDefault(); e.stopImmediatePropagation();
    picking = false;
    document.documentElement?.removeAttribute('data-cfx-pick');
    pickHud?.remove(); pickHud = null;
    closePickSheet();
    const preview = [rec.snap.card.author, rec.snap.card.title].filter(Boolean).join(' · ').slice(0, 140);
    const sheet = ui.createPickerSheet({
      heading: '屏蔽选中的帖子',
      preview,
      onOpenRules: openRules,
      onCancel: closePickSheet,
    });
    pickSheet = sheet;
    const available = groups.filter(activeGroup);
    sheet.select.replaceChildren(...available.map(g => new Option(g.name, g.id)));
    sheet.select.disabled = !available.length;
    sheet.applyBtn.disabled = !available.length;
    if (!available.length) sheet.status.textContent = '请在 WebUI 新增或启用命中要点，再回来选择规则组。';
    const selectRev = revision;
    sheet.applyBtn.onclick = async () => {
      if (!sheet.select.value || !current(post, rec)) { closePickSheet(); return; }
      sheet.select.disabled = sheet.rulesBtn.disabled = sheet.applyBtn.disabled = sheet.cancelBtn.disabled = true;
      sheet.status.textContent = '正在分析选中的帖子…';
      try {
        const card = rec.wire || await wireCard(rec);
        const reply = await client.pick({ card, revision: selectRev, groupId: sheet.select.value }, () => current(post, rec));
        closePickSheet();
        if (reply?.message) notify([reply.message, reply.analysis].filter(Boolean).join(' · '));
        await sync();
      } catch (error) {
        if (error.status === 409) void sync();
        if (pickSheet === sheet) {
          sheet.select.disabled = sheet.rulesBtn.disabled = sheet.applyBtn.disabled = sheet.cancelBtn.disabled = false;
          sheet.status.textContent = error.message + ' · 可重试或取消';
        }
      }
    };
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (pickSheet && !pickSheet.cancelBtn.disabled) closePickSheet();
      else setPicking(false);
    }
  });
  async function pair() {
    return ui.promptPairing({
      title: '配对 X 首页时间线',
      subtitle: '请右键本机托盘图标，打开「配对页」，复制 48 位本机配对码并粘贴到下方。',
      verify: async secret => {
        await client.pair(secret);
        status = '等待本地规则';
        reset();
        await sync();
        refreshPill();
        return true;
      },
    });
  }
  GM_registerMenuCommand('配对本地 agent', pair);
  GM_registerMenuCommand('编辑规则', openRules);
  GM_registerMenuCommand('选择帖子进行屏蔽', () => { if (onHome && enabled && revision) setPicking(!picking); });
  GM_registerMenuCommand('重试检测', () => { reset(); void sync(); });

  // Mutation observers run before paint, including when React recycles an allowed article.
  new MutationObserver(changes => {
    if (!style) installStyle();
    route();
    if (!onHome || !enabled) return;
    const dirty = new Set();
    const selector = scope();
    for (const change of changes) {
      const parent = change.target.nodeType === Node.ELEMENT_NODE ? change.target : change.target.parentElement;
      const owner = parent?.closest(selector);
      if (owner) dirty.add(owner);
      for (const node of change.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE || node.hasAttribute('data-cfx-controls')) continue;
        if (node.matches(selector)) dirty.add(node);
        node.querySelectorAll(selector).forEach(post => dirty.add(post));
      }
      if (!owner && change.type === 'attributes') parent?.querySelectorAll(selector).forEach(post => dirty.add(post));
    }
    for (const [post, rec] of posts) if (!post.isConnected || !post.matches(selector)) clear(post, rec);
    for (const post of dirty) if (post.isConnected && post.matches(selector)) inspect(post);
    syncPostMenu();
    drain();
  }).observe(document, {subtree:true, childList:true, characterData:true, attributes:true,
    attributeFilter:['href','src','srcset','poster','alt','lang','data-testid','role','aria-expanded','hidden','style']});
  document.addEventListener('load', e => {
    const post = e.target instanceof HTMLImageElement && e.target.closest(scope());
    if (post && onHome && enabled) { inspect(post); drain(); }
  }, true);
  window.addEventListener('popstate', route);
  window.navigation?.addEventListener('currententrychange', route);
  window.addEventListener('focus', () => { route(); void sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { route(); void sync(); } });
  setInterval(() => { route(); if (!document.hidden) void sync(); }, 30000);
  installStyle(); route(); scan();
})();
