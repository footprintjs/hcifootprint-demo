/**
 * Per-rule choice attribution: the system prompt is parsed into rule units, and
 * each tool pick is attributed (agentfootprint's attributeChoice) to the rule
 * that best explains it. This is the channel semantic scoring can't see — a
 * PROCEDURAL pick (whats_here) is caused by a system-prompt rule, not the task.
 */
import { describe, expect, it } from 'vitest';
import { attributeChoice, explainChoice, snippetUnits, type ChoiceExplanation } from 'agentfootprint/debug';
import { staticEmbedder } from 'agentfootprint/embedders';
import { descriptionEssence, systemRuleUnits, toWhyAttribution, unwrapResult } from '../src/chatbot/assistant.js';

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

describe('explainChoice over three channels — task + rules + data (potion)', () => {
  it('credits the data channel when the pick echoes an earlier search result (d42)', async () => {
    const dataUnits = snippetUnits({
      results: [
        { id: 'd42', name: 'red floral dress', price: 89 },
        { id: 'd7', name: 'crimson evening gown', price: 149 },
      ],
    });
    const explanation = await explainChoice({
      tool: {
        name: 'skill_purchase',
        text: 'skill_purchase: open dress d42 red floral dress and buy it. Steps: open, confirm purchase',
      },
      units: [
        { id: 'task', channel: 'task', text: 'find me a red dress under $150 and buy the cheapest one' },
        ...systemRuleUnits(),
        ...dataUnits,
      ],
      embedder: staticEmbedder(),
    });
    const data = explanation.channels.find((c) => c.channel === 'data');
    expect(data).toBeDefined();
    expect(data!.share).toBeGreaterThan(0);
    expect(data!.top?.text).toContain('d42');
  }, 30_000);

  it('credits the data channel for the view-dress pick (the ARGUMENTS echo the result)', async () => {
    // The live E2E case: the model picked skill_find-dress with
    // {step: 'catalog.view-dress', input: {dressId: 'd3'}} — d3 exists ONLY
    // because the previous return listed it. The embedded tool text carries the
    // arguments (FIX: tool + input, boilerplate stripped), the data units come
    // from the parsed search results (FIX: unwrapped envelope).
    const searchResults = {
      results: [
        { id: 'd3', name: 'Floral Wrap Dress', price: 120 },
        { id: 'd9', name: 'Silk Slip Dress', price: 145 },
      ],
    };
    const explanation = await explainChoice({
      tool: {
        name: 'skill_find-dress',
        text: 'skill_find-dress: search the dress catalog, filter by color, open one — called with {"step":"catalog.view-dress","input":{"dressId":"d3"}}',
      },
      units: [
        { id: 'task', channel: 'task', text: 'find me a red dress under $150 and buy the cheapest one' },
        ...systemRuleUnits(),
        ...snippetUnits(searchResults, { max: 10 }),
      ],
      embedder: staticEmbedder(),
    });
    const data = explanation.channels.find((c) => c.channel === 'data');
    expect(data).toBeDefined();
    // What MUST be true: the data channel pulls (share > 0) and its best
    // citation is the d3 row. Not asserted: data strictly winning overall —
    // embedding proxies are noisy.
    expect(data!.share).toBeGreaterThan(0);
    expect(data!.top?.text).toContain('d3');
    console.log(
      `view-dress data-channel share: ${data!.share.toFixed(3)} ` +
        `(winner: ${explanation.channels[0].channel} @ ${explanation.channels[0].share.toFixed(3)})`
    );
  }, 30_000);
});

describe('descriptionEssence — cutting the constant bridge boilerplate', () => {
  it('cuts at the "Call with no arguments" marker and trims trailing punctuation', () => {
    const desc =
      'search the dress catalog, filter by color, open one. ' +
      "Call with no arguments to open this skill and see its ready steps; call again with {step: '<name from readySteps>', input: {...}} to perform a step. " +
      'High-effect steps additionally need confirm: true. Steps arrive as DATA in results — they are never separate tools.';
    expect(descriptionEssence(desc)).toBe('search the dress catalog, filter by color, open one');
  });

  it('returns a description without the marker unchanged', () => {
    const desc = 'Why does a state key have its value — the causal chain of recorded actions.';
    expect(descriptionEssence(desc)).toBe(desc);
  });
});

describe("unwrapResult — unwrapping the bridge's {value: string} envelope", () => {
  it('parses a JSON-string value back into the real object', () => {
    const output = { value: '{\n "ok": true,\n "data": {\n  "results": [\n   { "id": "d3", "price": 120 }\n  ]\n }\n}' };
    expect(unwrapResult(output)).toEqual({ ok: true, data: { results: [{ id: 'd3', price: 120 }] } });
  });

  it('returns a non-JSON string value as the string', () => {
    expect(unwrapResult({ value: 'You are on the catalog page.' })).toBe('You are on the catalog page.');
    expect(unwrapResult({ value: '{broken json' })).toBe('{broken json'); // looked like JSON but was not
  });

  it('returns anything else unchanged', () => {
    const plain = { results: [{ id: 'd3' }] };
    expect(unwrapResult(plain)).toBe(plain); // no string value — untouched
    expect(unwrapResult('plain prose result')).toBe('plain prose result'); // not the envelope
    expect(unwrapResult(undefined)).toBe(undefined);
  });
});

describe("toWhyAttribution — mapping the verdict into atui's Why shape", () => {
  // A hand-built ChoiceExplanation: data wins, 10 ranked units (to exercise the
  // row cap), channels already sorted by share (upstream's contract).
  const unit = (id: string, channel: string, score: number, text: string) => ({ id, channel, score, text });
  const ranked = [
    unit('data-1', 'data', 0.8, 'id: d42, name: red floral dress, price: 89'),
    unit('rule-3', 'system', 0.6, 'When a step returns a "data" field, READ it as data.'),
    unit('task', 'task', 0.5, 'find me a red dress under $150 and buy the cheapest one'),
    unit('data-2', 'data', 0.4, 'id: d7, name: crimson evening gown, price: 149'),
    unit('rule-1', 'system', 0.35, 'Call whats_here first.'),
    unit('rule-2', 'system', 0.3, 'For a multi-step task, open its skill tool.'),
    unit('rule-4', 'system', 0.25, 'One-off actions go through do_action.'),
    unit('rule-5', 'system', 0.2, 'High-effect steps need request_confirmation.'),
    unit('rule-6', 'system', 0.15, 'Read rejection reasons and replan.'),
    unit('rule-7', 'system', 0.1, 'Call report_gap before apologizing.'),
  ];
  const explanation: ChoiceExplanation = {
    tool: 'skill_purchase',
    channels: [
      { channel: 'data', share: 0.5, top: ranked[0] },
      { channel: 'system', share: 0.3, top: ranked[1] },
      { channel: 'task', share: 0.2, top: ranked[2] },
    ],
    top: ranked[0],
    units: ranked,
  };
  const why = toWhyAttribution(explanation);

  it('labels every channel in plain words, winner first, with quote + citeLabel', () => {
    expect(why.channels.map((c) => c.id)).toEqual(['data', 'system', 'task']);
    expect(why.channels[0]).toEqual({
      id: 'data',
      label: 'Earlier results',
      share: 0.5,
      quote: 'id: d42, name: red floral dress, price: 89',
      citeLabel: 'a result from the previous step',
    });
    expect(why.channels[1].label).toBe('The rules');
    expect(why.channels[1].citeLabel).toBe('Rule 3'); // derived from the unit id rule-3
    expect(why.channels[2].label).toBe('Your request');
    expect(why.channels[2].citeLabel).toBe('your request');
  });

  it('caps the rows at 8 and marks exactly the top unit as picked', () => {
    expect(why.rows.length).toBe(8);
    expect(why.rows[0]).toEqual({
      label: 'result 1', // data-1 → result 1
      score: 0.8,
      quote: 'id: d42, name: red floral dress, price: 89',
      picked: true,
      channel: 'data',
    });
    expect(why.rows[1].label).toBe('Rule 3');
    expect(why.rows[2].label).toBe('your request');
    expect(why.rows.filter((r) => r.picked).length).toBe(1);
  });

  it('writes the plain-sentence note for the winning channel and omits the headline', () => {
    expect(why.note).toBe('Best explanation: data returned by an earlier step. (similarity estimate — not a mind-read)');
    expect('headline' in why).toBe(false);
  });

  it('names the rules channel in the note when the rules win', () => {
    const rulesWin: ChoiceExplanation = {
      tool: 'whats_here',
      channels: [
        { channel: 'system', share: 0.7, top: ranked[4] },
        { channel: 'task', share: 0.3, top: ranked[2] },
        { channel: 'data', share: 0 }, // no data units — zero-share channel still listed
      ],
      top: ranked[4],
      units: [ranked[4], ranked[2]],
    };
    const w = toWhyAttribution(rulesWin);
    expect(w.note).toBe("Best explanation: the agent's own rules. (similarity estimate — not a mind-read)");
    expect(w.channels[2]).toEqual({ id: 'data', label: 'Earlier results', share: 0 }); // no top → no quote/citeLabel
    expect(w.rows[0]).toEqual({
      label: 'Rule 1',
      score: 0.35,
      quote: 'Call whats_here first.',
      picked: true,
      channel: 'system',
    });
  });
});
