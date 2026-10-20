#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
node test/rules.test.js
node test/insights.test.js
node test/outline.test.js
node test/timeline.test.js
node test/search.test.js
node test/folder.test.js
node test/sync.test.js
node test/views.test.js
node test/checker.test.js
node test/app.test.js
node test/propose-app.test.js
node test/live-app.test.js
node test/shots-app.test.js
node test/build.test.js
node test/cli.test.js
node test/old-bundles.test.js
node test/evidence.test.js
node test/perf.test.js
node -e "
const fs=require('fs'),vm=require('vm');const h=fs.readFileSync('dist/flightdeck.html','utf8');
for (const id of ['pf-core','pf-storage','pf-app']){const m=new RegExp('<script id=\"'+id+'\">([\\\\s\\\\S]*?)</script>').exec(h);new vm.Script(m[1]);}
if (/<script[^>]+src=|<link[^>]+stylesheet|googleapis|cdnjs|jsdelivr|unpkg/.test(h)) { console.log('FAIL: external resource in the build'); process.exit(1); }
console.log('build: one self-contained file, scripts parse');"
