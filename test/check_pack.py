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
    """A packed original read as the app reads it (its checked parse): UTF-8, a byte-order mark read past, nothing nested
    more than PF.util.JSON_DEPTH (64) levels deep, no NaN or Infinity, and every number a double. ValueError otherwise."""
    text = raw.decode("utf-8")
    if text.startswith("\ufeff"):
        text = text[1:]
    if CF.json_too_deep(text):
        raise ValueError(CF.DEEP_WHY)
    try:
        return json.loads(text, parse_int=float, parse_constant=CF._no_constant)
    except RecursionError:
        raise ValueError(CF.DEEP_WHY)


COPY = re.compile(r"^( \([0-9]{1,3}\)|-[A-Za-z0-9-]{1,63})$")
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
            if not path.startswith("proposals/") or not path.endswith(".json"):
                continue
            o = packed(path)
            if o is None:
                # One the app can't read names no run it can tell: it may be this run's (PF.receipts.deps), so it is reached and
                # judged below.
                reached.add(path)
                continue
            if not isinstance(o, dict):
                continue
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
                    if isinstance(fact, str) and "proposals/" + fact + ".json" in by_path:
                        reached.add("proposals/" + fact + ".json")
        return scopes

    reached, plans_wanted, facts_wanted = set(), set(), set()

    def packed_ids(rid):
        """The packed files of one record id: its own name and its synced copies (" (1)" and the like)."""
        base = "proposals/" + rid
        return [p for p in by_path if p == base + ".json" or (p.startswith(base) and p.endswith(".json") and COPY.match(p[len(base):-5])
                and (not p[len(base):-5].startswith("-") or any(c.isupper() for c in p[len(base):-5])))]

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
        if any(json.dumps(r, sort_keys=True) != json.dumps(recs[0], sort_keys=True) for r in recs):
            return None, True
        return recs[0], False

    def check_run(run):
        """One run's closure, replayed on its own: its chain from living.head (every link a unique witness), each application's
        request, its authority and every record it saw, and its receipt. Returns (whole, chain, closed, receipt ok, copies)."""
        own = run.get("living") or {}
        head = own.get("head", "")
        me = {"process": run.get("process"), "id": run.get("id")}
        copies = [False]
        scopes = on_run(me)

        def wit(rid):
            rec, amb = witness(rid)
            if amb:
                copies[0] = True
            return rec

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
                # The witness resolved above, under the name it is packed as (its own, or a synced copy's).
                path = packed_ids(receipt)
                raw = decode(z.read(by_path[path[0]])) if path else None
                good_receipt = raw is not None and CF.todo_why(raw, path[0][len("proposals/"):]) == ""
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
                o = packed(path)
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
        # A loop item's choice names a child run by id: the packed run of that id, or one that isn't here.
        for path in by_path:
            if not path.startswith("proposals/req-") or ".status-" in path:
                continue
            o = packed(path)
            lp = (o or {}).get("loop") if isinstance(o, dict) else None
            if not isinstance(lp, dict) or lp.get("process") != me["process"] or lp.get("run") != me["id"]:
                continue
            for ch in o.get("changes") or []:
                if isinstance(ch, dict) and ch.get("op") == "choose" and isinstance(ch.get("run"), str) and ch["run"]:
                    hit = [p.split("/")[1] + "/" + p.split("/")[2] for p in by_path if p.startswith("runs/") and p.endswith("/" + ch["run"] + "/run.json") and p.count("/") == 3]
                    out.update(hit or ["?/" + ch["run"]])
        return out

    # Each evidence plan packed reads as a plan, by the shipped checker's rules (PF.plans.planWhy), under its own name.
    plans_bad = []
    for f in man["files"]:
        if f.get("role") == "evidence plan":
            try:
                o = load(f["path"])
            except ValueError:
                o = None
            name = f["path"][len("proposals/"):-len(".json")] if f["path"].startswith("proposals/") and f["path"].endswith(".json") else ""
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
        me = {"process": run.get("process"), "id": run.get("id")}
        for path in by_path:
            if path.startswith("proposals/") and path.endswith(".json"):
                o = packed(path)
                todo = isinstance(o, dict) and (o.get("format") in ("flightdeck-plan/4", "flightdeck-plan-status/4")
                                                or (isinstance(o.get("features"), list) and "living-runs" in o["features"]))
                if todo and o.get("run") == me:
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
            sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of a record it rests on")
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
                w2, c2, cl2, rc2, cp2 = check_run(dep_run)
                d = named[k]
                if cp2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of a record " + k + " rests on")
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
            o = packed("proposals/" + pid + ".json")
            if not isinstance(o, dict) or o.get("id") != pid or CF.plan_why(o):
                sys.exit("living: " + r["key"] + " says its work is complete, but proposals/" + pid + ".json, an evidence plan the work names, isn't in the pack as a plan the app reads")
        for k in named:
            if k not in done:
                sys.exit("living: " + r["key"] + " names " + k + " as a run it depends on, but nothing in the pack depends on it")
    return n


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--verdicts":
        RV.batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--canonical":
        RV.canonical_batch(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "--coverage":
        RV.coverage(sys.argv[2])
    else:
        main(sys.argv[1])
