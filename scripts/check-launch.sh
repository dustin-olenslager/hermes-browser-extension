#!/usr/bin/env sh
# check-launch.sh — the Ship rung: a change claiming it SHIPPED must record a launch and a way back.
#
# THE SEAM THIS CLOSES. `scripts/factory-phases.tsv` names phase 6 (Ship) with a `-` in its gate
# column, and the doctrine calls that "a stated gap, not a licence": nothing stood between "verify
# passed" and "in production". Phases 0-3 are gated; 4 and 5 have no gate by design (they are states of
# work, not artifacts). Ship is different — it is a CLAIM ("this is live"), and a claim nothing checks
# is exactly the kind of unchecked assertion this kit exists to refuse.
#
# WHAT IT CHECKS, and nothing more — PRESENCE ONLY:
#   1. A change that marks a SHIP milestone complete must record, in the same feature folder, that the
#      thing was launched and how to get back out (a rollback line) — a sibling `launch.md`, or a
#      `## Launch` section in the plan. The record is required to NAME both a launch and a rollback;
#      a record that names only one is refused.
#   2. Otherwise the change is not at the ship rung, and this gate has nothing to say.
#
# WHAT IT DELIBERATELY DOES NOT CHECK. Not whether the deploy actually happened, not whether the
# rollback command works, not which mechanism deploys (Vercel, docker-compose, a bare box — the gate
# never guesses the deploy path). Those are review questions, and the mechanism is stack-specific,
# which a POSIX-sh kit deliberately is not. This gate answers exactly one question: did the change that
# says it shipped write down a launch and a rollback line. Nothing here is a quality claim.
#
#   sh scripts/check-launch.sh                # git mode — diff against the merge base / HEAD~1
#   sh scripts/check-launch.sh --since SHA     # explicit diff base (CI: the PR base SHA)
#   sh scripts/check-launch.sh --staged        # staged changes only (pre-commit context)
#
# Config (all optional):
#   LAUNCH_OFF=1          disable entirely (deliberate exception — say so out loud)
#   LAUNCH_PLAN_GLOB=glob override where plans live (default below)
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ "${LAUNCH_OFF:-0}" = "1" ] && { echo "check-launch: disabled (LAUNCH_OFF=1)"; exit 0; }

# Plans and specs are siblings under docs/agents/<area>/<feature>/ — the contract every other rung here
# already uses (check-plan-home.sh, check-coverage.sh, check-wireframe.sh). No new layout is introduced.
LAUNCH_PLAN_GLOB="${LAUNCH_PLAN_GLOB:-docs/agents/*/*/plan.md docs/PLAN.md docs/agents/PLAN.md}"

MODE="git"; SINCE=""
case "${1:-}" in
  --staged) MODE="staged" ;;
  --since)
    MODE="since"; SINCE="${2:-}"
    if [ -z "$SINCE" ]; then
      echo "check-launch: refusing --since with an empty base SHA — set LAUNCH_OFF=1 for a" >&2
      echo "  deliberate skip instead of silently checking nothing." >&2
      exit 2
    fi ;;
  "") MODE="git" ;;
  *) echo "check-launch: unknown argument '$1'" >&2; exit 2 ;;
esac

_diff_base_ok() { git rev-parse -q --verify "${1}^{commit}" >/dev/null 2>&1; }

case "$MODE" in
  staged) FILES="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
          LABEL="staged change" ;;
  since)
    if ! _diff_base_ok "$SINCE"; then
      echo "check-launch: diff base '$SINCE' does not resolve in this checkout (shallow clone or" >&2
      echo "  wrong ref). Pass the PR base SHA explicitly, or set LAUNCH_OFF=1 for a deliberate skip." >&2
      exit 2
    fi
    FILES="$(git diff --name-only --diff-filter=ACMR "$SINCE"...HEAD 2>/dev/null || true)"
    LABEL="change since $SINCE" ;;
  git)
    if [ -n "${GITHUB_BASE_REF:-}" ]; then
      FILES="$(git diff --name-only --diff-filter=ACMR "origin/${GITHUB_BASE_REF}...HEAD" 2>/dev/null || true)"
      LABEL="change vs origin/${GITHUB_BASE_REF}"
    elif git rev-parse -q --verify HEAD~1 >/dev/null 2>&1; then
      FILES="$(git diff --name-only --diff-filter=ACMR HEAD~1...HEAD 2>/dev/null || true)"
      LABEL="change in HEAD"
    else
      echo "check-launch: no parent commit to diff against (first commit or shallow checkout)." >&2
      echo "  Pass --since <sha>, or set LAUNCH_OFF=1 for a deliberate skip." >&2
      exit 2
    fi ;;
esac

# Staged files always count, the way check-spec.sh does it: a pre-commit run sees only the index.
STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"

if [ -z "$(printf '%s%s' "$FILES" "$STAGED_FILES" | tr -d '[:space:]')" ]; then
  echo "check-launch: OK (no changed files in $LABEL)"
  exit 0
fi

# --- which plans did this change touch? -------------------------------------------------------
# CHANGE-SCOPED: only a plan this change ADDED or MODIFIED is judged. A tree-wide demand would fail
# every repo for ships that predate the rule — the tree-vs-change defect check-milestone-evidence.sh
# and check-wireframe.sh both had to fix, which unit fixtures cannot catch because a fixture has one
# plan by construction.
TOUCHED_PLANS=""
for f in $FILES $STAGED_FILES; do
  [ -n "$f" ] || continue
  case "$f" in
    */plan.md|docs/PLAN.md|docs/agents/PLAN.md)
      # `$FILES` and `$STAGED_FILES` are the same list in --staged mode (both are `git diff --cached`),
      # so without this the plan is graded twice and the summary double-counts it.
      case " $TOUCHED_PLANS " in *" $f "*) continue ;; esac
      TOUCHED_PLANS="$TOUCHED_PLANS $f" ;;
  esac
done

if [ -z "$(printf '%s' "$TOUCHED_PLANS" | tr -d ' ')" ]; then
  echo "check-launch: OK (no plan touched by $LABEL — the ship rung does not apply)"
  exit 0
fi

# A plan is "at the ship rung" when it marks a SHIP milestone complete. The marker is a completed
# milestone (`- [x]`) whose text names the ship/shipped/launch/deploy event. Deliberately loose on
# wording (ship|shipped|launch|deploy|released|live) because the honest phrasing varies; what is NOT
# acceptable is claiming a ship and recording nothing behind it.
SHIP_RE='- \[[xX]\] .*([Ss]hip|[Ll]aunch|[Dd]eploy|released|[Ll]ive)'

FAILED=0
REPORT=""
CHECKED=0

# The launch record must name BOTH a launch and a way back. Defined at top level (POSIX sh does not
# allow a function definition inside a loop body — dash refuses to parse it).
# Heading lines are excluded: `launch.md` will always carry a `# Launch` heading, and a heading is a
# title, not a claim — counting it would let a file with an empty body pass for having "named the
# launch". The content, not the title, is the record.
_names_launch()   { grep -v '^[[:space:]]*#' "$1" 2>/dev/null | grep -qiE '(^|[^a-z])(launched?|deployed|deployed to|released to|went live|is live|in production)([^a-z]|$)'; }
_names_rollback() { grep -v '^[[:space:]]*#' "$1" 2>/dev/null | grep -qiE 'rollback|roll back|revert|how to (get back|recover|undo)|promote (a )?previous'; }

for plan in $TOUCHED_PLANS; do
  [ -f "$plan" ] || continue
  dir="$(dirname "$plan")"

  # Scaffolding is not a live plan — same exemption every other rung carries.
  case "$dir" in */_templates*|*/_template*|*/templates/*|*/examples/*|*/_examples*) continue ;; esac

  # Is this plan claiming a ship? Only then does the rung apply.
  if ! grep -Eq -- "$SHIP_RE" "$plan" 2>/dev/null; then
    CHECKED=$((CHECKED + 1))
    continue                      # not at the ship rung: nothing to prove here
  fi

  CHECKED=$((CHECKED + 1))

  # The launch record: a sibling launch.md, or a `## Launch` section in the plan itself.
  LAUNCH_FILE="$dir/launch.md"
  HAVE_FILE=0
  HAVE_SECTION=0
  [ -f "$LAUNCH_FILE" ] && HAVE_FILE=1
  grep -qiE '^#{1,6}[[:space:]]*Launch([[:space:]]|$)|^#{1,6}[[:space:]]*Launch[[:space:]]' "$plan" 2>/dev/null && HAVE_SECTION=1

  if [ "$HAVE_FILE" -eq 0 ] && [ "$HAVE_SECTION" -eq 0 ]; then
    FAILED=1
    REPORT="$REPORT$plan
    marks a ship milestone complete but records no launch — neither $LAUNCH_FILE
    nor a '## Launch' section in the plan. A ship claim with nothing behind it is the
    unchecked assertion this rung exists to refuse.
"
    continue
  fi

  # A record that exists must name BOTH a launch and a rollback line. One without the other is a
  # half-record, and the half that is missing is exactly the one needed at 3am.
  if [ "$HAVE_FILE" -eq 1 ]; then RECORD="$LAUNCH_FILE"; else RECORD="$plan"; fi

  if ! _names_launch "$RECORD"; then
    FAILED=1
    REPORT="$REPORT$RECORD
    is the launch record for a ship but does not say the thing was launched (no
    'launch'/'deploy'/'live' line). A launch record that does not record the launch is
    the wrong document in the right place.
"
  fi
  if ! _names_rollback "$RECORD"; then
    FAILED=1
    REPORT="$REPORT$RECORD
    is the launch record for a ship but names no rollback — no 'rollback'/'revert'/
    'how to get back' line. The way back is the one line you cannot write from memory
    at 3am; that is why it is required BEFORE the ship, not after.
"
  fi
done

if [ "$FAILED" -eq 1 ]; then
  echo "check-launch: a ship claim carries no launch record or no rollback ($LABEL):" >&2
  printf '%s' "$REPORT" | sed 's/^/    /' >&2
  echo "" >&2
  echo "  The rung: verify passed -> SHIP is a claim -> a claim owes a record. Write, in the feature" >&2
  echo "  folder, one of:" >&2
  echo "    <dir>/launch.md          — a short record: what went live, and how to roll it back" >&2
  echo "    a '## Launch' section in <dir>/plan.md  — the same two lines" >&2
  echo "  It must NAME the launch (launch/deploy/live) and the rollback (rollback/revert/get back)." >&2
  echo "" >&2
  echo "  Doctrine: factory-phases.md phase 6; .agents/rules/algorithm.md (name the failure)." >&2
  echo "  Deliberate exception? LAUNCH_OFF=1 — and say so out loud." >&2
  echo "" >&2
  echo "  This gate checks PRESENCE ONLY: that a launch and a rollback line were written down." >&2
  echo "  It cannot tell whether the deploy happened or the rollback works — those are review questions." >&2
  exit 1
fi

if [ "$CHECKED" -eq 0 ]; then
  echo "check-launch: OK (no plan in $LABEL — nothing to require)"
else
  echo "check-launch: OK ($CHECKED plan(s) checked: no ship claim, or a launch record with a rollback line)"
fi
exit 0
