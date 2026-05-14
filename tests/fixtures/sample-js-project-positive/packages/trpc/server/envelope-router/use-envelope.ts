// Single router uses type: 'envelopeId' — standalone usage
declare const db: {
  webhookDelivery: {
    update(args: {
      where: { id: string };
      data: { linkedResource?: { update?: { type?: string; resourceId?: string } } };
    }): Promise<unknown>;
  };
};

async function linkEnvelopeToWebhook(deliveryId: string, envelopeId: string) {
  await db.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      linkedResource: {
        update: {
          type: 'envelopeId',
          resourceId: envelopeId,
        },
      },
    },
  });
}
