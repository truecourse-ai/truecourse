declare function loadGlobalDocumentStats(): Promise<{ total: number; completedToday: number }>;
declare function loadGlobalUserStats(): Promise<{ total: number; newThisWeek: number }>;
declare function loadGlobalRevenueStats(): Promise<{ mrr: number }>;

export async function loader() {
  const [documentStats, userStats, revenueStats] = await Promise.all([
    loadGlobalDocumentStats(),
    loadGlobalUserStats(),
    loadGlobalRevenueStats(),
  ]);
  return { documentStats, userStats, revenueStats };
}
