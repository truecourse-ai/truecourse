// Single router uses a type discriminant field with standalone usage
declare const db: {
  embedConfig: {
    update(args: {
      where: { id: string };
      data: {
        linkedField?: { update?: { type?: string; value?: string } };
      };
    }): Promise<unknown>;
  };
};

async function updateEmbedResource(configId: string, resourceId: string) {
  await db.embedConfig.update({
    where: { id: configId },
    data: {
      linkedField: {
        update: {
          type: 'resourceId',
          value: resourceId,
        },
      },
    },
  });
}
