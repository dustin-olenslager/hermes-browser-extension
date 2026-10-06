import assert from "node:assert/strict";
import { test } from "node:test";

import { formatTabs, planAction, targetUsable } from "../extension/src/shared/actions.js";
import { CAPABILITIES, DEVELOPER_CAPABILITIES } from "../extension/src/shared/protocol.js";

const kinds = (p) => p.steps.map((s) => s.kind);
const methods = (p) => p.steps.filter((s) => s.kind === "cdp").map((s) => s.method);

// The URL policy is part of planning (see shared/origins.js), so a plan is always built against a
// target tab. `CTX` is an ordinary allowed page; the policy cases below use their own.
const CTX = { activeTabId: 7, activeTabUrl: "https://example.com/", allowedOrigins: [] };
const plan = (action, args = {}, ctx = CTX) => planAction(action, args, ctx);

test("every advertised capability has a plan", () => {
  const sample = {
    browser_navigate: { url: "https://example.com" },
    browser_snapshot: {},
    browser_click: { ref: "@e1" },
    browser_type: { ref: "@e1", text: "hi" },
    browser_press: { key: "Enter" },
    browser_scroll: { direction: "down" },
    browser_back: {},
    browser_tabs: {},
    browser_tab_activate: { tab_id: 7 },
    browser_screenshot: {},
  };
  for (const capability of CAPABILITIES) {
    const built = plan(capability, sample[capability] ?? {});
    assert.equal(built.error, undefined, `${capability} produced ${built.error}`);
    assert.ok(built.steps.length > 0, `${capability} produced no steps`);
  }
});

test("a privileged action is refused, never attempted", () => {
  for (const capability of DEVELOPER_CAPABILITIES) {
    const built = plan(capability, { expression: "1+1" });
    assert.ok(built.error, `${capability} must be refused`);
    assert.match(built.error, /not supported by this controller/);
  }
});

test("navigate enables Page, navigates, waits for load, then snapshots", () => {
  const built = plan("browser_navigate", { url: "example.com" });
  assert.deepEqual(kinds(built), ["cdp", "cdp", "waitForLoad", "eval", "format"]);
  assert.deepEqual(methods(built), ["Page.enable", "Page.navigate"]);
  assert.equal(built.steps[1].params.url, "https://example.com");
});

test("navigate keeps an explicit scheme untouched", () => {
  assert.equal(plan("browser_navigate", { url: "http://192.0.2.10:3000/x" }).steps[1].params.url, "http://192.0.2.10:3000/x");
});

test("navigate without a url is refused with a usable message", () => {
  const built = plan("browser_navigate", {});
  assert.match(built.error, /requires a url/);
});

test("click resolves the ref, dispatches a REAL mouse press and release, then re-snapshots", () => {
  const built = plan("browser_click", { ref: "@e12" });
  assert.deepEqual(kinds(built), ["cdp", "eval", "clickTarget", "settle", "eval", "format"]);
  assert.equal(built.steps[1].as, "target");
  assert.ok(built.steps[1].expression.includes("nodes[12 - 1]"), "the ref must be resolved 1-based");
  assert.equal(built.steps[4].as, "page");
});

test("click with a bad ref is refused before any browser call", () => {
  for (const ref of ["", "@e", "e1", "@e0", undefined]) {
    const built = plan("browser_click", { ref });
    assert.ok(built.error, `ref ${JSON.stringify(ref)} should be refused`);
    assert.match(built.error, /needs a ref like @e3/);
  }
});

test("type selects the field first so it clears rather than appends", () => {
  const built = plan("browser_type", { ref: "@e2", text: "hello" });
  assert.deepEqual(kinds(built), ["cdp", "eval", "clickTarget", "eval", "cdp", "settle", "eval", "format"]);
  const insert = built.steps.find((s) => s.method === "Input.insertText");
  assert.equal(insert.params.text, "hello");
  assert.ok(built.steps[3].expression.includes("el.select()"));
});

test("type passes empty text through instead of dropping the command", () => {
  const built = plan("browser_type", { ref: "@e1", text: "" });
  assert.equal(built.steps.find((s) => s.method === "Input.insertText").params.text, "");
});

test("press dispatches the key events for the named key", () => {
  const built = plan("browser_press", { key: "Enter" });
  const dispatched = built.steps.filter((s) => s.method === "Input.dispatchKeyEvent");
  assert.deepEqual(dispatched.map((s) => s.params.type), ["rawKeyDown", "keyUp"]);
});

test("press with an unknown key is refused", () => {
  assert.match(plan("browser_press", { key: "Frobnicate" }).error, /unsupported key/);
});

test("scroll defaults to down and honors up", () => {
  assert.ok(plan("browser_scroll", {}).steps[1].params.expression.includes("scrollBy(0, 600)"));
  assert.ok(plan("browser_scroll", { direction: "up" }).steps[1].params.expression.includes("scrollBy(0, -600)"));
  assert.ok(plan("browser_scroll", { direction: "sideways" }).steps[1].params.expression.includes("scrollBy(0, 600)"));
});

test("back uses history.back and waits for the load", () => {
  const built = plan("browser_back", {});
  assert.ok(built.steps[1].params.expression.includes("history.back()"));
  assert.ok(kinds(built).includes("waitForLoad"));
});

test("tabs lists without touching a page", () => {
  assert.deepEqual(kinds(plan("browser_tabs", {})), ["listTabs"]);
});

test("tab_activate needs a numeric id and activates that tab", () => {
  const built = plan("browser_tab_activate", { tab_id: 42 });
  assert.deepEqual(kinds(built), ["activateTab", "eval", "format"]);
  assert.equal(built.steps[0].tabId, 42);
  assert.match(plan("browser_tab_activate", { tab_id: "abc" }).error, /numeric tab_id/);
});

test("screenshot captures a png and returns the raw base64 payload", () => {
  const built = plan("browser_screenshot", {});
  const shot = built.steps.find((s) => s.method === "Page.captureScreenshot");
  assert.equal(shot.params.format, "png");
  assert.equal(shot.as, "shot");
});

test("formatTabs marks the active tab so the agent knows where it is", () => {
  const text = formatTabs(
    [
      { id: 1, title: "Mail", url: "https://mail.example.com" },
      { id: 2, title: "Docs", url: "https://docs.example.com" },
    ],
    2,
  );
  assert.ok(text.includes("[1] Mail — https://mail.example.com"), text);
  assert.ok(text.includes("[2] Docs — https://docs.example.com *active*"), text);
});

test("targetUsable rejects an unresolved or off-screen target", () => {
  assert.equal(targetUsable({ found: true, x: 10, y: 20 }), true);
  assert.equal(targetUsable({ found: false, count: 3 }), false);
  assert.equal(targetUsable({ found: true, x: null, y: 20 }), false);
  assert.equal(targetUsable(null), false);
});

test("a built never mutates the arguments Hermes sent", () => {
  const args = { ref: "@e1", text: "keep me" };
  const copy = JSON.parse(JSON.stringify(args));
  plan("browser_type", args);
  assert.deepEqual(args, copy);
});

test("an action on an out-of-policy page is refused before any browser call", () => {
  const restricted = { activeTabId: 7, activeTabUrl: "https://evil.example/x", allowedOrigins: ["https://example.com"] };
  for (const [capability, args] of Object.entries({
    browser_snapshot: {},
    browser_click: { ref: "@e1" },
    browser_type: { ref: "@e1", text: "x" },
    browser_press: { key: "Enter" },
    browser_scroll: { direction: "down" },
    browser_back: {},
    browser_screenshot: {},
  })) {
    const built = plan(capability, args, restricted);
    assert.ok(built.error, `${capability} must be refused on an out-of-policy page`);
    assert.match(built.error, /not in this controller's allowed origins/);
    assert.match(built.error, /evil\.example/, "the refusal names the URL");
    assert.equal(built.steps, undefined, "nothing is attempted");
  }
});

test("browser_tabs is allowed even on an out-of-policy page — it never touches a page", () => {
  const restricted = { activeTabId: 7, activeTabUrl: "chrome://extensions", allowedOrigins: [] };
  const built = plan("browser_tabs", {}, restricted);
  assert.equal(built.error, undefined);
  assert.deepEqual(kinds(built), ["listTabs"], "tab enumeration is a host step, not a protocol call");
});

test("browser_navigate checks the DESTINATION, not the page it is leaving", () => {
  // The gap that would make the allowlist decorative: gating the current URL would wave through a
  // navigation to anywhere, which is the whole capability being restricted.
  const restricted = { activeTabId: 7, activeTabUrl: "https://example.com/", allowedOrigins: ["https://example.com"] };
  const escaping = plan("browser_navigate", { url: "https://evil.example/steal" }, restricted);
  assert.ok(escaping.error, "a navigation off the allowlist must be refused");
  assert.match(escaping.error, /destination was https:\/\/evil\.example\/steal/);
  assert.equal(escaping.steps, undefined);

  const staying = plan("browser_navigate", { url: "https://example.com/next" }, restricted);
  assert.equal(staying.error, undefined);
});

test("a browser-internal page is refused even with no allowlist narrowing", () => {
  const internal = { activeTabId: 7, activeTabUrl: "chrome://settings", allowedOrigins: [] };
  const built = plan("browser_snapshot", {}, internal);
  assert.ok(built.error);
  assert.match(built.error, /never acts on chrome:/);
});

test("an empty allowlist means any normal web page, not nothing", () => {
  const open = { activeTabId: 7, activeTabUrl: "https://anything.example/deep", allowedOrigins: [] };
  assert.equal(plan("browser_snapshot", {}, open).error, undefined);
});
