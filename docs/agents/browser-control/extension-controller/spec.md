# Spec: Drive the browser you are already signed into

- **Area:** `browser-control`  ·  **Started:** 2026-10-06  ·  **Status:** Resolved
- **Owner:** the owner
- **Plan:** `plan.md` in this folder.

## Goal

A Hermes agent can drive the Chrome window the operator is already signed into — on his desktop, on
the dev box, on any machine he has paired — without launching a second browser, without copying
cookies or profiles, and without the agent ever seeing a credential. Today the only ways to point
Hermes at a browser are to launch a fresh automation profile (which is signed into nothing) or to
expose a raw debugging port (which is a remote code execution hole and dies when the profile is
locked). After this ships, the operator opens a normal Chrome, signs in to whatever he needs, clicks
the extension once, and the agent can navigate, read, click and type in that exact window — over a
channel that only carries the named actions and that fails closed when anything is off.

## User stories

### US-1 — Pair a browser once and drive it (P1)

The operator is signed in to a web app in his own Chrome. He opens the extension popup, enters the
server address and an access key, and clicks Connect. Hermes can now drive that window.

- **Why this priority:** without this nothing else exists. Every other story is a refinement of a
  working channel.
- **Independent test:** with the gateway running and the extension paired, an agent tool call to read
  the page returns that page's text — and the agent's reply contains text only the live page could
  have supplied.
- **Acceptance scenarios:**
  1. **Given** a paired extension and a reachable gateway, **when** the agent takes a snapshot,
     **then** the reply lists the page's interactive elements with `@eN` references.
  2. **Given** a paired extension, **when** the agent clicks `@e3` and types into `@e5`, **then** the
     live window shows the click and the typed text.
  3. **Given** an unpaired extension, **when** the agent takes a snapshot, **then** the call fails
     with a clear "no controller" error rather than hanging.

### US-2 — The channel carries only the named actions (P1)

The operator can satisfy himself, by reading the extension's manifest and source, that the channel
cannot do more than the listed actions.

- **Why this priority:** this is what makes the thing safe to install at all. A channel that can run
  arbitrary JavaScript is a remote code execution primitive, whatever the UI says.
- **Independent test:** with the extension installed and paired, a command frame naming an action
  outside the declared list is refused by the extension, and the refusal is visible to the agent.
- **Acceptance scenarios:**
  1. **Given** a paired extension, **when** a frame names `Runtime.evaluate` as the action, **then**
     the extension returns a refusal and runs nothing.
  2. **Given** the extension's manifest, **when** its permissions are read, **then** no
     `<all_urls>` host permission is present and `debugger` is the only powerful permission.
  3. **Given** the default configuration, **when** the operator has not opted in, **then** the
     privileged developer actions are not offered at all.

### US-3 — Refuse to run when the target is ambiguous or unsafe (P2)

The operator can leave the machine, and the channel still will not do the dangerous thing.

- **Why this priority:** the failure mode that matters is not "it did not work" but "it worked on the
  wrong page" — typing a password into a phishing form, or acting on a page it cannot read.
- **Independent test:** point the extension at a tab whose URL is outside the permitted origin list
  and confirm the action is refused with the URL named in the refusal.
- **Acceptance scenarios:**
  1. **Given** a permitted origin list, **when** the active tab is not on it, **then** every action
     is refused and the refusal names the tab's URL.
  2. **Given** an unreadable or internal page (`chrome://`, an extension page), **when** an action is
     requested, **then** it is refused rather than attempted.
  3. **Given** a `file:` URL, **when** an action is requested, **then** it is refused, and listing
     `file:` in the permitted origins does not allow it — a `file:` URL has no origin, so an origin
     list cannot express it and a switch that cannot work must not be offered.
  4. **Given** a permitted origin list, **when** a navigation is requested to a URL off that list,
     **then** it is refused and the refusal names the DESTINATION — the current page's URL is not the
     one being checked, since gating the page being left would permit a navigation to anywhere.
  5. **Given** no permitted-origin list at all, **when** an ordinary `http(s)` page is the target,
     **then** the action proceeds: an empty list means "any normal web page", never "allow nothing".

### US-4 — Several machines, one operator (P2)

The operator runs the extension on more than one machine and can tell which one answered.

- **Why this priority:** the whole point is the dev environment, which is several boxes. A channel
  that silently drives the wrong box is worse than one that drives none.
- **Independent test:** pair two machines, address a command to one, and confirm the other's page did
  not change.
- **Acceptance scenarios:**
  1. **Given** two paired browsers, **when** a command names one controller, **then** only that
     controller receives it.
  2. **Given** a controller that has gone away, **when** a command names it, **then** the call fails
     with a distinguishable error rather than falling through to another browser.

### US-5 — Recover without the operator (P3)

The channel reconnects on its own after a gateway restart or a dropped socket.

- **Why this priority:** it is a convenience, but an unrecovered channel is indistinguishable from a
  broken one, and the operator will be away.
- **Independent test:** restart the gateway while paired and confirm the extension re-registers
  without the popup being touched.
- **Acceptance scenarios:**
  1. **Given** a paired extension, **when** the socket drops, **then** it reconnects with capped
     backoff and reports its state in the popup.
  2. **Given** a rejected access key, **when** the extension retries, **then** it stops and reports a
     fatal configuration error instead of retrying forever.

## Edge cases

- The active tab changes between the snapshot and the click — the click must fail loudly rather than
  land on a different page.
- The page navigates while an action is in flight.
- Two agent sessions address the same browser at once.
- The gateway is reachable but the session id is not valid.
- Chrome suspends the service worker between commands — the channel must re-establish rather than
  appear dead.
- A page is slow enough that the element is not yet present.
- The operator is signed into the same site in several windows, so "the" logged-in session is
  ambiguous.

## Requirements

- **FR-001**: The extension MUST register itself with the Hermes gateway as the browser controller for
  one named session, over an authenticated channel.
- **FR-002**: The extension MUST authenticate with an access key and MUST fail closed — no
  unauthenticated command may be executed.
- **FR-003**: The channel MUST carry exactly the declared action list (navigate, click, type, press,
  scroll, snapshot, screenshot, tabs, back) and MUST refuse any other action by name.
- **FR-004**: Raw JavaScript and raw protocol commands MUST be unavailable unless the operator has
  explicitly enabled developer mode, and MUST NOT be part of the default declared capability set.
- **FR-005**: A snapshot MUST return the page's interactive elements with stable `@eN` references, and
  click/type MUST accept those references.
- **FR-006**: The extension MUST restrict the origins it will act on, and MUST refuse an action whose
  target URL is outside that list, naming the URL in the refusal. An empty list means the default
  `http`/`https` schemes — it MUST NOT mean "act on nothing", which would be an inert extension whose
  apparent breakage invites the operator to widen it carelessly.
- **FR-007**: The extension MUST refuse to act on browser-internal and extension pages, and on
  `file:`, `data:`, `blob:`, `javascript:`, `view-source:` and `ws(s):` URLs, whatever the permitted
  origin list says — these are not narrower permissions but pages where an action cannot mean anything,
  or (in the case of `file:` and `javascript:`) a filesystem or code-execution primitive rather than a
  page. For `browser_navigate` the URL checked is the DESTINATION, not the page being left.
- **FR-008**: The extension MUST surface its connection state and the last error in its popup, in
  language that does not require reading a log.
- **FR-009**: The extension MUST reconnect automatically after a transport failure, with capped
  backoff, and MUST stop retrying on a fatal configuration error.
- **FR-010**: The extension MUST NOT persist the access key in a form readable by a web page, and MUST
  NOT log it.
- **FR-011**: The extension MUST NOT require launching a separate browser, copying a profile, or
  enabling a remote debugging port.
- **FR-012**: Every declared capability MUST be exercisable by the agent through the existing Hermes
  browser tools, with no change to how the agent addresses a browser.

## Key entities

- **Controller** — one paired browser, identified by a stable id, bound to one session. It owns the
  socket and the declared capabilities.
- **Session** — the agent conversation a controller is bound to. A controller serves one session; a
  session may be served by one controller at a time.
- **Action** — a named operation the channel carries, with its arguments. The unit of the capability
  boundary.
- **Snapshot** — a page reduced to named interactive elements with references, which the agent acts
  on.
- **Access key** — the shared secret that authenticates a controller to the gateway. Never readable by
  a page, never logged.

## Success criteria

- **SC-001**: With the gateway running, an agent tool call reaches the paired browser and the agent's
  reply contains text supplied by the live page — verified end to end, not inferred from a unit test.
- **SC-002**: A command frame naming an action outside the declared list is refused; the refusal is
  reproducible and the refused action does not execute.
- **SC-003**: The full unit suite runs green with no browser installed, proving the decision logic is
  testable without the thing it drives.
- **SC-004**: The operator can pair a new machine by entering two values and clicking one button, with
  no command line.

## Assumptions

- The operator controls both ends (the gateway and the browser) and is the only intended user of this
  channel; it is a single-operator dev tool, not a multi-tenant service.
- The gateway's authenticated browser-control route already exists and its wire contract is stable; this
  work implements a client for it rather than defining a new protocol.
- Chrome's extension APIs are sufficient to run the declared actions, so no separate automation
  driver is needed.
- The operator's browser is a normal signed-in profile, and the extension is installed unpacked for
  now rather than from the Web Store.

## Domain & outside experts

The domain is **developer tooling for a single operator running AI agents against his own machines** —
the practitioners are the people who already drive browsers from agents (Playwright/Browser MCP users,
computer-use practitioners, extension authors). The governing constraint is the operator's own stated
one: he wants the browser he is *already signed into*, on several machines, and does not want to
relaunch it.

**No outside expert was consulted for this change.** That is stated plainly rather than dressed up:
the "outside" view here is the operator's own, and it is the reason the requirement exists at all. The
honest substitute used was the published practice of the adjacent tools — how the existing browser
automation bridges (the extension-mode bridges and the CDP-driving MCP servers) draw their capability
boundary — which is cited in the plan's Context section rather than presented as an interview. Two
personas from the kit's own set were used as planning consultations and are recorded in the simulated
interview table below.

| Question | Answer |
|---|---|
| The industry/domain this is built for | Single-operator agent tooling / browser automation for a dev environment |
| Expert role consulted | none consulted — see the paragraph above |
| What that expert said, in their terms | n/a — no real expert was interviewed; nothing is attributed to one |
| Effect on a requirement or story | n/a — the operator's own constraint drove FR-011; adjacent-tool practice informed FR-003/FR-004 |

## User interviews (simulated, 4 personas)

**These are ROLE-PLAYS and are labelled as such.** No real person was interviewed for this change, so
nothing below is a quote from anyone. Each row is a planning simulation of the role named, and each is
recorded only because it changed a decision in the plan.

| # | Persona (their role, in the domain's terms) | What they were asked | What they said (SIMULATED) | Design / UX / functional decision it changed |
|---|---|---|---|---|
| 1 | The operator — drives agents from the desktop chat, owns the browser and the machines | "What do you need to see to trust this, and what must it never make you do?" | That a browser he must re-sign-in to is useless, and that he will not keep a terminal open to babysit a socket | FR-011 (no separate profile, no debugging port); the popup became a two-field, one-button screen with the connection state visible, so pairing never requires a command line (SC-004) |
| 2 | The security owner — the person who owns the profile and the credentials in it | "If this is wrong, what has it exposed?" | That the realistic disaster is not a clever exploit but a channel that can run arbitrary script, and a key sitting somewhere a page can read | FR-004 (raw script and raw protocol commands off by default) and FR-010 (key never page-readable, never logged) became MUSTs, not defaults |
| 3 | The on-call dev who inherits the machine | "You did not set this up. What would make you unable to tell what it is doing?" | That a silent socket looks exactly like a working one, and an unnamed failure is unactionable | FR-008 (state and last error in the popup in plain language) and US-5's fatal-vs-retryable split |
| 4 | The agent itself, as the caller of the tool surface | "What makes an action unusable to you?" | That a reference it cannot reuse is worthless, and that an ambiguous target must fail rather than guess | FR-005 (stable `@eN` references) and US-3 (refuse-and-name-the-URL rather than act on an unpermitted page) |

## Open questions

None — every marker above was resolved before `plan.md` was written.

## On resolve

Status: **Resolved**. `plan.md` sits beside this file; the roadmap row links it.
