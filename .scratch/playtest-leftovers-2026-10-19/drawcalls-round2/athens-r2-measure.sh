#!/bin/bash
# usage: athens-r2-measure.sh OUTDIR TAG CLASSES ROUNDS [extra profile args]
W2=$(cat /tmp/athens-leftovers.r2); B=$(cat /tmp/athens-leftovers.final); OUT=$1; TAG=$2; CLASSES=$3; ROUNDS=$4; shift 4
mkdir -p $OUT
run(){ local tree=$1 name=$2 cls=$3 rd=$4; shift 4; ( cd $tree && bash tools/browser-slot.sh node tools/lowend-profile.mjs --root $tree --map riviera --class $cls --throttle 4 --frames 120 "$@" --out $OUT/$name-$cls-r$rd.json >/dev/null 2>&1 ); }
for rd in $(seq ${START:-1} $ROUNDS); do for cls in $CLASSES; do
  run $B before $cls $rd "$@" & run $W2 $TAG $cls $rd "$@" & wait
done; done
