function createCognitionUI({ siteName = 'Cognition Filter' } = {}) {
  const ICON_LOGO = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8.2V19l-4 2v-7.8L3 5z"/></svg>`;
  const ICON_SHIELD = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3.2v5.3c0 4.6-3 8.6-7 9.9-4-1.3-7-5.3-7-9.9V6.2L12 3z"/><path d="M9.5 12h5"/></svg>`;
  const ICON_TARGET = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
  const ICON_SLIDERS = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>`;
  const ICON_REFRESH = `<svg viewBox="0 0 24 24" width="13.5" height="13.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`;
  const ICON_CHEVRON = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>`;

  const BASE_FONT = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif`;
  const MONO_FONT = `ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`;

  const mountTarget = () => document.body || document.documentElement;

  let toastHost = null;
  let toastTimer = 0;
  function clearToast() {
    clearTimeout(toastTimer);
    toastTimer = 0;
    toastHost?.remove();
    toastHost = null;
  }

  function showToast(text, { duration = 7500 } = {}) {
    clearToast();
    const target = mountTarget();
    if (!target) return;
    const host = document.createElement('div');
    host.setAttribute('data-cf-toast', '');
    toastHost = host;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; bottom: 68px; right: 18px; z-index: 2147483647; pointer-events: auto; }
      @keyframes cfToastIn {
        from { opacity: 0; transform: translateY(10px) scale(0.96); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      aside {
        box-sizing: border-box;
        width: min(380px, 86vw);
        max-height: 44vh;
        overflow: auto;
        padding: 13px 15px;
        border-radius: 16px;
        background: rgba(18, 22, 29, 0.84);
        backdrop-filter: blur(24px) saturate(190%);
        -webkit-backdrop-filter: blur(24px) saturate(190%);
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.12);
        color: #f5f7fa;
        font: 13.5px/1.55 ${BASE_FONT};
        letter-spacing: -0.005em;
        display: flex;
        align-items: flex-start;
        gap: 11px;
        animation: cfToastIn 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .dot {
        width: 8px;
        height: 8px;
        margin-top: 6px;
        border-radius: 999px;
        background: #34d399;
        box-shadow: 0 0 10px rgba(52, 211, 153, 0.65);
        flex-shrink: 0;
      }
      p {
        flex: 1 1 auto;
        min-width: 0;
        white-space: pre-line;
        overflow-wrap: anywhere;
        margin: 0;
        color: rgba(245, 247, 250, 0.95);
      }
      button {
        flex-shrink: 0;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.88);
        font: 500 12px/1.3 ${BASE_FONT};
        cursor: pointer;
        transition: background 0.18s ease, transform 0.15s ease;
      }
      button:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
      button:active { transform: scale(0.96); }
      button:focus-visible { outline: 2px solid #34d399; outline-offset: 2px; }
    </style><aside><span class="dot" aria-hidden="true"></span><p role="status"></p><button type="button">关闭</button></aside>`;
    root.querySelector('p').textContent = text;
    root.querySelector('button').onclick = clearToast;
    target.append(host);
    if (duration > 0) {
      toastTimer = setTimeout(() => { if (toastHost === host) clearToast(); }, duration);
    }
  }

  function createShieldHost(attrName = 'data-cf-controls') {
    const host = document.createElement('div');
    host.setAttribute(attrName, '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: absolute; inset: 0; display: block; pointer-events: auto; z-index: 2147483646; filter: none; }
      @keyframes cfShieldIn {
        from { opacity: 0; transform: scale(0.96); }
        to { opacity: 1; transform: scale(1); }
      }
      .veil {
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 10px;
        background: radial-gradient(circle at 50% 42%, rgba(15, 20, 28, 0.18), rgba(10, 14, 22, 0.44));
        font: 13px/1.4 ${BASE_FONT};
        text-align: center;
      }
      .veil[data-mode="quiet"] {
        background: transparent;
      }
      .capsule {
        box-sizing: border-box;
        max-width: min(268px, 92%);
        max-height: calc(100% - 8px);
        overflow: auto;
        padding: 11px 15px;
        border-radius: 16px;
        background: rgba(20, 24, 32, 0.72);
        backdrop-filter: blur(22px) saturate(185%);
        -webkit-backdrop-filter: blur(22px) saturate(185%);
        border: 1px solid rgba(255, 255, 255, 0.18);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.15);
        color: #f8fafc;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        animation: cfShieldIn 0.24s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .veil[data-mode="quiet"] .capsule {
        padding: 7px 13px;
        border-radius: 999px;
        flex-direction: row;
        gap: 7px;
        background: rgba(20, 24, 32, 0.66);
      }
      .badge-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
        flex-shrink: 0;
      }
      .veil[data-mode="quiet"] .badge-icon {
        width: 7px;
        height: 7px;
        background: #34d399;
        box-shadow: 0 0 8px rgba(52, 211, 153, 0.7);
      }
      .veil[data-mode="quiet"] .badge-icon svg { display: none; }
      p, span[role="status"] {
        margin: 0;
        max-width: 100%;
        max-height: 3.8em;
        overflow: auto;
        overflow-wrap: anywhere;
        font-size: 12.5px;
        font-weight: 500;
        letter-spacing: -0.005em;
        color: rgba(248, 250, 252, 0.94);
      }
      p:empty, span[role="status"]:empty { display: none; }
      .actions { display: flex; align-items: center; justify-content: center; gap: 6px; }
      .actions:empty { display: none; }
      button {
        padding: 5px 13px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.22);
        background: rgba(255, 255, 255, 0.13);
        color: #ffffff;
        font: 600 12px/1.3 ${BASE_FONT};
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: background 0.18s ease, border-color 0.18s ease, transform 0.14s ease;
      }
      button:hover:enabled {
        background: rgba(255, 255, 255, 0.24);
        border-color: rgba(255, 255, 255, 0.38);
      }
      button:active:enabled { transform: scale(0.96); }
      button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
      button:disabled { opacity: 0.6; cursor: wait; }
    </style><div class="veil"><div class="capsule"><span class="badge-icon" aria-hidden="true">${ICON_SHIELD}</span><p role="status"></p><div class="actions"></div></div></div>`;
    return {
      host,
      root,
      veil: root.querySelector('.veil'),
      message: root.querySelector('p'),
      actions: root.querySelector('.actions'),
    };
  }

  let activePairModal = null;
  function promptPairing({ title = `连接 ${siteName}`, subtitle = '右键本机系统托盘图标，打开「配对页」，复制 48 位本机配对码粘贴到下方。', verify } = {}) {
    if (activePairModal) return activePairModal.promise;
    const target = mountTarget();
    if (!target) return Promise.resolve(false);
    let resolvePromise;
    const promise = new Promise(resolve => { resolvePromise = resolve; });
    const host = document.createElement('div');
    host.setAttribute('data-cf-modal', 'pair');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px; }
      @keyframes cfFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cfSheet { from { opacity: 0; transform: translateY(12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .backdrop {
        position: fixed; inset: 0;
        background: rgba(8, 12, 18, 0.46);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        animation: cfFade 0.22s ease;
      }
      section {
        position: relative;
        box-sizing: border-box;
        width: min(420px, 92vw);
        padding: 24px;
        border-radius: 22px;
        background: rgba(22, 26, 34, 0.86);
        backdrop-filter: blur(28px) saturate(190%);
        -webkit-backdrop-filter: blur(28px) saturate(190%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 28px 68px rgba(0, 0, 0, 0.46), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        color: #f5f7fa;
        font: 14px/1.55 ${BASE_FONT};
        animation: cfSheet 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .brand-chip {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(52, 211, 153, 0.14);
        color: #6ee7b7;
        font-size: 12px;
        font-weight: 600;
        margin-bottom: 12px;
      }
      h2 { margin: 0 0 6px; font-size: 19px; font-weight: 650; letter-spacing: -0.02em; color: #ffffff; }
      .desc { margin: 0 0 16px; font-size: 13px; color: rgba(226, 232, 240, 0.78); }
      input {
        box-sizing: border-box;
        width: 100%;
        padding: 11px 13px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.07);
        color: #ffffff;
        font: 13.5px/1.4 ${MONO_FONT};
        letter-spacing: 0.03em;
        transition: border-color 0.18s ease, background 0.18s ease;
      }
      input::placeholder { color: rgba(226, 232, 240, 0.42); font-family: ${BASE_FONT}; letter-spacing: 0; }
      input:focus { outline: none; border-color: #34d399; background: rgba(255, 255, 255, 0.1); }
      .error { margin: 10px 0 0; font-size: 12.5px; color: #fda4af; min-height: 0; }
      .error:empty { display: none; }
      footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
      button {
        padding: 8px 16px;
        border-radius: 999px;
        font: 600 13px/1.3 ${BASE_FONT};
        cursor: pointer;
        transition: all 0.18s ease;
      }
      button[value="cancel"] {
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.06);
        color: rgba(241, 245, 249, 0.86);
      }
      button[value="cancel"]:hover:enabled { background: rgba(255, 255, 255, 0.13); color: #fff; }
      button[value="pair"] {
        border: 1px solid transparent;
        background: linear-gradient(180deg, #34d399, #10b981);
        color: #052e1f;
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      }
      button[value="pair"]:hover:enabled { filter: brightness(1.06); }
      button:disabled { opacity: 0.55; cursor: wait; }
    </style>
    <div class="backdrop"></div>
    <section role="dialog" aria-modal="true" aria-labelledby="cf-pair-title">
      <div class="brand-chip">${ICON_LOGO}<span>Cognition Filter · 本地安全配对</span></div>
      <h2 id="cf-pair-title"></h2>
      <p class="desc"></p>
      <form>
        <input type="password" data-cf-pair-input autocomplete="off" spellcheck="false" placeholder="粘贴 48 位本机配对码…" aria-label="本机配对码">
        <p class="error" role="status"></p>
        <footer>
          <button type="button" value="cancel">稍后</button>
          <button type="submit" value="pair">连接并启用</button>
        </footer>
      </form>
    </section>`;
    root.querySelector('h2').textContent = title;
    root.querySelector('.desc').textContent = subtitle;
    const input = root.querySelector('input');
    const errorEl = root.querySelector('.error');
    const submitBtn = root.querySelector('[value="pair"]');
    const cancelBtn = root.querySelector('[value="cancel"]');
    let busy = false;

    function close(result) {
      if (!activePairModal) return;
      activePairModal = null;
      window.removeEventListener('keydown', onKey, true);
      host.remove();
      resolvePromise(result);
    }
    function onKey(e) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      }
    }
    window.addEventListener('keydown', onKey, true);
    root.querySelector('.backdrop').onclick = () => { if (!busy) close(false); };
    cancelBtn.onclick = () => { if (!busy) close(false); };
    root.querySelector('form').onsubmit = async e => {
      e.preventDefault();
      if (busy) return;
      const secret = input.value.trim();
      if (!secret) {
        errorEl.textContent = '请粘贴本机配对码';
        input.focus();
        return;
      }
      busy = true;
      input.disabled = submitBtn.disabled = cancelBtn.disabled = true;
      errorEl.textContent = '';
      try {
        const ok = await verify(secret);
        if (ok) close(true);
        else {
          busy = false;
          input.disabled = submitBtn.disabled = cancelBtn.disabled = false;
          errorEl.textContent = '配对未完成，请重试';
        }
      } catch (error) {
        busy = false;
        input.disabled = submitBtn.disabled = cancelBtn.disabled = false;
        errorEl.textContent = error.message || '无法连接本地 Agent';
        input.focus();
      }
    };
    activePairModal = { host, root, promise, close };
    target.append(host);
    queueMicrotask(() => input.focus({ preventScroll: true }));
    return promise;
  }

  let updateBannerHost = null;
  function offerUpdateBanner({ installed, latest, onAccept }) {
    updateBannerHost?.remove();
    const target = mountTarget();
    if (!target) return;
    const host = document.createElement('div');
    host.setAttribute('data-cf-update-banner', '');
    updateBannerHost = host;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; top: 18px; right: 18px; z-index: 2147483647; }
      @keyframes cfSlideDown { from { opacity: 0; transform: translateY(-10px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      section {
        box-sizing: border-box;
        width: min(360px, 88vw);
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(20, 24, 32, 0.86);
        backdrop-filter: blur(24px) saturate(190%);
        -webkit-backdrop-filter: blur(24px) saturate(190%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 20px 44px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        color: #f8fafc;
        font: 13px/1.5 ${BASE_FONT};
        animation: cfSlideDown 0.28s cubic-bezier(0.22, 1, 0.36, 1);
      }
      strong { display: block; font-size: 13.5px; font-weight: 650; margin-bottom: 3px; }
      span { display: block; color: rgba(226, 232, 240, 0.78); font-size: 12.5px; }
      .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 11px; }
      button {
        padding: 5px 12px;
        border-radius: 999px;
        font: 600 12px/1.3 ${BASE_FONT};
        cursor: pointer;
      }
      button[value="dismiss"] {
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.07);
        color: rgba(241, 245, 249, 0.86);
      }
      button[value="update"] {
        border: 0;
        background: #34d399;
        color: #052e1f;
      }
    </style>
    <section role="region" aria-label="脚本更新提示">
      <strong>发现新版站点脚本</strong>
      <span></span>
      <div class="actions">
        <button type="button" value="dismiss">稍后</button>
        <button type="button" value="update">立即更新</button>
      </div>
    </section>`;
    root.querySelector('span').textContent = `版本 ${installed} → ${latest}，更新后刷新当前页面生效。`;
    const close = () => { if (updateBannerHost === host) updateBannerHost = null; host.remove(); };
    root.querySelector('[value="dismiss"]').onclick = close;
    root.querySelector('[value="update"]').onclick = () => { close(); void onAccept?.(); };
    target.append(host);
  }

  function mountPickerBanner({ text = '点击要屏蔽的卡片', onCancel } = {}) {
    const host = document.createElement('div');
    host.setAttribute('data-cf-picker-hud', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; bottom: 22px; left: 50%; transform: translateX(-50%); z-index: 2147483647; }
      @keyframes cfHudIn { from { opacity: 0; transform: translateY(12px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
      div.hud {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px 8px 15px;
        border-radius: 999px;
        background: rgba(18, 22, 30, 0.86);
        backdrop-filter: blur(24px) saturate(190%);
        -webkit-backdrop-filter: blur(24px) saturate(190%);
        border: 1px solid rgba(52, 211, 153, 0.35);
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.36), 0 0 0 1px rgba(52, 211, 153, 0.12);
        color: #f8fafc;
        font: 500 13px/1.3 ${BASE_FONT};
        white-space: nowrap;
        animation: cfHudIn 0.24s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .icon { display: inline-flex; color: #34d399; }
      button {
        padding: 5px 11px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.1);
        color: #fff;
        font: 600 12px/1.2 ${BASE_FONT};
        cursor: pointer;
        transition: background 0.16s ease;
      }
      button:hover { background: rgba(255, 255, 255, 0.2); }
    </style><div class="hud"><span class="icon">${ICON_TARGET}</span><span class="label"></span><button type="button">取消 · Esc</button></div>`;
    root.querySelector('.label').textContent = text;
    root.querySelector('button').onclick = onCancel;
    mountTarget()?.append(host);
    return host;
  }

  function createPickerSheet({ heading = '屏蔽选中的内容', preview = '', onOpenRules, onCancel }) {
    const host = document.createElement('div');
    host.setAttribute('data-cf-picker-sheet', '');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px; }
      @keyframes cfFade { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cfSheet { from { opacity: 0; transform: translateY(10px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .backdrop {
        position: fixed; inset: 0;
        background: rgba(8, 12, 18, 0.45);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        animation: cfFade 0.2s ease;
      }
      section {
        position: relative;
        box-sizing: border-box;
        width: min(440px, 94vw);
        max-height: 85vh;
        overflow: auto;
        padding: 22px 24px;
        border-radius: 22px;
        background: rgba(22, 26, 34, 0.88);
        backdrop-filter: blur(28px) saturate(190%);
        -webkit-backdrop-filter: blur(28px) saturate(190%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 0 28px 64px rgba(0, 0, 0, 0.44), inset 0 1px 0 rgba(255, 255, 255, 0.14);
        color: #f8fafc;
        font: 14px/1.5 ${BASE_FONT};
        animation: cfSheet 0.26s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .eyebrow {
        display: inline-flex; align-items: center; gap: 6px;
        color: #6ee7b7; font-size: 12px; font-weight: 600; margin-bottom: 8px;
      }
      h2 { margin: 0 0 8px; font-size: 18px; font-weight: 650; letter-spacing: -0.015em; }
      .preview {
        margin: 0 0 14px;
        padding: 8px 11px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(226, 232, 240, 0.82);
        font-size: 12.5px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .preview:empty { display: none; }
      label { display: block; font-size: 12.5px; font-weight: 600; color: rgba(226, 232, 240, 0.88); }
      select {
        display: block;
        box-sizing: border-box;
        width: 100%;
        margin-top: 6px;
        padding: 9px 12px;
        border-radius: 11px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        background: rgba(15, 20, 28, 0.9);
        color: #ffffff;
        font: 500 13.5px/1.4 ${BASE_FONT};
        cursor: pointer;
      }
      select:focus { outline: none; border-color: #34d399; }
      p[role="status"] {
        margin: 10px 0 0;
        font-size: 12.5px;
        color: #fcd34d;
        overflow-wrap: anywhere;
      }
      p[role="status"]:empty { display: none; }
      footer {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 18px;
      }
      .right-actions { display: flex; gap: 8px; margin-left: auto; }
      button {
        padding: 7px 14px;
        border-radius: 999px;
        font: 600 12.5px/1.3 ${BASE_FONT};
        cursor: pointer;
        transition: all 0.16s ease;
      }
      button[value="rules"] {
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: transparent;
        color: rgba(226, 232, 240, 0.84);
      }
      button[value="rules"]:hover:enabled { background: rgba(255, 255, 255, 0.08); color: #fff; }
      button[value="cancel"] {
        border: 1px solid rgba(255, 255, 255, 0.16);
        background: rgba(255, 255, 255, 0.08);
        color: #f1f5f9;
      }
      button[value="cancel"]:hover:enabled { background: rgba(255, 255, 255, 0.15); }
      button[value="apply"] {
        border: 0;
        background: linear-gradient(180deg, #34d399, #10b981);
        color: #052e1f;
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.34);
      }
      button[value="apply"]:hover:enabled { filter: brightness(1.06); }
      button:disabled { opacity: 0.52; cursor: not-allowed; }
    </style>
    <div class="backdrop"></div>
    <section role="dialog" aria-modal="true" aria-labelledby="cf-pick-title">
      <div class="eyebrow">${ICON_TARGET}<span>规则自进化 · 补充样本</span></div>
      <h2 id="cf-pick-title"></h2>
      <div class="preview"></div>
      <label>归入规则组<select></select></label>
      <p role="status"></p>
      <footer>
        <button type="button" value="rules">前往 WebUI 编辑规则</button>
        <div class="right-actions">
          <button type="button" value="cancel">取消</button>
          <button type="button" value="apply">确认屏蔽</button>
        </div>
      </footer>
    </section>`;
    root.querySelector('h2').textContent = heading;
    root.querySelector('.preview').textContent = preview;
    const select = root.querySelector('select');
    const status = root.querySelector('[role="status"]');
    const rulesBtn = root.querySelector('[value="rules"]');
    const cancelBtn = root.querySelector('[value="cancel"]');
    const applyBtn = root.querySelector('[value="apply"]');
    rulesBtn.onclick = onOpenRules;
    cancelBtn.onclick = onCancel;
    root.querySelector('.backdrop').onclick = () => { if (!cancelBtn.disabled) onCancel?.(); };
    mountTarget()?.append(host);
    return { host, root, select, status, rulesBtn, cancelBtn, applyBtn };
  }

  function mountPill({ onPair, onPick, onRules, onReset } = {}) {
    let host = null;
    let els = null;
    let tucked = Boolean(typeof GM_getValue === 'function' && GM_getValue('cfPillTucked', false));

    function ensure() {
      if (host?.isConnected) return true;
      const target = mountTarget();
      if (!target) return false;
      host = document.createElement('div');
      host.setAttribute('data-cf-pill', '');
      const root = host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        :host {
          all: initial;
          position: fixed;
          right: 16px;
          bottom: 18px;
          z-index: 2147483645;
          pointer-events: auto;
        }
        nav {
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          height: 36px;
          padding: 0 12px;
          border-radius: 999px;
          background: rgba(18, 22, 30, 0.78);
          backdrop-filter: blur(22px) saturate(190%);
          -webkit-backdrop-filter: blur(22px) saturate(190%);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.14);
          color: #f1f5f9;
          font: 500 12.5px/1 ${BASE_FONT};
          font-variant-numeric: tabular-nums;
          transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1), background 0.22s ease, box-shadow 0.22s ease;
          user-select: none;
        }
        nav:hover, nav:focus-within {
          background: rgba(18, 22, 30, 0.9);
          box-shadow: 0 14px 36px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.18);
        }
        nav[data-tucked="true"]:not(:hover):not(:focus-within) {
          transform: translateX(calc(100% - 10px));
          opacity: 0.72;
        }
        .status-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          cursor: pointer;
          white-space: nowrap;
        }
        .orb {
          width: 7.5px;
          height: 7.5px;
          border-radius: 999px;
          background: #34d399;
          box-shadow: 0 0 9px rgba(52, 211, 153, 0.75);
          transition: background 0.2s ease, box-shadow 0.2s ease;
        }
        nav[data-tone="busy"] .orb {
          background: #38bdf8;
          box-shadow: 0 0 10px rgba(56, 189, 248, 0.85);
        }
        nav[data-tone="warn"] .orb {
          background: #fbbf24;
          box-shadow: 0 0 9px rgba(251, 191, 36, 0.75);
        }
        .summary {
          font-weight: 600;
          letter-spacing: -0.01em;
          color: rgba(248, 250, 252, 0.95);
        }
        .drawer {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          max-width: 0;
          opacity: 0;
          overflow: hidden;
          pointer-events: none;
          transition: max-width 0.34s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease, margin 0.24s ease;
        }
        nav:hover .drawer, nav:focus-within .drawer {
          max-width: 340px;
          opacity: 1;
          margin-left: 2px;
          pointer-events: auto;
        }
        .sep {
          width: 1px;
          height: 14px;
          background: rgba(255, 255, 255, 0.14);
          margin: 0 2px;
          flex-shrink: 0;
        }
        button.act {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 24px;
          padding: 0 9px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.08);
          color: rgba(248, 250, 252, 0.92);
          font: 600 11.5px/1 ${BASE_FONT};
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.16s ease, transform 0.14s ease;
        }
        button.act:hover { background: rgba(255, 255, 255, 0.18); color: #fff; }
        button.act:active { transform: scale(0.95); }
        button.act[data-primary="true"] {
          background: #34d399;
          border-color: transparent;
          color: #052e1f;
        }
        button.act.icon-only { padding: 0 6px; }
        nav[data-tucked="true"] .tuck svg { transform: rotate(180deg); }
      </style>
      <nav aria-label="Cognition Filter 灵动胶囊">
        <button type="button" class="status-btn" title="展开认知滤网控制">
          <span class="orb" aria-hidden="true"></span>
          <span class="summary">滤网就绪</span>
        </button>
        <div class="drawer">
          <span class="sep" aria-hidden="true"></span>
          <button type="button" class="act" data-action="pair" data-primary="true" hidden>配对</button>
          <button type="button" class="act" data-action="pick">${ICON_TARGET}<span>选卡屏蔽</span></button>
          <button type="button" class="act" data-action="rules">${ICON_SLIDERS}<span>规则</span></button>
          <button type="button" class="act icon-only" data-action="reset" title="重新检测">${ICON_REFRESH}</button>
          <button type="button" class="act icon-only tuck" data-action="tuck" title="贴边收起">${ICON_CHEVRON}</button>
        </div>
      </nav>`;
      const nav = root.querySelector('nav');
      const summary = root.querySelector('.summary');
      const pairBtn = root.querySelector('[data-action="pair"]');
      const pickBtn = root.querySelector('[data-action="pick"]');
      const rulesBtn = root.querySelector('[data-action="rules"]');
      const resetBtn = root.querySelector('[data-action="reset"]');
      const tuckBtn = root.querySelector('[data-action="tuck"]');
      nav.dataset.tucked = String(tucked);
      root.querySelector('.status-btn').onclick = () => {
        if (tucked) {
          tucked = false;
          nav.dataset.tucked = 'false';
          if (typeof GM_setValue === 'function') GM_setValue('cfPillTucked', false);
        }
      };
      pairBtn.onclick = () => onPair?.();
      pickBtn.onclick = () => onPick?.();
      rulesBtn.onclick = () => onRules?.();
      resetBtn.onclick = () => onReset?.();
      tuckBtn.onclick = () => {
        tucked = !tucked;
        nav.dataset.tucked = String(tucked);
        if (typeof GM_setValue === 'function') GM_setValue('cfPillTucked', tucked);
      };
      els = { nav, summary, pairBtn, pickBtn, rulesBtn, resetBtn };
      target.append(host);
      return true;
    }

    return {
      update({ visible = true, paired = true, blocked = 0, reviewing = 0, error = '' } = {}) {
        if (!visible) {
          host?.remove();
          host = null;
          els = null;
          return;
        }
        if (!ensure()) return;
        els.pairBtn.hidden = paired;
        els.pickBtn.hidden = !paired;
        els.rulesBtn.hidden = !paired;
        els.resetBtn.hidden = !paired;
        if (!paired) {
          els.nav.dataset.tone = 'warn';
          els.summary.textContent = '待配对';
        } else if (error) {
          els.nav.dataset.tone = 'warn';
          els.summary.textContent = '连接待重试';
        } else if (reviewing > 0) {
          els.nav.dataset.tone = 'busy';
          els.summary.textContent = blocked > 0 ? `审阅 ${reviewing} · 已拦 ${blocked}` : `审阅中 ${reviewing}`;
        } else {
          els.nav.dataset.tone = 'ok';
          els.summary.textContent = blocked > 0 ? `已拦 ${blocked}` : '滤网守护中';
        }
      },
      unmount() {
        host?.remove();
        host = null;
        els = null;
      },
    };
  }

  return {
    showToast,
    clearToast,
    createShieldHost,
    promptPairing,
    offerUpdateBanner,
    mountPickerBanner,
    createPickerSheet,
    mountPill,
  };
}

function createCognitionClient({ getToken = () => GM_getValue('pairToken', ''),
  generation = () => 0, current = () => true, currentPage = () => !document.hidden, ui } = {}) {
  const surface = ui || createCognitionUI();
  let discovery;
  const ports = [17321];
  let portState = 0x1d3b;
  for (let i = 0; i < 32; i++) {
    ports.push(49152 + portState);
    portState = (portState * 109 + 89) & 0x3fff;
  }
  const encode = new TextEncoder();
  const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  function transport(url, options, timeout, signal) {
    return new Promise((resolve, reject) => {
      let handle;
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        callback(value);
      };
      const stop = () => {
        finish(reject, new Error('请求已中断'));
        handle?.abort?.();
      };
      const timeoutError = () => Object.assign(new Error('本地服务响应超时'), { transient: true });
      // Tampermonkey may use fetch for redirect:error. Retain an independent deadline.
      const timer = setTimeout(() => { finish(reject, timeoutError()); handle?.abort?.(); }, timeout);
      if (signal?.aborted) { stop(); return; }
      signal?.addEventListener('abort', stop, { once: true });
      try {
        handle = GM_xmlhttpRequest({
          ...options, url, anonymous: true, redirect: 'error', timeout,
          headers: { 'X-Cognition-Filter-Version': '__CF_SITE_VERSION__', ...options.headers },
          onload(response) {
            if (response.finalUrl !== url) finish(reject, new Error('本地服务响应地址不匹配'));
            else finish(resolve, response);
          },
          onerror: () => finish(reject, Object.assign(new Error('无法连接本地服务'), { transient: true })),
          ontimeout: () => finish(reject, timeoutError()),
          onabort: () => finish(reject, new Error('请求已中断')),
        });
      } catch (error) { finish(reject, error); }
    });
  }

  async function discoverAgent(secret) {
    const key = await crypto.subtle.importKey('raw', encode.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']);
    const cached = GM_getValue('agentPort', 0);
    const first = ports.includes(cached) ? cached : ports[0];
    const controller = new AbortController();
    async function probe(port) {
      const nonce = hex(crypto.getRandomValues(new Uint8Array(16)));
      const url = `http://127.0.0.1:${port}/.well-known/cognition-filter?nonce=${nonce}`;
      try {
        const response = await transport(url, { method: 'GET' }, 800, controller.signal);
        if (response.status !== 200 || response.responseText.length > 2048) return false;
        const hello = JSON.parse(response.responseText);
        if (hello.service !== 'cognition-filter' || hello.protocol !== 1 || hello.port !== port ||
            typeof hello.proof !== 'string' || hello.proof.length !== 64 || /[^0-9a-f]/.test(hello.proof)) return false;
        const mac = Uint8Array.from(hello.proof.match(/../g), b => parseInt(b, 16));
        return await crypto.subtle.verify('HMAC', key, mac, encode.encode(`cognition-filter/v1|${port}|${nonce}`));
      } catch { return false; }
    }
    let port;
    if (await probe(first)) port = first;
    else {
      const candidates = ports.filter(candidate => candidate !== first);
      let next = 0;
      async function worker() {
        while (!port && next < candidates.length) {
          const candidate = candidates[next++];
          if (await probe(candidate) && !port) {
            port = candidate;
            controller.abort();
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker));
    }
    if (!port) throw Object.assign(new Error('未找到已配对的本地 agent，请检查托盘和配对口令'), { transient: true, undispatched: true });
    const signature = await crypto.subtle.sign('HMAC', key, encode.encode('cognition-filter/auth/v1|' + port));
    return { port, auth: 'CF-Port ' + hex(signature) };
  }

  function rememberAgent(agent) {
    if (GM_getValue('agentPort', 0) !== agent.port) GM_setValue('agentPort', agent.port);
  }

  async function agentFor(secret) {
    // Only overlapping calls share a successful challenge. A cached port is merely the first candidate.
    if (discovery?.secret === secret) return discovery.work;
    const flight = { secret, work: discoverAgent(secret) };
    discovery = flight;
    try {
      const agent = await flight.work;
      if (secret === getToken() && discovery === flight) rememberAgent(agent);
      return agent;
    } finally { if (discovery === flight) discovery = null; }
  }

  async function sendOnce(path, method, payload, agent, timeout) {
    const url = `http://127.0.0.1:${agent.port}/v1${path}`;
    const options = { method, headers: { Authorization: agent.auth, 'X-Cognition-Filter-Site': '__CF_SITE_ID__' } };
    if (path === '/rules' && method === 'GET') options.headers['X-Cognition-Filter-Update-Prompt'] = '1';
    if (payload) { options.headers['Content-Type'] = 'application/json'; options.data = payload; }
    const response = await transport(url, options, timeout);
    if (response.status < 200 || response.status >= 300) {
      let detail;
      try { detail = JSON.parse(response.responseText); } catch { /* local proxy may return HTML */ }
      const error = new Error(typeof detail?.message === 'string' ? detail.message.slice(0, 250) :
        response.status === 401 || response.status === 403 ? '配对口令无效' : '本地服务返回 ' + response.status);
      error.status = response.status;
      error.transient = detail?.retryable !== false && [0, 408, 429, 502, 503, 504].includes(response.status);
      const retryAfter = response.responseHeaders?.match(/^retry-after:\s*([^\r\n]+)/im)?.[1]?.trim();
      if (retryAfter) error.wait = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
      throw error;
    }
    try { return JSON.parse(response.responseText); }
    catch { throw new Error('本地服务响应格式错误'); }
  }

  async function request(path, method = 'GET', body, stillValid = () => true, retrying = () => {}) {
    const startEpoch = generation();
    const auth = getToken();
    const deadline = performance.now() + 95000;
    // Identical feedback/pick bodies share the agent's operation key. Rule writes use revision CAS.
    const payload = body ? JSON.stringify(body) : undefined;
    const canReplay = () => generation() === startEpoch && getToken() === auth && current(body) && stillValid();
    let reconcile = false;
    for (let attempt = 0; ; attempt++) {
      let agent;
      try {
        agent = await agentFor(auth);
        if (!canReplay()) throw Object.assign(new Error('卡片或规则已变化'), { status: 409 });
        if (reconcile) {
          const latest = await sendOnce('/rules', 'GET', undefined, agent, 6000);
          if (latest?.revision !== body.revision || !canReplay()) {
            throw Object.assign(new Error('本地规则已更新，请重新读取结果'), { status: 409 });
          }
          const checkedPort = agent.port;
          agent = await agentFor(auth);
          if (agent.port !== checkedPort || !canReplay()) throw Object.assign(new Error('本地服务已变化，请重试'), { status: 409 });
        }
        const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
        const timeout = path === '/rules' ? Math.min(6000, remaining) :
          path === '/classify' ? remaining : Math.min(60000, remaining);
        const reply = await sendOnce(path, method, payload, agent, timeout);
        if (path === '/rules' && method === 'GET' && canReplay()) {
          void offerUpdate(reply, agent.port, auth).catch(error => {
            if (currentPage()) surface.showToast(error.message);
          });
        }
        return reply;
      } catch (error) {
        // An ambiguous classify timeout can already have incurred a model call. Only an explicit
        // queue rejection is replayed here; upstream inference and asset retries belong to the agent.
        if (!error.transient || attempt >= 2 || (agent && path === '/classify' && error.status !== 429) || !canReplay()) throw error;
        if (agent && method !== 'GET' && path !== '/classify' && error.status !== 429) reconcile = true;
        const backoff = 400 * 2 ** attempt * (0.8 + 0.4 * Math.random());
        const wait = Math.max(backoff, error.wait || 0);
        if (performance.now() + wait >= deadline) throw error;
        retrying(attempt + 1);
        await new Promise(resolve => setTimeout(resolve, wait));
        if (!canReplay() || performance.now() >= deadline) throw error;
      }
    }
  }

  async function pair(secret, stillValid = () => true) {
    const agent = await agentFor(secret);
    if (!stillValid()) return false;
    GM_setValue('pairToken', secret);
    rememberAgent(agent);
    return true;
  }

  let offeredPairing = false;
  function offerPairing(onHome, pairFromMenu) {
    if (offeredPairing || document.hidden || !onHome() || getToken() ||
        Date.now() - GM_getValue('pairPromptAt', 0) < 86400000) return;
    offeredPairing = true;
    setTimeout(() => {
      if (document.hidden || !onHome() || getToken()) { offeredPairing = false; return; }
      GM_setValue('pairPromptAt', Date.now());
      void pairFromMenu();
    }, 0);
  }

  const installed = '__CF_SITE_VERSION__';
  const updatePath = '/plugins/__CF_SITE_ID__/cognition-filter.user.js';
  let nextMetadataCheck = 0, cachedVersion;
  async function offerUpdate(info, port, secret) {
    if (!currentPage() || info.siteEnabled === false) return;
    let latest = info.scriptVersion;
    if (!latest) {
      // Agents predating scriptVersion still serve the versioned userscript on the verified port.
      if (Date.now() >= nextMetadataCheck) {
        nextMetadataCheck = Date.now() + 900000;
        try {
          const response = await transport('http://127.0.0.1:' + port + updatePath,
            {method:'GET',headers:{Range:'bytes=0-2047'}}, 4000);
          if ([200,206].includes(response.status)) cachedVersion = response.responseText.slice(0,2048).match(/^\/\/ @version\s+([\d.]+)\s*$/m)?.[1];
        } catch { /* Check again on a subsequent rules refresh. */ }
      }
      latest = cachedVersion;
    }
    if (typeof latest !== 'string' || !/^\d+(?:\.\d+)*$/.test(latest) || latest.length > 19) return;
    const ours = installed.split('.').map(Number), theirs = latest.split('.').map(Number);
    let diff = 0;
    for (let i = 0; !diff && i < Math.max(ours.length,theirs.length); i++) diff = (theirs[i] || 0) - (ours[i] || 0);
    const last = GM_getValue('scriptUpdatePrompt', {});
    if (diff <= 0 || !currentPage() || getToken() !== secret ||
        (last?.version === latest && Date.now() - last.at < 86400000)) return;
    GM_setValue('scriptUpdatePrompt', {version:latest, at:Date.now()});
    surface.offerUpdateBanner({
      installed,
      latest,
      onAccept: async () => {
        try {
          const agent = await agentFor(secret);
          if (getToken() === secret && currentPage()) {
            GM_openInTab('http://127.0.0.1:' + agent.port + updatePath, {active:true});
          }
        } catch (error) {
          if (currentPage()) surface.showToast(error.message);
        }
      },
    });
  }

  async function rulesPageUrl() {
    const secret = getToken();
    if (!secret) throw new Error('请先在油猴菜单选择「配对本地 agent」');
    const agent = await agentFor(secret);
    if (getToken() !== secret) throw new Error('配对已变化，请重新打开规则页');
    return `http://127.0.0.1:${agent.port}/rules`;
  }

  async function review(card, revision, stillValid) {
    const reply = await request('/classify', 'POST', { cards: [card], revision }, stillValid);
    if (reply?.revision !== revision) throw Object.assign(new Error('判定或规则已变化'), { status: 409 });
    const result = reply.results?.[0];
    if (!Array.isArray(reply.results) || reply.results.length !== 1 || result?.id !== card.id
        || !['allow', 'block', 'pending'].includes(result.decision)) throw new Error('本地服务响应格式错误');
    return result;
  }
  return {
    ui: surface,
    pair, review, rulesPageUrl, offerPairing,
    rules: () => request('/rules'),
    saveRules: (groups, revision) => request('/rules', 'PUT', { groups, revision }),
    report: (card, revision, stillValid, retrying) => request('/feedback', 'POST', { card, revision }, stillValid, retrying),
    pick: (body, stillValid, retrying) => request('/pick', 'POST', body, stillValid, retrying),
  };
}
