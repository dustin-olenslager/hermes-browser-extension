# Workflow: Change Approval & Planning

> **Applies when:** always — this is the baseline collaboration protocol for every project.
> **Delete this file (and its `@` import in the generated agent hub) if:** never. If you disagree with a rule, edit it; do not delete the module.

## Pre-flight — before any proposal

You cannot propose a change to a repo whose state you have not read. Before planning anything:

- `git fetch --prune`, then survey branches, worktrees, and open PRs (`git branch -a`, `git worktree list`, `gh pr list --state open`).
- Read the central plan doc (`docs/agents/roadmap.md` in kit repos; the repo's one plan doc where the adapt has set a lighter one), the running worklog, and only then the code you are about to change.
- **Carry forward in-flight work** — continue the queued task or the open PR; never open a parallel track for work already in progress. (Full mechanics: `git-workflow.md` → Pre-flight.)

## The Algorithm pass — run before you plan, on anything structural

Order: **question the requirement (name it) → delete what you can → simplify → accelerate → automate
last.** Before proposing a non-trivial change, a new process, or an automation, answer these in the plan
doc (one line each): who asked and which constraint it serves; what can be removed instead; the least
shape that satisfies it; the measured cycle-time number and bottleneck; and whether automation is
genuinely last. **Every plan owes a deletion candidate list — "nothing can be deleted here" must be
argued, not assumed.** Skip the pass for routine work (typo, copy change, a fix inside an existing
pattern) and say what you did. Full doctrine, the per-step artifacts, and the scope test:
`.agents/rules/algorithm.md`.

## Change Approval

- **Describe your proposed changes and get approval before editing code.** State what you plan to change, which files, and why — then stop and wait for confirmation. Editing first and explaining after removes the user's only cheap moment to redirect you.
- **Write the plan into the plan doc and present it before code.** The plan states the goal in one sentence, the phases, and the exit criteria, and it is presented to the owner for an explicit yes/no — in plain language, written for a non-technical reader. A plan that lives only in the chat summary was never approved.
- **This applies to bug fixes exactly as much as to features.** "It's just a fix" is the most common excuse for skipping approval, and fixes are where wrong assumptions do the most damage.
- **Never assume the root cause. State your hypothesis and let the user confirm or redirect.** Say "I believe X is happening because Y — do you want me to fix it there?" rather than silently fixing what you guessed. The user usually knows something about the system you cannot see from the code, and a confident wrong diagnosis costs a full rewrite.
- **Name the layers the change touches** — Entities/Domain, Use Cases/Application, Interface Adapters, Frameworks & Drivers (see `clean-architecture.md`). A proposal written as a list of file paths hides the one thing worth catching early: which way the new dependencies point.
- **If the change would point a dependency outward, raise it before you write it, not after.** At proposal time it is a sentence and a redesign; once the code exists and works, nobody rewrites working code to fix an import direction, and the violation becomes permanent.
- When you find a second problem while fixing the first, surface it — do not fold it into the current change without asking. Scope creep smuggled into an approved change is unreviewable.
- **When the decision is genuinely the owner's, present it as two options plus a recommendation — never as a prose block.** Tappable, decidable in one read: what each option is, what it costs now and later, and which one you recommend and why (`quality-bar.md`). Do not start on either option while the question is open.

### What counts as trivial (no approval needed)

Proceed directly, and mention what you did afterward, when the change is:

- A typo, comment, or string fix with no behavioral effect.
- A one-line change the user explicitly described and asked you to make.
- Formatting, import ordering, or lint autofixes.
- Adding a log line or assertion to diagnose something, with no production behavior change.
- Any change fully contained in a file you were just asked to write.

Everything else — new files, new dependencies, schema/API/interface changes, anything touching more than one file, anything you would need a paragraph to explain — needs approval first. When in doubt, ask; asking costs one message, a wrong rewrite costs an hour.

This carve-out is itself a setting: a project that chose the **strict** protocol at adapt time deletes the list above, and every change — trivial or not — gets described and approved first.

## Planning Workflow

- **A plan is a roadmap row first, never a new directory.** The moment you start work, add a row to the project's `docs/agents/roadmap.md` (Now/Next/Later) — in the same session, even if that row is the only artifact and the plan dies the same day. A dead roadmap row beats a lost plan. Never create a top-level `<name>-plan/`, `<name>-specs/`, or `scratch_*` plan directory; that scatter is exactly what this rule eliminates. Deeper detail goes in `docs/agents/<area>/<slug>/plan.md` inside the repo, linked from the row.
- **The plan doc is the SINGLE place every agent reads and edits plans.** A kit repo's plan home is the `docs/agents/` spine: `roadmap.md` (the single canonical plan doc) with the `in-progress.md` queue row and a detailed plan doc under `docs/agents/<area>/<feature>/plan.md` linked from it. A project too small for that spine may keep ONE lightweight `docs/PLAN.md` (a status table + the worklog) as its plan home — same rule, fewer pieces. What is never the plan home: a root-level `PLAN.md` (that is the stray `check-plan-home.sh` exists to reject), a second parallel plan doc, and **GitHub Issues** — an issue is a note that gets folded into the plan doc, never the doc itself. Before planning anything, read it; when you plan anything, write there. `scripts/check-plan-home.sh` enforces the plan **home** mechanically in CI and pre-commit: no plan-shaped file outside the canonical tree (`docs/agents/roadmap.md`, `in-progress.md`, `_templates/*`, `reports/*`, `<area>/<feature>/plan.md`, and the completed archives), and `roadmap.md` must exist. It checks **location, not content** — that you actually added a roadmap row, linked the plan, and moved the initiative are prose obligations enforced by review, not by the script (`PLAN_HOME_ALLOW` for a legitimate exception, `PLAN_HOME_OFF=1` while adopting a repo with a backlog). Pre-commit (`--staged`) catches only *newly added* strays; the CI run over the tracked tree catches every one.

- **A spec precedes the plan on anything structural.** Before `plan.md`, write `docs/agents/<area>/<slug>/spec.md` — what a user can do after this ships, prioritized stories each with an independent test, Given/When/Then acceptance scenarios, and numbered `MUST` requirements. An unknown is written `[NEEDS CLARIFICATION: …]` and may live only in a draft spec: resolve it, or delete the requirement, before the plan exists. `scripts/check-spec.sh` enforces presence and resolution in CI; routine work inside an existing pattern is exempt (say so). Full doctrine: `spec.md`.
- **The spec names the domain and the outside experts — this is planning, not review.** The spec's `## Domain & outside experts` section records the industry the software is built for and which outside practitioners were consulted (the filmmaker, the restaurateur), with what they said. UI/UX is a **planning input** too: for a user-facing feature, the flow and information-architecture findings come from the `ux-designer` persona, and behaviour claims from the `ux-researcher` persona, before acceptance scenarios are written — design decided after the plan exists is design reviewed against a decision already made. Non-UI work writes `n/a — no user-facing surface`. **Placeholders until a real person was consulted; never a fabricated quote or an invented name.**
- **Enter plan mode before any non-trivial or multi-step work.** Any feature, milestone, or task spanning more than a couple of files starts with a plan — use the planning tool, not an informal chat summary, so the plan is an artifact rather than a paragraph that scrolls away. Present it to the owner (plain language, above) and let the plan — not the chat memory — be what was approved.
- **ALWAYS persist the plan to a file under `docs/agents/`.** A plan that exists only in chat context dies at the next compaction, and you will silently resume with a different plan than the one that was approved. The file is the source of truth; the chat is not.
  - Copy `docs/agents/_templates/plan.md` as the starting point.
  - Write it into the relevant area folder, not flat in `docs/agents/` — e.g. `docs/agents/<area>/<feature>/plan.md`. See `docs/agents/_templates/feature-area/README.md` for the folder convention.
  - Link the new plan from `docs/agents/in-progress.md` in the same step, or nobody will find it.
- **When a milestone splits into sub-milestones, do not overwrite the parent plan.** Either nest the sub-milestones inline under their parent, or create a sibling file in the same folder and link to it from the parent. The parent plan must stay readable as a high-level overview — that overview is what a future session reads first to reorient, and flattening it into task-level detail destroys it.
- **Re-read the plan file at the start of each milestone.** Do this even if you "remember" the plan; after a compaction your memory of it is a summary of a summary.
- **Update the plan as work completes** — check off finished milestones, and record deviations inline with a `> **Build note:**` line explaining what you found and why the approach changed. Discoveries made during the build are the most valuable content in the file and the first thing lost if you do not write them down.
- If the work turns out to be materially different from the plan, stop and re-plan with the user rather than improvising forward. A plan that no longer matches reality is worse than no plan, because it still looks authoritative.

## Before you propose

The approval you are asking for is only as good as the proposal. Before you describe a change, run
the self-check in `quality-bar.md` — it governs *what* you propose; this file governs *when and how*
you propose it.

## Expert Review (non-trivial changes)

- **Every non-trivial change requires structured expert review before merge.** Trivial changes (per the list above, plus: single file, ≤15 lines added, no schema/API/interface file — the gate treats `.sql`, `.prisma`, `.graphql`, `.proto`, `.openapi`, `.yaml`, and `.yml` as schema, so a single 15-line workflow edit is NOT trivial — or PR labeled `trivial` / commit prefixed `trivial:`) skip this gate.
- **An agent's self-report is not review evidence.** "Tests pass," "done," and "it works" from the agent that wrote the change verify nothing — authorship and evidence must be independent. Non-trivial work is re-reviewed independently (by a second reviewer or a review agent reading only the diff), and the gate below exists because that requirement is easy to claim and easy to skip.
- **Review dimensions are not personas.** The default review lenses are **Security, Performance,
  Maintainability, and UX** — four *dimensions* every non-trivial change is reviewed on. They map to no
  file, and this list deliberately does not claim they do. Domain-specific review is added per project,
  and where a project keeps persona files (`.agents/personas/`), a persona named in review evidence must
  be a file that exists. The kit ships two — `ux-designer` and `ux-researcher` — and both are **planning**
  consultations (see "Planning Workflow"), so a review that only names a dimension is honest, and one
  that names a missing file is a defect.
- **Review evidence required (checked by `scripts/check-expert-review.sh` in CI, for the change under
  review):** the gate asks whether review evidence EXISTS for this change, and nothing more. Its
  contract:
  1. a plan doc exists under `docs/agents/**` (the plan home — see "Planning Workflow" above);
  2. a checklist item exists under `docs/agents/**`, **checked or unchecked**. Requiring an OPEN item
     would block a repo that had *finished* its work — the definition of done — until someone added a
     fake open task, so the gate deliberately asks only that review evidence exist, not that work
     remain. The checklist lives in the plan doc; a separate `checklist.md` is not required.
  3. review sign-off in the PR description (≥2 named reviewers, e.g. `Security: ✓`, `Performance:
     LGTM` — a review *dimension* or a persona *file* that exists, per the bullet above) is checked
     **only when the repo opts in** (`EXPERT_REVIEW_REQUIRE_SIGNOFFS=1`). It is
     off by default: an enforcement that switches on as a side effect of a `gh` credential is not
     enforcement anyone agreed to. Where it is off, sign-off is a review obligation, not a gate.
  The gate carries the kit's usual declared escape hatch (`EXPERT_REVIEW_OFF=1`) and the trivial
  carve-out from the bullet above. **It does not check for an `adr.md`.** For check 1 it requires the
  plan doc to be **added or modified by the change under review** — a plan that merely sits in the tree
  is not evidence that *this* change was reviewed, so the gate scopes the evidence to the diff. Recording
  an architectural decision is a review obligation (see `documentation.md` → "When to write"), not
  something this gate verifies.
- **Process:** Author drafts plan → opens PR → requests review from the relevant **dimensions** (and any
  persona file that exists) → each reviewer comments with sign-off → CI gate passes → merge.
- **Domain review is a planning input, not a review stage.** The outside expert for this project's
  industry is named, and their input recorded, in the spec (see `spec.md` → "What a spec owes", item 6,
  and the `## Domain & outside experts` section of `docs/agents/_templates/spec.md`). Reviewing that the
  domain was *asked* is a review question; it cannot be gated, and no gate pretends to.
- **Conflict escalation:** If reviewers disagree on a fundamental trade-off, the ADR records both positions and the decision; the operator (human) breaks ties.
- **No rubber stamps:** A sign-off without reading the diff is a process violation. The adversary-review skill (§16) provides the grading rubric.