# Key Patterns & Gotchas

Conventions to follow and traps to avoid, discovered the expensive way. Add to this file the moment
something surprises you — record the **symptom**, not just the fix, because the next person arrives
holding the symptom.

## Conventions

Patterns that new code must match. Keep each one checkable — a reviewer should be able to point at
a line and say "this violates it."

- **Named exports only; no default exports** — renames stay greppable and every import site names what
  it uses.
- **Every wire literal lives in `shared/protocol.js`, once.** A wire string spelled anywhere else is a
  second source of truth for the contract, and that is how a client and a server drift apart without
  anything going red.
- **Relative imports with an explicit `.js` extension** (`./shared/protocol.js`). There is no bundler:
  the MV3 service worker and Node both require the extension, so an extensionless import works in one
  and fails in the other.
- **The inner layers never reach outward.** `extension/src/shared/**` and `extension/src/controller.js`
  import nothing outward — no `chrome.*`, no DOM, no global `fetch`/`WebSocket`. Anything that needs
  those is an injected argument (`fetchImpl`, `WebSocketImpl`, `execute`) or a *step* the executor runs.
  Checked by `node tools/check-arch-boundary.mjs`.
- **A new behavior that needs `chrome.*` is a new step, not a new call.** The planner names steps; the
  executor performs them. A planner that calls `chrome.tabs.query` directly passes its unit tests
  against a fake and stops being portable — which is the whole point of the split.
- **Constants are `SCREAMING_SNAKE`, functions `camelCase`, classes `PascalCase`.**
- **The access key is never logged, never echoed back to the popup, and never written anywhere but
  `chrome.storage.local`.** Log lines go through the redaction helper in `shared/protocol.js`.

## Gotchas

| Symptom you will see | Actual cause | What to do |
|---|---|---|
| A Chrome extension test passes locally and the real thing dies with `TypeError: … is not a constructor` | The test injected a **fake socket factory** — an arrow function — while the production client instantiates the socket with `new`. An arrow function is not constructible, so the fake was more permissive than the real thing and certified nothing about construction | Inject the **constructor itself** (`WebSocketImpl: WebSocket`) in both production and the fake. General rule: a fake that accepts more than the real dependency hides exactly the class of bug the fake exists to prevent |
| An architecture-boundary gate reports 100+ violations on a correct repo, so everyone ignores it | It matched its own **metasyntax and payloads**: comments mentioning `chrome.`, wire-format strings, and the page-source the extension *injects* (`COLLECT_FN` is a template literal full of `document.querySelectorAll` that runs in the PAGE, not the extension) | Strip comments and string/template literals before scanning (preserving line numbers). A gate that fires on correct code is worse than no gate — and write its remaining blind spot into its own header rather than hiding it |
| A `tabs` action activates a different tab and every later step of the same action acts on the old one | The executor pinned the tab id when the plan started, and an `activateTab` step changed which tab was active | Re-resolve the active tab after an activation step (`context.retarget`), and assert *which tab* each protocol call was addressed to in the test — asserting only that a call happened cannot see this |
| The extension looks connected but nothing the agent asks for ever happens | A retry loop on a rejected access key is indistinguishable from a working socket | Make a rejected key a **fatal** state that stops retrying and says so in the popup. Never let "still trying" render the same as "connected" |
| A snapshot the agent cannot act on — it has references that do not resolve | The page changed between the snapshot and the click, so the reference is stale | The reference must resolve at action time or the action fails loudly. Never fall back to "the element at that position" — acting on the wrong element in a signed-in profile is the failure that matters |
| `chrome://` and extension pages appear in the tab list and the agent is told they can be driven | Those pages are not scriptable, and the failure surfaces as a confusing protocol error rather than a refusal | Refuse by scheme in the planner and name the URL in the refusal, so the agent gets an actionable error |
| The service worker is suspended between commands and the channel appears dead | MV3 workers are evicted when idle; an in-memory socket does not survive that | Treat a dropped socket as a normal reconnect (capped backoff), not as a fatal error — and keep the fatal case for configuration errors only |
| A gate or test passes while the bug is present | It measured nothing — the fixture pointed at the same tree, or the assertion could not distinguish the two outcomes | Reintroduce the defect and watch the case go red before trusting it. A check that cannot fail is not evidence |

## The URL policy is checked at plan time, on the right URL

- **Every action is gated before a protocol call is issued**, in `shared/actions.js`, by asking
  `shared/origins.js`. The profile being driven is the operator's real, signed-in one, so "it worked on
  the wrong page" is the failure that matters — not "it did not work".
- **A refusal names the URL.** A bare "not allowed" leaves the agent retrying blindly; the URL makes
  the failure reportable (FR-006, US-3).
- **`browser_navigate` is checked on its destination, not the current tab.** Gating the page being left
  would permit a navigation to anywhere, which is precisely the capability being restricted. This is
  the one case where the action's target is not the tab's URL.
- **An empty allowlist means the default `http`/`https` schemes — never "allow nothing".** An inert
  extension reads as broken, and a broken-looking security control is one the operator turns off.
- **Some schemes are refused unconditionally and cannot be allowed**: browser-internal and extension
  pages, plus `file:`, `data:`, `blob:`, `javascript:`, `view-source:` and `ws(s):`. `file:` is refused
  rather than offered as a switch because a `file:` URL has no origin — an origin list cannot express
  it, so the switch could never work.

## Testing conventions

- **The pure layer must be testable with no browser and no network.** `shared/**` and `controller.js`
  take their outer dependencies as injected arguments, so the suite runs under plain `node --test` with
  no Chrome, no extension host, and no dependencies at all. If a new behavior cannot be tested that
  way, it belongs in the executor.
- **Tests mirror the module they cover**: `tests/<module>.test.mjs` for
  `extension/src/shared/<module>.js`, `tests/controller.test.mjs` for `extension/src/controller.js`.
  The two tool scripts have their own canary (`tests/arch-boundary.test.mjs`) because a gate that
  cannot go red is not evidence.
- **A negative assertion needs its own layer.** `npm test` proves the planner refuses; it cannot prove
  the refusal stopped the browser call, because the planner never touches the browser. `tools/verify-policy.mjs`
  drives the real `ChromeExecutor` against a fake `chrome.*` and asserts the call count is zero for a
  refused target — the difference between fail-closed and fail-late. Run with `npm run verify:policy`.
- **The executor is tested against a recording fake `chrome.*`** that logs every call, so a test can
  assert the *sequence* and the *addressing* (which tab, which frame) — not merely that something was
  called. `responder(method, params)` supplies CDP return values without overriding the recorder.
- **A fake must not be more permissive than the real dependency.** Where the real thing is a
  constructor, inject a constructor; where the real thing rejects a shape, make the fake reject it too.
- **`npm test` must be green before a commit, unfiltered**, alongside `npm run lint` and
  `node tools/check-arch-boundary.mjs`.
- **Never skip, `.only`, or comment out a failing test to get a change through.** Fix it or report it.

## Performance notes

- **The bottleneck is the model round-trip, not the channel.** A live end-to-end run measured
  `input_tokens 53322 / output_tokens 171` for a single-command turn — the agent's own context
  dominates by orders of magnitude. Optimizing the socket would be optimizing a non-bottleneck.
- A snapshot is **formatted and clipped** rather than a raw DOM dump, precisely because its output
  lands in the agent's context. Long labels are truncated so one control cannot flood the snapshot;
  the full page text is omitted unless explicitly requested.
- Baseline for the pure layer: the unit suite runs 93 tests in under a second.

## Things that look wrong but are intentional

- **The popup has two fields and no options page.** Two values and a connection state do not need a
  second screen, and a second screen is a second thing to keep correct. The deletion is the decision —
  see the plan's candidates.
- **Raw script execution is unreachable from the default build.** Not an oversight: it is ADR-0002, and
  the manifest and the popup both state the boundary so it can be checked by reading.
- **The planner does not know how to do anything; it only names steps.** The indirection is what makes
  the action surface testable without a browser. Do not "simplify" it by calling `chrome.*` from the
  planner.
- **`check-arch-boundary.mjs` strips template literals, including their `${…}` interpolations.** A
  violation written inside an interpolation would be missed — stated in the tool's own header. Do not
  put browser access there.
- **One controller serves one session.** A cross-machine registry was considered and rejected (a new
  trust boundary and a new failure mode: silently driving the wrong box). Do not add one without
  reading the plan's candidate list first.
