/**
 * Extension service worker.
 *
 * Owns the config, the controller client, and the tab lifecycle. Everything that
 * can be decided without a browser lives in `shared/` and `controller.js`; this
 * file is wiring.
 *
 * MV3 service workers are killed after ~30s idle, so liveness is driven by
 * `chrome.alarms` (the only timer that survives a suspension) rather than by an
 * in-worker interval.
 */

import { ControllerClient, STATE } from "./controller.js";
import { ChromeExecutor } from "./executor.js";
import { FRAME_CANCEL } from "./shared/protocol.js";
import { normalizeServerUrl } from "./shared/protocol.js";
import { normalizeOriginList } from "./shared/origins.js";

const CONFIG_KEY = "hermesBrowserControl.config";
const STATUS_KEY = "hermesBrowserControl.status";
const KEEPALIVE_ALARM = "hermes-browser-control-keepalive";

/** Default config for a fresh install; the operator fills in the server + key. */
export const DEFAULT_CONFIG = Object.freeze({
  serverUrl: "",
  accessKey: "",
  sessionId: "",
  controllerId: "",
  browserProfileId: "",
  // The operator's origin narrowing. Empty means "default schemes only" (http/https) — NOT "allow
  // nothing", which would make the extension inert out of the box and is the opposite of a safe default.
  allowedOrigins: [],
  enabled: false,
});

let config = { ...DEFAULT_CONFIG };
let executor = null;
let client = null;
let ready = null;

function label() {
  const ua = navigator?.userAgent ?? "";
  const platform = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : "Linux";
  const host = self?.location?.hostname ?? "";
  return `${platform}${host ? ` · ${host}` : ""}`;
}

/** A stable id for THIS browser profile, so the server can tell profiles apart. */
function browserProfileId() {
  return `chrome-${(self?.location?.hostname ?? "unknown")}-${(navigator?.userAgentData?.platform ?? "browser").toString().toLowerCase()}`;
}

async function loadConfig() {
  const stored = await chrome.storage.local.get(CONFIG_KEY);
  const value = stored?.[CONFIG_KEY] ?? {};
  config = {
    ...DEFAULT_CONFIG,
    serverUrl: normalizeServerUrl(value.serverUrl ?? ""),
    accessKey: String(value.accessKey ?? "").trim(),
    sessionId: String(value.sessionId ?? "").trim(),
    controllerId: String(value.controllerId ?? "").trim() || `chrome-ext-${chrome.runtime.id.slice(0, 8)}`,
    browserProfileId: String(value.browserProfileId ?? "").trim() || browserProfileId(),
    enabled: value.enabled === true,
    label: String(value.label ?? "").trim() || label(),
    allowedOrigins: normalizeOriginList(value.allowedOrigins ?? []),
  };
  return config;
}

async function saveConfig(patch) {
  const next = { ...config, ...patch };
  next.serverUrl = normalizeServerUrl(next.serverUrl);
  await chrome.storage.local.set({ [CONFIG_KEY]: next });
  config = next;
  return config;
}

async function publishStatus(state, detail = {}) {
  const status = client ? client.status() : { state: STATE.IDLE, lastError: "" };
  const payload = { ...status, ...detail, state };
  await chrome.storage.local.set({ [STATUS_KEY]: payload });
  return payload;
}

function buildClient() {
  return new ControllerClient({
    getConfig: () => config,
    execute: (action, args) => executor.execute(action, args, "", config.allowedOrigins),
    onState: (state, detail) => {
      publishStatus(state, detail).catch(() => {});
    },
    fetchImpl: (...args) => fetch(...args),
    // A real constructor, not a factory arrow: the client instantiates it with `new`.
    WebSocketImpl: WebSocket,
  });
}

async function init() {
  if (ready) return ready;
  ready = (async () => {
    executor = new ChromeExecutor(chrome);
    await loadConfig();
    client = buildClient();
    if (config.enabled) await client.start().catch(() => {});
    return true;
  })();
  return ready;
}

// ---- lifecycle -----------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  init().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  init().catch(() => {});
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  await init();
  if (!config.enabled) return;
  if (client.state === STATE.CONNECTED || client.state === STATE.CONNECTING) return;
  await client.start().catch(() => {});
});

// The page's own dialog/reload can drop the debugger; forget the tab so the next
// action re-attaches instead of failing with "not attached".
chrome.debugger.onDetach.addListener((source) => {
  if (source?.tabId !== undefined) executor?.attached.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  executor?.attached.delete(tabId);
});

// ---- popup + options messaging -------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    await init();
    switch (message?.type) {
      case "status":
        sendResponse({
          ok: true,
          config: { ...config, accessKey: config.accessKey ? "set" : "" },
          status: client.status(),
          supported: true,
        });
        break;
      case "save":
        await saveConfig(message.patch ?? {});
        sendResponse({ ok: true, config: { ...config, accessKey: config.accessKey ? "set" : "" } });
        break;
      case "connect": {
        await saveConfig({ enabled: true, ...(message.patch ?? {}) });
        const result = await client.start();
        sendResponse({ ok: result.ok !== false, result, status: client.status() });
        break;
      }
      case "disconnect": {
        await client.stop({ detach: true });
        // Releasing the debugger is not cosmetic: an attached debugger keeps Chrome's "…is being
        // debugged" banner on the operator's tab after he has disconnected, and holds the attachment
        // open against anything else that wants the tab. Detaching on disconnect is what makes
        // "Disconnect" mean what it says.
        await executor.detachAll();
        await saveConfig({ enabled: false });
        sendResponse({ ok: true, status: client.status() });
        break;
      }
      case "cancel":
        executor.noteCancel(message.commandId ?? "");
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: `unknown message ${JSON.stringify(message?.type ?? "")}` });
    }
  })().catch((error) => {
    sendResponse({ ok: false, error: error?.message ?? String(error) });
  });
  return true; // keep the channel open for the async reply
});

export { FRAME_CANCEL, CONFIG_KEY, STATUS_KEY };
