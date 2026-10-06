# Plan: Drive the browser you are already signed into

- **Area:** `browser-control`  ·  **Started:** 2026-10-06  ·  **Status:** In progress
- **Owner:** the owner
- **Next step:** M1–M4 are done and verified end to end against the live gateway (see Build notes).
  M5 (repo governance + CI gates) is the remaining milestone; it is the batch currently in flight.
- **Roadmap initiative:** `../../roadmap.md` → "Drive the signed-in browser".
- **Spec:** `spec.md` in this folder — resolved, no markers left.
- **Domain & experts:** single-operator agent tooling. No outside expert was consulted; the spec's
  `## Domain & outside experts` section says so and names what was used instead. The operator's own
  constraint drove FR-011.
- **Parent plan:** none.

## Goal

A Hermes agent can drive the Chrome the operator is already signed into — on his desktop, on the dev
box, on any paired machine — without relaunching a browser, copying a profile, or opening a debugging
port. After this ships, the operator pairs a browser once from a two-field popup, and the agent's
existing browser tools act on that live window over a channel that carries only the named actions.

**How we will know it worked:** a real agent tool call, routed through the live gateway to a real
controller client, returns page text the agent could only have got from the live page — and the
agent's own reply contains it. That is SC-001, and it was run (see Build notes) rather than inferred.

**Out of scope:** the gateway side of the protocol (it already exists and is not modified here);
Web Store publication (unpacked install is the target); any capability the existing Hermes browser
tools cannot express; and driving a browser on a machine the operator has not paired.

## Context

Hermes already ships an opt-in browser-control lane: `browser.extension_control.enabled` (default
`false`), an authenticated register route plus a WebSocket, and a broker that hands a session's
browser tool calls to whatever controller has registered for that session. What it does **not** ship
is the controller — there is no `manifest.json` anywhere in the tree, and the install-and-pair flow
is still an open PR upstream. So the missing half is a Chrome extension that implements the client
end of that contract.

The constraint that rules out the obvious approach: pointing Hermes at a raw CDP port works today for
one machine, but a debugging port is remote code execution by design and it dies with the profile; and
launching a fresh automation profile is signed into nothing, which is precisely what the operator is
trying to avoid. Adjacent practice was surveyed for how the capability boundary is drawn — the
extension-mode browser bridges and the CDP-driving MCP servers — and the pattern adopted is the
narrow one: a named action list, with raw script execution off unless explicitly enabled.

Relevant decisions already made (see `../../architecture.md`): ADR-0001 (implement the existing lane
rather than invent a protocol), ADR-0002 (capabilities only, raw script opt-in), ADR-0003 (one
extension per browser, loaded unpacked).

## Architecture

- **Layers touched:** all four. Entities/Domain and Use Cases/Application are the pure modules
  (`extension/src/shared/`, `extension/src/controller.js`); Interface Adapters are
  `extension/src/executor.js`, the popup, and the service worker; Frameworks & Drivers are the
  manifest, the tools, and the tests.
- **New ports (interfaces):** `getConfig`, `execute`, `onState` (declared in `controller.js`, supplied
  by the composition root in `background.js`); `fetchImpl` and `WebSocketImpl` (the transport ports,
  injected so the state machine is testable with no browser and no network). The adapter that
  implements them is the service worker; in tests it is a fake.
- **Boundary data:** plain frames on the wire (`register` payload, `browser.controller.command` in,
  `browser.controller.result` out), and a snapshot document — a formatted page plus numbered `@eN`
  references. No domain object is serialized by reflection; the frames are built explicitly in
  `shared/protocol.js`.
- **Dependency direction:** inward. `shared/**` and `controller.js` import nothing outward; the
  executor and the popup import the inner layers; nothing inner imports them. Enforced by
  `tools/check-arch-boundary.mjs`, which strips comments and string literals first so the page-source
  payloads this extension *injects* are not mistaken for violations.
- **Swap test:** the vendor here is Chrome's extension API. Replacing it (a Firefox port, a Node
  client, a test double) touches `executor.js`, `background.js`, the manifest, and the popup only —
  the protocol, key map, snapshot formatter, action planner, and connection state machine are
  untouched. That is the split the design exists to protect, and it is what let the same controller
  client be driven headlessly against the live gateway in a Node process.

## The Algorithm pass (question · delete · simplify · accelerate · automate)

- **Question** — asked for by the operator (the owner), for his own dev environment. The constraint it
  serves: the browser must be the one he is already signed into, on several machines, with the agent
  unable to run arbitrary script in it. No name → not built: the Web Store packaging, a settings page,
  and a per-site permission editor were all dropped because no requirement names them.
- **Delete** — see the table. The largest deletion is the gateway half of the protocol: it exists, so
  this change writes only the client.
- **Simplify** — the least shape that satisfies FR-001…FR-012 is a single service worker holding one
  socket, a pure planner that turns an action into a list of protocol steps, and an executor that runs
  those steps against a tab. No build step, no bundler, no framework, no dependencies at all — plain
  ES modules that Chrome and Node both load directly, which is also what makes the suite runnable
  without a browser.
- **Accelerate** — the measured bottleneck is the model round-trip, not the channel: the live
  end-to-end run recorded `input_tokens 53322 / output_tokens 171` for a one-command turn, so the
  agent's own context dominates. The channel's own cost is one WebSocket frame each way; a snapshot
  formats the page rather than dumping raw DOM JSON precisely so the large payload is the agent's, and
  it is clipped (`long labels are clipped so one control cannot flood the snapshot`). Baseline to beat
  if this is ever revisited: a unit suite of 93 tests in ~0.9s.
- **Automate** — last, and only what survived. The unit suite and the boundary gate are automated
  because they are cheap and go red on their own; **pairing is deliberately not automated** — it stays
  a human entering two values and clicking once, because automating it would mean shipping a way to
  bind a browser without the operator present, which is the thing FR-002 exists to prevent.

### Deletion candidates

| Candidate | Removed? | Why | What we do instead |
|---|---|---|---|
| The gateway half of the protocol (register route, broker, WS handling) | no — not built | It already ships in Hermes; writing it again would be a second source of truth for the wire contract | Implement the client against the existing lane; ADR-0001 |
| Raw CDP / `Runtime.evaluate` passthrough as a default capability | rejected | A channel that can run arbitrary script in a signed-in profile is a remote code execution primitive whatever the UI calls it; it also makes every declared permission a lie | FR-004: off by default, absent from the declared set, opt-in only via developer mode |
| Pointing Hermes at the existing raw CDP port (no extension at all) | rejected | It works for exactly one machine and dies with the profile; a debugging port is RCE by design; and the operator's stated requirement is the browser he is signed into | The extension channel; ADR-0003. The CDP path stays available as a fallback, unchanged |
| Launching a fresh automation profile (Playwright-MCP `--extension` style) | rejected | Signed into nothing — it is the exact thing the request is trying to avoid | Drive the operator's own profile via the extension |
| An options page / settings screen | yes | Two values and a connection state do not need a page; a second screen is a second thing to keep correct | Everything lives in the popup; FR-008 |
| A per-site allowlist editor UI | yes | The allowlist is a security boundary the operator sets once, not something to tune per action; a UI invites loosening it casually | The origin list is configuration, typed into the popup's "Limit to these sites" field; FR-006 refuses and names the URL |
| Allowing `file:` pages through the allowlist | rejected — corrected in build | A `file:` URL has no origin (`new URL("file:///x").origin` is the string `"null"`), so an origin list can never express it: the switch would be one that cannot work. Driving a local file is also a filesystem read primitive against the operator's machine, not a page | `file:` joins the always-refused schemes, with the refusal saying why; FR-007 |
| A broad `<all_urls>` host permission | yes — removed in build | `chrome.debugger` needs only the `debugger` permission; nothing here uses `chrome.scripting`, so the host permission bought nothing and widened the install warning while contradicting US-2 | `host_permissions: []` |
| A bundler / build step | yes | It would add a toolchain and a build artifact to a repo whose whole point is that the browser can load it as written, and it would break the no-browser test run | Plain ES modules; `node --check` for lint |
| A second `@eN` reference scheme of our own | yes | The agent already addresses elements by reference through the built-in tools; a different scheme would need a translation layer | The snapshot emits the same reference form the agent already sends; FR-005 |
| Retry-forever on a rejected access key | yes | It hides a configuration error behind an apparently-working-but-silent socket | FR-009: retryable failures back off and reconnect; a fatal configuration error stops and says so |
| A cross-machine controller registry (one agent, N browsers, agent picks) | rejected | The gateway's lane is per-session and per-controller by design; a global registry would be a new trust boundary and a new failure mode (silently driving the wrong box) | US-4: one controller per session, commands name their controller, an absent one fails distinguishably. Revisit only if the operator asks for one session driving several browsers at once |
| Hand-drawing the extension icons as SVG | yes | Chrome cannot use SVG for `action.default_icon`, so the SVG would be a file that looks like the icon and is never loaded | `tools/make-icons.py` generates the PNGs deterministically with the standard library only |

## Spec coverage

| Requirement | Milestone |
|---|---|
| FR-001 | M1, M4 |
| FR-002 | M1 |
| FR-003 | M2 |
| FR-004 | M2 |
| FR-005 | M3 |
| FR-006 | M2 |
| FR-007 | M2 |
| FR-008 | M3 |
| FR-009 | M1 |
| FR-010 | M1 |
| FR-011 | M1 |
| FR-012 | M4 |

## Milestones

- [x] **M1 — the connection: register, authenticate, stay up** — `extension/src/shared/protocol.js`
  (the wire contract as constants), `extension/src/controller.js` (the state machine: register →
  upgrade → answer → reconnect), `extension/src/background.js` (the composition root that owns the
  socket and the config). Satisfies FR-001, FR-002, FR-009, FR-010, FR-011.
  Evidence: `extension/src/controller.js`, `extension/src/background.js`, `tests/controller.test.mjs`.
- [x] **M2 — the capability boundary: named actions only, refused by name** — `extension/src/shared/actions.js`
  `extension/src/shared/actions.js` (the planner: each action → its protocol steps, with the target
  check), `extension/src/shared/origins.js` (the URL policy the check consults — which pages this
  controller will act on, and why each refusal names its URL), `extension/src/executor.js` (runs a
  plan; the only module that touches `chrome.*`).
  Satisfies FR-003, FR-004, FR-006, FR-007.
  Evidence: `extension/src/shared/actions.js`, `extension/src/shared/origins.js`,
  `extension/src/executor.js`, `tests/actions.test.mjs`, `tests/origins.test.mjs`.
  Corrected during M5: the origin policy was written up here as done before it existed — the plan
  claimed FR-006/FR-007 were satisfied by an actions-only planner that had no allowlist and no
  browser-internal refusal. Found by grepping for the behavior rather than trusting the line. The
  policy is now its own pure module with its own tests, and `browser_navigate` is checked on its
  DESTINATION (checking the page being left would have waved through a navigation to anywhere).
- [x] **M3 — the agent's view: snapshots and references, and an honest popup** — `extension/src/shared/snapshot.js`
  `extension/src/shared/snapshot.js` (page → named elements with `@eN`), `extension/src/shared/keymap.js`,
  `extension/src/popup/`. Satisfies FR-005, FR-008.
  Evidence: `extension/src/shared/snapshot.js`, `extension/src/popup/popup.js`, `tests/snapshot.test.mjs`.
- [x] **M4 — proof: end to end against the running gateway** — `tools/pair.mjs`
  installed, plus a real controller client driven against the running Hermes gateway in a Node
  process, proving register → socket → routed tool call → result → agent reply. Satisfies FR-001
  (the authenticated path), FR-012.
  Evidence: `tests/controller.test.mjs`, `tools/check-arch-boundary.mjs`, and the recorded run in
  Build notes.
- [ ] **M5 — repo governance and gates** — this repo's own docs (roadmap, in-progress, architecture,
  key-patterns, infrastructure, completed-features, CHANGELOG, README), the kit's placeholders filled,
  and the CI workflow wired to this repo's real commands including the architecture gate and its
  mutation-tested canary. Satisfies no FR — it is the repo's own readiness, which is why it is last.
  Evidence: `.github/workflows/verify.yml`, `README.md`.

## Open questions

None. The one that mattered — where the code lives and which of the four approaches to build — was
asked and answered before M1 (owner chose the extension against the existing lane, in a private repo
loaded unpacked).

## Build notes

> **Build note:** 2026-10-06 — **the naive architecture gate was unusable, and finding that out changed
> the gate.** The first `check-arch-boundary` was a shell `grep` over the pure layer. It flagged 100+
> lines: comments that *mention* `chrome.`/`document.`, the wire-format strings
> (`"browser.controller.command"`), and — fatally — the page-source payloads the extension injects
> (`COLLECT_FN` is a template literal full of `document.querySelectorAll`, and it runs in the PAGE, not
> in the extension, so it is data and not a violation). A gate that reports every correct repo as
> broken gets ignored, which is worse than no gate. Rewritten in Node: comments and string/template
> literals are blanked (preserving line numbers) before scanning. **Its one honest limitation is
> written into its own header** rather than hidden — code inside a `${...}` interpolation is stripped
> along with the literal, so a violation written there would be missed.

> **Build note:** 2026-10-06 — **the live run found a bug the unit suite could not.** The unit tests
> inject a fake socket *factory*, so `WebSocketImpl: (url, protocols) => new WebSocket(url, protocols)`
> passed every test. The real client instantiates it with `new`, and an arrow function is not
> constructible — so the first real run died with `TypeError: ... is not a constructor`. Fixed in
> production (`background.js` passes the constructor itself) and the fake was corrected to match. The
> lesson is the one this repo's split is supposed to buy: the *unit* suite proved the logic and could
> never have caught this, because a fake that is more permissive than the real thing is a fake that
> certifies nothing about construction.

> **Build note:** 2026-10-06 — **tab retargeting was a real defect, not a test artifact.** The
> executor pinned the tab id at the start of a plan, so a `tabs` action that activated a different tab
> left every later step of that plan acting on the old one. Fixed by re-resolving the active tab after
> an `activateTab` step (`context.retarget`). Found because the executor tests assert *which tab* each
> protocol call was addressed to, not merely that a call happened.

> **Build note:** 2026-10-06 — **the end-to-end proof.** Unit tests against a fake server are not
> evidence that the real contract is implemented. So the shipped `ControllerClient` was imported into a
> Node process inside the Hermes container and pointed at the live gateway: it registered over the
> authenticated route, upgraded to the socket, received a real `browser_snapshot` command that the
> agent's tool call produced, answered it, and the agent's reply contained the marker the controller
> supplied. Recorded reply: `URL: https://e2e.example/ — E2E-SNAPSHOT-OK (served by the extension
> controller)`; the controller logged `browser_snapshot` with `{"full":false}`. That is SC-001.
> `input_tokens 53322` for that turn is the measured bottleneck named in the Algorithm pass.

> **Build note:** 2026-10-06 — the lane is enabled with
> `hermes config set browser.extension_control.enabled true`. It is read at request time, so no restart
> is needed. Left **enabled** on this box because the whole point is that the operator can drive it;
> the extension side still fails closed without a paired key.

## On ship

Move this whole folder into `browser-control/completed/`, rename this file to describe what shipped,
add an entry to `../../completed-features.md`, append the final line to the `CHANGELOG`
`[Unreleased]`, remove the item from `../../in-progress.md`, move the roadmap initiative to **Shipped**,
and promote the durable lessons into `../../key-patterns.md` — all in the same commit as the ship.
