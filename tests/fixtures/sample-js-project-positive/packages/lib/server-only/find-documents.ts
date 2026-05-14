declare function countDocuments(userId: string, status: string): Promise<number>;
declare function listDocuments(userId: string, status: string, page: number): Promise<Array<{ id: string }>>;

export async function findDocumentsByStatus(userId: string, status: string, page: number) {
  const [total, documents] = await Promise.all([
    countDocuments(userId, status),
    listDocuments(userId, status, page),
  ]);
  return { total, documents };
}
