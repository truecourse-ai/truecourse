
declare const z: any;
declare const WorkspaceSchema: any;
declare const MemberSchema: any;

const ZWorkspaceResponseSchema = WorkspaceSchema.pick({
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  workspaceId: z.string(),
  ownerId: z.string().nullish().describe('The ID of the owner of this workspace, if any.'),
  memberCount: z.number().default(0),
  member: MemberSchema.pick({
    id: true,
    role: true,
    userId: true,
  }),
});
