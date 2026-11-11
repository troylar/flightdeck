"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. For a living run (4.0) it replays the
application chain from the packed run.json's living.head through each application's previous, and checks the receipt the run
names says the run's work head and outcome: a pack that calls a run's work complete must hold all of it, and a pack missing
any of it must say it is partial. Run with python3 -I."""
import hashlib, json, os, re, sys, zipfile

# The shipped checker's own record reader (Python, independent of the app): a packed receipt is read by its rules.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "example-folder", ".flightdeck", "skills", "_flightdeck"))
import check_folder as CF  # noqa: E402
# Every run the work depends on is judged as every reader of the app judges it (repo.depVerdict), ported in run_verdict.py.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
                for b in (o, o.get("effect") or {}, (o.get("application") or {}).get("effect") or {}):
                    ev = (b or {}).get("evidence") if isinstance(b, dict) else None
                    if o.get("run") == me and isinstance(ev, dict) and isinstance(ev.get("run"), dict):
                        plans_wanted.add(str(ev.get("plan")))
                    fact = ((b or {}).get("support") or {}).get("fact") if isinstance((b or {}).get("support"), dict) else None
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
        own = run.get("living") or {}
        head = own.get("head", "")
        me = {"process": run.get("process"), "id": run.get("id")}
        copies = [""]
        scopes = on_run(me)

        def wit(rid):
            rec, amb = witness(rid)
            if amb and not copies[0]:
                copies[0] = rid
            return rec

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
                prev = (rec.get("application") or {}).get("previous", "")
            elif rec.get("kind") == "application":
                prev = rec.get("previous", "")
            else:
                whole = False
                break
            chain.insert(0, at)
            at = prev
        closed, want, asked = whole, [], set()

        def saw(rec):
            for x in rec.get("seen") or []:
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
            au = rec.get("authority") or {}
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
        if receipt:
            rec = wit(receipt)
            ended = run.get("ended") or {}
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
            # Every record it names as seen (pending requests included) is in the pack, and what each of those saw, in turn.
            if good_receipt:
                for x in rec.get("seen") or []:
                    if wit(str(x)) is None:
                        good_receipt = False
                # Every keep it names is a keep on this run, one witness under its id.
                for x in rec.get("keeps") or []:
                    kx = wit(str(x))
                    if kx is None or kx.get("kind") != "keep" or kx.get("run") != me:
                        good_receipt = False
            if good_receipt and closed:
                saw(rec)
                good_receipt = walk()
        return whole, chain, closed, good_receipt, copies[0]

    def depends_on(run):
        """The runs a run's work depends on, found in the pack on their own: packed runs naming it as their loop's parent, and
        the runs its packed records were done on (evidence) or fulfill a spread of."""
        me = {"process": run.get("process"), "id": run.get("id")}
        out = set()
        for path in by_path:
            parts = path.split("/")
            if len(parts) == 4 and parts[0] == "runs" and parts[3] == "run.json":
                o = packed(path)
                par = (o or {}).get("parent") or {}
                if isinstance(par, dict) and par.get("item") and par.get("process") == me["process"] and par.get("id") == me["id"]:
                    out.add(parts[1] + "/" + parts[2])
            elif path.startswith("proposals/req-") and ".status-" not in path:
                o = packed(path) if dispatch(path)["fam"] == "todo" and not dispatch(path)["bad"] else None
                if not isinstance(o, dict) or o.get("run") != me:
                    continue
                for b in (o, o.get("effect") or {}, (o.get("application") or {}).get("effect") or {}):
                    ev = (b or {}).get("evidence") or {}
                    if isinstance(ev, dict) and isinstance(ev.get("run"), dict):
                        out.add(str(ev["run"].get("process")) + "/" + str(ev["run"].get("id")))
                ff = o.get("fulfills") or {}
                if isinstance(ff, dict) and isinstance(ff.get("run"), dict):
                    out.add(str(ff["run"].get("process")) + "/" + str(ff["run"].get("id")))
                for b in (o, o.get("effect") or {}, (o.get("application") or {}).get("effect") or {}):
                    dv = (b or {}).get("dest")
                    if isinstance(dv, dict) and isinstance(dv.get("process"), str):
                        out.add(dv["process"] + "/" + str(dv.get("id")))
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
            if not path.startswith("proposals/req-") or ".status-" in path:
                continue
            o = packed(path) if dispatch(path)["fam"] == "scope" and not dispatch(path)["bad"] else None
            lp = (o or {}).get("loop") if isinstance(o, dict) else None
            if not isinstance(lp, dict) or lp.get("process") != me["process"] or lp.get("run") != me["id"]:
                continue
            for ch in o.get("changes") or []:
                if isinstance(ch, dict) and ch.get("op") == "choose" and isinstance(ch.get("run"), str) and ch["run"]:
                    cp = proc_of_step(lp.get("step"))
                    out.add((cp or "?") + "/" + ch["run"])
        return out

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

    def has_work(key):
        """Whether a packed run has work to check, from the packed originals alone (never the manifest): its run.json names a
        work head or a receipt, or a packed to-do record (PF.todos.claims) names the run."""
        run = packed("runs/" + key + "/run.json")
        if not isinstance(run, dict):
            return False
        own = run.get("living")
        if isinstance(own, dict) and (own.get("head") or own.get("receipt")):
            return True
        # FA: living work as written that the readers refuse (the feature without its record, an empty or a list record) is
        # work to check, though sanitizing would drop it.
        if CF.living_work(run) and CF.raw_problem(run):
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

    n = 0
    for r in man["runs"]:
        lv = r.get("living")
        if not lv:
            if has_work(r["key"]):
                sys.exit("living: " + r["key"] + " has work its packed originals name (a work head, a receipt or a to-do record), but the manifest has no living section for it")
            continue
        n += 1
        run = packed("runs/" + r["key"] + "/run.json")
        if run is None:
            if lv.get("complete"):
                sys.exit("living: " + r["key"] + " says its work is complete, but its run.json isn't in the pack")
            continue
        # The one raw validation every reader applies (raw_problem: the end and the living record as written), on the root run
        # before its receipt or completeness.
        ep = CF.raw_problem(run)
        if ep and lv.get("complete"):
            sys.exit("living: " + r["key"] + " says its work is complete, but its run.json's end or living record isn't one every reader accepts (" + ep[0] + ": " + ep[1] + ")")
        head = (run.get("living") or {}).get("head", "")
        reached.clear()
        plans_wanted.clear()
        facts_wanted.clear()
        if lv.get("head") != head:
            sys.exit("living: " + r["key"] + " names another work head than its run.json")
        own_receipt = (run.get("living") or {}).get("receipt", "")
        if own_receipt and (lv.get("receipt") or {}).get("id") != own_receipt:
            sys.exit("living: " + r["key"] + " names another receipt than its run.json")
        whole, chain, closed, good_receipt, copies = check_run(run)
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
        todo, done = [r["key"]], set()
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
                # The verdict every reader gives a run (repo.depVerdict): its file as the app reads it, then the version it ran,
                # as packed. (Conflict copies beside a run aren't packed; the export names them and stays partial.)
                bad = RV.dep_verdict(k, z.read(by_path["runs/" + k + "/run.json"]), lambda p: z.read(by_path[p]) if p in by_path else None)
                if bad:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + k + ", a run it depends on, isn't one every reader accepts (" + bad[0] + ": " + bad[1] + ")")
                rp2 = CF.raw_problem(dep_run)
                if rp2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + k + ", a run it depends on, has an end or living record the readers refuse (" + rp2[0] + ": " + rp2[1] + ")")
                w2, c2, cl2, rc2, cp2 = check_run(dep_run)
                d = named[k]
                if cp2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + cp2 + ".json, a record " + k + " rests on")
                if not w2 or c2 != d.get("chain") or (dep_run.get("living") or {}).get("head", "") != d.get("head", ""):
                    sys.exit("living: " + r["key"] + " says its work is complete, but the application chain of " + k + " isn't all in the pack")
                if not cl2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but a request, an authority or a record " + k + " saw isn't in the pack")
                if not rc2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the receipt of " + k + " isn't in the pack, doesn't say what it ended with, or a record it saw isn't in the pack")
            todo.extend(sorted(depends_on(dep_run) - done))
        if len(reached) + len(done) - 1 > 5000:
            sys.exit("living: " + r["key"] + " rests on more records and runs than a pack holds at most (5000)")
        # Each fact a to-do record rests on (support.fact), by that reference: one witness under its id (every packed copy the
        # same), a fact carrying that id.
        for fid in sorted(facts_wanted):
            if not packed_ids(fid):
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + fid + ".json, a fact the work rests on, isn't in the pack")
            rec, amb = witness(fid)
            if amb:
                sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of proposals/" + fid + ".json, a fact the work rests on")
            if not isinstance(rec, dict) or rec.get("kind") != "fact" or rec.get("id") != fid:
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + fid + ".json, a fact the work rests on, isn't that fact")
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
    elif len(sys.argv) == 3 and sys.argv[1] == "--canonical":
        RV.canonical_batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--decode":
        with open(sys.argv[2]) as f:
            print(json.dumps([RV.utf8_text(bytes.fromhex(x)) for x in json.load(f)]))
    elif len(sys.argv) == 3 and sys.argv[1] == "--coverage":
        RV.coverage(sys.argv[2])
    else:
        main(sys.argv[1])
