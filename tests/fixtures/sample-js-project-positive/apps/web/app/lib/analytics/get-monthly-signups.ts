
declare const dbClient: { query: (sql: string, params?: any[]) => Promise<any[]> };

export async function getMonthlySignups(type: 'count' | 'cumulative' = 'count') {
  const rows = await dbClient.query(
    `SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*) AS count FROM users GROUP BY month ORDER BY month DESC`
  );
  return rows;
}

export async function getMonthlyCancellations(type: 'count' | 'cumulative' = 'count') {
  const rows = await dbClient.query(
    `SELECT DATE_TRUNC('month', cancelled_at) AS month, COUNT(*) AS count FROM subscriptions WHERE cancelled_at IS NOT NULL GROUP BY month ORDER BY month DESC`
  );
  return rows;
}
