function createCognitionClient({ getToken = () => GM_getValue('pairToken', ''),
  generation = () => 0, current = () => true, currentPage = () => !document.hidden } = {}) {
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
            if (currentPage()) window.alert(error.message);
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
    if (window.confirm('Cognition Filter 有新版油猴脚本（' + installed + ' → ' + latest +
        '）。现在打开更新页吗？请在油猴中确认更新，再刷新当前页面。')) {
      const agent = await agentFor(secret);
      if (getToken() === secret && currentPage()) GM_openInTab('http://127.0.0.1:' + agent.port + updatePath, {active:true});
    }
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
    pair, review, rulesPageUrl, offerPairing,
    rules: () => request('/rules'),
    saveRules: (groups, revision) => request('/rules', 'PUT', { groups, revision }),
    report: (card, revision, stillValid, retrying) => request('/feedback', 'POST', { card, revision }, stillValid, retrying),
    pick: (body, stillValid, retrying) => request('/pick', 'POST', body, stillValid, retrying),
  };
}
