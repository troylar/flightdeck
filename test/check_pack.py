"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. For a living run (4.0) it replays the
application chain from the packed run.json's living.head through each application's previous, and checks the receipt the run
names says the run's work head and outcome: a pack that calls a run's work complete must hold all of it, and a pack missing
any of it must say it is partial. Run with python3 -I."""
import datetime, hashlib, json, os, re, sys, zipfile, zoneinfo

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
        man = json.loads(z.read("manifest.json").decode("utf-8"))
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
        print("ok %d entries, living %d" % (len(names), living))


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


def decode(raw):
    """A packed original read as the app reads it (its checked parse): its text as TextDecoder gives it (RV.utf8_text), nothing
    nested more than PF.util.JSON_DEPTH (64) levels deep, no NaN or Infinity, and every number a double. ValueError otherwise."""
    text = RV.utf8_text(raw)
    if CF.json_too_deep(text):
        raise ValueError(CF.DEEP_WHY)
    try:
        return json.loads(text, parse_int=float, parse_constant=CF._no_constant)
    except RecursionError:
        raise ValueError(CF.DEEP_WHY)


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
    return json.dumps({k: v for k, v in o.items() if k not in ENVELOPE and not k.startswith("_")}, sort_keys=True)
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
        if any(copy_body(r) != copy_body(recs[0]) for r in recs):
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
                # Every keep it names is a keep on this run, one witness under its id.
                for x in arr(rec.get("keeps")):
                    kx = wit(str(x))
                    if kx is None or kx.get("kind") != "keep" or kx.get("run") != me:
                        good_receipt = False
            if good_receipt and closed:
                saw(rec)
                good_receipt = walk()
        return whole, chain, closed, good_receipt, copies[0]

    # Whether the last run check_run read has a receipt record of its own that says what it ended with, read whole (what
    # PF.receipts.stateOf calls confirmed), apart from what the receipt saw.
    own_ok = [False]

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
                o = packed(path) if dispatch(path)["fam"] == "todo" and not dispatch(path)["bad"] else None
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
                    todos.append((path, packed(path)))
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
                why = dep_check(d["key"], d)
                if why:
                    sys.exit("living: " + r["key"] + " says " + d["key"] + ", a run its work depends on, is confirmed, but " + why)
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
            sys.exit("living: " + r["key"] + "'s receipt is said to be confirmed, but the receipt in the pack doesn't say what it ended with")
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
            sys.exit("living: " + r["key"] + " says its work is complete, but its receipt isn't in the pack, doesn't say what it ended with, or a record it saw isn't in the pack")
        if plans_bad:
            sys.exit("living: " + r["key"] + " says its work is complete, but " + plans_bad[0] + ", an evidence plan it rests on, isn't a plan the app reads")
        # Every run its work depends on, the manifest's and the ones found here, walked the same way, bounded.
        named = {d["key"]: d for d in lv.get("deps") or []}
        todo, done, roles = [r["key"]], set(), {}
        while todo:
            k = todo.pop(0)
            if k in done:
                continue
            done.add(k)
            # The one shared bound: every original reached and every dependency run, together (PF.receipts.deps).
            if len(reached) + len(done) - 1 > 5000:
                sys.exit("living: " + r["key"] + " rests on more records and runs than a pack holds at most (5000)")
            if k == r["key"]:
                dep_run = run
            else:
                dep_run = packed("runs/" + k + "/run.json")
                if dep_run is None:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + k + ", a run it depends on, isn't in the pack")
                if k not in named:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the manifest doesn't name " + k + ", a run it depends on")
                why = dep_check(k, named[k])
                if why:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + why)
            found = depends_on(dep_run)
            for fk, fr in found.items():
                roles.setdefault(fk, set()).update(fr)
            todo.extend(sorted(set(found) - done))
        # The runs named are exactly the runs found, the root never among them, each in a role its references give it (OD).
        for k in sorted(named):
            if k not in done or k == r["key"]:
                sys.exit("living: " + r["key"] + " says its work is complete, but it names " + k + " as a run its work depends on, and nothing in the pack makes it one")
            if named[k]["role"] not in roles.get(k, set()):
                sys.exit("living: " + r["key"] + " names " + k + " as a run its work depends on in the role " + named[k]["role"] + ", but what refers to it gives it another (" + ", ".join(sorted(roles.get(k, set()))) + ")")
        if len(reached) + len(done) - 1 > 5000:
            sys.exit("living: " + r["key"] + " rests on more records and runs than a pack holds at most (5000)")
        # Each fact a to-do record rests on (support.fact), by that reference: one witness under its id (every packed copy the
        # same), a fact carrying that id.
        fstate: dict = {}
        for fid in sorted(facts_wanted):
            if not packed_ids(fid):
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + fid + ".json, a fact the work rests on, isn't in the pack")
            rec, amb = witness(fid)
            if amb:
                sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + fid + ".json, a fact the work rests on")
            if not isinstance(rec, dict) or rec.get("kind") != "fact" or rec.get("id") != fid:
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + fid + ".json, a fact the work rests on, isn't that fact")
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
                    sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + sid + ".json, a record the fact " + str(tid) + " saw, isn't in the pack")
                srec, samb = witness(sid)
                if samb:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + sid + ".json, a record the fact " + str(tid) + " saw")
                reached.update(packed_ids(sid))
                if len(reached) > 5000:
                    sys.exit("living: " + r["key"] + " rests on more records and runs than a pack holds at most (5000)")
                if not isinstance(srec, dict) or srec.get("kind") != "fact" or srec.get("id") != sid or not isinstance(srec.get("run"), dict) or srec.get("run") != top[0].get("run"):
                    sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + sid + ".json, a record the fact " + str(tid) + " saw, isn't a fact of the same run")
                if fstate.get(sid) == 1:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the facts it rests on go round in a circle: fact " + str(tid) + " saw proposals/" + sid + ".json, which saw it in turn")
                if fstate.get(sid):
                    continue
                fstate[sid] = 1
                stack.append([srec, 0])
        # Every original reached is one the app reads, by its own family's reader.
        for path in sorted(reached):
            why = family_why(path)
            if why:
                sys.exit("living: " + r["key"] + " says its work is complete, but " + path + ", a record its work rests on, isn't one the app reads: " + why)
        for pid in sorted(plans_wanted):
            # The plan by its id, under its own name or a synced copy's: every copy packed a plan the app reads, and all of them
            # saying the same thing (PF.requests.same, the shipped checker's same_plan).
            ps = [packed(p) for p in sorted(packed_ids(pid))]
            if not ps or any(not isinstance(o, dict) or o.get("id") != pid or CF.plan_why(o) for o in ps):
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + pid + ".json, an evidence plan the work names, isn't in the pack as a plan the app reads")
            if any(not CF.same_plan(o, ps[0]) for o in ps):
                sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + pid + ".json, an evidence plan the work names")
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
