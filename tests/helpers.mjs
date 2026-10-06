/** Shared test fixtures: a fake Chrome API and a fake Hermes gateway. */

/** Minimal in-memory `chrome.*` surface the executor uses.
 *
 * `responder(method, params)` supplies CDP return values while the recorder still
 * logs every call — overriding `sendCommand` in a test would silently drop the log.
 * `attachError` makes `debugger.attach` fail with that message.
 */
export function fakeChrome({
  tabs = [{ id: 7, title: "Example", url: "https://example.com", active: true, windowId: 1, status: "complete" }],
  responder = null,
  attachError = "",
} = {}) {
  const calls = [];
  const state = { tabs: tabs.map((t) => ({ ...t })), attached: new Set(), nextTabId: 100 };

  return {
    calls,
    state,
    tabs: {
      async query(filter) {
        calls.push({ api: "tabs.query", filter });
        if (filter?.active) return state.tabs.filter((t) => t.active);
        return state.tabs;
      },
      async get(tabId) {
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error("No tab with id: " + tabId);
        return tab;
      },
      async update(tabId, patch) {
        calls.push({ api: "tabs.update", tabId, patch });
        const tab = state.tabs.find((t) => t.id === tabId);
        if (!tab) throw new Error("No tab with id: " + tabId);
        Object.assign(tab, patch);
        state.tabs.forEach((t) => {
          if (t.id !== tabId) t.active = false;
        });
        return tab;
      },
    },
    windows: {
      async update(windowId, patch) {
        calls.push({ api: "windows.update", windowId, patch });
        return { id: windowId };
      },
    },
    debugger: {
      async attach(target, version) {
        calls.push({ api: "debugger.attach", target, version });
        if (attachError) throw new Error(attachError);
        state.attached.add(target.tabId);
      },
      async detach(target) {
        calls.push({ api: "debugger.detach", target });
        state.attached.delete(target.tabId);
      },
      async sendCommand(target, method, params) {
        calls.push({ api: "debugger.sendCommand", tabId: target.tabId, method, params });
        return responder ? responder(method, params) : { ok: true, method, params };
      },
    },
  };
}

/**
 * A fake Hermes gateway: serves the register endpoint and a WebSocket that records
 * what the controller sent. Implements just enough of the wire contract.
 */
export function fakeGateway({ status = 201, body, wsProtocols = [] } = {}) {
  const sent = [];
  const requests = [];

  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    const payload = body ?? {
      protocol_version: 1,
      ticket: "TICKET-abc",
      ticket_expires_in_seconds: 30,
      ws_path: "/v1/browser-control/ws",
    };
    return {
      status,
      async json() {
        return payload;
      },
    };
  };

  class FakeWebSocket {
    static instances = [];
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.sentByClient = [];
      FakeWebSocket.instances.push(this);
      wsProtocols.push(protocols);
      // Open on the next tick so handlers are attached first.
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({});
      }, 0);
    }
    send(data) {
      this.sentByClient.push(data);
      sent.push(JSON.parse(data));
    }
    close(code = 1000, reason = "") {
      this.readyState = 3;
      this.onclose?.({ code, reason, wasClean: code === 1000 });
    }
    /** Test helper: deliver a server frame. */
    deliver(frame) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
  }

  return { fetchImpl, WebSocketImpl: FakeWebSocket, sent, requests, sockets: FakeWebSocket.instances };
}

/** Wait until `predicate()` is true, or throw after `timeout` ms. */
export async function waitFor(predicate, { timeout = 2000, interval = 5 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
