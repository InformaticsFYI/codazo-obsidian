/** UUID v4 with Web Crypto randomness, including trusted-LAN HTTP browsers.
 * randomUUID is secure-context-only; getRandomValues is available on HTTP.
 * Never fall back to Math.random for request identities.
 */
export function createRequestId(cryptoSource: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
