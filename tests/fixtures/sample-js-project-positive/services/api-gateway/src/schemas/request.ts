
// Stubs for Zod-like schema validation
declare const z: {
  object: <T extends Record<string, unknown>>(shape: T) => { parse: (v: unknown) => unknown; optional: () => unknown };
  string: () => ZodString;
  number: () => { optional: () => unknown; int: () => { optional: () => unknown } };
  boolean: () => { optional: () => unknown };
  array: (schema: unknown) => { optional: () => unknown };
};

interface ZodString {
  min: (n: number, msg?: string) => ZodString;
  max: (n: number, msg?: string) => ZodString;
  email: () => ZodString;
  optional: () => unknown;
  default: (v: string) => ZodString;
}

// Request validation schemas — field lengths match database VARCHAR column constraints
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  ownerEmail: z.string().email().max(254),
});

export const InviteMemberSchema = z.object({
  recipientName: z.string().max(255).optional(),
  recipientEmail: z.string().email().max(254),
  role: z.string().max(50),
});
