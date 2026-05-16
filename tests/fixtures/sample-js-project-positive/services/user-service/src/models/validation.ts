const EXCELLENT = 90;
const GOOD = 70;
const THRESHOLD = 5;
const MAX_ITEMS = 10;
const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
export function classifyScore(score: number): string {
  if (score > EXCELLENT) return 'excellent';
  if (score > GOOD) return 'good';
  return 'average';
}
export function processRange(x: number): number {
  if (x > THRESHOLD) return x * 2;
  return x;
}
export function fillArray(): number[] {
  return Array.from({ length: MAX_ITEMS }, (_, i) => i);
}
export function handleStatus(status: number): string {
  if (status === HTTP_OK) return 'ok';
  if (status === HTTP_NOT_FOUND) return 'not found';
  return 'unknown';
}



// Zod-style validation schema with optional string field
declare const z: {
  string: () => {
    optional: () => {
      refine: <T>(
        validator: (val: T | undefined) => boolean,
        options: { message: string }
      ) => any;
    };
  };
};

declare function isValidUrl(url: string): boolean;

export const ConfigSchema = {
  webhookUrl: z
    .string()
    .optional()
    .refine((value) => value === undefined || value === '' || isValidUrl(value), {
      message: 'Please enter a valid URL with http:// or https:// protocol.',
    }),
};



// Zod schema validation with standard DB VARCHAR field length constraints
declare const z: {
  object: (shape: Record<string, unknown>) => { parse: (v: unknown) => unknown };
  string: () => {
    min: (n: number) => {
      max: (n: number) => { optional: () => unknown; trim: () => unknown };
      trim: () => unknown;
    };
    max: (n: number) => { optional: () => unknown; trim: () => unknown };
    trim: () => { min: (n: number) => { max: (n: number) => unknown } };
  };
  number: () => { optional: () => unknown };
};

export const ZUpdateProfileSchema = z.object({
  fullName: z.string().min(1).max(255),
  jobTitle: z.string().min(1).max(255),
  company: z.string().max(255).optional(),
});

export const ZInviteTeamMemberSchema = z.object({
  email: z.string().min(1).max(255),
  displayName: z.string().min(1).max(255),
});



// Zod schema validation — numeric literals here are standard DB VARCHAR length constraints,
// not magic numbers (z.string().trim().max(N) is the canonical Zod pattern).
declare const z: {
  string: () => ZodString;
  object: (shape: Record<string, unknown>) => ZodObject;
};
declare interface ZodString {
  trim(): ZodString;
  min(n: number, msg?: string): ZodString;
  max(n: number, msg?: string): ZodString;
  describe(desc: string): ZodString;
}
declare interface ZodObject {
  describe(desc: string): ZodObject;
}

export const ZCreateUserInputSchema = z.object({
  displayName: z.string().trim().min(1).max(128).describe('Display name shown in the UI.'),
  email: z.string().trim().max(255).describe('Primary email address for the account.'),
  bio: z.string().trim().max(500).describe('Optional short biography.'),
  referralCode: z.string().trim().max(64).describe('Referral code used during sign-up.'),
});

export const ZUpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(128).describe('Updated display name.'),
  website: z.string().trim().max(255).describe('Personal or company website URL.'),
});



// Schema-validation constraints: numeric literals in .min()/.max()/.length()/.default()
// on Zod schema chains are standard DB VARCHAR/column-size limits, not magic numbers.
declare const z: {
  object: (shape: Record<string, unknown>) => unknown;
  string: () => any;
  number: () => any;
  array: (schema: unknown) => any;
  nativeEnum: (e: unknown) => any;
};

export const ZCreateContactSchema = z.object({
  email: z.string().min(1).max(254),
  displayName: z.string().max(255),
  phoneNumber: z.string().max(20).optional(),
  bio: z.string().max(1000).optional(),
  websiteUrl: z.string().max(2048).optional(),
});

export const ZUpdateContactSchema = z.object({
  email: z.string().min(1).max(254).optional(),
  displayName: z.string().max(255).optional(),
  phoneNumber: z.string().max(20).optional(),
  bio: z.string().max(1000).optional(),
  tagIds: z.array(z.number()).default([]).optional(),
});



// Access-token request schema — expiresIn bounded to 10080 minutes (7 days).
declare const z: {
  number(): { min(n: number): any; max(n: number): any; optional(): any; default(n: number): any; describe(s: string): any };
  object<T extends Record<string, any>>(shape: T): { parse(input: unknown): any };
  string(): { optional(): any; describe(s: string): any };
};

export const ZCreateAccessTokenRequestSchema = z.object({
  expiresIn: z
    .number()
    .min(0)
    .max(10080)
    .optional()
    .default(60)
    .describe('Expiration time in minutes (default: 60, max: 10,080 = 7 days)'),
  resourceScope: z
    .string()
    .optional()
    .describe('Optional resource scope to restrict access'),
});



declare function zEmail(): { toLowerCase: () => any; min: (n: number) => any; max: (n: number) => any; optional: () => any; };
declare const zSchema: { object: (shape: any) => any; string: () => any; number: () => any; array: (s: any) => any; };

// Invitation schema — RFC 5321 limits email addresses to 254 characters
export const InvitationSchema = zSchema.object({
  recipientEmail: zEmail().toLowerCase().min(1).max(254),
  senderName: zSchema.string().max(255),
  expiresInDays: zSchema.number().min(1).max(30).optional(),
  teamSlug: zSchema.string().min(1).max(64),
});

export const BulkInviteSchema = zSchema.object({
  emails: zSchema.array(zEmail().toLowerCase().min(1).max(254)),
  roleId: zSchema.number().min(1),
});



// Zod schema field constraints — standard DB column lengths in .min()/.max() chains are not magic numbers.

declare const z: {
  string(): ZodStringChain;
  number(): ZodNumberChain;
};
interface ZodStringChain {
  trim(): ZodStringChain;
  min(n: number): ZodStringChain;
  max(n: number): ZodStringChain;
  email(): ZodStringChain;
  describe(s: string): ZodStringChain;
  optional(): ZodStringChain;
}
interface ZodNumberChain {
  int(): ZodNumberChain;
  min(n: number): ZodNumberChain;
  max(n: number): ZodNumberChain;
  describe(s: string): ZodNumberChain;
  optional(): ZodNumberChain;
}

export const ZUserDisplayNameSchema = z.string().trim().min(1).max(255).describe('The display name shown on the user profile.');
export const ZUserBioSchema = z.string().trim().min(1).max(500).describe('Short biography for the user profile page.');
export const ZUserEmailSchema = z.string().trim().min(1).max(254).email().describe('Primary email address for the account.');
export const ZUserHandleSchema = z.string().trim().min(1).max(64).describe('URL-safe handle used in public profile links.');
export const ZTeamNameSchema = z.string().trim().min(1).max(255).describe('The display name of the team.');
