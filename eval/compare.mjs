import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildMessages, DEFAULT_RULES, parseDecisions, PROMPT_VERSION } from './prompt.mjs';

const { values } = parseArgs({ options: { live: { type: 'boolean' }, suite: { type: 'string' }, report: { type: 'string' } } });
const suitePath = path.resolve(values.suite || fileURLToPath(new URL('./cases.json', import.meta.url)));
const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const variants = ['baseline', 'compact'];

async function loadSuite() {
  const suite = JSON.parse(await readFile(suitePath, 'utf8'));
  assert.ok(Array.isArray(suite) && suite.length, 'Expected a nonempty array of rule groups');
  const ids = new Set();
  const batches = [];
  for (const group of suite) {
    const rules = group.rules === 'default' ? DEFAULT_RULES : group.rules;
    assert.ok(Array.isArray(rules) && rules.length && rules.every(rule => typeof rule === 'string' && rule.trim()));
    assert.ok(Array.isArray(group.cards) && group.cards.length);
    const cards = [];
    for (const card of group.cards) {
      assert.ok(typeof card.id === 'string' && card.id && !ids.has(card.id), 'Expected unique card IDs');
      ids.add(card.id);
      assert.equal(typeof card.title, 'string');
      const [expected] = parseDecisions(JSON.stringify({ v: [card.expected] }), 1, rules.length);
      let imageUrl;
      if (card.cover) {
        const asset = path.resolve(path.dirname(suitePath), card.cover);
        const relative = path.relative(path.dirname(suitePath), asset);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Cover must be in the suite folder');
        const extension = path.extname(asset).slice(1).toLowerCase();
        assert.ok(['png', 'jpeg', 'jpg', 'webp'].includes(extension));
        const bytes = await readFile(asset);
        assert.ok(bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, 'Invalid cover size');
        imageUrl = 'data:image/' + (extension === 'jpg' ? 'jpeg' : extension) + ';base64,' + bytes.toString('base64');
      }
      cards.push({ id: card.id, title: card.title, author: card.author, coverText: card.coverText, imageUrl, expected });
    }
    for (const card of cards) batches.push({ rules, cards: [card] });
  }
  return batches;
}

function checkContract(batches) {
  assert.deepEqual(parseDecisions('{"v":[0,-1,2]}', 3, 2), [0, -1, 2]);
  assert.deepEqual(parseDecisions('{"v":[[3,1,3],[2],[0],[-1]]}', 4, 3), [[1,3], 2, 0, -1]);
  assert.deepEqual(parseDecisions('{"v":["010","011","000","?","101"]}', 5, 3), [2, [2,3], 0, -1, [1,3]]);
  assert.deepEqual(parseDecisions('{"v":["0","1"]}', 2, 1), [0, 1]);
  for (const invalidBits of ['', '0', '0010', '0?1', 'O10', '0 1', '01\n', ' ? ', '１１１']) {
    assert.throws(() => parseDecisions(JSON.stringify({ v: [invalidBits] }), 1, 3));
  }
  for (const invalid of ['{"v":[1]}', '{"v":[3,0]}', '{"v":[0,"1"]}', '{"v":[0.5,1]}',
    '{"v":[0,[1,-1]]}', '{"v":[[],0]}', '{"v":[[1,0],0]}', '{}', '[]', 'broken']) {
    assert.throws(() => parseDecisions(invalid, 2, 2));
  }
  const sizes = {};
  for (const variant of variants) {
    let textCharacters = 0;
    for (const { rules, cards } of batches) {
      const messages = buildMessages(rules, cards, { variant, stage: 'vision' });
      const content = messages.at(-1).content;
      const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
      assert.equal(parts.filter(p => p.type === 'image_url').length, cards.filter(c => c.imageUrl).length);
      textCharacters += messages.slice(0, -1).reduce((sum, m) => sum + m.content.length, 0)
        + parts.reduce((sum, p) => sum + (p.text?.length || 0), 0);
    }
    sizes[variant] = textCharacters;
  }
  return sizes;
}

async function classify(messages, count, ruleCount) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model, messages, thinking: { type: 'disabled' }, temperature: 0,
      response_format: { type: 'json_object' }, max_tokens: 32 + count * (ruleCount * 3 + 18),
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) {
    let diagnostic = '';
    try {
      const { error } = await response.json();
      if (typeof error?.code === 'string' && /^[a-zA-Z\d_-]{1,60}$/.test(error.code)) diagnostic = ' (' + error.code + ')';
    } catch { /* Status is enough when a proxy returns HTML. */ }
    throw new Error('DeepSeek HTTP ' + response.status + diagnostic);
  }
  const result = await response.json();
  const choice = result.choices?.[0];
  const content = choice?.message?.content;
  const output = { usage: result.usage, model: result.model };
  try {
    if (choice?.finish_reason !== 'stop') throw new Error('Incomplete DeepSeek response');
    return { ...output, decisions: parseDecisions(content, count, ruleCount) };
  } catch {
    // Never log model prose or card content, including for a real user's suite.
    let shape = 'invalid JSON';
    try {
      const { v } = JSON.parse(content);
      const scalar = x => Number.isInteger(x) ? x : typeof x;
      shape = Array.isArray(v)
        ? v.slice(0, 32).map(x => Array.isArray(x) ? x.slice(0, 32).map(scalar) : scalar(x))
        : typeof v;
    } catch { /* Only malformed structure is reported. */ }
    return { ...output, invalid: { complete: choice?.finish_reason === 'stop', shape } };
  }
}

function report(rows, usage, models, invalidBatches) {
  const agrees = row => JSON.stringify(row.predicted) === JSON.stringify(row.expected);
  const hits = value => Array.isArray(value) || value > 0;
  const mismatches = rows.filter(row => !agrees(row));
  const blocked = rows.filter(row => hits(row.expected));
  const allowed = rows.filter(row => row.expected === 0);
  const multi = rows.filter(row => Array.isArray(row.expected));
  const ratio = (n, total) => total ? Number((n / total).toFixed(4)) : null;
  const sum = field => usage.every(u => Number.isFinite(u?.[field])) ? usage.reduce((n, u) => n + u[field], 0) : null;
  const totalTokens = sum('total_tokens');
  return {
    models: [...models], count: rows.length, calls: usage.length,
    scoring: '按完整标签集精确匹配。单整数表示唯一标签，漏报、额外标签和无效响应均计错。',
    exactAccuracy: ratio(rows.length - mismatches.length, rows.length),
    multiLabelCount: multi.length, multiLabelExactAccuracy: ratio(multi.filter(agrees).length, multi.length),
    falseBlockRate: ratio(allowed.filter(r => hits(r.predicted)).length, allowed.length),
    falseAllowRate: ratio(blocked.filter(r => r.predicted === 0).length, blocked.length),
    correctlyBlockedRate: ratio(blocked.filter(r => hits(r.predicted)).length, blocked.length),
    undecided: rows.filter(r => r.predicted === -1).length,
    inputTokens: sum('prompt_tokens'), outputTokens: sum('completion_tokens'), totalTokens,
    cachedInputTokens: sum('prompt_cache_hit_tokens'),
    tokensPerCard: totalTokens === null ? null : Number((totalTokens / rows.length).toFixed(1)),
    invalidBatches, mismatches,
  };
}

async function main() {
  const batches = await loadSuite();
  const textCharacters = checkContract(batches);
  const cards = batches.flatMap(b => b.cards);
  const summary = {
    suite: path.basename(suitePath), cards: cards.length,
    withCover: cards.filter(c => c.imageUrl).length, batches: batches.length, textCharacters,
  };
  if (!values.live) {
    console.log(JSON.stringify({ ...summary, mode: 'offline-contract-check' }, null, 2));
    return;
  }
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('Set DEEPSEEK_API_KEY for --live');
  const results = {};
  for (const variant of variants) {
    const rows = [];
    const usage = [];
    const models = new Set();
    const invalidBatches = [];
    for (const { rules, cards: batch } of batches) {
      const messages = buildMessages(rules, batch, { variant, stage: 'vision' });
      const result = await classify(messages, batch.length, rules.length);
      models.add(result.model);
      usage.push(result.usage);
      if (result.invalid) invalidBatches.push({ variant, ids: batch.map(c => c.id), ...result.invalid });
      batch.forEach((card, i) => rows.push({ id: card.id, expected: card.expected, predicted: result.decisions?.[i] ?? null }));
    }
    results[variant] = report(rows, usage, models, invalidBatches);
  }
  const output = JSON.stringify({ ...summary, mode: 'live', measuredAt: new Date().toISOString(), promptVersion: PROMPT_VERSION, requestedModel: model, results }, null, 2);
  if (values.report) await writeFile(values.report, output + '\n');
  console.log(output);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
