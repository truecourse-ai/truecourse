
// FP shape: Buffer.from() with string value and encoding literal — standard Node.js Buffer usage
declare const credentialRecord: { id: string; type: string };

function decodeCredentialId(): Buffer {
  return Buffer.from(credentialRecord.id, 'base64');
}

function encodeCredentialId(rawId: Buffer): string {
  return rawId.toString('base64url');
}



// Pass-through: catch param passed to console.error with string label, then typed AppError thrown
async function verifySessionToken(token: string): Promise<{ userId: string }> {
  try {
    return await decodeJwtToken(token);
  } catch (error) {
    console.error('Error decoding session token:', error);
    throw new AuthError('TOKEN_INVALID', 'Failed to decode session token');
  }
}

declare function decodeJwtToken(token: string): Promise<{ userId: string }>;
class AuthError extends Error {
  constructor(public code: string, msg: string) { super(msg); this.name = "AuthError"; }
}


// Buffer.from(string, encoding) — id is string, encoding is string literal; standard Node.js Buffer API usage.
declare const tokenRecord: { rawId: string; credentialType: string };

function decodeRawTokenId(): Buffer {
  return Buffer.from(tokenRecord.rawId, 'base64url');
}

function encodeRawTokenId(rawBytes: Buffer): string {
  return rawBytes.toString('base64url');
}



// argument-type-mismatch: passes string where Buffer expected — genuine TS2345
function encodeTokenToBase64url(rawBuffer: Buffer): string {
  return rawBuffer.toString('base64url');
}
// TS2345: Argument of type 'string' is not assignable to parameter of type 'Buffer'
const _encoded = encodeTokenToBase64url('raw-credential-id');

