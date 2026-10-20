"""Mac Bash 3 fallback for tools/browser-slot.sh; use its same advisory slot locks.

The repository script needs Bash 4 dynamic FDs and a native flock command.
Hold the lock in this process until the single headless child job exits.
"""
import fcntl, json, os, subprocess, sys, time
from pathlib import Path

root = Path(__file__).resolve().parent
record = {'wrapper': os.getpid(), 'command': sys.argv[1:]}
deadline = time.monotonic() + 300
while time.monotonic() < deadline:
    for slot in range(1, 5):
        with open(f'/tmp/paraliaki-browser-slot-{slot}.lock', 'a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                continue
            record['slot'] = slot
            child = subprocess.Popen(sys.argv[1:])
            record['child'] = child.pid
            name = root / ('browser-slot-' + os.environ.get('TAG', 'run') + '.json')
            name.write_text(json.dumps(record, indent=2))
            code = child.wait()
            record.update(closed=True, code=code)
            name.write_text(json.dumps(record, indent=2))
            sys.exit(code)
    time.sleep(2)
raise SystemExit('No shared browser slot available after 300 seconds')
