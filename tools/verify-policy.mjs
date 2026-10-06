/**
 * Integration proof for the URL policy, at the layer that actually touches the browser.
 *
 * The unit tests prove the planner and the policy in isolation. This drives the REAL Executor
 * against a recording fake chrome.* and asserts what did and did not reach the browser:
 *   - an out-of-policy tab issues NO chrome.debugger call at all (fail-closed, not fail-after)
 *   - an in-policy tab does issue them
 *   - the refusal text names the URL
 */
/**
 * Run: `node tools/verify-policy.mjs`
 *
 * Not part of `npm test`: the suite must stay runnable with no browser, and this drives the real
 * Executor against a fake `chrome.*`. It is the layer between the unit tests (which prove the planner
 * and the policy in isolation) and the live gateway run (which proves routing) — the one that answers
 * "did the refusal actually stop the browser call, or did it fail after trying?".
 */
const EXT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { ChromeExecutor } = await import(`${EXT}/extension/src/executor.js`);

function fakeChrome({ url }) {
  const calls = [];
  return {
    calls,
    chrome: {
      tabs: {
        query: async () => [{ id: 7, url, active: true }],
        get: async (id) => ({ id, url }),
      },
      debugger: {
        attach: async (t, v) => calls.push({ m: "attach", t, v }),
        detach: async () => calls.push({ m: "detach" }),
        sendCommand: async (t, method, params) => {
          calls.push({ m: "sendCommand", method });
          if (method === "Runtime.evaluate") return { result: { value: { url, title: "T", text: "hi", elements: [] } } };
          if (method === "Page.captureScreenshot") return { data: "AAAA" };
          if (method === "Target.getTargets") return { targetInfos: [{ targetId: "7", type: "page", url, title: "T" }] };
          return {};
        },
        on: () => {},
        off: () => {},
      },
    },
  };
}

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✖"} ${label}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

// 1. Out of policy: the browser must never be touched.
{
  const { chrome, calls } = fakeChrome({ url: "https://evil.example/x" });
  const ex = new ChromeExecutor(chrome);
  let error = "";
  try { await ex.execute("browser_snapshot", {}, "", ["https://example.com"]); } catch (e) { error = e.message; }
  check("out-of-policy tab is refused", /not in this controller's allowed origins/.test(error), error);
  check("the refusal names the URL", /evil\.example/.test(error), error);
  check("NO browser call was issued (fail-closed)", calls.length === 0, JSON.stringify(calls));
}

// 2. In policy: it proceeds and issues the protocol calls.
{
  const { chrome, calls } = fakeChrome({ url: "https://example.com/app" });
  const ex = new ChromeExecutor(chrome);
  const result = await ex.execute("browser_snapshot", {}, "", ["https://example.com"]);
  check("in-policy tab proceeds", typeof result === "string" && result.length > 0, JSON.stringify(result));
  check("the browser WAS driven", calls.some((c) => c.m === "sendCommand"), JSON.stringify(calls));
  check("debugger attached", calls.some((c) => c.m === "attach"), JSON.stringify(calls));
  // The attachment is deliberately held across actions (re-attaching per action would flash Chrome's
  // debugging banner every call), so it is released on disconnect — not at the end of an action.
  check("attachment is NOT released mid-session", !calls.some((c) => c.m === "detach"), JSON.stringify(calls));
  await ex.detachAll();
  check("detachAll releases it (what Disconnect now calls)", calls.some((c) => c.m === "detach"), JSON.stringify(calls));
}

// 3. Navigation is gated on the DESTINATION.
{
  const { chrome, calls } = fakeChrome({ url: "https://example.com/" });
  const ex = new ChromeExecutor(chrome);
  let error = "";
  try { await ex.execute("browser_navigate", { url: "https://evil.example/steal" }, "", ["https://example.com"]); } catch (e) { error = e.message; }
  check("navigating off the allowlist is refused", /destination was https:\/\/evil\.example\/steal/.test(error), error);
  check("no navigation reached the browser", !calls.some((c) => c.m === "sendCommand" && c.method === "Page.navigate"), JSON.stringify(calls));
}

// 4. A browser-internal tab is refused with no allowlist set at all.
{
  const { chrome, calls } = fakeChrome({ url: "chrome://settings" });
  const ex = new ChromeExecutor(chrome);
  let error = "";
  try { await ex.execute("browser_snapshot", {}, "", []); } catch (e) { error = e.message; }
  check("chrome:// refused with no allowlist", /never acts on chrome:/.test(error), error);
  check("no browser call for an internal page", calls.length === 0, JSON.stringify(calls));
}

console.log(failures === 0 ? "\nINTEGRATION OK" : `\nINTEGRATION FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
