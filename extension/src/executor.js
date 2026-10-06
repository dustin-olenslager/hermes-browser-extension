/**
 * Step runner: executes the plans from `shared/actions.js` against real Chrome.
 *
 * This is the only module that touches `chrome.*`, and it is kept as thin as
 * possible — every decision it needs was already made in the plan. `chrome` is
 * injected so the module can be imported (and syntax-checked) outside a browser.
 */

import { planAction, formatTabs, targetUsable } from "./shared/actions.js";
import { FRAME_CANCEL } from "./shared/protocol.js";

/** How long to wait for a navigation to report `complete`. */
export const LOAD_TIMEOUT_MS = 15000;

/** How long to let a page react after a click/type/press/scroll. */
export const SETTLE_MS = 250;

/** CDP protocol version Chrome exposes to `chrome.debugger`. */
export const CDP_VERSION = "1.3";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ChromeExecutor {
  /** @param {typeof chrome} chromeApi */
  constructor(chromeApi) {
    this.chrome = chromeApi;
    this.attached = new Set();
    this.cancelled = new Set();
  }

  // ---- tab handling ------------------------------------------------------

  /** The tab a browser action should act on: the active tab of the current window. */
  async activeTab() {
    const [tab] = await this.chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || tab.id === undefined) throw new Error("no active tab to drive");
    return tab;
  }

  async allTabs() {
    const tabs = await this.chrome.tabs.query({});
    return tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url, active: Boolean(tab.active) }));
  }

  async activateTab(tabId) {
    const tab = await this.chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) {
      await this.chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    return tab;
  }

  /** Wait until the tab reports `complete`, or the timeout expires (never throws). */
  async waitForLoad(tabId) {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const tab = await this.chrome.tabs.get(tabId).catch(() => null);
      if (!tab) return;
      if (tab.status === "complete") return;
      await sleep(150);
    }
  }

  // ---- debugger handling -------------------------------------------------

  async ensureAttached(tabId) {
    if (this.attached.has(tabId)) return;
    try {
      await this.chrome.debugger.attach({ tabId }, CDP_VERSION);
    } catch (error) {
      const message = String(error?.message ?? error);
      // Already attached by us in a previous worker lifetime, or by DevTools.
      if (!/already attached/i.test(message)) throw error;
    }
    this.attached.add(tabId);
  }

  async detach(tabId) {
    if (!this.attached.has(tabId)) return;
    this.attached.delete(tabId);
    try {
      await this.chrome.debugger.detach({ tabId });
    } catch {
      /* the tab may already be gone */
    }
  }

  async detachAll() {
    for (const tabId of [...this.attached]) await this.detach(tabId);
  }

  /** One CDP call on a tab. Throws the page's own error text on failure. */
  async send(tabId, method, params = {}) {
    await this.ensureAttached(tabId);
    return await this.chrome.debugger.sendCommand({ tabId }, method, params);
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(tabId, expression) {
    const reply = await this.send(tabId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (reply?.exceptionDetails) {
      const detail = reply.exceptionDetails;
      throw new Error(detail.exception?.description ?? detail.text ?? "page evaluation failed");
    }
    return reply?.result?.value;
  }

  // ---- step runner -------------------------------------------------------

  /**
   * Run one plan's steps and return the action's result.
   *
   * @param {string} action
   * @param {object} args
   * @param {string} [commandId] used to honor a `browser.controller.cancel`
   * @param {string[]} [allowedOrigins] the operator's origin narrowing (empty = default schemes only)
   */
  async execute(action, args, commandId = "", allowedOrigins = []) {
    let tab = await this.activeTab();
    const plan = planAction(action, args, {
      activeTabId: tab.id,
      activeTabUrl: tab.url,
      allowedOrigins,
    });
    if (plan.error) throw new Error(plan.error);

    const context = { target: null };
    let last;

    for (const step of plan.steps) {
      if (commandId && this.cancelled.has(commandId)) {
        this.cancelled.delete(commandId);
        throw new Error("command cancelled");
      }
      last = await this.runStep(tab, step, context);
      // A step may have moved the session to another tab; re-resolve rather than
      // keep driving the tab we started on.
      if (context.retarget) {
        context.retarget = false;
        tab = await this.activeTab();
      }
    }

    if (action === "browser_screenshot") {
      return last ? `data:image/png;base64,${last}` : "screenshot failed";
    }
    return typeof last === "string" ? last : JSON.stringify(last ?? null);
  }

  async runStep(tab, step, context) {
    switch (step.kind) {
      case "cdp": {
        const reply = await this.send(tab.id, step.method, step.params);
        if (step.as) context[step.as] = reply;
        if (step.method === "Page.captureScreenshot") return reply?.data ?? "";
        return reply;
      }
      case "eval": {
        const value = await this.evaluate(tab.id, step.expression);
        if (step.as) context[step.as] = value;
        return value;
      }
      case "format": {
        const { formatSnapshot } = await import("./shared/snapshot.js");
        const page = context.page ?? (await this.evaluate(tab.id, "({})"));
        return formatSnapshot(page, { full: Boolean(step.full) });
      }
      case "clickTarget": {
        if (!targetUsable(context.target)) {
          throw new Error(
            context.target
              ? `element not found (page exposes ${context.target.count ?? 0} interactive elements — re-run browser_snapshot)`
              : "element not found — re-run browser_snapshot",
          );
        }
        await this.clickAt(tab.id, context.target.x, context.target.y);
        return context.target;
      }
      case "settle":
        await sleep(SETTLE_MS);
        return null;
      case "waitForLoad":
        await this.waitForLoad(tab.id);
        return null;
      case "listTabs": {
        const tabs = await this.allTabs();
        return formatTabs(tabs, tab.id);
      }
      case "activateTab": {
        await this.activateTab(step.tabId);
        // The plan's remaining steps belong to the newly activated tab.
        context.retarget = true;
        return null;
      }
      default:
        throw new Error(`unknown step ${JSON.stringify(step.kind)}`);
    }
  }

  /**
   * Dispatch a REAL mouse press/release at a point. A synthetic `element.click()`
   * is not a user gesture, so popups and OAuth redirects are silently dropped —
   * the same trap documented for Hermes' own CDP driving.
   */
  async clickAt(tabId, x, y) {
    const base = { x, y, button: "left", clickCount: 1, buttons: 1 };
    await this.send(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", ...base });
    await this.send(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
  }

  /** Record a cancel so the next step boundary aborts. */
  noteCancel(commandId) {
    if (!commandId) return;
    this.cancelled.add(commandId);
    if (this.cancelled.size > 256) {
      const oldest = this.cancelled.values().next().value;
      this.cancelled.delete(oldest);
    }
  }
}

export { FRAME_CANCEL };
