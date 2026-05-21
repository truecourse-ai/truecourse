export function logSeededSummary(rootId: string, branchId: string, memberCount: number): void {
  console.log(`[seeding]: complete`);
  console.log(`  root id:      ${rootId}`);
  console.log(`  branch id:    ${branchId}`);
  console.log(`  member count: ${memberCount}`);
  console.debug(`[seeding]: detail dump`);
}
