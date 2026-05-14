
// Zod enum schema definition — the string literals define the valid values for this type contract.
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => { optional: () => unknown; default: (v: string) => unknown };
  enum: <T extends [string, ...string[]]>(values: T) => { optional: () => { default: (v: string) => unknown } };
};

export const ZAssetDownloadQuerySchema = z.object({
  version: z
    .enum(['original', 'processed', 'draft'])
    .optional()
    .default('processed'),
});
