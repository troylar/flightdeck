"""The verdict every reader gives a run the work depends on (repo.depVerdict: readRunOnly, then PF.appjson.judgeRun), ported
for the pack reader so it is the same by construction: R.sanitize and everything it refuses or repairs (valid, the envelope,
unknown3, newer, longIds, the version's checklist, a test run's fields, the times it can't read) and R.unexplained's
comparison of the file with what sanitize keeps (U.drift, with the same allowances), the conflict copies beside it, and the
version it ran. test/run-corpus.test.js holds it to the app on a generated corpus of every field mutated in every role.

Every field the app's cleaner reads is read here too: a step's skill registration (cleanSkill), a loop approval
(PF.loop.cleanSnapshot), the to-dos an approval counted (PF.todos.cleanCut), migration records (migrationOk), typed values
in run details and in a step's evidence (invalidValues, by the step type's own record fields), the Jira search containers
(searchRead) and the searches the reader reopens or rebuilds (reopenAtRead). The coverage rule of test/run-corpus.test.js
fails on any place of a run file the app's cleaner reads and this doesn't. Times are read in the one form the app writes.
"""
import json
import math
import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "example-folder", ".flightdeck", "skills", "_flightdeck"))
import check_folder as CF  # noqa: E402

# The run family of PF.envelope (the shipped checker reads no runs): run/2 with no features, run/3 with every feature through
# living runs (PF.envelope.LIVING), and a run/3 that can't be read is the 2.0 bridge's.
LIVING = ["phase-notes", "phase-shots", "gate-shots", "pinned-children", "pinned-skills", "typed-details", "typed-evidence", "conditions", "passed-details", "team-values",
          "jira-search", "detail-patterns", "module-results", "loops", "staged", "test-run", "living-runs"]
CF.FAMILIES.setdefault("preflight-run", {"majors": {2: [], 3: LIVING}, "future": {3: "2.0"}, "unmarked": False})

FORMAT, FORMAT3 = "preflight-run/2", "preflight-run/3"
RUN_ID = re.compile(r"^[a-z0-9-]{1,40}\Z", re.I | re.A)
PROC = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}\Z", re.A)
LOOSE_ID = re.compile(r"^[a-z0-9][a-z0-9-]*\Z", re.A)
CHILD_ID = re.compile(r"^[a-z0-9-]{1,40}\Z", re.I | re.A)
VERSION = re.compile(r"^v(\d+)-[a-z0-9]+\Z", re.A)
STAGE = re.compile(r"^stage-[a-z0-9]{8}\Z", re.A)
LINEAGE = re.compile(r"^[\w-]{1,40}\.[a-z0-9]{8}\Z", re.A)
WORD_KEY = re.compile(r"^[\w-]{1,120}\Z", re.A)
VALUE_KEY = re.compile(r"^[\w-]{1,40}\Z", re.A)
FIELD_STEP = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}\Z", re.I | re.A)
APP = re.compile(r"^\d+\.\d+\.\d+", re.A)
HEX64 = re.compile(r"^[0-9a-f]{64}\Z", re.A)
HEX8 = re.compile(r"^[0-9a-f]{8}\Z", re.A)
HEAD = re.compile(r"^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})(\.status-[a-z0-9][a-z0-9-]{0,39}-[0-9a-f]{8})?\Z", re.A)
REQ = re.compile(r"^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}\Z", re.A)
ITEM_UID = re.compile(r"^[a-z][a-z0-9.-]{0,19}:(key:)?[A-Za-z0-9_-]{1,40}\Z", re.A)
CAND = re.compile(r"^candidate-(.+)-([a-z0-9]{8})\.json\Z", re.S)
COPY = re.compile(r"^run.*\.json\Z", re.I | re.S)
STEP_STATES = {"done", "na", "blocked", "recheck", "open"}
GATE_STATES = {"passed", "waived", "failed", "review"}
RUN_STATES = {"running", "completed", "stopped", "cancelled"}
OUTCOMES = {"Completed", "Stopped early", "Cancelled"}
MARKS = {"blocked", "recheck", "na", "differently"}
DETAIL_MAX, LOG_MAX, HISTORY_MAX = 120, 300, 10
ALLOW_ADDED = ["title", "state", "version", "rev", "shotsFrozen", "paused.reason", "recorder.handoff.rev"]
ALLOW_DROPPED = ["steps.*.history[*].differently.by", "steps.*.history[*].differently.at", "paused"]
_KNOWN = {
    "run": "format id process version folder mapHash title category snapshot types details roles recorder followUps shotsFrozen jira pauses paused lineage state created createdBy tz steps gates fields log ended rev savedAt savedBy marksFrom marks parent",
    "recorder": "person session handoff", "handoff": "from rev at", "step": "s by at reason started deadline differently values child history reopened", "history": "s by at reason differently values fields",
    "gate": "s by at reason was approved", "ended": "outcome by byName at", "paused": "by at reason", "pause": "from to by reason", "child": "process id inputs failed", "parent": "process id step inputs",
    "followUp": "id text owner ticket step from by at", "log": "at by what", "deadline": "at by set", "differently": "note by at", "started": "by at",
    "workflow": "statuses transitions invalid", "transition": "from to fields", "jiraField": "name hint source options"}
_KNOWN["run3"] = _KNOWN["run"] + " features app typesHash payload pins migrations test stage searchSites searchGen searchRec living"
_KNOWN["step3"] = _KNOWN["step"] + " skill loop todos"
_KNOWN["gate3"] = _KNOWN["gate"] + " todos"
_KNOWN["history3"] = _KNOWN["history"] + " skill loop"
_KNOWN["child3"] = _KNOWN["child"] + " folder retired teamPassed result answer"
_KNOWN["parent3"] = _KNOWN["parent"] + " folder item"
_KNOWN["pins"] = "children"
_KNOWN["skillSeen"] = "id rev sha snapshot"
KNOWN = {k: set(v.split(" ")) for k, v in _KNOWN.items()}
MISSING = object()


# ---- JavaScript's values, as JSON.parse gives them ----
def is_obj(v):
    return isinstance(v, dict)


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def truthy(v):
    if v is MISSING or v is None or v is False or v == "":
        return False
    if is_num(v):
        return v != 0 and not (isinstance(v, float) and math.isnan(v))
    return True


def js_object(v):
    """typeof v === 'object' and v isn't null: an object or a list."""
    return isinstance(v, (dict, list))


def get(v, k):
    """v[k] as JavaScript reads it from a value parsed from JSON (a list by index, a string by code unit)."""
    if isinstance(v, dict):
        return v.get(k, MISSING)
    if isinstance(v, list) and re.fullmatch(r"0|[1-9][0-9]*", str(k)) and int(k) < len(v):
        return v[int(k)]
    if isinstance(v, str) and re.fullmatch(r"0|[1-9][0-9]*", str(k)):
        u = v.encode("utf-16-le", "surrogatepass")
        i = int(k)
        return u[2 * i:2 * i + 2].decode("utf-16-le", "surrogatepass") if 2 * i < len(u) else MISSING
    if isinstance(v, str) and k == "length":
        return CF.js_len(v)
    return MISSING


def keys(v):
    """Object.keys(v) for a value parsed from JSON."""
    if isinstance(v, dict):
        return CF.js_keys(v)
    if isinstance(v, list):
        return [str(i) for i in range(len(v))]
    if isinstance(v, str):
        return [str(i) for i in range(CF.js_len(v))]
    return []


def js_string(v):
    """String(v), where a missing value is "undefined"."""
    return "undefined" if v is MISSING else CF.js_String(v)


def own(table, v):
    """Object.prototype.hasOwnProperty.call(table, v): the value as a property name."""
    return v is not MISSING and CF.js_String(v) in table


def s(v, n):
    return CF.js_slice(v, n) if isinstance(v, str) else ""


def parse_int(v):
    """parseInt(v, 10), or None for NaN."""
    if v is MISSING or (isinstance(v, float) and (math.isinf(v) or math.isnan(v))):
        return None  # String(Infinity) is "Infinity": no digits
    m = re.match("^[" + re.escape(CF.JS_WS) + "]*([+-]?[0-9]+)", CF.js_String(v), re.A)
    return int(m.group(1)) if m else None


def whole_num(v):
    """Math.floor(v) === v for a JSON number: an infinite one is its own floor."""
    return math.isinf(v) or math.floor(v) == v


def count(v):
    n = parse_int(v)
    return max(0, n) if n else 0


ISO_TIME = re.compile(r"^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z\Z", re.A)
TIME_CLIP = 8.64e15


def iso(v):
    """isoOrNull: exactly the form Flightdeck writes (toISOString), a real calendar time within ECMAScript's date range."""
    if not isinstance(v, str):
        return None
    m = ISO_TIME.match(v)
    if not m:
        return None
    y = int(m.group(1))
    mo, d, h, mi, se, ms = (int(x) for x in m.group(2, 3, 4, 5, 6, 7))
    if (0 <= y <= 9999) != (len(m.group(1)) == 4) or m.group(1) == "-000000":
        return None
    leap = (y % 4 == 0 and y % 100 != 0) or y % 400 == 0
    days = [31, 29 if leap else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if not 1 <= mo <= 12 or not 1 <= d <= days[mo - 1] or h > 23 or mi > 59 or se > 59:
        return None
    # Days from 1970-01-01 in the proleptic Gregorian calendar.
    yy = y - (1 if mo <= 2 else 0)
    era = yy // 400
    yoe = yy - era * 400
    doy = (153 * (mo + (-3 if mo > 2 else 9)) + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    t = (era * 146097 + doe - 719468) * 86400000 + ((h * 60 + mi) * 60 + se) * 1000 + ms
    return v if abs(t) <= TIME_CLIP else None


def text_len(v, unit):
    return len(v) if unit == "cp" else CF.js_len(v)


def cut(v, n, unit):
    if unit == "utf16":
        return CF.js_slice(v, n)
    return v[:n]


# ---- What sanitize refuses before it reads a field ----

# ---- A step's skill registration (R.cleanSkill, snapOk), a loop approval (PF.loop.cleanSnapshot) and the to-dos an approval
# counted (PF.todos.cleanCut), each the cleaned copy or None. ----
SKILL_ID = re.compile(r"^sk-[a-z0-9]{8}\Z", re.A)
SHA64 = re.compile(r"^[0-9a-f]{64}\Z", re.A)
REQ_ID = re.compile(r"^req-[A-Za-z0-9_.-]{1,120}\Z", re.A)
TODO_REQ = re.compile(r"^req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24}\Z", re.A)
TODO_DNAME = re.compile(r"^(req-[a-z0-9][a-z0-9-]{0,29}-[0-9a-f]{24})\.status-([a-z0-9][a-z0-9-]{0,39})-([0-9a-f]{8})\.json\Z", re.A)
FP16 = re.compile(r"^[0-9a-f]{0,16}\Z", re.A)


def txt(v, mx):
    return isinstance(v, str) and CF.js_len(v) <= mx


def snap_ok(n):
    if not is_obj(n) or any(k not in ("name", "version", "implements", "steps", "location", "description") for k in keys(n)):
        return False
    if not txt(n.get("name", MISSING), 80) or not n["name"] or not txt(n.get("version", MISSING), 40):
        return False
    imp = n.get("implements", MISSING)
    if imp is not MISSING and not (is_obj(imp) and all(k in ("process", "folder", "mapHash", "typesHash") and (imp[k] is None or txt(imp[k], 80)) for k in keys(imp))):
        return False
    st = n.get("steps", MISSING)
    if st is not MISSING and not (isinstance(st, list) and len(st) <= 200 and all(txt(x, 60) for x in st)):
        return False
    if n.get("location", MISSING) is not MISSING and not txt(n["location"], 500):
        return False
    if n.get("description", MISSING) is not MISSING and not txt(n["description"], 300):
        return False
    return True


def clean_skill(v):
    if not js_object(v):
        return None
    sid, rev, sha = get(v, "id"), get(v, "rev"), get(v, "sha")
    if not (isinstance(sid, str) and SKILL_ID.match(sid)) or not is_num(rev) or not math.isfinite(rev) or rev < 1 or rev > 999999 or math.floor(rev) != rev:
        return None
    if not (isinstance(sha, str) and SHA64.match(sha)):
        return None
    snap = get(v, "snapshot")
    text = CF.js_json(snap) if snap_ok(snap) else ""
    if not text or CF.js_len(text) > 2048:
        return None
    return {"id": sid, "rev": rev, "sha": sha, "snapshot": js_copy(whole(snap))}


def clean_snapshot(v):
    if not is_obj(v) or not isinstance(v.get("by"), str) or not isinstance(v.get("at"), str) or not isinstance(v.get("summary"), str):
        return None
    if not isinstance(v.get("records"), list) or not isinstance(v.get("items"), list) or not is_obj(v.get("counts")):
        return None
    if len(v["records"]) > 5000 or not all(txt(x, 120) for x in v["records"]) or len(v["items"]) > 500:
        return None
    items = []
    for it in v["items"]:
        if not is_obj(it) or any(not txt(it.get(k, MISSING), 120) for k in ("uid", "key", "state", "status", "result", "run", "exception")):
            return None
        item = {k: it[k] for k in ("uid", "key", "state", "status", "result", "run", "exception")}
        fp = it.get("fp", MISSING)
        if isinstance(fp, str) and FP16.match(fp):
            item["fp"] = fp
        items.append(item)
    ob = v.get("onBehalf", MISSING)
    out = {"by": CF.js_slice(v["by"], 80), "at": CF.js_slice(v["at"], 40), "onBehalf": CF.js_slice(ob, 80) if isinstance(ob, str) else "",
           "records": list(v["records"]), "summary": CF.js_slice(v["summary"], 300), "counts": js_copy(whole(v["counts"])), "items": items}
    rq = v.get("request", MISSING)
    if isinstance(rq, str) and REQ_ID.match(rq):
        out["request"] = rq
    return out


def clean_cut(v):
    if not is_obj(v) or len(v) != 1 or not isinstance(v.get("cut"), list) or len(v["cut"]) > 5000:
        return None
    if not all(isinstance(x, str) and (TODO_REQ.match(x) or TODO_DNAME.match(x + ".json")) for x in v["cut"]):
        return None
    return {"cut": list(v["cut"])}


# ---- Typed values (PF.values.parse and valid), for any definition: a run detail's or a step's evidence. ----
VALUE_KINDS = ("text", "number", "yes-no", "choice", "date", "url", "link", "pattern")
NEW_KINDS = ("number", "yes-no", "date")
NUMBER_CANON = re.compile(r"^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?\Z", re.A)


def kind_of(d):
    k = d.get("kind") if is_obj(d) else None
    k = k if isinstance(k, str) and k in VALUE_KINDS else "text"
    return "url" if k == "link" else k


def is_number(v):
    return isinstance(v, str) and CF.js_len(v) <= 30 and NUMBER_CANON.match(v) and v != "-0"


def num_compare(a, b):
    from decimal import Decimal
    x, y = Decimal(a), Decimal(b)
    return -1 if x < y else 1 if x > y else 0


def utf16(v):
    return v.encode("utf-16-be", "surrogatepass")


def safe_url(u):
    return isinstance(u, str) and re.match(r"^(https?://|mailto:)[^" + CF._JWS + "\"'<>]+\\Z", u, re.I) is not None


def link_ok(t):
    return re.match(r"^https?://[^" + CF._JWS + "]+\\Z", t, re.I) is not None and safe_url(t)


def vparse(d, raw, mx=None):
    """PF.values.parse(d, raw, { max }): (ok, canonical)."""
    k = kind_of(d)
    if k == "pattern":
        t = "" if raw is None or raw is MISSING else js_string(raw)
        if t == "":
            return True, ""
        pc = CF.compile_pattern(d.get("pattern"))
        if not pc.get("ok") or CF.bad_text(t):
            return False, ""
        if mx and len(t) > mx:
            return False, ""
        return (True, t) if CF.match_pattern(pc, t)[0] else (False, "")
    t = (raw if isinstance(raw, str) else js_string(raw) if is_num(raw) or isinstance(raw, bool) else "").strip(CF.VALUE_WS)
    if not t:
        return True, ""
    out = t
    if k == "number":
        out = None if any(c in CF.VALUE_WS for c in t) else CF._to_number(t)
        if out is None or CF.js_len(out) > 30:
            return False, ""
        if d.get("min") is not None and is_number(d.get("min")) and num_compare(out, d["min"]) < 0:
            return False, ""
        if d.get("max") is not None and is_number(d.get("max")) and num_compare(out, d["max"]) > 0:
            return False, ""
    elif k == "yes-no":
        if t.lower() not in ("yes", "no"):
            return False, ""
        out = t.lower()
    elif k == "date":
        if not CF._is_date(t):
            return False, ""
    elif k == "choice":
        opts = [o for o in d.get("options") if isinstance(o, str)] if isinstance(d.get("options"), list) else []
        hit = [o for o in opts if o.lower() == t.lower()]
        if len(hit) != 1:
            return False, ""
        out = hit[0]
    elif k == "url":
        if not link_ok(t):
            return False, ""
    if mx and CF.js_len(out) > mx:
        return False, ""
    return True, out


def vvalid(d, stored):
    if not isinstance(stored, str):
        return False
    if stored == "":
        return True
    ok, c = vparse(d, stored)
    return ok and c == stored


# ---- A step's evidence as the run has it (R.evidenceFor, PF.types.recordFields and checkRecord). ----
BUILTIN_RECORD = json.loads(r"""{"confirm": [], "communicate": [{"name": "sent", "label": "Link to the message", "kind": "url"}], "meeting": [{"name": "outcome", "label": "Outcome", "kind": "text", "long": true}], "decide": [{"name": "decision", "label": "Decision", "kind": "choice", "optionsFrom": "options"}, {"name": "why", "label": "Why", "kind": "text", "long": true}], "review": [{"name": "verdict", "label": "Verdict", "kind": "choice", "options": ["Approved", "Approved with comments", "Changes needed"]}, {"name": "comments", "label": "Link to comments", "kind": "url"}], "wait": [{"name": "arrived", "label": "What arrived", "kind": "text", "long": true}], "ui.action": [{"name": "reference", "label": "Reference (ID or link)", "kind": "text"}], "jenkins.job": [{"name": "build", "label": "Build number", "kind": "text"}, {"name": "buildLink", "label": "Build link", "kind": "url"}], "bitbucket.pr": [{"name": "pr", "label": "Pull request link", "kind": "url"}, {"name": "mergeCommit", "label": "Merge commit", "kind": "text", "when": {"action": "merge"}}], "jira.issue": [{"name": "key", "label": "Issue key", "kind": "text", "when": {"action": "create"}}], "run.process": [], "run.command": [{"name": "result", "label": "What you saw", "kind": "text", "long": true}], "run.script": [{"name": "result", "label": "What you saw", "kind": "text", "long": true}], "run.skill": [{"name": "output", "label": "Link to the output", "kind": "url"}], "ci.gate": [{"name": "run", "label": "Run number", "kind": "text"}, {"name": "runLink", "label": "Run link", "kind": "url"}], "jira.sprint": [{"name": "sprintLink", "label": "Sprint link", "kind": "url"}, {"name": "name", "label": "Sprint name", "kind": "text", "when": {"action": "start"}}, {"name": "dates", "label": "Sprint dates", "kind": "text", "when": {"action": "start"}}, {"name": "carriedOver", "label": "Issues carried over", "kind": "text", "when": {"action": "close"}}, {"name": "moved", "label": "Issues moved", "kind": "text", "when": {"action": "move-incomplete"}}], "deploy": [{"name": "deployed", "label": "Version deployed", "kind": "text"}, {"name": "deployLink", "label": "Deploy link", "kind": "url"}, {"name": "finished", "label": "Finished at", "kind": "text"}], "verify.health": [{"name": "result", "label": "Result", "kind": "choice", "options": ["Pass", "Fail"]}, {"name": "observed", "label": "Value you saw", "kind": "text"}, {"name": "snapshot", "label": "Screenshot or link", "kind": "url"}], "github.pr": [{"name": "pr", "label": "Pull request link", "kind": "url"}, {"name": "checks", "label": "Checks", "kind": "choice", "options": ["Passing", "Failing", "Pending"]}, {"name": "mergeCommit", "label": "Merge commit", "kind": "text", "when": {"action": "merge"}}], "measure": [{"name": "value", "label": "Value", "kind": "text"}, {"name": "unit", "label": "Unit", "kind": "text"}], "jira.search": [{"name": "searchId", "label": "Search", "kind": "text", "system": true}, {"name": "count", "label": "Results found", "kind": "number", "min": "0"}, {"name": "keys", "label": "Issue keys", "kind": "text", "long": true, "notAt": {"count": "0"}}, {"name": "resultsLink", "label": "Results link", "kind": "url"}, {"name": "ranAt", "label": "When it ran", "kind": "text"}], "for.each": []}""")
EVIDENCE = {"link": {"name": "evidence", "label": "Link to the evidence", "kind": "url", "required": True},
            "note": {"name": "evidence", "label": "What you saw", "kind": "text", "long": True, "required": True},
            "number": {"name": "evidence", "label": "The number you saw", "kind": "number", "required": True},
            "yes-no": {"name": "evidence", "label": "Your answer", "kind": "yes-no", "required": True},
            "date": {"name": "evidence", "label": "The date", "kind": "date", "required": True}}


def str_or(v):
    """String(v || '')."""
    return js_string(v) if truthy(v) else ""


def flist(v):
    return [x for x in (CF.js_trim(p) for p in str_or(v).split(",")) if x]


def fields_of(r, step):
    f = dict(step["fields"])
    own_f = r["fields"].get(step["id"]) if step.get("id") in r["fields"] else None
    if own_f:
        f.update(own_f)
    return f


def type_def(tid, frozen):
    if is_obj(frozen) and tid in frozen and js_object(frozen[tid]):
        return frozen[tid]
    return {"id": tid, "record": BUILTIN_RECORD[tid]} if tid in BUILTIN_RECORD else None


def matches(cond, fields):
    return all(str_or(fields.get(k, MISSING)).lower() == cond[k] for k in keys(cond))


def options(d, fields):
    if truthy(d.get("optionsFrom", MISSING)):
        return [x for x in (CF.js_trim(p) for p in str_or(fields.get(d["optionsFrom"], MISSING)).split(",")) if x]
    return d.get("options") or []


def record_fields(t, fields, extra):
    req = flist(fields.get("require", MISSING))
    al = "all" in req
    out = []
    for d in (get(t, "record") if truthy(t) and truthy(get(t, "record")) else []):
        if truthy(get(d, "when")) and not matches(d["when"], fields):
            continue
        c = whole(d)
        if truthy(get(d, "optionsFrom")):
            c["options"] = options(d, fields)
        c["required"] = (al and not truthy(get(d, "system"))) or get(d, "name") in req
        out.append(c)
    ev = EVIDENCE.get(str_or(fields.get("evidence", MISSING)).lower())
    if ev:
        out.append(dict(ev))
    return out + [dict(x) for x in extra]


def jira_required(workflows, issue_type, status):
    ks = [k for k in keys(workflows) if k != "#file"]
    if truthy(issue_type):
        hit = [k for k in ks if k.lower() == CF.js_trim(js_string(issue_type)).lower()]
        w = workflows[hit[0]] if hit else None
    else:
        w = workflows[ks[0]] if len(ks) == 1 else None
    if w is None:
        return []
    seen, out = {}, []
    for t in w["transitions"]:
        if t["to"] != status:
            continue
        for f in t["fields"]:
            k = f["name"].lower()
            if k not in seen:
                seen[k] = {"name": f["name"], "options": f.get("options")}
                out.append(seen[k])
    return out


def slug(v, mx):
    t = re.sub(r"[^a-z0-9]+", "-", v.lower()).strip("-") if False else re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", v.lower()))
    return CF.js_slice(t, mx) or "x"


def evidence_for(r, step, mp):
    t, f, extra = type_def(step["type"], r["types"]), fields_of(r, step), []
    if step["type"] == "jira.issue" and str_or(f.get("action", MISSING)).lower() == "transition" and truthy(f.get("status", MISSING)) and truthy(r.get("jira")):
        for j in jira_required(r["jira"], f.get("issueType"), f["status"]):
            d = {"name": "jf-" + slug(j["name"], 20) + "-" + CF.text_hash(CF.js_trim(j["name"]).lower()), "label": j["name"], "kind": "choice" if j["options"] else "text", "required": True, "jira": True}
            if j["options"]:
                d["options"] = j["options"]
            extra.append(d)
    bound = []
    typed = mp["detailTypes"]
    for b in CF.sets_of(f.get("sets", "")):
        if b["from"]:
            if b["from"] == "decision":
                bound.append(b["name"])
            continue
        d = b["name"]
        e = {"name": "rd-" + slug(d, 20) + "-" + CF.text_hash(d), "label": d, "kind": "text", "required": True, "cap": DETAIL_MAX, "detail": d}
        dt = typed.get(d) if d in typed else None
        if dt:
            e["kind"] = "url" if dt["kind"] == "link" else dt["kind"]
            e["detailKind"] = dt["kind"]
            if dt.get("options"):
                e["options"] = list(dt["options"])
            if dt["kind"] == "pattern":
                e["pattern"] = dt["pattern"]
        extra.append(e)
    rec = record_fields(t, f, extra)
    if bound:
        for d in rec:
            if d.get("name") == "decision" and not d.get("detail"):
                d["detail"], d["required"] = bound[0], True
    return t, f, extra, rec


def check_record(t, fields, values, partial, rec):
    """PF.types.checkRecord over rec (recordFields' list): (values, error)."""
    out = {}
    for d in rec:
        name = get(d, "name")
        raw = values.get(name) if isinstance(name, str) and name in values else None
        v = CF.js_trim(js_string(raw)) if raw is not None else ""
        na = get(d, "notAt")
        if truthy(na) and is_obj(na) and all(k in out and out[k] == na[k] for k in keys(na)):
            if v:
                return None, "notAt"
            continue
        dk = get(d, "detailKind")
        if (isinstance(get(d, "kind"), str) and d["kind"] in NEW_KINDS) or (truthy(dk) and dk != "text"):
            ok, c = vparse(d, "" if raw is None else raw, get(d, "cap") if truthy(get(d, "cap")) else 300)
            if not ok:
                return None, "value"
            if not c:
                if get(d, "required") and not partial:
                    return None, "required"
                continue
            out[name] = c
            continue
        cap = get(d, "cap") if truthy(get(d, "cap")) else 300
        if CF.js_len(v) > cap:
            return None, "long"
        if not v:
            if get(d, "required") and not partial:
                return None, "required"
            continue
        if get(d, "kind") == "url" and not re.match(r"^https?://[^" + CF._JWS + r"]+\Z", v, re.I):
            return None, "url"
        if get(d, "kind") == "choice":
            hit = [o for o in options(d, fields) if js_string(o).lower() == v.lower()]
            if not hit:
                return None, "choice"
            out[name] = hit[0]
            continue
        out[name] = v
    return out, ""


def detail_value_def(mp, name):
    d = mp["detailTypes"].get(name) if name in mp["detailTypes"] else None
    if not d:
        return None
    v = {"kind": d["kind"], "label": name, "options": d.get("options")}
    if d["kind"] == "pattern":
        v["pattern"] = d["pattern"]
    return v


def find_step(mp, sid):
    for st in mp["steps"]:
        if st.get("id") == sid:
            return st
    return None


def typed_def(r, mp, path):
    m = re.match(r"^details\.(.+)\Z", path, re.S)
    if m:
        return detail_value_def(mp, m.group(1))
    m = re.match(r"^steps\.([^.]+)\.values\.(.+)\Z", path, re.S)
    st = find_step(mp, m.group(1)) if m else None
    if not st:
        return None
    d = [e for e in evidence_for(r, st, mp)[3] if get(e, "name") == m.group(2)]
    d = d[0] if d else None
    if d and ((isinstance(d.get("kind"), str) and d["kind"] in NEW_KINDS) or (truthy(d.get("detailKind", MISSING)) and d["detailKind"] != "text")):
        return d
    return None


def invalid_values(r, mp):
    """R.invalidValues: every typed value (a run detail or a step's evidence) that isn't exactly canonical, by path."""
    out = []
    for k, v in r["details"].items():
        d = detail_value_def(mp, k)
        if d and v and not vvalid(d, v):
            out.append("details." + k)
    for sid, a in r["steps"].items():
        for n, v in (a.get("values") or {}).items():
            path = "steps." + sid + ".values." + n
            d = typed_def(r, mp, path) if v else None
            if d and not vvalid(d, v):
                out.append(path)
    return out


# ---- Migration records (R.migrationsOk, migrationOk). ----
MIG_KEYS = ["path", "at", "from", "source", "verdict", "result", "resolved"]
MIG_SOURCES = ("plan", "switch", "carry", "request", "report")


def migration_ok(m, mp, r):
    if not is_obj(m) or keys(m) != MIG_KEYS:
        return False
    if not txt(m["path"], 300) or not iso(m["at"]) or not txt(m["from"], 300) or not (isinstance(m["source"], str) and m["source"] in MIG_SOURCES):
        return False
    if not (isinstance(m["verdict"], str) and m["verdict"] in ("converted", "ambiguous", "invalid")):
        return False
    d = typed_def(r, mp, m["path"])
    if not d:
        return False
    if not (isinstance(m["result"], str) and vvalid(d, m["result"])) if m["verdict"] == "converted" else m["result"] is not None:
        return False
    z = m["resolved"]
    if z is None:
        return True
    return is_obj(z) and keys(z) == ["by", "at", "value"] and txt(z["by"], 80) and bool(iso(z["at"])) and isinstance(z["value"], str) and vvalid(d, z["value"])


def migrations_ok(o, mp, r):
    lst = o.get("migrations", MISSING)
    if lst is MISSING or lst is None:
        return True
    return isinstance(lst, list) and len(lst) <= 200 and all(migration_ok(m, mp, r) for m in lst)


def open_migrations(r):
    return [m for m in (r.get("migrations") if isinstance(r.get("migrations"), list) else []) if truthy(m) and is_obj(m) and m.get("verdict") in ("ambiguous", "invalid") and "resolved" in m and m["resolved"] is None]


# ---- Conditions (R.applies, PF.conditions.evaluate). ----
def evaluate(test, stored, d, opened):
    if opened:
        return None
    v, kind = stored if isinstance(stored, str) else "", kind_of(d)
    if kind != "text" and v != "" and not vvalid(d, v):
        return None
    op = test["op"]
    if op == "set":
        return v != ""
    if op == "notset":
        return v == ""
    if v == "":
        return op == "isnot"
    same = (lambda x: num_compare(v, x) == 0) if kind == "number" else (lambda x: v == x)
    c = num_compare(v, test["values"][0]) if kind == "number" else (-1 if utf16(v) < utf16(test["values"][0]) else 1 if utf16(v) > utf16(test["values"][0]) else 0)
    if op == "is":
        return same(test["values"][0])
    if op == "isnot":
        return not same(test["values"][0])
    if op == "oneof":
        return any(same(x) for x in test["values"])
    if op == "atleast":
        return c >= 0
    if op == "atmost":
        return c <= 0
    return None


def applies(r, mp, step):
    p = mp["phases"][step["phase"]] if 0 <= step.get("phase", -1) < len(mp["phases"]) else None
    if not p:
        return True
    tests = (p.get("when") or []) + (step.get("when") or [])
    if not tests:
        return True
    vs = []
    for w in tests:
        d = detail_value_def(mp, w["name"]) or {"kind": "text", "label": w["name"]}
        v = r["details"].get(w["name"], "") if w["name"] in r["details"] else ""
        opened = any(m.get("path") == "details." + w["name"] for m in open_migrations(r))
        vs.append(evaluate(w, v if isinstance(v, str) else "", d, opened))
    if any(x is False for x in vs):
        return False
    return None if any(x is not True for x in vs) else True


# ---- Jira searches (PF.jsearch and the run's search reader, 2.16 section 5). ----
GEN = re.compile(r"^[1-9][0-9]{0,8}-[0-9a-f]{8}\Z", re.A)
ISSUE_KEY = re.compile(r"^[A-Z][A-Z0-9_]{0,19}-[1-9][0-9]{0,9}\Z", re.A)
SEARCH_FIELDS = ["searchId", "count", "keys", "resultsLink", "ranAt"]
SEARCH_PREFIX = "Reopened when read: "
JS_PROTO = {"constructor", "__proto__", "toString", "toLocaleString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
            "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"}
_WS = "[" + CF._JWS + "]"


def gen_ok(v):
    return isinstance(v, str) and GEN.match(v) is not None


def jlex(q):
    """PF.jsearch.lex with each token's offsets."""
    out, i = [], 0
    while i < len(q):
        c = q[i]
        if re.match(_WS, c):
            i += 1
            continue
        if c in "\"'":
            j, v = i + 1, ""
            while j < len(q) and q[j] != c:
                if q[j] == "\\":
                    if j + 1 >= len(q):
                        return None
                    v += q[j + 1]
                    j += 2
                else:
                    v += q[j]
                    j += 1
            if j >= len(q):
                return None
            out.append({"t": "str", "v": v, "s": i, "e": j + 1})
            i = j + 1
            continue
        two = q[i:i + 2]
        if two in ("!=", "!~", "<=", ">="):
            out.append({"t": "op", "v": two, "s": i, "e": i + 2})
            i += 2
            continue
        if c in "=~<>":
            out.append({"t": "op", "v": c, "s": i, "e": i + 1})
            i += 1
            continue
        if c in "(),":
            out.append({"t": {"(": "lp", ")": "rp", ",": "comma"}[c], "v": None, "s": i, "e": i + 1})
            i += 1
            continue
        if c == "!":
            return None
        k = i
        while k < len(q) and not re.match("[" + CF._JWS + "\"'()=,~<>!]", q[k]):
            k += 1
        w = q[i:k]
        m = re.match(r"^\^([A-Za-z0-9_-]+)\Z", w)
        out.append({"t": "ph", "v": m.group(1), "s": i, "e": k} if m else {"t": "word", "v": w, "s": i, "e": k})
        i = k
    return out


def placeholders(q, context):
    """PF.jsearch.placeholders: (errors, tokens with slot marked, uses)."""
    toks = jlex(q)
    if toks is None:
        return ["lex"], [], []
    errors, uses, stack = [], [], []
    kw = lambda t: t["v"].upper() if t and t["t"] == "word" else None  # noqa: E731
    at = lambda k: toks[k] if 0 <= k < len(toks) else None  # noqa: E731
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
            if any(m.group(1) in context for m in re.finditer(r"\^([A-Za-z0-9_-]+)", tk["v"])):
                errors.append("quoted")
            continue
        if tk["t"] == "word" and re.search(r"\^[A-Za-z0-9_-]", tk["v"]):
            errors.append("joined")
            continue
        if tk["t"] != "ph":
            continue
        if tk["v"] not in context:
            errors.append("unknown")
            continue
        top = stack[-1] if stack else "top"
        p1, p2, n = at(k - 1), at(k - 2), at(k + 1)
        ok = False
        if "function" in stack or (p1 and p1["t"] == "op" and p1["v"] in ("~", "!~")):
            ok = False
        elif p1 and p1["t"] == "op" and p1["v"] in CF.SCALAR_OPS:
            ok = True
        elif p1 and p1["t"] == "word" and (kw(p1) == "IS" or (kw(p1) == "NOT" and p2 and p2["t"] == "word" and kw(p2) == "IS")):
            ok = False
        elif top == "list" and p1 and p1["t"] in ("lp", "comma"):
            ok = True
        if ok and not (not n or n["t"] == "rp" or (n["t"] == "comma" and top == "list") or (n["t"] == "word" and kw(n) in ("AND", "OR", "ORDER"))):
            ok = False
        if ok:
            tk["slot"] = True
            uses.append(tk["v"])
        else:
            errors.append("place")
    return errors, toks, [x for i, x in enumerate(uses) if x not in uses[:i]]


def search_uses(f, context):
    q = f.get("query")
    return placeholders(js_string(q), context)[2] if q is not None and CF.js_trim(js_string(q)) else []


def substitute(query, details, context):
    errs, toks, _ = placeholders(query, context)
    if errs:
        return {"ok": False, "missing": []}
    missing, refused, occ, out, at = [], [], [], "", 0
    for tk in toks:
        if tk["t"] != "ph" or not tk.get("slot"):
            continue
        v = details.get(tk["v"]) if tk["v"] in details else ""
        v = "" if v is None else js_string(v)
        if not v:
            missing.append(tk["v"])
            continue
        if CF.bad_text(v) or len(v) > 300:
            refused.append(tk["v"])
            continue
        out += query[at:tk["s"]]
        lit = '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
        occ.append({"name": tk["v"], "value": v, "s": len(out), "e": len(out) + len(lit)})
        out += lit
        at = tk["e"]
    if missing or refused:
        return {"ok": False, "missing": missing}
    out += query[at:]
    used = {}
    for o in occ:
        used[o["name"]] = o["value"]
    return {"ok": True, "jql": out, "occ": occ, "used": used, "template": toks}


def contained(template, sub):
    out = jlex(sub["jql"])
    if out is None:
        return False
    want = ["str" if t["t"] == "ph" and t.get("slot") else t["t"] for t in template]
    if len(out) != len(want) or any(out[k]["t"] != want[k] for k in range(len(out))):
        return False
    for o in sub["occ"]:
        tk = [t for t in out if t["s"] == o["s"]]
        if not tk or tk[0]["t"] != "str" or tk[0]["e"] != o["e"] or tk[0]["v"] != o["value"]:
            return False
    return True


def check_base(v):
    """PF.jsearch.checkBase: the canonical https://host[:port][/path], or None."""
    if not isinstance(v, str):
        return None
    if v != CF.js_trim(v) or CF.bad_text(v) or re.search(_WS, v):
        return None
    if not re.match(r"^https://", v, re.I) or re.search(r"[\\@?#%\"'<>`{}|^]", v[8:]):
        return None
    m = re.match(r"^https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)(?::([1-9][0-9]{0,4}))?((?:/[A-Za-z0-9._~-]+)*)/?\Z", v, re.I | re.A)
    if not m or (m.group(2) and int(m.group(2)) > 65535):
        return None
    if any(x in (".", "..") for x in (m.group(3) or "").split("/")):
        return None
    host = m.group(1).lower()
    base = "https://" + host + (":" + m.group(2) if m.group(2) else "") + (m.group(3) or "")
    # The WHATWG URL parser: a host whose last label is a number is an IPv4 address (canonical, or refused); 443 is dropped.
    labels = host.split(".")
    if re.fullmatch(r"[0-9]+|0x[0-9a-f]*", labels[-1]):
        nums = []
        for x in labels:
            if re.fullmatch(r"0x[0-9a-f]*", x):
                nums.append(int(x[2:] or "0", 16))
            elif re.fullmatch(r"0[0-7]+", x):
                nums.append(int(x, 8))
            elif re.fullmatch(r"[0-9]+", x):
                nums.append(int(x))
            else:
                return None
        if len(nums) > 4 or any(n > 255 for n in nums[:-1]) or nums[-1] >= 256 ** (5 - len(nums)):
            return None
        n = nums[-1]
        for i, x in enumerate(nums[:-1]):
            n += x * 256 ** (3 - i)
        host = ".".join(str((n >> s) & 255) for s in (24, 16, 8, 0))
    canon = "https://" + host + (":" + m.group(2) if m.group(2) and m.group(2) != "443" else "") + (m.group(3) or "")
    return base if canon == base else None


def site_name(f):
    v = CF.js_trim(js_string(f["site"]) if f.get("site") is not None else "team:jira-base-url")
    m = re.match(r"^team:([a-z0-9][a-z0-9-]{0,39})\Z", v)
    return m.group(1) if m else None


def search_state(r, mp, step):
    """R.searchState: (ok, id, damaged, why)."""
    f, ctx = step["fields"], mp["context"]
    rule, _ = CF.parse_results(f.get("results"))
    n = site_name(f)
    sites = r.get("searchSites") or {}
    e = sites.get(n) if n and n in sites else None
    base = e["base"] if is_obj(e) and isinstance(e.get("base"), str) else ""
    q = f.get("query") is not None and CF.js_trim(js_string(f["query"]))
    flt = CF.js_trim(js_string(f["filter"])) if not q and f.get("filter") is not None and CF.js_trim(js_string(f["filter"])) else ""
    uses = search_uses(f, ctx)
    for d in uses:
        dd, v = detail_value_def(mp, d), r["details"].get(d)
        if dd and v and not vvalid(dd, v):
            return {"ok": False, "why": "invalid"}
    sub = None
    if not flt:
        sub = substitute(js_string(f.get("query") or ""), r["details"], ctx)
        if not sub["ok"]:
            return {"ok": False, "waiting": bool(sub["missing"]), "why": "sub"}
        if not contained(sub["template"], sub):
            return {"ok": False, "why": "contained"}
    if [d for d in CF.set_names(f.get("sets", "")) if d in uses]:
        return {"ok": False, "why": "sets"}
    gens, recs = r.get("searchGen") or {}, r.get("searchRec")
    rec = recs.get(step["id"]) if recs else None
    if not gen_ok(rec):
        return {"ok": False, "damaged": True}
    if flt:
        idn = ["flightdeck-search/3", base, "filter", flt, [], rec]
    else:
        names = sorted(sub["used"], key=utf16)
        if any(nm not in gens or not gen_ok(gens[nm]) for nm in names):
            return {"ok": False, "damaged": True}
        idn = ["flightdeck-search/3", base, "jql", sub["jql"], [[nm, sub["used"][nm], gens[nm]] for nm in names], rec]
    import hashlib
    fp = "sha256:" + hashlib.sha256(CF.js_json(idn).encode("utf-8", "surrogatepass")).hexdigest()
    return {"ok": True, "id": fp, "rule": rule}


def ms_of(t):
    """Date.parse for the times realTime accepts, or None."""
    m = re.match(r"^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?(Z|([+-])([0-9]{2}):([0-9]{2}))\Z", t)
    if not m:
        return None
    import datetime
    y, mo, d, h, mi = (int(x) for x in m.group(1, 2, 3, 4, 5))
    sec, frac = int(m.group(6) or 0), int((m.group(7) or "0").ljust(3, "0"))
    if y < 100:
        return "bad"
    try:
        day = datetime.datetime(y, mo, d, tzinfo=datetime.timezone.utc)
    except ValueError:
        return "bad"
    if h > 23 or mi > 59 or sec > 59 or (m.group(9) and (int(m.group(10)) > 14 or int(m.group(11)) > 59)):
        return "bad"
    off = 0 if m.group(8) == "Z" else (1 if m.group(9) == "+" else -1) * (int(m.group(10)) * 60 + int(m.group(11)))
    return int(day.timestamp() * 1000) + ((h * 60 + mi - off) * 60 + sec) * 1000 + frac


def search_evidence(rule, v, cur, now):
    """PF.jsearch.checkEvidence: (values, meets) or None (an error)."""
    def st(k):
        return CF.js_trim(js_string(v[k])) if k in v and v[k] is not None else ""
    out = {}
    if not cur or st("searchId") != cur:
        return None
    out["searchId"] = st("searchId")
    c = st("count")
    if not c or not re.match(r"^\+?[0-9]{1,7}\Z", c, re.A) or int(c) > 1000000:
        return None
    out["count"] = str(int(c))
    k = st("keys")
    if k and out["count"] == "0":
        return None
    if k:
        m = re.match(r"^(.*?)(?:" + _WS + r"*\+" + _WS + r"*([0-9]{1,7}) more)?\Z", k, re.I | re.S)
        parts = [x.upper() for x in re.split("[" + CF._JWS + ",]+", m.group(1)) if x]
        if [x for x in parts if not ISSUE_KEY.match(x)]:
            return None
        uniq = [x for i, x in enumerate(parts) if x not in parts[:i]]
        more = int(m.group(2)) if m.group(2) else 0
        if not uniq:
            return None
        text = ", ".join(uniq) + (" +%d more" % more if more else "")
        if CF.js_len(text) > 300 or len(uniq) + more != int(out["count"]):
            return None
        out["keys"] = text
    ln = st("resultsLink")
    if ln:
        if CF.js_len(ln) > 300 or not re.match(r"^https?://[^" + CF._JWS + r"]+\Z", ln, re.I) or not safe_url(ln):
            return None
        out["resultsLink"] = ln
    t = st("ranAt")
    if t:
        ms = ms_of(t)
        if ms is None or ms == "bad" or ms > now + 300000:
            return None
        out["ranAt"] = t
    n = int(out["count"])
    ok = True if rule["op"] == "any" else n == rule["n"] if rule["op"] == "eq" else n >= rule["n"] if rule["op"] == "ge" else n <= rule["n"]
    if not ok and n > 0 and "keys" not in out:
        return None
    return out, ok


def search_stands(r, mp, step, a):
    """R.searchStands: '' when a stored done search still counts as read, else why not."""
    stt = search_state(r, mp, step)
    if not stt["ok"]:
        return "state"
    v = a.get("values") or {}
    if v.get("searchId") != stt["id"]:
        return "id"
    if stt["rule"] is None:
        return "rule"
    when = a.get("at") or r.get("savedAt")
    now = ms_of(when) if isinstance(when, str) else None
    if not isinstance(now, int):
        import time
        now = int(time.time() * 1000)
    t, f, extra, rec = evidence_for(r, step, mp)
    vals, err = check_record(t, f, v, False, rec)
    if err:
        return "record"
    have = any(k != "searchId" and k in v and v[k] is not None and CF.js_trim(js_string(v[k])) != "" for k in SEARCH_FIELDS)
    if have and not v.get("searchId"):
        return "record"
    names = [get(d, "name") for d in rec]
    if [k for k in v if k not in names and v[k] is not None and js_string(v[k]) != ""]:
        return "extra"
    sc = search_evidence(stt["rule"], v, stt["id"], now)
    if sc is None:
        return "evidence"
    canon, meets = sc
    if not meets:
        return "rule"
    same = all(("" if v.get(k) is None else js_string(v[k])) == ("" if canon.get(k) is None else canon[k]) for k in SEARCH_FIELDS)
    return "" if same else "form"


def clean_sites(o):
    sites, bad = {}, []
    if o is MISSING or o is None:
        return sites, ([] if o is MISSING else ["searchSites"])
    if not is_obj(o):
        return sites, ["searchSites"]
    for k in keys(o)[:20]:
        v = o[k]
        ok = re.match(r"^[a-z0-9][a-z0-9-]{0,39}\Z", k) and k not in JS_PROTO and is_obj(v)
        ks = " ".join(keys(v)) if ok else ""
        if ok and ks == "base" and isinstance(v["base"], str) and CF.js_len(v["base"]) <= 120 and check_base(v["base"]) == v["base"]:
            sites[k] = {"base": v["base"]}
        elif ok and ks == "missing" and v["missing"] is True:
            sites[k] = {"missing": True}
        elif ok and ks == "invalid" and isinstance(v["invalid"], str) and CF.js_len(v["invalid"]) <= 200:
            sites[k] = {"invalid": v["invalid"]}
        else:
            bad.append("searchSites." + k)
    if len(o) > 20:
        bad.append("searchSites")
    return sites, bad


def clean_gens(o, names, what, most):
    out, bad = {}, []
    if o is MISSING:
        return out, [what]
    if not truthy(o) or not is_obj(o):
        return out, [what]
    for k in keys(o):
        if k not in names or k in JS_PROTO:
            bad.append(what + "." + k)
        elif gen_ok(o[k]):
            out[k] = o[k]
        else:
            bad.append(what + "." + k)
    bad.extend(what + "." + n for n in names if n not in o)
    if len(out) > most:
        bad.append(what)
    return out, bad


def search_in(o):
    return isinstance(o.get("snapshot"), str) and "{jira.search}" in o["snapshot"]


def search_steps(mp):
    return [st for st in mp["steps"] if st["type"] == "jira.search"]


def search_read(o):
    """R.searchRead: (the containers as the reader keeps them, what it dropped or damaged), or None."""
    try:
        mp = CF.parse_map(o["snapshot"])
    except Exception:  # noqa: BLE001 - a checklist that can't be read has no searches here
        return None
    ids = [st["id"] for st in search_steps(mp)]
    a, ab = clean_sites(o.get("searchSites", MISSING))
    g, gb = clean_gens(o.get("searchGen", MISSING), mp["context"], "searchGen", 40)
    c, cb = clean_gens(o.get("searchRec", MISSING), ids, "searchRec", 200)
    return {"searchSites": a, "searchGen": g, "searchRec": c}, ab + gb + cb


def reopen_at_read(r):
    """R.reopenAtRead, as far as a verdict needs it: the places it would rebuild or reopen (each a repair), [] when none."""
    try:
        mp = CF.parse_map(r["snapshot"])
    except Exception:  # noqa: BLE001
        return []
    ss = search_steps(mp)
    if not ss:
        return []
    out = []
    if r["state"] == "completed":
        g, rc = r.get("searchGen"), r.get("searchRec")
        if any(any(d in search_uses(x["fields"], mp["context"]) for x in ss) and not (g and gen_ok(g.get(d))) for d in mp["context"]) or any(not (rc and gen_ok(rc.get(x["id"]))) for x in ss):
            out.append("searchRec")
    for x in ss:
        a = r["steps"].get(x["id"])
        if not a or applies(r, mp, x) is False:
            continue
        if a["s"] == "done" and search_stands(r, mp, x, a):
            out.append("steps." + x["id"])
        elif a["s"] == "open" and isinstance(a.get("reason"), str) and a["reason"].startswith(SEARCH_PREFIX):
            h = (a.get("history") or [None])[-1]
            if h and h["s"] == "done" and search_stands(r, mp, x, h):
                out.append("steps." + x["id"] + ".reopened")
    return out

def valid(o):
    return (is_obj(o) and o.get("format") in (FORMAT, FORMAT3) and isinstance(o.get("id"), str) and bool(RUN_ID.match(o["id"]))
            and isinstance(o.get("snapshot"), str) and truthy(o.get("steps", MISSING)) and truthy(o.get("gates", MISSING)) and truthy(o.get("recorder", MISSING)))


def folder_ok(f):
    return isinstance(f, str) and bool(VERSION.match(f))


def detail_unit(o):
    if not is_obj(o) or o.get("format") != FORMAT3 or not isinstance(o.get("snapshot"), str) or "pattern(" not in o["snapshot"]:
        return "utf16"
    try:
        return "cp" if "detail-patterns" in CF.features(CF.parse_map(o["snapshot"]), {}) else "utf16"
    except Exception:  # noqa: BLE001 - a checklist the reader can't parse counts as before
        return "utf16"


def unknown3(o):
    extra = [f for f in o if f not in KNOWN["run3"] and not f.startswith("_")]
    if extra:
        return "field"
    p = o.get("payload", MISSING)
    if not isinstance(o.get("features"), list) or not (isinstance(o.get("typesHash"), str) and HEX8.match(o["typesHash"])):
        return "features"
    if p is not MISSING and p is not None:
        if not is_obj(p) or not (isinstance(p.get("map"), str) and HEX64.match(p["map"])) or not (isinstance(p.get("types"), str) and HEX64.match(p["types"])) or not is_obj(p.get("images")) or not is_obj(p.get("extensions")) or not is_obj(p.get("pins")):
            return "payload"
        if any(k not in ("map", "types", "images", "extensions", "pins") for k in p):
            return "payload"
        if any(not (isinstance(v, str) and HEX64.match(v)) for v in p["images"].values()):
            return "payload"
        if p["extensions"]:
            return "extensions"
        if not CF.pins_ok(p["pins"]):
            return "pins"
    pins = o.get("pins", MISSING)
    if pins is not MISSING and pins is not None and (not is_obj(pins) or any(k != "children" for k in pins) or not CF.pins_ok({"children": pins.get("children") if truthy(pins.get("children", MISSING)) else {}})):
        return "pins"
    return ""


def clean_living(v):
    if not is_obj(v) or not isinstance(v.get("head"), str) or not HEAD.match(v["head"]):
        return None
    ks = sorted(v)
    if len(ks) == 1:
        return {"head": v["head"]}
    if ks == ["head", "receipt"] and isinstance(v.get("receipt"), str) and REQ.match(v["receipt"]):
        return {"head": v["head"], "receipt": v["receipt"]}
    return None


def item_ref(v):
    if not is_obj(v) or any(k not in ("uid", "key", "attempt", "request") for k in v):
        return None
    if "request" in v and not (isinstance(v["request"], str) and REQ.match(v["request"])):
        return None
    a = v.get("attempt")
    if not isinstance(v.get("uid"), str) or not ITEM_UID.match(v["uid"]) or not isinstance(v.get("key"), str) or CF.js_len(v["key"]) > 40 or not (is_num(a) and math.isfinite(a) and math.floor(a) == a) or a < 1 or a > 999:
        return None
    out = {"uid": v["uid"], "key": v["key"], "attempt": a}
    if truthy(v.get("request", MISSING)):
        out["request"] = v["request"]
    return out


def uses(o, feature):
    return o.get("format") == FORMAT3 and isinstance(o.get("features"), list) and feature in o["features"]


def value_problem(v):
    """PF.teamValues.valueProblem: text, not empty, no control character, nothing JavaScript's trim would take off its ends,
    at most 120 UTF-16 code units; '' when the value holds."""
    if not isinstance(v, str):
        return "not text"
    if not v:
        return "empty"
    if re.search("[\x00-\x1f\x7f]", v):
        return "a control character"
    if v != CF.js_trim(v):
        return "spaces at the start or end"
    if CF.js_len(v) > 120:
        return "over 120 characters"
    return ""


def team_record(tp):
    """teamRecord: a link's record of the team values its child was passed, as this copy writes it."""
    if not is_obj(tp) or len(tp) > 60:
        return None
    out = {}
    for k, e in tp.items():
        if not WORD_KEY.match(k) or k == "__proto__" or not is_obj(e):
            return None
        ks = " ".join(sorted(e))
        if ks == "typed":
            if e["typed"] is not True:
                return None
            out[k] = {"typed": True}
            continue
        if not isinstance(e.get("text"), str) or value_problem(e["text"]):
            return None
        if ks == "text":
            out[k] = {"text": e["text"]}
            continue
        c = e.get("confirmed")
        if ks != "confirmed text" or not is_obj(c) or " ".join(sorted(c)) != "at by" or not isinstance(c.get("by"), str) or not c["by"] or CF.js_len(c["by"]) > 80 or not iso(c.get("at")):
            return None
        out[k] = {"text": e["text"], "confirmed": {"by": c["by"], "at": c["at"]}}
    return out


def newer(o):
    """R's newer(): a field or state a newer Flightdeck wrote (or, in run/3, a value sanitize would rewrite), or ''."""
    three, unit = o.get("format") == FORMAT3, (detail_unit(o) if o.get("format") == FORMAT3 else "utf16")
    why = [""]

    def look(v, kind, where):
        if why[0] or not is_obj(v):
            return
        extra = [f for f in keys(v) if f not in KNOWN[kind] and not (kind == "run" and f.startswith("_"))]
        if extra:
            why[0] = where + " has " + extra[0]

    def each(lst, kind, where):
        if isinstance(lst, list):
            for v in lst:
                look(v, kind, where)

    def text(v, where, mx=None, u=None):
        if why[0] or not is_obj(v):
            return
        bad = [f for f in keys(v) if (v[f] is not None if not three else True) and not isinstance(v[f], str)]
        if bad:
            why[0] = where + " isn't text"
            return
        if three and mx:
            if any(isinstance(v[f], str) and text_len(v[f], u or "utf16") > mx for f in keys(v)):
                why[0] = where + " is too long"

    def state(ok, v, where):
        if not why[0] and v is not MISSING and v is not None and not own(ok, v):
            why[0] = where + " state"

    g = lambda v, k: get(v, k)  # noqa: E731
    look(o, "run3" if three else "run", "The run")
    state(RUN_STATES, o.get("state", MISSING), "Its state")
    look(o.get("recorder"), "recorder", "Its recorder")
    look(g(o.get("recorder", MISSING), "handoff") if truthy(o.get("recorder", MISSING)) else MISSING, "handoff", "Its hand-off")
    look(o.get("ended"), "ended", "How it ended")
    if is_obj(o.get("ended")):
        state(OUTCOMES, o["ended"].get("outcome", MISSING), "How it ended")
    look(o.get("paused"), "paused", "Its pause")
    each(o.get("pauses"), "pause", "A pause")
    each(o.get("followUps"), "followUp", "A follow-up")
    each(o.get("log"), "log", "A log entry")
    look(o.get("parent"), "parent3" if three else "parent", "Its parent run")
    par = o.get("parent", MISSING)
    if not why[0] and three and is_obj(par) and "item" in par and not item_ref(par["item"]):
        why[0] = "item"
    if three:
        if not why[0] and is_obj(par) and "folder" in par and not folder_ok(par["folder"]):
            why[0] = "parent folder"
        app = o.get("app", MISSING)
        if not why[0] and app is not MISSING and not (isinstance(app, str) and CF.js_len(app) <= 40 and APP.match(app)):
            why[0] = "app"
        for k in ("features", "app", "typesHash", "payload", "pins", "migrations"):
            if not why[0] and k in o and o[k] is None:
                why[0] = k + " empty"
        pins = o.get("pins", MISSING)
        if not why[0] and is_obj(pins) and not (is_obj(pins.get("children")) and len(pins["children"])):
            why[0] = "pins"
        feats = o.get("features")
        if not why[0] and isinstance(feats, list) and [f for f in CF.FROZEN if f in feats] != feats:
            why[0] = "features order"
        lf = isinstance(feats, list) and "living-runs" in feats
        lv = o.get("living", MISSING)
        if not why[0] and lv is not MISSING and not clean_living(lv):
            why[0] = "living"
        if not why[0] and (lv is not MISSING) != lf:
            why[0] = "living feature"
        if not why[0] and is_obj(lv) and "receipt" in lv and not is_obj(o.get("ended")):
            why[0] = "receipt"
    if three and is_obj(o.get("pins")):
        look(o["pins"], "pins", "Its pins")
    if is_obj(par):
        text(par.get("inputs"), "Its parent run's details", 300)
    text(o.get("details"), "A run detail", DETAIL_MAX, unit)
    text(o.get("roles"), "A role", 80)
    if is_obj(o.get("fields")):
        for k in keys(o["fields"]):
            text(o["fields"][k], "A filled-in value", 300)
    if isinstance(o.get("lineage"), list) and any(not isinstance(t, str) for t in o["lineage"]):
        why[0] = why[0] or "lineage"
    if is_obj(o.get("jira")):
        for k in keys(o["jira"]):
            w = o["jira"][k]
            look(w, "workflow", "jira")
            if is_obj(w) and isinstance(w.get("transitions"), list):
                for t in w["transitions"]:
                    look(t, "transition", "jira")
                    if is_obj(t):
                        each(t.get("fields"), "jiraField", "jira")
    mf = o.get("marksFrom", MISSING)
    if mf is not MISSING and mf is not None and mf != "start":
        why[0] = why[0] or "marksFrom"
    if is_obj(o.get("marks")):
        for k in keys(o["marks"]):
            if isinstance(o["marks"][k], list):
                for m in o["marks"][k]:
                    state(MARKS, m, "A mark")
    if is_obj(o.get("steps")):
        for k in keys(o["steps"]):
            a = o["steps"][k]
            if not is_obj(a):
                continue
            look(a, "step3" if three else "step", "Step")
            state(STEP_STATES, a.get("s", MISSING), "Step")
            look(a.get("started"), "started", "Step")
            look(a.get("deadline"), "deadline", "Step")
            look(a.get("differently"), "differently", "Step")
            ch = a.get("child", MISSING)
            look(ch, "child3" if three else "child", "Step")
            if three and not why[0] and is_obj(ch) and "folder" in ch and not folder_ok(ch["folder"]):
                why[0] = "child folder"
            if three and not why[0] and is_obj(ch) and "teamPassed" in ch and not (uses(o, "team-values") and team_record(ch["teamPassed"]) is not None):
                why[0] = "teamPassed"
            if three and not why[0] and is_obj(ch) and "result" in ch and not (uses(o, "module-results") and isinstance(ch["result"], str) and CF.js_len(ch["result"]) <= 40):
                why[0] = "result"
            if three and not why[0] and is_obj(ch) and "answer" in ch and not (uses(o, "module-results") and isinstance(ch["answer"], str) and re.match(r"^[0-9TZ:.+-]{0,40} [0-9TZ:.+-]{0,40}\Z", ch["answer"], re.A)):
                why[0] = "answer"
            if three:
                look(a.get("skill"), "skillSeen", "Step")
                if not why[0] and "skill" in a and clean_skill(a["skill"]) is None:
                    why[0] = "skill"
            if three and not why[0] and "loop" in a and clean_snapshot(a["loop"]) is None:
                why[0] = "loop"
            if three and not why[0] and "todos" in a and not ("living" in o and clean_cut(a["todos"]) is not None):
                why[0] = "todos"
            text(a.get("values"), "Step evidence", 300)
            if is_obj(ch):
                text(ch.get("inputs"), "Step child detail", 300)
            if isinstance(a.get("history"), list):
                for h in a["history"]:
                    look(h, "history3" if three else "history", "Step history")
                    if three and is_obj(h):
                        look(h.get("skill"), "skillSeen", "Step history")
                        if not why[0] and "skill" in h and clean_skill(h["skill"]) is None:
                            why[0] = "history skill"
                    if is_obj(h) and h.get("s", MISSING) != "corrected":
                        state(STEP_STATES, h.get("s", MISSING), "Step history")
                    if is_obj(h):
                        look(h.get("differently"), "differently", "Step history")
                        text(h.get("values"), "Step earlier evidence")
                        text(h.get("fields"), "Step earlier value")
    if is_obj(o.get("gates")):
        for k in keys(o["gates"]):
            gt = o["gates"][k]
            if not is_obj(gt):
                continue
            look(gt, "gate3" if three else "gate", "Gate")
            state(GATE_STATES, gt.get("s", MISSING), "Gate")
            if three and not why[0] and "todos" in gt and not ("living" in o and clean_cut(gt["todos"]) is not None):
                why[0] = "gate todos"
            state(GATE_STATES, gt.get("was", MISSING), "Gate")
            text(gt.get("approved"), "Gate approval", DETAIL_MAX, unit)
    return why[0]


def long_ids(o):
    where = [""]

    def ident(v):
        if not where[0] and isinstance(v, str) and CF.js_len(v) > 80:
            where[0] = "id"

    def each(lst, f):
        if isinstance(lst, list):
            for x in lst:
                if is_obj(x):
                    f(x)

    rec = o.get("recorder")
    if is_obj(rec):
        ident(rec.get("person"))
        if is_obj(rec.get("handoff")):
            ident(rec["handoff"].get("from"))
    if is_obj(o.get("ended")):
        ident(o["ended"].get("by"))
    ident(o.get("createdBy"))
    if is_obj(o.get("paused")):
        ident(o["paused"].get("by"))
    each(o.get("pauses"), lambda p: ident(p.get("by")))
    if js_object(o.get("roles")):
        for k in keys(o["roles"]):
            ident(get(o["roles"], k))
    each(o.get("followUps"), lambda f: (ident(f.get("owner")), ident(f.get("by"))))
    each(o.get("log"), lambda x: ident(x.get("by")))
    if js_object(o.get("steps")):
        for k in keys(o["steps"]):
            a = get(o["steps"], k)
            if not js_object(a):
                continue
            for h in [a] + (a.get("history") if is_obj(a) and isinstance(a.get("history"), list) else []):
                if not js_object(h) or not is_obj(h):
                    continue
                ident(h.get("by"))
                for f in ("started", "deadline", "differently"):
                    if is_obj(h.get(f)):
                        ident(h[f].get("by"))
    if js_object(o.get("gates")):
        for k in keys(o["gates"]):
            gt = get(o["gates"], k)
            if is_obj(gt):
                ident(gt.get("by"))
    return where[0]


def test_problem(o):
    f = o.get("features") if isinstance(o.get("features"), list) else []
    has = "test" in o or "stage" in o or "test-run" in f or "staged" in f
    if not has:
        return "stage folder" if isinstance(o.get("folder"), str) and STAGE.match(o["folder"]) else ""
    st = o.get("stage", MISSING)
    if o.get("test") is not True:
        return "test"
    if not is_obj(st) or list(st) != ["folder"]:
        return "stage"
    if not isinstance(st["folder"], str) or not STAGE.match(st["folder"]) or st["folder"] != o.get("folder"):
        return "stage folder"
    if "staged" not in f or "test-run" not in f:
        return "features"
    if o.get("payload") is None:
        return "payload"
    v = o.get("version")
    if not is_num(v) or v < 1 or not whole_num(v):
        return "version"
    ks = list(o)
    if len(ks) < 2 or ks[-2] != "test" or ks[-1] != "stage":
        return "order"
    return ""


def bad_times(o, r):
    n = 0
    if o.get("created") is not None and "created" in o and not iso(o["created"]):
        n += 1
    e = o.get("ended")
    if js_object(e) and is_obj(e) and own(OUTCOMES, e.get("outcome", MISSING)) and r.get("ended") is None:
        n += 1
    if isinstance(o.get("pauses"), list) and any(truthy(p) and not (iso(get(p, "from")) and iso(get(p, "to"))) for p in o["pauses"][:500]):
        n += 1
    if js_object(o.get("paused")) and truthy(o.get("paused")) and r.get("state") == "running" and r.get("paused") is None:
        n += 1
    if isinstance(o.get("log"), list) and any(js_object(x) and truthy(x) and not iso(get(x, "at")) for x in o["log"][-LOG_MAX:]):
        n += 1
    return n


def values(v):
    c = {}
    if truthy(v) and js_object(v):
        for k in keys(v)[:120]:
            if VALUE_KEY.match(k):
                c[k] = s(get(v, k), 300)
    return c


def inputs_of(v):
    c = {}
    if truthy(v) and js_object(v):
        for k in keys(v)[:60]:
            if WORD_KEY.match(k):
                c[k] = s(get(v, k), 300)
    return c


def stamp(v):
    return {"by": s(get(v, "by"), 80), "at": get(v, "at")} if truthy(v) and js_object(v) and iso(get(v, "at")) else MISSING


def jira_check(o):
    """The run's own copy of its Jira workflows as PF.jira.check keeps them (anything it refuses is an invalid marker, which
    differs from the file and is named by repairs)."""
    return {"#broken": {"invalid": True}} if jira_errors(o) else jira_clean(o)


def sanitize(o):
    """R.sanitize: the run as the app keeps it ({}-free JSON, as JSON.parse(JSON.stringify(r)) gives it) and why it is
    read-only (_unrunnable), or None when it isn't a run at all."""
    if not valid(o):
        return name_only_of(o)
    three = o["format"] == FORMAT3
    if o.get("features") is not None or three:
        env = CF.judge("preflight-run", o)
        if not env["ok"]:
            return name_only(o) if env["kind"] == "newer" else None
    unit = detail_unit(o)
    if three and unknown3(o):
        return name_only(o)
    rec = o["recorder"]
    r = {"format": FORMAT, "id": o["id"], "process": s(o.get("process"), 60), "version": count(o.get("version", MISSING)), "folder": s(o.get("folder"), 60),
         "mapHash": s(o.get("mapHash"), 16), "title": s(o.get("title"), 100) or "Untitled run", "category": s(o.get("category"), 60), "snapshot": o["snapshot"],
         "types": o["types"] if truthy(o.get("types", MISSING)) and js_object(o.get("types")) else {}, "details": {}, "roles": {},
         "recorder": {"person": s(get(rec, "person"), 80), "session": CF.js_slice(get(rec, "session"), 40) if isinstance(get(rec, "session"), str) else None},
         "followUps": [], "shotsFrozen": o.get("shotsFrozen") is True, "jira": jira_check(o["jira"]) if truthy(o.get("jira", MISSING)) else {}, "pauses": [], "paused": None,
         "lineage": [t for t in o["lineage"] if isinstance(t, str) and LINEAGE.match(t)][-200:] if isinstance(o.get("lineage"), list) else [],
         "state": o["state"] if own(RUN_STATES, o.get("state", MISSING)) else "running", "created": iso(o.get("created")) or "1970-01-01T00:00:00.000Z",
         "createdBy": s(o.get("createdBy"), 80), "tz": s(o.get("tz"), 60), "steps": {}, "gates": {}, "fields": {}, "log": [], "ended": None,
         "rev": count(o.get("rev", MISSING)), "savedAt": iso(o.get("savedAt")), "savedBy": s(o.get("savedBy"), 40)}
    for p in (o["pauses"][:500] if isinstance(o.get("pauses"), list) else []):
        if truthy(p) and iso(get(p, "from")) and iso(get(p, "to")):
            r["pauses"].append({"from": get(p, "from"), "to": get(p, "to"), "by": s(get(p, "by"), 80), "reason": s(get(p, "reason"), 120)})
    marks = o.get("marks", MISSING)
    mkeys = keys(marks) if truthy(marks) and js_object(marks) else []
    if o.get("marksFrom") == "start" and len(mkeys) <= 5000:
        r["marksFrom"] = "start"
    if truthy(marks) and js_object(marks):
        for k in mkeys[:5000]:
            mv = get(marks, k)
            if k != "__proto__" and WORD_KEY.match(k) and isinstance(mv, list):
                v = [x for x in mv if x in ("blocked", "recheck", "na", "differently")]
                if v:
                    r.setdefault("marks", {})[k] = v
    pa = o.get("paused", MISSING)
    if truthy(pa) and iso(get(pa, "at")) and r["state"] == "running":
        r["paused"] = {"by": s(get(pa, "by"), 80), "at": get(pa, "at"), "reason": s(get(pa, "reason"), 120) or "Paused"}
    par = o.get("parent", MISSING)
    if truthy(par) and js_object(par) and LOOSE_ID.match(js_string(get(par, "process"))) and CHILD_ID.match(js_string(get(par, "id"))):
        r["parent"] = {"process": get(par, "process"), "id": get(par, "id"), "step": s(get(par, "step"), 60)}
        if truthy(get(par, "inputs")) and js_object(get(par, "inputs")):
            r["parent"]["inputs"] = inputs_of(get(par, "inputs"))
        if three and folder_ok(get(par, "folder")):
            r["parent"]["folder"] = get(par, "folder")
        if three and item_ref(get(par, "item")):
            r["parent"]["item"] = item_ref(get(par, "item"))
    ho = get(rec, "handoff")
    if truthy(ho) and js_object(ho) and not r["recorder"]["session"]:
        r["recorder"]["handoff"] = {"from": s(get(ho, "from"), 80), "rev": count(get(ho, "rev")), "at": iso(get(ho, "at"))}
    for f in (o["followUps"][:100] if isinstance(o.get("followUps"), list) else []):
        t = get(f, "text") if truthy(f) else MISSING
        if truthy(f) and isinstance(t, str) and CF.js_trim(t):
            r["followUps"].append({"id": s(get(f, "id"), 20), "text": s(t, 300), "owner": s(get(f, "owner"), 80), "ticket": s(get(f, "ticket"), 120), "step": s(get(f, "step"), 60),
                                   "from": s(get(f, "from"), 20), "by": s(get(f, "by"), 80), "at": iso(get(f, "at"))})
    flds = o.get("fields", MISSING)
    for k in keys(flds if truthy(flds) else {}):
        if FIELD_STEP.match(k):
            v = values(get(flds, k))
            if v:
                r["fields"][k] = v
    dets = o.get("details", MISSING)
    for k in keys(dets if truthy(dets) else {}):
        v = get(dets, k)
        r["details"][k] = cut(v, DETAIL_MAX, unit) if isinstance(v, str) else ""
    rls = o.get("roles", MISSING)
    for k in keys(rls if truthy(rls) else {}):
        r["roles"][k] = s(get(rls, k), 80)
    for k in keys(o["steps"]):
        a = get(o["steps"], k)
        if not truthy(a) or not own(STEP_STATES, get(a, "s")) or k == "__proto__":
            continue
        c = {"s": a["s"], "by": s(a.get("by"), 80), "at": iso(a.get("at"))}
        if s(a.get("reason"), 120):
            c["reason"] = s(a.get("reason"), 120)
        st = stamp(a.get("started", MISSING))
        if st is not MISSING:
            c["started"] = st
        dl = a.get("deadline", MISSING)
        if truthy(dl) and iso(get(dl, "at")):
            c["deadline"] = {"at": get(dl, "at"), "by": s(get(dl, "by"), 80), "set": iso(get(dl, "set"))}
        df = a.get("differently", MISSING)
        if truthy(df) and js_object(df):
            c["differently"] = {"note": s(get(df, "note"), 500), "by": s(get(df, "by"), 80), "at": iso(get(df, "at"))}
        if truthy(a.get("values", MISSING)):
            c["values"] = values(a["values"])
        ch = a.get("child", MISSING)
        if truthy(ch) and LOOSE_ID.match(js_string(get(ch, "process"))) and CHILD_ID.match(js_string(get(ch, "id"))):
            cc = {"process": get(ch, "process"), "id": get(ch, "id")}
            if truthy(get(ch, "inputs")) and js_object(get(ch, "inputs")):
                cc["inputs"] = inputs_of(get(ch, "inputs"))
            if get(ch, "failed") is True:
                cc["failed"] = True
            if three and get(ch, "retired") is True:
                cc["retired"] = True
            if three and folder_ok(get(ch, "folder")):
                cc["folder"] = get(ch, "folder")
            if three and uses(o, "team-values") and team_record(get(ch, "teamPassed")) is not None:
                cc["teamPassed"] = team_record(get(ch, "teamPassed"))
            if three and uses(o, "module-results") and isinstance(get(ch, "result"), str):
                cc["result"] = CF.js_slice(ch["result"], 40)
            if three and uses(o, "module-results") and isinstance(get(ch, "answer"), str):
                cc["answer"] = CF.js_slice(ch["answer"], 81)
            c["child"] = cc
        if three and truthy(a.get("skill", MISSING)) and clean_skill(a["skill"]) is not None:
            c["skill"] = clean_skill(a["skill"])
        if three and truthy(a.get("loop", MISSING)) and clean_snapshot(a["loop"]) is not None:
            c["loop"] = clean_snapshot(a["loop"])
        if three and truthy(a.get("todos", MISSING)) and clean_cut(a["todos"]) is not None:
            c["todos"] = clean_cut(a["todos"])
        if isinstance(a.get("history"), list):
            hist = []
            for h in a["history"][-HISTORY_MAX:]:
                hs = get(h, "s") if truthy(h) else MISSING
                if not truthy(h) or not (own(STEP_STATES, hs) or hs == "corrected"):
                    continue
                x = {"s": hs, "by": s(get(h, "by"), 80), "at": iso(get(h, "at"))}
                if s(get(h, "reason"), 120):
                    x["reason"] = s(get(h, "reason"), 120)
                if truthy(get(h, "differently")):
                    x["differently"] = {"note": s(get(get(h, "differently"), "note"), 500)}
                if truthy(get(h, "values")):
                    x["values"] = values(get(h, "values"))
                if truthy(get(h, "fields")):
                    x["fields"] = values(get(h, "fields"))
                if three and truthy(get(h, "skill")) and clean_skill(get(h, "skill")) is not None:
                    x["skill"] = clean_skill(get(h, "skill"))
                if three and truthy(get(h, "loop")) and clean_snapshot(get(h, "loop")) is not None:
                    x["loop"] = clean_snapshot(get(h, "loop"))
                hist.append(x)
            c["history"] = hist
        r["steps"][k] = c
    for k in keys(o["gates"]):
        gt = get(o["gates"], k)
        if not truthy(gt) or not own(GATE_STATES, get(gt, "s")) or k == "__proto__":
            continue
        c = {"s": gt["s"], "by": s(gt.get("by"), 80), "at": iso(gt.get("at"))}
        if s(gt.get("reason"), 200):
            c["reason"] = s(gt.get("reason"), 200)
        if own(GATE_STATES, gt.get("was", MISSING)):
            c["was"] = gt["was"]
        c["approved"] = {}
        ap = gt.get("approved", MISSING)
        for f in keys(ap if truthy(ap) else {}):
            v = get(ap, f)
            c["approved"][f] = cut(v, DETAIL_MAX, unit) if isinstance(v, str) else ""
        if three and truthy(gt.get("todos", MISSING)) and clean_cut(gt["todos"]) is not None:
            c["todos"] = clean_cut(gt["todos"])
        r["gates"][k] = c
    for x in (o["log"][-LOG_MAX:] if isinstance(o.get("log"), list) else []):
        if truthy(x) and iso(get(x, "at")):
            r["log"].append({"at": get(x, "at"), "by": s(get(x, "by"), 80), "what": s(get(x, "what"), 300)})
    e = o.get("ended", MISSING)
    if truthy(e) and own(OUTCOMES, get(e, "outcome")) and iso(get(e, "at")):
        r["ended"] = {"outcome": e["outcome"], "by": s(e.get("by"), 80), "byName": s(e.get("byName"), 80), "at": e["at"]}
    r["_bad_times"] = bad_times(o, r)
    why = ""
    try:
        why = CF.unrunnable(r["snapshot"], r["types"]) if is_obj(r["types"]) else CF.unrunnable(r["snapshot"], {})
    except Exception:  # noqa: BLE001 - a step type that can't be read makes the run read-only, as the app reports it
        why = "types"
    why = why or newer(o) or long_ids(o)
    if not why and three and unit == "cp" and not (isinstance(o.get("features"), list) and "detail-patterns" in o["features"]):
        why = "detail-patterns"
    if three:
        r["format"] = FORMAT3
        if isinstance(o.get("features"), list):
            r["features"] = [f for f in CF.FROZEN if f in o["features"]]
        if isinstance(o.get("app"), str) and APP.match(o["app"]):
            r["app"] = CF.js_slice(o["app"], 40)
        r["typesHash"] = s(o.get("typesHash"), 16)
        if o.get("payload") is not None and "payload" in o:
            r["payload"] = js_copy(whole(o["payload"]))
        pins = o.get("pins", MISSING)
        if truthy(pins) and truthy(get(pins, "children")) and keys(get(pins, "children")):
            r["pins"] = {"children": js_copy(whole(pins["children"]))}
        if isinstance(o.get("migrations"), list):
            r["migrations"] = js_copy(whole(o["migrations"]))
        lv = o.get("living", MISSING)
        if lv is not MISSING and clean_living(lv):
            r["living"] = clean_living(lv)
        # Jira searches (2.16): the containers read into fresh objects with only valid entries (section 5.6).
        if search_in(o):
            sc = search_read(o)
            if sc:
                r.update(sc[0])
        # Typed values against the run's own checklist; migration records not in their frozen shape make it name-only.
        tmap = None
        if r["snapshot"] and not why:
            try:
                tmap = CF.parse_map(r["snapshot"])
            except Exception:  # noqa: BLE001 - a checklist the reader can't parse has no typed values here
                tmap = None
        if tmap and not migrations_ok(o, tmap, r):
            return name_only(o)
        if not tmap and isinstance(o.get("migrations"), list) and o["migrations"]:
            return name_only(o)
        r["_invalid"] = invalid_values(r, tmap) if tmap else []
        tp = test_problem(o)
        if tp:
            why = why or "test"
        elif o.get("test") is True:
            r["test"] = True
            r["stage"] = {"folder": get(o.get("stage"), "folder")}
    r["_unrunnable"] = why
    if three and not why and r["snapshot"]:
        try:
            r["_search_repairs"] = reopen_at_read(r)
        except Exception:  # noqa: BLE001 - where the app's reader throws, the run file isn't read: named at run.json
            r["_search_repairs"] = ["(unreadable)"]
    return r


def name_only_of(o):
    """newerFormat: a run file in a format this copy doesn't know, listed by name only (read-only), or None."""
    if not is_obj(o) or not isinstance(o.get("format"), str) or not o["format"].startswith("preflight-run/"):
        return None
    env = CF.judge("preflight-run", o)
    if env["ok"] and o["format"] == FORMAT3:
        return name_only(o)
    if env["ok"] or env["kind"] != "newer":
        return None
    return name_only(o)


def name_only(o):
    if not isinstance(o.get("id"), str) or not RUN_ID.match(o["id"]):
        return None
    return {"id": o["id"], "process": s(o.get("process"), 60), "folder": s(o.get("folder"), 60), "mapHash": s(o.get("mapHash"), 16), "version": count(o.get("version", MISSING)),
            "_unrunnable": "name only", "_name_only": True}


def jira_errors(o):
    """Whether PF.jira.check finds anything wrong in a run's copy of its Jira workflows (sanitize then keeps it as an invalid
    marker, and every reader names it), as a list of the issue types it refuses."""
    def tstr(v, n):
        return CF.js_slice(CF.js_trim(v), n) if isinstance(v, str) else ""
    if not is_obj(o):
        return ["#file"]
    errs = []
    ks = CF.js_keys(o)
    if len(ks) > 50:
        errs.append("over")
    low = {}
    for t in ks:
        low[t.lower()] = low.get(t.lower(), 0) + 1
    for t in ks[:50]:
        if t != "#file" and low[t.lower()] > 1:
            errs.append(t)
            continue
        if t == "#file":
            errs.append(t)
            continue
        w = o[t]
        if not js_object(w) or w is None:
            errs.append(t)
            continue
        st_raw = get(w, "statuses")
        if isinstance(st_raw, list) and any(not isinstance(x, str) or CF.js_len(CF.js_trim(x)) > 60 for x in st_raw):
            errs.append(t)
            continue
        statuses = [x for x in (tstr(x, 60) for x in st_raw) if x] if isinstance(st_raw, list) else []
        if len(set(statuses)) != len(statuses) or not statuses:
            errs.append(t)
            continue
        raw = get(w, "transitions")
        if is_obj(raw):
            trans = [{"from": f, "to": x, "fields": []} for f in CF.js_keys(raw) for x in (raw[f] if isinstance(raw[f], list) else [])]
        elif isinstance(raw, list):
            trans = raw
        else:
            errs.append(t)
            continue
        if len(trans) > 300:
            errs.append(t)
            continue
        bad, clean = False, []
        for tr in trans:
            if not js_object(tr) or tr is None:
                bad = True
                continue
            fr, to = tstr(get(tr, "from"), 60) or "*", tstr(get(tr, "to"), 60)
            if to not in statuses or (fr != "*" and fr not in statuses):
                bad = True
                continue
            fl = get(tr, "fields")
            if fl is not MISSING and fl is not None and not isinstance(fl, list):
                bad = True
                continue
            if isinstance(fl, list) and len(fl) > 20:
                bad = True
                continue
            fields = []
            for f in (fl if isinstance(fl, list) else []):
                name = tstr(get(f, "name"), 200) if truthy(f) else ""
                if not name or CF.js_len(name) > 60:
                    bad = True
                    continue
                op = get(f, "options")
                if op is not MISSING and op is not None and (not isinstance(op, list) or not op or len(op) > 30 or any(not isinstance(x, str) or not CF.js_trim(x) or CF.js_len(CF.js_trim(x)) > 40 for x in op)):
                    bad = True
                    continue
                src = get(f, "source")
                src = "" if src is MISSING or src is None else tstr(src, 80)
                if src and not re.match(r"^(detail|role):[\w-]{1,40}\Z|^value:.{1,80}\Z", src, re.A):
                    bad = True
                    continue
                opts = [x for x in (tstr(x, 40) for x in op) if x][:30] if isinstance(op, list) else None
                fields.append({"name": name, "source": src, "options": opts or None})
            clean.append({"to": to, "fields": fields})
        for st in statuses:
            names, keyset, n = {}, {}, 0
            for tr in clean:
                if tr["to"] != st:
                    continue
                for f in tr["fields"]:
                    lowname = f["name"].lower()
                    sig = json.dumps([sorted(f["options"]) if f["options"] else None, f["source"] or ""])
                    if lowname in names:
                        bad = bad or names[lowname] != sig
                        continue
                    names[lowname] = sig
                    n += 1
                    k = jira_key(f["name"])
                    bad = bad or k in keyset
                    keyset[k] = True
            bad = bad or n > 40
        if bad:
            errs.append(t)
    return errs


def fnv(text):
    """PF.util.hash: FNV-1a over UTF-16 code units, as 8 hex digits."""
    h = 0x811c9dc5
    u = text.encode("utf-16-le", "surrogatepass")
    for i in range(0, len(u), 2):
        h ^= u[i] | (u[i + 1] << 8)
        h = (h * 0x01000193) & 0xffffffff
    return "%08x" % h


def jira_key(name):
    slug = re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", name.lower(), flags=re.A))
    return "jf-" + (CF.js_slice(slug, 20) or "x") + "-" + fnv(CF.js_trim(name).lower())


def jira_clean(o):
    """PF.jira.check(o).workflows when it finds nothing wrong: each workflow as it keeps it."""
    def tstr(v, n):
        return CF.js_slice(CF.js_trim(v), n) if isinstance(v, str) else ""
    out = {}
    for t in CF.js_keys(o)[:50]:
        w = o[t]
        statuses = [x for x in (tstr(x, 60) for x in w["statuses"]) if x]
        raw = w["transitions"]
        trans = [{"from": f, "to": x, "fields": []} for f in CF.js_keys(raw) for x in (raw[f] if isinstance(raw[f], list) else [])] if is_obj(raw) else raw
        clean = []
        for tr in trans:
            fields = []
            for f in (get(tr, "fields") if isinstance(get(tr, "fields"), list) else []):
                op, src = get(f, "options"), get(f, "source")
                opts = [x for x in (tstr(x, 40) for x in op) if x][:30] if isinstance(op, list) else None
                fields.append({"name": tstr(get(f, "name"), 200), "hint": tstr(get(f, "hint"), 200), "source": "" if src is MISSING or src is None else tstr(src, 80), "options": opts or None})
            clean.append({"from": tstr(get(tr, "from"), 60) or "*", "to": tstr(get(tr, "to"), 60), "fields": fields})
        out[t] = {"statuses": statuses, "transitions": clean}
    return out


JS_NOT_S = "[^" + re.escape(CF.JS_WS) + "\u2028\u2029\n\r]"


def detail_valid(d, v):
    """PF.values.valid for a typed run detail: empty, or exactly its canonical text."""
    if v == "":
        return True
    kind = d["kind"]
    if kind == "pattern":
        pc = CF.compile_pattern(d["pattern"])
        return bool(pc.get("ok")) and not CF.bad_text(v) and CF.match_pattern(pc, v)[0]
    t = v.strip(CF.VALUE_WS)
    if not t:
        return False
    if kind == "link":
        ok = re.fullmatch("https?://" + JS_NOT_S + "+", t, re.I | re.A) and re.fullmatch(r"(https?://|mailto:)[^\s\"'<>]+", t, re.I)
        return bool(ok) and t == v
    c = CF._value(kind, d.get("options") or [], v)
    return c is not None and c == v


def repairs(o):
    """R.repairs: every record in a run file that sanitize drops, cuts short or replaces (where, only), [] when clean."""
    out = []
    if not valid(o):
        return out
    unit = detail_unit(o)

    def add(at):
        out.append(at)

    def text(v, mx, at):
        if v is MISSING or v is None:
            return
        if not isinstance(v, str):
            add(at)
        elif CF.js_len(v) > mx:
            add(at)

    def time(v, at):
        if v is not MISSING and v is not None and not iso(v):
            add(at)

    def cut_map(v, at):
        if v is MISSING or v is None:
            return
        if not is_obj(v):
            add(at)
            return
        for k in CF.js_keys(v):
            if not isinstance(v[k], str) or text_len(v[k], unit) > DETAIL_MAX:
                add(at + "." + k)

    def text_map(v, mx, at, key_ok=None, most=None):
        if v is MISSING or v is None:
            return
        if not is_obj(v):
            add(at)
            return
        ks = CF.js_keys(v)
        if most and len(ks) > most:
            add(at)
        for k in ks[:most or len(ks)]:
            if key_ok and not key_ok.match(k):
                add(at + "." + k)
            else:
                text(v[k], mx, at + "." + k)

    def lst(v, at, most):
        if v is MISSING or v is None:
            return []
        if not isinstance(v, list):
            add(at)
            return []
        if len(v) > most:
            add(at)
        return v

    def count_(v, at):
        if v is not MISSING and v is not None and not (is_num(v) and v >= 0 and whole_num(v)):
            add(at)

    for f, n in (("process", 60), ("folder", 60), ("mapHash", 16), ("title", 100), ("category", 60), ("createdBy", 80), ("tz", 60), ("savedBy", 40)):
        text(o.get(f, MISSING), n, f)
    count_(o.get("version", MISSING), "version")
    count_(o.get("rev", MISSING), "rev")
    time(o.get("savedAt", MISSING), "savedAt")
    ty = o.get("types", MISSING)
    if ty is not MISSING and ty is not None and not is_obj(ty):
        add("types")
    cut_map(o.get("details", MISSING), "details")
    text_map(o.get("roles", MISSING), 80, "roles")
    rec = o["recorder"]
    if not is_obj(rec):
        add("recorder")
    else:
        text(rec.get("person", MISSING), 80, "recorder.person")
        text(rec.get("session", MISSING), 40, "recorder.session")
        ho = rec.get("handoff", MISSING)
        if ho is not MISSING and ho is not None:
            if not is_obj(ho):
                add("recorder.handoff")
            elif isinstance(rec.get("session"), str) and rec["session"]:
                add("recorder.handoff")
            else:
                text(ho.get("from", MISSING), 80, "recorder.handoff.from")
                count_(ho.get("rev", MISSING), "recorder.handoff.rev")
                time(ho.get("at", MISSING), "recorder.handoff.at")
    for i, f in enumerate(lst(o.get("followUps", MISSING), "followUps", 100)[:100]):
        at = "followUps[%d]" % i
        if not truthy(f) or not isinstance(get(f, "text"), str) or not CF.js_trim(get(f, "text")):
            add(at)
            continue
        for k, n in (("id", 20), ("text", 300), ("owner", 80), ("ticket", 120), ("step", 60), ("from", 20), ("by", 80)):
            text(get(f, k), n, at + "." + k)
        time(get(f, "at"), at + ".at")
    sf = o.get("shotsFrozen", MISSING)
    if sf is not MISSING and sf is not None and not isinstance(sf, bool):
        add("shotsFrozen")
    jr = o.get("jira", MISSING)
    if jr is not MISSING and jr is not None and jira_errors(jr):
        add("jira")
    for i, x in enumerate(lst(o.get("pauses", MISSING), "pauses", 500)[:500]):
        at = "pauses[%d]" % i
        if not is_obj(x):
            add(at)
            continue
        text(x.get("by", MISSING), 80, at + ".by")
        text(x.get("reason", MISSING), 120, at + ".reason")
    pa = o.get("paused", MISSING)
    if pa is not MISSING and pa is not None:
        if not is_obj(pa):
            add("paused")
        elif not own(RUN_STATES, o.get("state", MISSING)) or o.get("state") == "running":
            text(pa.get("by", MISSING), 80, "paused.by")
            text(pa.get("reason", MISSING), 120, "paused.reason")
    for i, t in enumerate(lst(o.get("lineage", MISSING), "lineage", 200)):
        if not isinstance(t, str) or not LINEAGE.match(t):
            add("lineage[%d]" % i)
    mk = o.get("marks", MISSING)
    if mk is not MISSING and mk is not None:
        if not is_obj(mk):
            add("marks")
        else:
            ks = CF.js_keys(mk)
            if len(ks) > 5000:
                add("marks")
            for k in ks[:5000]:
                v = mk[k]
                if not WORD_KEY.match(k) or not isinstance(v, list):
                    add("marks." + k)
                else:
                    for i, m in enumerate(v):
                        if not own(MARKS, m):
                            add("marks.%s[%d]" % (k, i))
    par = o.get("parent", MISSING)
    if par is not MISSING and par is not None:
        if not is_obj(par) or not LOOSE_ID.match(js_string(par.get("process", MISSING))) or not CHILD_ID.match(js_string(par.get("id", MISSING))):
            add("parent")
        else:
            text(par.get("step", MISSING), 60, "parent.step")
            if par.get("inputs") is not None and "inputs" in par:
                text_map(par["inputs"], 300, "parent.inputs", WORD_KEY, 60)
    fl = o.get("fields", MISSING)
    if fl is not MISSING and fl is not None:
        if not is_obj(fl):
            add("fields")
        else:
            for k in CF.js_keys(fl):
                if not FIELD_STEP.match(k):
                    add("fields." + k)
                else:
                    text_map(fl[k], 300, "fields." + k, VALUE_KEY, 120)
    if not is_obj(o["steps"]):
        add("steps")
    if not is_obj(o["gates"]):
        add("gates")
    if is_obj(o["steps"]):
        for k in CF.js_keys(o["steps"]):
            a, at = o["steps"][k], "steps." + k
            if not is_obj(a) or not own(STEP_STATES, a.get("s", MISSING)):
                add(at)
                continue
            text(a.get("by", MISSING), 80, at + ".by")
            time(a.get("at", MISSING), at + ".at")
            text(a.get("reason", MISSING), 120, at + ".reason")
            stt = a.get("started", MISSING)
            if stt is not MISSING and stt is not None and stamp(stt) is MISSING:
                add(at + ".started")
            elif stt is not MISSING and stt is not None:
                text(get(stt, "by"), 80, at + ".started.by")
            dl = a.get("deadline", MISSING)
            if dl is not MISSING and dl is not None:
                if not is_obj(dl) or not iso(dl.get("at")):
                    add(at + ".deadline")
                else:
                    text(dl.get("by", MISSING), 80, at + ".deadline.by")
                    time(dl.get("set", MISSING), at + ".deadline.set")
            df = a.get("differently", MISSING)
            if df is not MISSING and df is not None:
                if not is_obj(df):
                    add(at + ".differently")
                else:
                    text(df.get("note", MISSING), 500, at + ".differently.note")
                    text(df.get("by", MISSING), 80, at + ".differently.by")
                    time(df.get("at", MISSING), at + ".differently.at")
            if a.get("values") is not None and "values" in a:
                text_map(a["values"], 300, at + ".values", VALUE_KEY, 120)
            ch = a.get("child", MISSING)
            if ch is not MISSING and ch is not None:
                if not is_obj(ch) or not LOOSE_ID.match(js_string(ch.get("process", MISSING))) or not CHILD_ID.match(js_string(ch.get("id", MISSING))):
                    add(at + ".child")
                elif ch.get("inputs") is not None and "inputs" in ch:
                    text_map(ch["inputs"], 300, at + ".child.inputs", WORD_KEY, 60)
            hs = a.get("history", MISSING)
            if hs is not MISSING and hs is not None:
                hs = lst(hs, at + ".history", HISTORY_MAX)
                off = max(0, len(hs) - HISTORY_MAX)
                for j, h in enumerate(hs[off:]):
                    hat = "%s.history[%d]" % (at, off + j)
                    if not is_obj(h) or not (own(STEP_STATES, h.get("s", MISSING)) or h.get("s") == "corrected"):
                        add(hat)
                        continue
                    text(h.get("by", MISSING), 80, hat + ".by")
                    time(h.get("at", MISSING), hat + ".at")
                    text(h.get("reason", MISSING), 120, hat + ".reason")
                    hd = h.get("differently", MISSING)
                    if hd is not MISSING and hd is not None:
                        if not is_obj(hd):
                            add(hat + ".differently")
                        else:
                            text(hd.get("note", MISSING), 500, hat + ".differently.note")
                    for f in ("values", "fields"):
                        if h.get(f) is not None and f in h:
                            text_map(h[f], 300, hat + "." + f, VALUE_KEY, 120)
    if is_obj(o["gates"]):
        for k in CF.js_keys(o["gates"]):
            g, at = o["gates"][k], "gates." + k
            if not is_obj(g) or not own(GATE_STATES, g.get("s", MISSING)):
                add(at)
                continue
            text(g.get("by", MISSING), 80, at + ".by")
            time(g.get("at", MISSING), at + ".at")
            text(g.get("reason", MISSING), 200, at + ".reason")
            if g.get("was") is not None and "was" in g and not own(GATE_STATES, g["was"]):
                add(at + ".was")
            cut_map(g.get("approved", MISSING), at + ".approved")
    logs = lst(o.get("log", MISSING), "log", LOG_MAX)
    frm = max(0, len(logs) - LOG_MAX)
    for i, x in enumerate(logs[frm:]):
        at = "log[%d]" % (frm + i)
        if not is_obj(x):
            add(at)
            continue
        text(x.get("by", MISSING), 80, at + ".by")
        text(x.get("what", MISSING), 300, at + ".what")
    pa = o.get("paused", MISSING)
    if pa is not MISSING and pa is not None:
        if not is_obj(pa):
            add("paused")
        elif not own(RUN_STATES, o.get("state", MISSING)) or o.get("state") == "running":
            text(pa.get("by", MISSING), 80, "paused.by")
            text(pa.get("reason", MISSING), 120, "paused.reason")
    e = o.get("ended", MISSING)
    if e is not MISSING and e is not None:
        if not is_obj(e) or not own(OUTCOMES, e.get("outcome", MISSING)):
            add("ended")
        else:
            text(e.get("by", MISSING), 80, "ended.by")
            text(e.get("byName", MISSING), 80, "ended.byName")
    if o.get("format") == FORMAT3:
        r = sanitize(o)
        if r and not r.get("_name_only"):
            out.extend(r.get("_invalid") or [])
        if search_in(o):
            sr = search_read(o)
            if sr:
                out.extend(sr[1])
            if r and not r.get("_name_only"):
                out.extend(r.get("_search_repairs") or [])
    return out


def segs(p):
    return re.sub(r"\[(\d+|\*)\]", r".\1", p).split(".")


def drift(raw, clean):
    """U.drift(raw, clean, R.DRIFT_ALLOW): every place the file says something the app doesn't keep as written."""
    added, dropped, out = [segs(p) for p in ALLOW_ADDED], [segs(p) for p in ALLOW_DROPPED], []

    def matches(lst, path):
        sg = segs(path)
        return any(len(q) == len(sg) and all(x == "*" or x == sg[i] for i, x in enumerate(q)) for q in lst)

    def empty(v):
        return v is MISSING or v is None or v == ""

    def hollow(v):
        return empty(v) or (isinstance(v, list) and not v) or (is_obj(v) and not [k for k in v if not k.startswith("_")])

    def kind(v):
        return "list" if isinstance(v, list) else "null" if v is None else "boolean" if isinstance(v, bool) else "number" if is_num(v) else "string" if isinstance(v, str) else "object"

    def walk(r, c, path):
        if empty(r):
            if not hollow(c) and not matches(added, path):
                out.append(path)
            return
        if c is MISSING or c is None:
            if not matches(dropped, path):
                out.append(path)
            return
        if kind(r) != kind(c):
            out.append(path)
            return
        if isinstance(r, list):
            for i in range(max(len(r), len(c))):
                walk(r[i] if i < len(r) else MISSING, c[i] if i < len(c) else MISSING, path + "[" + str(i) + "]")
            return
        if is_obj(r):
            ks = list(r) + [k for k in c if not k.startswith("_") and k not in r]
            for k in ks:
                walk(r.get(k, MISSING), c.get(k, MISSING), path + "." + k if path else k)
            return
        if r != c:
            out.append(path)

    walk(raw, clean, "")
    return out


def js_copy(v):
    """JSON.parse(JSON.stringify(v)): a number that isn't finite becomes null; a dropped (undefined) list entry, null."""
    if isinstance(v, dict):
        return {k: js_copy(x) for k, x in v.items() if x is not MISSING}
    if isinstance(v, list):
        return [None if x is MISSING else js_copy(x) for x in v]
    if isinstance(v, float) and (math.isinf(v) or math.isnan(v)):
        return None
    return v


def canonical(o, r):
    """R.canonical: the first place the file isn't exactly what the cleaner keeps (read as its JSON), or "". Two allowances
    besides DRIFT_ALLOW's: a key left out where the cleaner fills in an empty value ('', null, {} or []), and a null the
    cleaner leaves out. A value kept as written after a table lookup (state, s, was, outcome) is a string."""
    if r is None or not is_obj(o):
        return ""
    c, first = js_copy(strip(r)), [""]
    added, dropped = [segs(p) for p in ALLOW_ADDED], [segs(p) for p in ALLOW_DROPPED]

    def allowed(lst, path):
        sg = segs(path)
        return any(len(q) == len(sg) and all(x == "*" or x == sg[i] for i, x in enumerate(q)) for q in lst)

    def kind(v):
        return "list" if isinstance(v, list) else "null" if v is None else "boolean" if isinstance(v, bool) else "number" if is_num(v) else "string" if isinstance(v, str) else "object"

    def bare(v):
        return (isinstance(v, str) and v == "") or v is None or (isinstance(v, list) and not v) or (is_obj(v) and not v)

    def walk(a, b, path):
        if first[0]:
            return
        if a is MISSING:
            if b is not MISSING and not bare(b) and not allowed(added, path):
                first[0] = path
            return
        if b is MISSING:
            if a is not None and not allowed(dropped, path):
                first[0] = path
            return
        if b is None and a is not None and allowed(dropped, path):
            return  # a documented drop the cleaner writes as null (a pause left on an ended run)
        if kind(a) != kind(b):
            first[0] = path
            return
        if isinstance(a, list):
            for i in range(max(len(a), len(b))):
                if first[0]:
                    return
                walk(a[i] if i < len(a) else MISSING, b[i] if i < len(b) else MISSING, path + "[" + str(i) + "]")
            return
        if is_obj(a):
            for k in keys(a) + [k for k in keys(b) if not k.startswith("_") and k not in a]:
                walk(a.get(k, MISSING), b.get(k, MISSING), path + "." + k if path else k)
            return
        if a != b or (isinstance(a, float) and math.isnan(a)):
            first[0] = path

    def text(v, path):
        if not first[0] and v is not MISSING and v is not None and not isinstance(v, str):
            first[0] = path

    text(o.get("state", MISSING), "state")
    if is_obj(o.get("steps")):
        for k in keys(o["steps"]):
            a = o["steps"][k]
            if not is_obj(a):
                continue
            text(a.get("s", MISSING), "steps." + k + ".s")
            if isinstance(a.get("history"), list):
                for i, h in enumerate(a["history"]):
                    if is_obj(h):
                        text(h.get("s", MISSING), "steps." + k + ".history[" + str(i) + "].s")
    if is_obj(o.get("gates")):
        for k in keys(o["gates"]):
            g = o["gates"][k]
            if is_obj(g):
                text(g.get("s", MISSING), "gates." + k + ".s")
                text(g.get("was", MISSING), "gates." + k + ".was")
    if is_obj(o.get("ended")):
        text(o["ended"].get("outcome", MISSING), "ended.outcome")
    walk(o, c, "")
    return first[0]


def strip(r):
    """The kept run as JSON.parse(JSON.stringify(r)) gives it: no undefined, no bookkeeping."""
    def plain(v):
        if isinstance(v, dict):
            return {k: plain(x) for k, x in v.items() if x is not MISSING}
        if isinstance(v, list):
            return [None if x is MISSING else plain(x) for x in v]
        return v
    return plain({k: v for k, v in r.items() if not k.startswith("_")})


def same_run(text):
    try:
        o = json.loads(text)
    except ValueError:
        return "\u0000" + text
    if not is_obj(o):
        return "\u0000" + text
    return CF.js_json({k: o[k] for k in sorted(o) if k not in ("rev", "savedAt", "savedBy", "lineage")})


def utf8_text(raw):
    """Bytes as the app's TextDecoder("utf-8") decodes them (WHATWG UTF-8): each maximal invalid subpart one U+FFFD, which
    CPython's "replace" handler gives too, and a leading byte-order mark dropped."""
    text = raw.decode("utf-8", "replace")
    return text[1:] if text.startswith("\ufeff") and raw.startswith(b"\xef\xbb\xbf") else text


def utf8_read(path):
    """A file's text as the app reads it (utf8_text: TextDecoder's replacement decoding), or None when it can't be read."""
    try:
        with open(path, "rb") as f:
            return utf8_text(f.read())
    except OSError:
        return None


def parse(text):
    def no_constant(_):
        raise ValueError("not JSON")
    # The app's checked parse (its bytes decoded by utf8_text, a byte-order mark dropped there): nothing nested past
    # PF.util.JSON_DEPTH read.
    if CF.json_too_deep(text):
        return MISSING
    try:
        # A number is a double, as JSON.parse reads it: an integer past 2^53 loses its precision, and one too big is infinite.
        return json.loads(text, parse_constant=no_constant, parse_int=lambda t: int(t) if len(t.lstrip("-")) < 16 else float(t))
    except (ValueError, RecursionError):
        return MISSING


def stage_problem(info, folder):
    """PF.publish.stageProblem: why a record isn't the stage record of this folder, or ''."""
    st = info.get("stage")
    if info.get("format") != CF.PUBLICATION_FORMAT2 or not isinstance(info.get("features"), list) or "staged" not in info["features"]:
        return "It isn't a staged version."
    if not STAGE.match(folder) or info.get("folder") != folder or "version" in info:
        return "Folder name doesn't match the stage record."
    p = st.get("proposed") if is_obj(st) else None
    if not isinstance(p, (int, float)) or isinstance(p, bool) or not p >= 1 or not whole_num(p) or p > 99999:
        return "Its stage record doesn't say which number it proposes."
    if not isinstance(info.get("stagedBy"), str) or not info["stagedBy"] or not isinstance(info.get("stagedAt"), str) or not info["stagedAt"]:
        return "Its stage record doesn't say who staged it, or when."
    return ""


def check_stage(folder, name):
    """CF.check_publication for a stage under staged/ (PF.publish.verify with stage): the same envelope, hashes, payload,
    checklist and screenshot checks, with the stage record in place of the version's folder name and number."""
    files = {n: utf8_read(os.path.join(folder, n)) for n in ("map.md", "types.json", "publication.json")}
    if files["publication.json"] is None:
        return "syncing", "publication.json hasn't arrived", None
    try:
        info = json.loads(utf8_text(files["publication.json"]) if isinstance(files["publication.json"], bytes) else files["publication.json"], parse_constant=CF._no_constant)
    except ValueError:
        return "damaged", "publication.json is unreadable", None
    if not isinstance(info, dict):
        return "damaged", "publication.json isn't a publication record", None
    two = info.get("format") == CF.PUBLICATION_FORMAT2
    if info.get("format") != CF.PUBLICATION_FORMAT or info.get("features") is not None:
        v = CF.judge("preflight-publication", info)
        if not v["ok"]:
            return "unusable", CF.newer_why(info, v["needs"]), info
        if two and not CF.payload_ok(info):
            return "unusable", CF.newer_why(info, CF.payload_needs(info)), info
    if files["map.md"] is None or files["types.json"] is None:
        return "syncing", "some files haven't arrived", info
    if CF.text_hash(files["map.md"]) != info.get("mapHash") or CF.text_hash(files["types.json"]) != info.get("typesHash"):
        return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    if two:
        p = info["payload"]
        if sorted((info.get("images") or {}).keys()) != sorted(p["images"].keys()):
            return "unusable", "Its screenshots don't match its payload. Edited by hand.", info
        if CF.sha(CF.read_bytes(os.path.join(folder, "map.md"))) != p["map"] or CF.sha(CF.read_bytes(os.path.join(folder, "types.json"))) != p["types"]:
            return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    sp = stage_problem(info, name)
    if sp:
        return "unusable", sp, info
    try:
        types = json.loads(utf8_text(files["types.json"]) if isinstance(files["types.json"], bytes) else files["types.json"], parse_constant=CF._no_constant)
    except ValueError:
        return "damaged", "types.json is unreadable", info
    if not isinstance(types, dict):
        return "damaged", "types.json doesn't hold step types", info
    try:
        why = CF.unrunnable(files["map.md"], types)
    except (TypeError, AttributeError, KeyError, ValueError):
        why = CF.NEWER + " A step type in it can't be read."
    if why:
        return "unusable", why, info
    parsed = CF.parse_map(files["map.md"])
    unlisted2 = [f for f in CF.features(parsed, types) if f not in info["features"]]
    if unlisted2:
        return "unusable", "It uses %s, which its publication record doesn't list. Edited by hand." % ", ".join(unlisted2), info
    bad = CF.pins_problem(info, parsed)
    if bad:
        return "unusable", bad, info
    listed = info.get("images") if isinstance(info.get("images"), dict) else {}
    unlisted = [src for src in CF.shot_sources(parsed) if src not in listed]
    if unlisted:
        return "unusable", "A screenshot it shows isn't in its publication record (%s). Edited by hand." % unlisted[0], info
    for src, want in (info.get("images") or {}).items():
        path = os.path.join(folder, *src.split("/"))
        if not os.path.isfile(path):
            return "syncing", "screenshot %s hasn't arrived" % src, info
        data = CF.read_bytes(path)
        if CF.fnv(data) != want or CF.sha(data) != info["payload"]["images"].get(src):
            return "damaged", "screenshot %s doesn't match its record" % src, info
    return "complete", "", info


def version_verdict(r, read):
    """The version a run names, read as readRunOnly reads it: (ok, info), or None when it isn't read at all."""
    test = r.get("test") is True
    if not isinstance(r.get("folder"), str) or not PROC.match(r.get("process") or ""):
        return None
    if test:
        if not STAGE.match(r["folder"]):
            return None
    elif not VERSION.match(r["folder"]):
        return None
    base = ("staged/" if test else "publications/") + r["process"] + "/" + r["folder"] + "/"
    names = ("map.md", "types.json", "publication.json")
    texts = {n: read(base + n) for n in names}
    tmp = tempfile.mkdtemp(prefix="flightdeck-version-")
    try:
        vdir = os.path.join(tmp, r["folder"])
        os.mkdir(vdir)
        for n in names:
            if texts[n] is not None:
                with open(os.path.join(vdir, n), "wb") as f:
                    f.write(texts[n])
        # Its files decoded as the app decodes them (utf8_read), published or staged alike; the payload is over the raw bytes.
        state, why, info = check_stage(vdir, r["folder"]) if test else CF.check_publication(vdir, r["folder"], utf8_read)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # A screenshot is verified when the run is judged in the folder; it isn't packed with a dependency's version.
    ok = state == "complete" or (state == "syncing" and why.startswith("screenshot "))
    # A stage is its folder's process's (repo.readStage): a record or checklist naming another process is unusable.
    if ok and test and (info.get("process") != r["process"] or CF.parse_map(utf8_text(texts["map.md"]) if isinstance(texts["map.md"], bytes) else texts["map.md"]).get("process") != r["process"]):
        ok = False
    if ok and test:
        info = {"folder": info.get("folder"), "mapHash": info.get("mapHash"), "version": info["stage"]["proposed"]}
    return base, ok, info


def dep_verdict(key, text, read, beside=None):
    """repo.depVerdict for runs/<key>/run.json: None when the run holds, else (first path, why). read(path) gives a file's
    bytes (None when it isn't there); beside: the run folder's other files, { name: bytes }."""
    proc, rid = key.split("/", 1)
    path = "runs/" + key + "/run.json"
    o = parse(utf8_text(text) if isinstance(text, bytes) else text)
    if o is MISSING:
        return path, "it isn't complete JSON"
    r = sanitize(o)
    if r is None:
        return path, "it isn't a run this copy can read"
    if is_obj(o) and isinstance(o.get("process"), str) and o["process"] != r["process"]:
        return path, "its process is longer than Flightdeck reads"
    if r["process"] != proc or r["id"] != rid:
        return path, "it belongs to another run folder"
    v = version_verdict(r, read)
    if v is not None:
        base, ok, info = v
        if not ok:
            return base, "its version doesn't verify"
        if is_obj(info) and (r["folder"] != info.get("folder") or (r["mapHash"] and r["mapHash"] != info.get("mapHash")) or (r["version"] and r["version"] != info.get("version"))):
            return path, "it doesn't match its version"
    if r.get("_name_only"):
        return path, "it can only be listed by name"
    # depVerdict's order (PF.appjson.judgeRun, then why it's read-only, then R.canonical): a run from a newer Flightdeck
    # (appjson.newerRun: its snapshot, fields or ids) first; else times and records it can't keep as written; then conflict
    # copies beside it; then any other reason it's read-only; then anything not exactly as the app writes it.
    why = r["_unrunnable"]
    if why and (why not in ("detail-patterns", "test") or r["snapshot"] == ""):
        return path, "it is read-only here (" + str(why) + ")"
    if r["_bad_times"]:
        return path, "some of its times can't be read"
    rp = repairs(o)
    if rp:
        return path, "this copy drops or changes records in it (" + ", ".join(rp[:5]) + ")"
    d = drift(o, strip(r))
    if d:
        return path, "it holds what the app wouldn't keep as written (" + ", ".join(d[:5]) + ")"
    beside = beside or {}
    lineage = r.get("lineage") or []
    copies = [n for n in beside if n != "run.json" and COPY.match(n)]
    lost = [n for n in beside if CAND.match(n) and (CAND.match(n).group(1) + "." + CAND.match(n).group(2)) not in lineage and same_run(utf8_text(beside[n])) != same_run(text if isinstance(text, str) else text.decode("utf-8"))]
    if copies or lost:
        return "runs/" + key + "/", "conflict copies beside it"
    if why:
        return path, "it is read-only here (" + str(why) + ")"
    cp = canonical(o, r)
    if cp:
        return path, "it isn't exactly as the app writes it, at " + cp
    return None


def canonical_batch(path):
    """--canonical FILE: a JSON list of run files; prints, per run, R.canonical's first place ("" when it's canonical)."""
    with open(path, encoding="utf-8") as f:
        runs = json.loads(f.read(), parse_constant=CF._no_constant)
    sys.stdout.write(json.dumps([canonical(o, sanitize(o)) for o in runs]) + "\n")


def batch(path):
    """--verdicts FILE: JSON lines, a world ({world, files: {path: text}}: its versions and the files beside each run) or a
    case ({id, world, key, text}); prints one line per case, {id, path} (path null when the run holds)."""
    worlds, out = {}, []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            x = json.loads(line)
            if "files" in x:
                worlds[x["world"]] = {k: v.encode("utf-8") for k, v in x["files"].items()}
                continue
            files, d = worlds[x["world"]], "runs/" + x["key"] + "/"
            beside = {p[len(d):]: b for p, b in files.items() if p.startswith(d) and "/" not in p[len(d):]}
            beside.pop("run.json", None)
            try:
                v = dep_verdict(x["key"], x["text"], files.get, beside)
            except Exception as e:  # noqa: BLE001 - a crash is a verdict the test shows, never a silent pass
                v = ("crash", type(e).__name__ + ": " + str(e))
            out.append(json.dumps({"id": x["id"], "path": v[0] if v else None, "why": v[1] if v else ""}))
    sys.stdout.write("\n".join(out) + "\n")


# ---- Coverage (NA): which places of a run file the cleaner reads. A run read with track() records every key and index
# sanitize and repairs read from it, so test/run-corpus.test.js can compare them with the places the app's cleaner reads. ----
class TDict(dict):
    __slots__ = ("_at", "_seen")

    def _rec(self, k):
        if isinstance(k, str):
            self._seen.add(self._at + "." + k if self._at else k)

    def __getitem__(self, k):
        self._rec(k)
        return dict.__getitem__(self, k)

    def get(self, k, d=None):
        self._rec(k)
        return dict.get(self, k, d)

    def __contains__(self, k):
        self._rec(k)
        return dict.__contains__(self, k)

    def items(self):
        for k in dict.keys(self):
            self._rec(k)
        return dict.items(self)

    def values(self):
        for k in dict.keys(self):
            self._rec(k)
        return dict.values(self)


class TList(list):
    __slots__ = ("_at", "_seen")

    def _rec(self, i):
        self._seen.add("%s[%d]" % (self._at, i))

    def __getitem__(self, i):
        if isinstance(i, slice):
            for j in range(*i.indices(len(self))):
                self._rec(j)
        elif isinstance(i, int):
            self._rec(i if i >= 0 else len(self) + i)
        return list.__getitem__(self, i)

    def __iter__(self):
        for j in range(len(self)):
            self._rec(j)
        return list.__iter__(self)


def track(v, seen, at=""):
    """v (parsed JSON) with every read recorded in seen, as paths (a.b[0].c)."""
    if isinstance(v, dict):
        t = TDict((k, track(x, seen, at + "." + k if at else k)) for k, x in v.items())
        t._at, t._seen = at, seen
        return t
    if isinstance(v, list):
        t = TList(track(x, seen, "%s[%d]" % (at, i)) for i, x in enumerate(v))
        t._at, t._seen = at, seen
        return t
    return v


def whole(v):
    """A plain deep copy (JSON.parse(JSON.stringify(v))), every place of it read."""
    if isinstance(v, dict):
        return {k: whole(x) for k, x in v.items()}
    if isinstance(v, list):
        return [whole(x) for x in v]
    return v


def coverage(path):
    """--coverage FILE: JSON lines {id, text}; prints {id, read: [paths]} with every place sanitize and repairs read."""
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            x = json.loads(line)
            seen = set()
            o = parse(x["text"])
            if o is not MISSING:
                o = track(o, seen)
                try:
                    sanitize(o)
                    repairs(o)
                except Exception as e:  # noqa: BLE001 - reported, so the test names the case
                    seen.add("!crash " + type(e).__name__ + ": " + str(e))
            print(json.dumps({"id": x["id"], "read": sorted(seen)}))
