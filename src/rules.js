'use strict';

(() => {
  const i18n = window.cfI18n;
  const t = (key, params) => i18n.t(key, params);
  const byId = id => document.getElementById(id);

  const form = byId('rules-form');
  const groupsList = byId('groups-list');
  const groupsEmpty = byId('groups-empty');
  const groupCount = byId('group-count');
  const addGroupBtn = byId('add-group');

  const meta = document.querySelector('meta[name="cf-token"]');
  const token = meta?.content || '';
  meta?.remove();
  const paired = Boolean(token && token !== '__PAIRING_TOKEN__');

  const MAX_GROUPS = 24;
  const MIN_INCLUDE = 1;
  const MAX_POINTS = 8;
  const MAX_NAME_LEN = 60;
  const pointLimit = group => group.id.startsWith('legacy-') ? 280 : 160;
  const MAX_ID_LEN = 80;

  let loaded = false;
  let revision = '';
  let draftGroups = [];
  let sites = {};
  let busy = false;
  let dirty = false;
  let conflict = false;
  let lastErrorState = false;
  let statusState = { key: 'rules.status.connecting', params: undefined, tone: '' };

  function createUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function updateBadge() {
    const badge = byId('draft-badge');
    if (!badge) return;
    let key = 'rules.badge.connecting';
    let tone = '';
    if (conflict) {
      key = 'rules.badge.conflict';
      tone = 'error';
    } else if (busy) {
      key = loaded ? 'rules.badge.saving' : 'rules.badge.connecting';
      tone = 'accent';
    } else if (!paired || (!loaded && lastErrorState)) {
      key = 'rules.badge.error';
      tone = 'error';
    } else if (dirty) {
      key = 'rules.badge.unsaved';
      tone = 'warning';
    } else if (loaded) {
      key = 'rules.badge.synced';
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

  function sayRaw(raw, tone = '') {
    statusState = { raw, tone };
    renderStatus();
  }

  function controls() {
    byId('fields').disabled = busy || !loaded;
    addGroupBtn.disabled = busy || !loaded || draftGroups.length >= MAX_GROUPS;
    byId('reload').disabled = busy || !paired;
    byId('save').disabled = busy || !loaded || !dirty || conflict;
    if (groupCount) {
      groupCount.textContent = t('rules.groups.count', { count: draftGroups.length });
    }
    if (groupsEmpty) {
      groupsEmpty.hidden = draftGroups.length > 0;
    }
    updateBadge();
  }

  function markDirty() {
    dirty = true;
    lastErrorState = false;
    if (!conflict) say('rules.status.dirty', 'warning');
    controls();
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

  function groupDisplayName(group) {
    return group.name.trim() || t('rules.group.defaultName');
  }

  function updateCardTexts(card, group, groupIndex) {
    const nameLabel = groupDisplayName(group);
    card.setAttribute('aria-label', t('rules.group.ariaLabel', { index: groupIndex + 1, name: nameLabel }));
    card.querySelector('.rule-scope-caption').textContent = t('rules.group.scope');
    card.querySelector('.rule-scope option').textContent = t('rules.group.global');

    const enabledCheckbox = card.querySelector('.rule-group-enabled');
    if (enabledCheckbox) {
      enabledCheckbox.setAttribute('aria-label', t('rules.group.enabledAria', { name: nameLabel }));
    }
    const enabledText = card.querySelector('.rule-group-enabled-text');
    if (enabledText) {
      enabledText.textContent = t('rules.group.enabled');
    }

    const nameCaption = card.querySelector('.rule-group-name-label');
    if (nameCaption) {
      nameCaption.textContent = t('rules.group.nameLabel');
    }
    const nameInput = card.querySelector('.rule-group-name-input');
    if (nameInput) {
      nameInput.placeholder = t('rules.group.namePlaceholder');
      nameInput.setAttribute('aria-label', t('rules.group.nameLabel'));
    }

    const removeGroupBtn = card.querySelector('.rule-remove-group');
    if (removeGroupBtn) {
      removeGroupBtn.textContent = t('rules.group.remove');
      removeGroupBtn.setAttribute('aria-label', t('rules.group.removeAria', { name: nameLabel }));
    }

    for (const kind of ['include', 'exclude']) {
      const col = card.querySelector(`.rule-points-col[data-kind="${kind}"]`);
      if (!col) continue;
      const points = group[kind];
      const kindLabel = t(kind === 'include' ? 'rules.point.kindInclude' : 'rules.point.kindExclude');

      const titleEl = col.querySelector('.rule-points-heading');
      if (titleEl) titleEl.textContent = t(`rules.${kind}.title`);

      const countEl = col.querySelector('.rule-points-count');
      if (countEl) countEl.textContent = `${points.length}/${MAX_POINTS}`;

      const addBtn = col.querySelector('.rule-add-point');
      if (addBtn) {
        addBtn.textContent = t(`rules.${kind}.add`);
        addBtn.setAttribute('aria-label', t(`rules.${kind}.addAria`, { name: nameLabel }));
        addBtn.disabled = points.length >= MAX_POINTS;
      }

      const emptyEl = col.querySelector('.rule-points-empty');
      if (emptyEl) {
        emptyEl.textContent = t(`rules.${kind}.empty`);
        emptyEl.hidden = points.length > 0;
      }

      const rows = col.querySelectorAll('.rule-point-row');
      rows.forEach((row, idx) => {
        const pt = points[idx];
        if (!pt) return;
        const ptCheckbox = row.querySelector('.rule-point-enabled');
        const ptInput = row.querySelector('.rule-point-input');
        const ptRemove = row.querySelector('.rule-remove-point');
        const ptText = pt.text.trim() || String(idx + 1);

        if (ptCheckbox) {
          ptCheckbox.setAttribute('aria-label', t('rules.point.enabledAria', {
            index: idx + 1,
            kind: kindLabel,
            text: ptText,
          }));
        }
        if (ptInput) {
          ptInput.placeholder = t(`rules.${kind}.placeholder`);
          ptInput.setAttribute('aria-label', t('rules.point.textAria', {
            kind: kindLabel,
            index: idx + 1,
          }));
        }
        if (ptRemove) {
          ptRemove.textContent = t('rules.point.remove');
          ptRemove.setAttribute('aria-label', t('rules.point.removeAria', {
            kind: kindLabel,
            index: idx + 1,
          }));
          ptRemove.disabled = kind === 'include' && points.length <= MIN_INCLUDE;
        }
      });
    }
  }

  function createPointRow(group, groupIndex, kind, pointIndex, card) {
    const points = group[kind];
    const point = points[pointIndex];

    const row = document.createElement('div');
    row.className = 'rule-point-row';

    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'rule-point-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'rule-point-enabled';
    checkbox.checked = Boolean(point.enabled);
    checkbox.addEventListener('change', () => {
      point.enabled = checkbox.checked;
      markDirty();
    });
    toggleLabel.append(checkbox);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'rule-point-input';
    // The agent counts Unicode code points, including supplementary characters.
    input.required = true;
    input.value = point.text;
    input.addEventListener('input', () => {
      point.text = input.value;
      clearErrors();
      updateCardTexts(card, group, groupIndex);
      markDirty();
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'secondary rule-remove-point';
    removeBtn.addEventListener('click', () => {
      if (kind === 'include' && points.length <= MIN_INCLUDE) return;
      const idx = points.indexOf(point);
      if (idx !== -1) points.splice(idx, 1);
      renderPointsColumn(card, group, groupIndex, kind);
      clearErrors();
      markDirty();
    });

    row.append(toggleLabel, input, removeBtn);
    return row;
  }

  function renderPointsColumn(card, group, groupIndex, kind) {
    const col = card.querySelector(`.rule-points-col[data-kind="${kind}"]`);
    if (!col) return;
    const list = col.querySelector('.rule-points-list');
    list.replaceChildren();
    group[kind].forEach((_, idx) => {
      list.append(createPointRow(group, groupIndex, kind, idx, card));
    });
    updateCardTexts(card, group, groupIndex);
  }

  function buildPointsColumn(card, group, groupIndex, kind) {
    const col = document.createElement('div');
    col.className = 'rule-points-col';
    col.dataset.kind = kind;

    const head = document.createElement('div');
    head.className = 'rule-points-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'rule-points-title';
    const heading = document.createElement('h3');
    heading.className = 'rule-points-heading';
    const count = document.createElement('span');
    count.className = 'rule-points-count';
    titleWrap.append(heading, count);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'secondary rule-add-point';
    addBtn.addEventListener('click', () => {
      if (group[kind].length >= MAX_POINTS) return;
      group[kind].push({ text: '', enabled: true });
      renderPointsColumn(card, group, groupIndex, kind);
      clearErrors();
      markDirty();
      const inputs = col.querySelectorAll('.rule-point-input');
      inputs[inputs.length - 1]?.focus();
    });

    head.append(titleWrap, addBtn);

    const list = document.createElement('div');
    list.className = 'rule-points-list';

    const empty = document.createElement('p');
    empty.className = 'empty-note rule-points-empty';

    col.append(head, list, empty);
    return col;
  }

  function createGroupCard(group, groupIndex) {
    const card = document.createElement('section');
    card.className = 'rule-group-card';
    card.dataset.groupId = group.id;

    const head = document.createElement('div');
    head.className = 'rule-group-head';

    const toggle = document.createElement('label');
    toggle.className = 'rule-toggle';
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.className = 'rule-group-enabled';
    enabledCheckbox.checked = Boolean(group.enabled);
    enabledCheckbox.addEventListener('change', () => {
      group.enabled = enabledCheckbox.checked;
      markDirty();
    });
    const enabledText = document.createElement('span');
    enabledText.className = 'rule-group-enabled-text';
    toggle.append(enabledCheckbox, enabledText);

    const nameLabel = document.createElement('label');
    nameLabel.className = 'rule-group-name';
    const nameCaption = document.createElement('span');
    nameCaption.className = 'sr-only rule-group-name-label';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'rule-group-name-input';

    nameInput.required = true;
    nameInput.value = group.name;
    nameInput.addEventListener('input', () => {
      group.name = nameInput.value;
      clearErrors();
      const idx = draftGroups.indexOf(group);
      updateCardTexts(card, group, idx === -1 ? groupIndex : idx);
      markDirty();
    });
    nameLabel.append(nameCaption, nameInput);

    const scopeLabel = document.createElement('label');
    scopeLabel.className = 'rule-scope-field';
    const caption = document.createElement('span');
    caption.className = 'rule-scope-caption';
    const scope = document.createElement('select');
    scope.className = 'rule-scope';
    scope.add(new Option(t('rules.group.global'), ''));
    const choices = new Map(Object.entries(sites));
    if (group.site && !choices.has(group.site)) choices.set(group.site, group.site);
    for (const [id, name] of choices) scope.add(new Option(name, id));
    scope.value = group.site || '';
    scope.addEventListener('change', () => {
      group.site = scope.value || null;
      markDirty();
    });
    scopeLabel.append(caption, scope);

    const removeGroupBtn = document.createElement('button');
    removeGroupBtn.type = 'button';
    removeGroupBtn.className = 'secondary rule-remove-group';
    removeGroupBtn.addEventListener('click', () => {
      const idx = draftGroups.indexOf(group);
      if (idx !== -1) draftGroups.splice(idx, 1);
      renderGroups();
      clearErrors();
      markDirty();
    });

    head.append(toggle, nameLabel, scopeLabel, removeGroupBtn);

    const grid = document.createElement('div');
    grid.className = 'rule-points-grid';
    const includeCol = buildPointsColumn(card, group, groupIndex, 'include');
    const excludeCol = buildPointsColumn(card, group, groupIndex, 'exclude');
    grid.append(includeCol, excludeCol);

    card.append(head, grid);
    renderPointsColumn(card, group, groupIndex, 'include');
    renderPointsColumn(card, group, groupIndex, 'exclude');
    updateCardTexts(card, group, groupIndex);
    return card;
  }

  function renderGroups() {
    const frag = document.createDocumentFragment();
    draftGroups.forEach((group, idx) => {
      frag.append(createGroupCard(group, idx));
    });
    groupsList.replaceChildren(frag);
    controls();
  }

  function updateAllGroupTexts() {
    Array.from(groupsList.children).forEach((card, idx) => {
      const group = draftGroups[idx];
      if (group) updateCardTexts(card, group, idx);
    });
    controls();
  }

  async function request(method, data, path = '/v1/admin/rules') {
    const response = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
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
      const error = new Error(t('rules.error.invalidResponse'));
      error.i18nKey = 'rules.error.invalidResponse';
      error.status = response.status;
      if ([400, 422].includes(response.status) && typeof body?.message === 'string') {
        error.rawMessage = body.message.slice(0, 200);
        error.message = error.rawMessage;
      }
      throw error;
    }
    return body;
  }

  function explainState(error) {
    if (error.status === 401 || error.status === 403) {
      return { key: 'rules.error.unauthorized' };
    }
    if (error.status === 409) {
      return { key: 'rules.error.conflict' };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        key: 'rules.error.saveRejected',
        params: { message: error.rawMessage || error.message },
      };
    }
    if (error.status) {
      return { key: 'rules.error.http', params: { status: error.status } };
    }
    if (error.i18nKey) {
      return { key: error.i18nKey };
    }
    return { key: 'rules.error.unreachable' };
  }

  function normalizeGroup(raw) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      raw.id.length === 0 ||
      raw.id.length > MAX_ID_LEN ||
      typeof raw.name !== 'string' ||
      typeof raw.enabled !== 'boolean' ||
      !Array.isArray(raw.include) ||
      !raw.include.every(x => typeof x === 'string')
    ) {
      return null;
    }

    const rawExclude = raw.exclude === undefined ? [] : raw.exclude;
    if (!Array.isArray(rawExclude) || !rawExclude.every(x => typeof x === 'string')) {
      return null;
    }

    const rawDisabledInc = raw.disabledInclude == null ? [] : raw.disabledInclude;
    const rawDisabledExc = raw.disabledExclude == null ? [] : raw.disabledExclude;
    if (
      !Array.isArray(rawDisabledInc) ||
      !rawDisabledInc.every(x => typeof x === 'string') ||
      !Array.isArray(rawDisabledExc) ||
      !rawDisabledExc.every(x => typeof x === 'string')
    ) {
      return null;
    }

    const disabledInc = new Set(rawDisabledInc);
    const disabledExc = new Set(rawDisabledExc);

    return {
      id: raw.id,
      site: raw.site ?? null,
      name: raw.name,
      enabled: raw.enabled,
      include: raw.include.map(text => ({ text, enabled: !disabledInc.has(text) })),
      exclude: rawExclude.map(text => ({ text, enabled: !disabledExc.has(text) })),
    };
  }

  function parseRulesPayload(payload) {
    if (
      !payload ||
      typeof payload !== 'object' ||
      typeof payload.revision !== 'string' ||
      !payload.revision ||
      !Array.isArray(payload.groups)
    ) {
      const err = new Error(t('rules.error.incompleteRules'));
      err.i18nKey = 'rules.error.incompleteRules';
      throw err;
    }
    const groups = [];
    for (const raw of payload.groups) {
      const normalized = normalizeGroup(raw);
      if (!normalized) {
        const err = new Error(t('rules.error.incompleteRules'));
        err.i18nKey = 'rules.error.incompleteRules';
        throw err;
      }
      groups.push(normalized);
    }
    return { groups, sites: payload.sites || {}, revision: payload.revision };
  }

  async function read() {
    const data = await request('GET');
    const parsed = parseRulesPayload(data);
    revision = parsed.revision;
    draftGroups = parsed.groups;
    sites = parsed.sites;
    loaded = true;
    dirty = false;
    conflict = false;
    lastErrorState = false;
    clearErrors();
    renderGroups();
  }

  async function reload() {
    if (busy || !paired || (dirty && !window.confirm(t('rules.confirmReload')))) return;
    busy = true;
    lastErrorState = false;
    controls();
    say('rules.status.reloading');
    try {
      await read();
      say('rules.status.loaded');
    } catch (error) {
      lastErrorState = true;
      if (error.status === 401 || error.status === 403) loaded = false;
      const explained = explainState(error);
      say(explained.key, 'error', explained.params);
    } finally {
      busy = false;
      controls();
    }
  }

  function validateAndBuildPayload() {
    clearErrors();

    if (draftGroups.length > MAX_GROUPS) {
      say('rules.validation.groupCount', 'error');
      return null;
    }

    const cards = Array.from(groupsList.children);
    let listErrorKey = '';

    draftGroups.forEach((group, idx) => {
      const card = cards[idx];
      if (!card) return;

      const nameInput = card.querySelector('.rule-group-name-input');
      const trimmedName = group.name.trim();
      if (!trimmedName || [...trimmedName].length > MAX_NAME_LEN) {
        invalidate(nameInput, 'rules.validation.groupName');
      }

      if (group.include.length < MIN_INCLUDE || group.include.length > MAX_POINTS) {
        if (!listErrorKey) listErrorKey = 'rules.validation.includeRange';
      }
      if (group.exclude.length > MAX_POINTS) {
        if (!listErrorKey) listErrorKey = 'rules.validation.excludeRange';
      }

      for (const kind of ['include', 'exclude']) {
        const col = card.querySelector(`.rule-points-col[data-kind="${kind}"]`);
        const inputs = col ? Array.from(col.querySelectorAll('.rule-point-input')) : [];
        const seen = new Set();

        group[kind].forEach((pt, ptIdx) => {
          const input = inputs[ptIdx];
          if (!input) return;
          const trimmedText = pt.text.trim();
          if (!trimmedText || [...trimmedText].length > pointLimit(group)) {
            invalidate(input, 'rules.validation.pointText');
            return;
          }
          if (seen.has(trimmedText)) {
            invalidate(input, 'rules.validation.duplicatePoint');
            return;
          }
          seen.add(trimmedText);
        });
      }
    });

    if (!form.reportValidity()) return null;
    if (listErrorKey) {
      say(listErrorKey, 'error');
      return null;
    }

    return {
      revision,
      groups: draftGroups.map(group => ({
        id: group.id,
        site: group.site,
        name: group.name.trim(),
        enabled: Boolean(group.enabled),
        include: group.include.map(pt => pt.text.trim()),
        exclude: group.exclude.map(pt => pt.text.trim()),
        disabledInclude: group.include.filter(pt => !pt.enabled).map(pt => pt.text.trim()),
        disabledExclude: group.exclude.filter(pt => !pt.enabled).map(pt => pt.text.trim()),
      })),
    };
  }

  async function save(event) {
    event.preventDefault();
    if (busy || !loaded || conflict || !dirty) return;
    const payload = validateAndBuildPayload();
    if (!payload) return;

    busy = true;
    lastErrorState = false;
    controls();
    say('rules.status.saving');

    try {
      const result = await request('PUT', payload);
      const parsed = parseRulesPayload(result);
      revision = parsed.revision;
      draftGroups = parsed.groups;
      sites = parsed.sites;
      dirty = false;
      conflict = false;
      renderGroups();
      say('rules.status.saved', 'success');
    } catch (error) {
      lastErrorState = true;
      if (error.status === 401 || error.status === 403) loaded = false;
      if (error.status === 409) conflict = true;
      const explained = explainState(error);
      if (explained.raw) {
        sayRaw(explained.raw, 'error');
      } else {
        say(explained.key, 'error', explained.params);
      }
    } finally {
      busy = false;
      controls();
    }
  }

  addGroupBtn.addEventListener('click', () => {
    if (busy || !loaded || draftGroups.length >= MAX_GROUPS) return;
    const newGroup = {
      id: createUuid(),
      site: null,
      name: '',
      enabled: true,
      include: [{ text: '', enabled: true }],
      exclude: [],
    };
    draftGroups.push(newGroup);
    renderGroups();
    clearErrors();
    markDirty();
    const lastCard = groupsList.lastElementChild;
    lastCard?.querySelector('.rule-group-name-input')?.focus();
  });

  form.addEventListener('submit', save);
  byId('reload').addEventListener('click', reload);

  window.addEventListener('beforeunload', event => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  i18n.onChange(() => {
    for (const field of form.querySelectorAll('[data-validation-key]')) {
      field.setCustomValidity(t(field.dataset.validationKey));
    }
    updateAllGroupTexts();
    renderStatus();
  });

  controls();

  if (!paired) {
    say('rules.status.unpaired', 'error');
    controls();
  } else {
    void reload();
  }
})();
