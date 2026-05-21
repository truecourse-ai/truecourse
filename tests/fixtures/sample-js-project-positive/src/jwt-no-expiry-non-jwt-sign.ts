/**
 * `.sign(...)` and bare `sign(...)` calls on non-JWT receivers — internal
 * HMAC signing helpers, PDF document signing, jose's SignJWT fluent chain
 * with setExpirationTime — should not be flagged as jwt-no-expiry.
 */

declare function sign(data: Uint8Array): Uint8Array;

export function signPayload(data: Uint8Array): Uint8Array {
  return sign(data);
}

type PdfSigner = {
  sign(args: { signer: unknown; reason: string }): Promise<{ bytes: Uint8Array }>;
};

declare const pdf: PdfSigner;
declare const signerInstance: unknown;

export async function signPdf(): Promise<Uint8Array> {
  const { bytes } = await pdf.sign({
    signer: signerInstance,
    reason: 'Signed by service',
  });
  return bytes;
}

type SignJwtChain = {
  setProtectedHeader(header: { alg: string }): SignJwtChain;
  setIssuedAt(): SignJwtChain;
  setExpirationTime(at: Date): SignJwtChain;
  sign(secret: Uint8Array): Promise<string>;
};

declare const SignJWT: new (claims: Record<string, unknown>) => SignJwtChain;
declare const tokenSecret: Uint8Array;

export function issuePresignToken(
  audience: string,
  subject: string,
  expiresAt: Date,
): Promise<string> {
  return new SignJWT({ aud: audience, sub: subject })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(tokenSecret);
}
