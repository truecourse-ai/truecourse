
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; subscriptionClaim: { update: (args: any) => Promise<any> }; organisation: { update: (args: any) => Promise<any> }; };

export async function applySubscriptionClaim(organisationId: number, claimId: number, seats: number): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.subscriptionClaim.update({
      where: { id: claimId },
      data: { appliedAt: new Date(), seats },
    });

    await tx.organisation.update({
      where: { id: organisationId },
      data: { claimId },
    });
  });
}


// setFieldsForTemplate({userId: ctx.user.id, teamId, id: {...}, fields: [...]}) FP — setFieldsForTemplate undefined → TS2304 → rule fires
export async function applyFieldConfig_44d04f5f(): Promise<void> {
  await setFieldsForTemplate({
    userId: requestCtx.user.id,
    teamId: requestCtx.teamId,
    id: { type: 'envelopeId', id: currentEnvelopeId },
    fields: rawFields.map((f: { fieldType: string; page: number; x: number; y: number }) => ({
      type: f.fieldType,
      pageNumber: f.page,
      pageX: f.x,
      pageY: f.y,
    })),
  });
}

