/**
 * Keyboard mapping for `browser_press`.
 *
 * Hermes' `browser_press` passes a human key name ("Enter", "Tab", "ArrowDown").
 * CDP wants a rawKeyDown/keyUp pair with a `windowsVirtualKeyCode`; a bare
 * `text`-only dispatch does not submit forms. Pure data + a lookup, so it is
 * unit-testable without a browser.
 */

const KEYS = {
  Enter: { code: "Enter", key: "Enter", vk: 13 },
  Tab: { code: "Tab", key: "Tab", vk: 9 },
  Escape: { code: "Escape", key: "Escape", vk: 27 },
  Backspace: { code: "Backspace", key: "Backspace", vk: 8 },
  Delete: { code: "Delete", key: "Delete", vk: 46 },
  Space: { code: "Space", key: " ", vk: 32, text: " " },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", vk: 39 },
  Home: { code: "Home", key: "Home", vk: 36 },
  End: { code: "End", key: "End", vk: 35 },
  PageUp: { code: "PageUp", key: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", key: "PageDown", vk: 34 },
};

/** Modifier bit for Ctrl in CDP's Input.dispatchKeyEvent. */
export const CTRL_MODIFIER = 2;

/** Resolve a key name to a CDP key descriptor, or null when unsupported. */
export function lookupKey(name) {
  const value = String(name ?? "").trim();
  if (!value) return null;
  if (KEYS[value]) return KEYS[value];
  // Single printable character: press it as text.
  if (value.length === 1) {
    const upper = value.toUpperCase();
    return {
      code: `Key${upper}`,
      key: value,
      vk: upper.charCodeAt(0),
      text: value,
    };
  }
  return null;
}

/** The CDP events for one key press, in order. */
export function keyEvents(name, { modifiers = 0 } = {}) {
  const descriptor = lookupKey(name);
  if (!descriptor) return null;
  const base = {
    code: descriptor.code,
    key: descriptor.key,
    windowsVirtualKeyCode: descriptor.vk,
    nativeVirtualKeyCode: descriptor.vk,
    modifiers,
  };
  const events = [{ type: "rawKeyDown", ...base }];
  if (descriptor.text && !modifiers) {
    events.push({ type: "char", text: descriptor.text, ...base });
  }
  events.push({ type: "keyUp", ...base });
  return events;
}

/** The CDP events that select the whole field (Ctrl+A). */
export function selectAllEvents() {
  return keyEvents("a", { modifiers: CTRL_MODIFIER }) ?? [];
}
