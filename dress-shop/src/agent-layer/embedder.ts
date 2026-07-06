/**
 * The semantic embedder for tool-choice scoring — the "external model" that
 * makes agentfootprint's toolChoiceRecorder produce REAL ranked bars (instead
 * of the lexical proxy). Deliberately OPTIONAL: it exists only when an
 * OPENAI_API_KEY is present. Without one, makeEmbedder() returns null, the
 * scorer isn't attached, and the debugger shows "Semantic score: off" with a
 * tooltip — never a faked/weak score.
 *
 * A tiny fetch wrapper (no OpenAI SDK dep) implementing agentfootprint's
 * Embedder interface. Anthropic has no embeddings API, so this is a separate,
 * advanced opt-in — swap OpenAI for Voyage/Cohere/a local model here.
 */
import type { Embedder } from 'agentfootprint/memory';

const MODEL = process.env['OPENAI_EMBED_MODEL'] ?? 'text-embedding-3-small';
const DIMENSIONS = 1536; // text-embedding-3-small

/** An OpenAI embedder if a key is configured, else null (semantic scoring off). */
export function makeEmbedder(): Embedder | null {
  const key = process.env['OPENAI_API_KEY'];
  if (!key || !key.trim()) return null;

  async function call(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: MODEL, input: texts }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  return {
    dimensions: DIMENSIONS,
    async embed(args) {
      return (await call([args.text], args.signal))[0];
    },
    async embedBatch(args) {
      return call([...args.texts], args.signal);
    },
  };
}
