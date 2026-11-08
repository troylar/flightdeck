#!/usr/bin/env python3
"""Check a Flightdeck team folder the way the Flightdeck app does, without changing anything.

    python3 <skills folder>/_flightdeck/check_folder.py [team-folder]   (default: the current folder; python or py on Windows)

Prints JSON:
  folder:          the team folder it read.
  publications:    every version folder per process, with status "complete", "syncing", "damaged" or "unusable" and why,
                   which complete version is current, and any version-number clashes. "unusable" means the app can't
                   run it: written by a newer Flightdeck, or edited by hand with syntax or step types it doesn't know.
  plans:           each planned run with status "pending", "decided" (accepted/declined) or "ambiguous", and why.
  conflicts:       runs that have competing copies next to run.json.
  refused:         files in proposals/ the app refuses (a newer format, or not in its format), each with why.
  unreadablePlans: files in proposals/ that aren't complete JSON; "unnamed" when the name doesn't say which plan.
  receipts:        runs with many leftover save receipts (only when there are any).
  teamFiles:       problems in step-types/ and jira/workflows.json.
  skills:          every skill name in skills/ and skill-registrations/, as the app matches it: status "current",
                   "unmatched" or "absent", source "registration" or "legacy", and why.

It never reads staged/ (versions only test runs use) and never changes a file.

    python3 <skills folder>/_flightdeck/check_folder.py [team-folder] --draft <file>   (3.0)

checks one draft offline, for an assistant without the flightdeck command, and prints JSON: blockers (the Publish dialog's,
in its words, for the checks that ran), tips (its design tips that need no other checklist), ran and notRun (which checks
did and didn't run), complete (always false) and a note. A clean result is not "ready to publish": flightdeck draft check,
or the draft's page in Flightdeck, has the whole verdict.

It uses the same fingerprints as the app (FNV-1a over the text's UTF-16 code units, and over the raw bytes for
screenshots), so "complete" here means the app will accept the version too.
"""
import hashlib
import json
import math
import os
import re
import stat
import sys
import time


REQ_ID = re.compile(r"^req-([a-z0-9][a-z0-9-]{0,29})-[0-9a-f]{24}\Z")
REQ_BY = re.compile(r"^([a-z0-9][a-z0-9-]{0,29}) [A-Za-z0-9_.+-]{1,40} \(a tool\)\Z")


def request_tool(plan):
    """The tool a request says wrote it (its id and by agree), or None: the app's PF.requests.claim."""
    m = REQ_ID.match(plan.get("id")) if isinstance(plan.get("id"), str) else None
    b = REQ_BY.match(plan.get("by")) if m and isinstance(plan.get("by"), str) else None
    return b.group(1) if b and b.group(1) == m.group(1) else None


def same_plan(a, b):
    """Two copies of one plan say the same thing: PF.requests.same in the app."""
    x = {k: v for k, v in a.items() if k != "created"}
    y = {k: v for k, v in b.items() if k != "created"}
    ta, tb = request_tool(a), request_tool(b)
    if ta and ta == tb:
        x.pop("by", None)
        y.pop("by", None)
    return json.dumps(x, sort_keys=True) == json.dumps(y, sort_keys=True)


def fnv(units):
    h = 0x811C9DC5
    for u in units:
        h ^= u
        h = (h * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h


def text_hash(text):
    data = text.encode("utf-16-le", "surrogatepass")
    return fnv(int.from_bytes(data[i:i + 2], "little") for i in range(0, len(data), 2))


def _no_constant(name):
    """JSON.parse refuses NaN, Infinity and -Infinity; so does this."""
    raise ValueError("not JSON: " + name)


def _f(v):
    """A number as a double, the way JavaScript holds it: too big is infinite, never an error."""
    try:
        return float(v)
    except OverflowError:
        return float("inf") if v > 0 else float("-inf")


def _jsint(digits):
    """A string of digits as JavaScript's +digits reads it: a double (huge is infinite), never Python's unbounded int."""
    f = float(digits)
    return int(f) if math.isfinite(f) and f.is_integer() and abs(f) < 2 ** 53 else f


def js_number(x):
    """A number written the way JavaScript's JSON.stringify writes it (ECMAScript Number::toString)."""
    from decimal import Decimal
    if x != x or x in (float("inf"), float("-inf")):
        return "null"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    d = Decimal(repr(abs(x))).normalize()
    _, digits, exp = d.as_tuple()
    ds = "".join(str(n) for n in digits)
    k, n = len(ds), exp + len(ds)
    if k <= n <= 21:
        out = ds + "0" * (n - k)
    elif 0 < n <= 21:
        out = ds[:n] + "." + ds[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + ds
    else:
        e = n - 1
        out = ds[0] + ("." + ds[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return sign + out


def js_string(s):
    """A string written the way JSON.stringify writes it, including a lone surrogate as an escape like \\ud800."""
    out = json.dumps(s, ensure_ascii=False)
    return "".join("\\u%04x" % ord(c) if 0xD800 <= ord(c) <= 0xDFFF else c for c in out)


def js_keys(obj):
    """Object keys in JavaScript's order: array-index keys ascending first, then the rest as written."""
    idx = sorted((k for k in obj if re.fullmatch(r"0|[1-9][0-9]*", k) and int(k) < 4294967295), key=int)
    return idx + [k for k in obj if k not in idx]


def js_json(v):
    """JSON exactly as the app's JSON.stringify writes it, for matching plan fingerprints."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return js_number(_f(v))
    if isinstance(v, str):
        return js_string(v)
    if isinstance(v, list):
        return "[" + ",".join(js_json(x) for x in v) + "]"
    return "{" + ",".join(js_string(k) + ":" + js_json(v[k]) for k in js_keys(v)) + "}"


# What the app knows about step types, for the same "can this copy run it" check as Flightdeck's PF.publish.unrunnable.
# Only what that check reads: field kinds and choices, and the names of the evidence each type records.
# test/checker.test.js fails if these differ from src/core/types.js.
PUBLICATION_FORMAT = "preflight-publication/1"
TYPES_VERSION = 2
NEWER = "This version uses checklist features this copy of Flightdeck doesn't understand. Update Flightdeck to run it."
PINS = {"run.process": {"version": {"kind": "pin"}, "pass": {"kind": "pass"}, "accepts": {"kind": "accepts"}},
        "for.each": {"version": {"kind": "pin"}, "pass": {"kind": "pass"}, "accepts": {"kind": "accepts"}}, "run.skill": {"skillVersion": {"kind": "pin"}}}
COMMON = {"link": {"kind": "url"}, "expect": {"kind": "duration"}, "deadline": {"kind": "deadline"}, "evidence": {"kind": "choice", "options": ["link", "note", "number", "yes-no", "date"]},
          "require": {"kind": "require"}, "at": {"kind": "time"}, "due": {"kind": "time"}, "after": {"kind": "duration"}, "sets": {"kind": "sets"}}
BUILTIN = {
    "confirm": {"fields": {"where": {"kind": "text"}, "looks": {"kind": "text"}}, "record": []},
    "communicate": {"fields": {"channel": {"kind": "text"}, "audience": {"kind": "text"}, "message": {"kind": "message"}}, "record": [{"name": "sent"}]},
    "meeting": {"fields": {"attendees": {"kind": "text"}, "agenda": {"kind": "url"}, "join": {"kind": "url"}, "outcome": {"kind": "text"}}, "record": [{"name": "outcome"}]},
    "decide": {"fields": {"options": {"kind": "list"}, "decider": {"kind": "text"}, "criteria": {"kind": "text"}}, "record": [{"name": "decision"}, {"name": "why"}]},
    "review": {"fields": {"document": {"kind": "url"}, "focus": {"kind": "text"}}, "record": [{"name": "verdict"}, {"name": "comments"}]},
    "wait": {"fields": {"for": {"kind": "text"}, "contact": {"kind": "text"}}, "record": [{"name": "arrived"}]},
    "ui.action": {"fields": {"system": {"kind": "text"}, "page": {"kind": "url"}}, "record": [{"name": "reference"}]},
    "jenkins.job": {"fields": {"job": {"kind": "text"}, "page": {"kind": "url"}, "parameters": {"kind": "code"}, "stage": {"kind": "text"}}, "record": [{"name": "build"}, {"name": "buildLink"}]},
    "bitbucket.pr": {"fields": {"action": {"kind": "choice", "options": ["open", "review", "merge"]}, "repo": {"kind": "text"}, "from": {"kind": "text"}, "to": {"kind": "text"}},
                     "record": [{"name": "pr"}, {"name": "mergeCommit"}]},
    "jira.issue": {"fields": {"action": {"kind": "choice", "options": ["create", "update", "transition", "assign", "link"]}, "issue": {"kind": "text"}, "project": {"kind": "text"},
                              "issueType": {"kind": "text"}, "status": {"kind": "text"}, "assignee": {"kind": "text"}, "linkTo": {"kind": "text"}, "set": {"kind": "text"}},
                   "record": [{"name": "key"}]},
    "run.process": {"fields": {"process": {"kind": "text"}, "carry": {"kind": "text"}}, "record": []},
    "run.command": {"fields": {"command": {"kind": "code"}, "where": {"kind": "text"}, "expected": {"kind": "text"}}, "record": [{"name": "result"}]},
    "run.script": {"fields": {"script": {"kind": "code"}, "args": {"kind": "code"}, "where": {"kind": "text"}, "expected": {"kind": "text"}}, "record": [{"name": "result"}]},
    "run.skill": {"fields": {"skill": {"kind": "text"}, "inputs": {"kind": "text"}, "expected": {"kind": "text"}}, "record": [{"name": "output"}]},
    "ci.gate": {"fields": {"pipeline": {"kind": "text"}, "page": {"kind": "url"}}, "record": [{"name": "run"}, {"name": "runLink"}]},
    "jira.sprint": {"fields": {"action": {"kind": "choice", "options": ["start", "close", "move-incomplete", "set-goal"]}, "board": {"kind": "text"}, "sprint": {"kind": "text"}, "goal": {"kind": "text"}},
                    "record": [{"name": "sprintLink"}, {"name": "name"}, {"name": "dates"}, {"name": "carriedOver"}, {"name": "moved"}]},
    "deploy": {"fields": {"environment": {"kind": "text"}, "artifact": {"kind": "text"}, "version": {"kind": "text"}, "tool": {"kind": "url"}, "rollback": {"kind": "text"}},
               "record": [{"name": "deployed"}, {"name": "deployLink"}, {"name": "finished"}]},
    "verify.health": {"fields": {"dashboard": {"kind": "url"}, "metric": {"kind": "text"}, "threshold": {"kind": "text"}, "watch": {"kind": "text"}},
                      "record": [{"name": "result"}, {"name": "observed"}, {"name": "snapshot"}]},
    "github.pr": {"fields": {"action": {"kind": "choice", "options": ["open", "review", "approve", "merge"]}, "repo": {"kind": "text"}, "pull": {"kind": "url"}, "from": {"kind": "text"}, "to": {"kind": "text"}},
                  "record": [{"name": "pr"}, {"name": "checks"}, {"name": "mergeCommit"}]},
    "measure": {"fields": {"metric": {"kind": "text"}, "unit": {"kind": "text"}, "where": {"kind": "text"}}, "record": [{"name": "value"}, {"name": "unit"}]},
    # 2.16: the Jira search step, frozen as type version 4.
    "jira.search": {"fields": {"query": {"kind": "jql"}, "filter": {"kind": "jira-filter"}, "results": {"kind": "results"}, "site": {"kind": "team-ref"}, "what": {"kind": "text"}},
                    "record": [{"name": "searchId"}, {"name": "count"}, {"name": "keys"}, {"name": "resultsLink"}, {"name": "ranAt"}]},
    # 3.0: a loop, frozen as type version 5 (PF.types; items: is PF.loop.KINDS).
    "for.each": {"fields": {"process": {"kind": "text"}, "from": {"kind": "text"}, "items": {"kind": "choice", "options": ["jira.issue", "item"]}, "max": {"kind": "text"},
                            "source": {"kind": "text"}, "noun": {"kind": "text"}}, "record": []},
}
LOOP_MAX_ITEMS = 500
# 3.0 (slice 3b): the kinds of item a loop takes (PF.loop.KINDS), a feed's stable id (source:) and a noun's two parts.
LOOP_KINDS = ["jira.issue", "item"]
LOOP_FEED = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,59}\Z")
LOOP_NOUN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9 '-]{0,38}[A-Za-z0-9'])?\Z")


def loop_noun_ok(v):
    """Whether noun: is one / many in full (PF.loop.nounOf): empty is the kind's default."""
    if js_trim(str(v)) == "":
        return True
    parts = [js_trim(x) for x in str(v).split("/")]
    return len(parts) == 2 and all(LOOP_NOUN.match(x) for x in parts)

# The checklist parser's rules (src/core/map.js), as far as the check needs them: its errors, and each step's text, type and fields.
# JavaScript's \w is ASCII, so W spells it out.
W = r"[A-Za-z0-9_]"
ID_RE = re.compile(r"\s*\{#([a-z0-9][a-z0-9-]*)\}\s*$", re.I)


def js_str(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return js_number(_f(v))
    if isinstance(v, list):
        return ",".join(js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def take_id(s):
    m = ID_RE.search(s)
    return (m.group(1).lower(), s[:m.start()]) if m else ("", s)


EXCERPT_MAX = 40


def excerpt(text, n=EXCERPT_MAX):
    """A step's text cut at a word, never mid-word, with … when cut; counted in code points, as PF.util.excerpt."""
    t = text or ""
    if len(t) <= n:
        return t
    head = t[:n]
    sp = head.rfind(" ")
    # A word longer than half the room is cut where the room ends.
    if t[n] != " " and sp >= n // 2:
        head = head[:sp]
    return re.sub(r"[ .,;:!?-]+$", "", head) + "\u2026"


def step_label(s, word="Step"):
    """A step named in a message: its text excerpt and its ID, which tells apart two steps that start alike (PF.util.stepLabel)."""
    return '%s "%s"%s' % (word, excerpt(s.get("text")), " {#%s}" % s["id"] if s.get("id") else "")


def step_name(s):
    """A step as the checks' words name it, which other apps read: its first 40 characters, as every copy since 1.x (PF.util.stepName)."""
    return 'Step "%s"' % (s.get("text") or "")[:40]


def tokens(s, ch):
    out = []
    rest = re.sub(r"\s*\%s(%s+)" % (ch, r"[A-Za-z0-9_-]"), lambda m: out.append(m.group(1)) or "", s)
    return out, rest.strip()


def shot_sources(parsed):
    """Every screenshot a checklist shows, once each: steps', phases' and gates' (PF.map.shotSources in the app)."""
    out = []
    for x in parsed["steps"] + parsed["phases"] + [p["gate"] for p in parsed["phases"] if p.get("gate")]:
        for src in x.get("shots") or []:
            if src not in out:
                out.append(src)
    return out


# JavaScript's String.prototype.trim: its white space and line terminators, never Python's wider str.strip().
JS_WS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
# Unicode White_Space, which typed values trim (PF.values.trim).
VALUE_WS = "\t\n\v\f\r \u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"


def js_trim(s):
    return s.strip(JS_WS)


def js_len(s):
    """A string's length as JavaScript counts it (UTF-16 code units)."""
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


# Typed run details (2.0, PF.map's details()): name:kind after the name, choice options between parentheses.
DETAIL_KINDS = {"number", "yes-no", "date", "link"}


def detail_types(entries):
    """(names, typed, errors) for context: entries, as the app's PF.map.parse reads them."""
    names, typed, errors = [], {}, []
    for e in entries:
        at = e.find(":")
        if at < 0:
            names.append(e)
            continue
        name, spec = js_trim(e[:at]), js_trim(e[at + 1:])
        what = "Run detail \"%s\"" % name[:60]
        names.append(name)
        if spec == "text":
            errors.append("%s is text already; write just %s." % (what, name[:60]))
            continue
        if spec in DETAIL_KINDS:
            typed[name] = {"kind": spec}
            continue
        pm = re.fullmatch(r"pattern\(([\s\S]*)\)", spec)
        if pm:
            pc = compile_pattern(pm.group(1))
            if not pc["ok"]:
                errors.append("%s: its pattern can't be read: %s" % (what, pc["why"]))
                continue
            typed[name] = {"kind": "pattern", "pattern": pm.group(1)}
            continue
        c = re.fullmatch(r"choice\((.*)\)", spec)
        if not c or "\n" in spec:
            errors.append("%s: \"%s\" isn't a kind. Use number, yes-no, date, link, choice(a|b) or pattern(...)." % (what, spec[:60]))
            continue
        opts, bad = c.group(1).split("|"), ""
        for o in opts:
            if bad:
                break
            if not o:
                bad = what + ": an option is empty."
            elif re.search(r"[,|():]", o):
                bad = "%s: the option \"%s\" has \"%s\", which an option can't hold." % (what, o[:40], re.search(r"[,|():]", o).group(0))
            elif o != js_trim(o):
                bad = "%s: the option \"%s\" starts or ends with a space; remove it." % (what, o[:40])
            elif js_len(o) > 40:
                bad = "%s: the option \"%s…\" is longer than 40 characters; an option can be at most 40 characters." % (what, o[:40])
        if not bad and len(opts) < 2:
            bad = what + ": a choice needs at least two options, like choice(dev|prod)."
        if not bad and len(opts) > 20:
            bad = what + ": a choice can have at most 20 options."
        if not bad:
            seen = {}
            for o in opts:
                k = o.lower()
                if k in seen:
                    bad = "%s: %s and %s differ only in capitals; keep one." % (what, seen[k], o)
                    break
                seen[k] = o
        if bad:
            errors.append(bad)
            continue
        typed[name] = {"kind": "choice", "options": opts}
    # A name listed twice when either entry has a kind is an error; bare duplicates stay allowed.
    count, kinded = {}, set()
    for e in entries:
        n = e if ":" not in e else js_trim(e[:e.find(":")])
        count[n] = count.get(n, 0) + 1
        if ":" in e:
            kinded.add(n)
    for n in count:
        if count[n] > 1 and n in kinded:
            errors.append("Run detail \"%s\" is listed twice; list it once." % n[:60])
            typed.pop(n, None)
    return names, typed, errors


# Conditions (2.1, PF.conditions in the app): "only when ^detail is value" on a phase or a step. Same tests, same words.
COND_MAX = 4
COND_WORDS = {"set": "is set", "notset": "is not set", "is": "is", "isnot": "is not", "oneof": "is one of", "atleast": "is at least", "atmost": "is at most"}
COND_ALLOWED = {"is": {"number", "yes-no", "date", "choice"}, "isnot": {"number", "yes-no", "date", "choice"}, "oneof": {"choice"}, "atleast": {"number", "date"}, "atmost": {"number", "date"}}
KIND_LABELS = {"text": "text", "number": "number", "yes-no": "yes/no", "choice": "choice", "date": "date", "url": "link"}


def _to_number(t):
    m = re.fullmatch(r"([+-]?)([0-9]+)(?:\.([0-9]+))?", t)
    if not m:
        return None
    whole, frac = re.sub(r"^0+(?=[0-9])", "", m.group(2)), (m.group(3) or "").rstrip("0")
    out = whole + ("." + frac if frac else "")
    return "0" if out == "0" else ("-" if m.group(1) == "-" else "") + out


def _is_date(s):
    m = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", s)
    if not m:
        return False
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return y >= 1 and 1 <= mo <= 12 and 1 <= d <= days[mo - 1]


def _value(kind, options, raw):
    """PF.values.parse for a run detail: its canonical text, "" when empty, or None when it isn't one."""
    t = raw.strip(VALUE_WS)
    if not t:
        return ""
    if kind == "number":
        n = None if any(c in VALUE_WS for c in t) else _to_number(t)
        return n if n is not None and js_len(n) <= 30 else None
    if kind == "yes-no":
        return t.lower() if t.lower() in ("yes", "no") else None
    if kind == "date":
        return t if _is_date(t) else None
    if kind == "choice":
        hits = [o for o in options if o.lower() == t.lower()]
        return hits[0] if len(hits) == 1 else None
    return t


# JavaScript's \s and . (Python's differ: \s takes \x1c-\x1f and \x85 but not \ufeff; . takes \r, \u2028 and \u2029).
JS_S = "[" + re.escape(JS_WS) + "]"
JS_DOT = "[^\n\r\u2028\u2029]"


def _after(word, rest):
    """The text after a leading word and JavaScript white space (as /^word\\s+(.+)$/i reads it), or None."""
    m = re.match("^" + word + JS_S + "+(" + JS_DOT + "+)$", rest, re.I | re.A)
    return m.group(1) if m else None


def parse_condition(text, context, typed):
    """(test, why) for one "only when" line's text, as PF.conditions.parse reads it."""
    t = js_trim(text)
    m = re.match("^\\^((?:%s|-){1,60})%s+is%s+(%s+)$" % (W, JS_S, JS_S, JS_DOT), t)
    if not m:
        return None, "Write a condition as \"only when ^detail is value\" (or is set, is not set, is one of a|b, is at least, is at most)."
    name, rest = m.group(1), js_trim(m.group(2))
    if name not in context:
        return None, "Only when uses ^%s, which isn't listed in context." % name
    low, raw = rest.lower(), []
    if low == "set":
        op = "set"
    elif low == "not set":
        op = "notset"
    elif _after("one of", rest) is not None:
        op, raw = "oneof", [js_trim(x) for x in _after("one of", rest).split("|")]
    elif _after("at least", rest) is not None:
        op, raw = "atleast", [js_trim(_after("at least", rest))]
    elif _after("at most", rest) is not None:
        op, raw = "atmost", [js_trim(_after("at most", rest))]
    elif _after("not", rest) is not None:
        op, raw = "isnot", [js_trim(_after("not", rest))]
    else:
        op, raw = "is", [rest]
    d = typed.get(name) or {"kind": "text"}
    kind = "url" if d["kind"] == "link" else d["kind"]
    options = d.get("options") or []
    if op in COND_ALLOWED and kind not in COND_ALLOWED[op]:
        if kind == "choice":
            tests = "is, is not, is one of, is set or is not set"
        elif kind in COND_ALLOWED["atleast"]:
            tests = "is, is not, is at least, is at most, is set or is not set"
        elif kind in COND_ALLOWED["is"]:
            tests = "is, is not, is set or is not set"
        else:
            tests = "is set or is not set"
        return None, "^%s is %s, so it can only be tested with %s." % (name, "text" if kind == "text" else "a " + KIND_LABELS[kind], tests)
    if op == "oneof" and not 2 <= len(raw) <= 20:
        return None, "Is one of needs 2 to 20 values, separated by |."
    values = []
    for r in raw:
        if not r:
            return None, "A value after \"%s\" is empty." % COND_WORDS[op]
        v = _value(kind, options, r)
        if not v:
            return None, "\"%s\" isn't %s." % (r[:40], "one of ^%s's choices (%s)" % (name, ", ".join(options)) if kind == "choice" else "a " + KIND_LABELS[kind])
        if v in values:
            return None, "\"%s\" is listed twice." % v
        values.append(v)
    return {"name": name, "op": op, "values": values}, ""


def parse_map(md):
    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    errors, steps, phases = [], [], []
    i, phase, step, gate, track, questions = 0, None, None, None, None, False
    context, ctx_line, roles, runs, result, proc = "", -1, "", "", None, ""

    def err(n, msg):
        errors.append({"line": n + 1, "msg": msg})

    if lines[0] and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            kv = re.match(r"^((?:%s|-)+):\s*(.*)$" % W, lines[i])
            if not kv and lines[i].strip():
                err(i, "Front matter line isn't \"key: value\".")
            elif kv and kv.group(1) == "context":
                context, ctx_line = js_trim(kv.group(2)), i
            elif kv and kv.group(1) == "roles":
                roles = kv.group(2)
            elif kv and kv.group(1) == "runs":
                runs = kv.group(2).strip()
            elif kv and kv.group(1) == "result":
                result = kv.group(2).strip()
            elif kv and kv.group(1) == "process":
                proc = kv.group(2).strip()
            i += 1
        i += 1
    names, typed, ctx_errors = detail_types(context_entries(context))
    for m in ctx_errors:
        err(ctx_line if ctx_line >= 0 else 0, m)
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        m = re.match(r"^###\s+Track:\s*(.+?)\s*$", line, re.I)
        if m:
            step = None
            if not phase or gate:
                err(i, "A track must be inside a phase, before its gate.")
            else:
                th_id, th_rest = take_id(m.group(1))
                track = {"id": th_id, "roles": tokens(th_rest, "@")[0]}
                phase.setdefault("tracks", []).append(track)
            i += 1
            continue
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            step, gate, track = None, None, None
            head_id, head = take_id(m.group(1))
            if re.match(r"^questions(?![A-Za-z0-9_])", head, re.I):
                questions, phase = True, None
            else:
                g = re.match(r"^Gate:\s*(.+)$", head, re.I)
                if g:
                    if not phase:
                        err(i, "A gate must come after a phase.")
                    elif phase["gate"]:
                        err(i, "Phase \"%s\" already has a gate." % phase["title"])
                    else:
                        owner = None
                        for part in re.split(r"\s+·\s+", g.group(1))[1:]:
                            om = re.match(r"^owner\s+@((?:%s|-)+)$" % W, part.strip(), re.I)
                            if not om:
                                err(i, "Gate option not understood: \"%s\"." % part)
                            else:
                                owner = om.group(1)
                        gate = {"id": head_id, "kind": "gate", "note": "", "shots": [], "owner": owner}
                        phase["gate"] = gate
                else:
                    pm = re.match(r"^(.*?)\s+·\s+(READ-DO|DO-CONFIRM)$", head)
                    phase = {"id": head_id, "title": (pm.group(1) if pm else head).strip(), "gate": None, "note": "", "shots": [], "noted": False}
                    phases.append(phase)
            i += 1
            continue
        if questions:
            i += 1
            continue
        m = re.match(r"^- \[( |!|~)\]\s+(.+)$", line)
        if m:
            if not phase or gate:
                err(i, "A step must be inside a phase, before its gate.")
            else:
                body = take_id(m.group(2))[1]
                typ, t2 = "", body
                tm = re.match(r"^\{([a-zA-Z](?:%s|[.-])*)\}\s+(.*)$" % W, t2)
                if tm:
                    typ, t2 = tm.group(1), tm.group(2)
                step_roles, rest = tokens(t2, "@")
                rest = tokens(rest, "^")[1]
                step = {"id": take_id(m.group(2))[0], "type": typ, "text": rest, "fields": {}, "shots": [], "phase": len(phases) - 1,
                        "roles": step_roles or (list(track["roles"]) if track else [])}
                steps.append(step)
            i += 1
            continue
        m = re.match("^" + JS_S + "{2,}only when\\b" + JS_S + "*(" + JS_DOT + "*)$", line, re.I | re.A)
        if m:
            target = step or (phase if phase is not None and not gate and not track else None)
            if not target:
                err(i, "A gate can't have \"only when\"; put it on the phase or its steps." if gate else "A track can't have \"only when\"; put it on its steps or on the phase." if track else "\"only when\" must come right under a phase heading or a step.")
            else:
                test, why = parse_condition(m.group(1), names, typed)
                if why:
                    err(i, why)
                elif len(target.get("when", [])) >= COND_MAX:
                    err(i, "A %s can have at most %d \"only when\" lines." % ("step" if target is step else "phase", COND_MAX))
                else:
                    test["line"] = i + 1
                    target.setdefault("when", []).append(test)
            i += 1
            continue
        # Notes and screenshots belong to the step or gate above, or to the phase right under its heading (2.0).
        owner = step or gate or (phase if phase is not None and not track else None)
        m = re.match(r"^\s{2,}>\s?(.*)$", line)
        if m:
            if not owner:
                err(i, "A note must follow a phase heading, a step or a gate.")
            elif owner is not step:
                owner["note"] += ("\n" if owner["note"] else "") + m.group(1)
                if owner is phase and not gate:
                    phase["noted"] = True
            i += 1
            continue
        m = owner and re.match(r"^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$", line)
        if m:
            if not re.match(r"^images/(%s|[./-])+$" % W, m.group(2)) or ".." in m.group(2):
                err(i, "Screenshots must be under images/: \"%s\"." % m.group(2))
            else:
                owner["shots"].append(m.group(2))
            i += 1
            continue
        m = re.match(r"^\s{2,}((?:%s|-)+):\s*(.*)$" % W, line)
        if m:
            name = m.group(1)
            if gate and name in ("approves", "at", "due", "after"):
                i += 1
                continue
            if step:
                # JavaScript ignores a field named __proto__: it sets the object's prototype instead of a key.
                if name != "__proto__":
                    step["fields"][name] = m.group(2).strip()
                i += 1
                continue
        err(i, "Not understood, so it was skipped: \"%s\"" % line.strip()[:60])
        i += 1
    # Forward only: a condition may test a detail a step sets only when that step is in an earlier phase.
    for pi, p in enumerate(phases):
        later = {f for s in steps if s["phase"] >= pi for f in set_names(s["fields"].get("sets", ""))}
        for t in [p] + [s for s in steps if s["phase"] == pi]:
            for w in t.get("when", []):
                if w["name"] in later:
                    err(w["line"] - 1, "^%s is set in this phase or a later one (sets:), so it can't decide whether this applies. Only a step in an earlier phase can set it." % w["name"])
    errors.sort(key=lambda e: e["line"])
    return {"errors": errors, "steps": steps, "questions": questions, "phases": phases, "context": names, "detailTypes": typed, "roles": js_list(roles), "runs": runs, "result": result, "process": proc}


NEW_KINDS = {"number", "yes-no", "date"}
NUMBER_KEYS = ("min", "max", "unit")


def is_number(s):
    """PF.values.isNumber: an exact decimal in canonical form, at most 30 characters."""
    return isinstance(s, str) and len(s) <= 30 and s != "-0" and re.fullmatch(r"-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?", s) is not None


def compare_numbers(a, b):
    """PF.values.compare on two canonical decimals: exact, digit by digit."""
    na, nb = a.startswith("-"), b.startswith("-")
    if na != nb:
        return -1 if na else 1
    pa, pb = (a[1:] if na else a).split("."), (b[1:] if nb else b).split(".")
    if len(pa[0]) != len(pb[0]):
        c = -1 if len(pa[0]) < len(pb[0]) else 1
    elif pa[0] != pb[0]:
        c = -1 if pa[0] < pb[0] else 1
    else:
        fa, fb = pa[1] if len(pa) > 1 else "", pb[1] if len(pb) > 1 else ""
        n = max(len(fa), len(fb))
        fa, fb = fa.ljust(n, "0"), fb.ljust(n, "0")
        c = 0 if fa == fb else -1 if fa < fb else 1
    return -c if na else c


def number_def_ok(d):
    """No problems with a number definition's min, max and unit (PF.values.numberDefProblems)."""
    for k in ("min", "max"):
        if d.get(k) is not None and not is_number(d[k]):
            return False
    if is_number(d.get("min")) and is_number(d.get("max")) and compare_numbers(d["min"], d["max"]) > 0:
        return False
    u = d.get("unit")
    return u is None or (isinstance(u, str) and u.strip(VALUE_WS) != "" and js_len(u) <= 20)


def uses2(record):
    """PF.types.uses2: evidence definitions using a kind or key only 2.0 knows."""
    return isinstance(record, list) and any(isinstance(d, dict) and (d.get("kind") in NEW_KINDS or any(k in d for k in NUMBER_KEYS)) for d in record)


def features(parsed, types):
    """PF.publish.features: the 2.0 features a version's checklist and frozen step types use, in the frozen order."""
    has = set()
    if parsed["detailTypes"]:
        has.add("typed-details")
    if any(d.get("kind") == "pattern" for d in parsed["detailTypes"].values()):
        has.add("detail-patterns")
    for s in parsed["steps"]:
        if js_trim(js_str(s["fields"].get("evidence", ""))).lower() in NEW_KINDS:
            has.add("typed-evidence")
        if s["type"] in ("run.process", "for.each") and "version" in s["fields"]:
            has.add("pinned-children")
        if s["type"] == "for.each":
            has.add("loops")
        if s["type"] == "run.skill" and "skillVersion" in s["fields"]:
            has.add("pinned-skills")
        if s["type"] == "jira.search":
            has.add("jira-search")
        if s["type"] == "run.process" and "pass" in s["fields"]:
            has.add("passed-details")
            if pass_teams(s["fields"]["pass"]):
                has.add("team-values")
        if any(b["from"] for b in sets_of(s["fields"].get("sets", ""))) or (s["type"] == "run.process" and "accepts" in s["fields"]):
            has.add("module-results")
    if parsed.get("result"):
        has.add("module-results")
    for p in parsed["phases"]:
        if p["note"] or p.get("noted"):
            has.add("phase-notes")
        if p["shots"]:
            has.add("phase-shots")
        if p["gate"] and p["gate"]["shots"]:
            has.add("gate-shots")
        if p.get("when"):
            has.add("conditions")
    if any(s.get("when") for s in parsed["steps"]):
        has.add("conditions")
    for t in {s["type"] for s in parsed["steps"] if s["type"]}:
        d = types.get(t) if isinstance(types, dict) else None
        v = d.get("version") if isinstance(d, dict) else None
        four = isinstance(v, (int, float)) and not isinstance(v, bool) and v == 4
        if isinstance(d, dict) and not four and ((isinstance(v, (int, float)) and not isinstance(v, bool) and v == 3) or uses2(d.get("record"))):
            has.add("typed-evidence")
    return [f for f in FROZEN if f in has]


def js_list(s):
    return [x.strip() for x in js_str(s).split(",") if x.strip()]


def sets_of(v):
    """A sets: line's entries (PF.map.setsOf): "tag" sets ^tag from its own box; "disposition=decision" binds the detail to the
    step's decision and "story_result=result" to a linked run's result (module results, 3.0)."""
    out = []
    for e in js_list(v):
        i = e.find("=")
        out.append({"name": e, "from": ""} if i < 0 else {"name": e[:i].strip(), "from": e[i + 1:].strip()})
    return out


def set_names(v):
    return [e["name"] for e in sets_of(v)]


def bound_from(s, name):
    e = [b for b in sets_of(s["fields"].get("sets", "")) if b["name"] == name]
    return e[0]["from"] if e else ""


def result_blockers(parsed):
    """The checks of a checklist's own result and its bindings (PF.map.check's bindChecks and resultChecks), in its words."""
    out, result, ctx, typed = [], parsed.get("result"), parsed["context"], parsed["detailTypes"]
    for s in parsed["steps"]:
        label = step_name(s)
        for e in sets_of(s["fields"].get("sets", "")):
            if not e["from"]:
                continue
            if e["from"] == "decision":
                if s["type"] != "decide":
                    out.append(label + " sets ^%s=decision, but only a {decide} step has a decision." % e["name"])
                elif e["name"] != result:
                    out.append(label + " binds ^%s to its decision, but only the checklist's result is set that way. " % e["name"] + ("Its result is ^%s." % result if result else "Add \"result: %s\" to the front matter." % e["name"]))
            elif e["from"] == "result":
                if s["type"] != "run.process":
                    out.append(label + " sets ^%s=result, but only a {run.process} step has a linked run's result." % e["name"])
                elif not js_list(s["fields"].get("accepts", "")):
                    out.append(label + " imports a result into ^%s but says nothing it accepts. Add accepts: with the results that let this step count as done." % e["name"])
            else:
                out.append(label + ": \"sets: %s=%s\" isn't a binding Flightdeck knows. Use =decision on a {decide} step or =result on a {run.process} step." % (e["name"], e["from"][:40]))
        if "accepts" in s["fields"] and s["type"] == "run.process":
            acc = js_list(s["fields"]["accepts"])
            if not acc:
                out.append(label + ": accepts: names no result.")
            for i, v in enumerate(acc):
                if acc.index(v) < i:
                    out.append(label + " accepts \"%s\" twice." % v[:40])
    if result is None or result == "":
        return out
    if result not in ctx:
        return out + ["\"result\" names ^%s, which isn't listed in context." % result[:60]]
    d = typed.get(result)
    if not d or d.get("kind") != "choice":
        return out + ["The result ^%s must be a choice, like %s:choice(cleared|needs-work)." % (result, result)]
    for s in parsed["steps"]:
        if result in set_names(s["fields"].get("sets", "")) and bound_from(s, result) != "decision":
            out.append(step_name(s) + " sets the result ^%s itself; only its decision sets it (sets: %s=decision on one {decide} step)." % (result, result))
    by = [s for s in parsed["steps"] if bound_from(s, result) == "decision"]
    if not by:
        return out + ["Nothing sets the result ^%s. Add \"sets: %s=decision\" to the {decide} step that records it." % (result, result)]
    if len(by) > 1:
        return out + ["The result ^%s is set by %d steps (%s); exactly one decision sets it." % (result, len(by), ", ".join(s["id"] for s in by))]
    st = by[0]
    if st["type"] == "decide" and "|".join(js_list(st["fields"].get("options", ""))) != "|".join(d["options"]):
        out.append(step_name(st) + ": its options must be the result's choices, in the same order: options: " + ", ".join(d["options"]))
    return out


def loop_blockers(parsed):
    """The checks of a {for.each} step that need no other checklist (PF.map.check's loopChecks), in its words."""
    out, ctx, ids = [], parsed["context"], {s["id"]: s for s in parsed["steps"] if s.get("id")}
    for s in parsed["steps"]:
        if s["type"] != "for.each":
            continue
        label, f = step_name(s), s["fields"]
        acc = js_list(f.get("accepts", ""))
        if f.get("process") and f["process"] == parsed.get("process"):
            out.append(label + " can't start a run of its own process.")
        kind = js_trim(str(f.get("items", "")))
        known = kind in LOOP_KINDS
        if kind and not known:
            out.append(label + " takes items of kind \"%s\", which this copy of Flightdeck doesn't know. Use %s." % (kind[:40], " or ".join(LOOP_KINDS)))
        if known and kind != "jira.issue" and f.get("from"):
            out.append(label + ": from: is for Jira stories (items: jira.issue). A list of items is kept by hand, or fed by one tool named with source:.")
        if known and kind == "jira.issue" and "source" in f:
            out.append(label + ": source: is for items: item. A Jira loop takes its stories from a {jira.search} step with from:.")
        if "source" in f and not LOOP_FEED.match(js_trim(str(f["source"]))):
            out.append(label + ": \"source\" is the feed's stable id: lowercase letters, digits, dots, hyphens or underscores, like deploy-targets.")
        if "noun" in f and not loop_noun_ok(f["noun"]):
            out.append(label + ": \"noun\" is what one and many are called, like noun: environment / environments (letters, digits, spaces, hyphens, at most 40 each).")
        if f.get("from") and (not known or kind == "jira.issue"):
            fid = re.sub(r"^#", "", js_trim(f["from"]))
            fx = ids.get(fid)
            if fx is None:
                out.append(label + ": from: names #%s, which isn't a step of this checklist. Name its {jira.search} step, or leave from: out for a list kept by hand." % fid[:60])
            elif fx["type"] != "jira.search":
                out.append(label + ": from: names #%s, which isn't a {jira.search} step. Name a search step, or leave from: out for a list kept by hand." % fid)
        if "max" in f:
            t = js_trim(f["max"])
            if not re.match(r"^[1-9]\d{0,2}\Z", t) or int(t) > LOOP_MAX_ITEMS:
                out.append(label + ": \"max\" should be a whole number from 1 to %d." % LOOP_MAX_ITEMS)
        if f.get("carry"):
            out.append(label + ": a loop passes details with pass:, not carry:.")
        if any(e["from"] == "result" for e in sets_of(f.get("sets", ""))):
            out.append(label + " imports a result into a run detail, but a loop's results stay per item. Remove the =result binding.")
        if not acc:
            out.append(label + " says nothing it accepts. Add accepts: with the results that clear an item, like accepts: cleared.")
        for i, v in enumerate(acc):
            if acc.index(v) < i:
                out.append(label + " accepts \"%s\" twice." % v[:40])
        for e in pass_entries(f.get("pass", "")):
            if e.startswith("^") and e[1:] not in ctx:
                out.append(label + " passes ^%s, which isn't listed in context." % e[1:])
    return out


def pass_entries(text):
    """The sources of a pass: line's well-formed entries, in order (^name for a run detail)."""
    out = []
    for seg in js_str(text).split(","):
        t = js_trim(seg)
        eq = t.find("=")
        if eq > 0:
            m = PASS_DETAIL.match(js_trim(t[eq + 1:]))
            if m and m.group(1) not in JS_PROTO:
                out.append("^" + m.group(1))
    return out


def js_duration(s):
    m = re.match(r"^\s*(?:([0-9]+)h)?\s*(?:([0-9]+)m)?\s*(?:([0-9]+)s)?\s*$", js_str(s), re.I)
    return bool(m and (m.group(1) or m.group(2) or m.group(3)))


def js_concat(o, key):
    """A property as JavaScript's string concatenation writes it, missing ones as "undefined"."""
    if not isinstance(o, dict) or key not in o:
        return "undefined"
    return "null" if o[key] is None else js_str(o[key])


PASS_NAME = re.compile(r"^[A-Za-z0-9_-]{1,60}$")
PASS_DETAIL = re.compile(r"^\^([A-Za-z0-9_-]+)$")
TEAM_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}\Z")
JS_PROTO = {"__proto__", "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
            "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"}


def pass_errors(text, items=False):
    """The errors of the app's PF.links.parse: a pass: line on a linked step (2.8)."""
    return parse_pass(text, items)[0]


def pass_teams(text):
    """PF.links.teams: the team values (2.9) a pass: line's good entries name, once each, in order."""
    return parse_pass(text)[1]


def parse_pass(text, items=False):
    """PF.links.parse as (errors, team value names). items: a {for.each} step's item:key and item:title (3.0)."""
    raw = js_str(text)
    teams = []
    if not js_trim(raw):
        return [], teams
    parts = raw.split(",")
    if len(parts) > 40:
        return ["pass: can list at most 40 details."], teams
    errors, seen = [], set()
    for seg in parts:
        t = js_trim(seg)
        eq = t.find("=")
        if not t:
            errors.append("pass: has an empty entry (two commas in a row, or one at the end).")
            continue
        name = js_trim(t[:eq]) if eq >= 0 else ""
        right = js_trim(t[eq + 1:]) if eq >= 0 else ""
        if eq < 0 or not name:
            errors.append("\"%s\" needs a name, =, and where its value comes from, like environment=^env." % t)
            continue
        if name in JS_PROTO:
            errors.append("\"%s\" is a name Flightdeck keeps for itself." % name)
            continue
        if not PASS_NAME.match(name):
            errors.append("\"%s\" isn't a run detail name (letters, digits, - and _)." % name)
            continue
        if name in seen:
            errors.append("pass: names \"%s\" twice." % name)
            continue
        seen.add(name)
        if not right:
            errors.append("\"%s=\" says where its value comes from after the =: ^a detail, ? to ask, or a fixed value." % name)
            continue
        if right == "?":
            continue
        m = PASS_DETAIL.match(right)
        if m:
            if m.group(1) in JS_PROTO:
                errors.append("\"^%s\" is a name Flightdeck keeps for itself." % m.group(1))
            continue
        if right == "^":
            errors.append("\"%s=^\" names no run detail: \"^\" isn't a run detail." % name)
            continue
        if right[:5].lower() == "team:":
            tv = js_trim(right[5:])
            if right[:5] != "team:":
                errors.append("\"%s=%s\": write team: in lowercase." % (name, right))
            elif not tv:
                errors.append("\"%s=team:\" names no team value." % name)
            elif not TEAM_NAME.match(tv):
                errors.append("\"%s\" isn't a team value name (lowercase letters, digits and -, at most 40)." % tv)
            elif tv not in teams:
                teams.append(tv)
            continue
        if items and right[:5].lower() == "item:":
            iw = js_trim(right[5:])
            if right[:5] != "item:" or iw not in ("key", "title"):
                errors.append("\"%s=%s\": an item gives item:key or item:title." % (name, right))
            continue
        if "^" in right:
            errors.append("\"%s=%s\": a fixed value can't hold ^. Use ^name alone to pass a run detail." % (name, right))
            continue
        if re.search(r"[\x00-\x1f\x7f]", right):
            errors.append("\"%s=\u2026\" has a control character." % name)
            continue
        if len(right.encode("utf-16-le")) // 2 > 120:
            errors.append("\"%s=\u2026\": a fixed value can be at most 120 characters." % name)
    return errors, teams


def field_errors(type_def, fields, context=None):
    """The errors (not tips) of the app's PF.types.checkFields. Raises ValueError where that function would throw."""
    own = type_def.get("fields") if isinstance(type_def, dict) else None
    if isinstance(own, dict) and any(v is None for v in own.values()):
        raise ValueError("a field definition is null")
    errors = []
    tid = js_concat(type_def, "id")
    for f in js_keys(fields):
        d = own.get(f) if isinstance(own, dict) and f in own else None
        if not isinstance(d, (dict, list)):
            d = COMMON.get(f)
        # The 2.0 pins (PF.types.pinDef): version: on a built-in {run.process}, skillVersion: on a built-in {run.skill}.
        if d is None and isinstance(type_def, dict) and not type_def.get("custom"):
            d = PINS.get(type_def.get("id") if isinstance(type_def.get("id"), str) else "", {}).get(f)
        if not isinstance(d, dict):
            if d is None:
                errors.append("has a field \"%s\" that {%s} doesn't use." % (f, tid))
            continue
        v, kind = fields[f], d.get("kind")
        if kind == "choice":
            opts = js_list(fields.get(d["optionsFrom"])) if d.get("optionsFrom") else (d.get("options") or [])
            opts = opts if isinstance(opts, list) else []
            if not any(js_str(o).lower() == v.strip().lower() for o in opts):
                errors.append("\"%s\" should be one of: %s." % (f, ", ".join(js_str(o) for o in opts)))
        if kind == "time" and not re.match(r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$", v.strip()):
            errors.append("\"%s\" should be a time like 15:00." % f)
        if kind == "duration" and f == "after" and not js_duration(v):
            errors.append("\"after\" should be a duration like 2h or 30m.")
        if kind == "pin" and f == "version" and not re.match(r"^[1-9]\d{0,5}$", v.strip()):
            errors.append("\"version\" should be a version number, like 4.")
        if kind == "pin" and f == "skillVersion" and not re.match(r"^[\w.+-]{1,40}$", v.strip()):
            errors.append("\"skillVersion\" should be the skill's version, like 1.2.0.")
        if kind == "pass":
            errors.extend(pass_errors(v, tid == "for.each" and not (isinstance(type_def, dict) and type_def.get("custom"))))
        if kind == "list" and len(js_list(v)) < 2:
            errors.append("\"%s\" needs at least two choices, separated by commas." % f)
        if kind == "require":
            record = (type_def.get("record") if isinstance(type_def, dict) else None) or []
            if not isinstance(record, list) or any(r is None for r in record):
                raise ValueError("record isn't a list of evidence")
            names = [js_str(r.get("name")) if isinstance(r, dict) else "" for r in record]
            for n in js_list(v):
                if n != "all" and n not in names:
                    errors.append("\"require\" names \"%s\", which {%s} doesn't record. It records: %s." % (n, tid, ", ".join(names) or "nothing (use \"evidence:\" instead)"))
    # 2.16: a built-in Jira search's own fields (PF.jsearch.checkFields), in the same order and words.
    if isinstance(type_def, dict) and type_def.get("id") == "jira.search" and not type_def.get("custom"):
        errors.extend(search_errors(fields, context or []))
    return errors


# 2.16: Jira searches (PF.jsearch): the lexer, where each run detail may sit, the rule, and the step's own fields.
QUERY_MAX, WHAT_MAX = 2000, 200
SCALAR_OPS = ["=", "!=", "<", ">", "<=", ">="]
_JWS = "\t\n\x0b\x0c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_SPACE = re.compile("[" + _JWS + "]")
_WORD_END = re.compile("[" + _JWS + "\"'()=,~<>!]")
_PH_WORD = re.compile(r"^\^([A-Za-z0-9_-]+)$")
_PH_ANY = re.compile(r"\^([A-Za-z0-9_-]+)")


def jql_lex(q):
    out, i = [], 0
    while i < len(q):
        c = q[i]
        if _JS_SPACE.match(c):
            i += 1
            continue
        if c in "\"'":
            j, v = i + 1, ""
            while j < len(q) and q[j] != c:
                if q[j] == "\\":
                    if j + 1 >= len(q):
                        return None, "a quoted string ends in a lone backslash"
                    v += q[j + 1]
                    j += 2
                else:
                    v += q[j]
                    j += 1
            if j >= len(q):
                return None, "a %s quote is never closed" % ("double" if c == '"' else "single")
            out.append({"t": "str", "v": v})
            i = j + 1
            continue
        two = q[i:i + 2]
        if two in ("!=", "!~", "<=", ">="):
            out.append({"t": "op", "v": two})
            i += 2
            continue
        if c in "=~<>":
            out.append({"t": "op", "v": c})
            i += 1
            continue
        if c in "(),":
            out.append({"t": {"(": "lp", ")": "rp", ",": "comma"}[c], "v": None})
            i += 1
            continue
        if c == "!":
            return None, '"!" is only part of != or !~'
        k = i
        while k < len(q) and not _WORD_END.match(q[k]):
            k += 1
        w = q[i:k]
        m = _PH_WORD.match(w)
        out.append({"t": "ph", "v": m.group(1)} if m else {"t": "word", "v": w})
        i = k
    return out, ""


def jql_placeholders(q, context):
    toks, why = jql_lex(q)
    if toks is None:
        return ['"query": %s.' % why], []
    errors, uses, stack = [], [], []
    kw = lambda t: t["v"].upper() if t and t["t"] == "word" else None
    at = lambda k: toks[k] if 0 <= k < len(toks) else None
    for k, tk in enumerate(toks):
        if tk["t"] == "lp":
            p = at(k - 1)
            kind = "group"
            if p and p["t"] == "word" and kw(p) not in ("IN", "AND", "OR", "NOT"):
                kind = "function"
            elif p and p["t"] == "word" and kw(p) == "IN":
                kind = "list"
            stack.append(kind)
            continue
        if tk["t"] == "rp":
            if stack:
                stack.pop()
            continue
        if tk["t"] == "str":
            for m in _PH_ANY.finditer(tk["v"]):
                if m.group(1) in context:
                    errors.append('"query" has ^%s inside quotes. Write it on its own after =, !=, <, >, <=, >= or inside IN (...): Flightdeck quotes it for you.' % m.group(1))
            continue
        if tk["t"] == "word" and re.search(r"\^[A-Za-z0-9_-]", tk["v"]):
            for m in _PH_ANY.finditer(tk["v"]):
                errors.append(('"query" has ^%s joined to other text ("%s"); a run detail stands alone.' % (m.group(1), tk["v"])) if m.group(1) in context else '"query" has ^%s, which isn\'t a run detail.' % m.group(1))
            continue
        if tk["t"] != "ph":
            continue
        if tk["v"] not in context:
            errors.append('"query" has ^%s, which isn\'t a run detail of this checklist.' % tk["v"])
            continue
        top = stack[-1] if stack else "top"
        p1, p2, n = at(k - 1), at(k - 2), at(k + 1)
        ok, why = False, ""
        if "function" in stack:
            why = "is inside a function's arguments"
        elif p1 and p1["t"] == "op" and p1["v"] in ("~", "!~"):
            why = "is a text search (~ or !~), which reads its own syntax inside the string"
        elif p1 and p1["t"] == "op" and p1["v"] in SCALAR_OPS:
            ok = True
        elif p1 and p1["t"] == "word" and (kw(p1) == "IS" or (kw(p1) == "NOT" and p2 and p2["t"] == "word" and kw(p2) == "IS")):
            why = "follows IS or IS NOT, which take only EMPTY or NULL (write IS EMPTY as fixed text)"
        elif top == "list" and p1 and p1["t"] in ("lp", "comma"):
            ok = True
        else:
            why = "isn't where a value goes (after =, !=, <, >, <=, >=, or inside IN (...))"
        if ok:
            end_ok = not n or n["t"] == "rp" or (n["t"] == "comma" and top == "list") or (n["t"] == "word" and kw(n) in ("AND", "OR", "ORDER"))
            if not end_ok:
                ok, why = False, 'is followed by "%s", where the value should end' % (n["v"] or n["t"])
        if ok:
            if tk["v"] not in uses:
                uses.append(tk["v"])
        else:
            errors.append('"query" has ^%s that %s.' % (tk["v"], why))
    return errors, uses


def parse_results(text):
    t = re.sub(r"[" + _JWS + "]+", " ", js_trim("any" if text is None else str(text)).lower())
    if t == "none":
        return {"op": "eq", "n": 0, "text": "none"}, ""
    if t == "any":
        return {"op": "any", "n": None, "text": "any"}, ""
    m = re.match(r"^(exactly|at least|at most) (0|[1-9][0-9]{0,5})$", t)
    if not m:
        return None, '"results" should be none, any, exactly N, at least N or at most N (N a whole number up to 999999).'
    op, n = {"exactly": "eq", "at least": "ge", "at most": "le"}[m.group(1)], int(m.group(2))
    if op == "eq" and n == 0:
        return {"op": "eq", "n": 0, "text": "none"}, ""
    if op == "ge" and n == 0:
        return {"op": "any", "n": None, "text": "any"}, ""
    return {"op": op, "n": n, "text": "%s %d" % (m.group(1), n)}, ""


def search_errors(f, context):
    """PF.jsearch.checkFields's errors, without team values (the app's version reader doesn't pass them either)."""
    f = f if isinstance(f, dict) else {}
    get = lambda k: js_str(f.get(k)) if f.get(k) is not None else None
    errors, uses = [], []
    has_q = get("query") is not None and js_trim(get("query")) != ""
    has_f = get("filter") is not None and js_trim(get("filter")) != ""
    if has_q and has_f:
        errors.append('give "query:" or "filter:", not both.')
    if not has_q and not has_f:
        errors.append('needs "query:" (JQL) or "filter:" (a saved filter\'s number). It can\'t be filled in during a run.')
    if has_q:
        q = get("query")
        if len(q) > QUERY_MAX:
            errors.append('"query" is %d characters; the most is %d. Save it as a Jira filter and use "filter:".' % (len(q), QUERY_MAX))
        bt = bad_text(q)
        if bt:
            errors.append('"query" has %s.' % bt)
        pe, uses = jql_placeholders(q, context)
        errors.extend(pe)
    if has_f and not re.match(r"^[1-9][0-9]{0,9}$", js_trim(get("filter"))):
        errors.append('"filter" should be a saved filter\'s number, like 12345.')
    site = js_trim(get("site")) if get("site") is not None else "team:jira-base-url"
    if not re.match(r"^team:[a-z0-9][a-z0-9-]{0,39}$", site):
        errors.append('"site" should be team:<name>, a team value holding the Jira address (Settings > Team values).')
    loop = [n for n in js_list(get("sets") or "") if n in uses]
    if loop:
        errors.append("sets %s, which its own query uses. A search can't change the detail it searches with; set it in an earlier step." % ", ".join("^" + n for n in loop))
    rule, why = parse_results(get("results"))
    if rule is None:
        errors.append(why)
    req = [x for x in re.split(r"[,\s]+", (get("require") or "").lower()) if x]
    if rule is not None and "keys" in req and rule["n"] == 0 and rule["op"] in ("eq", "le"):
        errors.append("requires keys, but results: %s passes only with no results, and no results have no issue keys. Take keys out of require: (require: all already leaves them out when there are none)." % rule["text"])
    if get("what") is not None and js_len(get("what")) > WHAT_MAX:
        errors.append('"what" can be at most %d characters.' % WHAT_MAX)
    return errors


# 2.16: run details that must match a pattern (Appendix A), the same grammar and linear matcher as PF.values, in code points.
PAT_MAX, ATOMS_MAX, REP_MAX, DETAIL_MAX = 200, 40, 100, 120
PAT_ESC = "\\.-()[]{}+*?^$/|,:"
PAT_HINT = "inside pattern(...), write ( ) and , as \\( \\) \\, everywhere, even inside [...]."
_CONTROL = re.compile("[\u0000-\u001f\u007f-\u009f\u2028\u2029]")
_BIDI = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069]")
_LONE = re.compile("[\ud800-\udfff]")


def bad_text(v):
    """PF.values.badText: the one forbidden set (controls, U+2028/9, direction characters, lone surrogates)."""
    v = str(v)
    if _CONTROL.search(v):
        return "a line break or control character"
    if _BIDI.search(v):
        return "a direction character"
    if _LONE.search(v):
        return "broken Unicode (a lone surrogate)"
    return ""


def context_entries(line):
    """PF.map.contextEntries: commas split entries, except inside pattern(...), where escapes are skipped."""
    s, out, buf, in_pat, i = str(line or ""), [], "", False, 0
    while i < len(s):
        c = s[i]
        if not in_pat and re.search(r":\s*pattern\($", buf + c):
            in_pat, buf = True, buf + c
        elif in_pat and c == "\\":
            buf += c + (s[i + 1] if i + 1 < len(s) else "")
            i += 1
        elif in_pat and c == ")":
            in_pat, buf = False, buf + c
        elif not in_pat and c == ",":
            if js_trim(buf):
                out.append(js_trim(buf))
            buf = ""
        else:
            buf += c
        i += 1
    if js_trim(buf):
        out.append(js_trim(buf))
    return out


def compile_pattern(src):
    if not isinstance(src, str) or not src or len(src) > PAT_MAX:
        return {"ok": False, "why": "a pattern is 1 to %d characters." % PAT_MAX}
    if bad_text(src):
        return {"ok": False, "why": "the pattern has %s." % bad_text(src)}
    s = list(src)
    if s and s[0] == "^":
        s = s[1:]
    if s and s[-1] == "$":
        n, j = 0, len(s) - 2
        while j >= 0 and s[j] == "\\":
            n, j = n + 1, j - 1
        if n % 2 == 0:
            s = s[:-1]
    atoms, i = [], 0

    def endpoint(j):
        c = s[j]
        if c != "\\":
            return {"v": c, "j": j + 1}
        n = s[j + 1] if j + 1 < len(s) else None
        if n == "d":
            return {"v": "\\d", "j": j + 2}
        if n is not None and n in PAT_ESC:
            return {"v": n, "j": j + 2}
        return {"why": "\"\\%s\" isn't an escape the pattern knows (\\d, or \\ before one of %s)." % (n or "", PAT_ESC)}
    while i < len(s):
        c = s[i]
        if c == "\\":
            e = endpoint(i)
            if "why" in e:
                return {"ok": False, "why": e["why"]}
            st = {"ranges": [(48, 57)], "chars": []} if e["v"] == "\\d" else {"ranges": [], "chars": [ord(e["v"])]}
            i = e["j"]
        elif c == "[":
            j, chars, ranges = i + 1, [], []
            if j < len(s) and s[j] == "^":
                return {"ok": False, "why": "a negated class [^...] isn't supported; list what is allowed."}
            while j < len(s) and s[j] != "]":
                if s[j] in "(),":
                    return {"ok": False, "why": "\"%s\" inside [...] needs a \\ before it: %s" % (s[j], PAT_HINT)}
                a = endpoint(j)
                if "why" in a:
                    return {"ok": False, "why": a["why"]}
                j = a["j"]
                if a["v"] == "\\d":
                    ranges.append((48, 57))
                    continue
                if j < len(s) and s[j] == "-" and j + 1 < len(s) and s[j + 1] != "]":
                    if s[j + 1] in "(),":
                        return {"ok": False, "why": "\"%s\" inside [...] needs a \\ before it: %s" % (s[j + 1], PAT_HINT)}
                    b = endpoint(j + 1)
                    if "why" in b or b["v"] == "\\d":
                        return {"ok": False, "why": "a range ends in \\d or a bad escape."}
                    if ord(b["v"]) < ord(a["v"]):
                        return {"ok": False, "why": "the range %s-%s is backwards." % (a["v"], b["v"])}
                    ranges.append((ord(a["v"]), ord(b["v"])))
                    j = b["j"]
                else:
                    chars.append(ord(a["v"]))
            if j >= len(s):
                return {"ok": False, "why": "a [ is never closed."}
            if not ranges and not chars:
                return {"ok": False, "why": "an empty class [] matches nothing; list what is allowed."}
            st, i = {"ranges": ranges, "chars": chars}, j + 1
        elif c in "()|":
            return {"ok": False, "why": "\"%s\" (groups and alternatives) isn't supported; write one sequence. For the character itself, %s" % (c, PAT_HINT)}
        elif c == ",":
            return {"ok": False, "why": "\",\" needs a \\ before it: " + PAT_HINT}
        elif c == ".":
            return {"ok": False, "why": "\".\" (any character) isn't supported; say which characters are allowed, like [a-z0-9]."}
        elif c in "?*+{":
            return {"ok": False, "why": "\"%s\" has nothing before it to repeat." % c}
        elif c in "]}^$":
            return {"ok": False, "why": "\"%s\" needs a \\ before it." % c}
        else:
            st, i = {"ranges": [], "chars": [ord(c)]}, i + 1
        lo, hi, q = 1, 1, s[i] if i < len(s) else None
        if q == "?":
            lo, i = 0, i + 1
        elif q == "*":
            lo, hi, i = 0, None, i + 1
        elif q == "+":
            hi, i = None, i + 1
        elif q == "{":
            m = re.match(r"\{(\d{1,3})(,(\d{0,3}))?\}", "".join(s[i:i + 9]))
            if not m:
                return {"ok": False, "why": "a repeat is {n}, {n,} or {n,m}."}
            lo = int(m.group(1))
            hi = (None if m.group(3) == "" else int(m.group(3))) if m.group(2) else lo
            if lo > REP_MAX or (hi is not None and (hi > REP_MAX or hi < lo)):
                return {"ok": False, "why": "a repeat goes up to %d, with n no more than m." % REP_MAX}
            i += len(m.group(0))
        if i < len(s) and s[i] in "?*+{":
            return {"ok": False, "why": "two repeats in a row aren't supported."}
        atoms.append({"set": st, "min": lo, "max": hi})
        if len(atoms) > ATOMS_MAX:
            return {"ok": False, "why": "a pattern has at most %d parts." % ATOMS_MAX}
    return {"ok": True, "atoms": atoms}


def match_pattern(p, value):
    """PF.values.matchPattern: (ok, steps), a simulation linear in the value's length."""
    if not p.get("ok") or bad_text(value) or len(value) > DETAIL_MAX:
        return False, 0
    A, steps = p["atoms"], 0

    def inset(st, cp):
        return cp in st["chars"] or any(a <= cp <= b for a, b in st["ranges"])

    def close(lst):
        seen, out, stack = set(), [], list(lst)
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            out.append(x)
            if x[0] < len(A) and x[1] >= A[x[0]]["min"]:
                stack.append((x[0] + 1, 0))
        return out
    cur = close([(0, 0)])
    for ch in value:
        cp, nxt, had = ord(ch), [], set()
        for a, n in cur:
            steps += 1
            if a >= len(A):
                continue
            at = A[a]
            if (at["max"] is None or n < at["max"]) and inset(at["set"], cp):
                m2 = min(n + 1, at["min"]) if at["max"] is None else n + 1
                if (a, m2) not in had:
                    had.add((a, m2))
                    nxt.append((a, m2))
        cur = close(nxt)
        if not cur:
            return False, steps
    return any(x[0] == len(A) for x in cur), steps


# 2.16: run details in link fields (Appendix B). Python classifies the text as written: step 0 has already refused every
# character the URL parser strips or trims. An xn-- host can't be verified here, so it's "unverified", never ok.
LINK_FORBIDDEN = re.compile("[\u0000-\u0020\u007f-\u009f\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\ud800-\udfff]")
_LABEL = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")
_QUERY_NAME = re.compile(r"^(jql|jqlquery|cql|query|q|filter|search)\Z", re.I)


def authority_problem(auth):
    """The one authority grammar (PF.urls.authorityProblem), plus ipaddress for a bracketed IPv6 literal."""
    if not auth:
        return "has no host."
    if "@" in auth:
        return "has a user name or password before the host. Remove it."
    host, port = auth, None
    if auth[0] == "[":
        e = auth.find("]")
        if e < 0:
            return "has an IPv6 address with no closing \"]\"."
        host, rest = auth[:e + 1], auth[e + 1:]
        if rest:
            if rest[0] != ":":
                return "has something after the IPv6 address other than a port."
            port = rest[1:]
        if not re.match(r"^\[[0-9A-Fa-f:.]+\]\Z", host):
            return "has an IPv6 address with characters it can't hold."
        import ipaddress
        try:
            ipaddress.IPv6Address(host[1:-1])
        except ValueError:
            return "has an IPv6 address with characters it can't hold."
    else:
        c = auth.rfind(":")
        if c >= 0:
            host, port = auth[:c], auth[c + 1:]
        h = host[:-1] if host.endswith(".") else host
        labels = h.split(".")
        if not h or len(h) > 253 or any(not _LABEL.match(l) for l in labels):
            return "has a host that isn't letters, digits, dots and inner hyphens (write an international name in its xn-- form)."
        last = labels[-1]
        if re.match(r"^\d+\Z", last) or re.match(r"^0x", last, re.I):
            if not (len(labels) == 4 and all(re.match(r"^(0|[1-9]\d{0,2})\Z", l) and int(l) <= 255 for l in labels)):
                return "has a host that looks like an IPv4 address but isn't a plain one (like 10.0.0.1)."
    if port is not None and not (re.match(r"^\d{1,5}\Z", port) and 1 <= int(port) <= 65535):
        return "has a port that isn't a number from 1 to 65535."
    return ""


def classify_link(template, context):
    """PF.urls.classify on the text as written: static, whole, ok, hint, unverified, or a refusal (forbidden, address,
    malformed, name), with why or hint."""
    t = str(template or "")
    if LINK_FORBIDDEN.search(t):
        return {"code": "forbidden"}
    names = [n for n in re.findall(r"\^([A-Za-z0-9_-]+)", t) if n in context]
    if not names:
        return {"code": "static"}
    if re.match(r"^\^([A-Za-z0-9_-]+)\Z", t):
        return {"code": "whole"}
    mm = re.match(r"^(mailto:[^?#]*)(\?[^#]*)?\Z", t, re.I)
    hm = re.match(r"^(https?://[^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?\Z", t, re.I | re.S)
    if not mm and not hm:
        return {"code": "malformed"}
    head = mm.group(1) if mm else hm.group(1)
    if any(n in context for n in re.findall(r"\^([A-Za-z0-9_-]+)", head)):
        return {"code": "address"}
    auth = re.sub(r"^https?://", "", hm.group(1), flags=re.I) if hm else ""
    if hm:
        ap = authority_problem(auth)
        if ap:
            return {"code": "malformed", "why": ap}
    q = (mm.group(2) if mm else hm.group(3)) or ""
    slot = lambda x: any(n in context for n in re.findall(r"\^([A-Za-z0-9_-]+)", x))
    hint = ""
    for part in [x for x in re.split(r"[&;]", q[1:] if q.startswith("?") else q) if x]:
        if not slot(part):
            continue
        at = part.find("=")
        if at < 0 or slot(part[:at]):
            return {"code": "name"}
        if not hint and _QUERY_NAME.match(part[:at]):
            hint = part[:at]
    if hm and any(l.lower().startswith("xn--") for l in auth.split(":")[0].split(".")):
        return {"code": "unverified", "hint": hint}
    return {"code": "hint" if hint else "ok", "hint": hint}


TYPE_KEYS = {"id", "label", "icon", "hint", "fields", "record", "version", "custom", "group", "tags"}
FIELD_KEYS = {"label", "kind", "required", "requiredWhen", "requiredUnless", "options"}
RECORD_KEYS = {"name", "label", "kind", "long", "optionsFrom", "options", "when", "min", "max", "unit", "system", "notAt"}
KNOWN_KINDS = {"text", "url", "code", "message", "list", "choice", "duration", "deadline", "require", "time", "sets", "jql", "jira-filter", "results", "team-ref"}
SEARCH_KINDS = {"jql", "jira-filter", "results", "team-ref"}
RECORD_KINDS = {"text", "url", "choice", "number", "yes-no", "date"}


def inherited(n):
    """A name every JavaScript object already has, or one that isn't text: the app's own reads would see what's inherited."""
    return n in JS_PROTO if isinstance(n, str) else n is not None


def not_at_ok(r):
    """The app's notAtOk: absent, or a non-empty object of text values under names no JavaScript object already has."""
    if "notAt" not in r:
        return True
    n = r["notAt"]
    return isinstance(n, dict) and len(n) > 0 and all(not inherited(k) and isinstance(v, str) for k, v in n.items())


def cond_ok(c):
    return not isinstance(c, dict) or not any(inherited(k) for k in c)


def understood(d):
    """The app's PF.types.understood: a frozen step type uses only the type version, properties and kinds this copy knows."""
    if not isinstance(d, dict) or not set(d) <= TYPE_KEYS:
        return False
    v = d.get("version")
    # Version 3 (2.0): typed evidence, whose kinds and keys are read only there. Version 4 (2.16): the Jira search's kinds and keys.
    if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or (v > TYPES_VERSION and v not in (3, 4, 5))):
        return False
    four = isinstance(v, (int, float)) and not isinstance(v, bool) and v == 4
    fields = d.get("fields")
    if fields is not None and (not isinstance(fields, dict) or not all(
            not inherited(n) and isinstance(f, dict) and set(f) <= FIELD_KEYS and isinstance(f.get("kind"), str) and f.get("kind") in KNOWN_KINDS
            and cond_ok(f.get("requiredWhen")) and cond_ok(f.get("requiredUnless")) for n, f in fields.items())):
        return False
    record = d.get("record")
    if record is not None and (not isinstance(record, list) or not all(
            isinstance(r, dict) and set(r) <= RECORD_KEYS and isinstance(r.get("kind"), str) and r.get("kind") in RECORD_KINDS
            and not inherited(r.get("name")) and not inherited(r.get("optionsFrom")) and cond_ok(r.get("when")) and not_at_ok(r)
            and (not any(k in r for k in NUMBER_KEYS) or (r.get("kind") == "number" and number_def_ok(r))) for r in record)):
        return False
    if uses2(record) and not (isinstance(v, (int, float)) and not isinstance(v, bool) and v >= 3):
        return False
    if not four and ((isinstance(fields, dict) and any(isinstance(f, dict) and f.get("kind") in SEARCH_KINDS for f in fields.values()))
                     or (isinstance(record, list) and any(isinstance(r, dict) and ("system" in r or "notAt" in r) for r in record))):
        return False
    if isinstance(record, list) and any(isinstance(r, dict) and "system" in r and r.get("system") is not True for r in record):
        return False
    return True


def unrunnable(md, types):
    """Why this copy of Flightdeck can't run a published checklist, or "" if it can. Same order and words as the app."""
    parsed = parse_map(md)
    if parsed["errors"]:
        e = parsed["errors"][0]
        return "%s Line %d: %s" % (NEWER, e["line"], e["msg"])
    if parsed["questions"]:
        return "It has a \"Questions\" section, so steps after it would be skipped. Publish it again without one."
    taken = parsed["roles"] + parsed["context"]
    for p in parsed["phases"]:
        taken += [p["id"]] + ([p["gate"]["id"]] if p["gate"] else [])
    taken = [n for n in taken + [s["id"] for s in parsed["steps"]] if n in JS_PROTO]
    if taken:
        return "It uses the name \"%s\" for a step, phase, gate, role or run detail, and Flightdeck keeps that name for itself. Publish the checklist again with another one." % taken[0]
    for s in parsed["steps"]:
        label = step_name(s)
        if not s["type"]:
            return label + " has no step type, so it can't be run. Publish the checklist again."
        d = types.get(s["type"])
        frozen = isinstance(d, (dict, list))
        if not frozen:
            d = dict(BUILTIN[s["type"]], id=s["type"]) if s["type"] in BUILTIN else None
        if d is None:
            return label + " uses the step type {%s}, which this copy of Flightdeck doesn't have and this version doesn't include. Update Flightdeck, or publish the checklist again." % s["type"]
        # Built-in types are this copy's own; only a type frozen into the version can hold something it doesn't know.
        if frozen and not understood(d):
            return "%s %s has a step type this copy can't read." % (NEWER, label)
        try:
            bad = field_errors(d, s["fields"], parsed["context"])
        except ValueError:
            return "%s %s has a step type this copy can't read." % (NEWER, label)
        if bad:
            return "%s %s %s" % (NEWER, label, bad[0])
    return ""


def read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return b""


# A file name in proposals/ that says which plan it's for by its shape alone (PF.plans.namesPlan): a plan's ID (plan-...) or a
# request's (req-<tool>-<24 hex>), then its extension, .status-..., or a copy's " (1)" or "-COMPUTER".
PLAN_NAMED = re.compile(r"^(plan-[a-z0-9-]{1,100}|req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})(\.| \(|-[A-Z])")


def read_text(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None


# The format envelope (Flightdeck's PF.envelope, docs/design.md section 28), for the families this checker reads. A file in a
# newer major, or with a must-understand feature this copy doesn't know, is refused and named with the version it needs.
# test/checker.test.js fails if this disagrees with src/core/envelope.js.
FAMILIES = {
    "preflight-publication": {"majors": {1: [], 2: ["phase-notes", "phase-shots", "gate-shots", "pinned-children", "pinned-skills", "typed-details", "typed-evidence", "conditions", "passed-details", "team-values", "jira-search", "detail-patterns", "module-results", "loops", "staged"]}, "future": {2: "2.0"}, "unmarked": False},
    "flightdeck-step-type": {"majors": {1: [], 2: ["typed-evidence"]}, "future": {2: "2.0"}, "unmarked": True},
    "flightdeck-plan": {"majors": {1: [], 2: [], 3: ["loops"]}, "future": {}, "unmarked": False, "kinds": ["plan"]},
    "flightdeck-plan-status": {"majors": {1: [], 2: [], 3: ["loops"]}, "future": {}, "unmarked": False, "kinds": ["status"]},
    "flightdeck-skill": {"majors": {1: [], 2: []}, "future": {2: "2.0"}, "unmarked": True},
    "flightdeck-team-values": {"majors": {1: []}, "future": {1: "2.9"}, "unmarked": False},
}
# Every family's name, so a file of another known family is malformed here, never "newer".
FAMILY_NAMES = ["flightdeck-checklist", "preflight-publication", "preflight-run", "flightdeck-run-archive", "flightdeck-step-type", "flightdeck-types", "flightdeck-plan",
                "flightdeck-plan-status", "flightdeck-validation", "flightdeck-followup-decision", "flightdeck-correction-decision", "flightdeck-fix-decision", "flightdeck-proposal",
                "flightdeck-presence", "flightdeck-connection", "flightdeck-people", "flightdeck-team-values", "flightdeck-skill", "flightdeck-editor-history", "flightdeck-installed", "flightdeck-stage-decision",
                "flightdeck-extension", "flightdeck-report", "flightdeck-report-decision"]
FROZEN = ["typed-details", "typed-evidence", "phase-notes", "phase-shots", "gate-shots", "pinned-children", "pinned-skills", "staged", "test-run", "extensions", "conditions", "passed-details", "team-values",
          "jira-search", "detail-patterns", "module-results", "loops"]
# The first release that reads a feature, where it isn't 2.0 (PF.envelope.SINCE).
SINCE = {"conditions": "2.1", "staged": "2.1", "test-run": "2.1", "passed-details": "2.8", "team-values": "2.9", "jira-search": "2.16", "detail-patterns": "2.16", "module-results": "3.0", "loops": "3.0"}


def _minimum(features):
    """PF.envelope.minimum: the release that first reads every listed feature, or ""."""
    vs = [SINCE.get(f, "2.0") for f in (features or []) if f in FROZEN]
    return max(vs, key=lambda v: [int(x) for x in v.split(".")]) if vs else ""


def _semver(v):
    m = re.match(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})\Z", v) if isinstance(v, str) else None
    return [int(x) for x in m.groups()] if m else None


def _needs(fam, major, features, o):
    a = _semver(o.get("app") if isinstance(o, dict) else None)
    least = _minimum(features)
    if a and a[0] >= 2:
        return least if least and [int(x) for x in least.split(".")] > [a[0], a[1]] else "%d.%d" % (a[0], a[1])
    if fam and major is not None and major in fam["future"]:
        return fam["future"][major]
    return least


def _txt(v):
    """PF.envelope.txt, cut to 60 characters: a string as is, anything else as JSON."""
    return (v if isinstance(v, str) else js_json(v))[:60]


def judge(family, o):
    """{"ok": True, "major": n} or {"ok": False, "kind": "newer" | "malformed", "needs": "2.0" | "", "why"} (a malformed one's
    reason in the app's words)."""
    def bad(why):
        return {"ok": False, "kind": "malformed", "needs": "", "why": why}
    fam = FAMILIES.get(family)
    if fam is None:
        return bad("isn't a kind of file Flightdeck knows (" + _txt(family) + ")")
    if not isinstance(o, dict):
        return bad("isn't a JSON object")
    major = None
    if o.get("format") is not None:
        m = re.match(r"^([a-z][a-z0-9-]{1,59})/([1-9]\d{0,3})\Z", o["format"]) if isinstance(o["format"], str) else None
        if not m:
            return bad("has a format this copy can't read (\"" + _txt(o["format"]) + "\")")
        if m.group(1) != family:
            if m.group(1) in FAMILY_NAMES:
                return bad("is a " + m.group(1) + " file, not a " + family + " file")
            return {"ok": False, "kind": "newer", "needs": _needs(None, None, None, o)}
        major = int(m.group(2))
    elif fam.get("kinds"):
        if o.get("kind") not in fam["kinds"]:
            return bad("isn't a " + family + " file")
        major = 1
    elif fam["unmarked"]:
        major = 1
    else:
        return bad("has no format")
    features = []
    if o.get("features") is not None:
        f = o["features"]
        if not isinstance(f, list) or len(f) > 32 or not all(isinstance(x, str) and re.match(r"^[a-z][a-z0-9-]{1,39}\Z", x) for x in f):
            return bad("has a \"features\" list this copy can't read")
        features = list(f)
    if major not in fam["majors"]:
        return {"ok": False, "kind": "newer", "needs": _needs(fam, major, features, o)}
    unknown = [x for x in features if x not in fam["majors"][major]]
    if unknown:
        return {"ok": False, "kind": "newer", "needs": _needs(fam, None, unknown, o)}
    return {"ok": True, "major": major}


PLAN2, STATUS2 = "flightdeck-plan/2", "flightdeck-plan-status/2"


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _text_or(v):
    return v is None or isinstance(v, str)


def pin_why(p, hashes):
    """What's wrong with an exact version folder (a plan/2's pin, or a switch's to), or "" (PF.plans pinWhy)."""
    keys = ("folder", "version", "mapHash", "typesHash") if hashes else ("folder", "version")
    if not isinstance(p, dict) or any(k not in keys for k in p):
        return "names a version that isn't a version folder"
    m = re.fullmatch(r"v([0-9]+)-[a-z0-9]+", p["folder"]) if isinstance(p.get("folder"), str) else None
    if not m or not _num(p.get("version")) or float(m.group(1)) != p["version"]:
        return "names a version that isn't a version folder"
    if hashes and not all(isinstance(p.get(k), str) and re.fullmatch(r"[0-9a-f]{8}", p[k]) for k in ("mapHash", "typesHash")):
        return "names a version without its fingerprints"
    return ""


def plan_why(p):
    """What's wrong with a plan in today's format, or "" (PF.plans.planWhy). The app refuses a plan/2 that isn't in it."""
    if not isinstance(p.get("id"), str) or not isinstance(p.get("process"), str):
        return "is a plan without a text id and process"
    if p.get("format") == PLAN2:
        if p.get("version") is not None or p.get("kind") is not None:
            return "is a plan that names a version two ways"
        pw = pin_why(p.get("pin"), True)
        if pw:
            return "is a plan that " + pw
    bad = next((k for k in ("title", "when", "by", "created", "note") if not _text_or(p.get(k))), None)
    if bad:
        return "is a plan whose " + bad + " isn't text"
    v = p.get("version")
    # As JavaScript reads it: 1e400 is Infinity, a whole number there.
    if not (v is None or (isinstance(v, str) and re.fullmatch(r"[1-9][0-9]{0,5}", v)) or (_num(v) and v >= 1 and (v == float("inf") or v == int(v)))):
        return "is a plan whose version isn't a version number"

    def plain(o, ok):
        return o is None or (isinstance(o, dict) and all(ok(x) for x in o.values()))
    if not plain(p.get("details"), lambda x: isinstance(x, str) or (_num(x) and math.isfinite(x))):
        return "is a plan whose details aren't text"
    if not plain(p.get("roles"), lambda x: isinstance(x, str)):
        return "is a plan whose roles aren't people IDs"
    return ""


def status_why(x):
    """What's wrong with a plan decision (PF.plans.statusWhy), or "": the app refuses such a decision, so it decides nothing."""
    if not isinstance(x.get("proposal"), str):
        return "is a plan decision without a plan"
    two = x.get("format") == STATUS2
    if x.get("status") not in ("accepted", "declined") and not (two and x.get("status") == "retargeted"):
        return "is a plan decision that isn't accepted or declined"
    if two and x.get("kind") is not None:
        return "is a plan decision that names its format two ways"
    if x.get("status") == "retargeted":
        tw = pin_why(x.get("to"), False)
        if tw:
            return "is a plan decision that " + tw
    elif x.get("to") is not None:
        return "is a plan decision that names a version without switching to it"
    bad = next((k for k in ("proposalHash", "run", "by", "at") if not _text_or(x.get(k))), None)
    return "is a plan decision whose " + bad + " isn't text" if bad else ""


def held_why(pid, torn, refused):
    """The app's words for a plan held by a decision it can't read (PF.views.planHeldWhy), or "". Matched by file name, as the
    app matches them: <plan id>.status-…, whatever a refused file says it is (a refused plan file isn't named so and holds
    nothing); a newer Flightdeck's file is named first, then one not in its format."""
    mine = lambda n: n.startswith(pid + ".status-")
    h = [(n, k, needs) for n, k, needs in refused if mine(n)]
    x = next((u for u in h if u[1] == "newer"), None) or next((u for u in h if u[1] == "malformed"), None) or next(((n, "unreadable", "") for n in torn if mine(n)), None)
    if not x:
        return ""
    path, held = "proposals/" + x[0], " Until then this plan can't be started, declined or switched here."
    if x[1] == "newer":
        return "A decision on this plan (" + path + ") was made with a newer Flightdeck, so it isn't known here whether it was started. " + ("Needs Flightdeck " + x[2] + "." if x[2] else "Needs a newer Flightdeck.") + " Update Flightdeck to see it." + held
    if x[1] == "malformed":
        return "A decision on this plan (" + path + ") isn't one this copy can read, so it isn't known whether it was started. Fix or delete that file." + held
    return "A decision on this plan (" + path + ") can't be read, so it isn't known whether someone already started it. It may still be arriving; if it stays this way, restore it from a backup or delete it." + held


def plan_family(o):
    """Which of the two a file in proposals/ is (PF.plans.familyOf): its format's family, else its kind."""
    f = o.get("format")
    m = re.match(r"^([a-z][a-z0-9-]{1,59})/([1-9]\d{0,3})\Z", f) if isinstance(f, str) else None
    if m and m.group(1) in ("flightdeck-plan", "flightdeck-plan-status"):
        return m.group(1)
    if o.get("kind") == "status":
        return "flightdeck-plan-status"
    if o.get("kind") == "plan":
        return "flightdeck-plan"
    return ""


def newer_why(info, needs):
    """The app's words for a version a newer Flightdeck wrote (PF.publish.newerOf)."""
    if not needs:
        return NEWER
    v = info.get("version")
    label = "v" + js_number(js_num(v)) if js_num(v) is not None else "This version"
    return label + " needs Flightdeck " + needs + ". This copy shows it but won't run it. Open the team folder's own flightdeck.html."


PUBLICATION_FORMAT2 = "preflight-publication/2"
HEX64 = re.compile(r"^[0-9a-f]{64}\Z")


def sha(data):
    return hashlib.sha256(data).hexdigest()


HASH8 = re.compile(r"^[0-9a-f]{8}\Z")
PIN_STEP = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}\Z", re.I)


def child_pin_ok(p):
    """PF.pins.childOk: { process, version, folder, mapHash, typesHash }, the folder numbered as the version."""
    if not isinstance(p, dict) or set(p) - {"process", "version", "folder", "mapHash", "typesHash"}:
        return False
    v, f = p.get("version"), p.get("folder")
    m = re.match(r"^v(\d+)-[a-z0-9]+\Z", f) if isinstance(f, str) else None
    return (isinstance(p.get("process"), str) and bool(re.match(r"^[a-z0-9][a-z0-9-]{0,59}\Z", p["process"])) and _whole(v)
            and 1 <= js_num(v) <= 9007199254740991 and bool(m) and float(m.group(1)) == js_num(v) and isinstance(p.get("mapHash"), str) and bool(HASH8.match(p["mapHash"]))
            and isinstance(p.get("typesHash"), str) and bool(HASH8.match(p["typesHash"])))


def skill_pin_ok(p):
    if not isinstance(p, dict) or set(p) - {"name", "version"}:
        return False
    n, v = p.get("name"), p.get("version")
    return isinstance(n, str) and 1 <= len(n) <= 80 and n.strip() == n and not re.search(r"[\x00-\x1f]", n) and isinstance(v, str) and bool(re.match(r"^\S{1,40}\Z", v))


def pins_ok(pins):
    """PF.pins.shapeOk: { children: { <step>: pin }, skills: { <step>: { name, version } } }."""
    if not isinstance(pins, dict) or set(pins) - {"children", "skills"}:
        return False
    c, k = pins.get("children", {}), pins.get("skills", {})
    if not isinstance(c, dict) or not isinstance(k, dict):
        return False
    return all(PIN_STEP.match(s) and child_pin_ok(p) for s, p in c.items()) and all(PIN_STEP.match(s) and skill_pin_ok(p) for s, p in k.items())


def pins_problem(info, parsed):
    """PF.publish's pinsProblem: a /2 version's pins must be exactly what its version: and skillVersion: lines say."""
    pins = info["payload"]["pins"]
    want, have = {"children": {}, "skills": {}}, {"children": {}, "skills": {}}
    for st in parsed["steps"]:
        f = st["fields"]
        if st["type"] == "run.process" and "version" in f:
            want["children"][st["id"]] = {"process": f.get("process"), "version": _jsint(f["version"].strip()) if re.match(r"^\d+$", f["version"].strip()) else f["version"]}
        if st["type"] == "run.skill" and "skillVersion" in f:
            want["skills"][st["id"]] = {"name": (f.get("skill") or "").strip(), "version": f["skillVersion"].strip()}
    for k, p in pins.get("children", {}).items():
        have["children"][k] = {"process": p.get("process"), "version": p.get("version")}
    for k, p in pins.get("skills", {}).items():
        have["skills"][k] = p
    return "" if have == want else "Its pins don't match its checklist. Edited by hand."


def payload_ok(info):
    """Whether a /2 version's payload is one this copy checks (PF.publish: no extensions yet)."""
    p = info.get("payload")
    if not isinstance(p, dict) or set(p.keys()) - {"map", "types", "images", "extensions", "pins"}:
        return False
    if not all(isinstance(p.get(k), dict) for k in ("images", "extensions", "pins")):
        return False
    if not all(isinstance(p.get(k), str) and HEX64.match(p[k]) for k in ("map", "types")):
        return False
    if not all(isinstance(v, str) and HEX64.match(v) for v in p["images"].values()) or p["extensions"]:
        return False
    return pins_ok(p["pins"])


def payload_needs(info):
    a = _semver(info.get("app"))
    return "%d.%d" % (a[0], a[1]) if a and a[0] >= 2 else "2.0"


def check_publication(folder, name):
    files = {n: read_text(os.path.join(folder, n)) for n in ("map.md", "types.json", "publication.json")}
    if files["publication.json"] is None:
        return "syncing", "publication.json hasn't arrived", None
    try:
        info = json.loads(files["publication.json"], parse_constant=_no_constant)
    except ValueError:
        return "damaged", "publication.json is unreadable", None
    if not isinstance(info, dict):
        return "damaged", "publication.json isn't a publication record", None
    two = info.get("format") == PUBLICATION_FORMAT2
    if info.get("format") != PUBLICATION_FORMAT or info.get("features") is not None:
        v = judge("preflight-publication", info)
        if not v["ok"]:
            return "unusable", newer_why(info, v["needs"]), info
        if two and not payload_ok(info):
            return "unusable", newer_why(info, payload_needs(info)), info
    if files["map.md"] is None or files["types.json"] is None:
        return "syncing", "some files haven't arrived", info
    if text_hash(files["map.md"]) != info.get("mapHash") or text_hash(files["types.json"]) != info.get("typesHash"):
        return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    if two:
        p = info["payload"]
        if sorted((info.get("images") or {}).keys()) != sorted(p["images"].keys()):
            return "unusable", "Its screenshots don't match its payload. Edited by hand.", info
        # The payload is over the exact bytes on disk, before any byte-order mark is dropped.
        if sha(read_bytes(os.path.join(folder, "map.md"))) != p["map"] or sha(read_bytes(os.path.join(folder, "types.json"))) != p["types"]:
            return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    # A staged version (2.1) lives under staged/ and only test runs use it: never a version here (PF.publish.verify).
    if isinstance(info.get("features"), list) and "staged" in info["features"]:
        return "unusable", "It's a staged version, which only test runs use. Edited by hand: a stage belongs under staged/.", info
    m = re.match(r"^v(\d+)-[a-z0-9]+\Z", name)
    if info.get("folder") != name or not m or int(m.group(1)) != info.get("version"):
        return "damaged", "folder name doesn't match the publication record", info
    try:
        types = json.loads(files["types.json"], parse_constant=_no_constant)
    except ValueError:
        return "damaged", "types.json is unreadable", info
    if not isinstance(types, dict):
        return "damaged", "types.json doesn't hold step types", info
    try:
        why = unrunnable(files["map.md"], types)
    except (TypeError, AttributeError, KeyError, ValueError):
        # A hand-written types.json can hold anything; the app reports a type it can't read rather than failing.
        why = NEWER + " A step type in it can't be read."
    if why:
        return "unusable", why, info
    # What a version uses must be what its record lists: a /1 version holds no 2.0 feature (PF.publish.verify).
    listed2 = info.get("features") if two and isinstance(info.get("features"), list) else []
    unlisted2 = [f for f in features(parse_map(files["map.md"]), types) if f not in listed2]
    if unlisted2:
        return "unusable", "It uses %s, which its publication record doesn't list. Edited by hand." % ", ".join(unlisted2), info
    if two:
        bad = pins_problem(info, parse_map(files["map.md"]))
        if bad:
            return "unusable", bad, info
    listed = info.get("images") if isinstance(info.get("images"), dict) else {}
    unlisted = [src for src in shot_sources(parse_map(files["map.md"])) if src not in listed]
    if unlisted:
        return "unusable", "A screenshot it shows isn't in its publication record (%s). Edited by hand." % unlisted[0], info
    for src, want in (info.get("images") or {}).items():
        path = os.path.join(folder, *src.split("/"))
        if not os.path.isfile(path):
            return "syncing", "screenshot %s hasn't arrived" % src, info
        with open(path, "rb") as f:
            data = f.read()
            if fnv(data) != want or (two and sha(data) != info["payload"]["images"].get(src)):
                return "damaged", "screenshot %s doesn't match its record" % src, info
    return "complete", "", info


# Skills: the one verdict for a skill name (PF.skills.resolve), ported. test/skills-parity.test.js runs a generated matrix of
# legacy files and revisions through the app, flightdeck skill register and this checker, and fails on any difference.
REG_PATH = re.compile(r"^skill-registrations/([^/]+)/(sk-[a-z0-9]{8})\.([1-9]\d{0,5})\.([A-Za-z0-9_-]{1,40})\.json\Z")
STEP_ID = re.compile(r"^[A-Za-z0-9_-]{1,60}\Z")
SKILL_BLOCKS = ["legacy-unreadable", "legacy-refused", "name-mismatch", "revision-refused", "revisions-unlisted", "review"]
MAX_SKILLS = 500


def _str(v, n):
    return v.strip()[:n] if isinstance(v, str) else ""


def js_num(v):
    """A JSON number as JavaScript holds it (a finite double), or None: not a number, a bool, NaN, or out of range."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    try:
        f = float(v)
    except OverflowError:
        return None
    return f if math.isfinite(f) else None


def _whole(v):
    f = js_num(v)
    return f is not None and f.is_integer()


def _newer_text(v):
    return "made with a newer Flightdeck. " + ("Needs Flightdeck " + v["needs"] + "." if v["needs"] else "Needs a newer Flightdeck.")


def check_registration(rel, o, digest):
    """PF.skills.checkV2: {"name", "id", "rev", "sha"} or {"why"}."""
    if not isinstance(o, dict):
        return {"why": "must be a JSON object"}
    v = judge("flightdeck-skill", o)
    if not v["ok"]:
        return {"why": _newer_text(v) if v["kind"] == "newer" else "isn't a skill registration this copy reads"}
    if v["major"] != 2:
        return {"why": "isn't a Flightdeck 2.0 registration (format flightdeck-skill/2). Register skills with flightdeck skill register."}
    m, name, imp, errors, mismatch = REG_PATH.match(rel), _str(o.get("name"), 80), o.get("implements"), [], False
    if not m:
        errors.append("its file name isn't skill-registrations/<name>/<id>.<rev>.<window>.json")
    else:
        if m.group(1) != name:
            errors.append("it's in the folder for " + m.group(1))
            mismatch = True
        if m.group(2) != o.get("id") or not _whole(o.get("rev")) or int(m.group(3)) != o.get("rev"):
            errors.append("its file name doesn't say its id and revision")
            mismatch = mismatch or m.group(2) != o.get("id")
    if not name:
        errors.append('needs a "name"')
    if not isinstance(o.get("id"), str) or not re.match(r"^sk-[a-z0-9]{8}\Z", o["id"]):
        errors.append('"id" must be sk- and 8 letters or numbers')
    rev, seen = o.get("rev"), o.get("seen")
    if not _whole(rev) or rev < 1 or rev > 999999:
        errors.append('"rev" must be a revision number from 1')
    if not (seen is None or (_whole(seen) and seen >= 1 and _whole(rev) and seen < rev)):
        errors.append('"seen" must be the revision it replaced, or null')
    pin = None
    if isinstance(imp, dict) and not set(imp) - {"process", "folder", "mapHash", "typesHash"} and isinstance(imp.get("folder"), str):
        n = re.match(r"^v(\d+)-", imp["folder"])
        pin = dict(imp, version=_jsint(n.group(1))) if n else None
    if not pin or not child_pin_ok(pin):
        errors.append('"implements" must name the exact version: { process, folder, mapHash, typesHash }')
    st = o.get("steps")
    if st is not None:
        ok = isinstance(st, list) and all(isinstance(x, str) for x in st)
        steps = [x.strip() for x in st if isinstance(x, str) and x.strip()] if isinstance(st, list) else []
        if not ok or not steps or len(steps) != len(st) or len(steps) > 200 or not all(STEP_ID.match(x) for x in steps):
            errors.append('"steps" must be a list of step IDs, or left out for the whole process')
    if errors:
        out = {"why": "; ".join(errors)}
        if mismatch:
            out["mismatch"] = True
            if name:
                out["named"] = name
        return out
    return {"name": name, "id": o["id"], "rev": int(rev), "sha": digest}


def check_legacy(o, file):
    """PF.skills.check, as far as matching goes: {"tombstone"}, {"ok", "name"} or {"why"}."""
    if not isinstance(o, dict):
        return {"why": "must be a JSON object"}
    v = judge("flightdeck-skill", o)
    if not v["ok"]:
        return {"why": _newer_text(v) if v["kind"] == "newer" else "isn't a skill file this copy reads"}
    if v["major"] == 2:
        return {"why": "A Flightdeck 2.0 registration belongs in skill-registrations/. Register it with flightdeck skill register."}
    if o.get("implements") == "moved":
        return {"tombstone": True, "name": _str(o.get("name"), 80)}
    name, errors = _str(o.get("name"), 80), []
    if not name:
        errors.append('needs a "name"')
    if not re.match(r"^([a-z0-9][a-z0-9-]*)@v?(\d+)\Z", _str(o.get("implements"), 80), re.I):
        errors.append('"implements" must be <process>@<version>, like release@4')
    st = o.get("steps")
    if st is not None:
        lst = [x for x in st if isinstance(x, str)] if isinstance(st, list) else st.split(",") if isinstance(st, str) else []
        steps = [x.strip() for x in lst if x.strip()]
        if (not isinstance(st, (list, str))) or (isinstance(st, list) and len(lst) != len(st)) or not steps or not all(STEP_ID.match(x) for x in steps):
            errors.append('"steps" must be a list of step IDs, or left out for the whole process')
        if len(steps) > 200:
            errors.append('"steps" lists more than 200 steps')
    if errors:
        return {"why": "; ".join(errors), "name": name or file[:-5]}
    return {"ok": True, "name": name or file[:-5]}


def _legacy_file(x):
    """The name a legacy file's file name says (skills/<name>.json), or "" for a stand-in."""
    if x.get("unlisted"):
        return ""
    f = x.get("file") or ""
    f = f[len("skills/"):] if f.startswith("skills/") else f
    return f[:-5] if f.lower().endswith(".json") else f


def _legacy_recorded(x):
    """The name a readable legacy file or pointer records, or ""."""
    return (x.get("name") or "") if (x.get("tombstone") or x.get("ok")) else ""


def resolve_skill(name, legacy, revs):
    """PF.skills.resolve: the one verdict for a skill name."""
    kinds, reasons = [], []

    def add(k, why):
        if k not in kinds:
            kinds.append(k)
        reasons.append(why)
    valid = [r for r in revs if "why" not in r]
    unl = [r for r in revs if "why" in r and r.get("unlisted")]
    mis = [r for r in revs if "why" in r and not r.get("unlisted") and r.get("mismatch")]
    bad = [r for r in revs if "why" in r and not r.get("unlisted") and not r.get("mismatch")]
    misnamed = [x for x in legacy if _legacy_recorded(x) and _legacy_file(x) and _legacy_recorded(x) != _legacy_file(x) and _legacy_recorded(x) != name]
    for x in misnamed:
        add("name-mismatch", "skills/" + _legacy_file(x) + ".json records the skill " + _legacy_recorded(x) + ", not " + _legacy_file(x) + ".")
    if mis:
        add("name-mismatch", "A revision filed for " + name + " doesn't say the name or id its file says: " + "; ".join(r["file"] + ": " + r["why"] for r in mis) + ".")
    tombs = [x for x in legacy if x.get("tombstone") and x not in misnamed]
    lok = [x for x in legacy if x.get("ok") and x not in misnamed]
    for x in legacy:
        if not x.get("tombstone") and not x.get("ok"):
            add("legacy-unreadable" if x.get("unreadable") else "legacy-refused", x["file"] + ": " + x["why"])
    if unl:
        add("revisions-unlisted", "Not every revision of " + name + " could be listed: " + "; ".join(r["why"] for r in unl) + " Until they all list, no revision of it, and no legacy file, is current.")
    if bad:
        add("revision-refused", "A revision of " + name + " can't be read here: " + "; ".join(r["file"] + ": " + r["why"] for r in bad) + ". Resolve it first; until then no revision is current.")
    top = None
    if valid:
        hi = max(r["rev"] for r in valid)
        at = sorted((r for r in valid if r["rev"] == hi), key=lambda r: r["file"])
        top = at[0]
        if len({r["sha"] for r in at}) > 1:
            add("review", "Needs review: two registrations of " + name + " at revision " + str(hi) + ".")
    if valid and lok:
        add("two", "Two registrations for " + name + "; keep one.")
    if not valid and tombs:
        add("arriving", name + " moved to skill-registrations/" + name + "/, and its registration is still arriving. Can't be matched yet.")
    status = "absent" if not legacy and not revs else "unmatched" if kinds else "current"
    source = None if status != "current" else "registration" if top else "legacy"
    return {"name": name, "status": status, "source": source, "rev": top["rev"] if source == "registration" else None,
            "kinds": kinds, "blocks": any(k in SKILL_BLOCKS for k in kinds), "why": " ".join(reasons), "file": top["file"] if top else None}


def _read_json(path):
    """(object, None), or (None, why) for a file that can't be read or isn't JSON; unreadable says which."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError:
        return None, "couldn't be read", True, b""
    try:
        return json.loads(data.decode("utf-8"), parse_constant=_no_constant), None, False, data
    except (UnicodeDecodeError, ValueError):
        return None, "isn't valid JSON", False, data


def _list(path):
    """(names, None), ([], None) for a folder that isn't there, or ([], why) for one that can't be listed: never empty."""
    # os.path.lexists says False for a folder it couldn't stat too (EIO, EACCES); only "no such file" is absent.
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return [], None
    except OSError as e:
        return [], "couldn't be read (" + (e.strerror or str(e)) + ")."
    if stat.S_ISLNK(st.st_mode):
        return [], "is a link, which Flightdeck doesn't follow."
    try:
        return sorted(os.listdir(path)), None
    except OSError as e:
        return [], "couldn't be listed (" + (e.strerror or str(e)) + ")."


def _kind(path):
    """("link" | "dir" | "file" | "other" | "missing", None), or (None, why) when it can't be told: never taken for missing."""
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return "missing", None
    except OSError as e:
        return None, "couldn't be read (" + (e.strerror or str(e)) + ")."
    if stat.S_ISLNK(st.st_mode):
        return "link", None
    return ("dir" if stat.S_ISDIR(st.st_mode) else "file" if stat.S_ISREG(st.st_mode) else "other"), None


def skill_registrations(root):
    """Every skill name in skills/ and skill-registrations/, through resolve_skill, as the app matches them. What a listing
    can't show (a folder that can't be listed, a link, files past the first 500) holds the names it would name (PF.skills.held)."""
    legacy, revs, names = {}, {}, []

    def slot(n):
        if n not in names:
            names.append(n)
    sdir = os.path.join(root, "skills")
    found, legacy_unlisted = _list(sdir)
    if legacy_unlisted:
        legacy_unlisted = "skills/ " + legacy_unlisted
    kinds = {f: _kind(os.path.join(sdir, f)) for f in found if f.lower().endswith(".json")}
    # A file that can't be told from a folder is read as one that couldn't be read, never left out.
    files = [f for f in found if f in kinds and (kinds[f][1] or kinds[f][0] == "file" or (kinds[f][0] == "link" and os.path.isfile(os.path.join(sdir, f))))]
    dropped = files[MAX_SKILLS:]
    for f in files[:MAX_SKILLS]:
        o, why, unreadable, _ = (None, kinds[f][1], True, b"") if kinds[f][1] else _read_json(os.path.join(sdir, f))
        x = {"why": why, "unreadable": unreadable} if why else check_legacy(o, f)
        x["file"] = "skills/" + f
        # A file speaks for the name it records and the one its file name says (PF.skills.legacyFor).
        for n in dict.fromkeys([x.get("name") or f[:-5], f[:-5]]):
            legacy.setdefault(n, []).append(x)
            slot(n)
    rdir = os.path.join(root, "skill-registrations")
    marks, paths = {}, []

    def mark(n, why):
        marks.setdefault(n, []).append({"why": why, "unlisted": True, "file": "skill-registrations/" + n + "/"})
    found, regs_unlisted = _list(rdir)
    if regs_unlisted:
        regs_unlisted = "skill-registrations/ " + regs_unlisted
    for name in found:
        ndir = os.path.join(rdir, name)
        kind, why = _kind(ndir)
        if why:
            mark(name, "skill-registrations/" + name + " " + why)
            continue
        if kind == "link":
            mark(name, "skill-registrations/" + name + " is a link, which Flightdeck doesn't follow.")
            continue
        if kind != "dir":
            continue
        inside, why = _list(ndir)
        if why:
            mark(name, "skill-registrations/" + name + "/ " + why)
        for f in inside:
            if not f.lower().endswith(".json"):
                continue
            kind, why = _kind(os.path.join(ndir, f))
            if why:
                mark(name, "skill-registrations/" + name + "/" + f + " " + why)
            elif kind == "link":
                mark(name, "skill-registrations/" + name + "/" + f + " is a link, which Flightdeck doesn't follow.")
            elif kind == "file":
                paths.append("skill-registrations/" + name + "/" + f)
    paths.sort()
    for rel in paths[MAX_SKILLS:]:
        n = rel.split("/")[1]
        if not any(m["why"].endswith("a copy reads.") for m in marks.get(n, [])):
            mark(n, "skill-registrations/" + n + "/ has files past the %d registrations a copy reads." % MAX_SKILLS)
    for rel in paths[:MAX_SKILLS]:
        name = rel.split("/")[1]
        o, why, _, data = _read_json(os.path.join(root, *rel.split("/")))
        got = {"why": why} if why else check_registration(rel, o, sha(data))
        got["file"] = rel
        for n in dict.fromkeys(x for x in [got.get("name") or name, name, got.get("named")] if x):
            revs.setdefault(n, []).append(got)
            slot(n)
    for n, ms in marks.items():
        revs.setdefault(n, []).extend(ms)
        slot(n)
    for f in dropped:
        slot(f[:-5])
    out = []
    for n in names:
        L, V = list(legacy.get(n, [])), list(revs.get(n, []))
        if legacy_unlisted:
            L.append({"why": legacy_unlisted, "unreadable": True, "file": n + ".json"})
        elif n + ".json" in dropped:
            L.append({"why": "skills/" + n + ".json wasn't read: skills/ holds more files than a copy reads", "unreadable": True, "file": n + ".json"})
        if regs_unlisted:
            V.append({"why": regs_unlisted, "unlisted": True, "file": "skill-registrations/" + n + "/"})
        out.append(resolve_skill(n, L, V))
    # A folder that couldn't be listed is named on its own, as the app does, so a folder with no names it can see is never
    # read as one with no skills.
    for folder, why, kind in (("skills/", legacy_unlisted, "legacy-unreadable"), ("skill-registrations/", regs_unlisted, "revisions-unlisted")):
        if why:
            out.append({"name": None, "status": "unmatched", "source": None, "rev": None, "kinds": [kind], "blocks": True, "why": why, "file": folder})
    return out


TEAM_FILE, TEAM_MAX, TEAM_VALUES_MAX, TEAM_VALUE_MAX, TEAM_ABOUT_MAX = "team-values.json", 262144, 100, 120, 80


def _team_value_problem(v, what):
    """PF.teamValues.valueProblem."""
    if not isinstance(v, str):
        return what + " isn't text."
    if not v:
        return what + " is empty."
    if re.search(r"[\x00-\x1f\x7f]", v):
        return what + " has a control character."
    if v != js_trim(v):
        return what + " has spaces at the start or end."
    if js_len(v) > TEAM_VALUE_MAX:
        return what + " can be at most %d characters." % TEAM_VALUE_MAX
    return ""


def team_values(root):
    """PF.teamValues.parse of team-values.json (2.9), read as repo.readTeamValues reads it: {"state": "missing" | "unreadable" |
    "malformed" | "newer" | "ok", "why", "names"}."""
    path = os.path.join(root, TEAM_FILE)
    if not os.path.lexists(path):
        return {"state": "missing", "why": "", "names": []}
    try:
        if os.path.getsize(path) > TEAM_MAX:
            return {"state": "unreadable", "why": TEAM_FILE + " is larger than %d bytes." % TEAM_MAX, "names": []}
        with open(path, "rb") as f:
            raw = f.read(TEAM_MAX + 1)
        # The file may have grown since its size was read: more than TEAM_MAX bytes is never read as a shorter file.
        if len(raw) > TEAM_MAX:
            return {"state": "unreadable", "why": TEAM_FILE + " is larger than %d bytes." % TEAM_MAX, "names": []}
        text = raw.decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return {"state": "unreadable", "why": TEAM_FILE + " couldn't be read.", "names": []}
    def bad(why):
        return {"state": "malformed", "why": why, "names": []}
    try:
        o = json.loads(text, parse_constant=_no_constant)
    except ValueError:
        return bad(TEAM_FILE + " isn't valid JSON.")
    j = judge("flightdeck-team-values", o)
    if not j["ok"] and j["kind"] != "newer":
        return bad(TEAM_FILE + " " + re.sub(r"\.?$", ".", j["why"], count=1))
    if not j["ok"]:
        # PF.envelope.judge's words for a newer file: another family, a newer major, or features this copy doesn't know.
        needs = j.get("needs") or ""
        m = re.match(r"^([a-z][a-z0-9-]{1,59})/([1-9]\d{0,3})\Z", o["format"]) if isinstance(o.get("format"), str) else None
        if m and m.group(1) != "flightdeck-team-values":
            what = "is a " + m.group(1) + " file, which this copy doesn't know."
        elif m and int(m.group(2)) not in FAMILIES["flightdeck-team-values"]["majors"]:
            what = "was made with a newer Flightdeck (" + o["format"] + ")."
        else:
            what = "uses " + ", ".join([x for x in o.get("features") or [] if x not in FAMILIES["flightdeck-team-values"]["majors"][1]][:5]) + ", which this copy doesn't understand."
        return {"state": "newer", "why": TEAM_FILE + " " + what + " " + ("Needs Flightdeck " + needs + "." if needs else "Needs a newer Flightdeck."), "needs": needs, "names": []}
    values = o.get("values")
    if not isinstance(values, dict):
        return bad(TEAM_FILE + ": Its \"values\" isn't a list of named values.")
    if len(values) > TEAM_VALUES_MAX:
        return bad(TEAM_FILE + ": It can hold at most %d team values." % TEAM_VALUES_MAX)
    inner = ""
    for n, e in values.items():
        if n in JS_PROTO:
            return bad(TEAM_FILE + ": \"%s\" is a name Flightdeck keeps for itself." % n)
        if not TEAM_NAME.match(n):
            return bad(TEAM_FILE + ": \"%s\" isn't a team value name (lowercase letters, digits and -, at most 40)." % n)
        if not isinstance(e, dict):
            return bad(TEAM_FILE + ": \"%s\" isn't a value with its text." % n)
        extra = [k for k in e if k not in ("value", "about")]
        if extra and not inner:
            inner = "\"%s\" has \"%s\"" % (n, extra[0])
        pr = _team_value_problem(e.get("value"), "\"%s\"" % n)
        if pr:
            return bad(TEAM_FILE + ": " + pr)
        ab = e.get("about")
        if ab is not None and (not isinstance(ab, str) or re.search(r"[\x00-\x1f\x7f]", ab)):
            return bad(TEAM_FILE + ": What \"%s\" is for isn't plain text." % n)
        if ab is not None and js_len(ab) > TEAM_ABOUT_MAX:
            return bad(TEAM_FILE + ": What \"%s\" is for can be at most %d characters." % (n, TEAM_ABOUT_MAX))
    out = {"state": "ok", "why": "", "names": sorted(values)}
    # Keys this copy doesn't know, at the top or in a value: the values are used, but Settings can't change the file.
    top = [k for k in o if k not in ("format", "features", "app", "values")]
    if top:
        out["readOnly"] = TEAM_FILE + " has \"%s\", which this copy doesn't know, so it can't be changed here." % top[0]
    elif inner:
        out["readOnly"] = TEAM_FILE + ": " + inner + ", which this copy doesn't know, so it can't be changed here."
    return out


def team_missing(root, publications, tv):
    """PF.health's team-missing: each current version's linked step that passes a team value team-values.json doesn't have."""
    out = []
    if tv["state"] not in ("ok", "missing"):
        return out
    for proc, p in sorted(publications.items()):
        if not p["current"]:
            continue
        md = read_text(os.path.join(root, "publications", proc, p["current"], "map.md"))
        for s in parse_map(md)["steps"] if md else []:
            if s["type"] == "run.process" and "pass" in s["fields"]:
                gone = [n for n in pass_teams(s["fields"]["pass"]) if n not in tv["names"]]
                if gone:
                    out.append({"process": proc, "step": s.get("id"), "names": gone})
    return out


def team_files(root):
    """Basic checks of step-types/ and jira/workflows.json. Flightdeck's process page shows its full verdict."""
    problems, types = [], []
    sdir = os.path.join(root, "step-types")
    for name in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(sdir, name), encoding="utf-8") as f:
                d = json.load(f, parse_constant=_no_constant)
        except (OSError, ValueError):
            problems.append({"file": "step-types/" + name, "problem": "isn't valid JSON"})
            continue
        if isinstance(d, dict) and (d.get("format") is not None or d.get("features") is not None):
            v = judge("flightdeck-step-type", d)
            if not v["ok"] and v["kind"] == "newer":
                problems.append({"file": "step-types/" + name, "problem": "This step type needs " + ("Flightdeck " + v["needs"] if v["needs"] else "a newer Flightdeck") + ". This copy shows it but can't use or change it."})
                continue
        if not isinstance(d, dict) or d.get("id") is None or name != str(d.get("id")) + ".json":
            problems.append({"file": "step-types/" + name, "problem": "the file name must be <id>.json"})
        else:
            types.append(d["id"])
    workflows = None
    wf = os.path.join(root, "jira", "workflows.json")
    if os.path.isfile(wf):
        try:
            with open(wf, encoding="utf-8") as f:
                w = json.load(f, parse_constant=_no_constant)
            workflows = sorted(w) if isinstance(w, dict) else []
            for t, v in (w.items() if isinstance(w, dict) else []):
                if not isinstance(v, dict) or not isinstance(v.get("statuses"), list) or not v["statuses"]:
                    problems.append({"file": "jira/workflows.json", "problem": t + ": needs \"statuses\""})
        except (OSError, ValueError):
            problems.append({"file": "jira/workflows.json", "problem": "isn't valid JSON"})
    return {"stepTypes": types, "jiraIssueTypes": workflows, "problems": problems}


# 3.0: design tips (PF.library.lints), the ones that need no other checklist, in the same order and words. Advice only.
_NAME = r"[A-Za-z0-9_-]"
# JavaScript's \s and . (JS_S, JS_DOT), never Python's: re.A alone would leave out a no-break space.
_READINESS = re.compile(r"\b(ready|readiness|no (?:open )?\w+|none|blockers?|blocking|clear|all\b.*\b(?:done|closed|merged|resolved)|green|passes|safe)\b".replace(".", JS_DOT, 1), re.I | re.A)
_WHOLE_SET = re.compile(r"\b(?:each|every)\s+[a-z]|\ball\s+(?:of\s+)?(?:the\s+)?(?:[a-z-]+\s+){0,2}[a-z-]+s\b".replace(r"\s", JS_S), re.I | re.A)
_VERDICT = re.compile(r"\bNOT READY\b|\bREADY\b|\bgo\s*/\s*no[- ]go\b|\bgo or no[- ]go\b".replace(r"\s", JS_S), re.A)
_APPROVAL = re.compile(r"\b(?:approve|approves|approved|approval|verdict|sign[- ]?off|signs? off)\b", re.I | re.A)
# Types where approving or signing off is the work itself, so the wording is no sign of a misplaced verdict.
_APPROVES_BY_TYPE = ("review", "decide", "github.pr", "bitbucket.pr")
# The built-in types' choice and yes/no record fields: required (require: names it, or all), a run records which way it went.
_VERDICT_RECORDS = {"decide": ("decision",), "review": ("verdict",), "verify.health": ("result",), "github.pr": ("checks",)}


def _records_verdict(s):
    req = [x.strip() for x in (s["fields"].get("require") or "").split(",") if x.strip()]
    if (s["fields"].get("evidence") or "").lower() == "yes-no":
        return True
    return any("all" in req or n in req for n in _VERDICT_RECORDS.get(s["type"], ()))


def _quoted(rx, text):
    m = rx.search(text)
    return m.group(0) if m else ""


def _words(v):
    return [x for x in re.split(r"[,\s]+", js_str(v) if v is not None else "") if x]


def design_tips(md):
    """PF.library.lints(md) without a library: each tip's id, at, ref and text, as flightdeck draft check's design.tips."""
    parsed, out = parse_map(md), []
    text = md.replace("\r\n", "\n").replace("\r", "\n")
    fm = re.match(r"^---\n[\s\S]*?\n---[ \t]*(?:\n|$)", text)
    text = text[fm.end():] if fm else text

    def add(i, at, ref, t):
        out.append({"id": i, "at": at, "ref": ref, "text": t})
    for s in parsed["steps"]:
        f, label = s["fields"], step_label(s)
        if s["type"] == "jira.search" and "results" in f:
            rule = parse_results(f["results"])[0]
            what = s["text"] + " " + (f.get("what") or "")
            if rule is not None and rule["op"] == "any" and _READINESS.search(what):
                add("results-any", "step", s["id"], label + ' has results: any, so it passes whatever the search finds, yet it reads like a readiness check ("' + _quoted(_READINESS, what) + '"). Say what must be true, like results: none or results: at least 1, or word it as collecting facts.')
        if (s["type"] == "confirm" or not s["type"]) and _WHOLE_SET.search(s["text"]):
            add("whole-set", "step", s["id"], label + ' confirms a whole set at once ("' + _quoted(_WHOLE_SET, s["text"]) + '…"). One check can\'t show which items were looked at. Give each item its own result: one step per item, or a list with one line per item in a note or report. Flightdeck can\'t repeat a step for each item yet.')
        if s["type"] != "decide" and not _records_verdict(s):
            v = _quoted(_VERDICT, s["text"]) or (_quoted(_APPROVAL, s["text"]) if s["type"] not in _APPROVES_BY_TYPE else "")
            if v:
                add("verdict", "step", s["id"], label + ' reads like a verdict ("' + v + '"), but as a {' + (s["type"] or "step") + '} step a run records only that it was checked, not which way it went. Make it a {decide} step with the choices, or a named gate when a person approves it.')
    used = []
    for pi, p in enumerate(parsed["phases"]):
        for r in [r for s in parsed["steps"] if s["phase"] == pi for r in s["roles"]] + [r for t in p.get("tracks", []) for r in t["roles"]] + [(p["gate"] or {}).get("owner")]:
            if r and r not in used:
                used.append(r)
    if parsed["runs"] == "solo" and len(used) > 1:
        add("solo-roles", "checklist", None, "This checklist says runs: solo, but its steps and gates use %d roles (%s). If more than one person does the work, take out runs: solo. A solo run that hands a report to someone is fine." % (len(used), ", ".join("@" + r for r in used)))
    for r in parsed["roles"]:
        if r not in used and not re.search("@" + re.escape(r) + "(?!" + _NAME + ")", text):
            add("unused-role", "checklist", None, "The role @" + r + " is declared but no step or gate uses it. Use it or take it out of roles.")
    carried, asks_all = set(), False
    for s in parsed["steps"]:
        carried.update(e["name"] for e in sets_of(s["fields"].get("sets", "")))
        if s["type"] == "run.process":
            c = _words(s["fields"].get("carry"))
            asks_all = asks_all or not c
            carried.update(c)
    # A linked step without carry: passes every detail its child also has, so none of them can be called unused.
    if not asks_all:
        for n in parsed["context"]:
            if n not in carried and not re.search(r"\^" + re.escape(n) + "(?!" + _NAME + ")", text):
                add("unused-detail", "checklist", None, "The run detail ^" + n + " is asked for at the start but no step, gate or condition uses it. Use it or take it out of context.")
    return out


DRAFT_RAN = [
    "the checklist format, line by line",
    "each step has a type, built-in or in step-types/",
    "built-in step types' fields, Jira searches included",
    "design tips that need no other checklist",
    "a checklist's result and the steps that set, accept and import results (module results)",
]
DRAFT_NOT_RUN = [
    "IDs, roles and run details declared",
    "team step types' fields",
    "people.json (owner and backup)",
    "Jira workflows (transitions)",
    "team values (the Jira address, team: values)",
    "linked checklists and version: pins, and what a linked step accepts from its checklist's result",
    "screenshots",
    "web links in link fields",
    "design tips that compare with other checklists",
]


def draft_check(md, team_types):
    """Some of the Publish dialog's checks, offline, for an assistant without the flightdeck command. Every blocker here is
    one the app gives in the same words; what it doesn't check is listed, so a clean result is never "ready to publish"."""
    parsed, blockers = parse_map(md), []
    blockers += ["Line %d: %s" % (e["line"], e["msg"]) for e in parsed["errors"]]
    for s in parsed["steps"]:
        label = step_name(s)
        if not s["type"]:
            blockers.append(label + " has no type. Every step needs one, like {confirm} or {ui.action}.")
        elif s["type"] in team_types:
            continue
        elif s["type"] not in BUILTIN:
            blockers.append(label + " has an unknown type {%s}." % s["type"])
        else:
            blockers += [label + " " + m for m in field_errors(dict(BUILTIN[s["type"]], id=s["type"]), s["fields"], parsed["context"])]
    blockers += result_blockers(parsed) + loop_blockers(parsed)
    return {"complete": False, "ran": DRAFT_RAN, "notRun": DRAFT_NOT_RUN, "blockers": blockers, "tips": design_tips(md),
            "note": "Flightdeck checks partly run: only what ran is listed. Run flightdeck draft check, or open the draft in Flightdeck, for the Publish dialog's whole verdict."}


def draft_main(args):
    at = args.index("--draft")
    if at + 1 >= len(args):
        sys.stderr.write("usage: check_folder.py [team-folder] --draft <file>\n")
        return 1
    path, rest = args[at + 1], args[:at] + args[at + 2:]
    root = os.path.abspath(rest[0] if rest else ".")
    try:
        with open(path, encoding="utf-8") as f:
            md = f.read()
    except (OSError, UnicodeDecodeError) as e:
        json.dump({"draft": path, "error": "couldn't be read: %s" % e.__class__.__name__}, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 1
    out = dict({"draft": path, "folder": root}, **draft_check(md, team_files(root)["stepTypes"]))
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


def main():
    if "--draft" in sys.argv[1:]:
        sys.exit(draft_main(sys.argv[1:]))
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    out = {"folder": root, "publications": {}, "plans": [], "conflicts": [], "refused": []}
    pubs_dir = os.path.join(root, "publications")
    for proc in sorted(os.listdir(pubs_dir)) if os.path.isdir(pubs_dir) else []:
        pdir = os.path.join(pubs_dir, proc)
        if not os.path.isdir(pdir):
            continue
        versions = []
        for name in sorted(os.listdir(pdir)):
            if os.path.isdir(os.path.join(pdir, name)) and re.match(r"^v\d+-", name):
                status, why, info = check_publication(os.path.join(pdir, name), name)
                versions.append({"folder": name, "version": info.get("version") if info else None, "status": status, "why": why,
                                 "publishedBy": info.get("publishedBy") if info else None, "publishedAt": info.get("publishedAt") if info else None})
        # Same choice as the app: versions published twice under one number are set aside, and the highest of the rest is current.
        complete = [v for v in versions if v["status"] == "complete"]
        counts = {}
        for v in complete:
            counts[v["version"]] = counts.get(v["version"], 0) + 1
        good = sorted((v for v in complete if counts[v["version"]] == 1), key=lambda v: -v["version"])
        out["publications"][proc] = {
            "versions": versions,
            "current": good[0]["folder"] if good else None,
            "clash": [v["folder"] for v in complete if counts[v["version"]] > 1],
        }

    prop_dir = os.path.join(root, "proposals")
    plans, decisions, torn, refused_decisions = {}, {}, [], []
    for name in sorted(os.listdir(prop_dir)) if os.path.isdir(prop_dir) else []:
        if not name.lower().endswith(".json") or not os.path.isfile(os.path.join(prop_dir, name)):
            continue
        text = read_text(os.path.join(prop_dir, name))
        try:
            # Numbers are read as JavaScript reads them (all doubles), so 9007199254740993 becomes ...992 here too.
            obj = json.loads(text, parse_int=float, parse_constant=_no_constant) if text else None
            parsed = bool(text)
        except ValueError:
            obj, parsed = None, False
        if not parsed:
            # Not complete JSON (it may still be arriving): named, and whether its name says which plan it's for.
            torn.append(name)
        if not isinstance(obj, dict):
            continue
        # The app's one reader of plans and plan decisions (PF.plans.clean): a file from a newer Flightdeck (flightdeck-plan/2,
        # a feature this copy doesn't know) is refused and named, never a plan or a decision; one it can't read is left out.
        fam = plan_family(obj)
        if not fam:
            # One the app reads here (it has a format) that's neither a plan nor a decision is refused and named.
            if isinstance(obj.get("format"), str):
                out["refused"].append({"file": "proposals/" + name, "why": "isn't a file this copy can read here"})
                refused_decisions.append((name, "malformed", ""))
            continue
        v = judge(fam, obj)
        if not v["ok"]:
            what = "plan decision" if fam == "flightdeck-plan-status" else "plan"
            newer = v["kind"] == "newer"
            out["refused"].append({"file": "proposals/" + name, "why": "is a " + what + " made with a newer Flightdeck. " + ("Needs Flightdeck " + v["needs"] + "." if v["needs"] else "Needs a newer Flightdeck.") if newer else v["why"]})
            refused_decisions.append((name, v["kind"], v["needs"] or ""))
            continue
        if fam == "flightdeck-plan":
            # A plan/2 not in its format is refused and named, as the app does, and is never a plan to start. A 1.x plan keeps
            # what every 1.x copy did with it.
            bad = plan_why(obj)
            if bad and obj.get("format") in (PLAN2, STATUS2):
                out["refused"].append({"file": "proposals/" + name, "why": bad})
                refused_decisions.append((name, "malformed", ""))
                continue
            if isinstance(obj.get("id"), str) and isinstance(obj.get("process"), str):
                plain = {k: v for k, v in obj.items() if not k.startswith("_")}
                plans.setdefault(obj["id"], []).append((name, text_hash(js_json(plain)), plain))
        else:
            # A decision not in its format (a switch without its version among them) is refused and named, as the app does,
            # and decides nothing. A plan/2 switched to another version (plan-status/2, retargeted) is a switch, not a decision.
            bad = status_why(obj)
            if bad:
                out["refused"].append({"file": "proposals/" + name, "why": bad})
                refused_decisions.append((name, "malformed", ""))
            elif obj.get("status") != "retargeted":
                decisions.setdefault(obj.get("proposal"), []).append(obj)
    for pid, copies in sorted(plans.items()):
        # OneDrive can keep two files of one plan (written on two computers while disconnected). Copies that say the same
        # thing (apart from when each was written, and which version of the same tool wrote a request) are one plan; copies
        # that differ can't be started until a person deletes one. The file under the plan's own name comes first.
        copies.sort(key=lambda c: (c[0] != pid + ".json", c[0]))
        name = copies[0][0]
        mine = decisions.get(pid, [])
        hashes = {c[1] for c in copies}
        matching = [d for d in mine if d.get("proposalHash") in hashes]
        # Starts and declines are compared across every version of the plan, whatever it said when each was made (2.1.1).
        started = {d.get("run") for d in mine if d.get("status") == "accepted"}
        agree = False
        if not all(same_plan(c[2], copies[0][2]) for c in copies):
            # Each copy is its own plan to the app, and a decision that agrees still holds it, so its missing run is still named.
            status, why = "ambiguous", "different copies of this plan are in the folder (" + ", ".join(c[0] for c in copies) + "); Flightdeck starts neither until a person deletes one"
            agree = bool(mine) and len({d.get("status") for d in mine}) == 1 and len(started) <= 1
        elif not mine:
            status, why = "pending", ""
        elif len({d.get("status") for d in mine}) > 1 or len(started) > 1:
            status, why = "ambiguous", "decisions on this plan disagree (or it was started twice), on this or an earlier version of it; Flightdeck shows it as undecided"
        elif matching:
            status, why, agree = "decided", matching[0].get("status", ""), True
        else:
            status, why, agree = "ambiguous", "the plan changed after it was decided; the decision on its earlier version still holds it, so Flightdeck won't start, decline or switch it again. To run it again, make a new plan", True
        if status == "pending":
            # A decision on it that can't be read (still arriving), or one refused here (a newer Flightdeck's, or not in its
            # format), holds it as the app holds it (PF.views.planHeldWhy): it may have been started.
            held = held_why(pid, torn, refused_decisions)
            if held:
                status, why = "ambiguous", held
        entry = {"file": name, "id": pid, "status": status, "why": why}
        # Started (on this version or an earlier one), and its run isn't in the folder (2.1.1): it stays started, never started
        # again. It may still be syncing; if it never arrives, a new plan runs it again.
        # A decision doesn't record the process: on this exact plan it's the plan's; on an earlier version it may have been
        # another, so the run is looked for under every process, as the app does (PF.health.missingRun).
        run = next(iter(started)) if agree and len(started) == 1 else None
        if isinstance(run, str) and run:
            alike = all(same_plan(c[2], copies[0][2]) for c in copies)
            exact = bool(matching) if alike else any(d.get("proposalHash") == copies[0][1] for d in mine)
            procs = [copies[0][2].get("process")] if exact else (sorted(os.listdir(os.path.join(root, "runs"))) if os.path.isdir(os.path.join(root, "runs")) else [])
            safe = re.match(r"^[a-z0-9-]{1,40}\Z", run, re.I)
            found = safe and any(isinstance(proc, str) and re.match(r"^[a-z0-9][a-z0-9-]*\Z", proc) and os.path.exists(os.path.join(root, "runs", proc, run, "run.json")) for proc in procs)
            if not found:
                entry["runMissing"] = run
        out["plans"].append(entry)
    # Files in proposals/ that aren't complete JSON (2.1.1). unnamed: the name is neither a plan's or request's shape nor starts
    # with a readable plan's ID, so it could be a renamed decision on any plan, and holds none.
    def named(n):
        if PLAN_NAMED.match(n):
            return True
        return any(n.startswith(pid) and n[len(pid):len(pid) + 1] in (".", " ", "-", "(") for pid in plans if isinstance(pid, str) and pid)
    out["unreadablePlans"] = [{"file": "proposals/" + n, "unnamed": not named(n)} for n in torn]

    runs_dir = os.path.join(root, "runs")
    for proc in sorted(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else []:
        pdir = os.path.join(runs_dir, proc)
        for rid in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
            rdir = os.path.join(pdir, rid)
            if os.path.isdir(rdir):
                names = sorted(os.listdir(rdir))
                copies = [n for n in names if re.match(r"^run.*\.json\Z", n, re.I) and n != "run.json"]
                # A save's candidate file that run.json doesn't list was overwritten by another window or computer.
                try:
                    lineage = json.loads(read_text(os.path.join(rdir, "run.json")) or "{}", parse_constant=_no_constant).get("lineage") or []
                except ValueError:
                    lineage = []
                for n in names:
                    m = re.match(r"^candidate-(.+)-([a-z0-9]{8})\.json\Z", n)
                    if m and (m.group(1) + "." + m.group(2)) not in lineage and time.time() - os.path.getmtime(os.path.join(rdir, n)) >= 60:
                        copies.append(n)
                receipts = [n for n in names if n.startswith("candidate-")]
                if copies:
                    out["conflicts"].append({"run": proc + "/" + rid, "copies": copies})
                if len(receipts) > 1:
                    out.setdefault("receipts", []).append({"run": proc + "/" + rid, "count": len(receipts), "note": "Save receipts beyond the newest one are cleaned up by the next save; many here means unresolved conflicts or failed cleanups."})

    out["teamFiles"] = team_files(root)
    # Team values (2.9): a team-values.json the app can't use is named, as are steps that pass a value it doesn't have.
    tv = team_values(root)
    out["teamValues"] = tv
    if tv["state"] not in ("ok", "missing"):
        out["teamFiles"]["problems"].append({"file": TEAM_FILE, "problem": tv["why"]})
    out["teamMissing"] = team_missing(root, out["publications"], tv)
    out["skills"] = skill_registrations(root)
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
