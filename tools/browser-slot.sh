#!/usr/bin/env bash
# Run a browser-driving command (Playwright / headless Chrome) only when one of N shared slots is free.
# The VPS has ~24 GB RAM and a software-rendered Chrome costs 1.5-3.5 GB, so concurrent agents must share.
#   usage: tools/browser-slot.sh node .scratch/foo/e2e.mjs [args...]
#   env:   BROWSER_SLOTS (default 4), BROWSER_SLOT_WAIT seconds before giving up (default 1800)
set -u
SLOTS=${BROWSER_SLOTS:-4}; WAIT=${BROWSER_SLOT_WAIT:-1800}; start=$(date +%s)
while :; do
  for i in $(seq 1 "$SLOTS"); do
    exec {fd}>"/tmp/paraliaki-browser-slot-$i.lock"
    if flock -n "$fd"; then
      echo "[browser-slot] slot $i acquired" >&2
      "$@"; rc=$?
      flock -u "$fd"; exit $rc
    fi
    exec {fd}>&-
  done
  if (( $(date +%s) - start > WAIT )); then echo "[browser-slot] no free slot after ${WAIT}s" >&2; exit 75; fi
  sleep 5
done
