declare const z: { object: (s: Record<string, any>) => any; string: () => { min: (n: number, opts: { message: string }) => any }; number: () => any; null: () => any };

const ZCreateApiTokenSchema = z.object({
  teamId: z.number(),
  tokenName: z.string().min(3, { message: 'Token name must be at least 3 characters' }),
  expiresAt: z.string().nullable(),
});
