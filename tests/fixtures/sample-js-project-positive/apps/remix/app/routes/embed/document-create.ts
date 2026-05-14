
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

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
