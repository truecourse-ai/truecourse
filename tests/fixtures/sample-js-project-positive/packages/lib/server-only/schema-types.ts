
declare const z: {
  object: <T extends Record<string, unknown>>(shape: T) => { parse: (data: unknown) => unknown };
  string: () => { optional: () => unknown; nullish: () => unknown; min: (n: number) => unknown };
  boolean: () => { optional: () => unknown };
  number: () => { optional: () => unknown };
};

const ZUserProfileSchema = z.object({
  displayName: z.string().optional(),
  bio: z.string().nullish(),
  website: z.string().nullish(),
  publicEmail: z.string().nullish(),
  prefersDarkMode: z.boolean().optional(),
});
