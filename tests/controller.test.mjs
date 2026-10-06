import assert from "node:assert/strict";
import { test } from "node:test";

import { ControllerClient, STATE, backoffFor, RECONNECT_DELAYS_MS } from "../extension/src/controller.js";
import { fakeGateway, waitFor } from "./helpers.mjs";

function makeClient(t, { gateway = fakeGateway(), config, execute } = {}) {
  const states = [];
  const cfg = {
    serverUrl: "http://hermes:8642",
    accessKey: "test-key",
    sessionId: "20260101_000000_abcdef",
    controllerId: "chrome-ext-test",
    browserProfileId: "chrome-test-linux",
    ...config,
  };
  const client = new ControllerClient({
    getConfig: () => cfg,
    execute: execute ?? (async () => "ok"),
    onState: (state, detail) => states.push({ state, detail }),
    fetchImpl: gateway.fetchImpl,
    WebSocketImpl: gateway.WebSocketImpl,
  });
  // A live client owns a heartbeat interval and possibly a reconnect timer;
  // registering the cleanup here is what lets the test runner exit.
  t.after(() => client.stop());
  return { client, gateway, states, cfg };
}

test("registration posts the bearer key, the exact path and the required body", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();

  assert.equal(gateway.requests.length, 1);
  const { url, init } = gateway.requests[0];
  assert.equal(url, "http://hermes:8642/v1/browser-control/register");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(init.body);
  assert.equal(body.protocol_version, 1);
  assert.equal(body.session_id, "20260101_000000_abcdef");
  assert.equal(body.controller_id, "chrome-ext-test");
  assert.equal(body.browser_profile_id, "chrome-test-linux");
  assert.equal(body.capabilities.length, 10);
});

test("the socket opens with both required subprotocols and the ticket", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  const socket = gateway.sockets[0];
  assert.equal(socket.url, "ws://hermes:8642/v1/browser-control/ws");
  assert.deepEqual(socket.protocols, [
    "hermes-browser-control-v1",
    "hermes-browser-control-ticket.TICKET-abc",
  ]);
});

test("connecting reaches the connected state", async (t) => {
  const { client, gateway, states } = makeClient(t);
  await client.start();
  await waitFor(() => gateway.sockets[0]?.readyState === 1);
  await waitFor(() => client.state === STATE.CONNECTED);
  assert.ok(states.some((s) => s.state === STATE.CONNECTED));
  assert.equal(client.status().sessionId, "20260101_000000_abcdef");
});

test("a command frame is executed and answered with a matching result frame", async (t) => {
  const seen = [];
  const { client, gateway } = makeClient(t, {
    execute: async (action, args, t) => {
      seen.push({ action, args });
      return "snapshot text";
    },
  });
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);

  gateway.sockets[0].deliver({
    method: "browser.controller.command",
    params: { command_id: "cmd-1", action: "browser_snapshot", arguments: { full: false }, tool_call_id: "t1" },
  });

  const reply = await waitFor(() => gateway.sent.find((f) => f.method === "browser.controller.result"));
  assert.deepEqual(seen, [{ action: "browser_snapshot", args: { full: false } }]);
  assert.deepEqual(reply.params, { command_id: "cmd-1", ok: true, result: "snapshot text" });
});

test("a throwing executor becomes an error result frame, never a dropped command", async (t) => {
  const { client, gateway } = makeClient(t, {
    execute: async () => {
      throw new Error("element not found — re-run browser_snapshot");
    },
  });
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  gateway.sockets[0].deliver({
    method: "browser.controller.command",
    params: { command_id: "cmd-2", action: "browser_click", arguments: { ref: "@e9" } },
  });
  const reply = await waitFor(() => gateway.sent.find((f) => f.method === "browser.controller.result"));
  assert.equal(reply.params.ok, false);
  assert.match(reply.params.error, /element not found/);
  assert.equal(reply.params.command_id, "cmd-2");
});

test("a malformed frame is ignored instead of killing the socket", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  gateway.sockets[0].onmessage({ data: "not json" });
  gateway.sockets[0].deliver({ method: "browser.controller.command", params: {} });
  gateway.sockets[0].deliver({ method: "some.other.frame", params: {} });
  assert.equal(client.state, STATE.CONNECTED);
  assert.equal(gateway.sent.length, 0);
});

test("a cancel frame is consumed without a reply", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  gateway.sockets[0].deliver({ method: "browser.controller.cancel", params: { command_id: "cmd-3" } });
  assert.equal(gateway.sent.length, 0);
});

test("a disabled feature reports a fatal state and does not retry", async (t) => {
  const gateway = fakeGateway({
    status: 404,
    body: { error: "Browser control is not enabled on this server.", code: "browser_control_disabled" },
  });
  const { client } = makeClient(t, { gateway });
  const result = await client.start();
  assert.equal(result.ok, false);
  assert.equal(result.fatal, true);
  assert.equal(client.state, STATE.FATAL);
  assert.match(client.status().lastError, /not enabled/);
});

test("a 401 is fatal so a wrong key cannot spin", async (t) => {
  const gateway = fakeGateway({ status: 401, body: { error: "unauthorized" } });
  const { client } = makeClient(t, { gateway });
  const result = await client.start();
  assert.equal(result.fatal, true);
  assert.equal(client.state, STATE.FATAL);
});

test("a transient failure retries with backoff instead of giving up", async (t) => {
  const gateway = fakeGateway({ status: 503, body: { error: "session database unavailable" } });
  const { client } = makeClient(t, { gateway });
  const result = await client.start();
  assert.equal(result.fatal, false);
  assert.equal(client.state, STATE.RECONNECTING);
  assert.notEqual(client.reconnectTimer, null);
  await client.stop();
});

test("a missing ticket is fatal — the controller never half-registers", async (t) => {
  const gateway = fakeGateway({ status: 201, body: { protocol_version: 1 } });
  const { client } = makeClient(t, { gateway });
  const result = await client.start();
  assert.equal(result.fatal, true);
  assert.match(result.error, /no ticket/);
});

test("missing configuration is refused before any network call", async (t) => {
  const gateway = fakeGateway();
  const { client } = makeClient(t, { gateway, config: { serverUrl: "" } });
  const result = await client.start();
  assert.equal(result.ok, false);
  assert.match(result.error, /server URL/);
  assert.equal(gateway.requests.length, 0);
});

test("stop detaches deliberately and cancels the timers", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  await client.stop({ detach: true });
  assert.equal(client.state, STATE.IDLE);
  assert.equal(client.heartbeatTimer, null);
  assert.equal(client.reconnectTimer, null);
  assert.ok(gateway.sent.some((f) => f.method === "browser.controller.detach"));
});

test("an unexpected close schedules a reconnect but a clean stop does not", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  gateway.sockets[0].onclose({ code: 1006, wasClean: false });
  assert.equal(client.state, STATE.RECONNECTING);
  assert.notEqual(client.reconnectTimer, null);
  await client.stop();
  assert.equal(client.reconnectTimer, null);
});

test("backoff is bounded and never grows without limit", () => {
  assert.equal(backoffFor(0), RECONNECT_DELAYS_MS[0]);
  assert.equal(backoffFor(99), RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]);
  assert.equal(backoffFor(-3), RECONNECT_DELAYS_MS[0]);
});

test("start is idempotent while a connection is in flight", async (t) => {
  const { client, gateway } = makeClient(t);
  const first = client.start();
  const second = client.start();
  await Promise.all([first, second]);
  assert.equal(gateway.requests.length, 1);
});
