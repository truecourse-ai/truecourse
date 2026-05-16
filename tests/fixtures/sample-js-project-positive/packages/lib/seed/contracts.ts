
declare const db: { contract: { create: (opts: any) => Promise<any> } };
declare function generateId(prefix: string): string;
declare const ContractStatus: { DRAFT: string; ACTIVE: string };
declare const ContractType: { AGREEMENT: string };

export const seedAgreement = async (owner: { id: string }, teamId: number, key: string) => {
  return await db.contract.create({
    data: {
      id: generateId('contract'),
      secondaryId: generateId('contract'),
      type: ContractType.AGREEMENT,
      teamId,
      title: `[TEST] Agreement ${key} - Draft`,
      status: ContractStatus.DRAFT,
      parties: {
        create: {
          id: generateId('contract'),
          name: `Party A for ${key}`,
          order: 1,
        },
      },
      userId: owner.id,
    },
  });
};

export const seedAmendment = async (owner: { id: string }, teamId: number, key: string) => {
  return await db.contract.create({
    data: {
      id: generateId('contract'),
      secondaryId: generateId('contract'),
      type: ContractType.AGREEMENT,
      teamId,
      title: `[TEST] Amendment ${key} - Draft`,
      status: ContractStatus.DRAFT,
      parties: {
        create: {
          id: generateId('contract'),
          name: `Party B for ${key}`,
          order: 1,
        },
      },
      userId: owner.id,
    },
  });
};
