
// Wave-M33: getItemById with nested discriminated union id — 'templateId' literal is valid
declare function getItemById(opts: {
  id: { type: 'templateId'; id: number } | { type: 'documentId'; id: number };
  type: 'TEMPLATE' | 'DOCUMENT';
  userId: number;
  teamId: number;
}): Promise<{ id: string; title: string } | null>;

declare const templateId: number;
declare const userId: number;
declare const teamId: number;

const template = await getItemById({
  id: { type: 'templateId', id: templateId },
  type: 'TEMPLATE',
  userId,
  teamId,
});
