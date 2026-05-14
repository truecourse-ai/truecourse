export class UserService {
  private readonly prefix = '/api/users';
  getAll(): string { return this.prefix; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.prefix}/${id}`;
  }
  create(input: { name: string; email: string }): string {
    return `${this.prefix}/${input.name}`;
  }
  archive(id: string): string { return `${this.prefix}/${id}/archive`; }
}



// createUserProfile accepts nested options with proper typing
declare function createUserProfile(options: {
  userId: number;
  teamId: number | null;
  id: { type: string; id: number };
  fields: Array<{ name: string; value: string; position: number }>;
  metadata: Record<string, unknown>;
}): Promise<{ success: boolean }>;

export async function setupUserWithProfile(
  currentUserId: number,
  currentTeamId: number | null,
  profileId: number,
  customFields: Array<{ label: string; content: string; pageNumber: number }>,
  requestMeta: Record<string, unknown>,
): Promise<{ success: boolean }> {
  return await createUserProfile({
    userId: currentUserId,
    teamId: currentTeamId,
    id: {
      type: 'profileId',
      id: profileId,
    },
    fields: customFields.map((field) => ({
      name: field.label,
      value: field.content,
      position: field.pageNumber,
    })),
    metadata: requestMeta,
  });
}
