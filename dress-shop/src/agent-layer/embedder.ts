/**
 * The embedding model for the SEMANTIC tool-choice strategy — now sourced from
 * agentfootprint's ready-made embedders (agentfootprint/embedders). All three
 * ship in the library; the heavy ones are OPTIONAL peer deps you install only if
 * you use them:
 *
 *   EMBEDDER=openai   → hosted (needs OPENAI_API_KEY)                — default when a key is set
 *   EMBEDDER=local    → on-device MiniLM (needs @huggingface/transformers) — no key, offline
 *   EMBEDDER=static   → pure-JS potion (needs @yarflam/potion-base-8m)     — no key, no network
 *   EMBEDDER=none     → semantic scoring off (the debugger greys it)  — default with no key
 *
 * With none of these, the debugger's "LLM" strategy (the model scoring each tool
 * from its own reasoning) still works with just the Anthropic key.
 */
import { openaiEmbedder, localEmbedder, staticEmbedder } from 'agentfootprint/embedders';
import type { Embedder } from 'agentfootprint/memory';

export function makeEmbedder(): Embedder | null {
  const kind = process.env['EMBEDDER'] ?? (process.env['OPENAI_API_KEY'] ? 'openai' : 'none');
  switch (kind) {
    case 'openai':
      return openaiEmbedder(); // reads OPENAI_API_KEY
    case 'local':
      return localEmbedder(); // needs @huggingface/transformers installed
    case 'static':
      return staticEmbedder(); // needs @yarflam/potion-base-8m installed
    default:
      return null; // semantic scoring off
  }
}
