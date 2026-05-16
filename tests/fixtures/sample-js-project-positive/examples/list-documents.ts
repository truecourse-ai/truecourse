
// Standalone example script demonstrating API pagination —
// console.log is appropriate for CLI example output.
declare const apiClient: { listDocuments(opts: { page: number; perPage: number }): Promise<{ status: number; body: { documents: Array<{ id: string; title: string }>; totalPages: number } }> };

const main = async () => {
  let page = 1;
  let totalPages = 1;

  do {
    const { status, body } = await apiClient.listDocuments({ page, perPage: 10 });
    if (status !== 200) throw new Error('Failed to list documents');

    for (const doc of body.documents) {
      console.log(`Got document with id: ${doc.id} and title: ${doc.title}`);
    }

    totalPages = body.totalPages;
    page++;
  } while (page <= totalPages);
};

main().catch(console.error);
