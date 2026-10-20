#!/usr/bin/env python3
"""Check a Flightdeck team folder the way the Flightdeck app does, without changing anything.

    python <skills folder>/_flightdeck/check_folder.py [team-folder]   (default: the current folder)

Prints JSON:
  publications: every version folder per process, with status "complete", "syncing", "damaged" or "unusable" and why,
                which complete version is current, and any version-number clashes. "unusable" means the app can't
                run it: written by a newer Flightdeck, or edited by hand with syntax or step types it doesn't know.
  plans:        each planned run with status "pending", "decided" (accepted/declined) or "ambiguous", and why.
  conflicts:    runs that have competing copies next to run.json.

It uses the same fingerprints as the app (FNV-1a over the text's UTF-16 code units, and over the raw bytes for
screenshots), so "complete" here means the app will accept the version too.
"""
import json
import os
import re
import sys
import time


REQ_ID = re.compile(r"^req-([a-z0-9][a-z0-9-]{0,29})-[0-9a-f]{24}$")
REQ_BY = re.compile(r"^([a-z0-9][a-z0-9-]{0,29}) [A-Za-z0-9_.+-]{1,40} \(a tool\)$")


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
        return js_number(float(v))
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
COMMON = {"link": {"kind": "url"}, "expect": {"kind": "duration"}, "deadline": {"kind": "deadline"}, "evidence": {"kind": "choice", "options": ["link", "note"]},
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
}

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
        return js_number(float(v))
    if isinstance(v, list):
        return ",".join(js_str(x) for x in v)
    if isinstance(v, dict):
        return "[object Object]"
    return str(v)


def take_id(s):
    m = ID_RE.search(s)
    return (m.group(1).lower(), s[:m.start()]) if m else ("", s)


def tokens(s, ch):
    out = []
    rest = re.sub(r"\s*\%s(%s+)" % (ch, r"[A-Za-z0-9_-]"), lambda m: out.append(m.group(1)) or "", s)
    return out, rest.strip()


def parse_map(md):
    lines = md.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    errors, steps = [], []
    i, phase, step, gate, track, questions = 0, None, None, None, None, False

    def err(n, msg):
        errors.append({"line": n + 1, "msg": msg})

    if lines[0] and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            if not re.match(r"^(%s|-)+:\s*(.*)$" % W, lines[i]) and lines[i].strip():
                err(i, "Front matter line isn't \"key: value\".")
            i += 1
        i += 1
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
                track = {"id": take_id(m.group(1))[0]}
            i += 1
            continue
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            step, gate, track = None, None, None
            head = take_id(m.group(1))[1]
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
                        for part in re.split(r"\s+·\s+", g.group(1))[1:]:
                            if not re.match(r"^owner\s+@(%s|-)+$" % W, part.strip(), re.I):
                                err(i, "Gate option not understood: \"%s\"." % part)
                        gate = {"kind": "gate"}
                        phase["gate"] = gate
                else:
                    pm = re.match(r"^(.*?)\s+·\s+(READ-DO|DO-CONFIRM)$", head)
                    phase = {"title": (pm.group(1) if pm else head).strip(), "gate": None}
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
                rest = tokens(tokens(t2, "@")[1], "^")[1]
                step = {"type": typ, "text": rest, "fields": {}}
                steps.append(step)
            i += 1
            continue
        m = re.match(r"^\s{2,}>\s?(.*)$", line)
        if m:
            if not (step or gate):
                err(i, "A note must follow a step or a gate.")
            i += 1
            continue
        m = step and re.match(r"^\s{2,}!\[(.*?)\]\(([^)\s]+)\)\s*$", line)
        if m:
            if not re.match(r"^images/(%s|[./-])+$" % W, m.group(2)) or ".." in m.group(2):
                err(i, "Screenshots must be under images/: \"%s\"." % m.group(2))
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
    return {"errors": errors, "steps": steps, "questions": questions}


def js_list(s):
    return [x.strip() for x in js_str(s).split(",") if x.strip()]


def js_duration(s):
    m = re.match(r"^\s*(?:([0-9]+)h)?\s*(?:([0-9]+)m)?\s*(?:([0-9]+)s)?\s*$", js_str(s), re.I)
    return bool(m and (m.group(1) or m.group(2) or m.group(3)))


def js_concat(o, key):
    """A property as JavaScript's string concatenation writes it, missing ones as "undefined"."""
    if not isinstance(o, dict) or key not in o:
        return "undefined"
    return "null" if o[key] is None else js_str(o[key])


def field_errors(type_def, fields):
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
    return errors


TYPE_KEYS = {"id", "label", "icon", "hint", "fields", "record", "version", "custom", "group", "tags"}
FIELD_KEYS = {"label", "kind", "required", "requiredWhen", "requiredUnless", "options"}
RECORD_KEYS = {"name", "label", "kind", "long", "optionsFrom", "options", "when"}
KNOWN_KINDS = {"text", "url", "code", "message", "list", "choice", "duration", "deadline", "require", "time", "sets"}
RECORD_KINDS = {"text", "url", "choice"}


def understood(d):
    """The app's PF.types.understood: a frozen step type uses only the type version, properties and kinds this copy knows."""
    if not isinstance(d, dict) or not set(d) <= TYPE_KEYS:
        return False
    v = d.get("version")
    if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float)) or v > TYPES_VERSION):
        return False
    fields = d.get("fields")
    if fields is not None and (not isinstance(fields, dict) or not all(
            isinstance(f, dict) and set(f) <= FIELD_KEYS and isinstance(f.get("kind"), str) and f.get("kind") in KNOWN_KINDS for f in fields.values())):
        return False
    record = d.get("record")
    if record is not None and (not isinstance(record, list) or not all(
            isinstance(r, dict) and set(r) <= RECORD_KEYS and isinstance(r.get("kind"), str) and r.get("kind") in RECORD_KINDS for r in record)):
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
    for s in parsed["steps"]:
        label = "Step \"%s\"" % s["text"][:40]
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
            bad = field_errors(d, s["fields"])
        except ValueError:
            return "%s %s has a step type this copy can't read." % (NEWER, label)
        if bad:
            return "%s %s %s" % (NEWER, label, bad[0])
    return ""


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
    "preflight-publication": {"majors": {1: []}, "future": {2: "2.0"}, "unmarked": False},
    "flightdeck-step-type": {"majors": {1: []}, "future": {2: "2.0"}, "unmarked": True},
}
# Every family's name, so a file of another known family is malformed here, never "newer".
FAMILY_NAMES = ["flightdeck-checklist", "preflight-publication", "preflight-run", "flightdeck-run-archive", "flightdeck-step-type", "flightdeck-types", "flightdeck-plan",
                "flightdeck-plan-status", "flightdeck-validation", "flightdeck-followup-decision", "flightdeck-correction-decision", "flightdeck-fix-decision", "flightdeck-proposal",
                "flightdeck-presence", "flightdeck-connection", "flightdeck-people", "flightdeck-skill", "flightdeck-editor-history", "flightdeck-installed", "flightdeck-stage-decision",
                "flightdeck-extension", "flightdeck-report", "flightdeck-report-decision"]
FROZEN = ["typed-details", "typed-evidence", "phase-notes", "phase-shots", "gate-shots", "pinned-children", "pinned-skills", "staged", "test-run", "extensions"]


def _semver(v):
    m = re.match(r"^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$", v) if isinstance(v, str) else None
    return [int(x) for x in m.groups()] if m else None


def _needs(fam, major, features, o):
    a = _semver(o.get("app") if isinstance(o, dict) else None)
    if a and a[0] >= 2:
        return "%d.%d" % (a[0], a[1])
    if fam and major is not None and major in fam["future"]:
        return fam["future"][major]
    if any(f in FROZEN for f in (features or [])):
        return "2.0"
    return ""


def judge(family, o):
    """{"ok": True, "major": n} or {"ok": False, "kind": "newer" | "malformed", "needs": "2.0" | ""}."""
    fam = FAMILIES.get(family)
    if fam is None or not isinstance(o, dict):
        return {"ok": False, "kind": "malformed", "needs": ""}
    major = None
    if o.get("format") is not None:
        m = re.match(r"^([a-z][a-z0-9-]{1,59})/([1-9]\d{0,3})$", o["format"]) if isinstance(o["format"], str) else None
        if not m:
            return {"ok": False, "kind": "malformed", "needs": ""}
        if m.group(1) != family:
            if m.group(1) in FAMILY_NAMES:
                return {"ok": False, "kind": "malformed", "needs": ""}
            return {"ok": False, "kind": "newer", "needs": _needs(None, None, None, o)}
        major = int(m.group(2))
    elif fam["unmarked"]:
        major = 1
    else:
        return {"ok": False, "kind": "malformed", "needs": ""}
    features = []
    if o.get("features") is not None:
        f = o["features"]
        if not isinstance(f, list) or len(f) > 32 or not all(isinstance(x, str) and re.match(r"^[a-z][a-z0-9-]{1,39}$", x) for x in f):
            return {"ok": False, "kind": "malformed", "needs": ""}
        features = list(f)
    if major not in fam["majors"]:
        return {"ok": False, "kind": "newer", "needs": _needs(fam, major, features, o)}
    unknown = [x for x in features if x not in fam["majors"][major]]
    if unknown:
        return {"ok": False, "kind": "newer", "needs": _needs(fam, None, unknown, o)}
    return {"ok": True, "major": major}


def newer_why(info, needs):
    """The app's words for a version a newer Flightdeck wrote (PF.publish.newerOf)."""
    if not needs:
        return NEWER
    v = info.get("version")
    label = "v%d" % int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else "This version"
    return label + " needs Flightdeck " + needs + ". This copy shows it but won't run it. Open the team folder's own flightdeck.html."


def check_publication(folder, name):
    files = {n: read_text(os.path.join(folder, n)) for n in ("map.md", "types.json", "publication.json")}
    if files["publication.json"] is None:
        return "syncing", "publication.json hasn't arrived", None
    try:
        info = json.loads(files["publication.json"])
    except ValueError:
        return "damaged", "publication.json is unreadable", None
    if not isinstance(info, dict):
        return "damaged", "publication.json isn't a publication record", None
    if info.get("format") != PUBLICATION_FORMAT or info.get("features") is not None:
        v = judge("preflight-publication", info)
        if not v["ok"]:
            return "unusable", newer_why(info, v["needs"]), info
    if files["map.md"] is None or files["types.json"] is None:
        return "syncing", "some files haven't arrived", info
    if text_hash(files["map.md"]) != info.get("mapHash") or text_hash(files["types.json"]) != info.get("typesHash"):
        return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    m = re.match(r"^v(\d+)-[a-z0-9]+$", name)
    if info.get("folder") != name or not m or int(m.group(1)) != info.get("version"):
        return "damaged", "folder name doesn't match the publication record", info
    try:
        types = json.loads(files["types.json"])
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
    for src, want in (info.get("images") or {}).items():
        path = os.path.join(folder, *src.split("/"))
        if not os.path.isfile(path):
            return "syncing", "screenshot %s hasn't arrived" % src, info
        with open(path, "rb") as f:
            if fnv(f.read()) != want:
                return "damaged", "screenshot %s doesn't match its record" % src, info
    return "complete", "", info


def team_files(root):
    """Basic checks of step-types/ and jira/workflows.json. Flightdeck's process page shows its full verdict."""
    problems, types = [], []
    sdir = os.path.join(root, "step-types")
    for name in sorted(os.listdir(sdir)) if os.path.isdir(sdir) else []:
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(sdir, name), encoding="utf-8") as f:
                d = json.load(f)
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
                w = json.load(f)
            workflows = sorted(w) if isinstance(w, dict) else []
            for t, v in (w.items() if isinstance(w, dict) else []):
                if not isinstance(v, dict) or not isinstance(v.get("statuses"), list) or not v["statuses"]:
                    problems.append({"file": "jira/workflows.json", "problem": t + ": needs \"statuses\""})
        except (OSError, ValueError):
            problems.append({"file": "jira/workflows.json", "problem": "isn't valid JSON"})
    return {"stepTypes": types, "jiraIssueTypes": workflows, "problems": problems}


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    out = {"folder": root, "publications": {}, "plans": [], "conflicts": []}
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
    plans, decisions = {}, {}
    for name in sorted(os.listdir(prop_dir)) if os.path.isdir(prop_dir) else []:
        text = read_text(os.path.join(prop_dir, name)) if name.endswith(".json") else None
        try:
            # Numbers are read as JavaScript reads them (all doubles), so 9007199254740993 becomes ...992 here too.
            obj = json.loads(text, parse_int=float) if text else None
        except ValueError:
            obj = None
        if not isinstance(obj, dict):
            continue
        if obj.get("kind") == "plan" and isinstance(obj.get("id"), str):
            plain = {k: v for k, v in obj.items() if not k.startswith("_")}
            plans.setdefault(obj["id"], []).append((name, text_hash(js_json(plain)), plain))
        elif obj.get("kind") == "status":
            decisions.setdefault(obj.get("proposal"), []).append(obj)
    for pid, copies in sorted(plans.items()):
        # OneDrive can keep two files of one plan (written on two computers while disconnected). Copies that say the same
        # thing (apart from when each was written, and which version of the same tool wrote a request) are one plan; copies
        # that differ can't be started until a person deletes one. The file under the plan's own name comes first.
        copies.sort(key=lambda c: (c[0] != pid + ".json", c[0]))
        name = copies[0][0]
        mine = decisions.get(pid, [])
        if not all(same_plan(c[2], copies[0][2]) for c in copies):
            status, why = "ambiguous", "different copies of this plan are in the folder (" + ", ".join(c[0] for c in copies) + "); Flightdeck starts neither until a person deletes one"
            out["plans"].append({"file": name, "id": pid, "status": status, "why": why})
            continue
        hashes = {c[1] for c in copies}
        matching = [d for d in mine if d.get("proposalHash") in hashes]
        started = {d.get("run") for d in matching if d.get("status") == "accepted"}
        if not mine:
            status, why = "pending", ""
        elif matching and len({d.get("status") for d in matching}) == 1 and len(started) <= 1:
            status, why = "decided", matching[0].get("status", "")
        elif not matching:
            status, why = "ambiguous", "the plan changed after it was decided; Flightdeck shows it as pending again"
        else:
            status, why = "ambiguous", "decisions on the same plan disagree (or it was started twice); Flightdeck shows it as undecided"
        out["plans"].append({"file": name, "id": pid, "status": status, "why": why})

    runs_dir = os.path.join(root, "runs")
    for proc in sorted(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else []:
        pdir = os.path.join(runs_dir, proc)
        for rid in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
            rdir = os.path.join(pdir, rid)
            if os.path.isdir(rdir):
                names = sorted(os.listdir(rdir))
                copies = [n for n in names if re.match(r"^run.*\.json$", n, re.I) and n != "run.json"]
                # A save's candidate file that run.json doesn't list was overwritten by another window or computer.
                try:
                    lineage = json.loads(read_text(os.path.join(rdir, "run.json")) or "{}").get("lineage") or []
                except ValueError:
                    lineage = []
                for n in names:
                    m = re.match(r"^candidate-(.+)-([a-z0-9]{8})\.json$", n)
                    if m and (m.group(1) + "." + m.group(2)) not in lineage and time.time() - os.path.getmtime(os.path.join(rdir, n)) >= 60:
                        copies.append(n)
                receipts = [n for n in names if n.startswith("candidate-")]
                if copies:
                    out["conflicts"].append({"run": proc + "/" + rid, "copies": copies})
                if len(receipts) > 1:
                    out.setdefault("receipts", []).append({"run": proc + "/" + rid, "count": len(receipts), "note": "Save receipts beyond the newest one are cleaned up by the next save; many here means unresolved conflicts or failed cleanups."})

    out["teamFiles"] = team_files(root)
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
