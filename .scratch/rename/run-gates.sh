#!/usr/bin/env bash
set +e
cd "$(dirname "$0")/../.."
mkdir -p .scratch/rename/gates
run_gate() { "$@" > ".scratch/rename/gates/$gate.log" 2>&1; echo $? > ".scratch/rename/gates/$gate.exit"; }
gate=npm-test; run_gate npm test
gate=physics; run_gate node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
gate=events; run_gate node tools/events-test.mjs
gate=syntax; run_gate node tools/check-syntax.mjs
gate=imports; run_gate node tools/check-browser-imports.mjs
gate=wrangler; run_gate npx wrangler deploy --env staging --dry-run
echo done > .scratch/rename/gates/done
