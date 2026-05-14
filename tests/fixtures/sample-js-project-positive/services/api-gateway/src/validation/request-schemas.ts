// Zod schema validation — numeric literals in .max()/.min()/.length() are DB
// VARCHAR constraints and standard API limits, not magic numbers.

declare const z: {
  object: (shape: Record<string, unknown>) => any;
  string: () => any;
  number: () => any;
  boolean: () => any;
  array: (schema: any) => any;
  enum: (values: [string, ...string[]]) => any;
};

export const ZCreateUserRequestSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  displayName: z.string().max(255).optional(),
  bio: z.string().max(1000).optional(),
  email: z.string().max(254),
  phoneNumber: z.string().max(20).optional(),
  inviteCode: z.string().length(8).optional(),
});

export const ZUpdateProfileRequestSchema = z.object({
  fullName: z.string().min(1).max(255).optional(),
  website: z.string().max(2048).optional(),
  location: z.string().max(100).optional(),
  tagline: z.string().max(160).optional(),
});

export const ZCreateOrganizationSchema = z.object({
  name: z.string().min(2).max(128),
  slug: z.string().min(2).max(64),
  description: z.string().max(512).optional(),
  contactEmail: z.string().max(254).optional(),
});
