declare const z: {
  object: (shape: Record<string, any>) => any;
  string: () => any;
  number: () => any;
  array: (schema: any) => any;
  nativeEnum: (e: any) => any;
};
declare function zEmail(): any;

export const ZInviteCollaboratorSchema = z.object({
  token: z.string(),
  documentId: z.number(),
  nextSigner: z
    .object({
      email: zEmail().max(254),
      name: z.string().min(1).max(255),
    })
    .optional(),
  recipientOverride: z
    .object({
      email: zEmail().trim().toLowerCase().max(254).optional(),
      displayName: z.string().max(255).optional(),
    })
    .optional(),
});

export type TInviteCollaboratorSchema = ReturnType<typeof ZInviteCollaboratorSchema.parse>;
