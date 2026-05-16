
// --- argument-type-mismatch shape: stdlib-and-third-party-api-calls (Zod schema composition) ---
declare function zEmail(): { trim(): { toLowerCase(): any } };
declare const MemberRole: { ADMIN: string; MEMBER: string; VIEWER: string };
declare const z: {
  object(shape: Record<string, any>): any;
  string(): { describe(s: string): any };
  array(schema: any): { min(n: number): { refine(fn: (val: any) => boolean, opts: { message: string }) : any } };
  nativeEnum(e: object): any;
};

export const ZInviteTeamMembersRequestSchema = z.object({
  teamId: z.string().describe('The team to invite the user to'),
  invitations: z
    .array(
      z.object({
        email: zEmail().trim().toLowerCase(),
        memberRole: z.nativeEnum(MemberRole),
      }),
    )
    .min(1)
    .refine(
      (invitations) => {
        const emails = invitations
          .filter((invitation: any) => invitation.email !== undefined)
          .map((invitation: any) => invitation.email);
        return new Set(emails).size === emails.length;
      },
      {
        message: 'Emails must be unique, no duplicate values allowed',
      },
    ),
});
