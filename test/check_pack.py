"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. For a living run (4.0) it replays the
application chain from the packed run.json's living.head through each application's previous, and checks the receipt the run
names says the run's work head and outcome: a pack that calls a run's work complete must hold all of it, and a pack missing
any of it must say it is partial. Run with python3 -I."""
import hashlib, json, re, sys, zipfile


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


COPY = re.compile(r"^( \([0-9]{1,3}\)|-[A-Za-z0-9-]{1,63})$")


ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$")


def times_why(run):
    """The times a run file holds that the app can't read (as R.sanitize drops them, and run says malformed), or ''."""
    iso = lambda v: isinstance(v, str) and ISO.match(v)
    bad = []
    if not iso(run.get("created")):
        bad.append("created")
    if "savedAt" in run and run.get("savedAt") is not None and not iso(run.get("savedAt")):
        bad.append("savedAt")
    if isinstance(run.get("ended"), dict) and not iso(run["ended"].get("at")):
        bad.append("ended")
    for i, line in enumerate(run.get("log") or []):
        if not isinstance(line, dict) or not iso(line.get("at")):
            bad.append("log " + str(i + 1))
            break
    for i, p in enumerate(run.get("pauses") or []):
        if not isinstance(p, dict) or not iso(p.get("from")) or not iso(p.get("to")):
            bad.append("pause " + str(i + 1))
            break
    return ", ".join(bad)


def check_living(z, man):
    by_path = {f["path"]: f["pack"] for f in man["files"]}

    def load(path):
        return json.loads(z.read(by_path[path]).decode("utf-8"))

    def packed(path):
        if path not in by_path:
            return None
        return load(path)

    def witness(rid):
        """The one record packed under an id, the same in every packed copy (a synced " (1)" copy included); None when it
        isn't packed or two packed copies differ (ambiguous: which is meant isn't known)."""
        base = "proposals/" + rid
        paths = [p for p in by_path if p == base + ".json" or (p.startswith(base) and p.endswith(".json") and COPY.match(p[len(base):-5])
                 and (not p[len(base):-5].startswith("-") or any(c.isupper() for c in p[len(base):-5])))]
        if not paths:
            return None, False
        recs = [load(p) for p in paths]
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
        i = 0
        while closed and i < len(want):
            rec = wit(want[i])
            i += 1
            if rec is None:
                closed = False
                break
            saw(rec)
        receipt = own.get("receipt")
        good_receipt = True
        if receipt:
            rec = wit(receipt)
            ended = run.get("ended") or {}
            good_receipt = (rec is not None and rec.get("kind") == "receipt" and rec.get("id") == receipt and rec.get("head") == head
                            and rec.get("outcome") == ended.get("outcome") and rec.get("run") == me)
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
        return out

    n = 0
    for r in man["runs"]:
        lv = r.get("living")
        if not lv:
            continue
        n += 1
        run = packed("runs/" + r["key"] + "/run.json")
        if run is None:
            if lv.get("complete"):
                sys.exit("living: " + r["key"] + " says its work is complete, but its run.json isn't in the pack")
            continue
        head = (run.get("living") or {}).get("head", "")
        if lv["head"] != head:
            sys.exit("living: " + r["key"] + " names another work head than its run.json")
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
            sys.exit("living: " + r["key"] + " says its work is complete, but its receipt isn't in the pack or doesn't say what it ended with")
        # Every run its work depends on, the manifest's and the ones found here, walked the same way, bounded.
        named = {d["key"]: d for d in lv.get("deps") or []}
        todo, done = [r["key"]], set()
        while todo:
            k = todo.pop(0)
            if k in done:
                continue
            done.add(k)
            if len(done) > 5000:
                sys.exit("living: " + r["key"] + " depends on more runs than a pack holds")
            if k == r["key"]:
                dep_run = run
            else:
                dep_run = packed("runs/" + k + "/run.json")
                if dep_run is None:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + k + ", a run it depends on, isn't in the pack")
                if k not in named:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the manifest doesn't name " + k + ", a run it depends on")
                tw = times_why(dep_run)
                if tw:
                    sys.exit("living: " + r["key"] + " says its work is complete, but " + k + ", a run it depends on, has times the app can't read (" + tw + ")")
                w2, c2, cl2, rc2, cp2 = check_run(dep_run)
                d = named[k]
                if cp2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the pack holds two different copies of a record " + k + " rests on")
                if not w2 or c2 != d.get("chain") or (dep_run.get("living") or {}).get("head", "") != d.get("head", ""):
                    sys.exit("living: " + r["key"] + " says its work is complete, but the application chain of " + k + " isn't all in the pack")
                if not cl2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but a request, an authority or a record " + k + " saw isn't in the pack")
                if not rc2:
                    sys.exit("living: " + r["key"] + " says its work is complete, but the receipt of " + k + " isn't in the pack or doesn't say what it ended with")
            todo.extend(sorted(depends_on(dep_run) - done))
        for k in named:
            if k not in done:
                sys.exit("living: " + r["key"] + " names " + k + " as a run it depends on, but nothing in the pack depends on it")
    return n


if __name__ == "__main__":
    main(sys.argv[1])
