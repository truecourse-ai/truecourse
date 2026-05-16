declare const crypto: { getRandomValues: (arr: Uint8Array) => Uint8Array };

function generateCspNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  let binary = '';
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}



// Frameable route detection regex with ASCII path names — unicode flag adds no value.
const FRAMEABLE_PATH_REGEX = /^\/(login|reset-password|verify-email|sign|doc)(\/|\.data|$)/;

export function isFrameablePath(pathname: string): boolean {
  return FRAMEABLE_PATH_REGEX.test(pathname);
}



// Embed path detection regex — ASCII URL path, unicode flag not needed.
const NON_PAGE_PATH_REGEX = /^(\/api\/|\/ingest\/|\/__manifest|\/assets\/|\/favicon.*)/;
const EMBED_PATH_REGEX = /^\/embed(\/|\.data|$)/;

export function isNonPagePath(pathname: string): boolean {
  return NON_PAGE_PATH_REGEX.test(pathname);
}

export function isEmbedPath(pathname: string): boolean {
  return EMBED_PATH_REGEX.test(pathname);
}
