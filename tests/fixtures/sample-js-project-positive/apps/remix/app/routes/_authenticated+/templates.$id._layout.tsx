
declare const templateId: string;
declare const userId: string;
declare const teamId: string;
declare function getSharedTemplateById(options: { id: { type: string; id: string }; userId: string; teamId?: string }): Promise<unknown>;

async function loadTemplate() {
  const template = await getSharedTemplateById({
    id: { type: 'templateId', id: templateId },
    userId,
    teamId,
  });
  return template;
}
