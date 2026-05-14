// Hono RPC chain — bracket consistency when sibling keys require brackets (colon-prefixed)
declare const apiClient: any;

async function getUserById(userId: string) {
  // ':userId' requires bracket notation; 'user' uses brackets for chain consistency
  const res = await apiClient['user'][':userId'].$get({ param: { ':userId': userId } });
  return res.json();
}

async function getOrganisationMember(orgId: string, memberId: string) {
  const res = await apiClient['organisation'][':orgId']['members'][':memberId'].$get({
    param: { ':orgId': orgId, ':memberId': memberId },
  });
  return res.json();
}
