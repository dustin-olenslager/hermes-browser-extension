# Completed Features

The shipped log. One entry per feature, newest first. Read this before proposing work — it is the
cheapest way to avoid rebuilding something that already exists.

Add an entry when a feature is tested and signed off, at the same time you move its folder into
`<area>/completed/`.

## Entry format

```markdown
### <Feature name> — YYYY-MM-DD
- **What shipped:** one or two sentences, in terms of what a user or caller can now do.
- **Area:** `<area>`
- **Archived plan:** `<area>/completed/<feature>/<renamed-file>.md`
- **Notable decisions:** anything that constrains future work; link the ADR in `architecture.md`.
- **Known gaps:** what was deliberately left out, so the next person does not read it as a bug.
```

---

<!-- New entries go directly below this line, newest first. -->

_Nothing shipped yet. The first feature — the extension controller that lets an agent drive the
operator's signed-in Chrome — is in flight; see `in-progress.md` row 1 and
`browser-control/plan.md`. M1–M4 are built and verified end to end; M5 (this repo's own governance
and CI gates) is the remaining milestone, and the entry lands when the folder moves into
`browser-control/completed/`._
