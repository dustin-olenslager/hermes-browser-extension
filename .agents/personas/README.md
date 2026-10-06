# Agent Library

Subagents the agent can spawn for focused work. Each runs in its own context window and returns a
written result to the caller — so the win is **isolation and depth**, and the cost is that the caller
never sees the agent's reasoning, only its final report.

**The rule that shrank this library: a persona file nothing invokes does not survive.** Every file here
is named as a required consultation by a rule, and the invocation is stated below. The library was
previously 12 personas carried in by an agent-agnostic refactor; none was referenced by any rule, gate,
or command, and six of them duplicated `.agents/rules/*.md` almost section for section. They were
deleted rather than left to rot — the deletion mapping lives in the governance plan that landed this.
**Do not add a persona here without naming, in a rule module, the step that invokes it.** A file with no
invoker is the dead weight this library's own doctrine exists to remove.

| Persona | What it's for | How it is invoked (the rule that names it) |
|---|---|---|
| `ux-designer` | User flows, interaction patterns, information architecture, competitive research | **Planning.** `docs/agents/_templates/spec.md` → `## Domain & outside experts` records its flow/IA findings, and `.agents/rules/workflow.md` → Planning Workflow names it as the planning consultation whose output fills the acceptance scenarios — before the plan exists. |
| `ux-researcher` | Study design, usability evidence for a claim resting on user behaviour | **Planning.** Same section, invoked when a requirement rests on a user-behaviour assumption; its evidence or study plan lands in the spec's `## Assumptions` / `[NEEDS CLARIFICATION: …]`. |

Both read `AGENTS.md` and the relevant `.agents/rules/*.md` modules first; project rules outrank persona
defaults, and a persona that contradicts a rules module is reporting a bug in one of the two. Both
operate under the `.agents/rules/clean-architecture.md` premise — the Dependency Rule and its four layers
are assumed, not renegotiated per persona.

## Review is dimensions, not personas

An earlier version of this library implied that review ran through personas named Security, Performance,
Maintainability, and UX. Those are four review **dimensions** every non-trivial change is reviewed on
(`.agents/rules/workflow.md` → Expert Review), and they map to no file — the confusion is what let 13
files sit invoked by nothing. Review is done by a second reviewer or a review agent reading only the
diff; the dimensions are what they check, not a roster to spawn.

## Design authority is a rule, not a persona

Pixel-level visual review, the design-system vocabulary, layout archetypes, and the type/spacing scale
are `.agents/rules/design-system.md` — a rule module, deliberately not duplicated as a persona. A person
or agent reviewing a screen runs that rule's "Consistency check"; there is no `ui-designer` or
`ui-reviewer` persona to reach for, and adding one back would recreate the second copy of the rule.

## If you prune further

A project with no user-facing surface (a library, CLI, service, or job runner) deletes both files and
the `MODULE:design-system` / `MODULE:frontend` blocks with them; `spec.md`'s UX row then reads
`n/a — no user-facing surface`. There is nothing else to prune.
