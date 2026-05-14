
// Standalone API example script demonstrating pagination —
// console.log is appropriate for CLI example output scripts.
declare const apiClient: { getDocuments(opts: { page: number }): Promise<{ status: number; body: { documents: Array<{ id: string; title: string }> } }> };

const main = async () => {
  const { status, body } = await apiClient.getDocuments({ page: 1 });
  if (status !== 200) throw new Error('Failed to get documents');

  for (const document of body.documents) {
    console.log(`Got document with id: ${document.id} and title: ${document.title}`);
  }
};

main().catch(console.error);
