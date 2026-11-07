/* Loops (3.0, docs/design.md 44): a {for.each} step starts one linked run of a child checklist per item of a living scope.
   Pure: no files. The kinds of item a loop takes, its limit, the scope ledger, scope requests and the gate's roll-up. */
PF.loop = (function () {
  'use strict';
  /* The kinds of item (items:), each with how its stable id and key look. jira.issue first; environments, services and pull
     requests can follow with their own entry (and the type's items: options, PF.types, the same list). */
  var KINDS = {
    'jira.issue': { label: 'Jira issue', plural: 'Jira issues', source: 'jira', id: /^[0-9]{1,18}$/, key: /^[A-Z][A-Z0-9_]{0,29}-[1-9][0-9]{0,8}$/ }
  };
  /* max: (default 200, at most 500): more items than that are refused as a whole, never cut. */
  var MAX_ITEMS = 500, DEFAULT_MAX = 200;
  function maxOf(v) { var t = String(v == null ? '' : v).trim(); if (!/^[1-9]\d{0,2}$/.test(t) || +t > MAX_ITEMS) return null; return +t; }
  function limitOf(step) { var m = step && step.fields && step.fields.max != null ? maxOf(step.fields.max) : null; return m == null ? DEFAULT_MAX : m; }

  return { KINDS: KINDS, MAX_ITEMS: MAX_ITEMS, DEFAULT_MAX: DEFAULT_MAX, maxOf: maxOf, limitOf: limitOf };
})();
