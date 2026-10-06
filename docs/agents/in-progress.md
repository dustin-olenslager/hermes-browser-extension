# In Progress

**Read this first.** The ordered queue of what is next. Top of the list is what to pick up now.
Every item points at a plan doc — if an item has no plan doc, it is not ready to start.

The **Notes** cell of the active row is its handoff: keep the *exact next step* there — the file to
open, the command to run, the blocker — refreshed whenever you pause, so the next session resumes
cold. A row with no next step is a row nobody can pick up. (Doctrine: `.agents/rules/documentation.md`.)

Each row rolls up to a `roadmap.md` initiative (the strategic view) and leaves a trail in the worklog
(`worklog.md` or the `CHANGELOG` `[Unreleased]`). A row with no initiative is tactical work with no
strategic home — add the initiative to `roadmap.md`, or say in Notes why it is a deliberate one-off.

When an item ships: remove its row from here, move its folder into `<area>/completed/`, and add an
entry to `completed-features.md`.

## Active queue

| # | Item | Area | Initiative | Plan doc | Status | Notes |
|---|------|------|------------|----------|--------|-------|
| 1 | Drive the signed-in browser — the extension controller, proven end to end | browser-control | Drive the signed-in browser | `browser-control/plan.md` | In progress — M1–M4 done, M5 in flight | M1–M4 verified: 93 unit tests green with no browser installed, and the real controller client registered against the live gateway, received a routed `browser_snapshot`, and the agent's reply carried the controller's marker (SC-001). Next step = finish M5 — repo docs and the CI gates wired to THIS repo's commands (including the architecture-boundary gate and its canary) — then run the full gate set unfiltered and push the batch. Do NOT re-run the end-to-end proof as a substitute for M5 |

**Status vocabulary:** `Not started` · `In progress — milestone N of M` · `Blocked — <on what>` ·
`In review` · `Done — archiving`.

## Blocked / waiting

Items that cannot move, and the one thing each is waiting on. Review this list before starting
anything new — an unblocked item here outranks a fresh one.

| Item | Blocked on | Since |
|------|-----------|-------|
| Web Store publication | The unpacked flow being proven on more than one machine, and the upstream install-and-pair flow landing in Hermes | 2026-10-06 |

## Parked

Ideas deliberately deferred. Keep the reason — "we said no because X" is what stops the same
proposal coming back every month.

| Item | Why parked | Revisit when |
|------|-----------|--------------|
| A cross-machine controller registry (one session, N browsers, agent picks) | The gateway's lane is per-session and per-controller by design; a global registry would be a new trust boundary and a new failure mode — silently driving the wrong box | The operator asks for one session driving several browsers at once |
| An options page, a per-site allowlist editor, a log view | Two values and a connection state do not need a page, and a second screen is a second thing to keep correct; the allowlist is a security boundary set once, not tuned per action | The popup proves genuinely too small, or the allowlist too coarse |
