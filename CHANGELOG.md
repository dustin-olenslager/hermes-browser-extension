# Changelog — Hermes Browser Control

The running change log for this repo. One entry per change, newest first, under `[Unreleased]` until
it ships. Code and its log line ride in the same commit (`scripts/check-docs.sh` enforces it).

## [Unreleased]

- DOCS — **the README rewritten, and an MIT LICENSE added.** The old one opened with a diagram and
  reached the actual constraint — which pages the controller refuses to touch — two sections down. It
  now leads with what the extension is for, states the refusal boundary before the install steps,
  documents the four popup states (including why the fatal one must not look like the retrying one),
  and replaces a vague "testing it against a live gateway" note with a table naming what each
  verification layer proves and what the layer below it cannot. The repo had no LICENSE at all, which
  for a public repo means nobody may legally reuse it; it is now MIT.

- CHORE — **de-identified for publication.** The repo is published under a personal account, so the
  identifiers of the operator's own estate were replaced with neutral ones rather than shipped: the
  real gateway hostname in three `normalizeServerUrl`/`wsUrl` test cases became `hermes.example.com`;
  a real session id that had been used as a fixture and as the popup's placeholder became an obviously
  synthetic one; a machine-named browser-profile fixture became `chrome-workstation-linux`; and the
  doctor's hard-coded absolute kit path was dropped from its search list, leaving the standard
  locations plus `$PANOPLY_KIT_ROOT`. Verified: the doctor still exits 0 — it reports that no kit
  source is reachable and checks against its own generation rather than failing — and `PANOPLY_KIT_ROOT`
  still cross-verifies against a real clone. Nothing functional changed.

- FIX — **CI was red on shellcheck, on lines this work added.** Two findings, both in the kit's
  canary scripts as adopted here: `out="$( cd X && cmd || true )"` (SC2015 — `A && B || C` is not
  if-then-else, so the `|| true` branch ran when the command legitimately failed) and a fixture
  `printf` whose markdown backticks shellcheck wanted expanded (SC2016). Both fixed: the capture is now
  `out="$( cd X || exit 1; cmd 2>&1 )" || true`, and the fixtures carry the same
  `# shellcheck disable=SC2016` marker the rest of the file already uses. Verified with shellcheck
  0.11.0 (0 findings) and by re-running all three canaries (13/15/12 passed).

- FIX — **the origin policy FR-006/FR-007 described was not implemented, though the plan marked it
  done.** `plan.md` ticked M2 as satisfying "restrict the origins it will act on" and "refuse
  browser-internal pages"; grepping `extension/src/` found no allowlist and no scheme refusal anywhere,
  so the claim was false and the boundary the README advertised did not exist. The policy is now
  `extension/src/shared/origins.js` — a pure module with its own 14 tests — consulted by the planner
  before any protocol call is issued, with `allowedOrigins` threaded from the popup through the
  background config to the executor. Two things came out of writing it down properly: `browser_navigate`
  had to be checked on its **destination** (checking the tab's current URL would have gated the page
  being left and waved through a navigation to anywhere — the gap that would have made the allowlist
  decorative), and `file:` had to be refused outright rather than offered as a switch, because a `file:`
  URL has no origin (`new URL("file:///x").origin` is the string `"null"`) so an origin list can never
  express it. An empty allowlist means the default `http`/`https` schemes, deliberately not "allow
  nothing": an inert extension reads as broken, and a broken-looking control gets turned off. Also
  fixed: `normalizeOrigin` returned `""` for a bare host (`example.com`) — the form an operator actually
  types — so the entry he believed he wrote silently became nothing.

- FIX — **disconnecting left the debugger attached to the operator's tab.** `ChromeExecutor.detachAll()`
  was defined and never called, so closing the socket returned the popup to "Not connected" while Chrome
  kept its "…is being debugged" banner on the tab and the attachment stayed held. "Disconnect" now means
  what it says: `background.js` releases the debugger on disconnect, not only on worker teardown. Found
  by driving the real executor against a recording fake `chrome.*` (`tools/verify-policy.mjs`) and
  asserting what did and did not reach the browser — the unit tests could not see it, because the
  attachment is deliberately held across actions so Chrome's banner does not flash on every call.

- FEAT — **`tools/verify-policy.mjs`: the layer between the unit tests and the live run.** The unit
  suite proves the planner and the policy in isolation; the live gateway run proves routing. Neither
  answers "did the refusal stop the browser call, or fail after trying?" — so this drives the real
  `ChromeExecutor` against a recording fake `chrome.*` and asserts the negative: an out-of-policy tab
  and a browser-internal page issue **zero** `chrome.debugger` calls, an in-policy tab does issue them,
  and a navigation off the allowlist never reaches `Page.navigate`. Run with `npm run verify:policy`;
  kept out of `npm test` so the suite stays runnable with no browser.

- DOCS — README and the architecture/pattern/infrastructure notes now name the URL policy, the
  `origins.js` module, and `npm run verify:policy`, so the advertised boundary and the implemented one
  are the same thing.

- FIX — **host permissions are required after all, and removing them broke the extension.**
  `host_permissions` was dropped to `[]` on the reasoning that `chrome.debugger` needs only the
  `debugger` permission. That reasoning is wrong for the *network* half: an MV3 extension's `fetch`
  is CORS-restricted, so with no matching host permission the service worker cannot reach the
  gateway — registration fails with `Failed to fetch` and nothing else. Restored to
  `["http://*/*", "https://*/*"]`. The `<all_urls>` install warning is the honest cost of the
  extension being able to talk to whatever gateway the operator points it at.

- FEAT — **the extension controller: a Hermes agent can drive the Chrome the operator is already
  signed into.** The client end of Hermes' existing browser-control lane — register over the
  authenticated route, upgrade the socket on a single-use ticket, answer `browser.controller.command`
  frames, and return results — implemented as an MV3 extension with no build step and no dependencies.
  Declared capabilities are the nine named actions (navigate, click, type, press, scroll, snapshot,
  screenshot, tabs, back); raw script and raw protocol commands are **absent from the declared set**
  (ADR-0002), so the boundary can be verified by reading the manifest rather than trusted. A snapshot
  returns the page's interactive elements as `@eN` references the agent acts on, matching the reference
  form Hermes' built-in tools already send. The popup is two fields, four states, and one button — the
  fatal state is deliberately distinct from the retrying one, because a rejected key that keeps
  retrying is indistinguishable from a working socket. `tools/pair.mjs` exercises the channel from the
  command line. 93 unit tests, green with no browser installed; verified end to end against the live
  gateway (the controller received a routed `browser_snapshot` and the agent's reply carried the
  controller's marker — SC-001).

- FEAT — **`tools/check-arch-boundary.mjs`: the dependency-direction gate, with its blind spot
  stated.** The pure layer (`extension/src/shared/**`, `extension/src/controller.js`) must stay
  importable with no browser: no `chrome.*`, no DOM, no global `fetch`/`WebSocket`. The first version
  of this gate was a shell `grep` and was **unusable** — it flagged comments mentioning `chrome.`,
  wire-format strings, and the page-source payloads the extension *injects* (`COLLECT_FN` is a template
  literal full of `document.querySelectorAll` that runs in the PAGE, so it is data, not a violation). A
  gate that reports correct code as broken gets ignored, which is worse than no gate. Rewritten in Node
  with comments and string/template literals blanked (line numbers preserved), and it carries a
  mutation-tested canary (`tests/arch-boundary.test.mjs`) that proves it catches a real violation and
  still ignores the legitimate payloads. Its one remaining limitation — an interpolation inside a
  template literal is stripped along with it — is written into the tool's own header rather than
  hidden.

- FIX — **a real bug the unit suite could not see, found by the live run.** The production composition
  root injected the socket as an arrow-function factory while `ControllerClient` instantiates it with
  `new`; an arrow function is not constructible, so the first real run died with `TypeError: … is not a
  constructor`. Every unit test passed, because the *fake* socket was a factory too — a fake more
  permissive than the real dependency certifies nothing about construction. Production now passes the
  constructor itself and the fake was corrected to match. The same live run also surfaced a real
  executor defect: a `tabs` action that activated a different tab left the rest of the plan acting on
  the old tab; the executor now re-resolves the active tab after an activation step, and the executor
  tests assert *which tab* each protocol call was addressed to so this cannot regress silently.

- DOCS — **the repo's own governance.** The kit's own governance docs (its roadmap rows, its
  `governance/` plan archive, its `AUDIT-promises.md`, and the `panoply` skill that belongs to the kit
  repo) are removed from this adopter, and the plan spine is written for this project: a spec and plan
  under `docs/agents/browser-control/` with the four simulated persona interviews and a wireframe for
  the popup, a roadmap with one live initiative and the parked ones recorded with their revisit
  triggers, three ADRs (implement the existing lane; capabilities only with raw script opt-in; one
  extension per browser, unpacked), and `key-patterns.md` carrying the gotchas that cost real time —
  a permissive fake, a gate that fires on correct code, tab retargeting, and a retry loop that looks
  like a working connection. `AGENTS.md`'s placeholders are filled with this repo's real modules and
  commands, and the layer map in `.agents/rules/clean-architecture.md` names this repo's actual
  directories.

- CHORE — **CI wired to this repo's real commands.** `.github/workflows/verify.yml` runs the kit's
  gates plus this repo's own: `node --check` on each entry point, `node --test 'tests/*.test.mjs'`, and
  `node tools/check-arch-boundary.mjs` with its canary. The architecture-boundary step is the one that
  matters most here — it is what keeps the pure layer importable with no browser, which is what makes
  the suite runnable in CI at all.
