
// shape: async arrow in Promise.all().map() delegates to a db create call; async for map callback type conformance
declare const db: { group: { create(opts: Record<string, unknown>): Promise<{ id: string }> } };
declare function generateId(kind: string): string;

const INTERNAL_GROUPS = [
  { type: 'admin', role: 'OWNER' },
  { type: 'member', role: 'MEMBER' },
];

const provisionTeamGroups = async (teamId: string, orgId: string) => {
  await Promise.all(
    INTERNAL_GROUPS.map(async (group) =>
      db.group.create({
        data: {
          id: generateId('group'),
          type: group.type,
          orgId,
          teamId,
          role: group.role,
        },
      }),
    ),
  );
};



declare const AppError: { parseError: (e: unknown) => { code: string } };
declare const AppErrorCode: { CONFLICT: string };
declare function updateTeamSettings(teamId: string, data: Record<string, unknown>): Promise<void>;
declare function showToast(opts: { title: string; description: string; variant?: string }): void;

async function handleTeamUpdate(teamId: string, data: Record<string, unknown>): Promise<void> {
  try {
    await updateTeamSettings(teamId, data);
    showToast({ title: 'Settings saved', description: 'Team settings updated successfully.' });
  } catch (err) {
    const error = AppError.parseError(err);
    showToast({
      title: 'Error',
      description: error.code === AppErrorCode.CONFLICT ? 'Name already taken.' : 'Failed to update team.',
      variant: 'destructive',
    });
  }
}
