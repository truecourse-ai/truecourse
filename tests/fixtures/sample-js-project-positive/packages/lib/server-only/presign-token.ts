
// JWT builder chain with expiration — the rule misses .setExpirationTime() chained further down
declare const SignJWT: new (payload: Record<string, unknown>) => {
  setProtectedHeader: (h: any) => any;
  setIssuedAt: (d: Date) => any;
  setExpirationTime: (d: Date) => any;
  sign: (secret: Uint8Array) => Promise<string>;
};
declare const TextEncoder: new () => { encode: (s: string) => Uint8Array };
declare const DateTime: {
  now: () => { plus: (opts: any) => { toJSDate: () => Date } };
};

export async function createPresignToken(apiSecret: string, subject: string, audience: string, expiresInMinutes = 60) {
  const now = DateTime.now();
  const expiresAt = now.plus({ minutes: expiresInMinutes });

  const secret = new TextEncoder().encode(apiSecret);

  const token = await new SignJWT({
    aud: audience,
    sub: subject,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now.plus({ minutes: 0 }).toJSDate())
    .setExpirationTime(expiresAt.toJSDate())
    .sign(secret);

  return token;
}
