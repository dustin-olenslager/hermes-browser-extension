# Hermes Browser Control

A Chrome extension that lets a [Hermes](https://hermes-agent.nousresearch.com) agent drive **the
browser you are already signed into** — the real profile, with your real logins — instead of a fresh
automation browser that is signed into nothing.

Pair a browser once from the extension popup. From then on the agent's normal browser tools act on
that live window:

```
agent tool call  →  Hermes gateway  →  this extension  →  your signed-in tab
```

Navigate, read the page, click, type, press keys, scroll, go back, list tabs, take screenshots —
addressed to elements by stable references. One paired install per browser, so the same agent can
drive Chrome on several machines, each registering independently.

**Status:** built and verified end to end against a live gateway. Requires Hermes v0.21.4+ with
`browser.extension_control.enabled` set — see [Install](#install).

## Why this exists

The two usual ways to point an agent at a browser both fail the actual requirement:

- **Launching a fresh automation profile** (the Playwright/MCP default) gets you a browser signed into
  nothing — the exact thing you are trying to avoid.
- **Exposing a raw debugging port** works for one machine, dies with the profile, and is remote code
  execution by design.

This extension drives the window you are already using, over an authenticated channel that carries
only a fixed set of named actions.

## What it can and cannot do

**Can:** navigate, read the page, click, type, press keys, scroll, go back, list tabs, take
screenshots — addressed to elements by stable `@eN` references.

**Cannot:** run arbitrary JavaScript, read your cookies, touch passwords, or act on a page outside the
origins you allow.

Raw script execution is not merely switched off — it is **absent from the declared capability set**.
The extension's manifest and its popup state a boundary you can verify by reading, rather than trust.
See [ADR-0002](docs/agents/architecture.md).

### Where it will not act, at all

Browser-internal and extension pages (`chrome://`, `chrome-extension://`, `devtools://`), and
`file:`, `data:`, `blob:`, `javascript:`, `view-source:` and `ws(s):` URLs. These are refused whatever
you put in the allowlist, and **the refusal names the URL** so the agent can report something you can
act on instead of retrying blindly.

`file:` is refused rather than offered as a switch, because a local file has no origin — an origin
list cannot express it, and a switch that cannot work is worse than no switch. Driving a `file:` page
would also be a filesystem read primitive against your machine, which is a different and much larger
thing than acting on a web page.

`host_permissions` covers `http://*/*` and `https://*/*`, and it is **required** — not decorative.
An MV3 extension's `fetch` is subject to CORS, so without a matching host permission the service
worker cannot reach the gateway at all: registration fails with a bare `Failed to fetch` and no
other diagnostic. It does **not** grant page access here, because nothing uses `chrome.scripting`;
page work goes through `chrome.debugger`, which is the `debugger` permission's job.

### Narrowing it further (optional)

The popup's **Limit to these sites** field takes a comma-separated list of origins
(`https://app.example.com`). Blank means any ordinary `http`/`https` page.

That default is deliberate: an empty list means *"any web page, but nothing that is not a web page"*,
never *"nothing at all"*. An inert extension reads as broken, and a broken-looking security control
gets turned off.

## Install

### 1. Enable the lane on the gateway

```
hermes config set browser.extension_control.enabled true
```

Read at request time, so no restart is needed. With the lane off, the register route does not exist
and the extension cannot connect.

### 2. Load the extension

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the
`extension/` directory from this repo.

### 3. Pair it

Click the extension icon and fill in:

| Field | What goes in it |
|---|---|
| Server | Your gateway's address, e.g. `https://hermes.example.com` or `http://127.0.0.1:8642` |
| Access key | The gateway's API key — the same one `API_SERVER_KEY` holds on the host |
| Session id | The session this browser should serve |
| Controller id | Optional; defaults to `chrome-ext-<id>` |
| Limit to these sites | Optional origin allowlist (see above) |

Click **Connect**. The status line goes to **Connected** and names the session it serves.

To reload after a code change: `chrome://extensions` → **Reload** on the extension card.

### The four states, and why one of them matters

| State | Meaning |
|---|---|
| **Not connected** | Idle, or never paired. Connect is the only enabled action. |
| **Connecting** | The button is disabled so a second click cannot open a second socket. |
| **Connected** | This browser is the agent's controller for the named session. |
| **Rejected** | A bad key or bad session. It **stops retrying and says so.** |

The last one is the point: a rejected key that keeps retrying in silence is indistinguishable from a
working socket. The fatal state is deliberately distinct from the retrying one.

## Development

No build step, no bundler, no dependencies. Plain ES modules that Chrome and Node both load directly —
which is what lets the whole decision layer be tested without a browser installed.

```
npm test                              # the unit suite (node --test), no browser needed
npm run verify:policy                 # the URL policy, proven against the real executor
npm run lint                          # node --check on each entry point
node tools/check-arch-boundary.mjs    # the dependency-direction gate
npm run icons                         # regenerate extension/icons/*.png
```

### Where the code lives

| Path | Layer | What it is |
|---|---|---|
| `extension/src/shared/protocol.js` | Domain | The wire contract, as constants. Every wire literal lives here, once. |
| `extension/src/shared/keymap.js` | Domain | Named keys → virtual key codes. Pure data. |
| `extension/src/shared/snapshot.js` | Domain | Page → numbered `@eN` references the agent acts on. |
| `extension/src/shared/origins.js` | Domain | Which pages this controller will act on, and why a refusal names its URL. |
| `extension/src/shared/actions.js` | Use case | The action planner: an action becomes a list of protocol steps. |
| `extension/src/controller.js` | Use case | The connection state machine: register → upgrade → answer → reconnect. |
| `extension/src/executor.js` | Adapter | Runs a plan against a tab. **The only module that touches `chrome.*`.** |
| `extension/src/background.js` | Adapter | The composition root: owns the socket, the config, and the tab lifecycle. |
| `extension/src/popup/` | Adapter | The operator's screen — a few fields, four states, one button. |

The split is load-bearing: `shared/**` and `controller.js` import nothing outward, so they run under
plain `node --test` with no Chrome and no network. Anything that needs `chrome.*` is a *step* the
executor performs, never a call the planner makes. `tools/check-arch-boundary.mjs` fails the build if
that direction reverses.

### Verifying it, in layers

Each layer answers a question the one below it cannot:

| Command | Question it answers |
|---|---|
| `npm test` | Does the planner refuse an out-of-policy action? (112 tests, no browser) |
| `npm run verify:policy` | Did the refusal **stop** the browser call, or fail after trying? |
| `node tools/check-arch-boundary.mjs` | Did the pure/impure split decay? (mutation-tested) |
| `tools/pair.mjs` | Does the real wire contract work against a live gateway? |

The middle one is easy to skip and shouldn't be: it drives the real `ChromeExecutor` against a
recording fake `chrome.*` and asserts a refused target issues **zero** `chrome.debugger` calls. That is
the difference between fail-closed and fail-late, and the unit suite cannot see it, because the
planner never touches the browser.

### Testing against a live gateway

`tools/pair.mjs` registers this machine as a controller and exercises the channel from the command
line — useful for proving the wire contract without loading the extension:

```
node tools/pair.mjs --server http://127.0.0.1:8642 --key "$API_SERVER_KEY" --session <session-id>
```

## How it fits together

This extension is the *client* end of a lane Hermes already ships: the gateway exposes an
authenticated register route and a WebSocket, and a broker hands a session's browser tool calls to
whichever controller registered for that session. None of that protocol is invented here — the wire
strings live as constants in `shared/protocol.js` and are unit-tested against the server's
expectations.

Registration is **per session, per browser, fail-closed**. There is deliberately no global
multi-browser registry: a global one would be a new trust boundary whose failure mode is silently
driving the wrong machine.

See [`docs/agents/architecture.md`](docs/agents/architecture.md) for the decisions and their
reasoning.

## Governance

This repo carries the [Panoply](https://github.com/dustin-olenslager/panoply) kit: `AGENTS.md` is the
cross-tool hub, `.agents/rules/*.md` are the rule modules, and `docs/agents/` holds the plan spine.

Start at [`docs/agents/in-progress.md`](docs/agents/in-progress.md) for what is in flight,
[`docs/agents/architecture.md`](docs/agents/architecture.md) for decisions, and
[`CHANGELOG.md`](CHANGELOG.md) for the running log.

## License

MIT — see [LICENSE](LICENSE).
