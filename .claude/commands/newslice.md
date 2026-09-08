---
description: Start a scoped vertical slice with explicit done-criteria
---

Before writing any code, state:

1. The slice, in one sentence, phrased as something the user can do afterwards.
2. Its done-criteria, as a checkable list.
3. Which files it touches. If more than four, the slice is too big; split it.
4. How it will be verified: which golden test, or which thing to look at on screen.

Then implement only that slice. Do not add adjacent improvements you notice on the way;
list them at the end instead.

If the slice touches anything in `src/core/`, add or update a test in `test/core.test.ts`
in the same change. A measure without a test against a known answer is not finished.

Check the change against the invariants in CLAUDE.md before declaring it done. If it
violates one, say which and why, rather than proceeding quietly.
