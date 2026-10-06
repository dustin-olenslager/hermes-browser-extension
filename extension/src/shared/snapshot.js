/**
 * Page snapshot formatting.
 *
 * The agent reads a text snapshot and clicks by ref (`@e3`), exactly as with
 * Hermes' own built-in browser tools. The page-side collector returns a raw
 * structure; this module turns it into that text. Pure, so it is unit-testable.
 */

/** Longest label kept per element, in characters. */
export const LABEL_LIMIT = 90;

/** Longest page-text body kept in `full` mode, in characters. */
export const TEXT_LIMIT = 12000;

/** Elements the collector treats as interactive, in document order. */
export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=combobox]",
  "[role=menuitem]",
  "[role=switch]",
  "[contenteditable=true]",
  "[onclick]",
].join(",");

/**
 * The function evaluated inside the page to collect a snapshot. Kept as a string
 * because `Runtime.evaluate` takes source, and it must not close over module state.
 */
export const COLLECT_FN = `(() => {
  const SEL = ${JSON.stringify(INTERACTIVE_SELECTOR)};
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const elements = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    elements.push({
      tag: el.tagName.toLowerCase(),
      type: (el.getAttribute("type") || "").toLowerCase(),
      role: el.getAttribute("role") || "",
      name: el.getAttribute("name") || "",
      id: el.id || "",
      aria: el.getAttribute("aria-label") || "",
      placeholder: el.getAttribute("placeholder") || "",
      label: (el.innerText || el.value || el.getAttribute("value") || el.getAttribute("title") || "").trim(),
      disabled: el.disabled === true,
      checked: typeof el.checked === "boolean" ? el.checked : null,
    });
    if (elements.length >= 400) break;
  }
  return {
    url: location.href,
    title: document.title,
    text: document.body ? (document.body.innerText || "").slice(0, 20000) : "",
    elements,
  };
})()`;

function clip(value, limit = LABEL_LIMIT) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** One line describing a single interactive element. */
export function describeElement(el, ref) {
  const parts = [`${ref} <${el.tag}${el.type && el.type !== "text" ? ` type=${el.type}` : ""}>`];
  if (el.role) parts.push(`role=${el.role}`);
  if (el.name) parts.push(`name=${el.name}`);
  if (el.id) parts.push(`#${el.id}`);
  const label = el.label || el.aria || el.placeholder;
  if (label) parts.push(JSON.stringify(clip(label)));
  else if (el.aria) parts.push(JSON.stringify(clip(el.aria)));
  if (el.checked === true) parts.push("[checked]");
  if (el.disabled) parts.push("[disabled]");
  return parts.join(" ");
}

/**
 * Format a collected page into the text snapshot the agent reads.
 *
 * `full` appends the page's own text so the agent can read content without
 * another call, matching the built-in `browser_snapshot(full=true)` behavior.
 */
export function formatSnapshot(page, { full = false, refPrefix = "@e" } = {}) {
  const lines = [`URL: ${page?.url ?? ""}`, `Title: ${clip(page?.title ?? "", 160)}`];
  const elements = Array.isArray(page?.elements) ? page.elements : [];
  lines.push("", `Interactive elements (${elements.length}):`);
  if (!elements.length) {
    lines.push("  (none found on this page)");
  } else {
    elements.forEach((el, index) => lines.push(`  ${describeElement(el, `${refPrefix}${index + 1}`)}`));
  }
  if (full) {
    const text = String(page?.text ?? "").trim();
    lines.push("", "Page text:", text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}\n…(truncated)` : text);
  }
  return lines.join("\n");
}

/** Extract the 1-based element index from a ref like `@e12`. */
export function refIndex(ref, refPrefix = "@e") {
  const value = String(ref ?? "").trim();
  if (!value.startsWith(refPrefix)) return null;
  const index = Number.parseInt(value.slice(refPrefix.length), 10);
  return Number.isInteger(index) && index > 0 ? index : null;
}
