/**
 * Wire contract for the Hermes browser-control protocol, version 1.
 *
 * This module is deliberately dependency-free and side-effect-free so the same
 * constants and helpers run in the extension service worker, in Node tests, and in
 * `tools/pair.mjs`. Nothing here touches `chrome.*` or the DOM.
 *
 * The authoritative source is Hermes itself:
 *   gateway/browser_control_broker.py   (capability allowlists, frame names)
 *   gateway/platforms/api_server.py     (register + ws endpoints, subprotocols)
 *   tui_gateway/methods_browser_control.py (dashboard transport)
 */

/** Protocol version this extension speaks. The server rejects anything else. */
export const PROTOCOL_VERSION = 1;

/** Register endpoint path (POST, bearer-authenticated). */
export const REGISTER_PATH = "/v1/browser-control/register";

/** Controller websocket path (GET, one-shot ticket in a subprotocol). */
export const WS_PATH = "/v1/browser-control/ws";

/** Subprotocol that must be requested on the upgrade. */
export const WS_PROTOCOL = "hermes-browser-control-v1";

/** Prefix of the second subprotocol; the ticket is appended to it. */
export const TICKET_PROTOCOL_PREFIX = "hermes-browser-control-ticket.";

/** Frames the server sends to a controller. */
export const FRAME_COMMAND = "browser.controller.command";
export const FRAME_CANCEL = "browser.controller.cancel";

/** Frames a controller sends back. */
export const FRAME_RESULT = "browser.controller.result";
export const FRAME_HEARTBEAT = "browser.controller.heartbeat";
export const FRAME_DETACH = "browser.controller.detach";

/**
 * Capabilities this controller can execute. Requesting a capability that is not on
 * the server allowlist is harmless (it is filtered server-side) but pointless, so
 * the list is kept exact.
 */
export const CAPABILITIES = Object.freeze([
  "browser_back",
  "browser_click",
  "browser_navigate",
  "browser_press",
  "browser_screenshot",
  "browser_scroll",
  "browser_snapshot",
  "browser_tab_activate",
  "browser_tabs",
  "browser_type",
]);

/** Capabilities the server treats as privileged (Developer Mode only). Never requested. */
export const DEVELOPER_CAPABILITIES = Object.freeze(["browser_cdp", "browser_evaluate"]);

/** Server allowlist, mirrored for local validation. */
export const SERVER_ALLOWLIST = Object.freeze([...CAPABILITIES, ...DEVELOPER_CAPABILITIES]);

/** True when `action` is something this controller is allowed and able to execute. */
export function isSupportedAction(action) {
  return typeof action === "string" && CAPABILITIES.includes(action);
}

/**
 * Normalize a server URL the user typed: trim, add a scheme when missing, drop a
 * trailing slash. Returns "" for unusable input.
 */
export function normalizeServerUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return "";
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/** Registration request body for one session. */
export function registrationPayload({ sessionId, controllerId, browserProfileId }) {
  return {
    protocol_version: PROTOCOL_VERSION,
    session_id: String(sessionId ?? "").trim(),
    controller_id: String(controllerId ?? "").trim(),
    browser_profile_id: String(browserProfileId ?? "").trim(),
    capabilities: [...CAPABILITIES],
  };
}

/** The two subprotocols a controller must request, in order. */
export function wsSubprotocols(ticket) {
  return [WS_PROTOCOL, `${TICKET_PROTOCOL_PREFIX}${ticket}`];
}

/** Absolute websocket URL for a server + path. */
export function wsUrl(serverUrl, path = WS_PATH) {
  const base = normalizeServerUrl(serverUrl);
  if (!base) return "";
  return base.replace(/^http/i, "ws") + path;
}

/** Result frame for one command. `ok` must be an exact boolean. */
export function resultFrame({ commandId, ok, result, error }) {
  return {
    method: FRAME_RESULT,
    params: ok
      ? { command_id: commandId, ok: true, result: result ?? null }
      : { command_id: commandId, ok: false, error: String(error ?? "unknown error") },
  };
}

/**
 * Redact anything that looks like a credential before it reaches a log line.
 * The access key and the ws ticket are the two secrets this extension handles.
 */
export function redact(text) {
  return String(text ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer <redacted>")
    .replace(/hermes-browser-control-ticket\.[A-Za-z0-9._~+/=-]{8,}/g, "hermes-browser-control-ticket.<redacted>")
    .replace(/(access[_ -]?key["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1<redacted>");
}
