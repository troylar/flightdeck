"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. For a living run (4.0) it replays the
application chain from the packed run.json's living.head through each application's previous, and checks the receipt the run
names says the run's work head and outcome: a pack that calls a run's work complete must hold all of it, and a pack missing
any of it must say it is partial. Run with python3 -I."""
import hashlib, json, sys, zipfile


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


def check_living(z, man):
    by_path = {f["path"]: f["pack"] for f in man["files"]}

    def packed(path):
        if path not in by_path:
            return None
        return json.loads(z.read(by_path[path]).decode("utf-8"))

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
        own = run.get("living") or {}
        head = own.get("head", "")
        if lv["head"] != head:
            sys.exit("living: " + r["key"] + " names another work head than its run.json")
        chain, at, seen, whole = [], head, set(), True
        while at:
            if at in seen:
                whole = False
                break
            seen.add(at)
            rec = packed("proposals/" + at + ".json")
            if rec is None:
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
        receipt = own.get("receipt")
        good_receipt = True
        if receipt:
            rec = packed("proposals/" + receipt + ".json")
            ended = run.get("ended") or {}
            good_receipt = (rec is not None and rec.get("kind") == "receipt" and rec.get("id") == receipt and rec.get("head") == head
                            and rec.get("outcome") == ended.get("outcome") and rec.get("run") == {"process": run.get("process"), "id": run.get("id")})
        if lv.get("complete"):
            if not whole or chain != lv["chain"]:
                sys.exit("living: " + r["key"] + " says its work is complete, but its application chain isn't all in the pack")
            if not good_receipt:
                sys.exit("living: " + r["key"] + " says its work is complete, but its receipt isn't in the pack or doesn't say what it ended with")
        elif man["status"] != "partial":
            sys.exit("living: " + r["key"] + " is missing some of its work, but the pack doesn't say it is partial")
    return n


if __name__ == "__main__":
    main(sys.argv[1])
