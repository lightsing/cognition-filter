import { readFileSync } from 'node:fs';
const templates = JSON.parse(readFileSync(new URL('../config/prompts.json', import.meta.url), 'utf8'));
export const PROMPT_VERSION = templates.version;
const groups = JSON.parse(readFileSync(new URL('../config/default-rules.json', import.meta.url), 'utf8'));
// Keep the evaluation's numbered default rules identical to the agent's compile_group output.
export const DEFAULT_RULES = Object.freeze(groups.filter(group => group.enabled).map(group => {
  if (group.id.startsWith('legacy-') && group.include.length === 1 && !group.exclude.length) return group.include[0];
  const rule = group.name + '。' + group.include.join('；') + '。';
  return group.exclude.length ? rule + '保留' + group.exclude.join('；') + '。' : rule;
}));

const instructions = { compact: templates.compact, baseline: templates.baseline };

// The local agent supplies only the visible card data and resolved cover assets.
export function buildMessages(rules, cards, { variant = 'compact', stage = 'text' } = {}) {
  if (!Object.hasOwn(instructions, variant) || !['text', 'vision'].includes(stage)) {
    throw new TypeError('Unknown prompt variant or input stage');
  }
  const ruleText = rules.map((rule, index) => [index + 1, rule]);
  const ruleTurn = templates.rule_turn.replace('{rules}', () => JSON.stringify(ruleText));
  if (cards.length !== 1) throw new TypeError('A review requires one card');
  const prefix = templates.prefix;
  const parts = [];
  let lines = [prefix];
  for (const [index, card] of cards.entries()) {
    const row = [index + 1, card.title || ''];
    if (card.author || card.coverText) row.push(card.author || '');
    if (card.coverText) row.push(card.coverText);
    lines.push(JSON.stringify(row));
    if (stage === 'vision' && card.imageUrl) {
      parts.push({ type: 'text', text: lines.join('\n') }, { type: 'image_url', image_url: { url: card.imageUrl, detail: 'low' } });
      lines = [];
    }
  }
  if (lines.length) parts.push({ type: 'text', text: lines.join('\n') });
  return [
    { role: 'system', content: instructions[variant] },
    { role: 'user', content: ruleTurn },
    { role: 'assistant', content: '{}' },
    { role: 'user', content: parts.length === 1 ? parts[0].text : parts },
  ];
}

export function parseDecisions(content, count, ruleCount) {
  const response = JSON.parse(content);
  if (!Array.isArray(response?.v) || response.v.length !== count) {
    throw new Error('Wrong number of card decisions');
  }
  return response.v.map(value => {
    if (value === '?') return -1;
    if (typeof value === 'string' && value.length > 0 && value.length === ruleCount && !/[^01]/.test(value)) {
      const hits = [];
      for (let i = 0; i < value.length; i++) if (value[i] === '1') hits.push(i + 1);
      return hits.length > 1 ? hits : hits[0] ?? 0;
    }
    if (Number.isInteger(value) && value >= -1 && value <= ruleCount) return value;
    if (Array.isArray(value) && value.length === 1 && (value[0] === 0 || value[0] === -1)) return value[0];
    if (Array.isArray(value) && value.length && value.every(n => Number.isInteger(n) && n >= 1 && n <= ruleCount)) {
      const hits = [...new Set(value)].sort((a, b) => a - b);
      return hits.length === 1 ? hits[0] : hits;
    }
    throw new Error('Invalid rule index in model decisions');
  });
}
