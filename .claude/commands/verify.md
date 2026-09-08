---
description: Run the full verification pass before a commit
---

Run in order and report each result:

1. `npm run typecheck`
2. `npm test`
3. `npm run build`

Then check the diff against the invariants in CLAUDE.md, one at a time, and say which
ones the change touches.

Finally: is there a moment in this change where the model produced something wrong that
was caught? If so, append it to AI_NOTES.md with the tell and how it was caught. Those
are much harder to reconstruct later than they are to write down now.
