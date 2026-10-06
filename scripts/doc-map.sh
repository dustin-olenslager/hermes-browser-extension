#!/bin/sh
# doc-map — a generated index of this repo's documents, for agents.
#
# WHY THIS EXISTS: an agent asked to "update the docs" otherwise greps, opens files, and reads
# whole documents to find out which one is relevant. On a repo whose docs are 5x its code (panoply:
# 1.82MB of markdown vs 341KB of shell), that is the dominant token cost — and it is paid before any
# useful work starts. This prints a table: what each doc is FOR, how big it is, and when it changed.
# Read ~2k tokens of index, then open the one or two documents that matter.
#
# WHAT IT IS NOT: it does not summarise content, and it does not replace reading a doc you intend to
# edit. It answers *which* doc and *whether it is worth it* — nothing more. A map that pretends to
# know what a doc says is worse than no map, because you stop looking.
#
# NO DEPENDENCIES. POSIX sh + awk. No python, no tree-sitter, no index to keep fresh: it reads the
# tree as it is right now, so it cannot go stale. A cached map is the failure mode of every code-map
# tool; the cheap way to never be stale is to not cache.
#
# USAGE
#   sh scripts/doc-map.sh                 human table for the whole repo
#   sh scripts/doc-map.sh --dir docs/agents   limit to a subtree
#   sh scripts/doc-map.sh --json          machine-readable (for an agent to parse)
#   sh scripts/doc-map.sh --check         exit 1 if a doc is missing the header this relies on
#
# ESCAPE: DOC_MAP_OFF=1 makes --check a no-op (for a repo mid-migration).

set -u

# Flags are parsed in a LOOP. The earlier single-shot `case "$1"` accepted only one flag, so
# `--dir X --check` silently ignored `--check` and printed a table instead of checking — a run that
# looked like it validated a subtree and had not. Any multi-flag call was quietly wrong.
MODE="table"
DIR="."
while [ $# -gt 0 ]; do
  case "$1" in
    --json)  MODE="json" ;;
    --check) MODE="check" ;;
    --table) MODE="table" ;;
    --dir)   shift; DIR="${1:-.}" ;;
    *)       echo "doc-map: unknown argument '$1'" >&2; exit 2 ;;
  esac
  shift
done

# --- scope skip test -------------------------------------------------------------------------
# Generated, vendored, or archival paths are listed but never counted as orientation cost.
# `completed/` IS included: it is the archive an agent should consult before re-litigating a
# decision, so it must be findable. It is marked so you know it is history, not current doctrine.
should_list() {
  case "$1" in
    .git/*|*/node_modules/*|*/vendor/*) return 1 ;;
    *) return 0 ;;
  esac
}

# --- header extraction ------------------------------------------------------------------------
# Docs in this repo declare their contract in the first few lines:
#   `> **Applies when:** <when>`  /  `> **Delete this file if:** <when>`   (rule modules)
#   `- **Area:** ... **Status:** ...`                                       (spec/plan docs)
#   `# <Title>`                                                             (everything)
# We read the DECLARED contract when present and say so honestly when it is absent, rather than
# inventing a summary — an invented purpose is how a map starts lying.
extract() {
  f="$1"
  awk '
    NR > 30 { exit }
    /^#[^#]/ && title == "" { t = $0; sub(/^#[ ]*/, "", t); title = t }
    /Applies when:/ {
      a = $0
      sub(/.*Applies when:[ ]*/, "", a)
      gsub(/\*\*/, "", a)          # rules write the condition in bold; keep the words, drop the markup
      gsub(/^[*> ]+/, "", a)         # leading quote/bullet/emphasis from the blockquote form
      gsub(/[ ]+$/, "", a)
      applies = a
    }
    /Delete this file \(and its/ || /Delete this file if:/ {
      d = $0; sub(/.*if:[ ]*/, "", d); gsub(/^[>* ]+/, "", d); gsub(/  *$/, "", d)
    }
    /^\*\*Area:/ || /^- \*\*Area:/ { s = $0; sub(/.*Status:[ ]*/, "", s); sub(/[ ].*/, "", s); status = s }
    END {
      printf "%s\t%s\t%s\n", title, applies, status
    }
  ' "$f"
}

# --- collect ----------------------------------------------------------------------------------
TMP="$(mktemp)" || exit 1
trap 'rm -f "$TMP"' EXIT INT TERM

find "$DIR" -name '*.md' -type f 2>/dev/null | sort | while read -r f; do
  should_list "$f" || continue
  bytes=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  lines=$(wc -l < "$f" 2>/dev/null | tr -d ' ')
  # `stat -c` is GNU-only; `-f` is BSD. Try both (see factory-detect.sh for the same trap).
  mtime=$(stat -c '%Y' "$f" 2>/dev/null || stat -f '%m' "$f" 2>/dev/null || echo 0)
  meta=$(extract "$f")
  title=$(printf '%s' "$meta" | cut -f1)
  applies=$(printf '%s' "$meta" | cut -f2)

  kind="doc"
  # Match on the path with any leading directory stripped, so classification is identical whether the
  # file arrived as `./docs/x/y.md` (cwd-relative) or `/home/me/repo/docs/x/y.md` (`--dir /abs`).
  # Classifying an absolute path against `*/foo/*` patterns silently produced kind=doc, which made
  # `--check` PASS on a repo whose rules were unindexable — a gate reporting OK because it was looking
  # somewhere other than where it believed it was.
  rel="$f"
  case "$rel" in "$PWD"/*) rel="${rel#"$PWD"/}" ;; esac
  case "$rel" in ./*) rel="${rel#./}" ;; esac
  case "/$rel" in
    */completed/*)            kind="ARCHIVE" ;;
    */.agents/rules/*)        kind="RULE" ;;
    */.agents/personas/*)     kind="PERSONA" ;;
    */.agents/commands/*)     kind="COMMAND" ;;
    */docs/agents/*/spec.md)  kind="SPEC" ;;
    */docs/agents/*/plan.md)  kind="PLAN" ;;
    */governance/*)           kind="GOVERNANCE" ;;
    */_templates/*)           kind="TEMPLATE" ;;
    */adr/*|*/ADR-*)          kind="ADR" ;;
    */CHANGELOG.md)           kind="HISTORY" ;;
    */AGENTS.md)              kind="HUB" ;;
  esac

  # Cold-storage flag: history files are listed (so they are findable) but marked so an agent does
  # not pay for them during orientation. CHANGELOG.md is the single heaviest file in this repo.
  cold=""
  case "$kind" in
    HISTORY|ARCHIVE|TEMPLATE) cold="cold" ;;
  esac

  [ -n "$title" ] || title="(no H1)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$kind" "$bytes" "$lines" "$mtime" "$f" "$title" "$applies" "$cold" >> "$TMP"
done

if [ ! -s "$TMP" ]; then
  echo "doc-map: no markdown found under $DIR" >&2
  exit 2
fi

case "$MODE" in
  json)
    awk -F'\t' 'BEGIN { printf "{\"docs\":[\n" }
      {
        gsub(/\\/, "\\\\", $6); gsub(/"/, "\\\"", $6)
        gsub(/\\/, "\\\\", $7); gsub(/"/, "\\\"", $7)
        printf "%s  {\"kind\":\"%s\",\"bytes\":%s,\"lines\":%s,\"mtime\":%s,\"path\":\"%s\",\"title\":\"%s\",\"applies_when\":\"%s\",\"cold\":%s}",
          (NR>1 ? ",\n" : ""), $1, $2, $3, $4, $5, $6, $7, ($8=="cold" ? "true" : "false")
      }
      END { printf "\n]}\n" }' "$TMP"
    ;;

  check)
    if [ "${DOC_MAP_OFF:-0}" = "1" ]; then
      echo "doc-map: DOC_MAP_OFF=1 — check skipped"; exit 0
    fi
    # --- the truncation budget -----------------------------------------------------------------
    # A file a harness reads WHOLE and truncates loses a MIDDLE band of itself. Hermes caps a
    # context file at max(20_000, context_window * 4 * 0.06) chars — head 70% + tail 20% survive.
    # So 20,000 is the FLOOR (an 8K window), not a flat ceiling: a 128K session caps at 30,720 and a
    # 200K one at 48,000. AGENTS.md's headroom is the number that matters, and the budget below uses
    # the floor so it is safe on the smallest window; on a large window the real headroom is bigger.
    # Truncation is reported, not silent (the loader prints what it dropped and leaves a marker) — but
    # a truncated read still loses the rules index that tells an agent where everything else is.
    # Only files a loader reads whole are budgeted. The changelog and command docs are large, but
    # nothing reads them whole at session start; they are read on demand and in parts.
    # AGENTS.md is the file a harness reads whole and caps; its headroom is the number that matters.
    # Add a `bf:cap` pair to this list if another file is ever read whole under a hard cap.
    budget_fail=0
    bf="AGENTS.md"; cap=20000
    if [ -f "$bf" ]; then
      sz=$(wc -c < "$bf" | tr -d ' ')
      if [ "$sz" -ge "$cap" ]; then
        echo "doc-map: $bf is $sz bytes, at or over the $cap-byte floor a small-window loader caps at." >&2
        echo "  A truncated read drops a middle band (the loader reports it, but the loss is still real)." >&2
        echo "  Move detail into .agents/rules/ or docs/agents/ — do not raise the floor." >&2
        budget_fail=1
      fi
    fi
    if [ "$budget_fail" = "1" ]; then
      exit 1
    fi
    # A RULE module with no `Applies when:` is invisible to the map — this is the map's own
    # dependency, stated as a gate rather than assumed. Only RULE kind is required to have it;
    # specs/plans carry their contract in the plan-doc header instead.
    bad=0
    awk -F'\t' '$1=="RULE" && $7=="" { print "  MISSING \"Applies when:\"  " $5; bad++ } END { exit (bad>0) }' "$TMP" > "$TMP.bad" || bad=1
    if [ "$bad" = "1" ]; then
      echo "doc-map: rule modules must declare \"Applies when:\" or they cannot be indexed:" >&2
      cat "$TMP.bad" >&2
      rm -f "$TMP.bad"
      exit 1
    fi
    rm -f "$TMP.bad"
    n=$(awk -F'\t' 'END { print NR }' "$TMP")
    tot=$(awk -F'\t' '{ s += $2 } END { printf "%d", s/4 }' "$TMP")
    echo "doc-map: OK ($n docs indexed, ~$tot tokens as raw text)"
    ;;

  table)
    awk -F'\t' '
      function human(b) { return (b >= 1024 ? sprintf("%.0fK", b/1024) : b "") }
      {
        tot += $2; n++
        if ($8 == "cold") { coldb += $2; coldn++; next }
        warmb += $2; warmn++
        live_n++; live_b[live_n] = $2; live_l[live_n] = $3; live_p[live_n] = $5
        d = $6
        if (length(d) > 52) d = substr(d, 1, 49) "..."
        printf "%-10s %6s %5s  %s\n", $1, human($2), $3 "L", $5
        if ($7 != "") {
          a = $7; if (length(a) > 70) a = substr(a, 1, 67) "..."
          printf "%-10s %6s %5s  \342\206\263 %s\n", "", "", "", a
        }
      }
      END {
        printf "\n%d docs, %d bytes (~%d tokens if you read every one \342\200\224 never do this)\n", n, tot, tot/4
        printf "  cold (archive/history/template): %d docs, ~%d tokens \342\200\224 history, skip unless you need it\n", coldn, coldb/4
        printf "  live docs: %d, ~%d tokens total\n", warmn, warmb/4
        printf "\nThe five that cost the most to open blind:\n"
        # Insertion sort, largest first. The point of a size signal is knowing the worst offenders
        # BEFORE opening anything — so this list is the payload, not decoration.
        for (i = 1; i <= live_n; i++) for (j = i + 1; j <= live_n; j++)
          if (live_b[j] + 0 > live_b[i] + 0) {
            t = live_b[i]; live_b[i] = live_b[j]; live_b[j] = t
            t = live_l[i]; live_l[i] = live_l[j]; live_l[j] = t
            t = live_p[i]; live_p[i] = live_p[j]; live_p[j] = t
          }
        lim = (live_n < 5 ? live_n : 5)
        for (i = 1; i <= lim; i++) printf "  %6s  %5sL  %s\n", human(live_b[i]), live_l[i], live_p[i]
      }' "$TMP"
    ;;
esac
