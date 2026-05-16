declare function createDocument(name: string): Promise<{ id: string }>;
declare function sendDocument(id: string): Promise<void>;

async function main() {
  const doc = await createDocument('contract.pdf');
  await sendDocument(doc.id);
  console.log('Document sent successfully');
}

main().catch((err) => {
  console.error('Failed to send document:', err);
  process.exit(1);
});
