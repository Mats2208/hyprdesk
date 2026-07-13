<!--
Thanks for the PR. Keep it focused: one concern per PR is much easier to review and to revert.
-->

## What and why

<!-- What changes, and what problem it solves. Link the issue if there is one. -->

Closes #

## How I verified it

<!--
Not "it compiles" — how do you know it *works*? Drove the real app? Reproduced the bug first, then
watched it disappear? Say what you actually observed.
-->

- [ ] `pnpm exec tsc --noEmit` passes
- [ ] `pnpm build` passes
- [ ] `cargo clippy --all-targets -- -D warnings` passes (in `desktop/src-tauri`)
- [ ] Ran the app (`pnpm tauri dev`) and exercised the change

**Platform tested:** <!-- Windows / macOS — say which. CI covers both, but the app is a desktop app: a human should have used it. -->

**Engines tested:** <!-- claude / codex / opencode — if the change touches agents, terminals or sessions -->

## Notes for the reviewer

<!-- Anything non-obvious: a trade-off you made, something you left out on purpose, a risk. -->
