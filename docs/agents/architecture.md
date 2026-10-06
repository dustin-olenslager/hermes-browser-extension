# Architecture

Decisions and their reasoning. Not a description of the code — the code describes itself. Record a
decision here when a future reader would otherwise ask "why is it like this?" and be tempted to
change it back.

## System shape

Two halves, and this repo is only one of them. The **gateway** (Hermes itself, not modified here)
exposes an authenticated register route and a WebSocket, and a broker that hands a session's browser
tool calls to whichever controller registered for that session. The **extension** — everything in this
repo — is that controller.

A request flows: the agent calls a browser tool → the gateway's broker resolves the session's
controller → a `browser.controller.command` frame goes down the controller's socket → the extension's
service worker checks the URL policy (`shared/origins.js`) and plans the action (`shared/actions.js`) → the executor runs the plan against the active
tab (`executor.js`, the only module that touches `chrome.*`) → a `browser.controller.result` frame goes
back up the same socket → the broker returns it to the tool call → the agent sees the page.

```
agent tool call
      │
 gateway broker ──(WS: browser.controller.command)──► background.js  (composition root)
                                                            │
                                              controller.js │ state machine: register → upgrade → answer
                                                            ▼
                                                  shared/actions.js  (pure planner)
                                                            │  asks shared/origins.js: may we act here?
                                                            │  a list of protocol steps, or a refusal naming the URL
                                                            ▼
                                                     executor.js  (chrome.* + chrome.debugger)
                                                            │
                                                            ▼
                                                   the operator's live tab
```

## Boundaries and ownership

- **Who owns the data:** the operator's browser owns the page and the session cookies; this extension
  owns nothing but its own config (server URL, access key, session id, controller id) in
  `chrome.storage.local`. It never reads, copies, or persists cookies, credentials, or page storage.
  The gateway owns the routing table of session → controller.
- **Source of truth for shared constants:** `extension/src/shared/protocol.js`. Every wire string, the
  protocol version, the capability lists, and the frame builders live there once. Nothing else in the
  repo may spell a wire literal — a second copy is how a client and a server drift apart silently.
- **Dependency direction that must not reverse:** `shared/**` and `controller.js` are the inner layers
  and import nothing outward — no `chrome.*`, no DOM, no global `fetch`/`WebSocket`. `executor.js`,
  `popup/`, and `background.js` are adapters and import inward. The reverse never happens, and
  `tools/check-arch-boundary.mjs` fails the build if it does.

## Data model

There is no database. The entities exist as wire shapes, defined in `shared/protocol.js`:

- **Controller** — identified by a stable controller id, bound to one session. Carries the declared
  capability set. The unit the gateway routes to.
- **Session** — the agent conversation. A controller serves exactly one; the broker resolves one
  controller per session.
- **Action** — a name plus arguments, drawn from the declared capability list. The capability boundary
  is enforced by name, so an unknown name is refused rather than guessed at.
- **Snapshot** — the page reduced to numbered `@eN` references plus formatted text. This is the agent's
  view of the page; the agent's next action names one of those references.
- **Ticket** — a short-lived, single-use credential minted by the register route and consumed by the
  socket upgrade. Never persisted.

Nothing here is a blob column or a normalized row — the persistence is `chrome.storage.local` holding
four scalars, and the access key is the only one that is sensitive.

## Cross-cutting decisions

- **Authentication:** the access key authenticates the register call; the socket upgrade consumes a
  short-lived ticket. A rejected key is a **fatal** state — the client stops retrying and says so,
  because an endless retry loop is indistinguishable from a working socket. Fail closed: no
  unauthenticated command executes.
- **Authorization:** by capability name. The default declared set is the nine named actions; raw script
  and raw protocol commands are a separate set that is not declared unless the operator enables
  developer mode (see ADR-0002).
- **Error shape:** every result frame carries an exact boolean `ok` and either the result or an error
  string. A refusal names *why* — notably the refused URL for an out-of-policy origin — so the agent
  can report something actionable instead of retrying blindly.
- **Versioning:** the wire contract carries a protocol version and is negotiated at upgrade
  (`hermes-browser-control-v1`). A version the client does not implement is a fatal configuration
  error, not a silent downgrade.
- **Deliberately not in scope:** the gateway half of the protocol; Web Store publication; any
  capability the existing Hermes browser tools cannot express; driving a browser the operator has not
  paired. See the roadmap's Later band for the parked items and their revisit triggers.

---

## ADR-0001 — Implement the existing controller lane rather than invent a protocol

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** Hermes already ships an opt-in browser-control lane (a register route, an authenticated
  WebSocket, a broker, and capability filtering) with no client for it — no `manifest.json` anywhere in
  the tree. The operator wanted the Claude-for-Chrome capability in his own dev environment, across
  several machines.
- **Options considered:**
  1. Write a client for the existing lane (chosen).
  2. Invent our own protocol and a matching gateway shim — rejected: two sources of truth for one wire
     contract, and every future Hermes change becomes a merge problem.
  3. Drive raw CDP with no extension — rejected: works for one machine, dies with the profile, and a
     debugging port is remote code execution by design.
  4. Wrap an existing browser-automation bridge (an extension-mode Playwright/MCP bridge) — rejected:
     it either relaunches the profile (signed into nothing, which is the exact thing the request
     avoids) or carries a much wider capability surface than the requirement needs.
- **Decision:** implement the client end of the existing lane. The wire contract is transcribed into
  `shared/protocol.js` as constants and unit-tested against the server's expectations.
- **Consequences:** the extension gets the lane's security properties for free (ticket-scoped socket,
  capability filtering, per-session routing) and stays compatible as the gateway evolves. It also
  inherits the lane's constraints: one controller per session, and no cross-machine registry — see the
  plan's deletion candidates for why that was accepted rather than worked around. Revisit if the
  gateway's contract changes shape or if the operator wants one session driving several browsers.

## ADR-0002 — Capabilities only; raw script is opt-in and absent from the default set

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** A browser-control channel is a remote code execution primitive by nature. The profile it
  drives is the operator's real, signed-in profile — the one with his mail, his bank, and his client
  work in it. Adjacent tools draw this line differently: some expose a full CDP passthrough.
- **Options considered:**
  1. Expose the full protocol (including `Runtime.evaluate`) and rely on authentication — rejected: it
     makes every declared permission a lie, because the capability sentence on the popup would not be
     true.
  2. Expose the nine named actions only (chosen).
  3. Named actions plus a script action behind a toggle — rejected as the *default*, adopted as the
     opt-in shape: the operator can have it deliberately, but it is never on by accident and never part
     of what the extension claims to do out of the box.
- **Decision:** the declared capability set is the nine named actions. Raw script and raw protocol
  commands are a separate developer set, enabled only by explicit configuration, and the extension's
  manifest and popup state the boundary so it can be checked by reading rather than by trusting.
- **Consequences:** the agent cannot do anything the nine actions cannot express — a real limitation,
  and the honest price of a channel that can be safely pointed at a signed-in profile. Adding a tenth
  action is a deliberate, reviewable change to the capability list rather than a side effect of
  exposing an escape hatch.

## ADR-0003 — One extension per browser, loaded unpacked

- **Date:** 2026-10-06
- **Status:** Accepted
- **Context:** The operator runs several machines (a desktop, a dev box) and wants to drive the Chrome
  on each. A Web Store listing is the eventual distribution path, but the upstream install-and-pair
  flow in Hermes is still an open PR.
- **Options considered:**
  1. One extension, loaded unpacked in each browser, each pairing itself (chosen).
  2. A single browser acting as a proxy for the others — rejected: it moves the trust boundary (one
     browser would hold access to another machine's session) and adds a failure mode with no
     requirement behind it.
  3. Wait for Web Store publication — rejected: it blocks the work on someone else's PR, and the
     unpacked path is what proves the design.
- **Decision:** load the same unpacked extension in every browser the operator wants to drive. Each
  install pairs independently and registers for the session it is told to serve.
- **Consequences:** pairing is a per-machine, per-session step rather than a global switch — which is
  what makes US-4 (several machines, one operator) work, and what keeps a stolen key from silently
  enrolling a new machine. Chrome requires a manual "Load unpacked" per profile, so adding a machine is
  a few clicks rather than an install; that is the cost, and it is why Web Store publication is on the
  roadmap rather than in this plan.
