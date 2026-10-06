# Hermes Browser Control — a Chrome extension

Lets a **Hermes agent drive the Chrome you are already signed into** — the real profile, with your
real logins — instead of a fresh automation browser that is signed into nothing.

You pair a browser once from the extension popup. After that the agent's normal browser tools
(navigate, read the page, click, type, press, scroll, back, tabs, screenshot) act on that live window,
over an authenticated channel that carries only those named actions.

```
agent tool call  →  Hermes gateway  →  this extension  →  your signed-in tab
```

## Why this exists

The two usual ways to point an agent at a browser both fail the requirement:

- **Launching a fresh automation profile** (the Playwright/MCP default) gets you a browser that is
  signed into nothing, which is the exact thing you are trying to avoid.
- **Exposing a raw debugging port** works for one machine, dies with the profile, and is remote code
  execution by design.

This extension drives the window you are already using, and it does it across several machines — one
paired install per browser, each registering independently.

## What it can and cannot do

**Can:** navigate, read the page, click, type, press keys, scroll, go back, list tabs, take
screenshots — addressed to elements by stable `@eN` references.

**Cannot:** run arbitrary JavaScript, read your cookies, touch passwords, or act on a page outside the
origins you allow. Raw script execution is not merely off by default — it is **absent from the declared
capability set**, so the extension's manifest and its popup state a boundary you can verify by reading
rather than by trusting. See ADR-0002 in `docs/agents/architecture.md`.

**Where it will not act, at all:** browser-internal and extension pages (`chrome://`, `chrome-extension://`,
`devtools://`), and `file:`, `data:`, `blob:`, `javascript:`, `view-source:` and `ws(s):` URLs. These are
refused whatever you put in the allowlist, and the refusal names the URL so the agent can report
something you can act on. `file:` is refused rather than offered as a switch because a local file has no
origin — an origin list cannot express it, and a switch that cannot work is worse than no switch.
`host_permissions` is empty: `chrome.debugger` needs only the `debugger` permission, so the extension
does not ask for access to every site.

**Narrowing it further (optional):** the popup's "Limit to these sites" field takes a comma-separated
list of origins (`https://app.example.com`). Blank means any ordinary `http`/`https` page — the safe
default is "any web page, but nothing that is not a web page", not "nothing at all".

## Install

1. **Enable the lane on the gateway** (Hermes side, once):
   ```
   hermes config set browser.extension_control.enabled true
   ```
   It is read at request time, so no restart is needed. With the lane off, the register route does not
   exist and the extension cannot connect.

2. **Load the extension**: open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked**, and pick the `extension/` directory in this repo.

3. **Pair it**: click the extension icon and fill in the server address, an access key, and the session
   id you want this browser to serve. Click **Connect**. The status line goes to **Connected** and
   names the session.

Reloading the extension after a code change: `chrome://extensions` → **Reload** on the extension card.

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
| `extension/src/popup/` | Adapter | The operator's screen — two fields, four states, one button. |

The split is load-bearing: `shared/**` and `controller.js` import nothing outward, so they run under
plain `node --test` with no Chrome and no network. Anything that needs `chrome.*` is a *step* the
executor performs, never a call the planner makes. `tools/check-arch-boundary.mjs` fails the build if
that reverses.

### Testing it against a live gateway

`tools/pair.mjs` registers this machine as a controller and exercises the channel from the command
line — useful for proving the wire contract without loading the extension:

```
node tools/pair.mjs --server http://127.0.0.1:8642 --key "$API_SERVER_KEY" --session <session-id>
```

`tools/verify-policy.mjs` (`npm run verify:policy`) is the layer in between: it drives the real
`ChromeExecutor` against a fake `chrome.*` and asserts that a refused target issues **zero**
`chrome.debugger` calls. The unit suite proves the planner refuses; only this proves the refusal
stopped the browser call rather than failing after it — fail-closed versus fail-late.

## Governance

This repo carries the Panoply kit: `AGENTS.md` is the cross-tool hub, `.agents/rules/*.md` are the rule
modules, and `docs/agents/` holds the plan spine. Start at `docs/agents/in-progress.md` for what is in
flight and `docs/agents/architecture.md` for the decisions and their reasoning. `CHANGELOG.md` is the
running log.
