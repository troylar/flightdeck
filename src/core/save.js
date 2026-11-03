/* A checked write from the command line (2.14, slice A2: flightdeck type save): the one verdict before writing (judge), what
   a write's facts settle to (settle), the words for each outcome (words, the only place they're made), and the helpers the
   command leans on: copies of a target in a listing, duplicate and odd keys in a text, and who asked. Pure: no files, no
   clock, no randomness. The command does the file work (bin/flightdeck.js); every decision is made here or in PF.types.
   Like two Flightdeck windows in different browsers, two saves at the same instant can replace one another without either
   being told (docs/apps.md, Writing step types). */
PF.save = (function () {
  'use strict';
  /* The owner's decision (2.14): type save replaces an existing type against the exact bytes read. A build constant, not a flag. */
  var MODE = 'edits', LIMIT = 100;
  var ORDER = ['held', 'edits-off', 'not-allowed', 'copies', 'newer', 'changed', 'same', 'checked'];

  /* ---------- copies ---------- */
  var HOST = /^[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/;
  /* The rules health.copyOf uses, applied to one sibling against one target, with base and extension compared in any case. */
  function isCopy(n, name) {
    var want = String(name).toLowerCase();
    if (n === name) return false;
    if (n.toLowerCase() === want) return true;
    var m = /^(.*) \(\d+\)(\.[^.]+)?$/.exec(n);
    if (m && (m[1] + (m[2] || '')).toLowerCase() === want) return true;
    m = /^(.+)(\.[A-Za-z0-9]+)$/.exec(n);
    if (!m) return false;
    for (var i = m[1].indexOf('-'); i > 0; i = m[1].indexOf('-', i + 1)) {
      var suffix = m[1].slice(i + 1);
      if ((m[1].slice(0, i) + m[2]).toLowerCase() === want && HOST.test(suffix) && /[A-Z]/.test(suffix)) return true;
    }
    return false;
  }
  /* Every name in the listing that is a copy of name, whether or not name itself is there. Each sibling is tested against the
     target alone, so a name that could be a copy of two types counts for both (a person decides). */
  function copiesOf(name, names) {
    if (!Array.isArray(names)) return [];
    return names.filter(function (n) { return typeof n === 'string' && isCopy(n, name); });
  }
  /* The file a name is a copy of, in lowercase, or null: numbered first, then the first dash with a host suffix, then capitals. */
  function copyBase(n) {
    n = String(n);
    var m = /^(.*) \(\d+\)(\.[^.]+)?$/.exec(n);
    if (m) return (m[1] + (m[2] || '')).toLowerCase();
    m = /^(.+)(\.[A-Za-z0-9]+)$/.exec(n);
    if (m) for (var i = m[1].indexOf('-'); i > 0; i = m[1].indexOf('-', i + 1)) {
      var suffix = m[1].slice(i + 1);
      if (HOST.test(suffix) && /[A-Z]/.test(suffix)) return (m[1].slice(0, i) + m[2]).toLowerCase();
    }
    return n !== n.toLowerCase() ? n.toLowerCase() : null;
  }

  /* ---------- the verdict ---------- */
  function judge(o) {
    var seen = o.seen || { state: 'missing' }, asked = o.asked || {}, listing = o.listing;
    if (asked.held) return { outcome: 'held', kind: 'held', why: asked.held };
    if (seen.state === 'unreadable') return { outcome: 'held', kind: 'held', why: seen.why || '' };
    if (listing && !Array.isArray(listing) && listing.unlisted) return { outcome: 'held', kind: 'held', why: listing.why || '' };
    if (o.mode !== 'edits' && o.expect !== 'none') return { outcome: 'refused', kind: 'edits-off', why: '' };
    if (asked.verdict) return { outcome: 'refused', kind: 'not-allowed', why: asked.verdict };
    var copies = copiesOf(o.name, listing);
    if (copies.length) return { outcome: 'refused', kind: 'copies', why: '', copies: copies };
    if (o.existing && o.existing.verdict === 'newer') return { outcome: 'refused', kind: 'newer', why: o.existing.why || '', needs: o.existing.needs || '' };
    var changed = o.expect === 'none' ? seen.state !== 'missing' : seen.state !== 'bytes' || seen.rev !== o.expect;
    if (changed) return { outcome: 'refused', kind: 'changed', why: '' };
    if (seen.state === 'bytes' && o.newRev === seen.rev) return { outcome: 'same', kind: null, why: '' };
    if (o.dryRun) return { outcome: 'checked', kind: null, why: '' };
    return { go: true };
  }

  /* ---------- outcomes ---------- */
  var OUTCOMES = {
    done: { written: true }, same: { written: false }, checked: { written: false }, refused: { written: false }, failed: { written: false },
    held: { written: false }, partial: { written: true }, replaced: { written: true }, unverified: { written: true }, unsure: { written: null }
  };
  var EXIT = { done: 0, same: 0, checked: 0, refused: 1, failed: 1, held: 4, partial: 4, replaced: 4, unverified: 4, unsure: 4 };
  function histWritten(h) { return h.commit === 'yes' ? true : h.commit === 'no' ? false : null; }
  /* The sentences an outcome adds for history and leftovers, beyond its own (design section 3.3). */
  function addsFor(outcome, kind, history, cleanup) {
    var adds = [], leftover = !!(cleanup && cleanup.leftover && cleanup.leftover.length);
    if ((outcome === 'replaced' || outcome === 'unverified') && history) {
      if (history.written === false) adds.push('history-false');
      else if (history.written === null) adds.push('history-null');
    }
    if (leftover && !(outcome === 'partial' && kind === 'cleanup') && outcome !== 'done' && outcome !== 'same' && outcome !== 'checked') adds.push('leftover');
    return adds;
  }
  /* What a write's facts settle to. Facts: { refused, commit: 'no'|'yes'|'unknown', back, history: { commit, why } | null,
     cleanup: { leftover, why } | null, load }. A combination that can't happen throws. */
  function settle(f) {
    var commit = f.commit, back = f.back == null ? null : f.back, cleanup = f.cleanup || null, out;
    if (commit === 'no') {
      if (back !== null || f.history) throw new Error('settle: nothing is read back or recorded without a commit');
      if (!f.refused || !OUTCOMES[f.refused.outcome] || OUTCOMES[f.refused.outcome].written !== false) throw new Error('settle: a write that didn\'t commit needs its refusal');
      out = { outcome: f.refused.outcome, kind: f.refused.kind == null ? null : f.refused.kind, written: false, back: null, history: null };
    } else if (commit === 'unknown') {
      if (f.history) throw new Error('settle: no history line is attempted when the commit is unknown');
      out = { outcome: 'unsure', kind: 'unsure', written: null, back: back, history: null };
    } else if (commit === 'yes') {
      if (back === null || !f.history) throw new Error('settle: a commit is always read back and recorded');
      var history = { written: histWritten(f.history), why: f.history.why == null ? null : String(f.history.why) };
      out = { written: true, back: back, history: history };
      if (back === 'unreadable' || back === 'unstable') { out.outcome = 'unverified'; out.kind = 'unverified'; }
      else if (back === 'other' || back === 'missing') { out.outcome = 'replaced'; out.kind = 'replaced'; }
      else if (back !== 'same') throw new Error('settle: unknown read-back ' + back);
      else if (history.written !== true) { out.outcome = 'partial'; out.kind = 'history'; }
      else if (cleanup && cleanup.leftover && cleanup.leftover.length) { out.outcome = 'partial'; out.kind = 'cleanup'; }
      else { out.outcome = 'done'; out.kind = null; }
    } else throw new Error('settle: unknown commit ' + commit);
    out.exit = EXIT[out.outcome];
    out.cleanup = cleanup;
    out.adds = addsFor(out.outcome, out.kind, out.history, cleanup);
    return out;
  }

  /* ---------- words ---------- */
  function loadSentence(load, dry) {
    if (!load || typeof load.position !== 'number') return '';
    var n = load.position, lim = load.limit || LIMIT;
    if (dry) return n <= lim ? ' If saved with these files present, it would be number ' + n + ' of the step-type files Flightdeck reads; it reads the first ' + lim + ' by name.'
      : ' If saved with these files present, it would be number ' + n + ', and Flightdeck wouldn\'t load it: it reads only the first ' + lim + ' by name.';
    return n <= lim ? ' As of this save it\'s number ' + n + ' of the step-type files Flightdeck reads; it reads the first ' + lim + ' by name.'
      : ' Flightdeck won\'t load it: it reads only the first ' + lim + ' step-type files by name, and this is number ' + n + '. Removing others is a person\'s call.';
  }
  function stop(t) { t = String(t || '').trim(); return !t ? '' : /[.!?]$/.test(t) ? t : t + '.'; }
  function bare(t) { return String(t || '').trim().replace(/[.!?]+$/, ''); }
  var REFUSED = {
    changed: function (w) { return w.path + ' changed since you read it. Read it again and redo your change.'; },
    copies: function (w) { return 'There\'s another copy beside it: ' + (w.copies || []).join(', ') + '. A person decides which to keep. Don\'t pick or delete either.'; },
    newer: function (w) { return w.path + ' was made with a newer Flightdeck. ' + (w.needs ? 'Needs Flightdeck ' + w.needs + '.' : 'It needs a newer Flightdeck.'); },
    invalid: function (w) { return 'This isn\'t a step type Flightdeck can use: ' + w.why; },
    'not-allowed': function (w) { return stop(w.why); },
    'no-links': function () { return 'This folder doesn\'t allow hard links (some cloud-synced folders turn them off), so Flightdeck can\'t create files here safely.'; },
    'edits-off': function (w) { return 'type save only adds new step types; ' + w.path + ' already exists.'; },
    usage: function (w) { return stop(w.why); }
  };
  /* The one sentence for an outcome. w: { kind, path, why, copies, needs, load, history, cleanup, back, dryRun }. */
  function words(outcome, w) {
    w = w || {};
    var kind = w.kind, h = w.history, c = w.cleanup, t;
    if (outcome === 'done') t = 'Saved ' + w.path + '.' + loadSentence(w.load, false);
    else if (outcome === 'same') t = 'Nothing to change: ' + w.path + ' already says exactly this.';
    else if (outcome === 'checked') t = 'Checked. Nothing was written.' + loadSentence(w.load, true);
    else if (outcome === 'refused') { if (!REFUSED[kind]) throw new Error('No words for refused ' + kind); t = 'Nothing was changed. ' + REFUSED[kind](w); }
    else if (outcome === 'failed') t = kind === 'link-check' ? 'Nothing was changed. Flightdeck couldn\'t finish checking that this folder allows hard links: ' + bare(w.why) + '.' : 'Nothing was changed. ' + stop(w.why);
    else if (outcome === 'held') t = 'Nothing was changed. ' + stop(w.why);
    else if (outcome === 'partial' && kind === 'history') t = 'Saved ' + w.path + ', but ' + (h && h.written === null ? 'Flightdeck couldn\'t confirm its history line: ' : 'its history line couldn\'t be written: ') + bare(h && h.why) + '. The save stands; don\'t save it again.';
    else if (outcome === 'partial' && kind === 'cleanup') t = 'Saved ' + w.path + ', but a temporary file was left at ' + ((c && c.leftover) || []).join(', ') + ': ' + bare(c && c.why) + '. It\'s safe to delete. The save stands; don\'t save it again.';
    else if (outcome === 'replaced') t = 'Your save was written, then ' + (w.back === 'missing' ? 'removed' : 'replaced') + ' by another change before Flightdeck could read it back. Read it again and compare.';
    else if (outcome === 'unverified') t = w.back === 'unstable' ? 'Saved, but Flightdeck couldn\'t confirm it: it changed while Flightdeck was reading it back. Read it again before you build on it.'
      : 'Saved, but Flightdeck couldn\'t read it back to check it: ' + bare(w.why) + '. Read it again before you build on it.';
    else if (outcome === 'unsure') t = w.path + ' may or may not have been written by this command: ' + bare(w.why) + '. Read it again. No history line was written.';
    else throw new Error('No words for ' + outcome);
    addsFor(outcome, kind, h, c).forEach(function (a) {
      if (a === 'history-false') t += ' Its history line couldn\'t be written either: ' + bare(h.why) + '.';
      else if (a === 'history-null') t += ' Flightdeck couldn\'t confirm its history line either: ' + bare(h.why) + '.';
      else t += ' A temporary file was left at ' + c.leftover.join(', ') + '; it\'s safe to delete.';
    });
    return t;
  }
  var INVALID_BEFORE = 'History records this save without the previous version (it wasn\'t a valid step type).', NO_CONTENTS = 'History records this save without its contents.';
  /* Warnings from why each definition was left out of the history line (omitted: { before, after }). */
  function historyWarnings(omitted) {
    var o = omitted || {}, out = [], lost = ['cap', 'cleaned', 'fallback'];
    if (o.before === 'invalid') out.push(INVALID_BEFORE);
    if (lost.indexOf(o.before) >= 0 || lost.indexOf(o.after) >= 0) out.push(NO_CONTENTS);
    return out;
  }

  /* ---------- the input text ---------- */
  /* The first key that appears twice in one object of a JSON text (JSON.parse keeps only the last), or null. Strings are
     scanned whole, so keys written inside a value don't count; escapes are decoded, so "label" is "label". */
  function duplicateKeys(text) {
    var s = String(text), stack = [], top = null;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '"') {
        var j = i + 1;
        while (j < s.length && s.charAt(j) !== '"') j += s.charAt(j) === '\\' ? 2 : 1;
        if (top && top.obj && top.key) {
          var k;
          try { k = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
          if (top.keys[k] === 1) return k;
          top.keys[k] = 1; top.key = false;
        }
        i = j;
      } else if (c === '{') { top = { obj: true, keys: Object.create(null), key: true }; stack.push(top); }
      else if (c === '[') { top = { obj: false }; stack.push(top); }
      else if (c === '}' || c === ']') { stack.pop(); top = stack.length ? stack[stack.length - 1] : null; }
      else if (c === ',' && top && top.obj) top.key = true;
    }
    return null;
  }
  var ODD = ['__proto__', 'constructor', 'prototype'];
  /* The first of __proto__, constructor or prototype used as a key at any depth, or null. Iterative, so depth never overflows. */
  function oddKeys(v) {
    var todo = [v];
    while (todo.length) {
      var x = todo.pop();
      if (!x || typeof x !== 'object') continue;
      if (Array.isArray(x)) { for (var i = 0; i < x.length; i++) todo.push(x[i]); continue; }
      var ks = Object.keys(x);
      for (var j = 0; j < ks.length; j++) { if (ODD.indexOf(ks[j]) >= 0) return ks[j]; todo.push(x[ks[j]]); }
    }
    return null;
  }

  /* ---------- who asked ---------- */
  /* '' when id may ask for this, or the reason. people: PF.people.clean(...). rule 'person': in the list (the first row for the
     ID), active. rule 'manage': that, then PF.people.allowed's own words (A4 and A5). */
  function asked(people, id, rule, act, target) {
    var list = Array.isArray(people) ? people : [], p = null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === id) { p = list[i]; break; }
    if (!p) return '--asked-by ' + id + ' isn\'t in people.json.';
    if (p.inactive) return '--asked-by ' + id + ': ' + p.name + ' is marked inactive.';
    if (rule === 'manage') { var why = PF.people.allowed(list, id, act, target); return why ? '--asked-by ' + id + ': ' + why : ''; }
    return '';
  }

  return { MODE: MODE, LIMIT: LIMIT, ORDER: ORDER, judge: judge, copiesOf: copiesOf, copyBase: copyBase, OUTCOMES: OUTCOMES, EXIT: EXIT, settle: settle, words: words,
    historyWarnings: historyWarnings, duplicateKeys: duplicateKeys, oddKeys: oddKeys, asked: asked };
})();
