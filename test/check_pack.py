"""An independent reader for a Flightdeck evidence pack: Python's zipfile checks every entry's CRC, then this script checks
manifest.json's SHA-256 for every payload file and SHA256SUMS for payload plus manifest. Run with python3 -I."""
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
        print("ok %d entries" % len(names))


if __name__ == "__main__":
    main(sys.argv[1])
