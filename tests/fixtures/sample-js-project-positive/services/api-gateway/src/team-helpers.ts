
// --- FP shape: Array.map() with destructuring from nested members ---
declare const organisationGroupMembers: Array<{
  group: { id: number; name: string };
  members: Array<{ userId: number; role: string }>;
}>;

const groupSummaries = organisationGroupMembers.map(({ group, members }) => ({
  groupId: group.id,
  groupName: group.name,
  memberCount: members.length,
}));
