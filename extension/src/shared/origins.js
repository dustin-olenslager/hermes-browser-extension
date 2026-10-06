/**
 * Where this controller is willing to act.
 *
 * The point of this module: the browser being driven is the operator's real, signed-in profile. The
 * failure that matters is not "the action did not work" — it is "it worked on the wrong page", typing
 * into a form it should never have touched. So every action is gated on the target tab's URL before a
 * single protocol call is issued, and a refusal names the URL so the agent can report something
 * actionable instead of retrying blindly (spec FR-006, FR-007).
 *
 * Pure: no `chrome.*`, no DOM, no I/O. `URL` is the only global used, and it is a standard built-in
 * present in both Chrome and Node — which is what lets the whole policy be tested without a browser.
 */

/**
 * `file:` is refused outright rather than offered as a switch — see the note in ALWAYS_REFUSED_SCHEMES.
 * Declared before that list because the list references it (a `const` is not hoisted for reading).
 */
export const FILE_SCHEME = "file:";

/**
 * Schemes that are refused unconditionally, whatever the allowlist says.
 *
 * These are not "risky pages"; they are pages where the action cannot mean anything: browser-internal
 * UI and extension pages are not scriptable by a debugger attach, `view-source:` and `data:` have no
 * live DOM to act on, and `javascript:` is a script-execution vector wearing a URL's clothes. Letting
 * the operator allowlist any of them would be offering a switch that produces a confusing protocol
 * error instead of a refusal — so they are not on the list to be switched.
 */
export const ALWAYS_REFUSED_SCHEMES = Object.freeze([
  "chrome:",
  "chrome-untrusted:",
  "chrome-extension:",
  "chrome-search:",
  "devtools:",
  "edge:",
  "about:",
  "view-source:",
  "data:",
  "blob:",
  "javascript:",
  "filesystem:",
  "ws:",
  "wss:",
  // `file:` is here, not on the operator's switch, and that is a correction rather than a default.
  // A local file has NO origin — `new URL("file:///etc/hosts").origin` is the string "null" — so an
  // origin allowlist can never express it, and offering to allow it would be offering a switch that
  // cannot work. It also would not be a small permission: driving a `file:` page is a filesystem read
  // primitive against the operator's machine, which is a different and much larger thing than acting
  // on a web page. So it is refused, and the refusal says why.
  FILE_SCHEME,
]);

/**
 * Schemes allowed when the operator has NOT narrowed the list.
 *
 * The default is "any normal web page" rather than "nothing", because the alternative makes the
 * extension inert out of the box and the operator is the only user of this channel. It is still a
 * restriction: internal pages, local files and script URLs are refused above, which is the part that
 * actually protects the profile. Narrowing it further is the operator's call, not a default we pick
 * for him — and `allowedOrigins` is how he makes it.
 */
export const DEFAULT_SCHEMES = Object.freeze(["http:", "https:"]);

/** Parse a URL without throwing. Returns null for anything unusable. */
export function parseUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Normalize one operator-typed allowlist entry to an origin (`https://example.com`), or "" if unusable. */
export function normalizeOrigin(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  // A bare host (`example.com`) is what an operator actually types, and it must not silently become
  // nothing — an allowlist entry he believes he wrote is worse than a refusal, because it fails open
  // in his head. So when there is no scheme, retry as https before giving up.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const url = parseUrl(value) ?? (hasScheme ? null : parseUrl(`https://${value}`));
  if (!url || url.origin === "null") return "";
  return url.origin;
}

/**
 * Normalize the operator's allowlist: split on commas/newlines, normalize each entry, drop blanks,
 * dedupe. An empty result means "no narrowing" — not "allow nothing", which would be a trap.
 */
export function normalizeOriginList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\n,]+/);
  const seen = [];
  for (const part of parts) {
    const origin = normalizeOrigin(part);
    if (origin && !seen.includes(origin)) seen.push(origin);
  }
  return seen;
}

/**
 * Decide whether an action may target `rawUrl`.
 *
 * @param {string} rawUrl              the URL of the tab the action would act on
 * @param {string[]} allowedOrigins    the operator's narrowing (empty = default schemes only)
 * @returns {{ok: true, origin: string, scheme: string}|{ok: false, reason: string, url: string}}
 */
export function checkUrl(rawUrl, allowedOrigins = []) {
  const url = parseUrl(rawUrl);
  if (!url) {
    return { ok: false, reason: "the target has no usable URL", url: String(rawUrl ?? "") };
  }
  const scheme = url.protocol.toLowerCase();

  if (ALWAYS_REFUSED_SCHEMES.includes(scheme)) {
    return {
      ok: false,
      reason: `refused: this controller never acts on ${scheme} pages`,
      url: url.href,
    };
  }

  // An explicit allowlist entry is the only thing that can permit a non-default scheme such as `file:`.
  const list = normalizeOriginList(allowedOrigins);
  if (list.length > 0) {
    if (url.origin === "null" || !list.includes(url.origin)) {
      return {
        ok: false,
        reason: `refused: ${url.origin === "null" ? scheme : url.origin} is not in this controller's allowed origins`,
        url: url.href,
      };
    }
    return { ok: true, origin: url.origin, scheme };
  }

  if (!DEFAULT_SCHEMES.includes(scheme)) {
    return {
      ok: false,
      reason: `refused: ${scheme} is not allowed unless it is listed explicitly in the allowed origins`,
      url: url.href,
    };
  }

  return { ok: true, origin: url.origin, scheme };
}

/** True when the URL may be acted on. */
export function isAllowedUrl(rawUrl, allowedOrigins = []) {
  return checkUrl(rawUrl, allowedOrigins).ok;
}
