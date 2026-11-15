"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. For a living run (4.0) it replays the
application chain from the packed run.json's living.head through each application's previous, and checks the receipt the run
names says the run's work head and outcome: a pack that calls a run's work complete must hold all of it, and a pack missing
any of it must say it is partial. Run with python3 -I."""
import datetime, hashlib, json, math, os, re, sys, zipfile, zoneinfo

# The shipped checker's own record reader (Python, independent of the app): a packed receipt is read by its rules.
# Like the shipped checker, it writes no bytecode cache beside the files it loads.
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "example-folder", ".flightdeck", "skills", "_flightdeck"))
import check_folder as CF  # noqa: E402
# Every run is judged as every reader of the app judges it, ported once in the shipped run_verdict.py: the root run as the
# readers judge its run.json (repo.judgeRunFile), every run the work depends on as repo.depVerdict does.
import run_verdict as RV  # noqa: E402


def main(path):
    with zipfile.ZipFile(path) as z:
        bad = z.testzip()
        if bad is not None:
            sys.exit("bad CRC: " + bad)
        names = z.namelist()
        if len(names) != len(set(names)):
            sys.exit("duplicate names")
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED:
                sys.exit("not stored: " + info.filename)
            if info.flag_bits & 0x800 == 0 and any(ord(c) > 127 for c in info.filename):
                sys.exit("non-ASCII name without the UTF-8 flag: " + info.filename)
        digest = {n: hashlib.sha256(z.read(n)).hexdigest() for n in names}
        # The manifest by the same strict parse (VD: no NaN or Infinity, nothing nested past 64 levels), its whole numbers kept
        # as integers for the shape checks.
        try:
            man = strict_json(z.read("manifest.json").decode("utf-8"), doubles=False)
        except (ValueError, UnicodeDecodeError):
            sys.exit("manifest: it isn't JSON this reader reads")
        bad = manifest_problem(man)
        if bad:
            sys.exit("manifest: " + bad)
        listed = [f["pack"] for f in man["files"]] + [g["path"] for g in man["generated"]]
        payload = sorted(n for n in names if n not in ("manifest.json", "SHA256SUMS"))
        if sorted(listed) != payload:
            sys.exit("the manifest doesn't list exactly the payload")
        for f in man["files"]:
            if digest[f["pack"]] != f["sha256"]:
                sys.exit("manifest hash differs: " + f["pack"])
        for g in man["generated"]:
            if digest[g["path"]] != g["sha256"]:
                sys.exit("manifest hash differs: " + g["path"])
        sums = {}
        for line in z.read("SHA256SUMS").decode("utf-8").splitlines():
            h, name = line.split("  ", 1)
            sums[name] = h
        if sorted(sums) != sorted(payload + ["manifest.json"]):
            sys.exit("SHA256SUMS doesn't cover exactly the payload and the manifest")
        for name, h in sums.items():
            if digest[name] != h:
                sys.exit("SHA256SUMS differs: " + name)
        living = check_living(z, man)
        check_claims(z, man)
        print("ok %d entries, living %d" % (len(names), living))


PUBLISHED = re.compile(r"^Published in v([1-9][0-9]{0,8})\Z", re.A)
PROOF = re.compile(r"^publications/([a-z0-9][a-z0-9-]{0,59})/(v[1-9][0-9]*-[a-z0-9]+)/(map\.md|types\.json|publication\.json)\Z", re.A)


def check_claims(z, man):
    """A verified "Published in vN" claim is held to its own proof, from the pack alone (RE): that version's map.md,
    types.json and publication.json all packed, read as a version by the shipped checker's publication rules from the
    packed bytes in memory, numbered N, and the correction in it (listed by the version, or a packed decision that
    includes it there)."""
    by_path = {f["path"]: f["pack"] for f in man["files"]}

    def rbytes(q):
        return z.read(by_path[q]) if q in by_path else None

    def rtext(q):
        b = rbytes(q)
        return None if b is None else RV.utf8_text(b)

    for r in man["runs"]:
        for c in r.get("claims", []):
            m = PUBLISHED.match(c["text"])
            if not c["verified"] or not m:
                continue
            who = "claims: " + r["key"] + " says \"" + c["text"] + "\" of " + str(c.get("correction")) + " is confirmed, but "
            proof = c.get("proof")
            ms = [PROOF.match(x) if isinstance(x, str) else None for x in proof] if isinstance(proof, list) else []
            if len(ms) != 3 or not all(ms) or len({(x.group(1), x.group(2)) for x in ms}) != 1 or sorted(x.group(3) for x in ms) != ["map.md", "publication.json", "types.json"]:
                sys.exit(who + "it doesn't name that version's map.md, types.json and publication.json as its proof")
            proc, folder = ms[0].group(1), ms[0].group(2)
            for q in proof:
                if q not in by_path:
                    sys.exit(who + q + ", its proof, isn't in the pack")
            vdir = "publications/" + proc + "/" + folder
            state, why, info = CF.check_publication(vdir, folder, rtext, rbytes)
            if not (state == "complete" or (state == "syncing" and why.startswith("screenshot "))):
                sys.exit(who + vdir + " doesn't read as a version (" + str(why) + ")")
            if info.get("version") != int(m.group(1)):
                sys.exit(who + vdir + " is v" + str(info.get("version")) + ", not v" + m.group(1))
            group = c.get("group")
            listed = isinstance(group, str) and group and any(isinstance(x, dict) and x.get("id") == group for x in (info.get("corrections") if isinstance(info.get("corrections"), list) else []))
            # Where the group stands is its current decision, as the app reads decisions (SB): only files its reader keeps,
            # the highest rev, and two at that rev unresolved. It lands only applied (or "It's in vN"); a decision proves the
            # version only as the current one, naming that folder. A withdrawal counts here whoever made it: the pack doesn't
            # hold every correction in the group to tell its authors, so this is stricter than the app, never looser.
            cur, tie = None, False
            for q in sorted(by_path):
                # Only what the app reads there as a decision: a file directly in the folder named .json, in any case (TC).
                nm = q[len("corrections/" + proc + "/"):]
                if not q.startswith("corrections/" + proc + "/") or "/" in nm or not CF.json_name(nm):
                    continue
                try:
                    d = decision_of(decode(z.read(by_path[q])))
                except ValueError:
                    d = None
                if d is None or d["group"] != group:
                    continue
                if cur is None or d["rev"] > cur["rev"]:
                    cur, tie = d, False
                elif d["rev"] == cur["rev"]:
                    tie = True
            if cur is None or tie or cur["status"] not in ("applied", "included"):
                sys.exit(who + "the correction's current decision in the pack " + ("is two made at once" if tie else "doesn't apply it" if cur else "isn't there"))
            if not (listed or (cur["status"] == "included" and cur["folder"] == folder)):
                sys.exit(who + "the correction isn't in " + vdir + ": the version doesn't list it, and its current decision doesn't include it there")
            # The correction itself, from the packed originals, its group worked out from them, and the app's landing rules
            # (TB): a version above the correction's own, whose checklist makes the change.
            rp = "runs/" + r["key"] + "/run.json"
            try:
                rrun = decode(z.read(by_path[rp])) if rp in by_path else None
            except ValueError:
                rrun = None
            mem = claimed_member(z, by_path, r["key"], rrun, c.get("correction")) if isinstance(rrun, dict) and isinstance(c.get("correction"), str) else None
            if mem is None:
                sys.exit(who + "the correction it's about isn't in the pack as one the app reads")
            if mem["group"] != group or mem["process"] != proc:
                sys.exit(who + "the correction it's about is in another group than the claim names")
            own = max(0, mem["version"] - 1) if mem["test"] else mem["version"]
            if int(m.group(1)) <= own:
                sys.exit(who + "v" + m.group(1) + " isn't a version after the correction's own (v" + str(own) + ")")
            g = {"target": mem["target"], "change": mem["change"], "legacy": mem["legacy"], "newer": mem["newer"], "decision": cur}
            if not satisfied(g, rtext(vdir + "/map.md") or ""):
                sys.exit(who + vdir + "'s checklist doesn't make the change")


DECIDE = ("open", "applied", "declined", "withdrawn", "included")
DEC_ID = re.compile(r"^[A-Za-z0-9_-]{1,40}\Z")
DEC_FOLDER = re.compile(r"^v([0-9]{1,9})-[a-z0-9]{1,40}\Z")


def decision_of(o):
    """A correction decision as PF.corrections.cleanDecision keeps it ({group, status, rev, folder}), or None: the envelope's
    verdict first, then who decided and when, its group and status, and for "It's in vN" a folder naming that version."""
    if not isinstance(o, dict) or o.get("kind") != "correction-decision" or not CF.judge("flightdeck-correction-decision", o)["ok"]:
        return None
    if not isinstance(o.get("at"), str) or not isinstance(o.get("by"), str):
        return None
    if not isinstance(o.get("group"), str) or not DEC_ID.match(o["group"]) or o.get("status") not in DECIDE:
        return None
    rv = o.get("rev")
    rev = math.floor(rv) if isinstance(rv, (int, float)) and not isinstance(rv, bool) and math.isfinite(rv) and rv >= 0 else 0
    folder = None
    if o["status"] == "included":
        m = DEC_FOLDER.match(o["folder"]) if isinstance(o.get("folder"), str) else None
        ver = o.get("version")
        if not m or isinstance(ver, bool) or not isinstance(ver, (int, float)) or int(m.group(1)) != ver:
            return None
        folder = o["folder"]
    res = o.get("result")
    r = {"step": res["step"] if isinstance(res.get("step"), str) and CID.match(res["step"]) else "", "sig": res["sig"]} if isinstance(res, dict) and isinstance(res.get("sig"), str) and HEX8.match(res["sig"]) else None
    return {"group": o["group"], "status": o["status"], "rev": rev, "folder": folder, "result": None if o.get("addressed") is True else r,
            "addressed": o.get("addressed") is True and o["status"] == "applied"}



# ---- Where a correction landed (TB): the app's landing rules (PF.corrections.satisfied and its helpers), ported. A claim's
# correction is read from the packed originals (the run's notes, or its keep record), its group worked out from them, and the
# version's map.md must make its change, read as the outline builder reads a draft (PF.outline.parse). ----
OPS = ("wording", "add", "move", "roles", "screenshot", "remove", "describe")
NOTE_OPS = ("wording", "screenshot", "describe")
APPLIES = ("wording", "add", "move", "roles", "remove")
CID = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}\Z", re.I | re.A)
ROLE = re.compile(r"^[A-Za-z0-9_-]{1,60}\Z", re.A)
HEX8 = re.compile(r"^[0-9a-f]{8}\Z")
SP = CF.jsre(r"\s+")
D = CF.JS_DOT


def js_truthy(v):
    return v not in (None, False, 0, "") and not (isinstance(v, float) and math.isnan(v))


def norm(t):
    return CF.js_trim(re.sub(SP, " ", t if isinstance(t, str) else "", flags=re.A))


def jstr(v, n):
    return CF.js_slice(v, n) if isinstance(v, str) else ""


def whole(v):
    return math.floor(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0 else 0


def outline(text):
    """PF.outline.parse, as far as landing reads it: phases (id, key, title, note, steps, tracks, an explicit gate), and steps
    (id, key, type, text, must, planned, roles, binds, fields, note, screenshots, track, phase)."""
    L = [x[:-1] if x.endswith("\r") else x for x in text.split("\n")]
    n, i = len(L), 0
    if L[0] and L[0].strip(CF.JS_WS) == "---":
        i = 1
        while i < n and L[i].strip(CF.JS_WS) != "---":
            i += 1
        i += 1
    phases, steps = [], []
    phase = step = gate = track = None
    questions = False
    while i < n:
        line = L[i]
        i += 1
        if not line.strip(CF.JS_WS):
            continue
        m = re.match(CF.jsre(r"^###\s+Track:\s*(" + D + r"+?)\s*\Z"), line, re.I | re.A)
        if m:
            step = None
            if phase is None or gate is not None:
                continue
            tid, rest = CF.take_id(m.group(1))
            roles, title = CF.tokens(rest, "@")
            track = {"id": tid, "title": title, "roles": roles, "index": len(phase["tracks"])}
            phase["tracks"].append(track)
            continue
        m = re.match(CF.jsre(r"^##\s+(" + D + r"+?)\s*\Z"), line, re.A)
        if m:
            step = gate = track = None
            hid, hrest = CF.take_id(m.group(1))
            if re.match(r"^questions\b", hrest, re.I | re.A):
                questions, phase = True, None
                continue
            g = re.match(CF.jsre(r"^Gate:\s*(" + D + r"+)\Z"), hrest, re.I | re.A)
            if g:
                if phase is None or phase["gate"] is not None:
                    continue
                gate = {"id": hid, "note": "", "shots": []}
                phase["gate"] = gate
                continue
            pm = re.match(CF.jsre(r"^(" + D + r"*?)\s+·\s+(READ-DO|DO-CONFIRM)\Z"), hrest, re.A)
            phase = {"id": hid, "title": CF.js_trim(pm.group(1) if pm else hrest), "note": "", "shots": [], "steps": [], "tracks": [], "gate": None, "index": len(phases)}
            phases.append(phase)
            continue
        if questions:
            continue
        m = re.match(CF.jsre(r"^- \[( |!|~)\]\s+(" + D + r"+)\Z"), line, re.A)
        if m:
            if phase is None or gate is not None:
                continue
            sid, core = CF.take_id(m.group(2))
            typ, rest = "", core
            tm = re.match(CF.jsre(r"^\{([a-z][A-Za-z0-9_.-]*)\}\s+(" + D + r"*)\Z"), core, re.I | re.A)
            if tm:
                typ, rest = tm.group(1), tm.group(2)
            roles, r2 = CF.tokens(rest, "@")
            binds, txt = CF.tokens(r2, "^")
            step = {"id": sid, "type": typ, "text": txt, "must": m.group(1) == "!", "planned": m.group(1) == "~", "roles": roles, "binds": binds, "fields": {},
                    "note": "", "shots": [], "phase": phase, "track": track["index"] if track else -1, "trackId": track["id"] if track else "", "index": len(steps)}
            phase["steps"].append(step)
            steps.append(step)
            continue
        wt = step or (phase if phase is not None and gate is None and track is None else None)
        if wt is not None and re.match(CF.jsre(r"^\s{2,}only when\b"), line, re.I | re.A):
            continue
        tg = step or gate or (phase if phase is not None and track is None else None)
        m = re.match(CF.jsre(r"^\s{2,}>\s?(" + D + r"*)\Z"), line, re.A)
        if m:
            if tg is not None:
                tg["note"] = (tg["note"] + "\n" if tg["note"] else "") + m.group(1)
            continue
        m = tg is not None and re.match(CF.jsre(r"^\s{2,}!\[(" + D + r"*?)\]\(([^)\s]+)\)\s*\Z"), line, re.A)
        if m:
            tg["shots"].append(m.group(2))
            continue
        m = re.match(CF.jsre(r"^\s{2,}([A-Za-z0-9_-]+):\s*(" + D + r"*)\Z"), line, re.A)
        if m:
            if gate is not None and m.group(1) in ("approves", "at", "due", "after"):
                continue
            if step is not None:
                if m.group(1) != "__proto__":
                    step["fields"][m.group(1)] = CF.js_trim(m.group(2))
                continue
    count: dict = {}
    for st in steps:
        if st["id"]:
            count[st["id"]] = count.get(st["id"], 0) + 1
    for st in steps:
        st["key"] = st["id"] if st["id"] and count[st["id"]] == 1 else "#" + str(st["index"])
    pc: dict = {}
    for ph in phases:
        if ph["id"]:
            pc[ph["id"]] = pc.get(ph["id"], 0) + 1
    for ph in phases:
        ph["key"] = ph["id"] if ph["id"] and pc[ph["id"]] == 1 else "#" + str(ph["index"])
    return {"phases": phases, "steps": steps}


def step_sig(o, sid):
    """PF.corrections.stepSig: the step as the checklist parser reads it, its line left out (the first step with that ID)."""
    st = next((x for x in o["steps"] if x["id"] == sid), None)
    if st is None:
        return ""
    roles = st["roles"] or (list(st["phase"]["tracks"][st["track"]]["roles"]) if st["track"] >= 0 else [])
    shots = [x for x in st["shots"] if re.match(r"^images/[A-Za-z0-9_./-]+\Z", x, re.A) and ".." not in x]
    body = {"type": st["type"], "text": st["text"], "must": st["must"], "planned": st["planned"], "roles": sorted(roles), "binds": st["binds"],
            "fields": {k: st["fields"][k] for k in sorted(st["fields"])}, "note": st["note"], "shots": shots, "track": st["trackId"]}
    return CF.text_hash(CF.js_json(body))


def draft_step(o, sid):
    if not sid:
        return None
    return next((x for x in o["steps"] if x["id"] == str(sid).lower() and x["key"] == x["id"]), None)


def draft_phase(o, pid):
    if not pid:
        return None
    return next((x for x in o["phases"] if x["id"] == pid and x["key"] == x["id"]), None)


def on_note(g):
    t, op = g["target"], g["change"]["op"]
    return not t.get("step") and (bool(t.get("gate")) or (op not in ("describe", "add") and not g.get("legacy") and bool(t.get("phase"))))


def draft_note(o, t):
    if t.get("gate"):
        ps = [p for p in o["phases"] if p["gate"] is not None and p["gate"]["id"] == t["gate"]]
    else:
        ps = [p for p in o["phases"] if p["id"] == t.get("phase") and p["key"] == p["id"]]
    if len(ps) != 1:
        return None
    return {"note": (ps[0]["gate"] if t.get("gate") else ps[0])["note"] or ""}


def placed(g, o):
    ch, anchor = g["change"], draft_step(o, g["target"].get("step"))
    if ch["where"] != "end":
        if anchor is None:
            return None
        ps = anchor["phase"]["steps"]
        k = ps.index(anchor)
        return ps[k + 1] if k + 1 < len(ps) and ps[k + 1]["track"] == anchor["track"] else None
    ph = anchor["phase"] if anchor is not None else draft_phase(o, g["target"].get("phase"))
    if ph is None:
        return None
    tr = anchor["track"] if anchor is not None else len(ph["tracks"]) - 1
    grp = [x for x in ph["steps"] if x["track"] == tr]
    return grp[-1] if grp else None


def is_already(g, o):
    ch, s = g["change"], draft_step(o, g["target"].get("step"))
    if on_note(g):
        dn = draft_note(o, g["target"])
        return dn is not None and ch["op"] == "wording" and norm(dn["note"]) == norm(ch["to"])
    if ch["op"] == "remove":
        return s is None
    if ch["op"] == "add":
        at = placed(g, o)
        return at is not None and norm(at["text"]) == norm(ch["text"])
    if s is None:
        return False
    if ch["op"] == "wording":
        return norm(s["text"]) == norm(ch["to"])
    if ch["op"] == "roles":
        lane = s["phase"]["tracks"][s["track"]]["roles"] if s["track"] >= 0 else []
        return " ".join(sorted(s["roles"] or lane)) == " ".join(sorted(ch["to"]))
    if ch["op"] == "move":
        ps = s["phase"]["steps"]
        i = ps.index(s)
        if ch["to"].get("after"):
            return i > 0 and ps[i - 1]["id"] == ch["to"]["after"]
        return s["phase"]["id"] == ch["to"]["phase"] and (i == 0 if ch["to"]["where"] == "start" else i == len(ps) - 1)
    return False


def satisfied(g, text):
    """Whether a checklist's text makes a group's change (PF.corrections.satisfied): a change that can't be checked counts as
    made; a person's applied result stands in only for the expected text, never the place or a removal."""
    ch = g["change"]
    if ch["op"] not in APPLIES or g.get("legacy") or g.get("newer"):
        return True
    o, d = outline(text), g.get("decision")
    r = d["result"] if d and d["status"] in ("applied", "included") and not d["addressed"] and d["result"] and d["result"]["sig"] != CF.text_hash("gone") else None
    if on_note(g):
        dn = draft_note(o, g["target"])
        return dn is not None and (norm(dn["note"]) == norm(ch["to"]) or (r is not None and CF.text_hash("note|" + norm(dn["note"])) == r["sig"]))

    def mine(st):
        return r is not None and st is not None and r["step"] == st["id"] and step_sig(o, st["id"]) == r["sig"]
    s = draft_step(o, g["target"].get("step"))
    if ch["op"] == "remove":
        return s is None
    if ch["op"] == "add":
        at = placed(g, o)
        return at is not None and (norm(at["text"]) == norm(ch["text"]) or mine(at))
    if s is None:
        return False
    if ch["op"] == "wording":
        return norm(s["text"]) == norm(ch["to"]) or mine(s)
    return is_already(g, o)


def clean_change(ch):
    """PF.corrections.cleanChange."""
    ch = ch if isinstance(ch, (dict, list)) else {}
    ch = ch if isinstance(ch, dict) else {}
    op = ch.get("op") if ch.get("op") in OPS else "describe"
    out = {"op": op}
    if op == "wording":
        out["to"] = jstr(ch.get("to"), 2000)
        if not out["to"]:
            out = {"op": "describe"}
    elif op == "add":
        out["text"], out["where"] = jstr(ch.get("text"), 2000), "end" if ch.get("where") == "end" else "after"
        if not out["text"]:
            out = {"op": "describe"}
    elif op == "move":
        t = ch.get("to") if isinstance(ch.get("to"), dict) else {}
        if isinstance(t.get("after"), str) and CID.match(t["after"]):
            out["to"] = {"after": t["after"]}
        elif isinstance(t.get("phase"), str) and CID.match(t["phase"]):
            out["to"] = {"phase": t["phase"], "where": "start" if t.get("where") == "start" else "end"}
        else:
            out = {"op": "describe"}
    elif op == "roles":
        out["to"] = [x for x in ch["to"] if isinstance(x, str) and ROLE.match(x)][:100] if isinstance(ch.get("to"), list) else []
    elif op == "screenshot" and isinstance(ch.get("shot"), str) and re.match(r"^images/[A-Za-z0-9_./-]+\Z", ch["shot"], re.A) and ".." not in ch["shot"]:
        out["shot"] = CF.js_slice(ch["shot"], 500)
    return out


def clean_correction(n):
    """PF.corrections.cleanNote: what a correction note says, as the app keeps it."""
    t = n.get("target") if isinstance(n.get("target"), (dict, list)) else {}
    t = t if isinstance(t, dict) else {}
    c = {"cv": whole(n.get("cv")) or 1, "version": whole(n.get("version")), "folder": jstr(n.get("folder"), 80),
         "target": {"phase": jstr(t.get("phase"), 60), "step": jstr(t.get("step"), 60) or jstr(n.get("step"), 60) or None},
         "change": clean_change(n.get("change")), "from": jstr(n.get("from"), 2000), "base": n["base"] if isinstance(n.get("base"), str) and HEX8.match(n["base"]) else "", "newer": False}
    if c["cv"] >= 2 and not c["target"]["step"] and isinstance(t.get("gate"), str) and CID.match(t["gate"]):
        c["target"]["gate"] = t["gate"]
    if c["cv"] >= 2 and not c["target"]["step"] and c["change"]["op"] not in NOTE_OPS:
        c["change"] = {"op": "describe"}
    nch = n.get("change")
    if c["cv"] > 2 or (js_truthy(nch) and (nch.get("op") if isinstance(nch, dict) else None) != c["change"]["op"]):
        c["change"], c["newer"] = {"op": "describe"}, True
    return c


def target_key(t):
    return t.get("step") or ("gate:" + t["gate"] if t.get("gate") else "phase:" + str(t.get("phase") or ""))


def group_id(k):
    return "g" + CF.text_hash(k) + CF.text_hash(k + "|2")


def fact_content(f):
    """PF.facts.contentOf: what an observation says, apart from when and by whom."""
    es = sorted(arr(f.get("entries")), key=lambda e: str(obj(e).get("id")).encode("utf-16-be", "surrogatepass"))
    return CF._tsha(["fact", f.get("domain"), js_truthy(f.get("complete")), f.get("reported"), len(arr(f.get("errors"))) > 0, es])


def source_key(s):
    """PF.facts.sourceKey: feed, site and account, the last two '' when absent."""
    s = obj(s)
    return [s.get("feed"), s.get("site") or "", s.get("account") or ""]


def result_of(run):
    """PF.run.resultOf: the run's result from its own checklist (its snapshot), the one decide step bound to it; None when it
    has none. conflict when the decision and the detail disagree."""
    try:
        parsed = CF.parse_map(run.get("snapshot") if isinstance(run.get("snapshot"), str) else "")
    except Exception:
        return None
    name = parsed.get("result")
    d = parsed["detailTypes"].get(name) if isinstance(name, str) else None
    if not isinstance(d, dict) or d.get("kind") != "choice" or name not in parsed["context"]:
        return None
    by = [s for s in parsed["steps"] if CF.bound_from(s, name) == "decision"]
    if len(by) != 1:
        return None
    a = obj(obj(run.get("steps")).get(by[0]["id"]))
    ok = a.get("s") == "done"
    dv = obj(run.get("details")).get(name)
    det = CF.js_String(dv) if js_truthy(dv) else ""
    vals = a.get("values")
    dec = CF.js_String(vals["decision"]) if ok and isinstance(vals, dict) and vals.get("decision") is not None else ""
    at = a.get("at") if js_truthy(a.get("at")) else None
    if ok and CF.js_trim(dec).lower() != CF.js_trim(det).lower():
        return {"value": "", "at": at, "conflict": True}
    return {"value": det if ok else "", "at": at if ok else None, "conflict": False}


def answer_of(run):
    """PF.run.answerOf: when the run's result was decided and when it ended."""
    res = result_of(run)
    ra = res["at"] if res and js_truthy(res["at"]) else ""
    ea = obj(run.get("ended")).get("at")
    return CF.js_String(ra) + " " + (CF.js_String(ea) if js_truthy(ea) else "")


def has_pair(lst, p):
    """PF.todos.hasPair: an item's uid and attempt in a list."""
    p = obj(p)
    return any(obj(y).get("uid") == p.get("uid") and obj(y).get("attempt") == p.get("attempt") for y in arr(lst))


def spread_why(spreads, e):
    """PF.todos.spreadReplayWhy: why a spread effect doesn't fit the spreads as they stand, or ''."""
    sp, op = e.get("spread"), e.get("op")
    s = spreads.get(sp)
    if op == "spread-add":
        return ("it adds spread " + str(sp) + " again") if s else ("it would add more than 50 spreads" if len(spreads) >= 50 else "")
    if s is None:
        return "it changes spread " + str(sp) + ", which was never added"
    if op == "spread-stop":
        return ("spread " + str(sp) + " is already stopped") if s["state"] == "stopped" else ""
    if op == "spread-include":
        if s["state"] == "stopped":
            return "spread " + str(sp) + " is stopped"
        if not has_pair(obj(s["scope"]).get("cleared"), e.get("item")):
            return "it includes " + str(obj(e.get("item")).get("uid")) + ", which wasn't cleared when the spread was added"
        if has_pair(s["included"], e.get("item")):
            return str(obj(e.get("item")).get("uid")) + " is already included"
    return ""


def spread_apply(spreads, e):
    """PF.todos.spreadReplay, as far as spread_why reads it."""
    op = e.get("op")
    if op == "spread-add":
        spreads[e.get("spread")] = {"state": "active", "scope": e.get("scope"), "included": []}
    elif op == "spread-include":
        spreads[e["spread"]]["included"].append({"uid": obj(e.get("item")).get("uid"), "attempt": obj(e.get("item")).get("attempt")})
    elif op == "spread-stop":
        spreads[e["spread"]]["state"] = "stopped"


def item_of(run, x):
    """PF.facts.itemOfTodo: the loop item a to-do (as its add landed) is about, on the run that has the loop; else None."""
    if x is None:
        return None
    t = obj(x.get("target"))
    if js_truthy(t.get("item")):
        i = obj(t.get("item"))
        return {"run": {"process": run.get("process"), "id": run.get("id")}, "loopStep": i.get("loopStep"), "uid": i.get("uid"), "attempt": i.get("attempt")}
    p = obj(run.get("parent"))
    if js_truthy(p.get("item")) and all(isinstance(p.get(k), str) for k in ("process", "id", "step")):
        pi = obj(p.get("item"))
        return {"run": {"process": p["process"], "id": p["id"]}, "loopStep": p["step"], "uid": pi.get("uid"), "attempt": js_number(pi.get("attempt")) or 1}
    return None


def js_number(v):
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return 0 if isinstance(v, float) and math.isnan(v) else v
    if isinstance(v, str):
        try:
            x = float(CF.js_trim(v)) if CF.js_trim(v) else 0
            return 0 if math.isnan(x) else x
        except ValueError:
            return 0
    return 0


def claimed_member(z, by_path, run_key, run, cid):
    """The correction a claim is about, from the packed originals as the app reads them: a correction (or a suggested fix
    from before 1.13) in the run's notes, or a keep record of the run filed for a checklist (PF.learn.members). Returns the
    member with its group's ID, or None when the pack doesn't hold one the app reads."""
    o = None
    p = "proposals/" + cid + ".json"
    if p in by_path:
        raw = z.read(by_path[p])
        try:
            o = decode(raw)
        except ValueError:
            return None
        if not isinstance(o, dict) or o.get("kind") != "keep" or o.get("id") != cid or CF.todo_why(o, cid + ".json", len(raw)):
            return None
        a, tpl, ch, rr = o.get("anchor"), o.get("template"), o.get("change"), o.get("run")
        if not (isinstance(a, dict) and isinstance(tpl, dict) and isinstance(ch, dict) and isinstance(rr, dict)) or str(rr.get("process")) + "/" + str(rr.get("id")) != run_key:
            return None
        m = {"process": tpl.get("process"), "target": {"phase": a.get("phase"), "step": a.get("after") or None}, "change": {"op": "add", "text": ch.get("text"), "where": ch.get("where")},
             "sig": o.get("base"), "version": js_number(tpl.get("version")), "test": run.get("test") is True or run.get("_test") is True, "legacy": False, "newer": False}
        m["group"] = group_id("\n".join([str(m["process"]), "keep", m["target"]["step"] or "phase:" + str(m["target"]["phase"]), str(ch.get("where")), str(m["sig"])]))
        return m
    notes = []
    for q in sorted(by_path):
        # The app's notes files: notes-<window>.jsonl directly in the run folder, by the readers' own name rule (VC).
        if q.startswith("runs/" + run_key + "/") and re.match(r"^notes-[A-Za-z0-9_-]+\.jsonl\Z", q[len("runs/" + run_key + "/"):]):
            try:
                t = RV.utf8_text(z.read(by_path[q]))
            except ValueError:
                continue
            for ln in t.split("\n"):
                if not CF.js_trim(ln):
                    continue
                # Each line by the app's checked parse (VD): nested past 64 levels, NaN or Infinity, or not JSON, it's torn.
                try:
                    x = strict_json(ln)
                except ValueError:
                    continue
                if isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("text"), str):
                    notes.append(x)
    proc, mine = run.get("process"), [x for x in notes if CF.js_slice(x["id"], 40) == cid and x.get("kind") in ("correction", "fix", "map")]
    if len(mine) != 1:
        return None
    n = mine[0]
    by = n.get("by") if isinstance(n.get("by"), str) else ""
    if n.get("kind") == "correction" and any(x.get("kind") == "correction" and (x.get("by") if isinstance(x.get("by"), str) else "") == by and x.get("replaces") == cid for x in notes):
        return None
    snap = run.get("snapshot") if isinstance(run.get("snapshot"), str) else ""
    ro = outline(snap)
    rver = js_number(run.get("version"))
    if n.get("kind") == "correction":
        c = clean_correction(n)
        g = {"target": c["target"], "change": c["change"]}
        frm, sig = c["from"], c["base"]
        if not c["newer"] and on_note(g):
            t = c["target"]
            ps = [p2 for p2 in ro["phases"] if p2["gate"] is not None and p2["gate"]["id"] == t["gate"]] if t.get("gate") else [p2 for p2 in ro["phases"] if p2["id"] == t.get("phase")]
            note = ((ps[0]["gate"] if t.get("gate") else ps[0])["note"] or "") if len(ps) == 1 else None
            frm, sig = (CF.js_slice(note, 2000), CF.text_hash("note|" + norm(note))) if note is not None else ("", "")
        ch = c["change"]
        k = norm(ch["to"]) if ch["op"] == "wording" else ch["where"] + "|" + norm(ch["text"]) if ch["op"] == "add" else CF.js_json(ch["to"]) if ch["op"] == "move" else ",".join(ch["to"]) if ch["op"] == "roles" else "" if ch["op"] == "remove" else CF.js_slice(cid, 40)
        m = {"process": proc, "target": c["target"], "change": ch, "version": c["version"] or rver, "test": run.get("test") is True or run.get("_test") is True, "legacy": False, "newer": c["newer"]}
        m["group"] = group_id("\n".join([str(proc), target_key(c["target"]), sig or frm or "", ch["op"], k]))
        return m
    # A suggested fix or a checklist-change note from before 1.13: a described problem.
    if n.get("kind") == "fix":
        t0 = n.get("target") if isinstance(n.get("target"), dict) else {}
        t = {"phase": jstr(t0.get("phase"), 60), "step": jstr(t0.get("step"), 60) or None}
    else:
        t = {"phase": "", "step": jstr(n.get("step"), 60) or None}
    fv = n.get("version")
    fv = math.floor(fv) if isinstance(fv, (int, float)) and not isinstance(fv, bool) and math.isfinite(fv) else 0
    x = next((st for st in ro["steps"] if st["id"] == t["step"]), None) if t["step"] else None
    if not t["phase"] and x is not None:
        t = {"phase": x["phase"]["id"], "step": t["step"]}
    m = {"process": proc, "target": t, "change": {"op": "describe"}, "version": (fv if n.get("kind") == "fix" else 0) or rver, "test": run.get("test") is True or run.get("_test") is True, "legacy": True, "newer": False}
    m["group"] = group_id("\n".join([str(proc), target_key(t), x["text"] if x is not None else "", "describe", CF.js_slice(cid, 40)]))
    return m

KEY = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}/[a-z0-9-]{1,40}\Z", re.I | re.A)
DAY = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}\Z", re.A)
RUN_FILE = re.compile(r"^runs/([^/]+)/([^/]+)/run\.json\Z")
DEP_ROLES = ("child run", "evidence run", "fulfilled run")
# The states PF.receipts.stateOf gives an ended living run's receipt; the manifest's living.receipt carries one.
RECEIPT_STATES = ("confirmed", "none", "missing", "unread", "mismatch")
# A run the work depends on, as the manifest names it (ND): exactly these fields, its role one PF.receipts.deps gives.
DEP_KEYS = {"key", "role", "head", "chain", "receipt", "confirmed"}
DEP_META_ROLES = ("child", "evidence", "fulfills")


def zone(tz):
    """The time zone a pack names, or None when it isn't text or isn't a zone this computer knows."""
    if not isinstance(tz, str) or not tz or len(tz) > 64:
        return None
    try:
        return zoneinfo.ZoneInfo(tz)
    except (ValueError, zoneinfo.ZoneInfoNotFoundError, OSError):
        return None


def real_day(s):
    """A day the export accepts (E.day): YYYY-MM-DD that a calendar has."""
    if not isinstance(s, str) or not DAY.match(s):
        return False
    try:
        datetime.date.fromisoformat(s)
        return True
    except ValueError:
        return False


def started_day(created, tz):
    """The day a clock in tz showed when a run started (E.inRange's localDay), or None when its created can't be read."""
    if not isinstance(created, str):
        return None
    try:
        t = datetime.datetime.fromisoformat(created)
    except ValueError:
        return None
    if t.tzinfo is None:
        return None
    return t.astimezone(tz).date().isoformat()


def obj(x):
    """A value read as an object only when it is one: anything else reads as having no fields."""
    return x if isinstance(x, dict) else {}


def arr(x):
    """A value read as a list only when it is one: anything else reads as empty."""
    return x if isinstance(x, list) else []


def manifest_problem(man):
    """The manifest's shape, checked once before anything reads it (KB-KD): why it isn't a manifest the export writes, or ''.
    Its scope in one of the two forms (a run, or a process and a date range), every file and generated entry with its names
    and hash, no source path packed twice, every run named once with a living section of the export's shape, and the
    packed run.json originals matching the manifest's runs one to one: each packed run.json is a run's own (an entry under
    its key) or one a run's work names (living.deps), and each run's run.json is packed unless the pack says partial."""
    if not isinstance(man, dict):
        return "it isn't an object"
    if man.get("status") not in ("complete", "partial"):
        return "its status isn't complete or partial"
    for k in ("files", "generated", "runs"):
        if not isinstance(man.get(k), list):
            return "its " + k + " isn't a list"
    sc = man.get("scope")
    if not isinstance(sc, dict):
        return "its scope isn't an object"
    # Exactly the export's keys in either form (MC): {run, tz} or {process, from, through, tz}.
    if "run" in sc:
        if set(sc) != {"run", "tz"} or not isinstance(sc["run"], str) or not KEY.match(sc["run"]):
            return "its scope isn't a run's key and a time zone, and only those"
    elif not (set(sc) == {"process", "from", "through", "tz"} and isinstance(sc.get("process"), str) and KEY.match(sc["process"] + "/x")
              and isinstance(sc.get("from"), str) and DAY.match(sc["from"]) and isinstance(sc.get("through"), str) and DAY.match(sc["through"])):
        return "its scope is neither a run nor a process with a date range and a time zone, and only those"
    if zone(sc["tz"]) is None:
        return "its scope's time zone isn't one this computer knows"
    if "tz" in man and man["tz"] != sc["tz"]:
        return "its time zone isn't its scope's"
    if "process" in sc:
        if not real_day(sc["from"]) or not real_day(sc["through"]):
            return "a day in its scope isn't a real date"
        if sc["from"] > sc["through"]:
            return "its scope's first day (" + sc["from"] + ") is after its last day (" + sc["through"] + ")"
    paths, packs = set(), set()
    for f in man["files"]:
        if not isinstance(f, dict) or not all(isinstance(f.get(k), str) for k in ("pack", "path", "sha256", "role")):
            return "a file entry isn't a file"
        if f["path"] in paths:
            return "two files are packed from " + f["path"]
        if f["pack"] in packs:
            return "two files are packed as " + f["pack"]
        paths.add(f["path"])
        packs.add(f["pack"])
    for g in man["generated"]:
        if not isinstance(g, dict) or not isinstance(g.get("path"), str) or not isinstance(g.get("sha256"), str):
            return "a generated entry isn't a file"
    keys, named = [], set()
    for r in man["runs"]:
        if not isinstance(r, dict) or not isinstance(r.get("key"), str) or not KEY.match(r["key"]):
            return "a run entry doesn't name a run"
        if r["key"] in keys:
            return r["key"] + " is named twice"
        keys.append(r["key"])
        # A claim the pack can't confirm (a keep whose standing couldn't be worked out, MD) never sits under a complete pack:
        # the export confirms a claim only by stating it as its own text.
        cls = r.get("claims", [])
        if not isinstance(cls, list) or not all(isinstance(c, dict) and isinstance(c.get("verified"), bool) and isinstance(c.get("text"), str)
                                                and isinstance(c.get("status"), str) for c in cls):
            return "the claims of " + r["key"] + " aren't the export's"
        if man["status"] == "complete" and any(c["verified"] is not True or c["status"] != c["text"] for c in cls):
            return "the pack says it's complete, but a claim of " + r["key"] + " can't be confirmed from it"
        lv = r.get("living")
        if lv is None:
            continue
        if not (isinstance(lv, dict) and isinstance(lv.get("complete"), bool) and isinstance(lv.get("head"), str)
                and isinstance(lv.get("chain"), list) and all(isinstance(x, str) for x in lv["chain"])
                and (lv.get("receipt") is None or isinstance(lv["receipt"], dict)) and isinstance(lv.get("deps", []), list)
                and isinstance(lv.get("missing", []), list)):
            return "the living section of " + r["key"] + " isn't the export's"
        rc = lv.get("receipt")
        if rc is not None and not (set(rc) == {"id", "state", "why"} and isinstance(rc["id"], str) and isinstance(rc["state"], str)
                                   and rc["state"] in RECEIPT_STATES and isinstance(rc["why"], str)):
            return "the receipt the living section of " + r["key"] + " names isn't the export's: an id, one of its states and a why"
        deps_seen = set()
        for d in lv.get("deps", []):
            if not (isinstance(d, dict) and set(d) == DEP_KEYS and isinstance(d["key"], str) and KEY.match(d["key"]) and d["role"] in DEP_META_ROLES
                    and isinstance(d["head"], str) and isinstance(d["chain"], list) and all(isinstance(x, str) for x in d["chain"])
                    and isinstance(d["receipt"], str) and isinstance(d["confirmed"], bool)):
                return "a run the work of " + r["key"] + " depends on isn't named as the export names it"
            if d["key"] in deps_seen:
                return "the living section of " + r["key"] + " names " + d["key"] + ", a run its work depends on, twice"
            if d["key"] == r["key"]:
                return "the living section of " + r["key"] + " names the run itself as a run its work depends on"
            deps_seen.add(d["key"])
            named.add(d["key"])
    if "run" in sc:
        if keys != [sc["run"]]:
            return "the pack was made for " + sc["run"] + ", but its manifest doesn't name that run, and only it, once"
    elif any(k.split("/")[0] != sc["process"] for k in keys):
        return "a run in it isn't a run of " + sc["process"]
    packed_runs = {}
    for f in man["files"]:
        m = RUN_FILE.match(f["path"])
        if m:
            packed_runs[m.group(1) + "/" + m.group(2)] = f
    for k, f in sorted(packed_runs.items()):
        if f["role"] == "run" and k not in keys:
            return "runs/" + k + "/run.json is packed as a run of the pack, but the manifest doesn't name it"
        if k not in keys and k not in named:
            return "runs/" + k + "/run.json is packed, but neither the manifest nor any run's work names it"
    for k in keys:
        if k not in packed_runs and man["status"] != "partial":
            return "runs/" + k + "/run.json isn't in the pack, but the pack doesn't say it is partial"
    return ""


def strict_json(text, doubles=True):
    """Text parsed as the app's checked parse does (repo's json: PF.util.jsonTooDeep, then JSON.parse): nothing nested more
    than 64 levels deep, no NaN or Infinity, every number a double. ValueError otherwise."""
    if CF.json_too_deep(text):
        raise ValueError(CF.DEEP_WHY)
    try:
        return json.loads(text, parse_int=float if doubles else CF._jsint, parse_constant=CF._no_constant)
    except RecursionError:
        raise ValueError(CF.DEEP_WHY)


def decode(raw):
    """A packed original read as the app reads it (its checked parse): its text as TextDecoder gives it (RV.utf8_text), nothing
    nested more than PF.util.JSON_DEPTH (64) levels deep, no NaN or Infinity, and every number a double. ValueError otherwise."""
    return strict_json(RV.utf8_text(raw))


COPY = re.compile(r"^( \([0-9]{1,3}\)|-[A-Za-z0-9-]{1,63})$")
# What the app's reader leaves out of a checked to-do or scope record (its envelope, the tool's key its id already holds, and
# when a scope record was written): two copies are one record when everything else is the same (PF.loop.copyBody).
ENVELOPE = ("format", "features", "app", "created", "key")


RECEIPT_BODY = ("head", "outcome", "seen", "counts", "coverage", "evidence", "keeps")


def copy_body(o):
    """A record as the app compares its copies (PF.loop.copyBody of the checked record): its own fields, the envelope left out,
    keys in any order, lists in order. A receipt by its own body, as its verdict compares copies (what it froze, never when it
    was written; the shipped checker's receipt_verdict)."""
    if not isinstance(o, dict):
        return json.dumps(o, sort_keys=True)
    if o.get("kind") == "receipt":
        return "receipt " + json.dumps({k: o[k] for k in RECEIPT_BODY if k in o}, sort_keys=True)
    return CF.todo_copy_body(o)


def copy_of(path, o):
    """A packed record's copy body, from the record as the app reads it (CF.todo_checked: PF.todos.cleanFile's record, so a
    copy leaving out a derived field or writing an optional one as null is the same record)."""
    return copy_body(CF.todo_checked(o, path[len("proposals/"):]) if path.startswith("proposals/") else o)
def check_living(z, man):
    by_path = {f["path"]: f["pack"] for f in man["files"]}

    def load(path):
        return decode(z.read(by_path[path]))

    cache = {}

    def packed(path):
        if path not in by_path:
            return None
        if path not in cache:
            try:
                cache[path] = load(path)
            except ValueError:
                cache[path] = None
        return cache[path]

    def on_run(me):
        """Every packed record the export counts for a run whatever saw it (PF.receipts.deps): each to-do record naming it, the
        facts they rest on and its loops' scope records. Returns the scope records (what each saw is walked too), and notes in
        plans_wanted every evidence plan those records name by reference, and in facts_wanted every fact they rest on."""
        scopes = []
        for path in by_path:
            if not path.startswith("proposals/") or not CF.json_name(path):
                continue
            # One family dispatch before any filter (dispatch): a record the app can't read whose run or loop can't be told may
            # be this run's, so it is reached and judged below; one that names a run or a loop names that one.
            d = dispatch(path)
            if d["bad"]:
                if applies(d, me):
                    reached.add(path)
                continue
            if d["fam"] not in ("todo", "scope"):
                continue
            o = packed(path)
            lp = o.get("loop")
            if o.get("run") == me or (isinstance(lp, dict) and lp.get("process") == me["process"] and lp.get("run") == me["id"]):
                reached.add(path)
                if isinstance(lp, dict) and o.get("run") != me:
                    scopes.append(o)
                for b in (o, obj(o.get("effect")), obj(obj(o.get("application")).get("effect"))):
                    ev = obj(b).get("evidence")
                    if o.get("run") == me and isinstance(ev, dict) and isinstance(ev.get("run"), dict):
                        plans_wanted.add(str(ev.get("plan")))
                    fact = obj(obj(b).get("support")).get("fact")
                    if o.get("run") == me and isinstance(fact, str):
                        facts_wanted.add(fact)
                    if isinstance(fact, str):
                        reached.update(packed_ids(fact))
        return scopes

    reached, plans_wanted, facts_wanted = set(), set(), set()
    # Each fact a landed done or a receipt rests on, with what it must say (VB): (reference, item, opening, what, content only).
    fact_refs: list = []
    # Each done on a run's evidence (reference, to-do, the run it is on, what), and what the receipt names wrongly (WA).
    run_refs: list = []
    work_problems: list = []
    dispatched = {}

    def applies(d, me):
        """Whether a dispatched record that can't be read is a run's to judge: one naming no run and no loop (which run it is for
        can't be told), or naming this run, or a loop of this run. The one predicate on_run and the living gate share."""
        lp = d["loop"]
        return (d["run"] is None and lp is None) or d["run"] == me or (lp is not None and lp["process"] == me["process"] and lp["run"] == me["id"])

    def loop_of(o):
        """PF.loop.loopOf: the loop a record names, exactly {process, run, step}, when those are text; else None."""
        v = o.get("loop") if isinstance(o, dict) else None
        ok = isinstance(v, dict) and all(isinstance(v.get(k), str) for k in ("process", "run", "step"))
        return {"process": v["process"], "run": v["run"], "step": v["step"]} if ok else None

    def dispatch(path):
        """The loader's one family dispatch for a packed proposals/ original, before any run or loop filter: {fam, bad, run,
        loop}. fam: "todo" (PF.todos.claims), "scope" (a scope request or decision), "plan" (any other file a reader keeps),
        or "none"; bad: why the app wouldn't read it (its family's reader), or "" ; run and loop: what it names, or None when
        that can't be told. A req-*.json that isn't a file any family reads is unread, naming nothing."""
        if path in dispatched:
            return dispatched[path]
        raw = z.read(by_path[path])
        try:
            o = decode(raw)
            torn = ""
        except ValueError as e:
            o, torn = None, CF.DEEP_WHY if str(e) == CF.DEEP_WHY else "isn't complete JSON"
        name = path[len("proposals/"):]
        kept = isinstance(o, dict) and (o.get("kind") in ("plan", "status") or isinstance(o.get("format"), str))
        if torn or (name.lower().startswith("req-") and not kept):
            d = {"fam": "none", "bad": torn or "isn't a file Flightdeck reads here", "run": None, "loop": None}
        elif not kept:
            d = {"fam": "none", "bad": "", "run": None, "loop": None}
        elif CF.todo_claims(o):
            d = {"fam": "todo", "bad": CF.todo_why(o, name, len(raw)), "run": run_of(o), "loop": None}
        elif o.get("format") in (CF.SCOPE_REQUEST, CF.SCOPE_DECISION):
            kind, needs, why = CF.scope_why(o, name)
            d = {"fam": "scope", "bad": why or kind, "run": None, "loop": loop_of(o)}
        else:
            d = {"fam": "plan", "bad": "", "run": None, "loop": None}
        dispatched[path] = d
        return d

    def run_of(o):
        """PF.todos.runOf: the run a record names, exactly {process, id} (other keys dropped), when those are text; else None."""
        v = o.get("run") if isinstance(o, dict) else None
        ok = isinstance(v, dict) and isinstance(v.get("process"), str) and isinstance(v.get("id"), str)
        return {"process": v["process"], "id": v["id"]} if ok else None

    def packed_ids(rid):
        """The packed files of one record id: its own name and its synced copies (" (1)" and the like)."""
        base = "proposals/" + rid
        return [p for p in by_path if p.startswith(base) and CF.json_name(p) and (p[len(base):-5] == "" or (COPY.match(p[len(base):-5])
                and (not p[len(base):-5].startswith("-") or any(c.isupper() for c in p[len(base):-5]))))]

    def record_name(path):
        """The record a packed proposals/ name stands for (its own name, or the one a synced copy copies), or ''."""
        if not path.startswith("proposals/") or not CF.json_name(path):
            return ""
        stem = path[len("proposals/"):-5]
        for i in range(1, len(stem)):
            rest = stem[i:]
            if stem[i] in " -" and COPY.match(rest) and (not rest.startswith("-") or any(c.isupper() for c in rest)):
                return stem[:i]
        return stem

    def witness(rid):
        """The one record packed under an id, the same in every packed copy (a synced " (1)" copy included); None when it
        isn't packed or two packed copies differ (ambiguous: which is meant isn't known)."""
        paths = packed_ids(rid)
        if not paths:
            return None, False
        reached.update(paths)
        try:
            recs = [load(p) for p in paths]
        except (ValueError, UnicodeDecodeError):
            return None, False
        if any(copy_of(p, r) != copy_of(paths[0], recs[0]) for p, r in zip(paths, recs)):
            return None, True
        return recs[0], False

    def check_run(run):
        """One run's closure, replayed on its own: its chain from living.head (every link a unique witness), each application's
        request, its authority and every record it saw, and its receipt. Returns (whole, chain, closed, receipt ok, copies)."""
        own = obj(run.get("living"))
        head = own.get("head", "")
        me = {"process": run.get("process"), "id": run.get("id")}
        copies = [""]
        scopes = on_run(me)

        def wit(rid):
            rec, amb = witness(rid)
            if amb and not copies[0]:
                copies[0] = rid
            # A witness that isn't an object is there but is no record: it has no fields to match.
            return rec if rec is None or isinstance(rec, dict) else {}

        # Every record the run's work reaches is held to its copies (a pending request and a loop's scope record included), as
        # in the export: the id each packed name stands for, its copies compared by the one rule.
        names = {}
        for path in reached:
            rid = record_name(path)
            if rid:
                names[rid] = names.get(rid, 0) + 1
        for rid in sorted(names):
            if len(packed_ids(rid)) > 1:
                wit(rid)

        chain, at, seen, whole = [], head, set(), True
        while at:
            if at in seen:
                whole = False
                break
            seen.add(at)
            rec = wit(at)
            if rec is None or rec.get("run") != me:
                whole = False
                break
            if rec.get("kind") == "compound":
                prev = obj(rec.get("application")).get("previous", "")
            elif rec.get("kind") == "application":
                prev = rec.get("previous", "")
            else:
                whole = False
                break
            chain.insert(0, at)
            at = prev
        closed, want, asked = whole, [], set()
        # A done that landed on a fact's evidence is held to that fact as packed (PF.receipts.deps, VB): the content, source
        # and domain the done named, and the run, item and attempt of the to-do it checks off, in the opening it was suggested for.
        # It is the app's replay (PF.todos reduce, XB), the one replay here: each landed effect, in chain order, checked
        # against its request and the work as it stood, before anything is taken from it. One that doesn't fit breaks the chain:
        # named, and nothing after it is replayed.
        opened: dict = {}
        # The run's work in the app's causal order (PF.loop.causal over the run's own records, as the export's PF.todos.view
        # reads them, YA): only records the app reads as this run's to-do records, by the record each name stands for (a status
        # record's id is its name), never a fact, keep or receipt. Copies of one id that differ, a record that saw one outside
        # that set or in a circle (itself included), and everything after either, are held; only records read in order replay.
        mine, mine_body, split = {}, {}, set()
        for path in sorted(reached):
            rid = record_name(path)
            if not rid:
                continue
            d, o = dispatch(path), packed(path)
            if d["fam"] != "todo" or d["bad"] or d["run"] != me or not isinstance(o, dict) or o.get("kind") in ("fact", "keep", "receipt"):
                continue
            if rid in mine and mine_body[rid] != copy_of(path, o):
                split.add(rid)
            if rid not in mine:
                mine[rid], mine_body[rid] = o, copy_of(path, o)
        state, anc, held = {}, {}, set()

        def finish(i):
            state[i] = 2
            if i in split:
                anc[i] = None
                held.add(i)
                return
            a, ok = set(), True
            for y in arr(mine[i].get("seen")):
                # Not here, not finished, held, or this record itself (its ancestors aren't known yet): held.
                if not isinstance(y, str) or y not in mine or state.get(y) != 2 or anc.get(y) is None:
                    ok = False
                    continue
                a.add(y)
                a |= anc[y]
            anc[i] = a if ok else None
            if not ok:
                held.add(i)

        for root in sorted(mine):
            stack = [[root, False]]
            while stack:
                top = stack[-1]
                i = top[0]
                if top[1]:
                    stack.pop()
                    finish(i)
                    continue
                if i in state:
                    stack.pop()
                    continue
                state[i], top[1] = 1, True
                if i in split:
                    continue
                for y in reversed(arr(mine[i].get("seen"))):
                    if isinstance(y, str) and y in mine and y not in state:
                        stack.append([y, False])
        readable = {k: v for k, v in mine.items() if k not in held}

        def ancestors(rid):
            return anc.get(rid) or set()

        landed, spreads, added = set(), {}, 0
        for at in chain if whole else []:
            if at not in readable:
                work_problems.append("proposals/" + at + ".json: The application " + at + " can't be read in order yet.")
                break
            rec = wit(at)
            comp = rec.get("kind") == "compound"
            ap = obj(rec.get("application")) if comp else rec
            e = obj(ap.get("effect"))
            pid = at if comp else rec.get("proposal")
            p = readable.get(pid) if isinstance(pid, str) else None
            td, op = e.get("todo"), e.get("op")
            x0 = opened.get(td) if isinstance(td, str) else None
            st = x0["state"] if x0 else None
            if p is None or p.get("kind") not in ("proposal", "compound"):
                why = "its request " + str(pid) + " isn't here"
            else:
                # What it asks for, from the body the shipped checker checked (YB): ids readers derive (an addition's to-do, a
                # spread creation's spread) filled in as the app fills them.
                bl: list = []
                CF.todo_why(p, pid + ".json", body=bl)
                if not bl or CF._tsha({k: v for k, v in CF.todo_effect_of(bl[0]).items() if v is not None}) != ap.get("fingerprint"):
                    why = "its effect isn't what " + pid + " asks for"
                elif not comp and pid not in ancestors(at):
                    why = "it didn't see its request"
                elif ap.get("previous") and not comp and ap.get("previous") not in ancestors(at):
                    why = "it didn't see the application before it"
                elif pid in landed:
                    why = pid + " was applied twice"
                elif op in CF.TODO_SOPS:
                    why = spread_why(spreads, e)
                elif op == "add":
                    why = ("it adds " + str(td) + " again") if x0 else ("it would add more than 500 to-dos" if added >= 500 else "")
                elif x0 is None:
                    why = "it changes " + str(td) + ", which was never added"
                elif op == "reopen":
                    why = (td + " is already open") if st == "open" else ""
                else:
                    why = (td + " is already " + {"done": "done", "wont": "won't do", "moved": "moved"}.get(st, str(st))) if st != "open" else ""
            if why:
                work_problems.append("proposals/" + at + ".json: The application " + at + " can't be applied: " + why + ".")
                break
            landed.add(pid)
            if op in CF.TODO_SOPS:
                spread_apply(spreads, e)
                continue
            if op == "add":
                added += 1
            if not isinstance(td, str):
                continue
            op, sup, evd = e.get("op"), e.get("support"), e.get("evidence")
            sup, evd = (sup if isinstance(sup, dict) else None), (evd if isinstance(evd, dict) else None)
            wf, wr = "application " + at + " checks off " + td + " on it", "application " + at + " checks off " + td + " on this run"
            if op == "add":
                opened[td] = {"id": td, "target": e.get("target"), "checklist": e.get("checklist"), "inc": at, "state": "open", "support": None, "evidence": None}
                continue
            x = opened.get(td)
            if x is None:
                if op == "done" and sup:
                    fact_refs.append((sup, None, None, wf, False))
                if op == "done" and evd:
                    run_refs.append((evd, None, run, wr))
                continue
            if op == "reopen":
                x.update({"inc": at, "state": "open", "support": None, "evidence": None})
                continue
            x["state"] = "moved" if op == "move" else op
            if op != "done":
                continue
            x["support"], x["evidence"] = sup, evd
            if sup:
                fact_refs.append((sup, item_of(run, x), x["inc"], wf, False))
            if evd:
                # The to-do as it stands at this done (XA): a later reopen changes x, never the opening this done landed in.
                run_refs.append((evd, dict(x), run, wr))

        def saw(rec):
            for x in arr(rec.get("seen")):
                if isinstance(x, str) and x not in asked:
                    asked.add(x)
                    want.append(x)

        for at in chain if whole else []:
            rec = wit(at)
            saw(rec)
            if rec.get("kind") != "application":
                continue
            req = wit(str(rec.get("proposal")))
            if req is None or req.get("kind") not in ("proposal", "compound") or req.get("run") != me:
                closed = False
                continue
            saw(req)
            au = obj(rec.get("authority"))
            if au.get("decision"):
                w = wit(str(au["decision"]))
                good = w is not None and w.get("kind") == "decision" and w.get("proposal") == rec.get("proposal") and w.get("run") == me
            elif au.get("grant"):
                w = wit(str(au["grant"]))
                good = w is not None and w.get("kind") == "grant"
            elif au.get("compound"):
                w = wit(str(au["compound"]))
                good = w is not None and w.get("kind") == "compound"
            else:
                w, good = None, False
            if not good:
                closed = False
                continue
            saw(w)
        # A loop's scope records rest on what each saw, in turn, as every other record does (PF.receipts.deps).
        for x in scopes:
            saw(x)
        i = [0]

        def walk():
            """The records still wanted, each through what it saw in turn, within the one bound: False when one isn't here."""
            while i[0] < len(want):
                if len(reached) > 5000:
                    sys.exit("living: " + str(me["process"]) + "/" + str(me["id"]) + " rests on more records and runs than a pack holds at most (5000)")
                rec = wit(want[i[0]])
                i[0] += 1
                if rec is None:
                    return False
                saw(rec)
            return True

        if closed:
            closed = walk()
        receipt = own.get("receipt")
        good_receipt = True
        own_ok[0] = False
        claims_why[0] = ""
        if receipt:
            rec = wit(receipt)
            ended = obj(run.get("ended"))
            good_receipt = (rec is not None and rec.get("kind") == "receipt" and rec.get("id") == receipt and rec.get("head") == head
                            and rec.get("outcome") == ended.get("outcome") and rec.get("by") == ended.get("by") and rec.get("run") == me)
            # Read as the shipped checker reads it: its format, limits and the id its content gives.
            if good_receipt:
                # Every packed copy of the witness resolved above (its own name and each synced copy's), each read by those rules:
                # copies are one receipt by its body, but every original is checked whole.
                paths = packed_ids(receipt)
                def whole(p):
                    try:
                        return CF.todo_why(decode(z.read(by_path[p])), p[len("proposals/"):]) == ""
                    except ValueError:
                        return False
                good_receipt = bool(paths) and all(whole(p) for p in paths)
            own_ok[0] = good_receipt
            # Every record it names as seen (pending requests included) is in the pack, and what each of those saw, in turn.
            if good_receipt:
                for x in arr(rec.get("seen")):
                    if wit(str(x)) is None:
                        good_receipt = False
                # Each evidence entry is exactly the evidence its to-do was checked off on, as the chain leaves it (WA), named
                # once; every fact it names says what it said when the run ended (VB).
                named = set()
                for ev in arr(rec.get("evidence")):
                    ev = obj(ev)
                    td = ev.get("todo")
                    x = opened.get(td) if isinstance(td, str) else None
                    where = str(me["process"]) + "/" + str(me["id"]) + "'s receipt names evidence for " + str(td)
                    if td in named:
                        work_problems.append(where + " twice")
                        continue
                    named.add(td)
                    if x is None:
                        work_problems.append(where + ", but the run's work never added that to-do")
                        continue
                    if x["state"] != "done" or not (x["support"] or x["evidence"]):
                        work_problems.append(where + ", but that to-do wasn't checked off on evidence")
                        continue
                    s_, e_ = x["support"], x["evidence"]
                    froze = ({"todo": td, "fact": s_.get("fact"), "content": s_.get("content")} if s_ else
                            {"todo": td, "plan": e_.get("plan"), "run": obj(e_.get("run")), "answer": e_.get("answer"), "result": e_.get("result")})
                    if froze != ev:
                        work_problems.append(where + ", but it isn't the evidence that to-do was checked off on")
                        continue
                    if isinstance(ev.get("fact"), str):
                        fact_refs.append((ev, None, None, "the receipt names it as the evidence " + str(td) + " was checked off on", True))
                # And the other way (WC): every to-do the work left checked off on evidence is named, as an honest receipt froze it.
                for td, x in opened.items():
                    if x["state"] == "done" and (x["support"] or x["evidence"]) and td not in named:
                        work_problems.append(str(me["process"]) + "/" + str(me["id"]) + "'s receipt: " + td + " was checked off on evidence, but the receipt doesn't name that evidence")
                # Every keep it names is a keep on this run, one witness under its id.
                for x in arr(rec.get("keeps")):
                    kx = wit(str(x))
                    if kx is None or kx.get("kind") != "keep" or kx.get("run") != me:
                        good_receipt = False
            if good_receipt and closed:
                saw(rec)
                good_receipt = walk()
            # What it claims, replayed from the packed bytes as the folder checker replays it (PF.receipts.claimsWhy): what it
            # names as unsettled, the chain from its head, the to-dos, requests, coverage, steps and evidence that chain and the
            # packed run.json give, and its keeps. Its id is its own content, never proof of it.
            if good_receipt and closed:
                work, keeps, every = {}, set(), {}
                for path in sorted(by_path):
                    rid = record_name(path)
                    if not rid:
                        continue
                    d, o = dispatch(path), packed(path)
                    if d["fam"] != "todo" or d["bad"] or not isinstance(o, dict):
                        continue
                    # Every packed copy under the id, whatever run it names, as the app tells copies apart (PF.loop.splitIds).
                    every.setdefault(rid, []).append(CF.todo_checked(o, path[len("proposals/"):]))
                    if d["run"] != me:
                        continue
                    if o.get("kind") == "keep":
                        keeps.add(rid)
                    if o.get("kind") not in ("fact", "keep", "receipt"):
                        work.setdefault(rid, []).append(o)
                sr = RV.sanitize(run) if isinstance(run, dict) else None
                cw = CF.receipt_claims_why(sr, rec, work, keeps, every) if isinstance(sr, dict) else ("why", "its run.json can't be read")
                if cw:
                    claims_why[0] = "it rests on proposals/" + cw[1] + ".json, which isn't in the pack" if cw[0] == "missing" else "it says something its run's work doesn't: " + cw[1]
                    work_problems.append(str(me["process"]) + "/" + str(me["id"]) + "'s receipt: " + claims_why[0])
                    good_receipt = False
                    own_ok[0] = False
        return whole, chain, closed, good_receipt, copies[0]

    # Whether the last run check_run read has a receipt record of its own that says what it ended with, read whole (what
    # PF.receipts.stateOf calls confirmed), apart from what the receipt saw.
    own_ok = [False]
    # Why the last run check_run read has a receipt whose claims its packed work doesn't bear out ('' when they hold).
    claims_why = [""]

    def checked(path, o):
        """A packed to-do record as the app reads it (YC): a request or compound with the body the shipped checker checked laid
        over it, so an id readers derive (an addition's to-do, a spread creation's spread) is there when the file leaves it
        out, as PF.todos.cleanFile fills it in; any other record as it is."""
        bl: list = []
        if isinstance(o, dict) and o.get("kind") in ("proposal", "compound") and not CF.todo_why(o, (record_name(path) or path[len("proposals/"):-5]) + ".json", body=bl) and bl:
            return dict(o, **bl[0])
        return o

    def depends_on(run):
        """The runs a run's work depends on, found in the pack on their own: packed runs naming it as their loop's parent, and
        the runs its packed records were done on (evidence) or fulfill a spread of. Each with the roles its references give it,
        as PF.receipts.deps names them (OD)."""
        me = {"process": run.get("process"), "id": run.get("id")}
        out: dict = {}

        def add(k: str, role: str) -> None:
            out.setdefault(k, set()).add(role)
        for path in by_path:
            parts = path.split("/")
            if len(parts) == 4 and parts[0] == "runs" and parts[3] == "run.json":
                o = packed(path)
                par = obj(obj(o).get("parent"))
                if isinstance(par, dict) and par.get("item") and par.get("process") == me["process"] and par.get("id") == me["id"]:
                    add(parts[1] + "/" + parts[2], "child")
            # GB: every checked to-do record naming the run, its decisions and applications (status files) and their effects
            # included, by the one dispatch and the run as runOf reads it, as PF.receipts.deps finds them.
            elif path.startswith("proposals/") and CF.json_name(path):
                o = checked(path, packed(path)) if dispatch(path)["fam"] == "todo" and not dispatch(path)["bad"] else None
                if not isinstance(o, dict) or run_of(o) != me:
                    continue
                for b in (o, obj(o.get("effect")), obj(obj(o.get("application")).get("effect"))):
                    ev = obj(obj(b).get("evidence"))
                    if isinstance(ev, dict) and isinstance(ev.get("run"), dict):
                        add(str(ev["run"].get("process")) + "/" + str(ev["run"].get("id")), "evidence")
                ff = o.get("fulfills") or {}
                if isinstance(ff, dict) and isinstance(ff.get("run"), dict):
                    add(str(ff["run"].get("process")) + "/" + str(ff["run"].get("id")), "fulfills")
                for b in (o, obj(o.get("effect")), obj(obj(o.get("application")).get("effect"))):
                    dv = obj(b).get("dest")
                    if isinstance(dv, dict) and isinstance(dv.get("process"), str):
                        add(dv["process"] + "/" + str(dv.get("id")), "child")
        # HB: the spreads this run's own records hold (asked, included, bound or stopped), and every checked to-do record, on any
        # run, fulfilling one of them: that record is part of the work, and its run is a run the work depends on (as
        # PF.receipts.deps finds them; the walk follows each in turn).
        todos = []
        for path in by_path:
            if path.startswith("proposals/") and CF.json_name(path):
                d = dispatch(path)
                if d["fam"] == "todo" and not d["bad"] and isinstance(packed(path), dict):
                    todos.append((path, checked(path, packed(path))))
        held = set()
        for path, o in todos:
            if run_of(o) == me:
                for b in (o, o.get("effect"), obj(o.get("application")).get("effect")):
                    if isinstance(b, dict) and isinstance(b.get("spread"), str) and b["spread"]:
                        held.add(b["spread"])
        for path, o in todos:
            ff, by = o.get("fulfills"), run_of(o)
            if isinstance(ff, dict) and isinstance(ff.get("spread"), str) and ff["spread"] in held and by:
                reached.add(path)
                add(by["process"] + "/" + by["id"], "child")
        # A loop item's choice names a child run by id, of the process its loop step starts (that step's process with Fill in's
        # changes, as PF.receipts.deps finds it): exactly that run, packed or not; a step that can't be told is never matched.
        def proc_of_step(step_id):
            r = RV.sanitize(run) if isinstance(run, dict) else None
            try:
                steps = CF.parse_map(r["snapshot"])["steps"] if r and isinstance(r.get("snapshot"), str) else []
            except (TypeError, AttributeError, KeyError, ValueError):
                steps = []
            for st in steps:
                if st.get("id") == step_id and st.get("type") == "for.each":
                    cp = RV.fields_of(r, st).get("process")
                    return cp if isinstance(cp, str) else ""
            return ""
        for path in by_path:
            if not path.startswith("proposals/") or not CF.json_name(path):
                continue
            o = packed(path) if dispatch(path)["fam"] == "scope" and not dispatch(path)["bad"] else None
            lp = obj(o).get("loop")
            if not isinstance(lp, dict) or lp.get("process") != me["process"] or lp.get("run") != me["id"]:
                continue
            for ch in arr(o.get("changes")):
                if isinstance(ch, dict) and ch.get("op") == "choose" and isinstance(ch.get("run"), str) and ch["run"]:
                    cp = proc_of_step(lp.get("step"))
                    add((cp or "?") + "/" + ch["run"], "child")
        return out

    def reach(root_key: str, root_run) -> dict:
        """Every run the root's work depends on, found from the packed references alone (depends_on, run by run, through
        packed runs every reader could read as an object), each with the roles those references give it; bounded (5000)."""
        roles: dict = {}
        todo, seen_k = [(root_key, root_run)], set()
        while todo and len(seen_k) <= 5000:
            k, o = todo.pop(0)
            if k in seen_k or not isinstance(o, dict):
                continue
            seen_k.add(k)
            for fk, fr in depends_on(o).items():
                if fk == root_key:
                    continue
                roles.setdefault(fk, set()).update(fr)
                if fk not in seen_k:
                    todo.append((fk, packed("runs/" + fk + "/run.json") if ("runs/" + fk + "/run.json") in by_path else None))
        return roles

    def closure_tail() -> str:
        """What the closure gathered so far (facts_wanted, plans_wanted, reached) checked in full, as a complete pack checks
        it: each fact and what it saw, every original by its own family's reader, each evidence plan. The clause after
        "but" naming the first thing wrong, or "". The one path for the root's complete work and for each dependency
        called confirmed (RA)."""
        # Each fact a to-do record rests on (support.fact), by that reference: one witness under its id (every packed copy the
        # same), a fact carrying that id.
        fstate: dict = {}
        for fid in sorted(facts_wanted):
            if not packed_ids(fid):
                return "proposals/" + fid + ".json, a fact the work rests on, isn't in the pack"
            rec, amb = witness(fid)
            if amb:
                return "the pack holds two different copies of proposals/" + fid + ".json, a fact the work rests on"
            if not isinstance(rec, dict) or rec.get("kind") != "fact" or rec.get("id") != fid:
                return "proposals/" + fid + ".json, a fact the work rests on, isn't that fact"
            # What the fact saw, depth first (PF.receipts.deps, OA): each one witness under its id and a fact of the same run,
            # within the one bound; one met again while it is still being followed is a circle.
            if fstate.get(fid):
                continue
            fstate[fid] = 1
            stack = [[rec, 0]]
            while stack:
                top = stack[-1]
                tseen = arr(top[0].get("seen"))
                if top[1] >= len(tseen):
                    fstate[top[0].get("id")] = 2
                    stack.pop()
                    continue
                sid = tseen[top[1]]
                top[1] += 1
                if not isinstance(sid, str):
                    continue
                tid = top[0].get("id")
                # Every edge is checked before a fact already walked is skipped (QA): its witness, kind and run against the
                # fact that saw it, whichever fact was walked first.
                if not packed_ids(sid):
                    return "proposals/" + sid + ".json, a record the fact " + str(tid) + " saw, isn't in the pack"
                srec, samb = witness(sid)
                if samb:
                    return "the pack holds two different copies of proposals/" + sid + ".json, a record the fact " + str(tid) + " saw"
                reached.update(packed_ids(sid))
                if len(reached) > 5000:
                    return "it rests on more records and runs than a pack holds at most (5000)"
                if not isinstance(srec, dict) or srec.get("kind") != "fact" or srec.get("id") != sid or not isinstance(srec.get("run"), dict) or srec.get("run") != top[0].get("run"):
                    return "proposals/" + sid + ".json, a record the fact " + str(tid) + " saw, isn't a fact of the same run"
                if fstate.get(sid) == 1:
                    return "the facts it rests on go round in a circle: fact " + str(tid) + " saw proposals/" + sid + ".json, which saw it in turn"
                if fstate.get(sid):
                    continue
                fstate[sid] = 1
                stack.append([srec, 0])
        for sup, it, inc, what, content_only in fact_refs:
            fid = sup.get("fact")
            if not isinstance(fid, str) or not packed_ids(fid):
                return "proposals/" + str(fid) + ".json, a fact the work rests on, isn't in the pack"
            rec, amb = witness(fid)
            if amb or not isinstance(rec, dict) or rec.get("kind") != "fact":
                return "proposals/" + fid + ".json, a fact the work rests on, isn't that fact"
            if content_only:
                why = "it doesn't say what it said then" if fact_content(rec) != sup.get("content") else ""
            else:
                why = ("its to-do was never added" if inc is None else "it names another opening of its to-do" if sup.get("incarnation") != inc
                       else "its to-do isn't about a loop item" if it is None
                       else "the fact is about another run, item or attempt" if (rec.get("run") != it["run"] or rec.get("loopStep") != it["loopStep"] or rec.get("uid") != it["uid"] or rec.get("attempt") != it["attempt"])
                       else "the fact is from another source or domain" if (rec.get("domain") != sup.get("domain") or source_key(rec.get("source")) != source_key(sup.get("source")))
                       else "the fact doesn't say what it said when the done landed" if fact_content(rec) != sup.get("content") else "")
            if why:
                return "proposals/" + fid + ".json: " + what + ", but " + why
        # Each done on a run's evidence, as PF.detours.provenance judges it (WA): this opening's plan, a run of the to-do's
        # checklist, packed, still giving the answer and result the done froze.
        for evd, x, root, what in run_refs:
            er = obj(evd.get("run"))
            path = "runs/" + str(er.get("process")) + "/" + str(er.get("id")) + "/run.json"
            ck = obj(x.get("checklist")) if x else {}
            why = ("its to-do isn't linked to a checklist" if not x or not js_truthy(x.get("checklist"))
                   else "it names another opening of its to-do" if evd.get("plan") != "plan-ev-" + CF._thash(["evidence", root.get("process"), root.get("id"), x["id"], x["inc"] or ""], 24)
                   else "it names a run of another checklist" if er.get("process") != ck.get("process") else "")
            if not why:
                dr = packed(path)
                if not isinstance(dr, dict):
                    why = "that run isn't in the pack"
                elif not js_truthy(dr.get("ended")):
                    why = "that run was reopened since"
                else:
                    res = result_of(dr)
                    value = res["value"] if res and not res["conflict"] else ""
                    if answer_of(dr) != evd.get("answer") or value != evd.get("result"):
                        why = "that run doesn't give the answer and result it gave then"
            if why:
                return path + ": " + what + ", but " + why
        if work_problems:
            return work_problems[0]
        # Every original reached is one the app reads, by its own family's reader.
        for path in sorted(reached):
            why = family_why(path)
            if why:
                return "" + path + ", a record its work rests on, isn't one the app reads: " + why
        for pid in sorted(plans_wanted):
            # The plan by its id, under its own name or a synced copy's: every copy packed a plan the app reads, and all of them
            # saying the same thing (PF.requests.same, the shipped checker's same_plan).
            ps = [packed(p) for p in sorted(packed_ids(pid))]
            if not ps or any(not isinstance(o, dict) or o.get("id") != pid or CF.plan_why(o) for o in ps):
                return "proposals/" + pid + ".json, an evidence plan the work names, isn't in the pack as a plan the app reads"
            if any(not CF.same_plan(o, ps[0]) for o in ps):
                return "the pack holds two different copies of proposals/" + pid + ".json, an evidence plan the work names"
        return ""

    def dep_check(k: str, d: dict) -> str:
        """Why a run the work depends on isn't confirmed as the export confirms it, or "": its run.json as every reader reads
        it, then the version it ran, as packed (repo.depVerdict), its end and living record, and its chain, head, closure
        and receipt as the manifest names them. (Conflict copies beside a run aren't packed; the export names them.)"""
        dep_run = packed("runs/" + k + "/run.json")
        if not isinstance(dep_run, dict):
            return k + ", a run it depends on, isn't in the pack as a run"
        bad = RV.dep_verdict(k, z.read(by_path["runs/" + k + "/run.json"]), lambda p: z.read(by_path[p]) if p in by_path else None)
        if bad:
            return k + ", a run it depends on, isn't one every reader accepts (" + bad[0] + ": " + bad[1] + ")"
        rp2 = CF.raw_problem(dep_run)
        if rp2:
            return k + ", a run it depends on, has an end or living record the readers refuse (" + rp2[0] + ": " + rp2[1] + ")"
        keep = own_ok[0]  # check_run sets the run's own receipt verdict; this is another run's, so the root's is kept
        w2, c2, cl2, rc2, cp2 = check_run(dep_run)
        own_ok[0] = keep
        if cp2:
            return "the pack holds two different copies of proposals/" + cp2 + ".json, a record " + k + " rests on"
        if not w2 or c2 != d.get("chain") or obj(dep_run.get("living")).get("head", "") != d.get("head", ""):
            return "the application chain of " + k + " isn't all in the pack"
        if not cl2:
            return "a request, an authority or a record " + k + " saw isn't in the pack"
        if not rc2:
            return "the receipt of " + k + " isn't in the pack, doesn't say what it ended with, or a record it saw isn't in the pack"
        return ""

    BOUND = "it rests on more records and runs than a pack holds at most (5000)"

    def walk_runs(root_key: str, start: str, named: dict, root_meta=None):
        """Every run the work from start depends on, walked from the packed references (depends_on), each but the root packed,
        named in the manifest and confirmed by dep_check, within the one shared bound (every original reached and every run,
        together; PF.receipts.deps). The one path for a complete root's work and for each dependency called confirmed (SA),
        whatever the manifest says of the runs it reaches. Returns (why, done, roles): why is the clause after "but", or "".
        From a dependency (root_meta: the root's own chain and head), a walk that reaches back to the root checks the root's
        chain and closure there once, in the same bound (TA); the root is never named among its dependencies."""
        todo, done, roles = [start], ({root_key} if start != root_key else set()), {}
        root_checked = start == root_key or root_meta is None
        while todo:
            k = todo.pop(0)
            if k in done:
                continue
            done.add(k)
            if len(reached) + len(done) - 1 > 5000:
                return BOUND, done, roles
            dep_run = packed("runs/" + k + "/run.json")
            if k != root_key:
                if dep_run is None:
                    return k + ", a run it depends on, isn't in the pack", done, roles
                if k not in named:
                    return "the manifest doesn't name " + k + ", a run it depends on", done, roles
                why = dep_check(k, named[k])
                if why:
                    return why, done, roles
            found = depends_on(dep_run)
            for fk, fr in found.items():
                roles.setdefault(fk, set()).update(fr)
            if root_key in found and not root_checked:
                root_checked = True
                why = dep_check(root_key, root_meta)
                if why:
                    return why + " (the run itself, which " + k + " depends on in turn)", done, roles
                if len(reached) + len(done) - 1 > 5000:
                    return BOUND, done, roles
                # The run's own dependencies are part of this walk too (VA), walked in the same bound; being walked never
                # makes the run one of its own dependencies.
                rfound = depends_on(packed("runs/" + root_key + "/run.json"))
                for fk, fr in rfound.items():
                    roles.setdefault(fk, set()).update(fr)
                todo.extend(sorted(set(rfound) - done))
            todo.extend(sorted(set(found) - done))
        if len(reached) + len(done) - 1 > 5000:
            return BOUND, done, roles
        return "", done, roles

    # Each evidence plan packed reads as a plan, by the shipped checker's rules (PF.plans.planWhy), under its own name.
    plans_bad = []
    for f in man["files"]:
        if f.get("role") == "evidence plan":
            try:
                o = load(f["path"])
            except ValueError:
                o = None
            # Under its own name or a synced copy's (" (1)" and the like), as the app reads plans.
            name = record_name(f["path"])
            if not isinstance(o, dict) or o.get("id") != name or CF.plan_why(o):
                plans_bad.append(f["path"])

    def family_why(path):
        """Why the app wouldn't read a packed original the work rests on, by its own family's reader in the shipped checker (a
        to-do record: proposal, compound, decision, application, fact, keep or receipt; a loop's scope record), else ''."""
        raw = z.read(by_path[path])
        try:
            o = decode(raw)
        except ValueError as e:
            return CF.DEEP_WHY if str(e) == CF.DEEP_WHY else "isn't complete JSON"
        name = path[len("proposals/"):]
        if CF.todo_claims(o):
            return CF.todo_why(o, name, len(raw))
        if isinstance(o, dict) and o.get("format") in (CF.SCOPE_REQUEST, CF.SCOPE_DECISION):
            kind, needs, why = CF.scope_why(o, name)
            return why or kind
        return "isn't a to-do record or a loop's scope record"

    def root_problem(key, run):
        """The readers' verdict on a packed root run.json (GA): the end and living record in their words (raw_problem), then
        everything else any reader refuses in it (RV.reader_problem), as (kind, why), or None."""
        return CF.raw_problem(run) or RV.reader_problem(key, run)

    def has_work(key):
        """Whether a packed run has work to check, from the packed originals alone (never the manifest): its run.json names a
        work head or a receipt, or a packed to-do record (PF.todos.claims) names the run."""
        run = packed("runs/" + key + "/run.json")
        if not isinstance(run, dict):
            return False
        own = run.get("living")
        if isinstance(own, dict) and (own.get("head") or own.get("receipt")):
            return True
        # FA, GA: living work in a run.json the readers refuse (the feature without its record, an empty or a list record, or
        # anything else any reader refuses in the file) is work to check, though sanitizing would drop it.
        if CF.living_work(run) and root_problem(key, run):
            return True
        me = {"process": run.get("process"), "id": run.get("id")}
        for path in by_path:
            # The same dispatch first: a record the app can't read whose run or loop can't be told, or that names this run,
            # is work to check.
            if path.startswith("proposals/") and CF.json_name(path):
                d = dispatch(path)
                if d["bad"] and applies(d, me):
                    return True
            if path.startswith("proposals/") and CF.json_name(path):
                o = packed(path)
                todo = isinstance(o, dict) and (o.get("format") in ("flightdeck-plan/4", "flightdeck-plan-status/4")
                                                or (isinstance(o.get("features"), list) and "living-runs" in o["features"]))
                if todo and run_of(o) == me:
                    return True
        return False

    def root_unread(key):
        """Why a selected root's run.json isn't one every reader reads (IB), as (kind, why), or None: present in the pack,
        parsed as every reader parses it (decode: nothing nested past 64 levels), a run, then the readers' verdict on it."""
        rp = "runs/" + key + "/run.json"
        if rp not in by_path:
            return ("missing", "it isn't in the pack")
        try:
            run = load(rp)
        except ValueError:
            return ("malformed", "it isn't complete JSON")
        if not isinstance(run, dict):
            return ("malformed", "it isn't a run this copy can read")
        return root_problem(key, run)

    n = 0
    for r in man["runs"]:
        lv = r.get("living")
        # The root first, before anything decides whether it has work to check: a root no reader reads, or work the manifest
        # itself says isn't complete, is never in a complete pack.
        ru = root_unread(r["key"])
        if ru and man["status"] != "partial":
            sys.exit("living: " + r["key"] + "'s run.json isn't one every reader reads (" + ru[0] + ": " + ru[1] + "), but the pack doesn't say it is partial")
        if lv and not lv.get("complete") and man["status"] != "partial":
            sys.exit("living: " + r["key"] + " is missing some of its work, but the pack doesn't say it is partial")
        # A date-range pack holds runs started on its days, by the clock in its time zone (MC); one whose start can't be
        # read is included undated, and the pack says partial.
        sc = man["scope"]
        if "process" in sc and not ru:
            sd = started_day(packed("runs/" + r["key"] + "/run.json").get("created"), zone(sc["tz"]))
            if sd is None and man["status"] != "partial":
                sys.exit("scope: when " + r["key"] + " started can't be read, but the pack doesn't say it is partial")
            if sd is not None and not (sc["from"] <= sd <= sc["through"]):
                sys.exit("scope: " + r["key"] + " started on " + sd + " (" + sc["tz"] + "), outside the pack's days " + sc["from"] + " through " + sc["through"])
        if not lv:
            if has_work(r["key"]):
                sys.exit("living: " + r["key"] + " has work its packed originals name (a work head, a receipt or a to-do record), but the manifest has no living section for it")
            continue
        n += 1
        # Every dependency named confirmed is established from the packed references, whatever the pack says of itself and
        # before anything else may stop reading (QD): found from the root, in that role, and checked in full. A root no reader
        # reads can't establish one.
        conf = [d for d in lv.get("deps") or [] if d.get("confirmed") is True]
        if conf:
            if ru:
                sys.exit("living: " + r["key"] + " says " + conf[0]["key"] + ", a run its work depends on, is confirmed, but its own run.json isn't one every reader reads (" + ru[0] + "), so that can't be established")
            found = reach(r["key"], packed("runs/" + r["key"] + "/run.json"))
            for d in conf:
                if d["key"] not in found:
                    sys.exit("living: " + r["key"] + " says " + d["key"] + " is a confirmed run its work depends on, but nothing in the pack makes it one")
                if d["role"] not in found[d["key"]]:
                    sys.exit("living: " + r["key"] + " names " + d["key"] + " as a confirmed run its work depends on in the role " + d["role"] + ", but what refers to it gives it another (" + ", ".join(sorted(found[d["key"]])) + ")")
                # Its whole closure, the same check a complete pack's work gets (RA, SA): every run its work requires, walked
                # from it and checked whatever the manifest says of each, then each fact, every original by its family's
                # reader and each evidence plan the walk gathered.
                reached.clear()
                plans_wanted.clear()
                facts_wanted.clear()
                fact_refs.clear()
                run_refs.clear()
                work_problems.clear()
                named = {x["key"]: x for x in lv.get("deps") or []}
                why = walk_runs(r["key"], d["key"], named, {"chain": lv.get("chain"), "head": lv.get("head", "")})[0] or closure_tail()
                if why:
                    sys.exit("living: " + r["key"] + " says " + d["key"] + ", a run its work depends on, is confirmed, but " + why)
            reached.clear()
            plans_wanted.clear()
            facts_wanted.clear()
            fact_refs.clear()
            run_refs.clear()
            work_problems.clear()
        # A root no reader reads (root_unread: missing, not JSON, no run, or refused by the readers' verdict) is in a partial
        # pack only, and nothing more is read of it: its fields aren't a run's.
        if ru:
            if lv.get("complete"):
                sys.exit("living: " + r["key"] + " says its work is complete, but its run.json isn't one every reader reads (" + ru[0] + ": " + ru[1] + ")")
            continue
        run = packed("runs/" + r["key"] + "/run.json")
        head = obj(run.get("living")).get("head", "")
        # The receipt metadata agrees with the run (MC): an ended living run has one, under its run.json's id ('' and none
        # when it ended without one); a running run has none; confirmed only when the packed receipt says what it ended with.
        rl, rc = obj(run.get("living")), lv.get("receipt")
        is_ended = isinstance(run.get("living"), dict) and isinstance(run.get("ended"), dict)
        if is_ended != (rc is not None):
            sys.exit("living: " + r["key"] + (" has ended, but the manifest names no receipt for it" if is_ended else " hasn't ended, but the manifest names a receipt for it"))
        if rc is not None:
            rid = rl.get("receipt") if isinstance(rl.get("receipt"), str) else ""
            if rc["id"] != rid or (rc["state"] == "none") != (rid == ""):
                sys.exit("living: " + r["key"] + "'s receipt in the manifest isn't the one its run.json names")
            if man["status"] == "complete" and rc["state"] not in ("confirmed", "none"):
                sys.exit("living: " + r["key"] + "'s receipt is " + rc["state"] + ", but the pack says it's complete")
        reached.clear()
        plans_wanted.clear()
        facts_wanted.clear()
        fact_refs.clear()
        run_refs.clear()
        work_problems.clear()
        if lv.get("head") != head:
            sys.exit("living: " + r["key"] + " names another work head than its run.json")
        own_receipt = obj(run.get("living")).get("receipt", "")
        if own_receipt and obj(lv.get("receipt")).get("id") != own_receipt:
            sys.exit("living: " + r["key"] + " names another receipt than its run.json")
        whole, chain, closed, good_receipt, copies = check_run(run)
        # Each run the work depends on (ND): the receipt it names is the packed run's own ('' when it names none), one named
        # confirmed is in the pack, and a complete pack confirms every one.
        for d in lv.get("deps") or []:
            dr = packed("runs/" + d["key"] + "/run.json")
            if isinstance(dr, dict):
                drl = obj(dr.get("living")).get("receipt")
                if d["receipt"] != (drl if isinstance(drl, str) else ""):
                    sys.exit("living: " + r["key"] + " names another receipt for " + d["key"] + ", a run its work depends on, than its run.json")
            elif d["confirmed"]:
                sys.exit("living: " + r["key"] + " says " + d["key"] + ", a run its work depends on, is confirmed, but its run.json isn't in the pack as a run")
            if man["status"] == "complete" and not d["confirmed"]:
                sys.exit("living: " + r["key"] + " says " + d["key"] + ", a run its work depends on, isn't confirmed, but the pack says it's complete")
        if rc is not None and rc["state"] == "confirmed" and not own_ok[0]:
            sys.exit("living: " + r["key"] + "'s receipt is said to be confirmed, but the receipt in the pack doesn't say what it ended with" + (": " + claims_why[0] if claims_why[0] else ""))
        if not lv.get("complete"):
            if man["status"] != "partial":
                sys.exit("living: " + r["key"] + " is missing some of its work, but the pack doesn't say it is partial")
            continue
        if copies:
            sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + copies + ".json, a record it rests on")
        if not whole or chain != lv["chain"]:
            sys.exit("living: " + r["key"] + " says its work is complete, but its application chain isn't all in the pack")
        if not closed:
            sys.exit("living: " + r["key"] + " says its work is complete, but an application's request, its authority or a record it saw isn't in the pack")
        if not good_receipt:
            sys.exit("living: " + r["key"] + " says its work is complete, but its receipt isn't in the pack, doesn't say what it ended with, or a record it saw isn't in the pack" + (": " + claims_why[0] if claims_why[0] else ""))
        if plans_bad:
            sys.exit("living: " + r["key"] + " says its work is complete, but " + plans_bad[0] + ", an evidence plan it rests on, isn't a plan the app reads")
        # Every run its work depends on, the manifest's and the ones found here, walked the same way, bounded.
        named = {d["key"]: d for d in lv.get("deps") or []}
        why, done, roles = walk_runs(r["key"], r["key"], named)
        if why == BOUND:
            sys.exit("living: " + r["key"] + " rests on more records and runs than a pack holds at most (5000)")
        if why:
            sys.exit("living: " + r["key"] + " says its work is complete, but " + why)
        # The runs named are exactly the runs found, the root never among them, each in a role its references give it (OD).
        for k in sorted(named):
            if k not in done or k == r["key"]:
                sys.exit("living: " + r["key"] + " says its work is complete, but it names " + k + " as a run its work depends on, and nothing in the pack makes it one")
            if named[k]["role"] not in roles.get(k, set()):
                sys.exit("living: " + r["key"] + " names " + k + " as a run its work depends on in the role " + named[k]["role"] + ", but what refers to it gives it another (" + ", ".join(sorted(roles.get(k, set()))) + ")")
        why = closure_tail()
        if why:
            sys.exit("living: " + r["key"] + " says its work is complete, but " + why)
        for k in named:
            if k not in done:
                sys.exit("living: " + r["key"] + " names " + k + " as a run it depends on, but nothing in the pack depends on it")
    return n


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--verdicts":
        RV.batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--readers":
        RV.readers_batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--canonical":
        RV.canonical_batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--decode":
        with open(sys.argv[2]) as f:
            print(json.dumps([RV.utf8_text(bytes.fromhex(x)) for x in json.load(f)]))
    elif len(sys.argv) == 3 and sys.argv[1] == "--coverage":
        RV.coverage(sys.argv[2])
    else:
        main(sys.argv[1])
