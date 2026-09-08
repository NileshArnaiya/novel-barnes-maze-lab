# Contributing

```bash
pnpm install
pnpm dev        # local server
pnpm test           # tests
pnpm typecheck
pnpm build
```

Node 18+.

## Rules

- Anything in `src/core/` must stay pure: no DOM, no React, no dependencies.
- A change to a measure needs a golden test against a synthetic trajectory with a known
  answer, in the same commit. Testing against tracker output is circular.
- Check the invariants in `CLAUDE.md` before opening a PR. If a change violates one, say
  which and why in the PR description.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`). No squashing history.
- CI runs typecheck, tests, and build on every PR.
- Start with a good first issue: https://github.com/NileshArnaiya/novel-barnes-maze-lab/issues/1 

## Where to start

`src/core/types.ts` is the contract. Read it first, then `src/core/analyze.ts`.
`CURSOR_HANDOFF.md` lists what is unfinished, in priority order.
