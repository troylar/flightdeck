#!/usr/bin/env python3
"""Check a Flightdeck team folder the way the Flightdeck app does, without changing anything.

    python <skills folder>/_flightdeck/check_folder.py [team-folder]   (default: the current folder)

Prints JSON:
  publications: every version folder per process, with status "complete", "syncing" or "damaged" and why,
                which complete version is current, and any version-number clashes.
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


def read_text(path):
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8-sig")
    except (OSError, UnicodeDecodeError):
        return None


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
    if files["map.md"] is None or files["types.json"] is None:
        return "syncing", "some files haven't arrived", info
    if text_hash(files["map.md"]) != info.get("mapHash") or text_hash(files["types.json"]) != info.get("typesHash"):
        return "damaged", "files don't match their publication record (still syncing, or edited by hand)", info
    m = re.match(r"^v(\d+)-[a-z0-9]+$", name)
    if info.get("folder") != name or not m or int(m.group(1)) != info.get("version"):
        return "damaged", "folder name doesn't match the publication record", info
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
            plans[obj["id"]] = (name, text_hash(js_json(plain)))
        elif obj.get("kind") == "status":
            decisions.setdefault(obj.get("proposal"), []).append(obj)
    for pid, (name, h) in sorted(plans.items()):
        mine = decisions.get(pid, [])
        matching = [d for d in mine if d.get("proposalHash") == h]
        if not mine:
            status, why = "pending", ""
        elif matching and len({d.get("status") for d in matching}) == 1:
            status, why = "decided", matching[0].get("status", "")
        elif not matching:
            status, why = "ambiguous", "the plan changed after it was decided; Flightdeck shows it as pending again"
        else:
            status, why = "ambiguous", "decisions on the same plan disagree; Flightdeck shows it as undecided"
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
