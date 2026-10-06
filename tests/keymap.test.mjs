import assert from "node:assert/strict";
import { test } from "node:test";

import { keyEvents, lookupKey, selectAllEvents, CTRL_MODIFIER } from "../extension/src/shared/keymap.js";

test("named keys resolve to the CDP virtual key codes Chrome expects", () => {
  assert.equal(lookupKey("Enter").vk, 13);
  assert.equal(lookupKey("Tab").vk, 9);
  assert.equal(lookupKey("Escape").vk, 27);
  assert.equal(lookupKey("ArrowDown").vk, 40);
});

test("Enter produces a rawKeyDown + keyUp pair, never a bare char event", () => {
  const events = keyEvents("Enter");
  assert.deepEqual(events.map((e) => e.type), ["rawKeyDown", "keyUp"]);
  assert.equal(events[0].windowsVirtualKeyCode, 13);
  assert.equal(events[0].code, "Enter");
});

test("a printable single character is pressed as text", () => {
  const events = keyEvents("a");
  assert.deepEqual(events.map((e) => e.type), ["rawKeyDown", "char", "keyUp"]);
  assert.equal(events[1].text, "a");
});

test("a modified key press suppresses the char event so the shortcut is not typed", () => {
  const events = keyEvents("a", { modifiers: CTRL_MODIFIER });
  assert.deepEqual(events.map((e) => e.type), ["rawKeyDown", "keyUp"]);
  assert.equal(events[0].modifiers, 2);
});

test("selectAllEvents is a real Ctrl+A", () => {
  const events = selectAllEvents();
  assert.equal(events[0].code, "KeyA");
  assert.equal(events[0].modifiers, CTRL_MODIFIER);
  assert.equal(events.length, 2);
});

test("an unknown key name is rejected rather than silently typed", () => {
  assert.equal(keyEvents("Frobnicate"), null);
  assert.equal(keyEvents(""), null);
  assert.equal(keyEvents(undefined), null);
});

test("Space presses a space rather than an unprintable control", () => {
  const events = keyEvents("Space");
  assert.equal(events[0].windowsVirtualKeyCode, 32);
  assert.equal(events.some((e) => e.text === " "), true);
});
