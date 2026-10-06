# Infrastructure

How this project runs outside a developer's machine. Read before touching anything deploy-, data-,
or secret-related. Update in the same PR as the change — infra docs that lag the infra are worse
than no docs, because they are trusted.

## Environments

- **One environment: the operator's own machines.** There is no staging or preview tier, because the
  product IS the operator's browser. The "production" install is an unpacked extension in his Chrome
  profile, paired to a running Hermes gateway.
- Two sides have to agree, and they are versioned independently:
  - the **gateway** (Hermes, running as a container on the dev box) — not part of this repo;
  - the **extension** (this repo) — installed per browser.
- Nothing here is multi-tenant. The intended user count is one, and the design assumes the operator
  controls both ends. Do not add a second user's browser without re-reading ADR-0003.
- **Forbidden against the live profile:** never re-point a paired controller at a session the operator
  did not name; never enable developer mode on a profile holding client or personal logins without
  saying so out loud first.

## Deploy pipeline

- **What triggers a deploy:** nothing automatic. The extension is loaded unpacked, so the "deploy" is
  Chrome reloading it from `extension/`. A code change reaches the running browser when the operator
  clicks **Reload** on the extension card in `chrome://extensions`.
- **Gates that are blocking:** the CI workflow (`.github/workflows/verify.yml`) — the kit's gates plus
  `npm run lint`, `npm test` (`npm run verify:policy` for the executor-level policy proof), and `node tools/check-arch-boundary.mjs`. The architecture-boundary gate
  is the one that matters most here; see `key-patterns.md`.
- **How you know it succeeded:** the popup reports **Connected** and names the session it serves. If it
  reports a fatal state, read the plain-language line under the fields — that line exists so this
  question never requires reading a log.
- **Roll back:** reload the previous revision of `extension/` from git and click Reload in
  `chrome://extensions`. Because nothing is persisted on the server side beyond the routing of a
  session to a controller, a rollback is complete the moment the extension reloads — there is no
  migration to unwind. If the gateway side is the problem, disconnect the extension from the popup:
  the agent's browser tools then fall back to their configured backend, and the channel is inert.

## Hosting & runtime

- **Where it runs:** inside the operator's Chrome, as an MV3 service worker plus a popup. The
  counterpart (the gateway) runs as a container on the dev box and is documented in its own repo.
- **Runtime version:** Chrome's own. The manifest targets MV3; the service worker is a plain ES module
  with no build step and no dependencies, so there is no toolchain version to pin. The *test* runtime
  is Node `>=20` (`package.json` → `engines`), used only for the unit suite and the two tool scripts.
- **Process lifecycle:** the service worker is **evicted when idle** — this is normal MV3 behavior and
  the client treats a dropped socket as an ordinary reconnect with capped backoff. Do not add a
  keep-alive that fights the browser; see the gotchas table.
- **Health check:** the popup's connection state. There is no metrics endpoint and none is warranted
  for a single-operator tool.
- **Logs:** the extension's own console (`chrome://extensions` → the extension's *service worker* link,
  or the popup's inspector). Every log line goes through the redaction helper, so a key or ticket
  cannot reach a log even by accident. The gateway's side of a failed command is in the Hermes log on
  the dev box.

## Data stores

- **No database.** The extension's only persistence is `chrome.storage.local`, holding four scalars
  under `hermesBrowserControl.*`: the server URL, the access key, the session id, and the controller id.
- **Authoritative vs. reconstructible:** the server URL, session id, and controller id are all
  reconstructible from the gateway; the **access key is not** — it is the one value whose loss means
  re-issuing it. Nothing else is stored, and nothing about the pages driven is stored at all: no
  history, no screenshots on disk, no page content.
- **Backups:** none. There is nothing here worth backing up, and saying so is better than implying a
  backup exists.
- **Migration:** none, and the wire contract's version is negotiated at upgrade — a version the client
  does not implement is a fatal configuration error rather than a silent downgrade.

## Secrets & configuration

- **Where the secret lives:** the access key is entered once by the operator in the popup and stored in
  `chrome.storage.local` for that browser profile. There is no vault integration for this repo and none
  is needed — the value never leaves the machine except as a bearer credential on the register call to
  the operator's own gateway.
- **How a new one is added:** mint a key on the gateway side, paste it into the popup, click Connect.
  The popup never echoes the key back after saving.
- **What must never be committed:** the access key, and any real session id. `.gitignore` covers local
  agent settings; the secret scanner in CI is the mechanical backstop for a credential shape in a diff.
- **The gateway's own key** (`API_SERVER_KEY` on the dev box) is a **different** credential from the
  extension's access key and is never handled by this repo. Do not copy it into a config file here.

## Background jobs & scheduled work

None. The extension does nothing unless the agent asks it to; the only recurring activity is the socket
heartbeat, which is part of the connection rather than a job. There is no cron, no queue, and no
scheduled work whose silent failure could go unnoticed.

## Monitoring & alerting

- **What is monitored:** nothing automatically. The popup's state is the operator's view, and that is
  the deliberate choice — a single-operator tool does not warrant a monitoring stack, and pretending
  otherwise would be a control that does not exist.
- **The first three things to check when it looks wrong:**
  1. The popup's state and its plain-language detail line — a fatal state names its own cause.
  2. That the gateway is up and the lane is enabled (`browser.extension_control.enabled`), because
     with the lane off the register route is absent and the extension will fail to connect.
  3. That the controller is registered for the session the agent is actually using — a controller
     serving session A does nothing for a command addressed to session B.
