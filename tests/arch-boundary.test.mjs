import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { findViolations, stripCommentsAndStrings, collectFiles, FORBIDDEN } from "../tools/check-arch-boundary.mjs";

const rules = (source) => findViolations(source).map((v) => v.rule);

test("a real chrome API call in the pure layer is caught", () => {
  assert.deepEqual(rules(`export function bad() { return chrome.tabs.query({}); }`), ["chrome API"]);
});

test("a real DOM access in the pure layer is caught", () => {
  assert.deepEqual(rules(`const n = document.querySelectorAll("a");`), ["DOM document"]);
});

test("a global fetch and a global WebSocket are caught", () => {
  assert.deepEqual(rules(`await fetch("/x");`), ["global fetch"]);
  assert.deepEqual(rules(`const s = new WebSocket(url);`), ["global WebSocket"]);
});

test("window, navigator and localStorage are caught", () => {
  assert.deepEqual(rules(`window.scrollBy(0, 10);`), ["window global"]);
  assert.deepEqual(rules(`const p = navigator.userAgent;`), ["navigator"]);
  assert.deepEqual(rules(`localStorage.setItem("a", "b");`), ["localStorage"]);
});

test("the page-source payload the extension INJECTS is not a violation", () => {
  // This is the real shape from snapshot.js: a template literal that runs in the PAGE.
  const injected = `
export const COLLECT_FN = \`(() => {
  const nodes = [...document.querySelectorAll("a")];
  return { title: document.title };
})()\`;`;
  assert.deepEqual(rules(injected), []);
});

test("a comment mentioning chrome.* is not a violation", () => {
  const source = `
// This module never calls chrome.tabs.query or document.title.
/** JSDoc: no chrome.* access here. */
export const X = 1;`;
  assert.deepEqual(rules(source), []);
});

test("a wire-format string that merely contains 'browser.' is not a violation", () => {
  assert.deepEqual(rules(`export const FRAME = "browser.controller.command";`), []);
});

test("an injected property name is not a global access", () => {
  // fetchImpl/WebSocketImpl are the injected dependencies — the whole point of the split.
  assert.deepEqual(rules(`const r = await this.fetchImpl(url, init);`), []);
  assert.deepEqual(rules(`const s = new this.WebSocketImpl(url, protocols);`), []);
});

test("a property named like a global is not a violation", () => {
  assert.deepEqual(rules(`const t = obj.window.width;`), []);
  assert.deepEqual(rules(`const f = helpers.fetch(url);`), []);
});

test("stripping preserves line numbers so a report points at the right line", () => {
  const source = `const a = 1;\nconst s = "chrome.tabs";\nchrome.tabs.query({});`;
  const violations = findViolations(source);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].line, 3);
});

test("stripping handles escaped quotes and multi-line blocks", () => {
  const source = 'const a = "he said \\"chrome.tabs\\"";\n/* chrome.tabs\n   document.title */\nconst b = 2;';
  assert.deepEqual(rules(source), []);
});

test("the checker knows its own limitation: an interpolation is stripped", () => {
  // Documented, not hidden — this is why the doctrine says do not put browser access there.
  const source = "const x = `payload ${chrome.tabs.query({})} tail`;";
  assert.deepEqual(rules(source), []);
});

test("every forbidden rule has a name and a pattern", () => {
  for (const rule of FORBIDDEN) {
    assert.equal(typeof rule.name, "string");
    assert.ok(rule.pattern instanceof RegExp);
  }
});

test("collectFiles finds the pure layer and nothing else", () => {
  const files = collectFiles(process.cwd());
  assert.ok(files.includes("extension/src/shared/protocol.js"));
  assert.ok(files.includes("extension/src/controller.js"));
  assert.ok(!files.some((f) => f.includes("executor")), "the adapter layer is not a pure target");
  assert.ok(!files.some((f) => f.includes("background")), "the worker is not a pure target");
});

test("the shipped pure layer is actually clean", () => {
  const files = collectFiles(process.cwd());
  const dirty = files.filter((f) => findViolations(readFileSync(f, "utf8")).length);
  assert.deepEqual(dirty, [], `pure-layer violations: ${dirty.join(", ")}`);
});

test("stripCommentsAndStrings leaves code intact and blanks only the non-code", () => {
  const stripped = stripCommentsAndStrings('const a = "text"; // note\nconst b = 2;');
  assert.ok(stripped.includes("const a ="));
  assert.ok(stripped.includes("const b = 2;"));
  assert.ok(!stripped.includes("text"));
  assert.ok(!stripped.includes("note"));
  assert.equal(stripped.split("\n").length, 2);
});
