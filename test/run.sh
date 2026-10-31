#!/usr/bin/env bash
# The test suite. With no settings this is the full run, the only one that counts as the final gate.
#
#   bash test/run.sh                 the full run: every job in parallel, then the speed budgets alone
#   TIER=fast bash test/run.sh       everything but the slowest jobs (FAST_LEAVES_OUT) and the budgets, about 2 minutes
#   TIER=rest bash test/run.sh       the jobs TIER=fast leaves out; fast + rest + perf is exactly the full run
#   TIER=perf bash test/run.sh       the speed budgets only, alone, after waiting for a quiet moment
#   ONLY=app,find-walk bash test/run.sh   just these jobs, printing only their results. A name is a file (app, app.test.js,
#                                    test/app.test.js: every shard, and its budgets if it has any), one shard (app.2of12)
#                                    or a file's budgets alone (perf.budgets). A name no job has is an error.
#   RULE=<text> bash test/run.sh     only the rules whose names hold the text, in whichever jobs run. It's the harness's
#                                    ONLY=<text>, which still works when you run one file: ONLY=gate node test/rules.test.js
#
# More settings: TIMES=1 prints every job's time, slowest first. LIST=1 prints the jobs chosen and runs nothing. JOBS=<n> sets
# how many run at once (the CPU count by default). KEEP_LOGS=1 keeps the logs and prints where. PERF_WAIT=<seconds> (60),
# PERF_BUSY=<percent of all CPUs> (25) and PERF_TRIES=<n> (3) set how the budgets wait, what counts as busy, and how many
# times a budget missed on a busy machine is measured again (test/machine-load.js).
#
# Every job runs even after one fails, so a single failure never hides the rest; the failed ones are listed at the end. The
# longest files are split into shards (SHARD=i/n in test/harness.js). Rules that assert a wall-clock budget (budget() in
# test/harness.js) never run in the parallel jobs: they run alone at the end, and a miss says how busy the machine was.
set -euo pipefail
cd "$(dirname "$0")/.."
TIER="${TIER:-full}"; only="${ONLY:-}"; unset ONLY
if [ -n "${RULE:-}" ]; then export ONLY="$RULE"; fi
case "$TIER" in full|fast|rest|perf) ;; *) echo "TIER=$TIER isn't a tier: use fast, rest, perf or full" >&2; exit 2;; esac
if [ -n "$only" ] && [ "$TIER" != full ]; then echo "ONLY and TIER don't combine: ONLY names the jobs itself" >&2; exit 2; fi
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"

# Longest first, so the jobs that decide how long the run takes start while CPUs are free.
ALL_JOBS="$(cat <<'JOBS_LIST'
test/bounds-app.test.js 0/8
test/bounds-app.test.js 1/8
test/bounds-app.test.js 2/8
test/bounds-app.test.js 3/8
test/bounds-app.test.js 4/8
test/bounds-app.test.js 5/8
test/bounds-app.test.js 6/8
test/bounds-app.test.js 7/8
test/find-runs.test.js 0/6
test/find-runs.test.js 1/6
test/find-runs.test.js 2/6
test/find-runs.test.js 3/6
test/find-runs.test.js 4/6
test/find-runs.test.js 5/6
test/find-process.test.js 0/6
test/find-process.test.js 1/6
test/find-process.test.js 2/6
test/find-process.test.js 3/6
test/find-process.test.js 4/6
test/find-process.test.js 5/6
test/find-notes.test.js 0/5
test/find-notes.test.js 1/5
test/find-notes.test.js 2/5
test/find-notes.test.js 3/5
test/find-notes.test.js 4/5
test/compat.test.js 0/6
test/compat.test.js 1/6
test/compat.test.js 2/6
test/compat.test.js 3/6
test/compat.test.js 4/6
test/compat.test.js 5/6
test/scale-app.test.js 0/3
test/scale-app.test.js 1/3
test/scale-app.test.js 2/3
test/perf.test.js -
test/app.test.js 0/12
test/app.test.js 1/12
test/app.test.js 2/12
test/app.test.js 3/12
test/app.test.js 4/12
test/app.test.js 5/12
test/app.test.js 6/12
test/app.test.js 7/12
test/app.test.js 8/12
test/app.test.js 9/12
test/app.test.js 10/12
test/app.test.js 11/12
test/rules.test.js -
test/envelope.test.js -
test/staging.test.js -
test/test-runs.test.js -
test/readiness-stage.test.js -
test/pins.test.js -
test/typed.test.js -
test/conditions.test.js -
test/run-polish.test.js -
test/scale.test.js -
test/find.test.js -
test/find-twins.test.js 0/2
test/find-twins.test.js 1/2
test/find-tiers.test.js -
test/find-selectors.test.js -
test/find-r15.test.js -
test/find-r16.test.js -
test/find-r18.test.js -
test/find-r19.test.js -
test/find-r20.test.js -
test/find-r21.test.js -
test/find-r22.test.js -
test/find-walk.test.js -
test/find-roles-diff.test.js -
test/ui-states.test.js -
test/reports.test.js -
test/insights.test.js -
test/outline.test.js -
test/refs.test.js -
test/links.test.js -
test/teamvalues.test.js -
test/search.test.js -
test/folder.test.js -
test/failed-reads.test.js -
test/sync.test.js -
test/guide.test.js -
test/guide-editor.test.js 0/2
test/guide-editor.test.js 1/2
test/docs.test.js -
test/checker.test.js -
test/app-reports.test.js -
test/app-teamvalues.test.js -
test/staging-app.test.js -
test/test-runs-app.test.js -
test/readiness-stage-app.test.js -
test/propose-app.test.js -
test/live-app.test.js -
test/shots-app.test.js -
test/light-views.test.js -
test/compat-bridge.test.js -
test/compat-formats.test.js -
test/compat-pins.test.js -
test/compat-typed.test.js -
test/compat-conditions.test.js -
test/compat-staging.test.js -
test/compat-pass.test.js -
test/compat-teamvalues.test.js -
test/skills-parity.test.js -
test/build.test.js -
test/readers.test.js -
test/cli.test.js -
test/old-bundles.test.js -
test/clarity-compat.test.js -
test/evidence.test.js -
test/light.test.js -
test/wrong-record.test.js -
test/practice.test.js -
test/practice-app.test.js -
test/timeline.test.js -
test/views.test.js -
JOBS_LIST
)"
# Files with budget() rules; test/build.test.js checks this against the files.
BUDGET_FILES="test/perf.test.js test/practice.test.js test/practice-app.test.js test/timeline.test.js test/views.test.js test/find-runs.test.js"
# What TIER=fast leaves out, the slowest files by TIMES=1. test/build.test.js checks each is a file with a job.
FAST_LEAVES_OUT="bounds-app find-runs find-process find-notes compat perf scale-app"

short() { local n="${1##*/}"; n="${n%.js}"; echo "${n%.test}"; } # test/app.test.js, app.test.js, app.test, app -> app
names=(); if [ -n "$only" ]; then IFS=, read -r -a names <<< "$only"; fi
norm() { local w; w="$(short "$1")"; echo "${w/.test./.}"; } # app.test.2of8 -> app.2of12
named() { # a job's short name, and its shard as i/n or -: whether ONLY names it
  local want w; for want in "${names[@]}"; do
    w="$(norm "$want")"
    if [ "$w" = "$1" ] || { [ "$2" != - ] && [ "$w" = "$1.${2/\//of}" ]; }; then return 0; fi
  done; return 1
}
known() { # each name in ONLY is a job or a file's budgets
  local want w ok f s; for want in "${names[@]}"; do
    w="$(norm "$want")"; ok=
    while read -r f s; do
      if [ "$w" = "$(short "$f")" ] || { [ "$s" != - ] && [ "$w" = "$(short "$f").${s/\//of}" ]; }; then ok=1; break; fi
    done <<< "$ALL_JOBS"
    for f in $BUDGET_FILES; do if [ "$w" = "$(short "$f").budgets" ]; then ok=1; fi; done
    if [ -z "$ok" ]; then echo "ONLY=$want: no job has that name. Names are files (app, find-walk), shards (app.2of12) or budgets (perf.budgets); RULE=<text> picks rules by name." >&2; return 1; fi
  done
}
if [ -n "$only" ]; then known || exit 2; fi
plain=""; budgets=""
while read -r f s; do
  n="$(short "$f")"
  if [ -n "$only" ]; then named "$n" "$s" || continue
  else case " $FAST_LEAVES_OUT " in
    *" $n "*) case "$TIER" in full|rest) ;; *) continue;; esac;;
    *) case "$TIER" in full|fast) ;; *) continue;; esac;;
  esac; fi
  plain="$plain$f $s"$'\n'
done <<< "$ALL_JOBS"
for f in $BUDGET_FILES; do
  n="$(short "$f")"
  if [ -n "$only" ]; then
    if named "$n" - || named "$n.budgets" -; then budgets="$budgets $f"; fi
  elif [ "$TIER" = full ] || [ "$TIER" = perf ]; then budgets="$budgets $f"; fi
done
if [ -n "${LIST:-}" ]; then printf '%s' "$plain"; for f in $budgets; do echo "$f budgets"; done; exit 0; fi

now_ms() { if [ -n "${EPOCHREALTIME:-}" ]; then local t="${EPOCHREALTIME/,/.}"; echo "${t%.*}$(printf '%.3s' "${t#*.}")"; else perl -MTime::HiRes=time -e 'printf "%d\n", time * 1000' 2>/dev/null || echo "$(date +%s)000"; fi; }
started="$(now_ms)"
if [ -n "$only" ]; then python3 build.py > /dev/null; else python3 build.py; fi
logs="$(mktemp -d)"
# Tests make temp folders and leave them behind; give the run one of its own, removed at the end (KEEP_LOGS keeps it).
tmp="$(mktemp -d)"; export TMPDIR="$tmp"
if [ -n "${KEEP_LOGS:-}" ]; then echo "logs: $logs, temp files: $tmp"; else trap 'rm -rf "$logs" "$tmp"' EXIT; fi
touch "$logs/status" "$logs/times"
job() { # file, and its shard i/n, - for the whole file, or budgets for its budget rules alone
  local f="$1" s="$2" name what rc=0 t0 mode=skip sh=
  case "$s" in
    -) name="$(basename "$f" .js)"; what="$f";;
    budgets) name="$(basename "$f" .js).budgets"; what="$f (budgets)"; mode=only;;
    *) name="$(basename "$f" .js).${s/\//of}"; what="$f (shard $s)";;
  esac
  t0="$(now_ms)"
  case "$s" in */*) sh="$s";; esac
  BUDGETS="$mode" SHARD="$sh" node "$f" > "$logs/$name.log" 2>&1 < /dev/null || rc=$?
  printf '%s\t%s\t%s\n' "$rc" "$what" "$name" >> "$logs/status"
  printf '%s\t%s\n' "$(( $(now_ms) - t0 ))" "$name" >> "$logs/times"
}
export -f job now_ms; export logs
# The older releases are cached once, before any job reads them (tools/old-bundles.js); its own errors show in the tests.
node tools/old-bundles.js > "$logs/old-bundles.log" 2>&1 || true
if [ -n "$plain" ]; then printf '%s' "$plain" | xargs -P "$JOBS" -L 1 bash -c 'job "$0" "$1"'; fi
# A job that failed while others ran is run again on its own: some app tests wait on real timers, which a busy machine
# can starve. One that passes alone is listed as such, never hidden; one that fails alone too is a failure.
mv "$logs/status" "$logs/status.par"; touch "$logs/status"; alone=()
while IFS=$'\t' read -r rc what name; do
  if [ "$rc" = 0 ]; then printf '%s\t%s\t%s\n' "$rc" "$what" "$name" >> "$logs/status"; continue; fi
  f="${what%% *}"; s="-"; case "$what" in *"(shard "*) s="${what##*shard }"; s="${s%)}";; esac
  cp "$logs/$name.log" "$logs/$name.parallel.log"; job "$f" "$s"
  if tail -n 1 "$logs/status" | grep -q '^0'; then
    # Above 128 the process itself died on a signal: no rule failed. Node's garbage collector has crashed this way under load.
    if [ "$rc" -gt 128 ]; then alone+=("$what: node crashed in the parallel run (signal $((rc - 128))), no rule failed"); else alone+=("$what"); fi
  fi
done < "$logs/status.par"
# The speed budgets, alone and last. They wait for a quiet moment, and a miss on a busy machine is measured again; if it
# still misses, it stays a failure and says the machine was busy. A miss on a quiet machine is a real slowdown.
loaded=(); retried=(); slow=()
if [ -n "$budgets" ]; then
  if [ -n "$only" ]; then wait_s=0; else wait_s="${PERF_WAIT:-60}"; fi
  quiet="$(node test/machine-load.js --wait "$wait_s" || true)"
  echo "speed budgets: machine $quiet"
  for f in $budgets; do
    tries="${PERF_TRIES:-3}"; try=1
    while :; do
      job "$f" budgets
      last="$(tail -n 1 "$logs/status")"
      if [ "${last%%$'\t'*}" = 0 ]; then [ "$try" = 1 ] || retried+=("$f: within budget on try $try"); break; fi
      state="$(node test/machine-load.js || true)"
      case "$state" in quiet*) slow+=("$f: $state"); break;; esac
      if [ "$try" -ge "$tries" ]; then loaded+=("$f: $state"); break; fi
      # This try's result is replaced by the next, whose log the end of this script reads.
      cp "$logs/$(basename "$f" .js).budgets.log" "$logs/$(basename "$f" .js).budgets.try$try.log"
      sed -i.bak '$d' "$logs/status" && rm -f "$logs/status.bak"
      try=$((try + 1))
      node test/machine-load.js --wait "$wait_s" > /dev/null || true
    done
  done
fi
failed=()
while IFS=$'\t' read -r rc what name; do
  if [ "$rc" != 0 ]; then failed+=("$what"); echo "=== $what"; cat "$logs/$name.log"; elif [ -n "$only" ]; then printf '%-34s %s\n' "$name" "$(tail -n 1 "$logs/$name.log")"; fi
done < <(sort -t$'\t' -k2 "$logs/status")
secs="$(( ($(now_ms) - started) / 1000 ))"
echo "$(wc -l < "$logs/status" | tr -d ' ') test jobs run, ${#failed[@]} failed, ${secs}s ($(( secs / 60 ))m $(( secs % 60 ))s)"
if [ ${#alone[@]} -gt 0 ]; then echo "Passed only when run alone (timing under load; worth a look if it repeats):"; printf '  %s\n' "${alone[@]}"; fi
if [ ${#retried[@]} -gt 0 ]; then echo "Speed budgets missed on a busy machine, then met when measured again:"; printf '  %s\n' "${retried[@]}"; fi
if [ ${#loaded[@]} -gt 0 ]; then echo "SPEED BUDGETS MISSED WHILE THE MACHINE WAS BUSY: this may be the load, not the code. Run TIER=perf on a quiet machine to tell."; printf '  %s\n' "${loaded[@]}"; fi
if [ ${#slow[@]} -gt 0 ]; then echo "SPEED BUDGETS MISSED ON A QUIET MACHINE: treat this as a real slowdown."; printf '  %s\n' "${slow[@]}"; fi
if [ -n "${TIMES:-}" ]; then echo "Job times, slowest first (ms; parallel jobs compete for the CPUs):"; sort -t$'\t' -k1,1nr "$logs/times" | awk -F'\t' '{printf "  %8d  %s\n", $1, $2}'; fi
if [ -z "$only" ]; then node -e "
const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('dist/flightdeck.html','utf8');
for (const id of ['pf-core','pf-storage','pf-app']){const m=new RegExp('<script id=\"'+id+'\">([\\\\s\\\\S]*?)</script>').exec(h);new vm.Script(m[1]);}
if (/<script[^>]+src=|<link[^>]+stylesheet|googleapis|cdnjs|jsdelivr|unpkg/.test(h)) { console.log('FAIL: external resource in the build'); process.exit(1); }
console.log('build: one self-contained file, scripts parse');" || failed+=("build check"); fi
if [ ${#failed[@]} -gt 0 ]; then echo; echo "FAILED FILES (${#failed[@]}):"; printf '  %s\n' "${failed[@]}"; exit 1; fi
