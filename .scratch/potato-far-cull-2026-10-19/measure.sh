#!/bin/bash
# usage: measure.sh BEFORE_TREE AFTER_TREE OUTDIR ROUNDS   (interleaved: before and after run side by side in each group, 4x CPU throttle, 640x360, 120 frames)
# group = round:class:scenario ; low also runs the after tree with ?farcull=340 (report only: Low does not get the cull)
B=$1; A=$2; OUT=$3; ROUNDS=$4; mkdir -p $OUT
group(){ IFS=: read rd cls scen <<<"$1"; local args=""; [ $scen = wo ] && args="--traffic 0 --police off"
  run(){ local tree=$1 name=$2; shift 2; ( cd $tree && bash tools/browser-slot.sh node tools/lowend-profile.mjs --root $tree --map riviera --class $cls --throttle 4 --frames 120 $args "$@" --out $OUT/$name-$cls-$scen-r$rd.json >/dev/null 2>&1 ); }
  run $B before & run $A after & [ $cls = low ] && run $A lowcull --query farcull=340 & wait; }
export -f group; export B A OUT
for rd in $(seq 1 $ROUNDS); do for cls in potato low; do for scen in def wo; do echo $rd:$cls:$scen; done; done; done | xargs -P 2 -I{} bash -c 'group {}'
echo finished > $OUT/.finished
