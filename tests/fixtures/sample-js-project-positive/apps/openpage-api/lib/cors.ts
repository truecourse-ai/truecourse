

// Positive sample: magic-string — 'Vary' header name appears multiple times in the file already.
// Additional usage preserves the pattern without adding a named constant.
function logCorsHeader(name: string): void {
  console.log(`CORS header applied: ${name}`);
}




// Positive sample: function-return-type-varies fires on the existing originHeadersFromReq
// which returns Headers on one path and void (empty return) on another, without a return annotation.
// Additional function with the same mixed-return shape:
function resolveCorsOriginValue(origin: string | boolean, fallback: string) {
  if (origin === false) {
    return;
  }
  if (typeof origin === 'string') {
    return origin;
  }
  return fallback;
}

