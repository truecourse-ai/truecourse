
// E03: Zod schema .extend() — extending a base schema with additional fields; no type mismatch.
declare const z: {
  string(): { optional(): unknown };
  enum(vals: string[]): unknown;
  preprocess(fn: (v: unknown) => unknown, schema: unknown): unknown;
  object(shape: Record<string, unknown>): { extend(shape: Record<string, unknown>): unknown };
};

declare const ZBaseQuerySchema: { extend(shape: Record<string, unknown>): unknown };

const ZResourceQuerySchema = ZBaseQuerySchema.extend({
  status: z.enum(['active', 'archived', 'pending']),
  tags: z.preprocess(
    (val) => (Array.isArray(val) ? val : typeof val === 'string' ? val.split(',') : []),
    z.string().optional(),
  ),
});



// E16: array .filter() with .includes() predicate — string includes is correct; no type mismatch.
declare const fieldValidationErrors: string[];

const numericFormatErrors = fieldValidationErrors.filter((error) =>
  error.includes('numeric format')
);

const rangeErrors = fieldValidationErrors.filter((error) =>
  error.includes('out of range')
);



// E33: z.preprocess() with instanceof check — Zod normalization; no type mismatch.
declare const z2: {
  preprocess(fn: (data: unknown) => unknown, schema: unknown): unknown;
  object(shape: Record<string, unknown>): unknown;
  string(): { min(n: number): unknown };
};

const ZFormDataSchema = z2.preprocess(
  (data) => {
    if (data instanceof FormData) {
      const result: Record<string, unknown> = {};
      data.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }
    return data;
  },
  z2.object({
    name: z2.string().min(1),
    description: z2.string().min(0),
  }),
);



// E36: z.array().transform() — Zod transform callback; no type mismatch.
declare const z3: {
  array(inner: unknown): { transform<T>(fn: (val: string[]) => T): unknown };
  string(): unknown;
};

const ZTagListSchema = z3
  .array(z3.string())
  .transform((val) => val.map((tag) => tag.toLowerCase().trim()).filter(Boolean));



// E42: Number.isNaN / Number.isInteger guard — both accept number; no type mismatch.
declare function throwBadRequest(msg: string): never;

function validateResourceId(raw: string): number {
  const resourceId = Number(raw);

  if (Number.isNaN(resourceId) || !Number.isInteger(resourceId)) {
    throwBadRequest('Invalid resource ID format in request parameter');
  }

  return resourceId;
}



// E48: utility function with typed id parameter — no type mismatch.
const enum AuthLevel {
  NONE = 'NONE',
  EMAIL = 'EMAIL',
  TWO_FACTOR = 'TWO_FACTOR',
}

interface ParticipantRecord {
  id: string;
  email: string;
  authLevel: AuthLevel;
}

declare function getRequiredAuthLevel(participantId: string): AuthLevel;
declare const participantRecord: ParticipantRecord;

const requiredLevel = getRequiredAuthLevel(participantRecord.id);
