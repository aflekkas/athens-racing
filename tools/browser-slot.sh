#!/usr/bin/env bash
# Run a browser-driving command (Playwright / headless Chrome) only when one of N shared slots is free.
# The VPS has ~24 GB RAM and a software-rendered Chrome costs 1.5-3.5 GB, so concurrent agents must share.
# Waiters are served FIFO (ticket queue), so a re-launching agent cannot starve one that has been waiting.
#   usage: tools/browser-slot.sh node .scratch/foo/e2e.mjs [args...]
#   env:   BROWSER_SLOTS (default 4), BROWSER_SLOT_WAIT seconds before giving up (default 5400)
#          BROWSER_SLOT_POOL=<name> uses a separate queue and slot locks (BROWSER_SLOTS then sizes that pool), so a caller that must
#          not wait behind other agents - the release train's test gate (tools/release-fast.mjs) - gets its own browser slot.
#   tools/browser-slot.sh --status    show slot holders and the queue
set -u
SLOTS=${BROWSER_SLOTS:-4}; WAIT=${BROWSER_SLOT_WAIT:-5400}; start=$(date +%s)
POOL=${BROWSER_SLOT_POOL:-}; [[ $POOL =~ ^[A-Za-z0-9_-]*$ ]] || { echo "BROWSER_SLOT_POOL must be letters, digits, - or _" >&2; exit 64; }
SUFFIX=${POOL:+-$POOL}
Q=/tmp/paraliaki-browser-queue$SUFFIX; mkdir -p "$Q"
if [[ ${1:-} == --status ]]; then
  for i in $(seq 1 "$SLOTS"); do echo "slot $i: $(fuser /tmp/paraliaki-browser-slot$SUFFIX-$i.lock 2>/dev/null)"; done
  echo "queue:"; ls "$Q" | sort -n; exit 0
fi
ticket=$(flock "$Q/.lock" bash -c 'n=$(cat "'"$Q"'/.next" 2>/dev/null || echo 0); echo $((n+1)) > "'"$Q"'/.next"; echo $n')
me="$Q/$(printf %010d "$ticket").$$"; : > "$me"
trap 'rm -f "$me"' EXIT
first_in_line() { # true when no live waiter holds an older ticket
  for f in "$Q"/*.*; do
    [[ -e $f ]] || continue; [[ $f == "$me" ]] && return 0
    kill -0 "${f##*.}" 2>/dev/null && return 1 || rm -f "$f"   # drop entries of dead waiters
  done; return 0
}
announced=0
while :; do
  if first_in_line; then
    for i in $(seq 1 "$SLOTS"); do
      exec {fd}>"/tmp/paraliaki-browser-slot$SUFFIX-$i.lock"
      if flock -n "$fd"; then
        rm -f "$me"; echo "[browser-slot] slot $i acquired (ticket $ticket, waited $(( $(date +%s) - start ))s)" >&2
        "$@"; rc=$?
        flock -u "$fd"; exit $rc
      fi
      exec {fd}>&-
    done
  elif (( !announced )); then announced=1; echo "[browser-slot] queued with ticket $ticket" >&2
  fi
  if (( $(date +%s) - start > WAIT )); then echo "[browser-slot] no free slot after ${WAIT}s" >&2; exit 75; fi
  sleep 2
done
