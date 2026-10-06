#!/usr/bin/env node
/**
 * The dependency-direction gate: the pure layer must stay importable without a browser.
 *
 * `extension/src/shared/**` and `extension/src/controller.js` are the inner layers — the
 * protocol contract, the key map, the snapshot formatter, the action planner, and the
 * connection state machine. None of them may reach for `chrome.*`, the DOM, or a global
 * `fetch`/`WebSocket`. Everything that needs those is either an injected argument
 * (`fetchImpl`, `WebSocketImpl`, `execute`) or a *step* the adapter layer runs.
 *
 * Without this gate the split decays silently: a planner that calls `chrome.tabs.query`
 * still passes its unit tests against a fake, and the module quietly stops being portable.
 *
 * Two things make this gate trustworthy rather than noisy, and both matter:
 *
 *   1. **Comments and string/template literals are stripped before scanning.** The page
 *      source this extension injects (`COLLECT_FN`, `resolveRefFn`) is a template literal —
 *      it runs in the PAGE, not in the extension, so `document.querySelectorAll` inside it
 *      is a payload, not a violation. The wire method names (`"browser.controller.command"`)
 *      are likewise data. A naive grep flags all of these and gets ignored, which is worse
 *      than no gate.
 *   2. **A known limitation, stated rather than hidden:** code inside a `${...}`
 *      interpolation of a template literal is stripped along with the literal. A violation
 *      written there would be missed. Do not put browser access in an interpolation.
 *
 *   node tools/check-arch-boundary.mjs            # whole tree
 *   node tools/check-arch-boundary.mjs --staged   # only files staged for commit
 *   ARCH_OFF=1 node tools/check-arch-boundary.mjs # declared exception
 *
 * Exit 0 = clean, 1 = violation(s), 2 = the checker could not run.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** Directories and files that make up the inner (pure) layers. */
export const PURE_TARGETS = ["extension/src/shared", "extension/src/controller.js"];

/** Globals/members the pure layer must never touch. */
export const FORBIDDEN = [
  { name: "chrome API", pattern: /(^|[^A-Za-z0-9_$.])chrome\s*\./ },
  { name: "browser API", pattern: /(^|[^A-Za-z0-9_$.])browser\s*\./ },
  { name: "DOM document", pattern: /(^|[^A-Za-z0-9_$.])document\s*\./ },
  { name: "window global", pattern: /(^|[^A-Za-z0-9_$.])window\s*\./ },
  { name: "global fetch", pattern: /(^|[^A-Za-z0-9_$.])fetch\s*\(/ },
  { name: "global WebSocket", pattern: /(^|[^A-Za-z0-9_$.])new\s+WebSocket\s*\(/ },
  { name: "localStorage", pattern: /(^|[^A-Za-z0-9_$.])localStorage\b/ },
  { name: "navigator", pattern: /(^|[^A-Za-z0-9_$.])navigator\s*\./ },
  { name: "importScripts", pattern: /(^|[^A-Za-z0-9_$.])importScripts\s*\(/ },
];

/**
 * Replace every comment and string/template literal with equivalent whitespace, keeping
 * newlines so reported line numbers stay correct.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripCommentsAndStrings(source) {
  let out = "";
  let i = 0;
  const push = (text) => {
    out += text;
  };
  const blank = (text) => {
    out += text.replace(/[^\n]/g, " ");
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    // Line comment
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    // Block comment
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    // String / template literal (regex literals are not used in the pure layer)
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        j += 1;
      }
      const stop = Math.min(j + 1, source.length);
      blank(source.slice(i, stop));
      i = stop;
      continue;
    }
    push(char);
    i += 1;
  }
  return out;
}

/** Violations found in one file's source. */
export function findViolations(source) {
  const stripped = stripCommentsAndStrings(source);
  const lines = stripped.split("\n");
  const found = [];
  lines.forEach((line, index) => {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) {
        found.push({ line: index + 1, rule: rule.name, text: line.trim() });
      }
    }
  });
  return found;
}

/** Every `.js` file under the pure targets. */
export function collectFiles(root, stagedOnly = false) {
  if (stagedOnly) {
    const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
      cwd: root,
      encoding: "utf8",
    });
    return staged
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && PURE_TARGETS.some((t) => line === t || line.startsWith(`${t}/`)));
  }

  const files = [];
  for (const target of PURE_TARGETS) {
    const full = path.join(root, target);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      files.push(target);
      continue;
    }
    const walk = (dir) => {
      for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (entry.name.endsWith(".js")) files.push(rel);
      }
    };
    walk(target);
  }
  return files;
}

function main() {
  if (process.env.ARCH_OFF === "1") {
    console.log("check-arch-boundary: disabled (ARCH_OFF=1)");
    return 0;
  }
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const stagedOnly = process.argv.includes("--staged");

  let files;
  try {
    files = collectFiles(root, stagedOnly);
  } catch (error) {
    console.error(`check-arch-boundary: could not enumerate files — ${error.message}`);
    return 2;
  }

  let failures = 0;
  for (const file of files) {
    const violations = findViolations(readFileSync(path.join(root, file), "utf8"));
    if (!violations.length) continue;
    failures += 1;
    console.error(`✖ ${file} reaches outside the pure layer:`);
    for (const v of violations) console.error(`    ${file}:${v.line}  ${v.rule}  →  ${v.text}`);
  }

  if (failures) {
    console.error("");
    console.error(`check-arch-boundary: ${failures} file(s) violate the dependency direction.`);
    console.error(
      "Move the browser/DOM/global access into extension/src/executor.js as a step, or take it as an\n" +
        "injected argument — do not call it from the pure layer.",
    );
    return 1;
  }
  console.log(`check-arch-boundary: OK — ${files.length} pure file(s) free of chrome/DOM/global access`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
