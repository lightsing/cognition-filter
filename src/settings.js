'use strict';

(() => {
  const i18n = window.cfI18n;
  const t = (key, params) => i18n.t(key, params);
  const byId = id => document.getElementById(id);

  const form = byId('settings');
  const meta = document.querySelector('meta[name="cf-token"]');
  const token = meta?.content || '';
  meta?.remove();
  const paired = Boolean(token && token !== '__PAIRING_TOKEN__');

  const schedule = ['modelConcurrency'];
  const modelName = /^[A-Za-z0-9_./:-]{1,160}$/u;

  let current = null;
  let busy = false;
  let dirty = false;
  let conflict = false;
  let lastErrorState = false;
  let statusState = { key: 'settings.status.connecting', params: undefined, tone: '' };

  const pluginRows = byId('plugin-rows');
  const scanButton = byId('plugin-scan');
  const pluginDrafts = new Map();
  let pluginBusy = false;
  let lastPluginInfo = null;
  let pluginStatusState = null;

  function hasDirtyPluginDrafts() {
    for (const draft of pluginDrafts.values()) {
      if (draft.dirty || draft.conflict) return true;
    }
    return false;
  }

  function syncNav() {
    const isPlugins = window.location.hash === '#plugins';
    const navSettings = byId('nav-settings');
    const navPlugins = byId('nav-plugins');
    if (navSettings && navPlugins) {
      if (isPlugins) {
        navSettings.removeAttribute('aria-current');
        navPlugins.setAttribute('aria-current', 'page');
      } else {
        navPlugins.removeAttribute('aria-current');
        navSettings.setAttribute('aria-current', 'page');
      }
    }
  }

  function updateBadge() {
    const badge = byId('draft-badge');
    if (!badge) return;
    let key = 'settings.badge.connecting';
    let tone = '';
    if (conflict) {
      key = 'settings.badge.conflict';
      tone = 'error';
    } else if (busy) {
      key = current ? 'settings.badge.saving' : 'settings.badge.connecting';
      tone = 'accent';
    } else if (!paired || (!current && lastErrorState)) {
      key = 'settings.badge.error';
      tone = 'error';
    } else if (dirty) {
      key = 'settings.badge.unsaved';
      tone = 'warning';
    } else if (current) {
      key = 'settings.badge.synced';
      tone = 'success';
    }
    badge.textContent = t(key);
    badge.dataset.tone = tone;
  }

  function renderStatus() {
    const el = byId('status');
    el.textContent = statusState.raw != null
      ? statusState.raw
      : t(statusState.key, statusState.params);
    el.dataset.tone = statusState.tone || '';
    const footer = byId('form-footer');
    if (footer) {
      footer.dataset.conflict = conflict ? 'true' : 'false';
    }
    updateBadge();
  }

  function say(key, tone = '', params = undefined) {
    statusState = { key, params, tone };
    renderStatus();
  }

  function controls() {
    byId('fields').disabled = busy || !current;
    byId('reload').disabled = busy || !paired;
    byId('save').disabled = busy || !current || !dirty || conflict;
    if (scanButton) {
      scanButton.disabled = pluginBusy || !paired;
    }
    updateBadge();
  }

  function origin(value) {
    try { return new URL(value).origin; } catch { return ''; }
  }

  function keyHint() {
    const hint = byId('key-hint');
    const apiKeyInput = byId('apiKey');
    if (!current) {
      hint.textContent = t('settings.connection.apiKeyLoading');
      apiKeyInput.placeholder = '';
      return;
    }
    const target = origin(byId('apiBase').value);
    if (current.hasApiKey && target && target !== origin(current.apiBase)) {
      hint.textContent = t('settings.keyHint.originChanged');
      apiKeyInput.placeholder = t('settings.connection.apiKeyPlaceholderNew');
    } else if (current.hasApiKey) {
      hint.textContent = t('settings.keyHint.configured');
      apiKeyInput.placeholder = t('settings.connection.apiKeyPlaceholderKeep');
    } else {
      hint.textContent = t('settings.keyHint.unset');
      apiKeyInput.placeholder = t('settings.connection.apiKeyPlaceholderNew');
    }
  }

  function updateProvidersEmpty() {
    const empty = byId('providers-empty');
    if (empty) {
      empty.hidden = byId('providers').childElementCount > 0;
    }
  }

  function markDirty() {
    dirty = true;
    lastErrorState = false;
    if (!conflict) say('settings.status.dirty', 'warning');
    keyHint();
    controls();
  }

  function updateRowRemoveLabel(row) {
    const [keyInput] = row.querySelectorAll('input');
    const removeBtn = row.querySelector('button');
    if (!removeBtn) return;
    const name = keyInput?.value.trim() || t('settings.limits.modelLabel');
    removeBtn.setAttribute('aria-label', t('settings.limits.removeAria', { name }));
  }

  function providerRow(name = '', limit = 1) {
    const row = document.createElement('div');
    row.className = 'provider-row';

    const makeField = (labelKey, type, value) => {
      const el = document.createElement('label');
      const caption = document.createElement('span');
      caption.dataset.i18n = labelKey;
      caption.textContent = t(labelKey);
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      input.required = true;
      el.append(caption, input);
      row.append(el);
      return input;
    };

    const key = makeField('settings.limits.modelLabel', 'text', name);
    key.maxLength = 160;
    key.spellcheck = false;
    key.addEventListener('input', () => updateRowRemoveLabel(row));

    const max = makeField('settings.limits.capLabel', 'number', String(limit));
    max.min = '1';
    max.max = '2500';
    max.step = '1';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.dataset.i18n = 'settings.limits.remove';
    remove.textContent = t('settings.limits.remove');
    remove.addEventListener('click', () => {
      row.remove();
      updateProvidersEmpty();
      clearErrors();
      markDirty();
    });
    row.append(remove);

    updateRowRemoveLabel(row);
    byId('providers').append(row);
    updateProvidersEmpty();
    return key;
  }

  async function request(method, data, path = '/v1/config') {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      // A save waits for requests using the old provider to finish before switching.
      signal: method === 'GET' ? AbortSignal.timeout(15000) : undefined,
      headers: {
        Authorization: 'Bearer ' + token,
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    let body;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok || !body) {
      const error = new Error(t('settings.error.invalidResponse'));
      error.i18nKey = 'settings.error.invalidResponse';
      error.status = response.status;
      if ([400, 422].includes(response.status) && typeof body?.message === 'string') {
        const secret = byId('apiKey').value;
        const message = secret ? body.message.split(secret).join('…') : body.message;
        error.rawMessage = message.slice(0, 200);
        error.message = error.rawMessage;
      }
      throw error;
    }
    return body;
  }

  function explainState(error) {
    if (error.status === 401 || error.status === 403) {
      return { key: 'settings.error.unauthorized' };
    }
    if (error.status === 409) {
      return { key: 'settings.error.conflict' };
    }
    if (error.status === 400) {
      return {
        key: 'settings.error.saveRejected',
        params: { message: error.rawMessage || error.message },
      };
    }
    if (error.status) {
      return { key: 'settings.error.http', params: { status: error.status } };
    }
    if (error.i18nKey) {
      return { key: error.i18nKey };
    }
    return { key: 'settings.error.unreachable' };
  }

  async function read() {
    const config = await request('GET');
    if (
      !config.revision ||
      typeof config.model !== 'string' ||
      typeof config.apiBase !== 'string' ||
      typeof config.hasApiKey !== 'boolean' ||
      !config.providerLimits ||
      Array.isArray(config.providerLimits) ||
      typeof config.providerLimits !== 'object' ||
      !schedule.every(key => Number.isInteger(config[key]))
    ) {
      const err = new Error(t('settings.error.incompleteConfig'));
      err.i18nKey = 'settings.error.incompleteConfig';
      throw err;
    }
    current = config;
    for (const key of ['model', 'apiBase', ...schedule]) {
      byId(key).value = String(config[key]);
    }
    byId('apiKey').value = '';
    byId('providers').replaceChildren();
    for (const [name, count] of Object.entries(config.providerLimits)) {
      providerRow(name, count);
    }
    updateProvidersEmpty();
    dirty = false;
    conflict = false;
    lastErrorState = false;
    clearErrors();
    keyHint();
  }

  async function reload() {
    if (busy || !paired || (dirty && !window.confirm(t('settings.confirmReload')))) return;
    busy = true;
    lastErrorState = false;
    controls();
    say('settings.status.reloading');
    try {
      await read();
      say('settings.status.loaded');
    } catch (error) {
      lastErrorState = true;
      if (error.status === 401 || error.status === 403) current = null;
      const explained = explainState(error);
      say(explained.key, 'error', explained.params);
    } finally {
      busy = false;
      controls();
    }
  }

  function clearErrors() {
    for (const field of form.querySelectorAll('input')) {
      field.setCustomValidity('');
      field.removeAttribute('aria-invalid');
      delete field.dataset.validationKey;
    }
  }

  function invalidate(field, key) {
    field.dataset.validationKey = key;
    field.setCustomValidity(t(key));
    field.setAttribute('aria-invalid', 'true');
  }

  function changes() {
    clearErrors();
    const model = byId('model').value.trim();
    const apiBase = byId('apiBase').value.trim();
    const apiKey = byId('apiKey').value.trim();

    if (!modelName.test(model)) {
      invalidate(byId('model'), 'settings.validation.model');
    }

    try {
      const url = new URL(apiBase);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (
        !(url.protocol === 'https:' || (local && url.protocol === 'http:')) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      ) {
        throw new Error();
      }
      if (current.hasApiKey && url.origin !== origin(current.apiBase) && !apiKey) {
        invalidate(byId('apiKey'), 'settings.validation.apiKeyOrigin');
      }
    } catch {
      invalidate(byId('apiBase'), 'settings.validation.apiBase');
    }

    const limits = new Map();
    for (const row of byId('providers').children) {
      const [name, limit] = row.querySelectorAll('input');
      const key = name.value.trim();
      if (!modelName.test(key)) {
        invalidate(name, 'settings.validation.model');
      }
      if (limits.has(key)) {
        invalidate(name, 'settings.validation.duplicateModel');
      }
      limits.set(key, limit.valueAsNumber);
    }

    if (!form.reportValidity()) return null;

    const payload = {
      revision: current.revision,
      model,
      apiBase,
      providerLimits: Object.fromEntries(limits),
    };
    for (const key of schedule) payload[key] = byId(key).valueAsNumber;
    if (apiKey) payload.apiKey = apiKey;
    return payload;
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !current || conflict || !dirty) return;
    const payload = changes();
    if (!payload) return;

    busy = true;
    lastErrorState = false;
    controls();
    say('settings.status.saving');

    let saved = false;
    try {
      const result = await request('PUT', payload);
      if (result.saved !== true) {
        const err = new Error(t('settings.error.saveUnconfirmed'));
        err.i18nKey = 'settings.error.saveUnconfirmed';
        throw err;
      }
      saved = true;
      dirty = false;
      byId('apiKey').value = '';
      await read();
      say('settings.status.saved', 'success');
    } catch (error) {
      if (saved) {
        current = null;
        say('settings.status.savedReloadNeeded', 'success');
      } else {
        lastErrorState = true;
        if (error.status === 401 || error.status === 403) current = null;
        if (error.status === 409) conflict = true;
        const explained = explainState(error);
        say(explained.key, 'error', explained.params);
      }
    } finally {
      busy = false;
      controls();
    }
  }

  function renderPluginStatus() {
    const status = byId('plugin-status');
    if (!status) return;
    if (!pluginStatusState) {
      status.textContent = '';
      status.dataset.tone = '';
      return;
    }
    status.textContent = pluginStatusState.raw != null
      ? pluginStatusState.raw
      : t(pluginStatusState.key, pluginStatusState.params);
    status.dataset.tone = pluginStatusState.tone || '';
  }

  function setPluginStatus(state) {
    pluginStatusState = state;
    renderPluginStatus();
  }

  function updatePluginButtons() {
    if (scanButton) {
      scanButton.disabled = pluginBusy || !paired;
    }
    if (pluginRows) {
      for (const input of pluginRows.querySelectorAll('input')) input.disabled = pluginBusy || !paired;
      for (const button of pluginRows.querySelectorAll('button')) {
        button.disabled = pluginBusy || !paired || button.dataset.conflictDisabled === 'true';
      }
    }
  }

  function showPlugins(info) {
    lastPluginInfo = info;
    const rows = document.createDocumentFragment();
    const plugins = Array.isArray(info.plugins) ? info.plugins : [];
    const errors = Array.isArray(info.errors) ? info.errors : [];

    for (const plugin of plugins) {
      const row = document.createElement('div');
      row.className = 'plugin-row';

      const details = document.createElement('div');
      details.className = 'plugin-meta';

      const titleRow = document.createElement('div');
      titleRow.className = 'plugin-title-row';

      const name = document.createElement('strong');
      name.textContent = plugin.name;

      const badge = document.createElement('span');
      badge.className = 'plugin-pill';
      badge.dataset.enabled = plugin.enabled ? 'true' : 'false';
      badge.textContent = t(plugin.enabled ? 'plugins.enabled' : 'plugins.disabled');

      titleRow.append(name, badge);

      const sub = document.createElement('span');
      sub.className = 'plugin-sub';
      sub.textContent = t('plugins.versions', { dll: plugin.version, script: plugin.scriptVersion || plugin.version }) + ' · ' + plugin.file;

      details.append(titleRow, sub);

      const actions = document.createElement('div');
      actions.className = 'plugin-actions';
      const id = encodeURIComponent(plugin.id);

      if (plugin.enabled) {
        const link = document.createElement('a');
        link.className = 'btn-link';
        link.href = '/plugins/' + id + '/cognition-filter.user.js';
        link.textContent = t('plugins.installScript');
        actions.append(link);
      }

      const addButton = (labelKey, run) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        const label = t(labelKey);
        button.textContent = label;
        button.setAttribute('aria-label', label + ' ' + plugin.name);
        button.disabled = pluginBusy || !paired;
        button.addEventListener('click', run);
        actions.append(button);
      };

      addButton(
        plugin.enabled ? 'plugins.disable' : 'plugins.enable',
        () => manage(
          'PUT',
          '/' + id + '/enabled',
          { enabled: !plugin.enabled },
          {
            key: plugin.enabled ? 'plugins.toggledDisabled' : 'plugins.toggledEnabled',
            params: { name: plugin.name },
            tone: 'success',
          }
        )
      );

      addButton(
        'plugins.reload',
        () => manage(
          'POST',
          '/' + id + '/reload',
          undefined,
          {
            key: 'plugins.reloaded',
            params: { name: plugin.name },
            tone: 'success',
          }
        )
      );

      row.append(details, actions);
      if (typeof plugin.autoNotInterested === 'boolean') {
        const label = document.createElement('label');
        label.className = 'rule-toggle';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.checked = plugin.autoNotInterested;
        toggle.dataset.pluginAction = 'not-interested';
        toggle.addEventListener('change', () => {
          const enabled = toggle.checked;
          toggle.checked = plugin.autoNotInterested;
          void manage('PUT', '/' + id + '/not-interested', { enabled }, {
            key: enabled ? 'plugins.interestOn' : 'plugins.interestOff', params: { name: plugin.name }, tone: 'success',
          });
        });
        label.append(toggle, document.createTextNode(t('plugins.autoInterest')));
        row.append(label);
      }

      if (plugin.scheduling && typeof plugin.scheduling === 'object') {
        const serverCover = plugin.scheduling.coverConcurrency != null ? String(plugin.scheduling.coverConcurrency) : '';
        const serverBrowser = plugin.scheduling.browserConcurrency != null ? String(plugin.scheduling.browserConcurrency) : '';
        const draft = pluginDrafts.get(plugin.id);
        if (draft && draft.revision !== plugin.scheduleRevision) draft.conflict = true;
        const isConflict = Boolean(draft?.conflict);
        const isDirty = Boolean(draft?.dirty);

        const sched = document.createElement('div');
        sched.className = 'plugin-scheduling';

        const schedHead = document.createElement('div');
        schedHead.className = 'plugin-scheduling-head';

        const schedTitle = document.createElement('span');
        schedTitle.className = 'plugin-scheduling-title';
        schedTitle.textContent = t('plugins.scheduling.title');
        schedHead.append(schedTitle);

        const draftPill = document.createElement('span');
        draftPill.className = 'plugin-pill plugin-scheduling-badge';
        const updateDraftPill = (dirtyNow, conflictNow) => {
          if (conflictNow) {
            draftPill.hidden = false;
            draftPill.dataset.tone = 'error';
            draftPill.textContent = t('settings.badge.conflict');
          } else if (dirtyNow) {
            draftPill.hidden = false;
            draftPill.dataset.tone = 'warning';
            draftPill.textContent = t('plugins.scheduling.unsaved');
          } else {
            draftPill.hidden = true;
            draftPill.dataset.tone = '';
            draftPill.textContent = '';
          }
        };
        updateDraftPill(isDirty, isConflict);
        schedHead.append(draftPill);

        const controlsWrap = document.createElement('div');
        controlsWrap.className = 'plugin-scheduling-controls';

        const makeSchedInput = (labelKey, min, max, val) => {
          const field = document.createElement('label');
          field.className = 'plugin-scheduling-field';
          const caption = document.createElement('span');
          caption.textContent = t(labelKey);
          const input = document.createElement('input');
          input.type = 'number';
          input.disabled = pluginBusy || !paired;
          input.min = String(min);
          input.max = String(max);
          input.step = '1';
          input.required = true;
          input.value = val;
          input.setAttribute('aria-label', t(labelKey) + ' · ' + plugin.name);
          field.append(caption, input);
          controlsWrap.append(field);
          return input;
        };

        const coverInput = makeSchedInput(
          'plugins.scheduling.coverLabel',
          1,
          256,
          draft ? draft.cover : serverCover
        );
        coverInput.dataset.schedField = 'cover';

        const browserInput = makeSchedInput(
          'plugins.scheduling.browserLabel',
          1,
          32,
          draft ? draft.browser : serverBrowser
        );
        browserInput.dataset.schedField = 'browser';

        const schedActions = document.createElement('div');
        schedActions.className = 'plugin-scheduling-actions';

        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'secondary';
        saveBtn.dataset.pluginAction = 'save-scheduling';
        saveBtn.textContent = t('plugins.scheduling.save');
        saveBtn.setAttribute('aria-label', t('plugins.scheduling.save') + ' ' + plugin.name);
        if (isConflict) saveBtn.dataset.conflictDisabled = 'true';
        saveBtn.disabled = pluginBusy || !paired || isConflict;
        saveBtn.addEventListener('click', () => {
          void savePluginScheduling(plugin, coverInput, browserInput, false);
        });

        const defaultsBtn = document.createElement('button');
        defaultsBtn.type = 'button';
        defaultsBtn.className = 'secondary';
        defaultsBtn.dataset.pluginAction = 'reset-scheduling';
        defaultsBtn.textContent = t('plugins.scheduling.useDefaults');
        defaultsBtn.setAttribute('aria-label', t('plugins.scheduling.useDefaults') + ' ' + plugin.name);
        if (isConflict) defaultsBtn.dataset.conflictDisabled = 'true';
        defaultsBtn.disabled = pluginBusy || !paired || isConflict;
        defaultsBtn.addEventListener('click', () => {
          void savePluginScheduling(plugin, coverInput, browserInput, true);
        });

        const discardBtn = document.createElement('button');
        discardBtn.type = 'button';
        discardBtn.className = 'secondary';
        discardBtn.dataset.pluginAction = isConflict ? 'discard-reload-scheduling' : 'discard-scheduling';
        const discardLabel = t(isConflict ? 'plugins.scheduling.discardReload' : 'plugins.scheduling.discard');
        discardBtn.textContent = discardLabel;
        discardBtn.setAttribute('aria-label', discardLabel + ' ' + plugin.name);
        discardBtn.hidden = !isConflict && !isDirty;
        discardBtn.disabled = pluginBusy || !paired;
        discardBtn.addEventListener('click', () => {
          if (pluginBusy || !paired) return;
          const hadConflict = Boolean(pluginDrafts.get(plugin.id)?.conflict);
          pluginDrafts.delete(plugin.id);
          if (hadConflict) {
            void manage('GET', '', undefined, {
              key: 'plugins.scheduling.reloaded',
              params: { name: plugin.name },
              tone: 'success',
            });
          } else if (lastPluginInfo) {
            showPlugins(lastPluginInfo);
          }
        });

        const onSchedInput = () => {
          coverInput.setCustomValidity('');
          coverInput.removeAttribute('aria-invalid');
          delete coverInput.dataset.validationKey;
          browserInput.setCustomValidity('');
          browserInput.removeAttribute('aria-invalid');
          delete browserInput.dataset.validationKey;

          const existing = pluginDrafts.get(plugin.id);
          const conflictNow = Boolean(existing?.conflict);
          const dirtyNow = coverInput.value !== serverCover || browserInput.value !== serverBrowser;
          if (!dirtyNow && !conflictNow) {
            pluginDrafts.delete(plugin.id);
          } else {
            pluginDrafts.set(plugin.id, {
              revision: existing?.revision || plugin.scheduleRevision,
              cover: coverInput.value,
              browser: browserInput.value,
              dirty: dirtyNow,
              conflict: conflictNow,
            });
          }
          updateDraftPill(dirtyNow, conflictNow);
          discardBtn.hidden = !conflictNow && !dirtyNow;
        };

        coverInput.addEventListener('input', onSchedInput);
        browserInput.addEventListener('input', onSchedInput);

        schedActions.append(saveBtn, defaultsBtn, discardBtn);
        controlsWrap.append(schedActions);
        sched.append(schedHead, controlsWrap);

        if (isConflict) {
          const conflictNote = document.createElement('p');
          conflictNote.className = 'plugin-scheduling-conflict';
          conflictNote.setAttribute('role', 'alert');
          conflictNote.textContent = t('plugins.scheduling.conflict');
          sched.append(conflictNote);
        }

        row.append(sched);
      }

      rows.append(row);
    }

    if (!plugins.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-note';
      empty.textContent = t('plugins.empty');
      rows.append(empty);
    }

    for (const error of errors) {
      const line = document.createElement('p');
      line.className = 'plugin-error';
      line.textContent = error;
      rows.append(line);
    }

    pluginRows.replaceChildren(rows);
  }

  async function savePluginScheduling(plugin, coverInput, browserInput, useDefaults) {
    if (pluginBusy || !paired) return;

    let scheduling = null;
    if (!useDefaults) {
      coverInput.setCustomValidity('');
      coverInput.removeAttribute('aria-invalid');
      delete coverInput.dataset.validationKey;
      browserInput.setCustomValidity('');
      browserInput.removeAttribute('aria-invalid');
      delete browserInput.dataset.validationKey;

      const cover = coverInput.valueAsNumber;
      const browser = browserInput.valueAsNumber;
      if (!Number.isInteger(cover) || cover < 1 || cover > 256) {
        invalidate(coverInput, 'plugins.scheduling.validationCover');
      }
      if (!Number.isInteger(browser) || browser < 1 || browser > 32) {
        invalidate(browserInput, 'plugins.scheduling.validationBrowser');
      }
      if (!coverInput.reportValidity() || !browserInput.reportValidity()) {
        return;
      }
      scheduling = { coverConcurrency: cover, browserConcurrency: browser };
    }

    pluginBusy = true;
    updatePluginButtons();
    setPluginStatus({ key: 'plugins.loading', tone: '' });

    try {
      const id = encodeURIComponent(plugin.id);
      const info = await request(
        'PUT',
        { revision: plugin.scheduleRevision, scheduling },
        '/v1/plugins/' + id + '/scheduling'
      );
      pluginDrafts.delete(plugin.id);
      showPlugins(info);
      setPluginStatus({
        key: useDefaults ? 'plugins.scheduling.reset' : 'plugins.scheduling.saved',
        params: { name: plugin.name },
        tone: 'success',
      });
    } catch (error) {
      if (error.status === 409) {
        pluginDrafts.set(plugin.id, {
          revision: plugin.scheduleRevision,
          cover: coverInput.value,
          browser: browserInput.value,
          dirty: true,
          conflict: true,
        });
        if (lastPluginInfo) {
          showPlugins(lastPluginInfo);
        }
        setPluginStatus({ key: 'plugins.scheduling.conflict', tone: 'error' });
      } else if ((error.status === 400 || error.status === 422) && (error.rawMessage || error.message)) {
        setPluginStatus({ raw: error.rawMessage || error.message, tone: 'error' });
      } else {
        const explained = explainState(error);
        setPluginStatus({ key: explained.key, params: explained.params, tone: 'error' });
      }
    } finally {
      pluginBusy = false;
      updatePluginButtons();
    }
  }

  async function manage(method, suffix, data, doneState) {
    if (pluginBusy || !paired) return;
    pluginBusy = true;
    updatePluginButtons();
    setPluginStatus({ key: 'plugins.loading', tone: '' });

    try {
      const info = await request(method, data, '/v1/plugins' + suffix);
      showPlugins(info);
      setPluginStatus(doneState || null);
    } catch (error) {
      if (error.status === 422 && (error.rawMessage || error.message)) {
        setPluginStatus({ raw: error.rawMessage || error.message, tone: 'error' });
      } else {
        const explained = explainState(error);
        setPluginStatus({ key: explained.key, params: explained.params, tone: 'error' });
      }
    } finally {
      pluginBusy = false;
      updatePluginButtons();
    }
  }

  scanButton.addEventListener('click', () => {
    void manage('POST', '/scan', undefined, { key: 'plugins.scanned', tone: 'success' });
  });

  form.addEventListener('submit', save);
  form.addEventListener('input', () => {
    clearErrors();
    markDirty();
  });

  byId('add-provider').addEventListener('click', () => {
    providerRow('', Number(byId('modelConcurrency').value) || 1).focus();
    markDirty();
  });

  byId('reload').addEventListener('click', reload);

  window.addEventListener('beforeunload', event => {
    if (dirty || hasDirtyPluginDrafts()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('hashchange', () => {
    syncNav();
    if (window.location.hash === '#plugins') {
      byId('plugins')?.focus({ preventScroll: true });
    }
  });

  i18n.onChange(() => {
    for (const field of form.querySelectorAll('[data-validation-key]')) {
      field.setCustomValidity(t(field.dataset.validationKey));
    }
    keyHint();
    renderStatus();
    for (const row of byId('providers').children) {
      updateRowRemoveLabel(row);
    }
    if (lastPluginInfo) {
      showPlugins(lastPluginInfo);
    }
    renderPluginStatus();
  });

  syncNav();
  updateProvidersEmpty();

  if (!paired) {
    say('settings.status.unpaired', 'error');
    controls();
  } else {
    void manage('GET', '', undefined, null);
    void reload();
  }
})();
