import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALWAYS_REFUSED_SCHEMES,
  DEFAULT_SCHEMES,
  checkUrl,
  isAllowedUrl,
  normalizeOrigin,
  normalizeOriginList,
  parseUrl,
} from "../extension/src/shared/origins.js";

test("a normal web page is allowed by default", () => {
  assert.equal(isAllowedUrl("https://example.com/a?b=1"), true);
  assert.equal(isAllowedUrl("http://example.com"), true);
});

test("browser-internal and extension pages are refused, and the refusal names the page", () => {
  for (const url of [
    "chrome://extensions",
    "chrome-extension://abcdef/popup.html",
    "chrome-untrusted://foo",
    "devtools://devtools/bundled/inspector.html",
    "about:blank",
  ]) {
    const verdict = checkUrl(url);
    assert.equal(verdict.ok, false, `${url} should be refused`);
    assert.match(verdict.reason, /never acts on/);
    assert.ok(verdict.url.includes(url.split(":")[0]), "the refusal names the target");
  }
});

test("script and data URLs are refused — a URL must not be a code-execution vector", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "view-source:https://example.com"]) {
    assert.equal(checkUrl(url).ok, false, `${url} should be refused`);
  }
});

test("a local file is refused, and cannot be allowed by the switch", () => {
  // A `file:` URL has NO origin (`new URL("file:///x").origin` is the string "null"), so an origin
  // allowlist cannot express it. Refusing it outright is the honest shape; a switch that cannot work
  // is worse than no switch. Driving a local file is also a filesystem read primitive, not a page.
  assert.equal(isAllowedUrl("file:///etc/hosts"), false);
  assert.equal(isAllowedUrl("file:///etc/hosts", ["file://"]), false);
  assert.equal(isAllowedUrl("file:///etc/hosts", ["file:///etc"]), false);
  const verdict = checkUrl("file:///etc/hosts", ["file://"]);
  assert.match(verdict.reason, /never acts on/);
});

test("an explicit allowlist narrows to exactly those origins", () => {
  const list = ["https://example.com"];
  assert.equal(isAllowedUrl("https://example.com/deep/path", list), true);
  assert.equal(isAllowedUrl("https://other.example.com", list), false);
  assert.equal(isAllowedUrl("http://example.com", list), false, "scheme is part of an origin");
  assert.equal(isAllowedUrl("https://example.com:8443", list), false, "port is part of an origin");
});

test("an out-of-policy origin refusal names the origin, so the agent can act on it", () => {
  const verdict = checkUrl("https://evil.example/x", ["https://example.com"]);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /https:\/\/evil\.example/);
  assert.match(verdict.url, /https:\/\/evil\.example\/x/);
});

test("a refused scheme cannot be smuggled in via the allowlist", () => {
  // Allowing a scheme that is ALWAYS refused must not work — otherwise the switch is a lie.
  for (const scheme of ALWAYS_REFUSED_SCHEMES) {
    const verdict = checkUrl(`${scheme}//x`, [`${scheme}//`]);
    assert.equal(verdict.ok, false, `${scheme} must stay refused even when listed`);
  }
});

test("an unusable URL is refused rather than treated as allowed", () => {
  assert.equal(isAllowedUrl(""), false);
  assert.equal(isAllowedUrl("   "), false);
  assert.equal(isAllowedUrl(null), false);
  assert.equal(isAllowedUrl("not a url"), false);
  assert.equal(isAllowedUrl("https://"), false);
});

test("normalizeOrigin accepts a bare host, a URL, and a trailing slash", () => {
  assert.equal(normalizeOrigin("example.com"), "https://example.com");
  assert.equal(normalizeOrigin("https://example.com/"), "https://example.com");
  assert.equal(normalizeOrigin("https://example.com/deep/path"), "https://example.com");
  assert.equal(normalizeOrigin("http://example.com:8080/x"), "http://example.com:8080");
  assert.equal(normalizeOrigin(""), "");
  assert.equal(normalizeOrigin("   "), "");
  assert.equal(normalizeOrigin("chrome://extensions"), "");
});

test("normalizeOriginList splits on commas and newlines, dedupes, drops blanks", () => {
  // Order is first-seen, and a duplicate is dropped in favour of the earlier entry.
  assert.deepEqual(normalizeOriginList("example.com, https://other.com\nhttps://example.com"), [
    "https://example.com",
    "https://other.com",
  ]);
  assert.deepEqual(normalizeOriginList(""), []);
  assert.deepEqual(normalizeOriginList([null, undefined, "  "]), []);
  assert.deepEqual(normalizeOriginList("not a url"), []);
});

test("an empty list means default schemes, NOT allow-nothing", () => {
  // The trap this pins: an empty allowlist that refuses everything makes the extension inert out of
  // the box, which reads as "broken" and gets worked around. Empty must mean the safe default.
  assert.deepEqual(normalizeOriginList(""), []);
  assert.equal(isAllowedUrl("https://example.com", []), true);
});

test("the default scheme set is http/https and contains no refused scheme", () => {
  assert.deepEqual([...DEFAULT_SCHEMES], ["http:", "https:"]);
  for (const scheme of DEFAULT_SCHEMES) {
    assert.equal(ALWAYS_REFUSED_SCHEMES.includes(scheme), false, `${scheme} must not be always-refused`);
  }
});

test("parseUrl never throws on hostile input", () => {
  for (const input of ["", null, undefined, "{}", "https://[", "a".repeat(5000), "://"]) {
    assert.doesNotThrow(() => parseUrl(input));
  }
});

test("case and whitespace in a URL are handled", () => {
  assert.equal(isAllowedUrl("  https://Example.COM/Path  "), true);
  assert.equal(normalizeOrigin("  Example.com  "), "https://example.com");
});
