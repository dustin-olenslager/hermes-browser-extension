# Interviews: Hermes Browser Control popup

> Both rounds live here. Round 1 shapes the screen; round 2 judges the screen.
>
> **Every row below is SIMULATED.** No real person was interviewed for this change — the operator
> (the owner) is the only real user, and his stated requirement is recorded in the spec's
> `## Domain & outside experts` section rather than dressed up as an interview. Nothing here is
> written as a real quote from a real person. A genuine interview would supersede the simulation for
> that persona and be recorded under their name, with its source cited.

## Round 1 — before the wireframe (what users actually do)

| Persona (domain role) | Simulated? | What surfaced | Changed |
|---|---|---|---|
| The operator — drives agents from the desktop chat, owns the browser and every paired machine | SIMULATED | He will pair this while doing something else and will not read documentation first. If the state is not on the screen he will assume it is broken and uninstall it. He also refuses to keep a terminal open to babysit a socket — pairing has to be a click. | The screen became the four states rather than a form plus a hidden status line; the connection state moved above the fields. SC-004 (two values, one button, no command line) came from this. |
| The security owner — owns the profile and the credentials signed into it | SIMULATED | The realistic failure is not a clever exploit: it is a channel that can run arbitrary script, or a key sitting somewhere a page can read. He wants to be able to check the boundary by reading the manifest, not by trusting a paragraph. | FR-004 (raw script and raw protocol commands off by default, absent from the declared set) and FR-010 (key never page-readable, never logged) became MUSTs. The popup's "What this can do" sentence is written to be checkable against the manifest rather than reassuring. |
| The on-call dev who inherits this machine and did not set it up | SIMULATED | He cannot tell a silent retry loop from a working socket, and an unnamed failure is unactionable — he would have to read source to learn anything. | The fatal state is visually distinct from connecting, and it names the cause in plain language ("Rejected — check the access key") rather than a code. US-5's fatal-vs-retryable split exists for this. |
| The agent — the caller of the tool surface | SIMULATED | A reference it cannot reuse is worthless; an ambiguous target must fail loudly rather than act on a guess. It also cannot recover from a page it is not allowed to read if the refusal does not say which URL was refused. | FR-005 (stable `@eN` references the agent already sends) and US-3's "refuse and name the URL" — the refusal carries the URL so the agent can report a useful failure instead of retrying blindly. |

## Round 2 — against the wireframe (what is wrong with it)

**Refuter(s):** the on-call dev and the security owner were given the job of breaking this screen, not
confirming it. Both are SIMULATED. A panel that only agrees has measured nothing, so the two rows
below are the objections that survived into a change.

| Persona (domain role) | Simulated? | What surfaced | Changed |
|---|---|---|---|
| The on-call dev (refuter) | SIMULATED | The first wireframe drew one state box and a status line, which means the reviewer never sees the state that matters — the rejected one — and the fatal state ends up looking like the connecting state in the real build because nobody drew them side by side. | All four states are drawn on the wireframe, with the fatal one called out as the one that must not resemble *Connecting*. That is a build-time requirement now, not an aesthetic one. |
| The security owner (refuter) | SIMULATED | A field labelled "API access key" invites the operator to paste a key he uses elsewhere. Nothing on the screen says this value is stored on the machine and readable by the extension. | The field is a password input, the placeholder says it is set once and stored locally, and the popup never echoes the key back after saving — so a shoulder-surfer and a screenshot both miss it. This is FR-010's UI half. |
| The operator (refuter) | SIMULATED | "What this can do" in a collapsed `<details>` means the one sentence that earns his trust is hidden behind a click — and the trust claim is the point of the screen. | Kept collapsed deliberately: the wireframe records the disagreement. The decision that stood is that the sentence is present and checkable, while the default view stays two fields and a state — he asked for one-click pairing and a paragraph of prose in the way is what he would skip anyway. |

## `n/a — <reason>`

Not applicable: this change has a user-facing surface (the extension popup), so both rounds were
written and the wireframe exists. See `wireframe/index.html` beside this file.

Skip test: **does this change alter what a user can do on a screen they look at?** Yes — it adds the
pairing screen that makes the whole feature reachable without a command line.
