#!/usr/bin/env sh
# shellcheck disable=SC2016  # the fixtures embed markdown backticks (e.g. `src/x.ts`) inside single
#                            # quotes ON PURPOSE — they are literal markdown, not command substitution.
# check-launch.test.sh — the launch gate's canary.
#
# A gate that cannot go red is not evidence. Both directions are asserted: a ship claim WITH a launch
# record (launch + rollback) passes, one WITHOUT is refused. Plus the adversarial cases a
# plausible-but-wrong implementation fails: a record naming only a launch (no rollback), a record naming
# only a rollback (no launch), a NON-ship change that must not be dragged in, the templates exemption,
# the escape hatch, and an empty `--since`. And — the load-bearing case — a MUTATION of the gate proves
# the canary is testing the gate's behaviour, not merely that a script exits 0.
#
# Every fixture is BUILT in a temp dir and stated directly, never sourced from a moving ref — the
# gate-integrity lesson about fixtures that test the ref instead of the behaviour.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
GATE="$HERE/check-launch.sh"
TMP="${TMPDIR:-/tmp}/launch-canary.$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT INT TERM

pass=0
fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '       %s\n' "$2"; }

mkrepo() {
  d="$TMP/$1"
  mkdir -p "$d/scripts"
  git -C "$d" init -q
  git -C "$d" config user.email c@e.invalid
  git -C "$d" config user.name c
  git -C "$d" config commit.gpgsign false
  git -C "$d" symbolic-ref HEAD refs/heads/main
  cp "$GATE" "$d/scripts/check-launch.sh"
  printf 'x\n' > "$d/README.md"
  git -C "$d" add -A
  git -C "$d" -c user.email=c@e.invalid -c user.name=c -c commit.gpgsign=false commit -qm base
  printf '%s' "$d"
}

cmit() {
  git -C "$1" add -A
  git -C "$1" -c user.email=c@e.invalid -c user.name=c -c commit.gpgsign=false commit -qm "${2:-c}"
}

# classify the gate's verdict, never just the exit code
gate_class() {
  d="$1"; base="$2"
  out="$( ( cd "$d" && sh scripts/check-launch.sh --since "$base" ) 2>&1 )" && { printf 'ok'; return 0; }
  case "$out" in
    *"records no launch"*) printf 'fail-norecord' ;;
    *"does not say the thing was launched"*) printf 'fail-nolaunch' ;;
    *"names no rollback"*) printf 'fail-norollback' ;;
    *"does not resolve"*) printf 'fail-unresolvable' ;;
    *) printf 'fail-errored' ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# case 1: a ship claim WITH a launch.md naming launch + rollback → PASS (positive control; without
# this the gate could be always-red and every other case would look like success)
r="$(mkrepo pass-with-record)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n### M1 — the thing\n\n- [x] ship the thing — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf '# Launch\n\nLaunched to production on 2026-10-04 via the normal deploy.\nRollback: `git revert` the merge and redeploy.\n' > "$r/docs/agents/core/thing/launch.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "ship with launch record"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "ok" ]; then ok "a ship claim with a launch + rollback record passes"
else bad "a complete ship claim was not accepted (got '$rc')"; fi

# case 2: THE ADVERSARIAL CASE — a ship claim, no launch record at all → REFUSED
r="$(mkrepo fail-norecord)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n### M1 — the thing\n\n- [x] ship the thing — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "ship, no record"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "fail-norecord" ]; then ok "a ship claim with no launch record is refused"
else bad "a ship claim with no launch record was not refused (got '$rc')"; fi

# case 3: a record that names the launch but NOT the rollback → REFUSED (the half you cannot
# reconstruct at 3am is the one required)
r="$(mkrepo fail-norollback)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] launched the feature — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf '# Launch\n\nThis went live on 2026-10-04.\n' > "$r/docs/agents/core/thing/launch.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "ship, no rollback"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "fail-norollback" ]; then ok "a launch record with no rollback line is refused"
else bad "a launch record missing the rollback was accepted (got '$rc')"; fi

# case 4: a record that names the rollback but NOT the launch → REFUSED (the wrong document in the
# right place is still the wrong document)
r="$(mkrepo fail-nolaunch)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] shipped it — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf '# Launch\n\nRollback: revert the merge and redeploy.\n' > "$r/docs/agents/core/thing/launch.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "record, no launch line"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "fail-nolaunch" ]; then ok "a launch record that never says it launched is refused"
else bad "a record missing the launch line was accepted (got '$rc')"; fi

# case 5: a NON-ship plan (open milestones, no ship claim) → PASS. The rung does not apply.
r="$(mkrepo pass-nonship)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n### M1\n\n- [ ] build the thing — `src/x.ts`\n- [ ] test the thing\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "not at ship rung"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "ok" ]; then ok "a plan not claiming a ship is not dragged into the rung"
else bad "a non-ship plan was wrongly required to carry a launch record (got '$rc')"; fi

# case 6: a '## Launch' SECTION inside the plan, instead of a sibling file → PASS (both homes are legal)
r="$(mkrepo pass-section)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] shipped — `src/x.ts`\n\n## Launch\n\nDeployed to prod on 2026-10-04.\nRollback: promote the previous deployment.\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "ship with plan Launch section"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "ok" ]; then ok "a '## Launch' section in the plan is a valid record"
else bad "an in-plan Launch section was not accepted (got '$rc')"; fi

# case 7: _templates/ scaffolding is not a live plan — the exemption every rung carries
r="$(mkrepo pass-templates)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/_templates" "$r/src"
printf '# Plan template\n\n- [x] ship it\n' > "$r/docs/agents/_templates/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "template plan"
rc="$(gate_class "$r" "$base")"
if [ "$rc" = "ok" ]; then ok "_templates/ scaffolding is exempt"
else bad "the kit's own templates were required to carry a launch record (got '$rc')"; fi

# case 8: the escape hatch actually disarms the gate
r="$(mkrepo pass-off-switch)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] ship the thing — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "no record, hatch used"
if ( cd "$r" && LAUNCH_OFF=1 sh scripts/check-launch.sh --since "$base" ) >/dev/null 2>&1; then
  ok "LAUNCH_OFF=1 disarms the gate"
else bad "LAUNCH_OFF=1 did not disarm the gate"; fi

# case 9: --since with an empty base refuses rather than checking nothing (never fail open)
r="$(mkrepo pass-empty-base)"
if ( cd "$r" && sh scripts/check-launch.sh --since "" ) >/dev/null 2>&1; then
  bad "--since with an empty base was accepted"
else ok "--since with an empty base refuses instead of checking nothing"; fi

# case 10: the gate reports HOW MANY it checked, so "checked 1" and "checked nothing" cannot look alike
r="$(mkrepo pass-count)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] shipped — `src/x.ts`\n\n## Launch\n\nWent live.\nRollback: revert.\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "one plan checked"
out="$( cd "$r" && sh scripts/check-launch.sh --since "$base" )"
if printf '%s' "$out" | grep -q '1 plan(s) checked'; then
  ok "the pass message reports how many plans it checked"
else bad "the pass message does not report a count" "$out"; fi

# case 11: a change touching NO plan is not this gate's case — and it says so
r="$(mkrepo pass-noplan-touched)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/src"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "code only"
out="$( cd "$r" && sh scripts/check-launch.sh --since "$base" )"
if printf '%s' "$out" | grep -q 'no plan touched'; then
  ok "a change touching no plan defers explicitly"
else bad "the gate did not defer explicitly when no plan was touched" "$out"; fi

# case 12: THE MUTATION CASE — prove the canary is testing the gate's BEHAVIOUR, not merely that a
# script exits 0. We mutate the fixture's copy of the gate so its failure path can never fire (force
# FAILED=0 before the verdict), run the SAME adversarial scenario as case 2, and assert the canary's
# own classifier now reports 'ok' — i.e. had the gate regressed this way, the canary WOULD have caught
# it by going red on case 2. If the mutant still classified as a refusal, the canary would be inert.
r="$(mkrepo mutation)"; base="$(git -C "$r" rev-parse HEAD)"
mkdir -p "$r/docs/agents/core/thing" "$r/src"
printf '# Plan\n\n- [x] ship the thing — `src/x.ts`\n' > "$r/docs/agents/core/thing/plan.md"
printf 'x\n' > "$r/src/x.ts"
cmit "$r" "ship, no record"
# mutate the FIXTURE's gate: neuter the failure path (force FAILED=0 before the verdict test)
sed 's/^if \[ "\$FAILED" -eq 1 \]; then$/FAILED=0\nif [ "$FAILED" -eq 1 ]; then/' \
  "$GATE" > "$r/scripts/check-launch.sh"
rc_mut="$(gate_class "$r" "$base")"
if [ "$rc_mut" = "ok" ]; then
  # the mutant wrongly ACCEPTS case 2 — so had the real gate regressed, the canary's case 2 would have
  # been the red that caught it. The canary is sensitive to the gate's behaviour.
  cp "$GATE" "$r/scripts/check-launch.sh"
  rc_real="$(gate_class "$r" "$base")"
  if [ "$rc_real" = "fail-norecord" ]; then
    ok "mutation: a never-fail gate is wrongly-accepted by case 2, so the canary is sensitive"
  else bad "after restoring the gate case 2 is not refused — canary is not sensitive" "$rc_real"; fi
else
  bad "the mutated always-pass gate was still refused — mutation fixture is wrong" "$rc_mut"
fi

# case 13: --staged collects a touched plan ONCE. `$FILES` and `$STAGED_FILES` are the same list in
# --staged mode (both are `git diff --cached`), so the naive loop appended every plan twice — the same
# double-count reproduced in check-milestone-evidence.sh, where one plan with four milestones printed
# "2 plan(s), 8 completed milestone(s)". Here the observable symptom is a duplicated report block: the
# same plan refused twice. A gate that reports the same finding twice trains its reader to skim.
r="$(mkrepo pass-staged-once)"
mkdir -p "$r/docs/agents/core/thing"
# shellcheck disable=SC2016  # markdown backticks inside the fixture text
printf '# Plan\n\n## Milestones\n- [x] ship it — nothing behind it\n' > "$r/docs/agents/core/thing/plan.md"
git -C "$r" add -A
out="$( cd "$r" && sh scripts/check-launch.sh --staged 2>&1 || true )"
n="$(printf '%s' "$out" | grep -c 'marks a ship milestone complete' || true)"
if [ "$n" -eq 1 ]; then
  ok "--staged reports a touched plan once, not twice"
else bad "--staged reports the same plan $n times" "$out"; fi

printf '\ncheck-launch canary: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
exit 0
