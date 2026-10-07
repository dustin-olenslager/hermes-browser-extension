import assert from "node:assert/strict";
import { test } from "node:test";

import { ControllerClient, STATE } from "../extension/src/controller.js";
import { fakeGateway, waitFor } from "./helpers.mjs";

function makeClient(t, { gateway = fakeGateway(), config } = {}) {
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
    execute: async () => "ok",
    onState: () => {},
    fetchImpl: gateway.fetchImpl,
    WebSocketImpl: gateway.WebSocketImpl,
  });
  t.after(() => client.stop());
  return { client, gateway, cfg };
}

/**
 * The MV3 suspension case, which stranded the real extension for a day.
 *
 * An MV3 service worker is suspended after ~30s idle. That destroys the WebSocket WITHOUT firing
 * onclose, so `client.state` still reads CONNECTED while `client.socket` is dead. The old start()
 * returned early on state === CONNECTED, so the keepalive alarm never reconnected and the extension
 * reported "connected" while holding no socket.
 */
test("start() reconnects when state says CONNECTED but the socket is dead", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);
  assert.equal(gateway.requests.length, 1, "one registration for the first connect");

  // Simulate the suspension: the socket is gone, but onclose never fired, so state stays CONNECTED.
  const dead = gateway.sockets[0];
  dead.readyState = 3;
  client.socket = dead;
  assert.equal(client.state, STATE.CONNECTED, "precondition: stale CONNECTED state");

  // The keepalive alarm calls this every minute. It MUST reconnect rather than no-op.
  const result = await client.start();
  assert.notEqual(result?.already, true, "must not short-circuit on stale CONNECTED");
  await waitFor(() => gateway.requests.length === 2, { timeout: 3000 });
  assert.equal(gateway.requests.length, 2, "a second registration proves it reconnected");
});

test("start() still short-circuits when the socket is genuinely open", async (t) => {
  const { client, gateway } = makeClient(t);
  await client.start();
  await waitFor(() => client.state === STATE.CONNECTED);

  const result = await client.start();
  assert.equal(result?.already, true, "a live socket must not re-register");
  assert.equal(gateway.requests.length, 1, "no extra registration");
});
