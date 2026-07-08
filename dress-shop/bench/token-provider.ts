/**
 * The token meter — a transparent LLMProvider wrapper that counts exactly what
 * the API processed, per call, at the provider boundary.
 *
 * This is the benchmark's ONE token instrument, handed identically to BOTH
 * modalities (the hcifootprint assistant AND the DOM baseline). Because it sits
 * at the `complete()` / `stream()` boundary it counts real billed tokens — it
 * does not depend on any recorder, pricing table, or display trace, and it can
 * never over- or under-count relative to what the model was actually sent.
 *
 * `llmCalls` = ReAct iterations (one provider call each). `toolCalls` = the
 * total tool_use blocks the model emitted across the run. Both are read from
 * the provider's own responses, so the two modalities are counted the same way.
 */
import type { LLMChunk, LLMProvider, LLMResponse } from 'agentfootprint/llm-providers';

export interface CallRecord {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly toolCalls: number;
}

export interface TokenTotals {
  /** Number of provider calls == ReAct iterations. */
  readonly llmCalls: number;
  /** Total tool_use blocks emitted across all calls. */
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  /** inputTokens + outputTokens (the headline number H9 compares). */
  readonly totalTokens: number;
}

export interface CountingProvider {
  /** Pass this to the Agent / assistant instead of the raw provider. */
  readonly provider: LLMProvider;
  /** One record per LLM call, in call order. */
  readonly calls: readonly CallRecord[];
  /** Aggregated totals for the run so far. */
  totals(): TokenTotals;
}

/** Sum a list of per-call records into headline totals. Pure — unit-tested. */
export function sumCalls(calls: readonly CallRecord[]): TokenTotals {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let toolCalls = 0;
  for (const c of calls) {
    inputTokens += c.inputTokens;
    outputTokens += c.outputTokens;
    cacheReadTokens += c.cacheReadTokens;
    cacheWriteTokens += c.cacheWriteTokens;
    toolCalls += c.toolCalls;
  }
  return {
    llmCalls: calls.length,
    toolCalls,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

/**
 * Wrap a provider so every `complete()` (and, if present, `stream()`) records
 * the usage the API reported. The wrapper is otherwise fully transparent — it
 * forwards the request unchanged and returns the response unchanged.
 */
export function createCountingProvider(inner: LLMProvider): CountingProvider {
  const calls: CallRecord[] = [];
  const record = (res: LLMResponse): void => {
    calls.push({
      inputTokens: res.usage.input,
      outputTokens: res.usage.output,
      cacheReadTokens: res.usage.cacheRead ?? 0,
      cacheWriteTokens: res.usage.cacheWrite ?? 0,
      toolCalls: res.toolCalls.length,
    });
  };

  const provider: LLMProvider = {
    name: inner.name,
    complete: async (req) => {
      const res = await inner.complete(req);
      record(res);
      return res;
    },
  };

  // Only expose stream() if the inner provider has it — Agent picks the path;
  // exactly one of complete()/stream() fires per LLM call, so no double count.
  if (typeof inner.stream === 'function') {
    const innerStream = inner.stream.bind(inner);
    (provider as { stream?: LLMProvider['stream'] }).stream = async function* (req): AsyncIterable<LLMChunk> {
      for await (const chunk of innerStream(req)) {
        if (chunk.done && chunk.response) record(chunk.response);
        yield chunk;
      }
    };
  }

  return {
    provider,
    calls,
    totals: () => sumCalls(calls),
  };
}
