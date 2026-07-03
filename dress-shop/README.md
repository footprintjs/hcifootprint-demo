# dress-shop-demo

A small dress store that becomes an **agent-operable application** — told in three commits,
because the diff *is* the demo.

## The three commits

| Commit | What it adds | What it proves |
|---|---|---|
| 1 | **The application, and nothing else.** A store with subscribers, a tiny router, plain handler methods. | The unbiased baseline — built with zero knowledge of any agent layer. |
| 2 | **The agent layer** ([HCIFootprint](https://github.com/footprintjs/hcifootprint)): `src/agent-layer/graph.ts` (the declared skill graph) + `connect.ts` (three wires: store subscription → tap, router → tool mount/unmount + cursor, existing handlers registered **by reference**). | `git diff <commit1> <commit2> -- src/app` → **empty**. The app's own code did not change. The integration tests show position-aware tools, inference-attributed user actions, an agent purchase inside a skill frame, guards mirroring the app's invariants, and hostile catalog text confined to the data channel. |
| 3 | **The assistant** ([agentfootprint](https://github.com/footprintjs/agentfootprint) + Claude): chat drives the same session the user's clicks flow through. | The whole family in one loop — and **human-in-the-loop by checkpoint**: placing an order pauses the agent run (footprint pause/resume via `askHuman`), you approve at the prompt, the run resumes with your answer. The dispatcher refuses to fire high-effect actions without a real approval. |

The pitch this proves: *an agentic version of your application with zero backend changes and zero
component changes* — the agent inherits the signed-in user's capability envelope by driving the
app's existing handlers, which call the backend through its existing, already-enforced paths.

## Run it

```bash
npm install
npm test            # commits 1+2: the app's tests + the integration proof (no API key needed)

cp .env.template .env   # add your ANTHROPIC_API_KEY
npm run chat        # commit 3: the assistant
# you> find me a red dress and buy it
# confirm> Place the order for 1 item ($120)? (yes/no)
```

`/state` and `/brief` at the prompt show the live projected state and the agent's own
session context. `.env` is gitignored; only `.env.template` is committed.
