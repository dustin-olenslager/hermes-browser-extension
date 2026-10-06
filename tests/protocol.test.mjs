import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPABILITIES,
  DEVELOPER_CAPABILITIES,
  PROTOCOL_VERSION,
  REGISTER_PATH,
  WS_PATH,
  WS_PROTOCOL,
  TICKET_PROTOCOL_PREFIX,
  isSupportedAction,
  normalizeServerUrl,
  redact,
  registrationPayload,
  resultFrame,
  wsSubprotocols,
  wsUrl,
} from "../extension/src/shared/protocol.js";

test("protocol constants match the Hermes server contract", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(REGISTER_PATH, "/v1/browser-control/register");
  assert.equal(WS_PATH, "/v1/browser-control/ws");
  assert.equal(WS_PROTOCOL, "hermes-browser-control-v1");
  assert.equal(TICKET_PROTOCOL_PREFIX, "hermes-browser-control-ticket.");
});

test("capabilities never include the privileged developer set", () => {
  for (const capability of DEVELOPER_CAPABILITIES) {
    assert.ok(!CAPABILITIES.includes(capability), `${capability} must not be requested`);
  }
  assert.equal(CAPABILITIES.length, 10);
  assert.ok(CAPABILITIES.includes("browser_snapshot"));
  assert.ok(CAPABILITIES.includes("browser_click"));
});

test("isSupportedAction accepts only listed actions", () => {
  assert.equal(isSupportedAction("browser_click"), true);
  assert.equal(isSupportedAction("browser_evaluate"), false);
  assert.equal(isSupportedAction("browser_cdp"), false);
  assert.equal(isSupportedAction(""), false);
  assert.equal(isSupportedAction(undefined), false);
});

test("normalizeServerUrl adds a scheme and drops trailing slashes and paths", () => {
  assert.equal(normalizeServerUrl("http://hermes:8642"), "http://hermes:8642");
  assert.equal(normalizeServerUrl("  hermes:8642  "), "http://hermes:8642");
  assert.equal(normalizeServerUrl("https://hermes.example.com/"), "https://hermes.example.com");
  assert.equal(normalizeServerUrl("https://hermes.example.com/extra/path"), "https://hermes.example.com");
  assert.equal(normalizeServerUrl(""), "");
  assert.equal(normalizeServerUrl("   "), "");
});

test("registrationPayload carries the exact server-required fields", () => {
  const payload = registrationPayload({
    sessionId: " 20260101_000000_abcdef ",
    controllerId: "chrome-ext-1",
    browserProfileId: "chrome-the desktop host-linux",
  });
  assert.deepEqual(Object.keys(payload).sort(), [
    "browser_profile_id",
    "capabilities",
    "controller_id",
    "protocol_version",
    "session_id",
  ]);
  assert.equal(payload.protocol_version, 1);
  assert.equal(payload.session_id, "20260101_000000_abcdef");
  assert.equal(payload.browser_profile_id, "chrome-the desktop host-linux");
  assert.deepEqual(payload.capabilities, [...CAPABILITIES]);
});

test("wsSubprotocols requests the version protocol plus the ticket protocol", () => {
  const protocols = wsSubprotocols("TICKET-abc");
  assert.deepEqual(protocols, [WS_PROTOCOL, "hermes-browser-control-ticket.TICKET-abc"]);
  assert.equal(protocols.filter((p) => p.startsWith(TICKET_PROTOCOL_PREFIX)).length, 1);
});

test("wsUrl converts the http scheme and appends the ws path", () => {
  assert.equal(wsUrl("http://hermes:8642"), "ws://hermes:8642/v1/browser-control/ws");
  assert.equal(wsUrl("https://hermes.example.com"), "wss://hermes.example.com/v1/browser-control/ws");
  assert.equal(wsUrl(""), "");
});

test("resultFrame requires an exact boolean ok and drops the unused field", () => {
  const good = resultFrame({ commandId: "c1", ok: true, result: "hello" });
  assert.deepEqual(good, {
    method: "browser.controller.result",
    params: { command_id: "c1", ok: true, result: "hello" },
  });
  assert.equal("error" in good.params, false);

  const bad = resultFrame({ commandId: "c2", ok: false, error: "boom" });
  assert.deepEqual(bad, {
    method: "browser.controller.result",
    params: { command_id: "c2", ok: false, error: "boom" },
  });
  assert.equal("result" in bad.params, false);
});

test("resultFrame coerces a missing result to null rather than undefined", () => {
  const frame = resultFrame({ commandId: "c3", ok: true });
  assert.equal(frame.params.result, null);
});

test("redact strips bearer tokens and tickets from log text", () => {
  const text = "POST /register Authorization: Bearer b4ea1234567890abcdef subprotocol hermes-browser-control-ticket.XyZ123456789";
  const cleaned = redact(text);
  assert.ok(!cleaned.includes("b4ea1234567890abcdef"), cleaned);
  assert.ok(!cleaned.includes("XyZ123456789"), cleaned);
  assert.ok(cleaned.includes("Bearer <redacted>"), cleaned);
});
