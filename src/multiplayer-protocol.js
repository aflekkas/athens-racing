// Increment only for incompatible multiplayer wire-format/meaning changes.
// Asset/build changes alone must not disconnect a compatible client.
export const MULTIPLAYER_PROTOCOL = 6;
export const UPDATE_CLOSE_CODE = 4001;
export const protocolVersion = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function connectionProtocol(url) {
  const value = url.searchParams.get('protocol');
  return { protocol: value === null ? 0 : protocolVersion(Number(value)), build: url.searchParams.get('build') || null };
}
export function clientHello(doc) {
  const build = doc?.querySelector?.('meta[name="asr-build"]')?.content;
  return { type: 'hello', protocol: MULTIPLAYER_PROTOCOL, ...(build ? { build } : {}) };
}
