
// Standalone runnable API example script — console.log is the correct
// output mechanism for CLI example scripts.
declare const apiClient: { createField(opts: { documentId: string; type: string; recipientId: string; pageNumber: number; pageX: number; pageY: number }): Promise<{ status: number; body: { id: string } }> };

const main = async () => {
  const { status, body } = await apiClient.createField({
    documentId: '42',
    type: 'SIGNATURE',
    recipientId: 'rec_abc123',
    pageNumber: 1,
    pageX: 10,
    pageY: 20,
  });

  if (status !== 200) throw new Error('Failed to create field');

  console.log(`Field created with id: ${body.id}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
