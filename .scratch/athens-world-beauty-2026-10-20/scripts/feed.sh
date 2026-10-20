#!/usr/bin/env bash
# usage: feed.sh SRC.png short-name "one-line caption"  -> /home/dev/data/agent-feed/athens-beauty/YYYYMMDD-HHMM-short-name.webp (+ .txt), 1280x800, <150 KB
set -eu
D=/home/dev/data/agent-feed/athens-beauty; mkdir -p "$D"; n="$(date +%Y%m%d-%H%M)-$2"; q=80
while :; do ffmpeg -loglevel error -y -i "$1" -vf scale=1280:800 -quality $q "$D/$n.webp"; [ "$(stat -c%s "$D/$n.webp")" -lt 150000 ] || [ $q -le 40 ] && break; q=$((q-10)); done
printf '%s\n' "$3" > "$D/$n.txt"; echo "$D/$n.webp $(stat -c%s "$D/$n.webp") B"
