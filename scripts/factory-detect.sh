#!/usr/bin/env sh
# factory-detect.sh — which phase is this repo in? Reports phase, evidence, and next step.
#
# M2 of the factory build. This DETECTS and REPORTS; it changes nothing and decides nothing else.
# Reading the phase and acting on the phase are separate on purpose: the detector must be provable
# against fixtures before anything is allowed to act on its answer.
#
# THE RULE, in one sentence: scan the repo's evidence from the END backward, and report the FURTHEST
# phase whose completion is actually evidenced — today's build is the newest thing that happened, so
# evidence of a later phase outranks evidence of an earlier one.
#
# Every observation is a file test or a grep. No network, no model call, no guessing. If the answer
# disagrees with what you know, the report names the exact observation that was wrong — which is the
# whole point of reporting evidence rather than a verdict.
#
#   sh scripts/factory-detect.sh              # report on the current repo
#   sh scripts/factory-detect.sh --path DIR   # report on another checkout
#   sh scripts/factory-detect.sh --json       # machine-readable, for a later rung to consume
#
# Exit codes: 0 = a phase was detected (INCLUDING phase 0), 2 = could not inspect (not a repo,
# unreadable). A phase is never reported as an error: "this repo is at ADOPT" is a successful
# answer, not a failure.
#
# WHAT THIS CANNOT SEE — read before trusting a result:
#   It reports the phase the FILES evidence, not the phase the WORK is in. A plan whose milestones
#   are all ticked but which shipped nothing reads as done. A branch with commits but no CI signal
#   discoverable locally reads as BUILD when it is really at VERIFY. It cannot see intent, quality,
#   or whether the artifacts are any good — only that they exist and what they say about themselves.
#   And it cannot see a repo whose kit is stale as anything but PHASE 0: below that line, the phase
#   history is not trustworthy, which is the honest reading rather than a defect.
set -eu

# Resolve the script's own repo, so `--path` can point anywhere while this script runs from a kit.
SELF_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Default to WHERE YOU ARE, not to the kit's own repo. Defaulting to the script's root meant that
# running the detector in an unrelated directory silently inspected the KIT and reported a confident
# phase about a repo the caller never mentioned — "could not look" dressed up as a finding. The
# script's own repo is the fallback only when the cwd is not a repo at all, and the report says
# which tree it settled on.
TARGET="${PWD}"
KIT_REPO=0
case "${1:-}" in --path|--json) ;; *) : ;; esac
JSON=0
PHASES="$SELF_ROOT/scripts/factory-phases.tsv"

while [ $# -gt 0 ]; do
  case "$1" in
    --path) TARGET="${2:-}"; shift 2 ;;
    --json) JSON=1; shift ;;
    --kit-repo) KIT_REPO=1; shift ;;
    *) echo "factory-detect: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

[ "${FACTORY_PHASE_OFF:-0}" = "1" ] && { echo "factory-detect: disabled (FACTORY_PHASE_OFF=1)"; exit 0; }

command -v git >/dev/null 2>&1 || { echo "factory-detect: git not found" >&2; exit 2; }

# Resolve the repo root, and REFUSE when there is not one. The naive form —
#   R="$(cd "$TARGET" && git rev-parse --show-toplevel)" || { error; exit 2; }
# — does not fire: the `cd` succeeds, git prints nothing and exits non-zero, but the command
# substitution as a whole reports success, so R is empty and the script carries on inspecting
# whatever directory it happens to be in. That is the "could not look" verdict reported as a
# confident finding about an unrelated tree. Check the VALUE, not the exit status.
# `A && B || C` is not if-then-else (SC2015): C runs when A succeeds and B fails, which here would
# silently paper over a git failure. Resolve in two explicit steps instead.
R=""
if cd "$TARGET" 2>/dev/null; then
  R="$(git rev-parse --show-toplevel 2>/dev/null)" || R=""
fi
if [ -z "$R" ] && [ "$KIT_REPO" -eq 1 ]; then
  # The kit's own repo is an EXPLICIT opt-in, never a silent fallback: reporting a confident phase
  # for a repo the caller never named is "could not look" dressed as a finding.
  if cd "$SELF_ROOT" 2>/dev/null; then
    R="$(git rev-parse --show-toplevel 2>/dev/null)" || R=""
  fi
fi
if [ -z "$R" ]; then
  echo "factory-detect: not a git working tree: $TARGET" >&2
  echo "  (this is a refusal, not a phase — nothing was inspected)" >&2
  exit 2
fi
cd "$R" || exit 2

EV=""          # evidence lines, newline-separated
ev() { EV="$EV$1
"; }

# --- O1: is it a repo? -----------------------------------------------------------------------
ev "O1 git working tree: yes ($R)"

# --- O2: kit compliance, via the doctor's EXIT CODE (the authority, not the stamp) -----------
O2=0
if [ -f scripts/panoply.sh ]; then
  sh scripts/panoply.sh check >/dev/null 2>&1 && O2=0 || O2=$?
else
  O2=10   # no doctor at all == not adopted
fi
ev "O2 kit doctor exit: $O2"

# --- O3: stamp -------------------------------------------------------------------------------
STAMP="none"
if [ -f .panoply-version ]; then
  STAMP="$(grep -m1 '^kit_version:' .panoply-version 2>/dev/null | sed 's/^kit_version:[[:space:]]*//' || echo present)"
  [ -n "$STAMP" ] || STAMP="present"
fi
ev "O3 kit stamp: $STAMP"

# --- O4: governance spine --------------------------------------------------------------------
SPINE=0
[ -f docs/agents/roadmap.md ] && SPINE=$((SPINE + 1))
[ -f docs/agents/in-progress.md ] && SPINE=$((SPINE + 1))
ev "O4 governance spine files present: $SPINE/2"

# --- O5/O6/O7: feature folders and their artifacts -------------------------------------------
FEATURES=""
for d in docs/agents/*/*/; do
  [ -d "$d" ] || continue
  # The trailing slash matters: the directory itself is ".../completed/", which "*/completed/*" does
  # NOT match — only its children. Observed on this repo: "completed/" appeared in the feature list and
  # was then eligible to be named the active feature.
  # Normalise the trailing slash FIRST, then one pattern per excluded dir. Listing both
  # "*/completed/*" and "*/completed/" is redundant — the first already covers the second's
  # contents, and shellcheck is right to flag it.
  _dn="${d%/}"
  case "$_dn" in */_templates|*/_templates/*|*/completed|*/completed/*) continue ;; esac
  [ -f "$d/spec.md" ] || [ -f "$d/plan.md" ] || continue
  FEATURES="$FEATURES $d"
done
NFEAT=0
for f in $FEATURES; do NFEAT=$((NFEAT + 1)); done
ev "O5 feature folders carrying a spec or plan: $NFEAT"

# O6 needs the SAME metasyntax rule check-spec.sh uses, or the detector counts its own documentation as
# an unresolved question. A marker is unresolved only when it carries REAL content: the template
# sentence "written only AFTER every [NEEDS CLARIFICATION: …] below is resolved" is prose about the
# convention, not a question — and a detector that counts it reports four healthy specs as blocked.
# (Found exactly that way: the first run of this detector reported 4 blocked specs, all four being the
# template line. Same failure shape as the gate that matched its own refusal text.)
_is_metasyntax_body() {
  _b="$1"
  _b="$(printf '%s' "$_b" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [ -z "$_b" ] && return 0
  case "$_b" in
    "…"|"..."|"<"*">"|"["*"]"|"TODO"|"TBD"|"todo"|"tbd"|"?"*) return 0 ;;
  esac
  return 1
}

NEEDS_CLAR=0
for f in $FEATURES; do
  [ -f "$f/spec.md" ] || continue
  _unresolved=0
  while IFS= read -r _line; do
    [ -n "$_line" ] || continue
    _body="$(printf '%s' "$_line" | sed -n 's/.*\[NEEDS[[:space:]]*CLARIFICATION[:]\([^]]*\)\].*/\1/p')"
    _is_metasyntax_body "$_body" || { _unresolved=1; break; }
  done <<EOF
$(grep -Ei '\[NEEDS[[:space:]]+CLARIFICATION' "$f/spec.md" 2>/dev/null || true)
EOF
  [ "$_unresolved" -eq 1 ] && NEEDS_CLAR=$((NEEDS_CLAR + 1))
done
ev "O6 specs with an unresolved marker: $NEEDS_CLAR"

# The feature the queue names, else the newest by mtime. This is the "walk from the END backward"
# step: pick the one being worked on, not the alphabetically first.
ACTIVE=""

# FIRST: the branch. A branch name is the most current statement of what is being worked on — it is
# written at the moment work starts and changes when the work changes, whereas the queue is a row
# somebody has to remember to update. Observed on this repo: the queue's first slug match picked a stale
# plan-only folder while the branch plainly named the work in progress.
BRANCH_NOW="$(git branch --show-current 2>/dev/null || echo '')"
if [ -n "$BRANCH_NOW" ]; then
  # Reduce a branch to comparable tokens: feat/m6-consolidation -> m6 consolidation.
  _b="$(printf '%s' "$BRANCH_NOW" | tr '[:upper:]' '[:lower:]' | sed 's|^.*/||; s/[-_]/ /g')"
  for f in $FEATURES; do
    slug="$(basename "$f" | tr '[:upper:]' '[:lower:]' | sed 's/[-_]/ /g')"
    # Every meaningful token of the slug must appear in the branch name — but a one-token slug is too
    # weak a match (a folder called "factory" would match half the fleet), so require >=2 tokens.
    _toks=0; _hit=0
    for t in $slug; do
      _toks=$((_toks + 1))
      case " $_b " in *" $t "*) _hit=$((_hit + 1)) ;; esac
    done
    if [ "$_toks" -ge 2 ] && [ "$_hit" -eq "$_toks" ]; then ACTIVE="$f"; break; fi
  done
fi

if [ -z "$ACTIVE" ]; then
  for f in $FEATURES; do
    slug="$(basename "$f")"
    [ -f docs/agents/in-progress.md ] || continue
    grep -q "$slug" docs/agents/in-progress.md 2>/dev/null && { ACTIVE="$f"; break; }
  done
fi
if [ -z "$ACTIVE" ] && [ -n "$(printf '%s' "$FEATURES" | tr -d ' ')" ]; then
  # Newest by mtime, resolved in the shell rather than by `ls`: no assumptions about filenames, and
  # the tie-break is deterministic (first wins) instead of depending on sort order. It does shell out
  # to `stat`, which is not a POSIX utility — hence the two dialects attempted below.
  NEWEST=""; NEWEST_T=""
  for f in $FEATURES; do
    [ -f "$f/plan.md" ] || [ -f "$f/spec.md" ] || continue
    # `stat -c` is GNU-only (`-f` on BSD/macOS). Trying both keeps the "POSIX sh, runs anywhere"
    # claim true; a bare `-c` silently returned 0 on BSD, which made this fallback rank nothing and
    # pick arbitrarily while looking like it had compared timestamps.
    _m="$(stat -c '%Y' "$f" 2>/dev/null || stat -f '%m' "$f" 2>/dev/null || echo 0)"
    if [ -z "$NEWEST_T" ] || [ "$_m" -gt "$NEWEST_T" ]; then NEWEST_T="$_m"; NEWEST="$f"; fi
  done
  ACTIVE="$NEWEST"
fi
if [ -n "$ACTIVE" ]; then ev "O5b active feature: $ACTIVE"; else ev "O5b active feature: none"; fi

# --- O8: live work ---------------------------------------------------------------------------
DIRTY="$(git status --short 2>/dev/null | head -20 | wc -l | tr -d ' ')"
[ -n "$DIRTY" ] || DIRTY=0
BRANCH="$(git branch --show-current 2>/dev/null || echo '(detached)')"
ev "O8 working tree: $DIRTY changed file(s), branch: $BRANCH"

# --- O9: verify evidence on this branch (local, best-effort) ---------------------------------
# Any CI result file the repo keeps locally. Absent -> unknown, reported as unknown, never as red.
VERIFY="unknown"
[ -f .verify-status ] && VERIFY="$(head -1 .verify-status 2>/dev/null || echo unknown)"
ev "O9 verify evidence: $VERIFY"

# --- O10/O11: queue and roadmap --------------------------------------------------------------
QUEUE_ROWS=0
[ -f docs/agents/in-progress.md ] && QUEUE_ROWS="$(grep -cE '^\|' docs/agents/in-progress.md 2>/dev/null || echo 0)"
ev "O10 queue rows: $QUEUE_ROWS"
ROADMAP_ROWS=0
[ -f docs/agents/roadmap.md ] && ROADMAP_ROWS="$(grep -cE '^\|' docs/agents/roadmap.md 2>/dev/null || echo 0)"
ev "O11 roadmap rows: $ROADMAP_ROWS"

# --- O12: monorepo ---------------------------------------------------------------------------
MONO=0
for f in package.json go.mod pom.xml Cargo.toml; do
  n=$(find . -maxdepth 4 -name "$f" -not -path './node_modules/*' 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 1 ] && MONO=1
done
[ -f pnpm-workspace.yaml ] && MONO=1
ev "O12 monorepo signal: $([ "$MONO" -eq 1 ] && echo yes || echo no)"

# ================================ the decision rule ==========================================
# Precedence order, exactly as specified. Each branch appends the evidence that fired it, so the
# report can always be argued with by pointing at the observation.
PHASE=""
WHY=""
NEXT=""

if [ "$O2" != "0" ]; then
  PHASE="0"
  WHY="kit doctor exit $O2 — the repo is not on the current kit, so its phase history is not trustworthy yet"
  NEXT="run 'sh scripts/panoply.sh doctor' and 'apply' to bring it onto the current kit"
elif [ "$NFEAT" -eq 0 ]; then
  PHASE="0"
  WHY="doctor clean but no feature folder carries a spec or plan — the spine is un-seeded"
  NEXT="seed the roadmap and open the first feature folder, then write its spec"
elif [ "$NEEDS_CLAR" -gt 0 ]; then
  PHASE="1"
  WHY="$NEEDS_CLAR spec(s) carry an unresolved [NEEDS CLARIFICATION] marker"
  NEXT="resolve the marker in $ACTIVE/spec.md, then re-run check-spec"
else
  # The feature-first walk: judge the ACTIVE feature, then the repo-level signals.
  # Initialise EVERY counter before use: an unset var in a `-gt` test is an arithmetic error under
  # `set -u`, and the branch that skips the plan leaves OPEN_MILESTONES untouched.
  HAS_SPEC=0; HAS_PLAN=0; HAS_WIRE=0; HAS_INTERVIEWS=0; OPEN_MILESTONES=0
  if [ -n "$ACTIVE" ]; then
    [ -f "$ACTIVE/spec.md" ] && HAS_SPEC=1
    [ -f "$ACTIVE/plan.md" ] && HAS_PLAN=1
    [ -f "$ACTIVE/wireframe/index.html" ] && HAS_WIRE=1
    [ -f "$ACTIVE/interviews.md" ] && HAS_INTERVIEWS=1
    if [ -f "$ACTIVE/plan.md" ]; then
      OPEN_MILESTONES="$(grep -c '^- \[ \]' "$ACTIVE/plan.md" 2>/dev/null || true)"
      [ -n "$OPEN_MILESTONES" ] || OPEN_MILESTONES=0
      case "$OPEN_MILESTONES" in *[!0-9]*) OPEN_MILESTONES=0 ;; esac
    fi
  fi

  # Is this spec about a user-facing surface? The factory's skip test is the question
  # "does it alter what a user can do on a screen they look at?" — which is a judgement, so the
  # detector uses the marker the spec is REQUIRED to carry rather than guessing from vocabulary.
  # A bare keyword match is a false positive waiting to happen: a spec reading "no screen, internal
  # only" contains 'screen' and would demand a wireframe it explicitly does not need.
  # An explicit `n/a` line in the spec is the authoritative statement; keywords are the fallback.
  # Order: an explicit opt-out always wins; otherwise a spec that describes a user surface needs a
  # wireframe; otherwise it is treated as internal. The opt-out is checked FIRST so a spec that says
  # "no user-facing surface" is never dragged into the wireframe rung by its own disclaimer.
  USER_FACING=0
  if [ -f "$ACTIVE/spec.md" ]; then
    # Allow markdown decoration between the label and the value: a spec line typically reads
    # "- **Wireframe:** `n/a — reason`", so a backtick (and bold markers) may sit between the colon
    # and "n/a". The original pattern required whitespace only, so a markdown-wrapped n/a did NOT
    # match the opt-out and fell through to the keyword test — where the reason text itself
    # ("no user-facing surface") then made the spec look user-facing. Both halves of the rule failing
    # at once, in the same direction.
    if grep -qiE '(user-facing|wireframe)[^:]*:[^[:alnum:]]*n/a' "$ACTIVE/spec.md" 2>/dev/null; then
      USER_FACING=0
    elif grep -qiE 'user (sees|can|clicks|opens|taps)|user stories|what a user can do|screen|page|form|dashboard' "$ACTIVE/spec.md" 2>/dev/null; then
      USER_FACING=1
    fi
  fi

  if [ -n "$ACTIVE" ] && [ "$HAS_SPEC" -eq 0 ]; then
    PHASE="1"
    # BACKFILL vs SPEC. "No spec.md" is two different situations, and the device that separates them is
    # whether there is any other artifact to draft FROM:
    #   - a plan (or code) already exists -> BACKFILL: draft a spec reflecting what was actually built,
    #     and mark it backfilled. Do NOT block a working feature on a retroactive spec — that is ceremony
    #     the scope test forbids — and do NOT proceed with no spec at all, which is the failure the spec
    #     rung exists to prevent. Draft-and-mark is the honest middle path.
    #   - nothing exists -> plain SPEC: write it first, as the rung intends.
    # The distinction is reported, not applied: this milestone detects, it does not act.
    if [ -n "$ACTIVE" ] && [ -f "$ACTIVE/plan.md" ]; then
      WHY="active feature $ACTIVE has a plan but no spec — BACKFILL (draft a spec from what exists, mark it backfilled; do not block)"
      NEXT="draft $ACTIVE/spec.md from the plan and implementation, and mark it 'backfilled' in the header"
    else
      WHY="active feature $ACTIVE has no spec.md"
      NEXT="write $ACTIVE/spec.md"
    fi
  elif [ -n "$ACTIVE" ] && [ "$USER_FACING" -eq 1 ] && [ "$HAS_WIRE" -eq 0 ]; then
    PHASE="2"
    WHY="active feature has a spec with a user-facing surface and no wireframe"
    NEXT="build $ACTIVE/wireframe/index.html from the spec's user stories"
  elif [ -n "$ACTIVE" ] && [ "$HAS_WIRE" -eq 1 ] && [ "$HAS_INTERVIEWS" -eq 0 ]; then
    PHASE="2"
    WHY="wireframe exists but interviews.md is missing — no interview finding is recorded"
    NEXT="run the simulated interviews against the wireframe and record findings in $ACTIVE/interviews.md"
  elif [ -n "$ACTIVE" ] && [ "$HAS_PLAN" -eq 0 ]; then
    PHASE="3"
    WHY="spec present, no plan.md beside it"
    NEXT="write $ACTIVE/plan.md with a coverage table and milestones"
  elif [ "$OPEN_MILESTONES" -gt 0 ]; then
    PHASE="4"
    WHY="$OPEN_MILESTONES open milestone(s) in $ACTIVE/plan.md"
    NEXT="work the first open milestone, one branch, one PR"
  elif [ "$DIRTY" -gt 0 ] || { [ "$BRANCH" != "main" ] && [ "$BRANCH" != "master" ] && [ "$BRANCH" != "(detached)" ]; }; then
    PHASE="5"
    WHY="no open milestone but uncommitted work or a non-main branch ($BRANCH)"
    NEXT="get a green verify on this branch, then open the PR"
  else
    PHASE="6"
    WHY="milestones closed, tree clean, on the trunk ($BRANCH) — the work is awaiting ship bookkeeping"
    NEXT="confirm the merge, move the folder to completed/, close the queue row"
  fi
fi

# --- report ----------------------------------------------------------------------------------
# `awk` prints nothing and exits 0 when no row matches, so `|| echo unknown` can never fire —
# the name would come back EMPTY and the report would print "phase 6 —   (ship)". Check the value,
# not the exit code.
NAME="$(awk -F'\t' -v id="$PHASE" '$1==id {print $3; exit}' "$PHASES" 2>/dev/null)"
[ -n "$NAME" ] || NAME="unknown (phase $PHASE not in $PHASES)"
SLUG="$(awk -F'\t' -v id="$PHASE" '$1==id {print $2; exit}' "$PHASES" 2>/dev/null)"
[ -n "$SLUG" ] || SLUG="unknown"

if [ "$JSON" -eq 1 ]; then
  printf '{\n  "phase": %s,\n  "slug": "%s",\n  "name": "%s",\n  "why": "%s",\n  "next": "%s",\n  "evidence": [\n' \
    "$PHASE" "$SLUG" "$NAME" "$(printf '%s' "$WHY" | sed 's/"/\\"/g')" "$(printf '%s' "$NEXT" | sed 's/"/\\"/g')"
  printf '%s' "$EV" | grep -v '^$' | awk '{printf "    \"%s\"%s\n", $0, (NR==0?"":",")}' | sed '$ s/,$//'
  printf '  ]\n}\n'
  exit 0
fi

echo "phase $PHASE — $NAME  ($SLUG)"
echo "  why : $WHY"
echo "  next: $NEXT"
echo "  evidence:"
printf '%s' "$EV" | grep -v '^$' | sed 's/^/    /'
exit 0
