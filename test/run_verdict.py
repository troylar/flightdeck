"""The verdict every reader gives a run the work depends on (repo.depVerdict: readRunOnly, then PF.appjson.judgeRun), ported
for the pack reader so it is the same by construction: R.sanitize and everything it refuses or repairs (valid, the envelope,
unknown3, newer, longIds, the version's checklist, a test run's fields, the times it can't read) and R.unexplained's
comparison of the file with what sanitize keeps (U.drift, with the same allowances), the conflict copies beside it, and the
version it ran. test/run-corpus.test.js holds it to the app on a generated corpus of every field mutated in every role.

Not mirrored, and accepted as written when present (none is in a run the corpus or a fixture makes): a skill registration on
a step (cleanSkill), a loop approval (PF.loop.cleanSnapshot), a to-do count on a step or gate (PF.todos.cleanCut), the Jira
search fields (searchSites, searchGen, searchRec) and a migration list. The app's own date reading (V8's Date) accepts
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
NOT_MIRRORED = {"step": ["skill", "loop", "todos"], "gate": ["todos"], "history": ["skill", "loop"], "run": ["searchSites", "searchGen", "searchRec", "migrations"]}
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
    if v is MISSING:
        return None
    m = re.match("^[" + re.escape(CF.JS_WS) + "]*([+-]?[0-9]+)", CF.js_String(v), re.A)
    return int(m.group(1)) if m else None


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
        if not isinstance(e.get("text"), str):
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
            if three and not why[0] and "todos" in a and "living" not in o:
                why[0] = "todos"
            text(a.get("values"), "Step evidence", 300)
            if is_obj(ch):
                text(ch.get("inputs"), "Step child detail", 300)
            if isinstance(a.get("history"), list):
                for h in a["history"]:
                    look(h, "history3" if three else "history", "Step history")
                    if three and is_obj(h):
                        look(h.get("skill"), "skillSeen", "Step history")
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
            if three and not why[0] and "todos" in gt and "living" not in o:
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
    if not is_num(v) or v < 1 or math.floor(v) != v:
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
         "state": o["state"] if isinstance(o.get("state"), str) and o["state"] in RUN_STATES else "running", "created": iso(o.get("created")) or "1970-01-01T00:00:00.000Z",
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
        if truthy(f) and isinstance(t, str) and t.strip():
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
        if not truthy(a) or not isinstance(get(a, "s"), str) or get(a, "s") not in STEP_STATES or k == "__proto__":
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
        if three:
            for f in NOT_MIRRORED["step"]:
                if truthy(a.get(f, MISSING)):
                    c[f] = a[f]
        if isinstance(a.get("history"), list):
            hist = []
            for h in a["history"][-HISTORY_MAX:]:
                hs = get(h, "s") if truthy(h) else MISSING
                if not truthy(h) or not (isinstance(hs, str) and (hs in STEP_STATES or hs == "corrected")):
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
                if three:
                    for f in NOT_MIRRORED["history"]:
                        if truthy(get(h, f)):
                            x[f] = get(h, f)
                hist.append(x)
            c["history"] = hist
        r["steps"][k] = c
    for k in keys(o["gates"]):
        gt = get(o["gates"], k)
        if not truthy(gt) or not isinstance(get(gt, "s"), str) or get(gt, "s") not in GATE_STATES or k == "__proto__":
            continue
        c = {"s": gt["s"], "by": s(gt.get("by"), 80), "at": iso(gt.get("at"))}
        if s(gt.get("reason"), 200):
            c["reason"] = s(gt.get("reason"), 200)
        if isinstance(gt.get("was"), str) and gt["was"] in GATE_STATES:
            c["was"] = gt["was"]
        c["approved"] = {}
        ap = gt.get("approved", MISSING)
        for f in keys(ap if truthy(ap) else {}):
            v = get(ap, f)
            c["approved"][f] = cut(v, DETAIL_MAX, unit) if isinstance(v, str) else ""
        if three and truthy(gt.get("todos", MISSING)):
            c["todos"] = gt["todos"]
        r["gates"][k] = c
    for x in (o["log"][-LOG_MAX:] if isinstance(o.get("log"), list) else []):
        if truthy(x) and iso(get(x, "at")):
            r["log"].append({"at": get(x, "at"), "by": s(get(x, "by"), 80), "what": s(get(x, "what"), 300)})
    e = o.get("ended", MISSING)
    if truthy(e) and own(OUTCOMES, get(e, "outcome")) and isinstance(get(e, "outcome"), str) and iso(get(e, "at")):
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
            r["payload"] = json.loads(json.dumps(o["payload"]))
        pins = o.get("pins", MISSING)
        if truthy(pins) and truthy(get(pins, "children")) and keys(get(pins, "children")):
            r["pins"] = {"children": json.loads(json.dumps(pins["children"]))}
        if isinstance(o.get("migrations"), list):
            r["migrations"] = json.loads(json.dumps(o["migrations"]))
        for f in NOT_MIRRORED["run"]:
            if f in o and f != "migrations":
                r[f] = o[f]
        lv = o.get("living", MISSING)
        if lv is not MISSING and clean_living(lv):
            r["living"] = clean_living(lv)
        tp = test_problem(o)
        if tp:
            why = why or "test"
        elif o.get("test") is True:
            r["test"] = True
            r["stage"] = {"folder": get(o.get("stage"), "folder")}
    r["_unrunnable"] = why
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


def invalid_details(r):
    """R's invalidValues for a run's details: the typed details whose value isn't canonical. (A step type's own typed
    evidence is not mirrored: see the module's note.)"""
    try:
        typed = CF.parse_map(r["snapshot"])["detailTypes"]
    except Exception:  # noqa: BLE001 - a checklist the reader can't parse has no typed details here
        return []
    return ["details." + k for k, v in r["details"].items() if k in typed and v and not detail_valid(typed[k], v)]


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
        if v is not MISSING and v is not None and not (is_num(v) and v >= 0 and math.floor(v) == v):
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
    e = o.get("ended", MISSING)
    if e is not MISSING and e is not None:
        if not is_obj(e) or not own(OUTCOMES, e.get("outcome", MISSING)):
            add("ended")
        else:
            text(e.get("by", MISSING), 80, "ended.by")
            text(e.get("byName", MISSING), 80, "ended.byName")
    if o.get("format") == FORMAT3:
        r = sanitize(o)
        if r and not r.get("_name_only") and not r["_unrunnable"]:
            out.extend(invalid_details(r))
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


def parse(text):
    def no_constant(_):
        raise ValueError("not JSON")
    try:
        return json.loads(text, parse_constant=no_constant)
    except (ValueError, RecursionError):
        return MISSING


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
    if test:
        try:
            info = json.loads(texts["publication.json"]) if texts["publication.json"] is not None else None
        except ValueError:
            info = None
        if not is_obj(info) or texts["map.md"] is None or texts["types.json"] is None:
            return base, False, None
        st = info.get("stage") if is_obj(info.get("stage")) else {}
        return base, True, {"folder": info.get("folder"), "mapHash": info.get("mapHash"), "version": st.get("proposed")}
    tmp = tempfile.mkdtemp(prefix="flightdeck-version-")
    try:
        vdir = os.path.join(tmp, r["folder"])
        os.mkdir(vdir)
        for n in names:
            if texts[n] is not None:
                with open(os.path.join(vdir, n), "wb") as f:
                    f.write(texts[n])
        state, why, info = CF.check_publication(vdir, r["folder"])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    # A screenshot is verified when the run is judged in the folder; it isn't packed with a dependency's version.
    ok = state == "complete" or (state == "syncing" and why.startswith("screenshot "))
    return base, ok, info


def dep_verdict(key, text, read, beside=None):
    """repo.depVerdict for runs/<key>/run.json: None when the run holds, else (first path, why). read(path) gives a file's
    bytes (None when it isn't there); beside: the run folder's other files, { name: bytes }."""
    proc, rid = key.split("/", 1)
    path = "runs/" + key + "/run.json"
    o = parse(text.decode("utf-8") if isinstance(text, bytes) else text)
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
    if r["_unrunnable"]:
        return path, "it is read-only here (" + str(r["_unrunnable"]) + ")"
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
    lost = [n for n in beside if CAND.match(n) and (CAND.match(n).group(1) + "." + CAND.match(n).group(2)) not in lineage and same_run(beside[n].decode("utf-8", "replace")) != same_run(text if isinstance(text, str) else text.decode("utf-8"))]
    if copies or lost:
        return "runs/" + key + "/", "conflict copies beside it"
    return None


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

