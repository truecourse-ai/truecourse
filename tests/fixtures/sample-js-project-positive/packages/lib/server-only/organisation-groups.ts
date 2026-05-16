
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>; group: { update: (args: any) => Promise<any> }; groupMember: { deleteMany: (args: any) => Promise<any>; createMany: (args: any) => Promise<any> }; };

export async function replaceGroupMembers(
  groupId: number,
  memberIds: number[],
  updatedName: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.group.update({
      where: { id: groupId },
      data: { name: updatedName, updatedAt: new Date() },
    });

    await tx.groupMember.deleteMany({ where: { groupId } });

    await tx.groupMember.createMany({
      data: memberIds.map((userId) => ({ groupId, userId })),
    });
  });
}


// result.fields.map() spreading field and adding formId FP — setEnvelopeFields undefined → TS2304 → rule fires
export async function updateFieldPositions_ad6faee8(envelopeId: string): Promise<{ data: unknown[] }> {
  const result = await setEnvelopeFields({
    envelopeId,
    fields: rawEnvelopeFields.map((field: { id: string; page: number; positionX: number }) => ({
      ...field,
      pageNumber: field.page,
      pageX: field.positionX,
    })),
  });
  return {
    data: result.fields.map((field: { id: string; formId?: string }) => ({
      ...field,
      formId: field.formId,
    })),
  };
}

