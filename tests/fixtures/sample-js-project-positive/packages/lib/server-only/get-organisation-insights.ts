declare function fetchOrgDocumentStats(orgId: string): Promise<{ total: number; signed: number }>;
declare function fetchOrgUserStats(orgId: string): Promise<{ total: number; active: number }>;
declare function fetchOrgStorageStats(orgId: string): Promise<{ usedBytes: number }>;

export async function getOrganisationDetailedInsights(orgId: string) {
  const [documentStats, userStats, storageStats] = await Promise.all([
    fetchOrgDocumentStats(orgId),
    fetchOrgUserStats(orgId),
    fetchOrgStorageStats(orgId),
  ]);
  return { documentStats, userStats, storageStats };
}



declare function fetchOrgBillingStats(orgId: string): Promise<{ plan: string; invoiceCount: number }>;
declare function fetchOrgApiUsageStats(orgId: string): Promise<{ requestCount: number }>;

export async function getOrganisationSummaryInsights(orgId: string) {
  const [billing, apiUsage] = await Promise.all([
    fetchOrgBillingStats(orgId),
    fetchOrgApiUsageStats(orgId),
  ]);
  return { billing, apiUsage };
}
