"""Runs a Python checker with every write it could make watched (QE): an audit hook records each open for writing, each
directory or temporary file made, and each file removed, renamed or changed, and reports them on stderr at exit as
"WROTE: <event> <args>". Usage: no_writes.py <script> [args...]. The checker runs exactly as it would on its own."""
import atexit
import os
import runpy
import sys

WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND
EVENTS = {"os.mkdir", "os.makedirs", "os.remove", "os.unlink", "os.rmdir", "os.rename", "os.replace", "os.symlink", "os.link",
          "os.chmod", "os.chown", "os.truncate", "os.utime", "shutil.rmtree", "shutil.copyfile", "shutil.move",
          "tempfile.mkstemp", "tempfile.mkdtemp"}
seen = []


def hook(event, args):
    if event == "open":
        mode, flags = args[1], args[2]
        if (isinstance(mode, str) and any(c in mode for c in "wax+")) or (isinstance(flags, int) and flags & WRITE_FLAGS):
            seen.append(event + " " + repr(args[0]) + " " + repr(mode))
    elif event in EVENTS:
        seen.append(event + " " + repr(args[:1]))


def report():
    for s in seen:
        os.write(2, ("WROTE: " + s + "\n").encode("utf-8", "replace"))


atexit.register(report)
sys.argv = sys.argv[1:]
sys.addaudithook(hook)
runpy.run_path(sys.argv[0], run_name="__main__")
