# Roadmap — the overall plan

> **SINGLE SOURCE OF TRUTH for this project's plans.** Every agent and contributor reads and edits
> *this* file. A new plan is a **row here** — never a new doc at the repo root, never a flat file in
> `docs/agents/`, never a top-level `<name>-plan/` directory. Detail belongs in
> `docs/agents/<area>/<feature>/plan.md`, linked from its row. Enforced by
> `scripts/check-plan-home.sh`. If you found a plan somewhere else, it is stale by definition —
> fold it into a row here and archive it.

The one canonical strategic view: the **initiatives** this project is committed to, in priority order.
One row is one initiative — a body of work that spawns several plan docs and several `in-progress.md`
queue rows — **not** a single task.

Three views, three altitudes, no overlap:
- **`roadmap.md` (this file)** — strategic. Initiatives and their band (Now / Next / Later).
- **`in-progress.md`** — tactical. The queue of what is next, which rolls up into these initiatives.
- **The worklog** (`worklog.md`, or the `CHANGELOG` `[Unreleased]` section) — the change history underneath both.

**This file owns exactly three things:** an initiative's *existence*, its *band*, and its *links down*
to the queue rows and plan docs that execute it. It does **not** restate task status — that is derived
from the linked `in-progress.md` rows — so there is almost nothing here to go stale.

**Update it in the SAME change that starts, reprioritises, or finishes an initiative:**
- New initiative → add a row to Now/Next/Later.
- Its first plan doc or queue row → link it here.
- Its last queue row ships → move the row to **Shipped** with the date, in the same commit as the ship.

## Now — in active development

| Initiative | Intent (one line) | Queue rows (`in-progress.md`) | Plan docs |
|---|---|---|---|
| Drive the signed-in browser | Let a Hermes agent drive the Chrome the operator is already signed into, on every machine he pairs, over a channel that carries only the named actions | row 1 | `browser-control/plan.md` |

## Next — committed, not yet started

| Initiative | Intent | Depends on |
|---|---|---|
| Web Store publication | Ship the extension through the Web Store so pairing does not require an unpacked load — the upstream install-and-pair flow is still an open PR in Hermes | The unpacked flow proven on more than one machine first |
| Per-session multi-browser selection | Let one agent session address more than one paired browser at once | A decision that the extra trust boundary is wanted; today one controller serves one session by design (see the plan's deletion candidates) |

## Later — directional, not yet committed

Records the "why we said no / not yet" so the same idea does not get re-proposed every month
(the strategic twin of `in-progress.md` → Parked).

| Initiative | Why it matters | Revisit when |
|---|---|---|
| A Firefox / Safari port | The same operator constraint applies on other browsers | He actually uses one — every machine named so far runs Chrome |
| A Node/CLI controller client | Would let a headless box be a controller with no browser at all | A machine needs driving that has no Chrome — today the headless box is where the extension already runs |
| A per-site allowlist editor UI | Fine-grained control over what the agent may touch | Only if the config-file list proves too coarse; a UI invites loosening a security boundary casually |

## Shipped

Newest first. Each links to the `completed-features.md` entries that make it up — the strategic index
into the feature log.

| Initiative | Shipped | Features (`completed-features.md`) |
|---|---|---|
| | | |

<!-- Small project? An initiative and a queue row may be nearly the same thing — that is fine. Keep
     this file to a handful of rows; if an initiative needs more than a line, it has become a plan doc,
     not a roadmap entry. But do NOT delete the file: it is step 2 of the AGENTS.md onboarding contract,
     the one place any-provider agent learns the overall arc. -->
