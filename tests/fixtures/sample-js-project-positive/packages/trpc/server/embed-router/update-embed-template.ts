// Single embed router uses type: 'templateId' — standalone usage
declare const db: {
  embedConfig: {
    update(args: {
      where: { id: string };
      data: {
        linkedResource?: { update?: { type?: string; resourceId?: string } };
      };
    }): Promise<unknown>;
  };
};

async function updateEmbedTemplate(configId: string, templateId: string) {
  await db.embedConfig.update({
    where: { id: configId },
    data: {
      linkedResource: {
        update: {
          type: 'templateId',
          resourceId: templateId,
        },
      },
    },
  });
}
