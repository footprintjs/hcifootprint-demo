/**
 * Per-rule choice attribution: the system prompt is parsed into rule units, and
 * each tool pick is attributed (agentfootprint's attributeChoice) to the rule
 * that best explains it. This is the channel semantic scoring can't see — a
 * PROCEDURAL pick (whats_here) is caused by a system-prompt rule, not the task.
 */
import { describe, expect, it } from 'vitest';
import { attributeChoice } from 'agentfootprint/debug';
import { staticEmbedder } from 'agentfootprint/embedders';
import { systemRuleUnits } from '../src/chatbot/assistant.js';

describe('systemRuleUnits — parsing the system prompt into rules', () => {
  const rules = systemRuleUnits();

  it('extracts the numbered rules in order (the two "4." lines stay separate)', () => {
    // 1 whats_here · 2 skill-open · 3 data · 4 do_action · 4 request_confirmation
    // · 5 rejected · 6 report_gap  →  parsed by ORDER as rule-1 … rule-7
    expect(rules.length).toBe(7);
    expect(rules.every((r) => r.channel === 'system')).toBe(true);
    expect(rules.map((r) => r.id)).toEqual(['rule-1', 'rule-2', 'rule-3', 'rule-4', 'rule-5', 'rule-6', 'rule-7']);
    expect(rules[0].text).toMatch(/call whats_here first/i);
    expect(rules[3].text).toMatch(/do_action/i); // first "4."
    expect(rules[4].text).toMatch(/request_confirmation/i); // second "4."
    expect(rules[6].text).toMatch(/report_gap/i);
  });

  it('folds indented continuation lines into their rule and stops at the tail', () => {
    expect(rules[0].text).toMatch(/which actions and skills exist right now/i); // rule-1 continuation
    expect(rules.some((r) => /keep replies short/i.test(r.text))).toBe(false); // tail excluded
  });
});

describe('attributeChoice over the real parsed rules (potion)', () => {
  it('attributes the procedural pick whats_here to rule-1', async () => {
    const units = [
      { id: 'task', channel: 'task', text: 'find me a red dress under $150' },
      ...systemRuleUnits(),
    ];
    const r = await attributeChoice({
      tool: { name: 'whats_here', text: 'whats_here: describe the current position and what is fireable now' },
      units,
      embedder: staticEmbedder(),
    });
    expect(r.top.id).toBe('rule-1');
    expect(r.top.channel).toBe('system');
    expect(r.byChannel['system'] ?? 0).toBeGreaterThan(r.byChannel['task'] ?? 0);
  }, 30_000);
});
