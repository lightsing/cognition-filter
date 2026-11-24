import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

const browser = [
  process.env.BROWSER_BIN,
  process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path));

// Shared Rust/JS discovery v1 wire vector: default, then all 32 LCG positions.
const ports = [17321, 56635, 62072, 64881, 59766, 59287, 56228, 50477, 62594, 56243, 52112,
  60585, 50254, 54671, 60988, 61413, 58586, 61739, 61352, 51937, 57894, 51847, 64468,
  63901, 51250, 64931, 65216, 63513, 58110, 59007, 58476, 49749, 65162];
const pairingToken = '00112233445566778899aabbccddeeff0011223344556677';
const mac = message => createHmac('sha256', pairingToken).update(message, 'utf8').digest('hex');

function setupFixture(fixture) {
  window.mock = { requests: [], feedback: [], picks: [], menus: [], menuNames: [], opened: [], listeners: {}, revision: 1, roots: [],
    storage: { pairToken: fixture.unpaired ? null : fixture.token }, installedPolicy: fixture.installedPolicy, proofs: {}, probes: [], api: [], protocolErrors: [], activeProbes: 0, maxActiveProbes: 0,
    livePort: fixture.livePort, ports: fixture.ports, responses: fixture.responses || {},
    groups: [{ id: 'politics', name: '政治', enabled: true, include: ['时政'], exclude: ['史料研究'] }] };
  mock.prompts = []; mock.confirms = []; mock.latest = fixture.available || fixture.version;
  window.prompt = message => { mock.prompts.push(message); return fixture.acceptPair ? fixture.token : null; };
  window.confirm = message => { mock.confirms.push(message); return fixture.acceptUpdate === true; };
  if (fixture.cachedPort) mock.storage.agentPort = fixture.cachedPort;
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = attach.call(this, init);
    mock.roots.push(root);
    return root;
  };
  window.GM_getValue = (key, fallback) => key in mock.storage ? mock.storage[key] : fallback;
  window.GM_setValue = (key, value) => { mock.storage[key] = value; };
  window.GM_addValueChangeListener = (key, fn) => { mock.listeners[key] = fn; };
  window.GM_registerMenuCommand = (label, fn) => { mock.menuNames.push(label); mock.menus.push(fn); };
  window.GM_openInTab = (url, options) => { mock.opened.push({ url, options }); };
  window.GM_addStyle = css => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
    return style;
  };
  window.GM_xmlhttpRequest = raw => {
    let aborted = false;
    const opts = { ...raw, onload: dto => { if (!aborted) raw.onload({ finalUrl: raw.url, ...dto }); } };
    const url = new URL(opts.url);
    const port = Number(url.port);
    const headers = new Headers(opts.headers);
    const reject = reason => {
      mock.protocolErrors.push(reason);
      queueMicrotask(() => opts.onerror?.({}));
    };
    if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !fixture.ports.includes(port) ||
        !opts.anonymous || opts.redirect !== 'error' || headers.get('X-Cognition-Filter-Version') !== fixture.version ||
        JSON.stringify([opts.url, opts.headers, opts.data]).includes(fixture.token)) {
      return reject('unsafe destination, credentials, redirects, or version on ' + url.pathname);
    }
    if (url.pathname === '/.well-known/cognition-filter') {
      const nonce = url.searchParams.get('nonce');
      if (opts.method !== 'GET' || headers.has('Authorization') || opts.data != null ||
          [...headers.keys()].some(k => !['x-cognition-filter-version', 'accept'].includes(k)) ||
          !/^[a-f0-9]{32}$/.test(nonce) || [...url.searchParams].length !== 1) {
        return reject('discovery sent credentials, content, or an invalid challenge');
      }
      const probe = { port, nonce };
      mock.probes.push(probe);
      mock.maxActiveProbes = Math.max(mock.maxActiveProbes, ++mock.activeProbes);
      void (async () => {
        try {
          if (fixture.probeDelay) await new Promise(done => setTimeout(done, fixture.probeDelay));
          if (aborted) return;
          const spoof = mock.responses[port];
          if (port !== mock.livePort && !spoof) { opts.onerror({}); return; }
          if (spoof === 'unrelated') { opts.onload({ status: 200, responseText: '<html>another local app</html>' }); return; }
          let proof = '0'.repeat(64);
          if (spoof === 'replay') proof = mock.proofs[port];
          if (port === mock.livePort || ['redirect', 'no-final-url', 'wrong-port'].includes(spoof)) {
            proof = await (await fetch('/fixture-proof?port=' + port + '&nonce=' + nonce)).text();
          }
          if (port === mock.livePort) mock.proofs[port] = proof;
          const dto = { service: 'cognition-filter', protocol: 1, port: spoof === 'wrong-port' ? 1 : port, proof };
          opts.onload({ status: 200, responseText: JSON.stringify(dto),
            ...(spoof === 'redirect' ? { finalUrl: 'http://127.0.0.1:1234/another-service' } : {}),
            ...(spoof === 'no-final-url' ? { finalUrl: undefined } : {}) });
        } finally { mock.activeProbes--; }
      })();
      return { abort: () => { aborted = true; } };
    }
    if (url.pathname === '/plugins/' + fixture.site + '/cognition-filter.user.js') {
      if (port !== mock.livePort || headers.has('Authorization')) return reject('invalid metadata request');
      opts.onload({status:200,responseText:'// ==UserScript==\n// @version      '+mock.latest+'\n// ==/UserScript=='});
      return {abort() {}};
    }
    mock.api.push({ port, path: url.pathname, method: opts.method });
    if (port !== mock.livePort || !url.pathname.startsWith('/v1/') ||
        headers.get('X-Cognition-Filter-Site') !== fixture.site || !mock.proofs[port] || headers.get('Authorization') !== 'CF-Port ' + fixture.portTags[port]) {
      return reject('API data or authentication sent to unverified port ' + port);
    }
    if (opts.url.endsWith('/classify')) {
      mock.requests.push({ ...opts, cards: JSON.parse(opts.data).cards, version: mock.revision });
    } else if (opts.url.endsWith('/feedback') || opts.url.endsWith('/pick')) {
      const queue = opts.url.endsWith('/pick') ? mock.picks : mock.feedback;
      queue.push({ ...opts, body: JSON.parse(opts.data), at: performance.now() });
    } else {
      if (opts.method === 'PUT') {
        const payload = JSON.parse(opts.data);
        if (payload.revision !== mock.revision) {
          queueMicrotask(() => opts.onload({ status: 409, responseText: '{}' }));
          return;
        }
        mock.groups = payload.groups;
        mock.revision++;
      }
      const rules = mock.groups.filter(group => group.enabled).map(group => group.name);
      const config = { scriptVersion:fixture.legacyAgent ? undefined : mock.latest, siteEnabled: !mock.siteDisabled, rules, groups: mock.groups, scheduling: mock.scheduling, pagePolicy: mock.pagePolicy, revision: mock.revision, autoNotInterested: mock.autoNotInterested };
      queueMicrotask(() => {
        opts.onload({ status: 200, responseText: JSON.stringify(config) });
        // Dispatch after the application's resolved-request continuations have processed this exact snapshot.
        setTimeout(() => { mock.rulesDelivered = config; }, 0);
      });
    }
  };
}

async function exerciseFeed() {
  const result = document.getElementById('result');
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(checkFn) {
    for (let i = 0; i < 100; i++) {
      if (checkFn()) return;
      await sleep(10);
    }
    throw Error('timed out: ' + checkFn.toString());
  }
  function add(id, title) {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.innerHTML = '<div class="bili-feed-card"><div class="bili-video-card"><a class="bili-video-card__image--link"><picture class="bili-video-card__cover"><img></picture></a><h3 class="bili-video-card__info--tit"><a></a></h3><span class="bili-video-card__info--author">测试 UP</span></div></div>';
    card.querySelector('img').src = '//i0.hdslb.com/bfs/archive/example.jpg@672w.webp';
    reuse(card, id, title);
    document.querySelector('main .container').append(card);
    return card;
  }
  function reuse(card, id, title) {
    card.querySelectorAll('a').forEach(a => a.href = 'https://www.bilibili.com/video/' + id + '/');
    card.querySelector('h3 a').textContent = title;
  }
  const visible = card => getComputedStyle(card.querySelector('h3')).visibility === 'visible';
  const reply = (request, results) => request.onload({ status: 200,
    responseText: JSON.stringify({ revision: request.version, results }) });
  const next = async () => { await until(() => mock.requests.length); return mock.requests.shift(); };
  try {
    const a = add('BV1abcABC001', '陶艺');
    const b = add('BV1abcABC002', '辩论');
    const duplicate = add('BV1abcABC001', '陶艺');
    check(!visible(a), 'new card visible before MutationObserver');
    check(getComputedStyle(a, '::after').visibility === 'visible', 'missing placeholder');
    const rejected = await next();
    const other = await next();
    check(rejected.cards.length === 1 && other.cards.length === 1 && other.cards[0].id === 'BV1abcABC002', 'reviews must be independent');
    reply(other, [{ id: other.cards[0].id, decision: 'block', rule: '政治' }]);
    rejected.onload({ status: 429, responseText: '{}' });
    check(!visible(a), '429 exposed a pending card');
    const first = await next();
    check(first.data === rejected.data, '429 retried a different card');
    check(first.cards.length === 1, 'duplicate went to model');
    check(first.cards[0].author === '测试 UP' && first.cards[0].cover === 'https://i0.hdslb.com/bfs/archive/example.jpg', 'card extraction');
    reply(first, [{ id: first.cards[0].id, decision: 'allow' }]);
    await until(() => visible(a));
    check(visible(duplicate) && b.dataset.cfState === 'block' && b.dataset.cfLabel.includes('政治'), 'mixed results');

    reuse(a, 'BV1abcABC003', '旧请求');
    await Promise.resolve();
    check(!visible(a), 'recycled node stayed visible');
    const stale = await next();
    reuse(a, 'BV1abcABC004', '新内容');
    reply(stale, [{ id: stale.cards[0].id, decision: 'allow' }]);
    const latest = await next();
    check(!visible(a) && latest.cards[0].title === '新内容', 'late allow leaked');
    latest.ontimeout();
    await until(() => a.dataset.cfLabel?.includes('超时'));
    check(!visible(a), 'timeout exposed pending content');

    check(mock.menuNames[1] === '编辑规则', 'rule menu label');
    await mock.menus[1]();
    check(mock.opened.length === 1 && mock.opened[0].url === 'http://127.0.0.1:' + mock.livePort + '/rules'
      && mock.opened[0].options.active, 'menu did not open the rules WebUI');
    check(!mock.roots.some(r => r.querySelector('textarea, dialog')), 'unexpected inline editor');
    mock.revision++;
    dispatchEvent(new Event('focus'));
    await until(() => !visible(duplicate));
    const updated = await next();
    check(updated.version === 2, 'WebUI changes did not reach the feed');
    for (const req of [updated, await next(), await next()]) reply(req, [{ id: req.cards[0].id, decision: 'allow' }]);
    await until(() => visible(b));
    const last = add('BV1abcABC005', '缺失结果');
    const malformed = await next();
    reply(malformed, []);
    await until(() => last.dataset.cfLabel?.includes('格式错误'));
    check(!visible(last), 'invalid result revealed card');
    history.pushState(null, '', '/video/BV1abcABC005');
    dispatchEvent(new PopStateEvent('popstate'));
    check(visible(last) && !document.documentElement.hasAttribute('data-cf-home'), 'route cleanup');
    result.textContent = 'PASS';
  } catch (error) { result.textContent = 'FAIL ' + error.message; }
}

async function exerciseActions() {
  const out = document.querySelector('#result');
  const expect = (ok, message) => { if (!ok) throw Error(message); };
  async function until(fn) {
    for (let i = 0; i < 180; i++) {
      if (fn()) return;
      await new Promise(done => setTimeout(done, 10));
    }
    throw Error('timeout: ' + fn.toString());
  }
  const rootOf = card => mock.roots.find(root => root.host.parentElement === card && root.host.hasAttribute('data-cf-controls'));
  function add(id) {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.style.cssText = 'height:160px;width:300px';
    card.innerHTML = '<div class="bili-video-card"><h3><a></a></h3><a href="//space.bilibili.com/123" title="测试昵称"></a></div>';
    const a = card.querySelector('a');
    a.href = 'https://www.bilibili.com/video/' + id;
    a.textContent = id;
    document.querySelector('main .container').append(card);
    return card;
  }
  function response(req, dto) { req.onload({ status: 200, responseText: JSON.stringify(dto) }); }
  async function classify(allow = []) {
    await until(() => mock.requests.length === 2);
    const requests = mock.requests.splice(0);
    for (const req of requests) {
      expect(req.cards.length === 1, 'expected single-card request');
      const { id } = req.cards[0];
      const decision = allow.includes(id) ? 'allow' : 'block';
      response(req, { revision: req.version, results: [{ id, decision, rule: '政治' }] });
      await until(() => document.querySelector('a[href$="' + id + '"]')?.closest('.feed-card')?.dataset.cfState === decision);
    }
  }
  const noticeText = () => mock.roots.filter(r => r.host.isConnected && r.querySelector('aside p')).at(-1)?.textContent || '';
  async function pick(card) {
    await mock.menus[2]();
    const link = card.querySelector('a');
    link.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(card.hasAttribute('data-cf-highlight'), 'picker hover');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented && !card.hasAttribute('data-cf-highlight'), 'picker intercepted navigation');
    return mock.roots.at(-1);
  }
  try {
    const a = add('BV1abcABC011'), duplicate = add('BV1abcABC011'), b = add('BV1abcABC012');
    await classify(['BV1abcABC012']);
    const content = a.firstElementChild;
    const controls = rootOf(a);
    expect(content.inert && getComputedStyle(content).filter === 'blur(30px)' && getComputedStyle(content).pointerEvents === 'none',
      'blocked content filter or interaction lock');
    expect(getComputedStyle(controls.host).filter === 'none', 'overlay got blurred');
    expect(controls.querySelectorAll('button').length === 1, 'unexpected action on blocked card');
    expect(controls.querySelector('button').value === 'peek', 'blind feedback button');
    controls.querySelector('button').click();
    expect(!content.inert && getComputedStyle(content).filter === 'none','peek did not unlock content');
    rootOf(a).querySelector('[value=mask]').click();
    expect(content.inert && a.dataset.cfLabel.includes('政治') && a.dataset.cfState === 'block','restore verdict');
    rootOf(duplicate).querySelector('[value=peek]').click();
    const report = rootOf(duplicate).querySelector('[value=report]');
    report.focus();
    expect(rootOf(duplicate).activeElement === report, 'feedback is keyboard accessible');
    report.click(); report.click();
    await until(() => mock.feedback.length);
    expect(mock.feedback.length === 1 && report.disabled, 'double feedback');
    const first = mock.feedback.shift();
    expect(Object.keys(first.body).sort().join() === 'card,revision' && first.body.revision === 1, 'feedback payload');
    first.onerror();
    await until(() => mock.feedback.length);
    const retry1 = mock.feedback.shift();
    expect(retry1.data === first.data && retry1.at - first.at >= 300 && report.disabled, 'first automatic retry');
    retry1.onload({ status: 502, responseText: '{}' });
    await until(() => mock.feedback.length);
    const retry2 = mock.feedback.shift();
    expect(retry2.data === first.data && retry2.at - retry1.at >= 620 && report.disabled, 'second exponential retry');
    retry2.onerror();
    await until(() => !report.disabled);
    report.click();
    await until(() => mock.feedback.length);
    mock.revision++;
    response(mock.feedback.shift(), { revision: 2, message: '反馈已应用', analysis: '来自分析的原因',
      corrections: [{ groupName: '测试组', point: '保留例外内容' }] });
    await until(() => noticeText().includes('保留例外内容') && noticeText().includes('来自分析的原因'));
    await classify(['BV1abcABC011','BV1abcABC012']);
    await mock.menus[2]();
    dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    expect(!document.documentElement.hasAttribute('data-cf-picking'), 'escape picker');
    let form = await pick(b);
    let apply = form.querySelector('[value=apply]');
    expect(b.dataset.cfState === 'pending' && getComputedStyle(b.querySelector('h3')).visibility === 'hidden', 'selected card must be covered');
    apply.click(); apply.click();
    await until(() => mock.picks.length);
    expect(mock.picks.length === 1 && mock.picks[0].body.groupId === 'politics' && mock.picks[0].body.revision === 2, 'existing group payload');
    mock.picks.shift().onload({ status: 403, responseText: '{}' });
    await until(() => !apply.disabled);
    expect(!mock.picks.length, 'authorization result retried');
    apply.click();
    await until(() => mock.picks.length);
    mock.revision++;
    response(mock.picks.shift(), { revision: 3, message: '本卡已屏蔽', corrections: [{ groupName: '测试组', point: '新增命中要点' }] });
    await until(() => noticeText().includes('新增命中要点'));
    await classify(['BV1abcABC011']);
    await until(() => b.dataset.cfState === 'block');
    form = await pick(a);
    const select = form.querySelector('select');
    expect(!form.querySelector('textarea, input[type=text]'), 'inline rule editor in picker');
    await form.querySelector('[value=rules]').onclick();
    expect(mock.opened.at(-1)?.url === 'http://127.0.0.1:' + mock.livePort + '/rules', 'picker did not open WebUI');
    mock.groups.push({id:'new',name:'新的规则',enabled:true,include:['要点'],exclude:[]});
    mock.revision++;
    dispatchEvent(new Event('focus'));
    await until(() => select.querySelector('option[value=new]'));
    select.value = 'new';
    form.querySelector('[value=apply]').click();
    await until(() => mock.picks.length);
    const newReq = mock.picks.shift();
    expect(newReq.body.groupId === 'new' && newReq.body.revision === mock.revision && !newReq.body.newGroup, 'picker ignored rules from WebUI');
    newReq.onerror();
    a.querySelector('a').href = 'https://www.bilibili.com/video/BV1abcABC099';
    await Promise.resolve();
    expect(!form.host.isConnected && a.dataset.cfState === 'pending', 'recycled card kept picker');
    await new Promise(done => setTimeout(done, 550));
    expect(!mock.picks.length && a.dataset.cfState === 'pending', 'retried after selected DOM was recycled');
    out.textContent = 'PASS';
  } catch (error) { out.textContent = 'FAIL ' + error.message; }
}

async function exerciseScheduling() {
  const out = document.querySelector('#result');
  const expect = (ok, message) => { if (!ok) throw Error(message); };
  async function until(fn, message) {
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      if (fn()) return;
      await new Promise(done => setTimeout(done, 15));
    }
    throw Error(message + ': batches=' + mock.requests.length + ', errors=' + mock.protocolErrors.join(','));
  }
  const feed = document.querySelector('main .container');
  function append(start, count) {
    for (let i = start; i < start + count; i++) {
      const card = document.createElement('div');
      card.className = 'feed-card';
      card.style.height = '12px';
      card.innerHTML = '<h3 style="margin:0"><a>标题</a></h3>';
      card.querySelector('a').href = 'https://www.bilibili.com/video/BV1abc' + i;
      feed.append(card);
    }
  }
  function allow(req) { req.onload({ status: 200, responseText: JSON.stringify({ revision: req.version,
    results: req.cards.map(card => ({ id: card.id, decision: 'allow' })) }) }); }
  try {
    append(100, 13);
    await until(() => mock.requests.length >= 8, 'default queue failed to fill');
    expect(mock.requests.length === 8 && mock.requests.every(req => req.cards.length === 1), 'expected eight independent cards');
    const held = mock.requests.shift();
    mock.requests.splice(0).forEach(allow);
    await until(() => mock.requests.length === 5, 'ready cards waited for a slow neighbor');
    mock.requests.splice(0).forEach(allow);
    await until(() => feed.querySelectorAll('[data-cf-state=allow]').length === 12, 'decisions waited for the slow card');
    allow(held);
    await until(() => feed.querySelectorAll('[data-cf-state=allow]').length === 13, 'slow card decision missing');
    mock.scheduling = { browserConcurrency: 3, batchSize: 2 };
    dispatchEvent(new Event('focus'));
    await until(() => mock.rulesDelivered?.scheduling === mock.scheduling, 'new scheduling was not delivered');
    append(120, 13);
    await until(() => mock.requests.length >= 3, 'configured queue failed to fill');
    expect(mock.requests.length === 3, 'configured concurrency exceeded');
    expect(mock.requests.every(req => req.cards.length === 1), 'legacy batch size grouped cards');
    const first = mock.requests.shift();
    allow(first);
    await until(() => mock.requests.length >= 3, 'released slot was not refilled');
    expect(mock.requests[2].cards.length === 1, 'released slot was not refilled');
    const inFlight = mock.requests.splice(0);
    mock.siteDisabled = true;
    dispatchEvent(new Event('focus'));
    await until(() => !document.documentElement.hasAttribute('data-cf-home'), 'paused site kept its mask');
    inFlight.forEach(allow);
    append(200, 1);
    await new Promise(done => setTimeout(done, 100));
    expect(!mock.requests.length && !feed.querySelector('[data-cf-state]'), 'disabled site continued filtering');
    mock.siteDisabled = false;
    dispatchEvent(new Event('focus'));
    await until(() => mock.requests.length > 0 && document.documentElement.hasAttribute('data-cf-home'), 'enabled site did not resume');
    out.textContent = 'PASS';
  } catch (error) { out.textContent = 'FAIL ' + error.message; }
}

async function exerciseDiscovery() {
  const out = document.getElementById('result');
  const expect = (v, m) => { if (!v) throw Error(m); };
  const sleep = ms => new Promise(done => setTimeout(done, ms));
  const until = async (test, label) => {
    for (let i = 0; i < 800; i++) { if (test()) return; await sleep(10); }
    throw Error('timeout: ' + label);
  };
  const feed = document.querySelector('main .container');
  const add = n => {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.innerHTML = '<h3><a></a></h3>';
    card.querySelector('a').href = 'https://www.bilibili.com/video/BV1fixture' + n;
    card.querySelector('a').textContent = '仅用于回归的私有标题 ' + n;
    feed.append(card);
    return card;
  };
  const masked = card => getComputedStyle(card.querySelector('h3')).visibility === 'hidden';
  const allow = req => req.onload({ status: 200, responseText: JSON.stringify({
    revision: req.version, results: req.cards.map(card => ({ id: card.id, decision: 'allow' })),
  }) });
  try {
    const cards = Array.from({ length: 6 }, (_, i) => add(i));
    expect(cards.every(masked), 'card visible while discovery starts');
    // Overlapping rule syncs, card observations and focus changes share the in-flight scan.
    for (let i = 0; i < 4; i++) dispatchEvent(new Event('focus'));
    await until(() => new Set(mock.probes.map(p => p.port)).size === 33 && mock.activeProbes === 0, 'first full scan');
    expect(mock.probes[0].port === mock.ports[3], 'cached candidate not checked first');
    const expected = [mock.ports[3], ...mock.ports.filter(port => port !== mock.ports[3])];
    expect(mock.probes.map(p => p.port).join() === expected.join(), 'candidate order or duplicate probe mismatch');
    expect(mock.maxActiveProbes <= 4, 'unbounded parallel discovery');
    expect(!mock.api.length && cards.every(masked), 'unavailable or forged agent received data');

    // Bring the agent online during retry backoff, without reloading the page or prompting.
    mock.livePort = mock.ports[6];
    await until(() => mock.requests.length === 6, 'automatic retry then classify');
    expect(mock.storage.agentPort === mock.livePort, 'verified alternate port not cached');
    expect(mock.api.every(r => r.port === mock.livePort), 'unverified port received data');
    expect(cards.every(masked), 'unclassified cards visible');
    mock.requests.splice(0).forEach(allow);
    await until(() => cards.every(c => !masked(c)), 'filtered results');

    // A different service immediately takes over the just-authenticated port and replays
    // its previous valid hello. Fresh requests must re-authenticate before sending cards.
    const previous = mock.livePort;
    const earlierProbes = mock.probes.filter(p => p.port === previous).length;
    mock.responses[previous] = 'replay';
    mock.livePort = mock.ports[10];
    await mock.menus[1]();
    expect(mock.opened.length === 1 && mock.opened[0].url === 'http://127.0.0.1:' + mock.livePort + '/rules', 'menu trusted stale or forged port');
    const moved = Array.from({ length: 6 }, (_, i) => add(20 + i));
    await until(() => mock.requests.length === 6, 'running agent migration');
    expect(moved.every(masked), 'cards shown during agent migration');
    expect(mock.storage.agentPort === mock.livePort, 'old port persisted after migration');
    expect(mock.requests.every(r => Number(new URL(r.url).port) === mock.livePort), 'card sent to old port');
    expect(mock.probes.filter(p => p.port === previous).length === earlierProbes + 1, 'simultaneous requests failed to share one authenticated discovery');
    mock.requests.splice(0).forEach(allow);
    await until(() => moved.every(c => !masked(c)), 'migration results');
    expect(mock.protocolErrors.length === 0, 'unsafe local request: ' + mock.protocolErrors.join(','));
    const nonces = new Map();
    for (const { port, nonce } of mock.probes) {
      const seen = nonces.get(port) || new Set();
      expect(!seen.has(nonce), 'reused nonce on the same port across discovery rounds');
      seen.add(nonce); nonces.set(port, seen);
    }
    out.textContent = 'PASS';
  } catch (error) { out.textContent = 'FAIL ' + error.message; }
}

async function exerciseNativeCards() {
  const out = document.querySelector('#result');
  const feed = document.querySelector('main .container');
  const video = (id, title) => '<h3><a href="/video/' + id + '">' + title + '</a></h3>';
  const add = html => {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.innerHTML = html;
    feed.append(card);
    return card;
  };
  async function until(check) {
    const end = performance.now() + 4000;
    while (!check()) {
      if (performance.now() > end) throw Error('timeout: ' + check);
      await new Promise(r => setTimeout(r, 15));
    }
  }
  const native = card => card.dataset.cfState === 'native' &&
    !card.querySelector('[data-cf-controls], [inert]') && getComputedStyle(card).visibility === 'visible';
  const verdict = (req, decision) => req.onload({status:200,responseText:JSON.stringify({
    revision:req.version, results:req.cards.map(card => ({id:card.id,decision,rule:'测试'}))
  })});
  try {
    const ads = [
      add(video('BVpaid', '月包仅39元') + '<span class="bili-video-card__info--creative-ad">广告</span>'),
      add('<h3><a href="https://cm.bilibili.com/cm/api/fees/pc">优惠</a></h3>'),
      add(video('BVpromo', '月包优惠') + '<div class="bili-video-card__stats"><span>广告</span></div>'),
      add('<h3><a href="https://live.bilibili.com/1234">开完箱子练小号</a></h3>'),
      add('<div class="bili-live-card"><h3>开完箱子练小号</h3></div>'),
      add('<picture><img data-src="https://i0.hdslb.com/bfs/sycp/creative_img/sample.jpg"></picture>'),
    ];
    const ordinary = add(video('BVplain', '广告创作与直播中断复盘'));
    const lazy = add('<picture><img data-src="https://i0.hdslb.com/bfs/archive/test.jpg"></picture><h3>推荐</h3>');
    await until(() => lazy.dataset.cfLabel === '等待页面加载封面');
    lazy.dataset.goto = 'cm';
    await until(() => [...ads,lazy].every(native) && mock.requests.length);
    const first = mock.requests.shift();
    if (first.cards.map(c => c.id).join() !== 'BVplain') throw Error('non-video card submitted');
    ordinary.innerHTML = '<div class="bili-live-card"><h3>直播中</h3></div>';
    await until(() => native(ordinary));
    verdict(first,'block');
    await new Promise(r => setTimeout(r,100));
    if (!native(ordinary) || mock.requests.length) throw Error('stale result covered a live room');
    ordinary.innerHTML = video('BVfresh','直播回放');
    await until(() => mock.requests.length);
    const second = mock.requests.shift();
    if (second.cards.map(c => c.id).join() !== 'BVfresh') throw Error('recycled ordinary video not submitted');
    verdict(second,'block');
    await until(() => ordinary.querySelector('[data-cf-controls]'));
    ordinary.dataset.isAd = '1';
    await until(() => native(ordinary));
    if (mock.requests.length) throw Error('unexpected extra classify');
    out.textContent = 'PASS';
  } catch (e) { out.textContent = 'FAIL ' + e.message; }
}

async function exerciseHydration() {
  const out = document.querySelector('#result');
  try {
    const feed = document.querySelector('main .container');
    const skeleton = '<div class="bili-video-card"><div class="bili-video-card__skeleton"><p class="bili-video-card__skeleton--text"></p></div></div>';
    feed.innerHTML = '<div class="recommended-swipe-shim">' + skeleton + '</div>' + skeleton;
    const shim = feed.firstElementChild.firstElementChild;
    const card = feed.lastElementChild;
    await new Promise(r => setTimeout(r, 100));
    if ([shim, card].some(c => c.dataset.cfState || getComputedStyle(c, '::after').content.includes('等待'))) {
      throw Error('layout skeleton was treated as a pending video');
    }
    card.insertAdjacentHTML('beforeend', '<picture><img data-src="https://i0.hdslb.com/bfs/archive/late.jpg"></picture>');
    if (getComputedStyle(card.querySelector('img')).visibility !== 'hidden') throw Error('hydration exposed the cover');
    const img = card.querySelector('img');
    Object.defineProperty(img, 'currentSrc', {get: () => img.dataset.src});
    img.dispatchEvent(new Event('error'));
    const waitForBatch = async () => {
      for (let i = 0; i < 200 && !mock.requests.length; i++) await new Promise(r => setTimeout(r, 10));
      if (!mock.requests.length) throw Error('no classification for hydrated card');
      return mock.requests.shift();
    };
    const early = await waitForBatch();
    if (early.cards[0].title || !early.cards[0].cover) throw Error('expected cover-only input');
    card.insertAdjacentHTML('beforeend', '<a href="/video/BVlater123" aria-label="稍后到达的标题"></a>');
    early.onload({status:200,responseText:JSON.stringify({revision:early.version,results:[{id:early.cards[0].id,decision:'allow'}]})});
    const late = await waitForBatch();
    if (late.cards[0].id !== 'BVlater123' || late.cards[0].title !== '稍后到达的标题' || card.dataset.cfState !== 'pending') throw Error('stale verdict or wrong title');
    out.textContent = 'PASS';
  } catch (err) { out.textContent = 'FAIL ' + err.message; }
}

async function exercisePageCover() {
  const out = document.querySelector('#result');
  async function nextRequest(timeoutMs = 3000) {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (mock.requests.length) return mock.requests.shift();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw Error('no classify request');
  }
  try {
    const card = document.createElement('div');
    card.className = 'feed-card';
    card.innerHTML = '<a class="bili-video-card__image--link" href="https://www.bilibili.com/video/BVtest123"><img></a><h3><a href="https://www.bilibili.com/video/BVtest123">实验</a></h3>';
    const img = card.querySelector('img');
    img.dataset.src = 'https://i0.hdslb.com/bfs/archive/test.jpg';
    document.querySelector('main .container').append(card);
    const ready = card.cloneNode(true);
    ready.querySelectorAll('a').forEach(a => a.href = '/video/BVready456');
    const readyImg = ready.querySelector('img');
    Object.defineProperty(readyImg,'currentSrc',{get:()=>readyImg.dataset.src});
    readyImg.src = '/fixture-cover.png';
    card.after(ready);
    const first = await nextRequest();
    if (first.cards.length !== 1 || first.cards[0].id !== 'BVready456' || !first.cards[0].pageCover) {
      throw Error('slow cover blocked or joined the ready card');
    }
    first.onload({status:200,responseText:JSON.stringify({revision:first.version,results:[
      {id:'BVready456',decision:'allow'}]})});
    await new Promise(r => setTimeout(r, 850));
    if (mock.requests.length || card.dataset.cfState !== 'pending') throw Error('fallback before lazy image loaded');
    // Use real decoded pixels from the fixture while reporting Bilibili's displayed CDN URL.
    Object.defineProperty(img,'currentSrc',{get:()=>img.dataset.src});
    img.src = '/fixture-cover.png';
    const second = await nextRequest();
    if (!second.cards[0].pageCover?.startsWith('data:image/jpeg;base64,/9j/') ||
        second.cards[0].pageCover.length > 96 * 1024 || card.dataset.cfState !== 'pending') throw Error('invalid page thumbnail or exposed card');
    const stalled = card.cloneNode(true);
    stalled.querySelectorAll('a').forEach(a => a.href = '/video/BVstalled789');
    const stalledImg = stalled.querySelector('img');
    stalledImg.removeAttribute('src');
    const start = performance.now();
    card.after(stalled);
    const fallback = await nextRequest(8000);
    if (performance.now() - start < 4900 || fallback.cards[0].id !== 'BVstalled789' ||
        fallback.cards[0].pageCover || !fallback.cards[0].cover) throw Error('incorrect timeout fallback');
    fallback.onload({status:200,responseText:JSON.stringify({revision:fallback.version,results:[
      {id:'BVstalled789',decision:'pending',retryWhenCoverLoads:true}]})});
    Object.defineProperty(stalledImg, 'currentSrc', {get: () => stalledImg.dataset.src});
    stalledImg.src = '/fixture-cover.png';
    if (!(await nextRequest()).cards[0].pageCover) throw Error('late pixels did not recover failed fallback');
    out.textContent = 'PASS';
  } catch (e) { out.textContent = 'FAIL '+e.message; }
}

async function exerciseCorsCover() {
  const out = document.querySelector('#result');
  const actualFetch = window.fetch.bind(window);
  const cdn = 'http://localhost:' + location.port + '/fixture-cover.png';
  const calls = [];
  window.fetch = (resource, options) => {
    if (!String(resource).startsWith('https://i0.hdslb.com/')) return actualFetch(resource, options);
    calls.push([resource, options]);
    return actualFetch(cdn + (resource.includes('denied.jpg') ? '?deny' : '?slow=' + encodeURIComponent(resource)), options);
  };
  async function next(card) {
    for (let n = 0; n < 300; n++) {
      const req = mock.requests.shift();
      if (req) return req.cards[0];
      await new Promise(r => setTimeout(r, 20));
    }
    throw Error('no review: ' + card.dataset.cfLabel);
  }
  async function add(name, withImage) {
    const card = document.createElement('div');
    card.className = 'feed-card';
    const link = document.createElement('a');
    link.href = '/video/BV' + name;
    link.textContent = name;
    card.append(link);
    if (withImage) {
      const img = new Image();
      img.dataset.src = 'https://i0.hdslb.com/bfs/archive/' + name + '.jpg';
      img.src = cdn;
      await img.decode();
      Object.defineProperty(img, 'currentSrc', {get: () => img.dataset.src + '@672w.webp'});
      link.append(img);
    }
    document.querySelector('main .container').append(card);
    return card;
  }
  try {
    const slow = await add('slow', true);
    if (!(await next(slow)).pageCover || calls.length !== 1) throw Error('readable slow CORS cover sent to agent fallback');
    if (!calls[0][0].endsWith('@672w.webp') || calls[0][1].credentials !== 'omit') throw Error('wrong variant or credentials');
    const denied = await add('denied', true);
    if ((await next(denied)).pageCover || !denied.dataset.cfLabel.includes('403')) throw Error('missing HTTP fallback reason');
    const missing = await add('missing', false);
    if ((await next(missing)).cover || missing.dataset.cfLabel.includes('备用')) throw Error('missing URL was labeled as a fallback download');
    async function refreshRules() {
      mock.rulesDelivered = null;
      dispatchEvent(new Event('focus'));
      for (let i = 0; i < 100 && !mock.rulesDelivered; i++) await new Promise(resolve => setTimeout(resolve, 20));
      if (!mock.rulesDelivered) throw Error('rule refresh timed out');
    }
    mock.pagePolicy = {...mock.installedPolicy, corsReadTimeoutMs:550};
    await refreshRules();
    const timeout = await add('timeout', true);
    const timed = await next(timeout);
    if (timed.pageCover || !timed.cover || !timeout.dataset.cfLabel.includes('跨域读取超时')) throw Error('bounded timeout did not explain fallback');
    for (const card of [slow, denied, missing, timeout]) card.remove();
    mock.groups = [];
    mock.revision++;
    await refreshRules();
    const before = calls.length;
    const inactive = await add('inactive', true);
    if ((await next(inactive)).pageCover || calls.length !== before || inactive.dataset.cfLabel.includes('备用')) throw Error('inactive rules triggered cover work or fallback label');
    out.textContent = 'PASS';
  } catch (error) { out.textContent = 'FAIL '+error.message; }
}

async function runBrowser(exercise, options = {}) {
  const site = options.site || 'bilibili';
  const path = '../plugins/' + site + '/';
  const [template, client] = await Promise.all([path + site + '.user.js', '../sdk/client.js']
    .map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const manifest = JSON.parse(await readFile(new URL(path + 'site.json', import.meta.url), 'utf8'));
  const script = template.replace('/* @cognition-page-policy-v1 */ null', () => JSON.stringify(manifest.pagePolicy)).replace('/* @cognition-client-v1 */', () => client.replaceAll('__CF_SITE_ID__', site).replaceAll('__CF_SITE_VERSION__', template.match(/^\/\/ @version\s+(\S+)/m)[1]));
  const fixture = {
    site, installedPolicy: manifest.pagePolicy, token: pairingToken, ports, portTags: Object.fromEntries(ports.map(p => [p, mac('cognition-filter/auth/v1|' + p)])),
    livePort: 17321, version: script.match(/^\/\/ @version\s+(\S+)/m)[1], ...options,
  };
  const html = `<!doctype html><meta charset="utf-8"><script>(${setupFixture})(${JSON.stringify(fixture)})</script><script>${script}</script>
    <main class="bili-feed4-layout"><div class="recommended-container_floor-aside"><div class="container"></div></div></main>
    <pre id="result">STARTED</pre><script>(${exercise})().finally(() => {
      if (mock.protocolErrors.length) document.getElementById('result').textContent += ' ' + mock.protocolErrors.join(',');
      return fetch('/done');
    })</script><script src="/hold.js"></script>`;
  // Hold the load event until the assertions complete, allowing Chromium to render native
  // IntersectionObserver frames before --dump-dom takes its snapshot.
  let hold;
  let finished = false;
  const server = createServer((req, res) => {
    if (req.url.startsWith('/fixture-cover.png?slow=')) {
      setTimeout(async () => {
        const bytes = await readFile(new URL('../eval/covers/cooking.png', import.meta.url));
        res.writeHead(200, {'Content-Type':'image/png', 'Access-Control-Allow-Origin':'*'}).end(bytes);
      }, 1600);
    } else if (req.url === '/fixture-cover.png?deny') {
      res.writeHead(403, {'Access-Control-Allow-Origin':'*'}).end();
    } else if (req.url === '/fixture-cover.png') {
      void readFile(new URL('../eval/covers/cooking.png', import.meta.url)).then(bytes => res.writeHead(200, {'Content-Type':'image/png'}).end(bytes));
    } else if (req.url.startsWith('/fixture-proof?')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      res.end(mac('cognition-filter/v1|' + params.get('port') + '|' + params.get('nonce')));
    } else if (req.url === '/hold.js') {
      hold = res.writeHead(200, { 'Content-Type': 'application/javascript' });
      if (finished) hold.end();
    } else if (req.url === '/done') {
      finished = true;
      hold?.end();
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': options.corsFixture ? "img-src 'self' http://localhost:*" : "img-src 'self'" }).end(html);
    }
  });
  const profile = await mkdtemp(join(tmpdir(), 'cf-browser-test-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { stdout } = await promisify(execFile)(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--disable-extensions', '--disable-background-networking', '--user-data-dir=' + profile,
      '--dump-dom', 'http://127.0.0.1:' + server.address().port + (site === 'x' ? '/home' : '/')],
    { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
    assert.equal(stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1], 'PASS');
  } finally {
    server.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

const browserOptions = { skip: !browser && 'set BROWSER_BIN to run with Chromium', timeout: 45000 };
for (const site of ['bilibili','x']) {
  test(site + ' offers first-run pairing and a versioned script update', browserOptions, () => runBrowser(async () => {
    const until = async fn => {
      for (let i=0;i<180;i++) {if (fn()) return; await new Promise(r=>setTimeout(r,15));}
      throw Error('timeout '+fn);
    };
    const check=(value,label)=>{if (!value) throw Error(label);};
    try {
      await until(()=>mock.storage.pairToken && mock.api.some(r=>r.path==='/v1/rules'));
      check(mock.prompts.length===1 && mock.prompts[0].includes('托盘'),'first-use prompt');
      mock.latest='0.0.1'; dispatchEvent(new Event('focus'));
      await new Promise(r=>setTimeout(r,80));
      check(!mock.confirms.length,'offered downgrade');
      mock.latest='0.10.0'; dispatchEvent(new Event('focus'));
      await until(()=>mock.opened.length===1);
      check(mock.opened[0].url==='http://127.0.0.1:'+mock.livePort+'/plugins/'+
        (location.pathname==='/home'?'x':'bilibili')+'/cognition-filter.user.js','wrong install URL');
      dispatchEvent(new Event('focus')); await new Promise(r=>setTimeout(r,80));
      check(mock.prompts.length===1 && mock.confirms.length===1,'duplicate prompt');
      result.textContent='PASS';
    } catch(error){result.textContent='FAIL '+error.message;}
  }, {site, unpaired:true, acceptPair:true, acceptUpdate:true}));
}
test('older agents advertise an update through their installed script metadata', browserOptions, () => runBrowser(async () => {
  for (let i=0;i<150 && !mock.confirms.length;i++) await new Promise(r=>setTimeout(r,15));
  dispatchEvent(new Event('focus')); await new Promise(r=>setTimeout(r,80));
  result.textContent=mock.confirms.length===1 && mock.confirms[0].includes('0.10.3') && !mock.opened.length
    ? 'PASS' : 'FAIL legacy update or dismissal';
}, {site:'x', legacyAgent:true, available:'0.10.3'}));
test('dismissed pairing remains available from the menu', browserOptions, () => runBrowser(async () => {
  await new Promise(r=>setTimeout(r,80));
  dispatchEvent(new Event('focus')); await new Promise(r=>setTimeout(r,30));
  const once=mock.prompts.length===1 && !mock.api.length;
  await mock.menus[0]();
  result.textContent=once && mock.prompts.length===2 && !mock.storage.pairToken ? 'PASS' : 'FAIL missing manual pairing';
}, {unpaired:true}));
test('X home masks recycled posts, reviews text and media, and respects route and plugin switches', browserOptions, () => runBrowser(async () => {
  const out = document.querySelector('#result');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (ok, msg) => { if (!ok) throw Error(msg); };
  async function until(fn) {
    for (let i=0; i<200; i++) { if (fn()) return; await sleep(15); }
    throw Error('timeout '+fn);
  }
  const column = document.createElement('div');
  column.dataset.testid = 'primaryColumn'; document.body.append(column);
  const link = id => '/user/status/' + id;
  function add(id, text, promoted = false) {
    const post = document.createElement('article');
    post.dataset.testid = 'tweet';
    post.innerHTML = '<div><div data-testid="User-Name">作者 @user<a><time>12m</time></a></div><div data-testid="tweetText"></div></div>';
    post.querySelector('a').href = link(id);
    post.querySelector('a').setAttribute('role','link');
    post.querySelector('[data-testid=tweetText]').textContent = text;
    const caret = document.createElement('button');
    caret.dataset.testid='caret'; caret.textContent='…';
    caret.onclick=() => {
      const menu=document.createElement('div');
      menu.setAttribute('role','menu'); menu.dataset.testid='Dropdown';
      menu.innerHTML='<button role="menuitem">原生选项</button>';
      menu.onkeydown=e=>{if(e.key==='Escape') menu.remove();};
      document.body.append(menu);
    };
    post.firstChild.append(caret);
    if (promoted) post.firstChild.setAttribute('data-testid','placementTracking');
    column.append(post);
    return post;
  }
  const next = async id => {
    await until(() => mock.requests.some(r => r.cards[0].id===id));
    return mock.requests.splice(mock.requests.findIndex(r => r.cards[0].id===id),1)[0];
  };
  const reply = (r, decision) => r.onload({status:200,responseText:JSON.stringify({revision:r.version,results:[{id:r.cards[0].id,decision,rule:'政治'}]})});
  try {
    const post = add('101','普通正文'), ad = add('999','广告正文',true);
    check(getComputedStyle(post.firstChild).visibility==='hidden','initial post leaked');
    const first = await next('101');
    check(first.cards[0].title==='普通正文' && !first.cards[0].pageCover && first.cards[0].author.includes('@user'),'missing text evidence');
    post.querySelector('a').href=link('102'); post.querySelector('[data-testid=tweetText]').textContent='新帖';
    reply(first,'allow');
    const second = await next('102');
    check(getComputedStyle(post.firstChild).visibility==='hidden','stale allow exposed recycled post');
    reply(second,'block'); await until(()=>post.dataset.cfxState==='block');
    check(getComputedStyle(post.firstChild).filter.includes('blur') && post.firstChild.inert,'blocked post not masked');
    check(ad.dataset.cfxState==='native' && !mock.requests.some(r=>r.cards[0].id==='999'),'ad reviewed');
    const controls = mock.roots.findLast(root => root.host.parentNode===post);
    check(controls.querySelectorAll('button').length===1 && controls.querySelector('button').textContent==='仍要查看','blind feedback');
    controls.querySelector('button').click(); check(post.dataset.cfxState==='allow','reveal failed');
    const open = async el => {
      el.querySelector('[data-testid=caret]').click();
      await until(()=>document.querySelector('[data-cf-review-actions]'));
      return [...document.querySelector('[data-cf-review-actions]').querySelectorAll('button')];
    };
    ad.querySelector('[data-testid=caret]').click(); await sleep(20);
    check(!document.querySelector('[data-cf-review-actions]'),'actions attached to unrelated menu');
    document.querySelector('[role=menu]').remove();
    (await open(post))[0].click();
    check(post.dataset.cfxState==='block' && post.firstChild.inert && !document.querySelector('[role=menu]'),'native menu remask');
    mock.roots.findLast(root=>root.host.parentNode===post).querySelector('button').click();
    const choose = window.prompt;
    window.prompt = () => '1';
    mock.menus[mock.menuNames.indexOf('选择帖子进行屏蔽')]();
    post.querySelector('[data-testid=tweetText]').click();
    await until(()=>mock.picks.length);
    check(mock.picks[0].body.card.id==='102' && mock.picks[0].body.groupId==='politics','manual pick sent wrong post');
    mock.picks[0].onload({status:200,responseText:JSON.stringify({revision:mock.revision})});
    window.prompt = choose;
    const media = add('103','');
    const photo = document.createElement('div'); photo.dataset.testid='tweetPhoto'; media.firstChild.append(photo);
    const img = new Image(); img.src='/fixture-cover.png'; await img.decode();
    Object.defineProperty(img,'currentSrc',{value:'https://pbs.twimg.com/media/photo?format=jpg&name=small'});
    photo.append(img);
    const visual = await next('103'); check(visual.cards[0].pageCover?.startsWith('data:image/jpeg;base64,'),'missing page thumbnail');
    reply(visual,'block'); await until(()=>media.dataset.cfxState==='block');
    mock.roots.findLast(root=>root.host.parentNode===media).querySelector('button').click();
    const [mask,report] = await open(media);
    check(mask.textContent==='重新遮盖' && report.textContent==='反馈误杀','missing menu actions');
    report.click(); report.click();
    await until(()=>mock.feedback.length);
    check(mock.feedback[0].body.card.id==='103' && mock.feedback[0].body.card.pageCover,'wrong feedback evidence');
    mock.feedback[0].onload({status:200,responseText:JSON.stringify({revision:mock.revision})});
    const [stale] = await open(post);
    post.querySelector('a').href=link('108'); stale.click();
    check(!post.firstChild.inert && mock.feedback.length===1,'stale menu changed a recycled post');
    document.querySelector('[role=menu]')?.remove();
    reply(await next('108'),'allow');
    const metrics = add('105','没有时间标签');
    const metricsLink = metrics.querySelector('a');
    metricsLink.replaceChildren();
    metricsLink.href = link('105') + '/analytics';
    reply(await next('105'),'allow');
    const unlinked = add('106','正文已显示');
    unlinked.querySelector('a').remove();
    const body = unlinked.querySelector('[data-testid=tweetText]');
    body.removeAttribute('data-testid'); body.lang = 'zh';
    const quote = document.createElement('div');
    quote.setAttribute('role','link');
    quote.innerHTML='<a href="/other/status/987"><time>12m</time></a>';
    unlinked.firstChild.append(quote);
    await until(()=>mock.requests.some(r=>r.cards[0].title==='正文已显示'));
    const old = mock.requests.splice(mock.requests.findIndex(r=>r.cards[0].title==='正文已显示'),1)[0];
    check(/^content-[a-f0-9]{64}$/.test(old.cards[0].id),'borrowed quoted status ID');
    body.textContent='复用节点的新正文'; reply(old,'allow');
    await until(()=>mock.requests.some(r=>r.cards[0].title==='复用节点的新正文'));
    const updated = mock.requests.splice(mock.requests.findIndex(r=>r.cards[0].title==='复用节点的新正文'),1)[0];
    check(updated.cards[0].id!==old.cards[0].id && getComputedStyle(body).visibility==='hidden','stale content-only verdict');
    reply(updated,'allow');
    const skeleton = add('107','');
    await sleep(5250);
    const retryUI = mock.roots.findLast(root=>root.host.parentNode===skeleton);
    check(skeleton.dataset.cfxState==='error' && retryUI.querySelector('button')?.textContent==='重试','indefinite skeleton wait');
    skeleton.querySelector('[data-testid=tweetText]').textContent='迟到的正文';
    reply(await next('107'),'allow');
    mock.siteDisabled=true; dispatchEvent(new Event('focus'));
    await until(()=>!document.documentElement.hasAttribute('data-cfx-home'));
    check(!media.firstChild.inert && !media.hasAttribute('data-cfx-state'),'disabled site kept shield');
    history.pushState({},'','/messages'); dispatchEvent(new PopStateEvent('popstate'));
    const dm = add('104','私信区域');
    await sleep(100); check(!dm.dataset.cfxState && !mock.requests.some(r=>r.cards[0].id==='104'),'non-home content reviewed');
    out.textContent='PASS';
  } catch (e) {out.textContent='FAIL '+e.message;}
}, {site:'x'}));
test('running script applies a DLL selector update, caches it and rejects invalid selectors', browserOptions, () => runBrowser(async function () {
  const until = async fn => {
    for (let i=0;i<180;i++) { if (fn()) return; await new Promise(r=>setTimeout(r,20)); }
    throw Error('timeout '+fn);
  };
  const result = document.getElementById('result');
  try {
    await until(() => mock.rulesDelivered);
    const card=document.createElement('div');
    card.className='future-feed-card';
    card.innerHTML='<a href="/video/BV1234"><span class="future-title">新版标题</span></a><span class="future-author">新版作者</span>';
    document.querySelector('.container').append(card);
    mock.pagePolicy={...mock.installedPolicy,cards:'.future-feed-card',title:'.future-title',author:'.future-author'};
    window.dispatchEvent(new Event('focus'));
    await until(() => mock.requests.length>0);
    const data=mock.requests[0].cards[0];
    if(data.title!=='新版标题' || data.author!=='新版作者' || getComputedStyle(card).visibility !== 'hidden') throw Error('new policy extraction/mask');
    if(mock.storage.cfPagePolicyV1.cards!=='.future-feed-card') throw Error('policy not cached');
    mock.pagePolicy.cards='broken{selector';
    window.dispatchEvent(new Event('focus'));
    await until(() => mock.rulesDelivered.pagePolicy?.cards==='broken{selector');
    if(mock.storage.cfPagePolicyV1.cards!=='.future-feed-card') throw Error('invalid policy replaced working one');
    result.textContent='PASS';
  } catch(e) { result.textContent='FAIL '+e.message; }
}));

test('advertisements and live rooms stay native through lazy loading and card reuse', browserOptions, () => runBrowser(exerciseNativeCards));
test('native content feedback checks opt-in, portal owner, reason and recycled videos', browserOptions, () => runBrowser(async () => {
  const out = document.querySelector('#result');
  const clicks = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function until(fn) {
    for (let i = 0; i < 125; i++) { if (fn()) return; await sleep(20); }
    throw Error('timed out: ' + fn);
  }
  async function card(id, decision, onOpen) {
    const el = document.createElement('div');
    el.className = 'feed-card';
    el.innerHTML = '<div class="bili-video-card__wrap"><h3><a></a></h3><div class="bili-video-card__info--no-interest">⋮</div></div>';
    const link = el.querySelector('a');
    link.href = '/video/' + id;
    link.textContent = id;
    const trigger = el.querySelector('.bili-video-card__info--no-interest');
    let panel;
    trigger.onmouseenter = () => {
      trigger.classList.add('active');
      panel = document.createElement('div');
      panel.className = 'bili-video-card__info--no-interest-panel';
      for (const reason of ['不想看此UP主', '内容不感兴趣']) {
        const item = document.createElement('div');
        item.className = 'bili-video-card__info--no-interest-panel--item';
        item.textContent = reason;
        item.onclick = () => clicks.push([id, reason]);
        panel.append(item);
      }
      document.body.append(panel);
      onOpen?.(link);
    };
    trigger.onmouseleave = () => { panel?.remove(); trigger.classList.remove('active'); };
    document.querySelector('main .container').append(el);
    await until(() => mock.requests.some(r => r.cards[0].id === id));
    const request = mock.requests.splice(mock.requests.findIndex(r => r.cards[0].id === id), 1)[0];
    request.onload({status:200, responseText:JSON.stringify({revision:mock.revision, results:[{id,decision,rule:'政治'}]})});
    await until(() => el.dataset.cfState === decision || link.href.endsWith('changed'));
    return el;
  }
  try {
    const first = await card('BVoff','block');
    const trigger = first.querySelector('.bili-video-card__info--no-interest');
    const peek = () => mock.roots.findLast(root=>root.host.parentElement===first).querySelector('[value=peek]').click();
    const open = async () => {
      trigger.dispatchEvent(new MouseEvent('mouseenter'));
      await until(()=>document.querySelector('[data-cf-review-actions]'));
      return document.querySelector('[data-cf-review-actions]');
    };
    peek(); const group = await open();
    if (!group.closest('.bili-video-card__info--no-interest-panel') || !group.querySelector('[value=report]')) throw Error('actions outside native menu');
    group.querySelector('[value=mask]').click();
    if (first.dataset.cfState!=='block' || !first.firstElementChild.inert || clicks.length) throw Error('native menu remask');
    trigger.dispatchEvent(new MouseEvent('mouseleave'));
    await sleep(100);
    if (clicks.length) throw Error('disabled preference sent feedback');
    mock.autoNotInterested = true;
    window.dispatchEvent(new Event('focus'));
    await until(() => clicks.length === 1);
    await card('BVallow','allow');
    await card('BVoff','block');
    await card('BVnew','block');
    await until(() => clicks.length === 2);
    await card('BVambiguous','block', () => {
      const other = document.createElement('div');
      other.className = 'bili-video-card__info--no-interest active';
      document.body.append(other);
      setTimeout(() => other.remove(), 1000);
    });
    await sleep(1050);
    await card('BVreuse','block', link => { link.href = '/video/BVchanged'; });
    await card('BVcancel','block', () => { mock.autoNotInterested = false; });
    await sleep(250);
    if (JSON.stringify(clicks) !== JSON.stringify([['BVoff','内容不感兴趣'],['BVnew','内容不感兴趣']])) throw Error('unexpected feedback ' + JSON.stringify(clicks));
    out.textContent = 'PASS';
  } catch (error) { out.textContent = 'FAIL ' + error.message; }
}));
test('homepage skeletons stay native and hydrated covers classify before a video link appears', browserOptions, () => runBrowser(exerciseHydration));
test('slow readable CORS covers stay in the browser and failures explain their source', browserOptions, () => runBrowser(exerciseCorsCover, {corsFixture:true}));
test('slow lazy image waits for its pixels while a ready neighbor is classified', browserOptions, () => runBrowser(exercisePageCover));
test('desktop Bilibili userscript masks new and reused cards, validates replies and opens the rules WebUI', browserOptions, () => runBrowser(exerciseFeed));
test('matched card blur, feedback and picking with rules from WebUI', browserOptions, () => runBrowser(exerciseActions));
test('near-viewport cards receive independent concurrent reviews under the page limit', browserOptions, () => runBrowser(exerciseScheduling));
test('server and browser v1 MAC wire vectors', () => {
  assert.equal(mac('cognition-filter/v1|64881|00112233445566778899aabbccddeeff'), 'ec694decde53acd366563edae759f487746c66a3ef40a4bc4f832c985748d74c');
  assert.equal(mac('cognition-filter/auth/v1|64881'), '85b974361616c33182ec82ae7a150c4bba6214ef735ae2b2ff08c30fa253afd3');
});
test('discovery rejects occupied ports, forged proofs and redirects, then retries and migrates a running filter', browserOptions, () => runBrowser(exerciseDiscovery, {
  livePort: 0, cachedPort: ports[3], probeDelay: 12,
  responses: { [ports[0]]: 'unrelated', [ports[1]]: 'forged', [ports[2]]: 'redirect', [ports[3]]: 'forged',
    [ports[4]]: 'wrong-port', [ports[5]]: 'no-final-url' },
}));
