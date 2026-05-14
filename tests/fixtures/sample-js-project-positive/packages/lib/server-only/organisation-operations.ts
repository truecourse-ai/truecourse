
// FP: tx.signature.upsert inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateGroupId(): string;

export async function createOrgGroupWithDefaultSignature(
  organisationId: string,
  groupName: string,
  defaultSignatureData: { userId: number; signatureImageBase64: string },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const group = await tx.organisationGroup.create({
      data: {
        id: generateGroupId(),
        organisationId,
        name: groupName,
      },
    });

    await tx.signature.upsert({
      where: { userId: defaultSignatureData.userId },
      create: {
        userId: defaultSignatureData.userId,
        groupId: group.id,
        signatureImageAsBase64: defaultSignatureData.signatureImageBase64,
      },
      update: {
        groupId: group.id,
      },
    });
  });
}



// FP: tx.organisationGlobalSettings.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateDefaultOrgSettings(): any;
declare function generateSettingsId(): string;
declare function generateOrgId(): string;

export async function provisionNewOrganisation(
  ownerId: number,
  name: string,
  orgType: string,
): Promise<string> {
  return await db.$transaction(async (tx) => {
    const settings = await tx.organisationGlobalSettings.create({
      data: {
        ...generateDefaultOrgSettings(),
        id: generateSettingsId(),
      },
    });

    const orgId = generateOrgId();
    await tx.organisation.create({
      data: {
        id: orgId,
        name,
        type: orgType,
        ownerUserId: ownerId,
        organisationGlobalSettingsId: settings.id,
      },
    });

    return orgId;
  });
}



// FP: tx.field.update inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function migrateFieldsToNewOrganisation(
  fieldIds: number[],
  newOrganisationId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const fieldId of fieldIds) {
      await tx.field.update({
        where: { id: fieldId },
        data: { organisationId: newOrganisationId },
      });
    }
  });
}



// FP: tx.envelope.updateMany inside prisma.$transaction — already in transaction (leave org)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function leaveOrganisationAndReassignEnvelopes(
  userId: number,
  organisationOwnerUserId: number,
  teamIds: string[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (teamIds.length > 0) {
      await tx.envelope.updateMany({
        where: {
          userId,
          teamId: { in: teamIds },
        },
        data: { userId: organisationOwnerUserId },
      });
    }

    await tx.organisationMember.delete({
      where: { userId_organisationId: { userId, organisationId: 'org_id' } },
    });
  });
}



// FP: tx.organisationGroup.create inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateGroupId(): string;

export async function deleteOrgMembersAndResetGroups(
  organisationId: string,
  memberIds: number[],
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.organisationMember.deleteMany({
      where: { id: { in: memberIds } },
    });

    await tx.organisationGroup.create({
      data: {
        id: generateGroupId(),
        organisationId,
        name: 'Default',
        type: 'INTERNAL',
      },
    });
  });
}



// FP: tx.organisationGroupMember.deleteMany inside prisma.$transaction — already in transaction
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };

export async function updateOrgAndResetGroupMembers(
  organisationId: string,
  name: string,
  groupId: string,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.organisationGroupMember.deleteMany({
      where: { organisationGroupId: groupId },
    });

    await tx.organisation.update({
      where: { id: organisationId },
      data: { name },
    });
  });
}



// FP: tx.organisation.create inside prisma.$transaction — already in transaction (insert-field-in-pdf context)
declare const db: { $transaction: (fn: (tx: any) => Promise<any>) => Promise<any> };
declare function generateOrgId(): string;

export async function createOrganisationWithDefaults(
  name: string,
  ownerId: number,
  type: string,
): Promise<any> {
  return await db.$transaction(async (tx) => {
    if (!insertionValues.inserted) {
      const updatedField = await tx.field.update({
        where: { id: fieldId },
        data: { customText: '', inserted: false },
      });
      return updatedField;
    }

    const organisation = await tx.organisation.create({
      data: {
        id: generateOrgId(),
        name,
        type,
        ownerUserId: ownerId,
      },
    });

    return organisation;
  });
}

declare const insertionValues: { inserted: boolean };
declare const fieldId: number;
