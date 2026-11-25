import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const browser = [
  process.env.BROWSER_BIN,
  process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
  '/usr/bin/chromium', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(path => path && existsSync(path));

async function exercise() {
  const el = id => document.getElementById(id);
  const check = (condition, detail) => { if (!condition) throw Error(detail); };
  const until = async predicate => {
    for (let i = 0; i < 150; i++) {
      if (predicate()) return;
      await new Promise(done => setTimeout(done, 20));
    }
    throw Error('timeout: ' + predicate);
  };
  const edit = (input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    await until(() => !el('fields').disabled);
    const language = el('lang-select');
    const switchTo = code => {
      language.value = code;
      language.dispatchEvent(new Event('change', { bubbles: true }));
      check(document.documentElement.lang === code, 'document language was not updated');
    };
    switchTo('zh-CN');
    check(el('apiKey').value === '' && el('key-hint').textContent.includes('已设置'), 'stored key was exposed');
    el('add-provider').click();
    const [name, limit] = el('providers').lastElementChild.querySelectorAll('input');
    edit(name, 'other-model');
    edit(limit, '7');
    edit(el('modelConcurrency'), '2501');
    el('save').click();
    check(!el('modelConcurrency').validity.valid, 'invalid page concurrency accepted');
    edit(el('modelConcurrency'), '6');
    el('save').click();
    await until(() => el('status').textContent.includes('已自动应用'));
    check(el('modelConcurrency').value === '6' && el('providers').children.length === 2, 'reload lost saved settings');
    edit(el('apiKey'), 'new-test-key');
    switchTo('en');
    check(el('apiKey').value === 'new-test-key' && !el('save').disabled, 'language change discarded pending API key');
    check(localStorage.getItem('cf-lang') === 'en' && /Save/i.test(el('save').textContent), 'language preference or action label');
    check(document.querySelector('[aria-label="Disable B站"]'), 'plugin actions were not translated');
    switchTo('zh-CN');
    el('save').click();
    await until(() => el('status').textContent.includes('已自动应用'));
    check(el('apiKey').value === '', 'new key retained after save');
    edit(el('model'), 'unsaved-draft');
    el('save').click();
    await until(() => el('status').textContent.includes('另一处已更新'));
    check(el('save').disabled && el('model').value === 'unsaved-draft', 'conflict discarded draft or retried write');
    const button = label => document.querySelector('[aria-label="' + label + ' B站"]');
    await until(() => button('禁用'));
    const concurrency = () => document.querySelector('[data-sched-field="browser"]');
    const pluginAction = name => document.querySelector('[data-plugin-action="' + name + '"]');
    check(!pluginAction('not-interested').checked, 'native feedback unexpectedly enabled');
    pluginAction('not-interested').click();
    await until(() => pluginAction('not-interested').checked);
    pluginAction('not-interested').click();
    await until(() => !pluginAction('not-interested').checked);
    edit(concurrency(), '12');
    switchTo('en');
    check(concurrency().value === '12', 'language switch discarded site settings');
    pluginAction('save-scheduling').click();
    await until(() => !pluginAction('save-scheduling').disabled);
    check(concurrency().value === '12', 'saved site scheduling was lost');
    pluginAction('reset-scheduling').click();
    await until(() => concurrency().value === '4');
    switchTo('zh-CN');
    button('禁用').click();
    await until(() => button('启用'));
    check(!el('plugin-rows').querySelector('a'), 'disabled site still has install link');
    button('重新加载').click();
    await until(() => el('plugin-rows').textContent.includes('v2'));
    button('启用').click();
    await until(() => button('禁用'));
    check(el('model').value === 'unsaved-draft', 'plugin action discarded configuration draft');
    el('result').textContent = 'PASS';
  } catch (error) { el('result').textContent = error.message; }
  finally { await fetch('/done'); }
}

test('local settings page edits concurrency and key with CSP, preserves drafts on conflict', { skip: !browser, timeout: 45000 }, async () => {
  const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
  const assets = {};
  for (const suffix of ['html', 'css', 'js']) {
    assets[suffix] = await readFile(new URL('../src/settings.' + suffix, import.meta.url), 'utf8');
  }
  let config = {
    model: 'deepseek-flash', apiBase: 'https://api.deepseek.com/', hasApiKey: true, revision: '1',
    providerLimits: { 'deepseek-flash': 2500 }, modelConcurrency: 64, coverConcurrency: 8, browserConcurrency: 4, batchSize: 4,
  };
  const writes = [];
  const plugin = { id: "bilibili", name: "B站", version: "v1", file: "bili.dll", enabled: true, autoNotInterested:false, scheduling: {coverConcurrency:8,browserConcurrency:4}, scheduleRevision:'site-1' };
  let hold;
  let done = false;
  const server = createServer(async (req, res) => {
    const reply = (type, data, status = 200) => res.writeHead(status, { 'Content-Type': type + '; charset=utf-8' }).end(data);
    if (req.url === '/settings') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'");
      reply('text/html', assets.html.replace('__PAIRING_TOKEN__', 'test-pairing-token')
        .replace('</head>', '<script defer src="/exercise.js"></script></head>')
        .replace('</body>', '<pre id="result">STARTED</pre><img src="/hold" alt=""></body>'));
    } else if (req.url === '/settings.css') reply('text/css', assets.css);
    else if (req.url === '/settings.js') reply('text/javascript', assets.js);
    else if (req.url === '/i18n.js') reply('text/javascript', i18n);
    else if (req.url === '/exercise.js') reply('text/javascript', '(' + exercise + ')()');
    else if (req.url.startsWith('/v1/plugins') && req.headers.authorization === 'Bearer test-pairing-token') {
      if (req.url.endsWith('/scheduling')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        if (body.revision !== plugin.scheduleRevision) return reply('application/json', '{}', 409);
        plugin.scheduling = body.scheduling ?? {coverConcurrency:8,browserConcurrency:4};
        plugin.scheduleRevision += '-updated';
      }
      if (req.url.endsWith('/not-interested')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        plugin.autoNotInterested = JSON.parse(Buffer.concat(chunks)).enabled;
      }
      if (req.url.endsWith('/enabled')) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        plugin.enabled = JSON.parse(Buffer.concat(chunks)).enabled;
      }
      if (req.url.endsWith('/reload')) plugin.version = 'v2';
      reply('application/json', JSON.stringify({ plugins: [plugin], errors: [] }));
    }
    else if (req.url === '/v1/config' && req.headers.authorization === 'Bearer test-pairing-token') {
      if (req.method === 'GET') { reply('application/json', JSON.stringify(config)); return; }
      const parts = [];
      for await (const part of req) parts.push(part);
      const body = JSON.parse(Buffer.concat(parts).toString());
      writes.push(body);
      if (writes.length === 3) { reply('application/json', '{}', 409); return; }
      const { apiKey, ...fields } = body;
      config = { ...config, ...fields, hasApiKey: true, revision: String(writes.length + 1) };
      reply('application/json', '{"saved":true}');
    } else if (req.url === '/hold') {
      hold = res;
      if (done) res.end();
    } else if (req.url === '/done') {
      done = true; hold?.end(); res.end();
    } else { reply('text/plain', '', 404); }
  });
  await exercisePage(server, '/settings');
  assert.equal(writes.length, 3);
  assert.equal(writes[0].apiKey, undefined);
  assert.equal(writes[0].browserConcurrency, undefined);
  assert.equal(writes[0].coverConcurrency, undefined);
  assert.equal(writes[0].providerLimits['other-model'], 7);
  assert.equal(writes[1].apiKey, 'new-test-key');
  assert.equal(writes[1].revision, '2');
});

async function exercisePage(server, path) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'cf-settings-test-'));
  try {
    const { stdout } = await promisify(execFile)(browser, ['--headless=new', '--disable-gpu', '--no-first-run',
      '--disable-extensions', '--disable-background-networking', '--user-data-dir=' + profile,
      '--dump-dom', 'http://127.0.0.1:' + server.address().port + path], { timeout: 30000, windowsHide: true, maxBuffer: 2e6 });
    assert.equal(stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1], 'PASS');
  } finally {
    server.close(); server.closeAllConnections();
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}

test('statistics page switches periods and uses decided cards and input tokens for rates', { skip: !browser, timeout: 45000 }, async () => {
  const i18n = await readFile(new URL('../src/i18n.js', import.meta.url), 'utf8');
  const [html, script] = await Promise.all(['html', 'js'].map(ext => readFile(new URL('../src/stats.' + ext, import.meta.url), 'utf8')));
  const fields = [...html.matchAll(/data-field="(\w+)"/g)].map(m => m[1]);
  const session = { ...Object.fromEntries(fields.map(key => [key, 0])), ruleHits: {} };
  const total = { ...session, cards: 11, block: 2, allow: 6, pending: 3, inputTokens: 30, prefixHitTokens: 15, ruleHits: { news: 2 } };
  async function checkPage() {
    const el = id => document.getElementById(id);
    try {
      for (let i = 0; i < 150 && el('numbers').hidden; i++) await new Promise(resolve => setTimeout(resolve, 20));
      el('lang-select').value = 'zh-CN';
      el('lang-select').dispatchEvent(new Event('change', { bubbles: true }));
      if (el('block-rate').textContent !== '25%' || el('prefix-rate').textContent !== '50%') throw Error('rates');
      if (!el('rule-hits').textContent.includes('新闻2')) throw Error('rule counts');
      const cells = i => [...el('site-usage').rows[i].cells].map(cell => cell.textContent).join('|');
      if (cells(0) !== '哔哩哔哩首页|4|2|25%|80%|10|2' || !cells(1).startsWith('removed|') ||
          !cells(2).startsWith('升级前') || el('global-usage').rows[0].cells[4].textContent !== '50%') throw Error('per-site totals');
      el('period').value = 'session';
      el('period').dispatchEvent(new Event('change'));
      if (el('block-rate').textContent !== '—' || !el('rule-hits').textContent.includes('新闻0')) throw Error('session');
      if (el('site-usage').rows.length !== 1 || cells(0) !== '哔哩哔哩首页|0|0|—|—|0|0') throw Error('session site rows');
      el('lang-select').value = 'en';
      el('lang-select').dispatchEvent(new Event('change', { bubbles: true }));
      if (el('period').value !== 'session' || !el('rule-hits').textContent.includes('新闻0')) throw Error('locale change lost statistics period or user rule name');
      el('result').textContent = 'PASS';
    } catch (error) { el('result').textContent = error.message; }
    finally { await fetch('/done'); }
  }
  let hold;
  let done = false;
  const server = createServer((req, res) => {
    const reply = (type, body) => res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }).end(body);
    if (req.url === '/stats') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'");
      reply('text/html', html.replace('__PAIRING_TOKEN__', 'test-stats').replace('</head>', '<script defer src="/check.js"></script></head>')
        .replace('</body>', '<pre id="result"></pre><img src="/hold" alt=""></body>'));
    } else if (req.url === '/check.js') reply('text/javascript', '(' + checkPage + ')()');
    else if (req.url === '/i18n.js') reply('text/javascript', i18n);
    else if (req.url === '/stats.js') reply('text/javascript', script);
    else if (req.url === '/v1/stats' && req.headers.authorization === 'Bearer test-stats') {
      reply('application/json', JSON.stringify({ session, total, ruleNames: { news: '新闻' },
        siteNames:{bilibili:'哔哩哔哩首页'}, bySite:{session:{},total:{
          bilibili:{cards:4,warmupCalls:2,cacheHits:1,inputTokens:10,prefixHitTokens:8,outputTokens:2},
          removed:{cards:2,inputTokens:20,prefixHitTokens:7}}},unattributed:{cards:5} }));
    } else if (req.url === '/hold') { hold = res; if (done) res.end(); }
    else if (req.url === '/done') { done = true; hold?.end(); res.end(); }
    else res.writeHead(404).end();
  });
  await exercisePage(server, '/stats');
});

test('WebUI edits individual rule points and keeps a conflicting draft', { skip: !browser, timeout: 45000 }, async () => {
  const fetchAsset = file => readFile(new URL('../src/' + file, import.meta.url), 'utf8');
  const [html, script, i18n, css] = await Promise.all(['rules.html','rules.js','i18n.js','settings.css'].map(fetchAsset));
  const legacyText = '旧'.repeat(200);
  let state = {revision:'initial', sites:{bilibili:'哔哩哔哩首页'}, groups:[{id:'legacy-demo',name:'示例',enabled:true,include:[legacyText],exclude:[]}]};
  let writes = 0, payload, hold, done = false;
  async function exerciseRules() {
    const q = sel => document.querySelector(sel);
    const until = async fn => {
      for (let i=0; i<150; i++) {
        if (fn()) return;
        await new Promise(r => setTimeout(r, 20));
      }
      throw Error('timeout ' + fn);
    };
    const edit = (input,text) => {
      input.value=text;
      input.dispatchEvent(new Event('input', {bubbles:true}));
    };
    try {
      await until(() => !q('#fields').disabled);
      q('[data-kind="exclude"] .rule-add-point').click();
      const point = q('[data-kind="exclude"] .rule-point-input');
      edit(point,'正常评测');
      q('[data-kind="exclude"] input[type=checkbox]').click();
      q('#lang-select').value='en';
      q('#lang-select').dispatchEvent(new Event('change'));
      const scope = q('.rule-scope');
      if (scope.value || scope.options[0].text !== 'Global (all sites)') throw Error('global scope missing');
      scope.value='bilibili';
      scope.dispatchEvent(new Event('change'));
      if (point.value!=='正常评测') throw Error('lost draft');
      q('#save').click();
      await until(() => !q('#fields').disabled && q('#save').disabled);
      q('#add-group').click();
      const card=q('.rule-group-card:last-child');
      edit(card.querySelector('.rule-group-name-input'),'我的新规则');
      edit(card.querySelector('.rule-point-input'),'文字评论合集');
      q('#save').click();
      await until(() => !q('#fields').disabled && q('#save').disabled);
      if (card.querySelector('.rule-group-name-input').value!=='我的新规则' || !q('#status').textContent.includes('elsewhere')) throw Error('missing conflict or draft');
      q('#result').textContent='PASS';
    } catch(e) { q('#result').textContent=e.message; }
    finally { await fetch('/done'); }
  }
  const server = createServer(async (req,res) => {
    const reply=(type,body,status=200)=>res.writeHead(status,{'Content-Type':type+'; charset=utf-8'}).end(body);
    if(req.url==='/rules') {
      res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'");
      reply('text/html',html.replace('__PAIRING_TOKEN__','rules-test').replace('</head>','<script defer src="/exercise.js"></script></head>').replace('</body>','<pre id="result"></pre><img src="/hold" alt=""></body>'));
    } else if(req.url==='/exercise.js') reply('text/javascript','('+exerciseRules+')()');
    else if(req.url==='/rules.js') reply('text/javascript',script);
    else if(req.url==='/i18n.js') reply('text/javascript',i18n);
    else if(req.url==='/settings.css') reply('text/css',css);
    else if(req.url==='/v1/admin/rules' && req.headers.authorization==='Bearer rules-test') {
      if(req.method==='PUT') {
        writes++;
        const chunks=[];
        for await (const chunk of req) chunks.push(chunk);
        payload=JSON.parse(Buffer.concat(chunks));
        if(writes>1) return reply('application/json','{}',409);
        state={...state,...payload, revision:'second'};
      }
      reply('application/json', JSON.stringify(state));
    } else if(req.url==='/hold') { hold=res; if(done) res.end(); }
    else if(req.url==='/done') { done=true; hold?.end(); res.end(); }
    else res.writeHead(404).end();
  });
  await exercisePage(server,'/rules');
  assert.equal(writes,2);
  assert.deepEqual(state.groups[0].disabledExclude,['正常评测']);
  assert.equal(state.groups[0].include[0],legacyText);
  assert.equal(state.groups[0].site,'bilibili');
  assert.equal(payload.groups[1].site,null);
  assert.equal(payload.revision,'second');
  assert.equal(payload.groups[1].include[0],'文字评论合集');
});
