/**
 * The controller websocket client.
 *
 * One job: keep an authenticated socket to a Hermes gateway alive, register as the
 * controller for a session, and answer `browser.controller.command` frames.
 *
 * Transport-agnostic on purpose — it takes a `WebSocket`-shaped constructor, a
 * `fetch`-shaped function and a `now` function, so the whole reconnect/ticket/result
 * state machine runs in Node against a fake server. The extension passes the real
 * globals; the tests pass stubs.
 */

import {
  FRAME_COMMAND,
  FRAME_CANCEL,
  FRAME_RESULT,
  FRAME_HEARTBEAT,
  FRAME_DETACH,
  REGISTER_PATH,
  WS_PATH,
  PROTOCOL_VERSION,
  normalizeServerUrl,
  registrationPayload,
  wsSubprotocols,
  wsUrl,
  resultFrame,
} from "./shared/protocol.js";

/** Backoff schedule (ms) for reconnect attempts after a dropped socket. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 20000, 30000];

/** How often a connected controller tells the server it is still alive. */
export const HEARTBEAT_INTERVAL_MS = 20000;

/** Ticket lifetime is 30s server-side; refresh the socket before it can matter. */
export const SOCKET_MAX_AGE_MS = 25 * 60 * 1000;

/** Terminal registration failures that must not be retried in a loop. */
export const FATAL_REGISTRATION_CODES = new Set([
  "browser_control_disabled",
  "browser_control_auth_required",
  "browser_control_developer_mode_required",
  "browser_control_session_forbidden",
  "browser_control_invalid_registration",
  "browser_control_no_capabilities",
  "browser_control_protocol_unsupported",
]);

export const STATE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  RECONNECTING: "reconnecting",
  FATAL: "fatal",
});

export function backoffFor(attempt) {
  const index = Math.min(Math.max(attempt, 0), RECONNECT_DELAYS_MS.length - 1);
  return RECONNECT_DELAYS_MS[index];
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig      current { serverUrl, accessKey, sessionId, controllerId, browserProfileId }
 * @param {(action: string, args: object) => Promise<unknown>} deps.execute
 * @param {(state: string, detail?: object) => void} deps.onState
 * @param {typeof fetch} deps.fetchImpl
 * @param {new (url: string, protocols?: string[]) => WebSocket} deps.WebSocketImpl
 *        MUST be a real constructor — pass `WebSocket` itself, not a factory arrow.
 * @param {() => number} [deps.now]
 */
export class ControllerClient {
  constructor(deps) {
    this.getConfig = deps.getConfig;
    this.execute = deps.execute;
    this.onState = deps.onState ?? (() => {});
    this.fetchImpl = deps.fetchImpl;
    this.WebSocketImpl = deps.WebSocketImpl;
    this.now = deps.now ?? (() => Date.now());

    this.state = STATE.IDLE;
    this.lastError = "";
    this.lastConnectedAt = 0;
    this.attempt = 0;
    this.socket = null;
    this.connectPromise = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.stopped = true;
  }

  setState(state, detail = {}) {
    this.state = state;
    if (detail.error !== undefined) this.lastError = String(detail.error ?? "");
    this.onState(state, detail);
  }

  /** Status for the popup. */
  status() {
    const cfg = this.getConfig() ?? {};
    return {
      state: this.state,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
      serverUrl: cfg.serverUrl ?? "",
      sessionId: cfg.sessionId ?? "",
      controllerId: cfg.controllerId ?? "",
      browserProfileId: cfg.browserProfileId ?? "",
    };
  }

  /** Start (or restart) the connection loop. Idempotent while connecting. */
  async start() {
    this.stopped = false;
    // "CONNECTED" is not proof of a live channel: an MV3 service worker is suspended after ~30s
    // idle, which destroys the WebSocket without firing onclose. The state then still reads
    // CONNECTED while `this.socket` is dead, and returning early here would strand the extension
    // permanently — reporting "connected" with no socket. Only skip when a socket is genuinely open.
    const live = this.socket && this.socket.readyState === 1;
    if (this.state === STATE.CONNECTED && live) return { ok: true, already: true };
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this._connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  /** Hard detach: tell the server, close the socket, cancel timers. */
  async stop({ detach = false } = {}) {
    this.stopped = true;
    this._clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === 1) {
      if (detach) {
        try {
          socket.send(JSON.stringify({ method: FRAME_DETACH, params: {} }));
        } catch {
          /* the socket is going away regardless */
        }
      }
      try {
        socket.close(1000, detach ? "detach" : "stop");
      } catch {
        /* already closing */
      }
    }
    this.setState(STATE.IDLE);
    return { ok: true };
  }

  _clearTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const delay = backoffFor(this.attempt);
    this.attempt += 1;
    this.setState(STATE.RECONNECTING, { retryInMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.start().catch(() => {
        /* start() already reported the failure through onState */
      });
    }, delay);
  }

  /** Ask the gateway for a single-use ws ticket. Throws on any non-201. */
  async register() {
    const cfg = this.getConfig() ?? {};
    const server = normalizeServerUrl(cfg.serverUrl);
    if (!server) throw new Error("No Hermes server URL configured");
    if (!String(cfg.accessKey ?? "").trim()) throw new Error("No API access key configured");
    if (!String(cfg.sessionId ?? "").trim()) throw new Error("No session id configured");

    const response = await this.fetchImpl(`${server}${REGISTER_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${String(cfg.accessKey).trim()}`,
      },
      body: JSON.stringify(
        registrationPayload({
          sessionId: cfg.sessionId,
          controllerId: cfg.controllerId,
          browserProfileId: cfg.browserProfileId,
        }),
      ),
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (response.status !== 201) {
      const code = payload?.code ?? `http_${response.status}`;
      const error = new Error(payload?.error ?? payload?.message ?? `registration failed (${response.status})`);
      error.code = code;
      error.fatal = FATAL_REGISTRATION_CODES.has(code) || response.status === 401 || response.status === 403;
      throw error;
    }
    if (!payload?.ticket) {
      const error = new Error("gateway returned no ticket");
      error.fatal = true;
      throw error;
    }
    return payload;
  }

  async _connectOnce() {
    this.setState(this.state === STATE.RECONNECTING ? STATE.RECONNECTING : STATE.CONNECTING);
    let ticket;
    try {
      const payload = await this.register();
      ticket = payload.ticket;
    } catch (error) {
      this.attempt = error?.fatal ? 0 : this.attempt;
      this.setState(error?.fatal ? STATE.FATAL : STATE.IDLE, { error: error?.message ?? String(error) });
      if (!error?.fatal) this._scheduleReconnect();
      return { ok: false, error: error?.message ?? String(error), fatal: Boolean(error?.fatal) };
    }

    const cfg = this.getConfig() ?? {};
    const url = wsUrl(cfg.serverUrl, WS_PATH);
    const socket = new this.WebSocketImpl(url, wsSubprotocols(ticket));
    this.socket = socket;

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      socket.onopen = () => {
        this.attempt = 0;
        this.lastConnectedAt = this.now();
        this.setState(STATE.CONNECTED, { capabilities: ticket ? undefined : undefined });
        this._startHeartbeat();
        finish({ ok: true });
      };

      socket.onmessage = (event) => {
        this._handleFrame(event?.data).catch(() => {
          /* execute() never throws outward; a transport error is reported in the result frame */
        });
      };

      socket.onclose = (event) => {
        this._clearTimers();
        this.socket = null;
        const clean = event?.code === 1000;
        this.setState(clean ? STATE.IDLE : STATE.RECONNECTING, {
          error: clean ? "" : `socket closed (${event?.code ?? "?"})`,
        });
        if (!this.stopped && !clean) this._scheduleReconnect();
        finish({ ok: false, error: "socket closed" });
      };

      socket.onerror = () => {
        this.setState(STATE.RECONNECTING, { error: "websocket error" });
      };
    });
  }

  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      const socket = this.socket;
      if (!socket || socket.readyState !== 1) return;
      try {
        socket.send(JSON.stringify({ method: FRAME_HEARTBEAT, params: {} }));
      } catch {
        /* the close handler owns recovery */
      }
      if (this.now() - this.lastConnectedAt > SOCKET_MAX_AGE_MS) {
        // Re-register on a fresh socket rather than trust an ageing one.
        try {
          socket.close(1000, "rotate");
        } catch {
          /* ignore */
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  /** Handle one inbound frame. Cancels are acknowledged by dropping state; the
   *  server ignores a late result for a cancelled command. */
  async _handleFrame(raw) {
    let frame;
    try {
      frame = JSON.parse(typeof raw === "string" ? raw : String(raw ?? ""));
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;

    if (frame.method === FRAME_CANCEL) return;

    if (frame.method !== FRAME_COMMAND) return;

    const params = frame.params ?? {};
    const commandId = params.command_id;
    const action = params.action;
    const args = params.arguments ?? {};

    if (!commandId || !action) return;

    let reply;
    try {
      const result = await this.execute(action, args);
      reply = resultFrame({ commandId, ok: true, result });
    } catch (error) {
      reply = resultFrame({ commandId, ok: false, error: error?.message ?? String(error) });
    }

    const socket = this.socket;
    if (socket && socket.readyState === 1) {
      try {
        socket.send(JSON.stringify(reply));
      } catch {
        /* the close handler owns recovery; the server times the command out */
      }
    }
  }
}

export { PROTOCOL_VERSION, resultFrame };
