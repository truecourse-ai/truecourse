declare function revokeUserSessions(userId: string): Promise<void>;
declare function deleteUserDocuments(userId: string): Promise<void>;
declare function removeUserFromOrgs(userId: string): Promise<void>;

export async function deleteUser(userId: string) {
  await Promise.all([
    revokeUserSessions(userId),
    deleteUserDocuments(userId),
    removeUserFromOrgs(userId),
  ]);
}
