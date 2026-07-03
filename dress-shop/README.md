# dress-shop-demo

A small dress store, built the way any frontend team would build it: a store with
subscribers, a tiny router, and plain handler methods. **This commit contains the
application only — no agent layer, no observation layer, no extra dependencies.**

The next commits add [HCIFootprint](https://github.com/footprintjs/hcifootprint) on
top. The point of the commit sequence is the diff itself: how much code an existing
application has to change to become agent-operable (spoiler the diffs will prove:
none of the application's own code).

```bash
npm install
npm test
```
