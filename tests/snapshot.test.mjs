import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSnapshot, refIndex, describeElement, LABEL_LIMIT } from "../extension/src/shared/snapshot.js";

const PAGE = {
  url: "https://example.com/login",
  title: "Sign in",
  text: "Welcome back",
  elements: [
    { tag: "input", type: "email", role: "", name: "email", id: "user", aria: "", placeholder: "you@example.com", label: "", disabled: false, checked: null },
    { tag: "input", type: "password", role: "", name: "password", id: "pw", aria: "", placeholder: "", label: "", disabled: false, checked: null },
    { tag: "button", type: "submit", role: "", name: "", id: "", aria: "", placeholder: "", label: "Sign in", disabled: false, checked: null },
    { tag: "input", type: "checkbox", role: "", name: "remember", id: "", aria: "", placeholder: "", label: "Remember me", disabled: false, checked: true },
    { tag: "button", type: "button", role: "", name: "", id: "", aria: "", placeholder: "", label: "Delete", disabled: true, checked: null },
  ],
};

test("a snapshot names the page and numbers every interactive element from @e1", () => {
  const text = formatSnapshot(PAGE);
  assert.ok(text.startsWith("URL: https://example.com/login"), text);
  assert.ok(text.includes("Title: Sign in"));
  assert.ok(text.includes("Interactive elements (5):"));
  assert.ok(text.includes("@e1 <input type=email> name=email #user \"you@example.com\""), text);
  assert.ok(text.includes("@e3 <button type=submit> \"Sign in\""), text);
  assert.ok(text.includes("@e4 <input type=checkbox> name=remember \"Remember me\" [checked]"), text);
  assert.ok(text.includes("@e5 <button type=button> \"Delete\" [disabled]"), text);
});

test("the page text is omitted unless full is requested", () => {
  assert.ok(!formatSnapshot(PAGE).includes("Welcome back"));
  assert.ok(formatSnapshot(PAGE, { full: true }).includes("Page text:\nWelcome back"));
});

test("an empty page says so instead of rendering a blank list", () => {
  const text = formatSnapshot({ url: "about:blank", title: "", text: "", elements: [] });
  assert.ok(text.includes("(none found on this page)"), text);
});

test("a missing or malformed page never throws", () => {
  assert.doesNotThrow(() => formatSnapshot(null));
  assert.ok(formatSnapshot({}).includes("Interactive elements (0):"));
});

test("long labels are clipped so one control cannot flood the snapshot", () => {
  const long = "x".repeat(400);
  const line = describeElement({ tag: "a", type: "", role: "", name: "", id: "", aria: "", placeholder: "", label: long, disabled: false, checked: null }, "@e1");
  assert.ok(line.length < LABEL_LIMIT + 60, `line was ${line.length} chars`);
  assert.ok(line.includes("…"));
});

test("refIndex parses the refs the agent sends and rejects anything else", () => {
  assert.equal(refIndex("@e1"), 1);
  assert.equal(refIndex("@e12"), 12);
  assert.equal(refIndex(" @e3 "), 3);
  assert.equal(refIndex("@e0"), null);
  assert.equal(refIndex("@e"), null);
  assert.equal(refIndex("@e-1"), null);
  assert.equal(refIndex("@x3"), null);
  assert.equal(refIndex(undefined), null);
  assert.equal(refIndex(3), null);
});
