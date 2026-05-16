
// --- argument-type-mismatch shape: forEach with Map in Zod superRefine ---
// items.forEach with seen.has(id) uniqueness check inside superRefine — valid Zod pattern.
declare const z: { object: (s: object) => any; string: () => { min: (n: number) => any }; number: () => any; array: (s: any) => { min: (n: number) => { superRefine: (fn: (items: any[], ctx: any) => void) => any } }; ZodIssueCode: { custom: string } };
const ZAddMembersSchema = z.object({
  teamId: z.number(),
  members: z
    .array(
      z.object({
        memberId: z.string().min(1),
      }),
    )
    .min(1)
    .superRefine((items: Array<{ memberId: string }>, ctx: { addIssue: (issue: object) => void }) => {
      const seen = new Map<string, number>();
      items.forEach((item, index) => {
        const id = item.memberId;
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Member IDs must be unique',
            path: [index, 'memberId'],
          });
        } else {
          seen.set(id, index);
        }
      });
    }),
});



// --- argument-type-mismatch shape: Zod schema with nativeEnum and optional fields ---
// z.nativeEnum(RecipientRole) and z.number().optional() in array schema — valid Zod composition.
declare const z: {
  object: (s: object) => { merge: (other: any) => any };
  number: () => { optional: () => any; min: (n: number) => any };
  string: () => { min: (n: number) => any; toLowerCase: () => any };
  nativeEnum: (e: object) => any;
  array: (s: any) => any;
};
declare const ParticipantRole: { SIGNER: string; VIEWER: string; APPROVER: string; CC: string };
const ZSetParticipantsSchema = z.object({
  resourceId: z.number(),
  participants: z.array(
    z.object({
      id: z.number().optional(),
      email: z.string().min(1),
      name: z.string().min(0),
      role: z.nativeEnum(ParticipantRole),
      signingOrder: z.number().optional(),
    }),
  ),
});



// --- argument-type-mismatch shape: z.preprocess converting empty string to undefined ---
// z.preprocess((val) => val === '' ? undefined : val, schema.optional()) — valid Zod schema composition.
declare const z: {
  object: (s: object) => any;
  string: () => { optional: () => any; email: () => any };
  preprocess: (fn: (v: unknown) => unknown, schema: any) => any;
  nativeEnum: (e: object) => { optional: () => any; default: (v: any) => any };
};
declare const DistributionMethod: { EMAIL: string; MANUAL: string };
const ZDistributeFormSchema = z.object({
  meta: z.object({
    replyTo: z.preprocess((val) => (val === '' ? undefined : val), z.string().email().optional()),
    subject: z.string(),
    distributionMethod: z.nativeEnum(DistributionMethod).optional().default(DistributionMethod.EMAIL),
  }),
});



// --- argument-type-mismatch shape: Zod .refine() with string-to-boolean callback ---
// z.string().refine((val) => /regex/.test(val), { message }) — correct Zod refine signature.
declare const z: { string: () => { min: (n: number, opts?: object) => any; max: (n: number, opts?: object) => any; refine: (fn: (v: string) => boolean, opts?: object) => any } };
const ZStrongPasswordSchema = z.string()
  .min(8, { message: 'At least 8 characters required' })
  .max(72, { message: 'Cannot exceed 72 characters' })
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), { message: 'One uppercase character required' })
  .refine((value) => value.length > 25 || /[a-z]/.test(value), { message: 'One lowercase character required' })
  .refine((value) => value.length > 25 || /\d/.test(value), { message: 'One number required' });



// z.string().min(3) is a named minimum length constraint for a user display name
declare const z: {
  string(): {
    trim(): { min(n: number, opts?: { message: string }): { refine(fn: (v: string) => boolean, opts: { message: string }): unknown } };
  };
};

const URL_PATTERN = /https?:\/\/|www\./i;

const ZDisplayNameSchema = z
  .string()
  .trim()
  .min(3, { message: 'Please enter a valid display name.' })
  .refine((value) => !URL_PATTERN.test(value), {
    message: 'Name cannot contain URLs.',
  });



// max(72) for password is the bcrypt max input length — well-known domain constant
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): {
      max(n: number, opts?: { message: string }): {
        refine(fn: (v: string) => boolean, opts: { message: string }): unknown;
      };
    };
  };
};

const ZPasswordSchema = z
  .string()
  .min(8, { message: 'Must be at least 8 characters in length' })
  .max(72, { message: 'Cannot be more than 72 characters in length' })
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), {
    message: 'One uppercase character',
  });



// z.string().max(255).optional() is a standard DB VARCHAR field length constraint
declare const z: {
  string(): {
    max(n: number): { optional(): unknown };
  };
  object(shape: Record<string, unknown>): unknown;
};

const ZRecipientSchema = z.object({
  name: z.string().max(255).optional(),
  customMessage: z.string().max(255).optional(),
});



// z.string().min(8) is a named password minimum length constraint
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): {
      max(n: number, opts: { message: string }): {
        refine(fn: (v: string) => boolean, opts: { message: string }): unknown;
      };
    };
  };
};

const ZNewPasswordSchema = z
  .string()
  .min(8, { message: 'Must be at least 8 characters in length' })
  .max(72, { message: 'Cannot be more than 72 characters in length' })
  .refine((value) => /[A-Z]/.test(value), {
    message: 'Must contain at least one uppercase letter',
  });



// z.array().min(1).max(20) for batch IDs — bounds have clear semantic meaning in the schema
declare const z: {
  discriminatedUnion(key: string, variants: unknown[]): unknown;
  object(shape: Record<string, unknown>): unknown;
  array(schema: unknown): { min(n: number): { max(n: number): unknown } };
  string(): unknown;
  number(): unknown;
  literal(val: unknown): unknown;
};

const ZBatchIdSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('envelopeId'),
    ids: z.array(z.string()).min(1).max(20),
  }),
  z.object({
    type: z.literal('documentId'),
    ids: z.array(z.number()).min(1).max(20),
  }),
]);



// z.coerce.number().min(1).optional().default(10) is a named pagination default in schema
declare const z: {
  coerce: {
    number(): {
      min(n: number): {
        optional(): {
          default(n: number): unknown;
        };
      };
    };
  };
  object(shape: Record<string, unknown>): unknown;
};

const ZPaginationQuerySchema = z.object({
  page: z.coerce.number().min(1).optional().default(1),
  perPage: z.coerce.number().min(1).optional().default(10),
});



// value.length > 25 is a password complexity policy threshold — clear policy rule with context
declare const z: {
  string(): {
    min(n: number, opts: { message: string }): {
      max(n: number, opts: { message: string }): {
        refine(fn: (v: string) => boolean, opts: { message: string }): unknown;
      };
    };
  };
};

const ZPasswordComplexitySchema = z
  .string()
  .min(8, { message: 'Must be at least 8 characters in length' })
  .max(72, { message: 'Cannot be more than 72 characters in length' })
  .refine((value) => value.length > 25 || /[A-Z]/.test(value), {
    message: 'One uppercase character required',
  })
  .refine((value) => value.length > 25 || /[a-z]/.test(value), {
    message: 'One lowercase character required',
  })
  .refine((value) => value.length > 25 || /\d/.test(value), {
    message: 'One number required',
  });



// z.string().max(500) is a named rejection reason length constraint with error message
declare const z: {
  object(shape: Record<string, unknown>): unknown;
  string(): {
    max(n: number, message: unknown): unknown;
  };
};
declare const msg: (template: TemplateStringsArray, ...args: unknown[]) => unknown;

const ZRejectReasonFormSchema = z.object({
  reason: z.string().max(500, msg`Reason must be less than 500 characters`),
});



// .default(60) for minutes is a domain default of 1 hour for token expiry — clear context
declare const z: {
  number(): {
    min(n: number): {
      max(n: number): {
        optional(): {
          default(n: number): { describe(s: string): unknown };
        };
      };
    };
  };
  object(shape: Record<string, unknown>): unknown;
  string(): unknown;
};

const ZPresignTokenRequestSchema = z.object({
  expiresIn: z
    .number()
    .min(0)
    .max(10080)
    .optional()
    .default(60)
    .describe('Expiration time in minutes (default: 60, max: 10,080)'),
  scope: z.string().optional(),
});



// zEmail().max(254) uses RFC 5321 max email length — well-known standard constant
declare function zEmail(): { toLowerCase(): { min(n: number): { max(n: number): { optional(): unknown } } } };
declare const z: {
  string(): { max(n: number): unknown };
  object(shape: Record<string, unknown>): unknown;
  number(): unknown;
};

const ZCreateRecipientSchema = z.object({
  email: zEmail().toLowerCase().min(1).max(254),
  name: z.string().max(255),
});
