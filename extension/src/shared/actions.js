/**
 * Execution plan: turn one Hermes browser action into concrete Chrome API calls.
 *
 * Pure by construction — it returns *steps* and never calls `chrome.*`. The
 * background worker runs the steps. Keeping the decision here is what makes the
 * whole action surface testable without a browser: the risky part (which tab, what
 * CDP call, how to parse the reply) is verified in Node, and only the transport
 * stays unverified.
 *
 * Step shapes:
 *   { kind: "cdp",   method, params }            -> chrome.debugger.sendCommand
 *   { kind: "query", query, active, currentWindow } -> chrome.tabs.query
 *   { kind: "eval",  expression }                -> Runtime.evaluate on the tab
 */

import { COLLECT_FN, formatSnapshot, refIndex } from "./snapshot.js";
import { keyEvents } from "./keymap.js";
import { checkUrl } from "./origins.js";

const LARGE = 100000;

/** CDP calls that a click/type/scroll/press needs before it can be issued. */
const ENABLE_RUNTIME = { kind: "cdp", method: "Runtime.enable", params: {} };

/**
 * Resolve a ref (`@e3`) to a page element and return a description the action can
 * use. Kept as page source because it must run in the page, not the worker.
 */
function resolveRefFn(ref) {
  return `(() => {
  const SEL = ${JSON.stringify("a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=combobox],[role=menuitem],[role=switch],[contenteditable=true],[onclick]")};
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
  };
  const nodes = [...document.querySelectorAll(SEL)].filter(visible);
  const el = nodes[${ref} - 1];
  if (!el) return { found: false, count: nodes.length };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  return {
    found: true, count: nodes.length,
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute("type") || "").toLowerCase(),
    label: (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 120),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
  };
})()`;
}

/** The page source that selects the whole field of a focused input. */
const SELECT_ALL_FN = `(() => {
  const el = document.activeElement;
  if (!el || !("select" in el)) return { selected: false };
  el.select();
  return { selected: true };
})()`;

function failure(error) {
  return { error: String(error) };
}

/**
 * Build the steps for one action.
 *
 * Every action except the two that only read the tab list is gated on the TARGET URL before a single
 * protocol call is issued — the profile being driven is the operator's real, signed-in one, so acting
 * on a page outside the policy is the failure that matters (FR-006, FR-007). The refusal names the URL
 * so the agent gets something actionable rather than a bare error.
 *
 * @param {string} action   e.g. "browser_click"
 * @param {object} args     the arguments Hermes sent (immutable on the wire)
 * @param {object} ctx      { activeTabId, activeTabUrl, allowedOrigins } for the resolved target tab
 * @returns {{steps: object[]}|{error: string}}
 */
export function planAction(action, args = {}, ctx = {}) {
  // The two actions that only enumerate tabs never touch a page, so the URL policy does not apply.
  const enumeratesOnly = action === "browser_tabs";
  if (!enumeratesOnly) {
    const verdict = checkUrl(ctx.activeTabUrl, ctx.allowedOrigins ?? []);
    if (!verdict.ok) {
      return failure(`${verdict.reason} — target was ${verdict.url}`);
    }
  }

  switch (action) {
    case "browser_navigate": {
      const url = String(args.url ?? "").trim();
      if (!url) return failure("browser_navigate requires a url");
      const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
      // Navigation is the one action whose TARGET is not the tab's current URL, so it needs its own
      // check: without it the policy would gate the page you are leaving and wave through the page you
      // are going to — the one gap that would make the whole allowlist decorative.
      const destination = checkUrl(target, ctx.allowedOrigins ?? []);
      if (!destination.ok) {
        return failure(`${destination.reason} — destination was ${destination.url}`);
      }
      return {
        steps: [
          { kind: "cdp", method: "Page.enable", params: {} },
          { kind: "cdp", method: "Page.navigate", params: { url: target } },
          { kind: "waitForLoad" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_snapshot": {
      return {
        steps: [
          ENABLE_RUNTIME,
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: Boolean(args.full) },
        ],
      };
    }

    case "browser_click": {
      const index = refIndex(args.ref);
      if (index === null) return failure(`browser_click needs a ref like @e3 (got ${JSON.stringify(args.ref ?? "")})`);
      return {
        steps: [
          ENABLE_RUNTIME,
          { kind: "eval", expression: resolveRefFn(index), as: "target" },
          { kind: "clickTarget" },
          { kind: "settle" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_type": {
      const index = refIndex(args.ref);
      if (index === null) return failure(`browser_type needs a ref like @e3 (got ${JSON.stringify(args.ref ?? "")})`);
      const text = String(args.text ?? "");
      return {
        steps: [
          ENABLE_RUNTIME,
          { kind: "eval", expression: resolveRefFn(index), as: "target" },
          { kind: "clickTarget" },
          { kind: "eval", expression: SELECT_ALL_FN },
          { kind: "cdp", method: "Input.insertText", params: { text } },
          { kind: "settle" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_press": {
      const events = keyEvents(String(args.key ?? ""));
      if (!events) return failure(`unsupported key ${JSON.stringify(args.key ?? "")}`);
      return {
        steps: [
          ...events.map((params) => ({ kind: "cdp", method: "Input.dispatchKeyEvent", params })),
          { kind: "settle" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_scroll": {
      const direction = String(args.direction ?? "down").toLowerCase() === "up" ? "up" : "down";
      const delta = direction === "up" ? -600 : 600;
      return {
        steps: [
          ENABLE_RUNTIME,
          { kind: "cdp", method: "Runtime.evaluate", params: { expression: `window.scrollBy(0, ${delta})` } },
          { kind: "settle" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_back": {
      return {
        steps: [
          ENABLE_RUNTIME,
          { kind: "cdp", method: "Runtime.evaluate", params: { expression: "history.back()" } },
          { kind: "waitForLoad" },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_tabs": {
      return { steps: [{ kind: "listTabs" }] };
    }

    case "browser_tab_activate": {
      const tabId = Number.parseInt(args.tab_id ?? args.tabId ?? "", 10);
      if (!Number.isInteger(tabId)) return failure("browser_tab_activate requires a numeric tab_id");
      return {
        steps: [
          { kind: "activateTab", tabId },
          { kind: "eval", expression: COLLECT_FN, as: "page" },
          { kind: "format", full: false },
        ],
      };
    }

    case "browser_screenshot": {
      return {
        steps: [
          { kind: "cdp", method: "Page.enable", params: {} },
          { kind: "cdp", method: "Page.captureScreenshot", params: { format: "png" }, as: "shot" },
        ],
      };
    }

    default:
      return failure(`action ${JSON.stringify(action)} is not supported by this controller`);
  }
}

/** Format a tab list the way the agent expects to read it. */
export function formatTabs(tabs, activeTabId) {
  const lines = ["Open tabs:"];
  for (const tab of tabs) {
    const marker = tab.id === activeTabId ? " *active*" : "";
    lines.push(`  [${tab.id}] ${String(tab.title ?? "").slice(0, 80)} — ${String(tab.url ?? "").slice(0, 120)}${marker}`);
  }
  return lines.join("\n");
}

/** True when a click target came back as a real, resolvable element. */
export function targetUsable(target) {
  return Boolean(target && target.found && Number.isFinite(target.x) && Number.isFinite(target.y));
}

export { formatSnapshot, LARGE };
