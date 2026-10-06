# Plan: <feature name>

- **Area:** `<area>`  ·  **Started:** YYYY-MM-DD  ·  **Status:** In progress
- **Owner:** <who is driving this>
- **Next step:** the exact next action to resume this cold — the file to open, the function to change, the command to run, the blocker. Refresh it every time you stop. _(This is the handoff: a plan with a stale or empty Next step cannot be picked up cold — see `.agents/rules/documentation.md`.)_
- **Roadmap initiative:** the `../../roadmap.md` initiative this plan executes _(delete if this is a standalone one-off with no strategic home — but prefer to name one)_.
- **Spec:** `spec.md` in this folder — the what and why this plan implements. Required for a structural
  change, and it must carry no unresolved `[NEEDS CLARIFICATION: …]` (`scripts/check-spec.sh` enforces
  this; see `.agents/rules/spec.md`). For routine work inside an existing pattern, write "n/a — routine"
  and say in Build notes why it qualified.
- **Domain & experts:** the industry this serves and who outside software was consulted, recorded in
  `spec.md` → `## Domain & outside experts` (`.agents/rules/spec.md`, item 6). If the spec's section
  says no outside expert was consulted, restate that here in one line and why — a plan that reads only
  as software roles is the gap this field exists to close.
- **Parent plan:** _(link if this is a sub-milestone; otherwise delete)_

## Goal

One paragraph. What is true after this ships that is not true now, stated in terms of what a user or
caller can do. Include how we will know it worked.

**Out of scope:** what this deliberately does not do. Naming this prevents scope creep mid-build.

## Context

What a fresh session needs to know to pick this up cold: the current behavior, the files and modules
involved, relevant decisions already made (link the ADR in `../../architecture.md`), and any
constraint that rules out the obvious approach.

## Architecture

Fill this before the first milestone — a plan that cannot name its layers is not ready to build (see
`.agents/rules/clean-architecture.md`). Write "none" where a row genuinely does not apply; delete no row.

- **Layers touched:** which of Entities/Domain · Use Cases/Application · Interface Adapters ·
  Frameworks & Drivers this change adds to or modifies.
- **New ports (interfaces):** name each, the use-case layer it is declared in, and the adapter that
  implements it — or "none".
- **Boundary data:** the DTOs crossing each boundary. Confirm no domain entity is serialized to the
  wire or handed to an ORM by reflection.
- **Dependency direction:** confirm every new dependency points inward. If any points outward, stop —
  raise it in Open questions and get a decision before building (`quality-bar.md`).
- **Swap test:** name the vendor/framework this touches; the diff to replace it must stay inside
  Interface Adapters + Frameworks & Drivers. If an entity or use-case file would appear in that diff,
  the design is not done.

## The Algorithm pass (question · delete · simplify · accelerate · automate)

Run this **in order**, before the milestones below, on any structural change — a new requirement, part,
process, or automation. One line each; skip it only for routine work (typo, copy change, a fix inside an
existing pattern) and say so in Build notes. Full doctrine: `.agents/rules/algorithm.md`.

- **Question** — who asked for this, and which constraint does it serve? _(no name → it does not get built)_
- **Delete** — what can be removed instead? Name the candidates, including "the whole request".
- **Simplify** — what is the least shape that satisfies the named requirement?
- **Accelerate** — what is the measured rate today, and where is the bottleneck?
- **Automate** — is this genuinely the last step, and were 1–3 actually done on it?

### Deletion candidates

**Required section — an empty list must be argued here, not left blank.** Every plan on a structural
change owes this: the candidate, whether it was removed or kept, and why. Deletion is the only step that
leaves no artifact, which is why it is written down instead of intended.

**This list is also the rejections ledger.** A proposal that was considered and turned down is a
candidate — record it here, at the moment the decision is made, rather than leaving it in a chat thread
where the next agent cannot find it. A rejection owes three things: what it was, why it lost, and **what
we are doing instead** — the column exists for the last one. A rejection with no *instead* is unfinished,
and the row is what stops the same idea being re-proposed every month.

| Candidate | Removed? | Why | What we do instead |
|---|---|---|---|
| <part, step, job, gate, or doc> | yes/no/rejected | <the reason — or what depends on it> | <the decision or part that replaced it — required when `rejected`, else `—`> |

## Spec coverage

**Required when this plan has a sibling `spec.md` — the seam check-coverage.sh reads.** Every `FR-NNN`
the spec declares must appear here against a milestone, and every requirement named here must exist in
the spec. The spec rung and the plan rung are individually sound and blind to each other; this table is
the only place the two are joined, so a plan cannot quietly omit a third of the requirements with every
gate green. A requirement with no milestone is either a milestone you have not written or a requirement
you have decided not to serve — in which case delete it from the spec, so the artifact states what is
actually being built.

What this does **not** prove: that the named milestone genuinely delivers the requirement. That residue
is a review question and gets asked there — not answered by a green run.

| Requirement | Milestone |
|---|---|
| FR-001 | M1 |
| FR-002 | M1, M3 |
| FR-003 | deferred — <why, and what triggers it> |

## Milestones

Each milestone is independently reviewable and leaves the system working. Re-read this section at
the start of each one.

- [ ] **M1 — <name>** — <what changes, which files>
- [ ] **M2 — <name>** — <what changes, which files>
- [ ] **M3 — <name>** — tests, docs, and cleanup of anything the change orphaned

If a milestone splits into sub-milestones, nest them below their parent or create a sibling file in
this folder and link it here. **Do not overwrite this file** — the parent plan must stay readable as
a high-level overview.

## Open questions

Blocking decisions for the user, not for you to resolve unilaterally. Delete each one once answered,
recording the answer in Context.

- [ ] <question> — _blocks M2_

## Build notes

Record deviations and discoveries **at the moment you find them**, inline next to the milestone they
affect or appended here. Written later, they are written wrong.

> **Build note:** YYYY-MM-DD — what we expected, what was actually true, and what changed as a result.

## On ship

Move this whole folder into `<area>/completed/`, rename this file to describe what shipped, add an
entry to `../../completed-features.md`, append the final line to the worklog (`../../worklog.md` or the
repo's `CHANGELOG` `[Unreleased]`), remove the item from `../../in-progress.md`, MOVE the initiative in
`../../roadmap.md` (to Shipped if this was its last plan), and promote any durable lesson into
`architecture.md` or `key-patterns.md` — all in the same commit as the ship.
