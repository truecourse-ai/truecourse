
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
