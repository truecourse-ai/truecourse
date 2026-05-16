declare function fetchOrgDocumentLimit(orgId: string): Promise<number>;
declare function fetchOrgCurrentDocumentCount(orgId: string): Promise<number>;
declare function fetchOrgUserLimit(orgId: string): Promise<number>;
declare function fetchOrgCurrentUserCount(orgId: string): Promise<number>;

export async function checkOrganisationLimits(orgId: string) {
  const [docLimit, docCount, userLimit, userCount] = await Promise.all([
    fetchOrgDocumentLimit(orgId),
    fetchOrgCurrentDocumentCount(orgId),
    fetchOrgUserLimit(orgId),
    fetchOrgCurrentUserCount(orgId),
  ]);
  return {
    documentsExceeded: docCount >= docLimit,
    usersExceeded: userCount >= userLimit,
  };
}
