declare function fetchActiveUsers(orgId: string): Promise<Array<{ id: string; name: string }>>;
declare function fetchSuspendedUsers(orgId: string): Promise<Array<{ id: string; name: string }>>;

export async function findUsers(orgId: string) {
  const [active, suspended] = await Promise.all([
    fetchActiveUsers(orgId),
    fetchSuspendedUsers(orgId),
  ]);
  return { active, suspended };
}
