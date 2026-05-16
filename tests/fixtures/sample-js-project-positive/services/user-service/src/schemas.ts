
// RFC 5321 email address length limit used as a Zod schema constraint.
declare const zEmail: () => { max: (n: number) => any; min: (n: number) => any; nullish: () => any };
declare const z: {
  object: (shape: Record<string, any>) => any;
  string: () => { min: (n: number, opts?: any) => any; max: (n: number, opts?: any) => any; optional: () => any };
};

export const ZInvitePayloadSchema = z.object({
  recipientEmail: zEmail().max(254),
  recipientName: z.string().max(255).optional(),
  inviteToken: z.string().min(1),
});


// --- argument-type-mismatch FP: Zod schema composition with .array().min().refine() ---
// z.array(z.object({...})).min(1).refine(...) is standard Zod builder method chain; no type mismatch.
declare const ContactRole: { OWNER: string; EDITOR: string; VIEWER: string };
declare function zEmail2(): any;
declare const z2: {
  object(shape: Record<string, any>): any;
  string(): { describe(s: string): any };
  array(schema: any): { min(n: number): { refine(fn: (val: any) => boolean, opts: { message: string }): any } };
  nativeEnum(e: object): any;
};

export const ZAddContactsRequestSchema = z2.object({
  workspaceId: z2.string().describe('The workspace to add the contacts to'),
  contacts: z2
    .array(
      z2.object({
        email: zEmail2().trim().toLowerCase(),
        role: z2.nativeEnum(ContactRole),
      }),
    )
    .min(1)
    .refine(
      (contacts: Array<{ email?: string }>) => {
        const emails = contacts
          .filter((c) => c.email !== undefined)
          .map((c) => c.email);
        return new Set(emails).size === emails.length;
      },
      { message: 'Contact emails must be unique' },
    ),
});

