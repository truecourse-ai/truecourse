
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
