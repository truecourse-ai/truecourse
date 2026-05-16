declare const crypto: { randomBytes: (n: number) => Buffer };

function generateBackupCodes(): string[] {
  return Array.from({ length: 10 })
    .fill(null)
    .map(() => crypto.randomBytes(5).toString('hex'))
    .map((code) => `${code.slice(0, 5)}-${code.slice(5)}`.toUpperCase());
}


declare const z: { object: (s: Record<string, any>) => any; string: () => { min: (n: number) => { max: (n: number) => any } } };

const ZVerifyTotpCodeSchema = z.object({
  code: z.string().min(6).max(6),
});
