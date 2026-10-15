#!/bin/bash
set +e
node tools/check-syntax.mjs > /tmp/simplify-world-ready/.scratch/simplify-world/colour/final-import-check/syntax.log 2>&1
echo $? > /tmp/simplify-world-ready/.scratch/simplify-world/colour/final-import-check/syntax.exit
node tools/check-browser-imports.mjs > /tmp/simplify-world-ready/.scratch/simplify-world/colour/final-import-check/imports.log 2>&1
echo $? > /tmp/simplify-world-ready/.scratch/simplify-world/colour/final-import-check/imports.exit
