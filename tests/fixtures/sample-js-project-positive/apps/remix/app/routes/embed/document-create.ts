
declare function createEmbedDocument(opts: { title: string; dataId: string; ownerId: number }): Promise<{ id: number }>;
declare function getSessionUser(): { id: number };
declare function getFormData(req: unknown): { title: string; dataId: string };

async function handleDocumentCreate(request: unknown) {
  const user = getSessionUser();
  const { title, dataId } = getFormData(request);

  const document = await createEmbedDocument({
    title: title,
    dataId: dataId,
    ownerId: user.id,
  });

  return { documentId: document.id };
}
