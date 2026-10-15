# Canonical www host follow-up

`worker/canonical-host.mjs` issues a 301 from www.athensracing.com to https://athensracing.com, preserving path and query. Worker fetch applies it before legal pages, account endpoints and assets. `assets.run_worker_first` is true so existing static assets cannot bypass the host redirect. Both legal pages already use the name Athens Racing.

WebSocket `/ws` and non-navigation `/api/*` requests are exempt: redirects would break the backend's same-origin checks, session cookies, or POST method/body handling for already-open www clients. Google OAuth start/callback navigations are explicitly redirected, ensuring the callback is built on the registered canonical origin. This exception does not apply to any HTML or static asset.

`server/canonical-host.test.mjs` checks root, legal documents, arbitrary paths, scripts, images, robots/sitemap and Google OAuth paths; 301 status; HTTPS upgrade; exact path/query preservation; canonical and staging hosts; API/socket exceptions; and Worker ordering plus global asset interception. Existing privacy tests now expect www 301.
