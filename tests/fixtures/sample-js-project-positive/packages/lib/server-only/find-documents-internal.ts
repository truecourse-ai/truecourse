declare function countInternalDocuments(teamId: string): Promise<number>;
declare function listInternalDocuments(teamId: string, cursor?: string): Promise<Array<{ id: string }>>;

export async function findDocumentsInternal(teamId: string, cursor?: string) {
  const [count, documents] = await Promise.all([
    countInternalDocuments(teamId),
    listInternalDocuments(teamId, cursor),
  ]);
  return { count, documents };
}
