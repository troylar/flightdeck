#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
# Every file runs even after one fails, so a single failure never hides the rest; the list of failed files comes at the end.
failed=()
t() { node "$@" || failed+=("$1"); }
t test/rules.test.js
t test/envelope.test.js
t test/staging.test.js
t test/test-runs.test.js
t test/readiness-stage.test.js
t test/pins.test.js
t test/typed.test.js
t test/conditions.test.js
t test/practice.test.js
t test/practice-app.test.js
t test/run-polish.test.js
t test/reports.test.js
t test/insights.test.js
t test/outline.test.js
t test/timeline.test.js
t test/search.test.js
t test/folder.test.js
t test/failed-reads.test.js
t test/sync.test.js
t test/views.test.js
t test/checker.test.js
t test/app.test.js
t test/app-reports.test.js
t test/staging-app.test.js
t test/test-runs-app.test.js
t test/readiness-stage-app.test.js
t test/propose-app.test.js
t test/live-app.test.js
t test/shots-app.test.js
t test/light-views.test.js
t test/compat.test.js
t test/compat-bridge.test.js
t test/compat-formats.test.js
t test/compat-pins.test.js
t test/compat-typed.test.js
t test/compat-conditions.test.js
t test/compat-staging.test.js
t test/skills-parity.test.js
t test/build.test.js
t test/readers.test.js
t test/cli.test.js
t test/old-bundles.test.js
t test/evidence.test.js
t test/perf.test.js
t test/light.test.js
t test/wrong-record.test.js
node -e "
const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('dist/flightdeck.html','utf8');
for (const id of ['pf-core','pf-storage','pf-app']){const m=new RegExp('<script id=\"'+id+'\">([\\\\s\\\\S]*?)</script>').exec(h);new vm.Script(m[1]);}
if (/<script[^>]+src=|<link[^>]+stylesheet|googleapis|cdnjs|jsdelivr|unpkg/.test(h)) { console.log('FAIL: external resource in the build'); process.exit(1); }
console.log('build: one self-contained file, scripts parse');" || failed+=("build check")
if [ ${#failed[@]} -gt 0 ]; then echo; echo "FAILED FILES (${#failed[@]}):"; printf '  %s\n' "${failed[@]}"; exit 1; fi
