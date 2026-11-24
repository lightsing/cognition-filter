'use strict';

(() => {
  const i18n = window.cfI18n;
  const t = (key, params) => i18n.t(key, params);
  const byId = id => document.getElementById(id);

  const codeEl = byId('pair-code');
  const copyBtn = byId('copy-pair-code');
  const copyStatus = byId('copy-status');
  const sitePlugins = byId('site-plugins');
  const sitePluginsEmpty = byId('site-plugins-empty');

  let statusKey = '';
  let statusTone = '';
  let copiedIndicator = false;
  let resetTimer = null;

  function renderCopyState() {
    if (copyBtn) {
      copyBtn.textContent = t(
        copiedIndicator ? 'pairing.codeSection.copied' : 'pairing.codeSection.copy'
      );
    }
    if (copyStatus) {
      copyStatus.textContent = statusKey ? t(statusKey) : '';
      copyStatus.dataset.tone = statusTone;
    }
  }

  function setStatus(key, tone) {
    statusKey = key;
    statusTone = tone;
    renderCopyState();
  }

  function selectElementText(el) {
    const selection = window.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function fallbackCopy(code) {
    const area = document.createElement('textarea');
    area.className = 'sr-only';
    area.setAttribute('readonly', '');
    area.value = code;
    document.body.append(area);
    area.select();
    area.setSelectionRange(0, code.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }

  async function copyCode() {
    const code = codeEl ? codeEl.textContent.trim() : '';
    if (!code || code === '__PAIR_CODE__') {
      setStatus('pairing.status.unavailable', 'warning');
      return;
    }

    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(code);
        copied = true;
      } catch {
        copied = false;
      }
    }

    if (!copied) {
      copied = fallbackCopy(code);
    }

    if (copied) {
      copiedIndicator = true;
      setStatus('pairing.status.copied', 'success');
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        copiedIndicator = false;
        renderCopyState();
      }, 1800);
    } else {
      if (codeEl) selectElementText(codeEl);
      setStatus('pairing.status.fallbackSelected', 'warning');
    }
  }

  function checkSitePlugins() {
    if (!sitePlugins) return;
    i18n.apply(sitePlugins);
    if (sitePluginsEmpty) {
      sitePluginsEmpty.hidden = Boolean(sitePlugins.textContent.trim());
    }
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      void copyCode();
    });
  }

  i18n.onChange(() => {
    renderCopyState();
    checkSitePlugins();
  });

  checkSitePlugins();
  renderCopyState();
})();
