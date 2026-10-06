#!/usr/bin/env node
/**
 * pair.mjs — register THIS machine as a browser controller and prove the channel.
 *
 * This is the tool you run to verify a browser, a gateway, and a session before
 * loading the extension: it performs the exact handshake the extension performs
 * (POST /v1/browser-control/register, then the ws upgrade with both subprotocols),
 * sends `controller.noop`, and reports what the server said. It does NOT drive the
 * page — that is the extension's job. A clean run here means the extension will
 * connect; anything it prints as a failure is the same failure the popup shows.
 *
 * Usage:
 *   node tools/pair.mjs --server http://hermes:8642 --key "$API_SERVER_KEY" --session <id>
 *   node tools/pair.mjs --capabilities          # print the server's advertised contract
 *
 * The key is read from --key, else $HERMES_API_SERVER_KEY, else $API_SERVER_KEY.
 */

import process from "node:process";

const args = process.argv.slice(2);
function flag(name, fallback = "") {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
const has = (name) => args.includes(`--${name}`);

const server = flag("server", process.env.HERMES_SERVER_URL || "http://127.0.0.1:8642").replace(/\/+$/, "");
const key = flag("key", process.env.HERMES_API_SERVER_KEY || process.env.API_SERVER_KEY || "");
const sessionId = flag("session", process.env.HERMES_SESSION_ID || "");
const controllerId = flag("controller", `pair-cli-${process.pid}`);
const browserProfileId = flag("profile", "pair-cli");

function die(message, code = 1) {
  console.error(`✖ ${message}`);
  process.exit(code);
}

async function capabilities() {
  const response = await fetch(`${server}/v1/capabilities`, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!response.ok) die(`GET /v1/capabilities → HTTP ${response.status}`);
  const payload = await response.json();
  const control = payload?.browser_extension_control;
  console.log(JSON.stringify(control ?? payload, null, 2));
  if (control && control.enabled !== true) {
    console.error("\n✖ browser_extension_control.enabled is false — set browser.extension_control.enabled: true and restart Hermes.");
    process.exit(2);
  }
}

async function main() {
  if (has("capabilities")) return capabilities();
  if (!key) die("no API key: pass --key, or set HERMES_API_SERVER_KEY / API_SERVER_KEY");
  if (!sessionId) die("no session: pass --session <hermes session id>");

  console.log(`→ registering controller for session ${sessionId} on ${server}`);
  const response = await fetch(`${server}/v1/browser-control/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      protocol_version: 1,
      session_id: sessionId,
      controller_id: controllerId,
      browser_profile_id: browserProfileId,
      capabilities: [
        "browser_back", "browser_click", "browser_navigate", "browser_press",
        "browser_screenshot", "browser_scroll", "browser_snapshot",
        "browser_tab_activate", "browser_tabs", "browser_type",
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (response.status !== 201) {
    die(`register → HTTP ${response.status} ${payload.code ?? ""} ${payload.error ?? ""}`.trim());
  }
  console.log(`✓ ticket minted (${payload.ticket_expires_in_seconds}s TTL)`);
  console.log(`  scope: ${JSON.stringify(payload.scope?.capabilities ?? [])}`);

  const wsUrl = `${server.replace(/^http/, "ws")}${payload.ws_path}`;
  const socket = new WebSocket(wsUrl, [
    "hermes-browser-control-v1",
    `hermes-browser-control-ticket.${payload.ticket}`,
  ]);

  const done = new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), 8000);
    socket.addEventListener("open", () => {
      console.log("✓ websocket upgraded with the one-shot ticket");
      socket.send(JSON.stringify({ method: "controller.noop", params: {} }));
    });
    socket.addEventListener("message", (event) => {
      clearTimeout(timer);
      console.log(`✓ server frame: ${String(event.data).slice(0, 400)}`);
      resolve("ok");
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      console.log("✖ websocket error (bad/expired/reused ticket, or the wrong origin)");
      resolve("error");
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timer);
      console.log(`  socket closed code=${event.code}`);
      resolve("closed");
    });
  });

  const outcome = await done;
  try {
    socket.close(1000, "pair done");
  } catch {
    /* already closed */
  }
  if (outcome !== "ok") process.exit(3);
  console.log("\n✓ channel verified — load the extension and enter this server, key and session in the popup.");
}

main().catch((error) => die(error?.stack ?? String(error)));
