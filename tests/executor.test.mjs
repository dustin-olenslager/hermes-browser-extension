import assert from "node:assert/strict";
import { test } from "node:test";

import { ChromeExecutor } from "../extension/src/executor.js";
import { fakeChrome } from "./helpers.mjs";

function makeExecutor(options) {
  const chrome = fakeChrome(options);
  return { executor: new ChromeExecutor(chrome), chrome };
}

test("an action drives the ACTIVE tab of the current window", async () => {
  const { executor, chrome } = makeExecutor();
  await executor.execute("browser_tabs", {});
  const query = chrome.calls.find((c) => c.api === "tabs.query");
  assert.deepEqual(query.filter, { active: true, currentWindow: true });
});

test("the debugger is attached once and reused across calls", async () => {
  const { executor, chrome } = makeExecutor();
  await executor.execute("browser_snapshot", {});
  await executor.execute("browser_snapshot", {});
  const attaches = chrome.calls.filter((c) => c.api === "debugger.attach");
  assert.equal(attaches.length, 1);
  assert.equal(attaches[0].version, "1.3");
  assert.equal(attaches[0].target.tabId, 7);
});

test("an 'already attached' error is tolerated so a live DevTools session is not fatal", async () => {
  const { executor } = makeExecutor({ attachError: "Another debugger is already attached to the tab with id: 7." });
  await assert.doesNotReject(() => executor.execute("browser_snapshot", {}));
});

test("detaching clears the attachment so the next action re-attaches", async () => {
  const { executor, chrome } = makeExecutor();
  await executor.execute("browser_snapshot", {});
  await executor.detach(7);
  await executor.execute("browser_snapshot", {});
  assert.equal(chrome.calls.filter((c) => c.api === "debugger.attach").length, 2);
});

test("a snapshot returns the formatted page text, not raw JSON", async () => {
  const { executor } = makeExecutor({
    responder: (method) =>
      method === "Runtime.evaluate"
        ? {
            result: {
              value: {
                url: "https://example.com",
                title: "Example",
                text: "body copy",
                elements: [{ tag: "a", type: "", role: "", name: "", id: "", aria: "", placeholder: "", label: "More", disabled: false, checked: null }],
              },
            },
          }
        : {},
  });
  const result = await executor.execute("browser_snapshot", {});
  assert.equal(typeof result, "string");
  assert.ok(result.includes("URL: https://example.com"), result);
  assert.ok(result.includes("@e1 <a> \"More\""), result);
  assert.ok(!result.includes("body copy"), "page text is excluded unless full=true");
});

test("full=true includes the page text", async () => {
  const { executor } = makeExecutor({
    responder: (method) =>
      method === "Runtime.evaluate"
        ? { result: { value: { url: "u", title: "t", text: "visible copy", elements: [] } } }
        : {},
  });
  const result = await executor.execute("browser_snapshot", { full: true });
  assert.ok(result.includes("visible copy"), result);
});

test("a page exception is surfaced as an error, not as a silent empty snapshot", async () => {
  const { executor } = makeExecutor({
    responder: (method) =>
      method === "Runtime.evaluate"
        ? { exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: nope is not defined" } } }
        : {},
  });
  await assert.rejects(() => executor.execute("browser_snapshot", {}), /ReferenceError: nope/);
});

test("a click dispatches a real mouse press and release at the element centre", async () => {
  const { executor, chrome } = makeExecutor({
    responder: (method, params) => {
      if (method !== "Runtime.evaluate") return {};
      if (String(params.expression).includes("nodes[")) {
        return { result: { value: { found: true, count: 3, x: 120, y: 44, label: "Sign in" } } };
      }
      return { result: { value: { url: "u", title: "t", text: "", elements: [] } } };
    },
  });
  await executor.execute("browser_click", { ref: "@e2" });
  const mouse = chrome.calls.filter((c) => c.method === "Input.dispatchMouseEvent");
  assert.equal(mouse.length, 2);
  assert.equal(mouse[0].params.type, "mousePressed");
  assert.equal(mouse[0].params.x, 120);
  assert.equal(mouse[0].params.y, 44);
  assert.equal(mouse[1].params.type, "mouseReleased");
  assert.equal(mouse[1].params.buttons, 0);
});

test("clicking an unresolvable ref fails loudly with a re-snapshot hint", async () => {
  const { executor } = makeExecutor({
    responder: (method, params) =>
      method === "Runtime.evaluate" && String(params.expression).includes("nodes[")
        ? { result: { value: { found: false, count: 0 } } }
        : { result: { value: { url: "u", title: "t", text: "", elements: [] } } },
  });
  await assert.rejects(() => executor.execute("browser_click", { ref: "@e1" }), /element not found/);
});

test("typing inserts text into the page rather than into a synthetic element", async () => {
  const { executor, chrome } = makeExecutor({
    responder: (method, params) => {
      if (method !== "Runtime.evaluate") return {};
      if (String(params.expression).includes("nodes[")) {
        return { result: { value: { found: true, count: 1, x: 5, y: 6 } } };
      }
      return { result: { value: { url: "u", title: "t", text: "", elements: [] } } };
    },
  });
  await executor.execute("browser_type", { ref: "@e1", text: "hello world" });
  const insert = chrome.calls.find((c) => c.method === "Input.insertText");
  assert.equal(insert.params.text, "hello world");
});

test("screenshot returns a data URL the agent can render", async () => {
  const { executor } = makeExecutor({
    responder: (method) => (method === "Page.captureScreenshot" ? { data: "aGVsbG8=" } : {}),
  });
  const result = await executor.execute("browser_screenshot", {});
  assert.equal(result, "data:image/png;base64,aGVsbG8=");
});

test("a screenshot with no payload reports failure instead of an empty image", async () => {
  const { executor } = makeExecutor({ responder: () => ({}) });
  assert.equal(await executor.execute("browser_screenshot", {}), "screenshot failed");
});

test("tab_activate switches tabs and follows the new tab afterwards", async () => {
  const { executor, chrome } = makeExecutor({
    tabs: [
      { id: 7, title: "One", url: "https://one.example", active: true, windowId: 1, status: "complete" },
      { id: 8, title: "Two", url: "https://two.example", active: false, windowId: 1, status: "complete" },
    ],
  });
  await executor.execute("browser_tab_activate", { tab_id: 8 });
  const updates = chrome.calls.filter((c) => c.api === "tabs.update");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].tabId, 8);
  assert.ok(chrome.calls.some((c) => c.api === "windows.update"), "the window should be focused too");
  assert.equal(chrome.state.tabs.find((t) => t.id === 8).active, true);
});

test("a cancel recorded for a command aborts at the next step boundary", async () => {
  const { executor } = makeExecutor();
  executor.noteCancel("cmd-x");
  await assert.rejects(() => executor.execute("browser_snapshot", {}, "cmd-x"), /cancelled/);
});

test("a cancel for another command does not abort this one", async () => {
  const { executor } = makeExecutor();
  executor.noteCancel("other");
  await assert.doesNotReject(() => executor.execute("browser_snapshot", {}, "cmd-y"));
});

test("the cancel set stays bounded so a long session cannot leak", () => {
  const { executor } = makeExecutor();
  for (let i = 0; i < 600; i += 1) executor.noteCancel(`cmd-${i}`);
  assert.ok(executor.cancelled.size <= 256);
});

test("no active tab is an explicit error rather than a crash", async () => {
  const chrome = fakeChrome({ tabs: [] });
  const executor = new ChromeExecutor(chrome);
  await assert.rejects(() => executor.execute("browser_snapshot", {}), /no active tab/);
});

test("waitForLoad returns when the tab reports complete", async () => {
  const { executor, chrome } = makeExecutor();
  chrome.state.tabs[0].status = "loading";
  const started = Date.now();
  setTimeout(() => {
    chrome.state.tabs[0].status = "complete";
  }, 200);
  await executor.waitForLoad(7);
  assert.ok(Date.now() - started >= 150);
});

test("waitForLoad gives up quietly when the tab disappears", async () => {
  const { executor, chrome } = makeExecutor();
  chrome.state.tabs = [];
  await assert.doesNotReject(() => executor.waitForLoad(7));
});
