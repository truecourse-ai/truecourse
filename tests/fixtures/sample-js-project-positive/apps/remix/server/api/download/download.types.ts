
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


// Shape: Zod .enum() schema definition — string literals define the valid type contract values
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => { optional: () => { default: (v: string) => unknown } };
};

export const ZEnvelopeVersionQuerySchema = z.object({
  version: z
    .enum(['original', 'signed', 'pending'])
    .optional()
    .default('signed'),
});



// magic-string shape: same status string literal repeated 3+ times in Zod schema + default + switch
declare const z2: {
  object: (shape: Record<string, unknown>) => unknown;
  enum: <T extends [string, ...string[]]>(values: T) => { optional: () => { default: (v: string) => unknown } };
  string: () => { optional: () => unknown };
};

export const ZFileVersionQuerySchema = z2.object({
  version: z2
    .enum(['signed', 'unsigned', 'pending'])
    .optional()
    .default('signed'),
});

export const ZDocumentVersionQuerySchema = z2.object({
  version: z2
    .enum(['signed', 'original'])
    .optional()
    .default('signed'),
});

