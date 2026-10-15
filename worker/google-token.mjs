const decode = (value) =>
  Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
let cached;
// Only public signing keys are cached. Tokens and provider credentials never enter this cache.
export async function verifyGoogleToken(
  token,
  { audience, nonce, fetcher = fetch, now = Date.now() },
) {
  const reject = () => {
    throw Object.assign(new Error("Invalid Google identity token"), {
      status: 401,
    });
  };
  let header, claims, parts;
  try {
    parts = token.split(".");
    if (parts.length !== 3) reject();
    header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  } catch {
    reject();
  }
  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    claims.nonce !== nonce ||
    claims.aud !== audience ||
    !["accounts.google.com", "https://accounts.google.com"].includes(
      claims.iss,
    ) ||
    !(claims.exp * 1000 > now) ||
    typeof claims.sub !== "string"
  )
    reject();
  let keys = cached?.expires > now ? cached.keys : null;
  if (!keys?.some((key) => key.kid === header.kid)) {
    const response = await fetcher(
      "https://www.googleapis.com/oauth2/v3/certs",
    );
    if (!response.ok)
      throw Object.assign(
        new Error("Google verification temporarily unavailable"),
        { status: 503 },
      );
    keys = (await response.json()).keys;
    if (!Array.isArray(keys)) reject();
    cached = { keys, expires: now + 600000 };
  }
  const jwk = keys.find(
    (key) => key.kid === header.kid && key.kty === "RSA" && key.alg === "RS256",
  );
  if (!jwk) reject();
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decode(parts[2]),
        new TextEncoder().encode(parts[0] + "." + parts[1]),
      ))
    )
      reject();
  } catch {
    reject();
  }
  return claims;
}
