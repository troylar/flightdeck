#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
# Every file runs even after one fails, so a single failure never hides the rest; the list of failed files comes at the end.
# Files run in parallel (JOBS at a time, the CPU count by default), the longest split into shards (SHARD=i/n in
# test/harness.js). Files that assert wall-clock budgets run one at a time afterwards, so a busy machine can't fail them.
JOBS="${JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
logs="$(mktemp -d)"; if [ -n "${KEEP_LOGS:-}" ]; then echo "logs: $logs"; else trap 'rm -rf "$logs"' EXIT; fi
job() { # file, and its shard i/n or -
  local f="$1" s="$2" name what rc=0
  if [ "$s" = "-" ]; then name="$(basename "$f" .js)"; what="$f"; else name="$(basename "$f" .js).${s/\//of}"; what="$f (shard $s)"; fi
  SHARD="${s#-}" node "$f" > "$logs/$name.log" 2>&1 || rc=$?
  printf '%s\t%s\t%s\n' "$rc" "$what" "$name" >> "$logs/status"
}
export -f job; export logs
# The older releases are cached once, before any job reads them (tools/old-bundles.js); its own errors show in the tests.
node tools/old-bundles.js > "$logs/old-bundles.log" 2>&1 || true
cat <<'JOBS_LIST' | xargs -P "$JOBS" -L 1 bash -c 'job "$0" "$1"'
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
test/scale-app.test.js 0/3
test/scale-app.test.js 1/3
test/scale-app.test.js 2/3
test/bounds-app.test.js 0/6
test/bounds-app.test.js 1/6
test/bounds-app.test.js 2/6
test/bounds-app.test.js 3/6
test/bounds-app.test.js 4/6
test/bounds-app.test.js 5/6
test/find.test.js -
test/find-runs.test.js -
test/find-process.test.js 0/2
test/find-process.test.js 1/2
test/find-notes.test.js 0/2
test/find-notes.test.js 1/2
test/find-twins.test.js 0/2
test/find-twins.test.js 1/2
test/find-tiers.test.js -
test/find-selectors.test.js -
test/find-r15.test.js -
test/find-r16.test.js -
test/find-r18.test.js -
test/find-r19.test.js -
test/find-r20.test.js -
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
test/app.test.js 0/8
test/app.test.js 1/8
test/app.test.js 2/8
test/app.test.js 3/8
test/app.test.js 4/8
test/app.test.js 5/8
test/app.test.js 6/8
test/app.test.js 7/8
test/app-reports.test.js -
test/app-teamvalues.test.js -
test/staging-app.test.js -
test/test-runs-app.test.js -
test/readiness-stage-app.test.js -
test/propose-app.test.js -
test/live-app.test.js -
test/shots-app.test.js -
test/light-views.test.js -
test/compat.test.js 0/4
test/compat.test.js 1/4
test/compat.test.js 2/4
test/compat.test.js 3/4
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
JOBS_LIST
# A job that failed while others ran is run again on its own: some app tests wait on real timers, which a busy machine
# can starve. One that passes alone is listed as such, never hidden; one that fails alone too is a failure.
mv "$logs/status" "$logs/status.par"; touch "$logs/status"; alone=()
while IFS=$'\t' read -r rc what name; do
  if [ "$rc" = 0 ]; then printf '%s\t%s\t%s\n' "$rc" "$what" "$name" >> "$logs/status"; continue; fi
  f="${what%% *}"; s="-"; case "$what" in *"(shard "*) s="${what##*shard }"; s="${s%)}";; esac
  cp "$logs/$name.log" "$logs/$name.parallel.log"; job "$f" "$s"
  if tail -n 1 "$logs/status" | grep -q '^0'; then alone+=("$what"); fi
done < "$logs/status.par"
for f in test/practice.test.js test/practice-app.test.js test/timeline.test.js test/views.test.js test/perf.test.js; do job "$f" -; done
failed=()
while IFS=$'\t' read -r rc what name; do
  if [ "$rc" != 0 ]; then failed+=("$what"); echo "=== $what"; cat "$logs/$name.log"; fi
done < <(sort -t$'\t' -k2 "$logs/status")
echo "$(wc -l < "$logs/status" | tr -d ' ') test jobs run, ${#failed[@]} failed"
if [ ${#alone[@]} -gt 0 ]; then echo "Passed only when run alone (timing under load; worth a look if it repeats):"; printf '  %s\n' "${alone[@]}"; fi
node -e "
const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('dist/flightdeck.html','utf8');
for (const id of ['pf-core','pf-storage','pf-app']){const m=new RegExp('<script id=\"'+id+'\">([\\\\s\\\\S]*?)</script>').exec(h);new vm.Script(m[1]);}
if (/<script[^>]+src=|<link[^>]+stylesheet|googleapis|cdnjs|jsdelivr|unpkg/.test(h)) { console.log('FAIL: external resource in the build'); process.exit(1); }
console.log('build: one self-contained file, scripts parse');" || failed+=("build check")
if [ ${#failed[@]} -gt 0 ]; then echo; echo "FAILED FILES (${#failed[@]}):"; printf '  %s\n' "${failed[@]}"; exit 1; fi
