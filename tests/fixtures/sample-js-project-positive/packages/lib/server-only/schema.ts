
// FF07 — Zod object schema with chained validators; no type mismatch
declare const z: {
  object<T extends Record<string, unknown>>(shape: T): { parse: (v: unknown) => unknown; min: (n: number) => unknown };
  string(): { min: (n: number) => { describe: (s: string) => unknown }; email: () => { min: (n: number) => unknown } };
  number(): { min: (n: number) => unknown };
  boolean(): unknown;
  array<T>(schema: T): unknown;
};
declare function zEmail(): { min: (n: number) => unknown };

const InviteParticipantSchema = z.object({
  name: z.string().min(1).describe('Participant display name'),
  email: zEmail().min(1),
  role: z.string().min(1),
  notify: z.boolean(),
});



// FF11 — Zod object with .describe(); standard usage, no type mismatch
declare const z: {
  object<T extends Record<string, unknown>>(shape: T): unknown;
  string(): { describe: (s: string) => unknown; min: (n: number) => unknown };
  array<T>(schema: T): unknown;
};

const DeleteInvitesInputSchema = z.object({
  workspaceId: z.string().describe('The workspace to modify'),
  invitations: z.array(z.string().describe('Invitation ID to revoke')),
});



// FF14 — Zod .transform() returning string[]; no type mismatch
declare const z: {
  string(): { transform<U>(fn: (val: string) => U): unknown };
  unknown(): { transform<U>(fn: (val: unknown) => U): unknown };
};

const TagListSchema = z.string().transform(
  (value) => (typeof value === 'string' && value.length > 0 ? value.split(',') : [])
);
