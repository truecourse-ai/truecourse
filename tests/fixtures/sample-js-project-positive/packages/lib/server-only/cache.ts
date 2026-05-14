
declare function sha256(input: string): string | Buffer;
declare const cacheNamespace: string;

function buildCacheKey(inputKey: string): string {
  return Buffer.from(sha256(`${cacheNamespace}:${inputKey}`)).toString('hex');
}
