'use strict';

(() => {
  const i18n = window.cfI18n;
  const t = (key, params) => i18n.t(key, params);
  const byId = id => document.getElementById(id);

  const meta = document.querySelector('meta[name="cf-token"]');
  const token = meta?.content || '';
  meta?.remove();
  const paired = Boolean(token && token !== '__PAIRING_TOKEN__');

  const period = byId('period');
  const panel = byId('numbers');
  const emptyNotice = byId('stats-empty');
  const status = byId('freshness');

  const SVG_NS = 'http://www.w3.org/2000/svg';

  let latest = null;
  let updated = null;
  let timer = null;
  let loading = false;
  let expired = false;
  let connectionError = false;

  function setBarRect(id, x, width) {
    const el = byId(id);
    if (!el) return;
    el.setAttribute('x', String(x));
    el.setAttribute('width', String(Math.max(0, width)));
  }

  function renderOutcomesVisual(s) {
    const total = s.block + s.allow + s.pending;
    if (total > 0) {
      const wBlock = (s.block / total) * 1000;
      const wAllow = (s.allow / total) * 1000;
      const wPending = Math.max(0, 1000 - wBlock - wAllow);
      setBarRect('bar-block', 0, wBlock);
      setBarRect('bar-allow', wBlock, wAllow);
      setBarRect('bar-pending', wBlock + wAllow, wPending);
    } else {
      setBarRect('bar-block', 0, 0);
      setBarRect('bar-allow', 0, 0);
      setBarRect('bar-pending', 0, 0);
    }

    byId('legend-block').textContent =
      t('stats.outcomes.block') + ' ' + i18n.formatPercent(s.block, total);
    byId('legend-allow').textContent =
      t('stats.outcomes.allow') + ' ' + i18n.formatPercent(s.allow, total);
    byId('legend-pending').textContent =
      t('stats.outcomes.pending') + ' ' + i18n.formatPercent(s.pending, total);
  }

  function renderPrefixVisual(s) {
    const ratio = s.inputTokens > 0 ? Math.min(1, s.prefixHitTokens / s.inputTokens) : 0;
    setBarRect('bar-prefix', 0, (ratio * 1000).toFixed(1));
    const valueEl = byId('prefix-chart-value');
    if (valueEl) {
      valueEl.textContent = i18n.formatPercent(s.prefixHitTokens, s.inputTokens);
    }
  }

  function renderRules(s) {
    const list = byId('rule-hits');
    list.replaceChildren();

    const ids = new Set([
      ...Object.keys(latest.ruleNames || {}),
      ...Object.keys(s.ruleHits || {}),
    ]);
    const count = id => (s.ruleHits && Object.hasOwn(s.ruleHits, id) ? s.ruleHits[id] : 0);
    const sorted = [...ids].sort((a, b) => count(b) - count(a));
    const maxHits = sorted.reduce((m, id) => Math.max(m, count(id)), 0);

    for (const id of sorted) {
      const hits = count(id);
      const row = document.createElement('div');
      row.className = 'rule-row';

      const metaRow = document.createElement('div');
      metaRow.className = 'rule-meta';

      const name = document.createElement('dt');
      name.textContent = latest.ruleNames && Object.hasOwn(latest.ruleNames, id)
        ? latest.ruleNames[id]
        : t('stats.rules.deleted', { id });

      const value = document.createElement('dd');
      value.textContent = i18n.formatNumber(hits);

      metaRow.append(name, value);

      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'rule-bar');
      svg.setAttribute('viewBox', '0 0 100 6');
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('aria-hidden', 'true');

      const track = document.createElementNS(SVG_NS, 'rect');
      track.setAttribute('class', 'rule-bar-track');
      track.setAttribute('x', '0');
      track.setAttribute('y', '0');
      track.setAttribute('width', '100');
      track.setAttribute('height', '6');
      track.setAttribute('rx', '3');

      const fill = document.createElementNS(SVG_NS, 'rect');
      fill.setAttribute('class', 'rule-bar-fill');
      fill.setAttribute('x', '0');
      fill.setAttribute('y', '0');
      fill.setAttribute('width', maxHits > 0 ? ((hits / maxHits) * 100).toFixed(1) : '0');
      fill.setAttribute('height', '6');
      fill.setAttribute('rx', '3');

      svg.append(track, fill);
      row.append(metaRow, svg);
      list.append(row);
    }

    if (!list.childElementCount) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = t('stats.rules.empty');
      list.append(empty);
    }
  }

  function renderFreshness() {
    if (!paired) {
      status.textContent = t('stats.freshness.unpaired');
      status.dataset.tone = 'error';
      return;
    }
    if (expired) {
      status.textContent = t('stats.freshness.expired');
      status.dataset.tone = 'error';
      return;
    }
    if (connectionError) {
      const base = t('stats.freshness.refreshFailed');
      status.textContent = updated
        ? base + ' ' + t('stats.freshness.lastUpdated', { time: i18n.formatTime(updated) })
        : base;
      status.dataset.tone = 'error';
      return;
    }
    if (!latest) {
      status.textContent = t('stats.freshness.loading');
      status.dataset.tone = '';
      return;
    }
    if (!latest.total) {
      status.textContent = t('stats.freshness.totalFailed');
      status.dataset.tone = 'warning';
      return;
    }
    if (latest.saveFailed) {
      status.textContent = t('stats.freshness.saveFailed');
      status.dataset.tone = 'warning';
      return;
    }
    status.textContent = t('stats.freshness.updated', { time: i18n.formatTime(updated) });
    status.dataset.tone = '';
  }

  function usageRow(name, stats = {}) {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = name;
    row.append(label);
    const { cards = 0, warmupCalls = 0, cacheHits = 0, inputTokens = 0, outputTokens = 0, prefixHitTokens = 0 } = stats;
    const number = i18n.formatNumber;
    for (const text of [number(cards), number(warmupCalls), i18n.formatPercent(cacheHits, cards),
      i18n.formatPercent(prefixHitTokens, inputTokens), number(inputTokens), number(outputTokens)]) {
      const cell = row.insertCell();
      cell.textContent = text;
    }
    return row;
  }

  function renderSites(global) {
    const names = latest.siteNames || {};
    const counters = latest.bySite?.[period.value] || {};
    const ids = [...new Set([...Object.keys(names), ...Object.keys(counters)])].sort();
    const rows = ids.map(id => usageRow(Object.hasOwn(names, id) ? names[id] : id,
      Object.hasOwn(counters, id) ? counters[id] : undefined));
    if (period.value === 'total' && latest.unattributed) {
      rows.push(usageRow(t('stats.sites.legacy'), latest.unattributed));
    }
    byId('site-usage').replaceChildren(...rows);
    byId('global-usage').replaceChildren(usageRow(t('stats.sites.global'), global));
  }

  function render() {
    renderFreshness();
    if (!latest) return;

    const s = latest[period.value];
    panel.hidden = !s;
    if (emptyNotice) emptyNotice.hidden = Boolean(s);
    if (!s) return;
    renderSites(s);

    for (const el of panel.querySelectorAll('[data-field]')) {
      const val = s[el.dataset.field];
      el.textContent = typeof val === 'number' ? i18n.formatNumber(val) : '—';
    }

    byId('block-rate').textContent = i18n.formatPercent(s.block, s.allow + s.block);
    byId('prefix-rate').textContent = i18n.formatPercent(s.prefixHitTokens, s.inputTokens);

    renderOutcomesVisual(s);
    renderPrefixVisual(s);
    renderRules(s);
  }

  async function refresh() {
    clearTimeout(timer);
    if (!paired || expired || document.hidden || loading) return;
    loading = true;
    try {
      const res = await fetch('/v1/stats', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403) {
        expired = true;
        render();
        return;
      }
      if (!res.ok) throw new Error();
      latest = await res.json();
      connectionError = false;
      updated = new Date();
      render();
    } catch {
      connectionError = true;
      render();
    } finally {
      loading = false;
      if (!expired && !document.hidden) {
        timer = setTimeout(refresh, 5000);
      }
    }
  }

  period.addEventListener('change', render);
  document.addEventListener('visibilitychange', refresh);
  i18n.onChange(render);

  if (!paired) {
    renderFreshness();
  } else {
    void refresh();
  }
})();
