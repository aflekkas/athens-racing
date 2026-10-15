# Live legal URL handoff

All four privacy/terms URLs return 200 with text/html; both sitemaps list the legal pages. Public www checks return 301 preserving path/query for root, privacy/terms, CSS, an existing image, an arbitrary path and both Google OAuth navigations. API/WebSocket exceptions are documented in ../www/README.md.

Production is e42dd03. Staging is 56b2c91, which includes the final policy wording from 6072314 disclosing Cloudflare's hosting-injected cookieless performance beacon. The legal pages' CSP blocks scripts, including that beacon. The production rollout of this final wording failed during asset baking at the release train's 15-minute deploy limit under shared VPS load. Production still serves the earlier analytics wording. No manual push/deploy was performed, per /tmp/lead-rules.txt.

All six gates passed on the final implementation commit (../analytics/gates/). The combined release passed its gates and staging smoke before the production deployment failure. Screenshots at 1280 and 390 plus the full audit are committed in the parent evidence directory. The latest privacy screenshots reflect the final source/staging wording. Provider details and code limitations are listed in ../README.md. validation.json records the exact live routes and published versions at handoff.
