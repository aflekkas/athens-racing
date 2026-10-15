# Hosting-level analytics disclosure

Live Chrome inspection found a Cloudflare-injected Web Analytics beacon even though it is absent from the game source. The legal pages' CSP blocks it. Browser checks must distinguish that blocked hosting script from a game boot script: no game module, canvas or game flow is present. Direct HTTP responses used in route checks contain no scripts. The policy now discloses the cookieless beacon and links Cloudflare's official data-collection/privacy documentation. User-facing Google scopes remain `openid profile`; no email access was added.

All six required gates passed on a clean archive of the tested commit recorded in validation.json. Privacy screenshots at 1280 and 390 were refreshed and visually inspected. The scheduled release train owns publication; its selected commit may also include independently committed work by other agents.
