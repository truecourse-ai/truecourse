// Aggregated fixture for natural rule shape coverage.

// shape b29736d3: missing-transaction — multiple ORM writes without transaction
declare const repository_b29736d3: {
  primaryTable: { create: (a: unknown) => Promise<unknown> };
  secondaryTable: { update: (a: unknown) => Promise<unknown> };
};
export async function performMultiWrite_b29736d3(): Promise<void> {
  await repository_b29736d3.primaryTable.create({ data: { id: 'b29736d3' } });
  await repository_b29736d3.secondaryTable.update({ where: { id: 'b29736d3' }, data: { touched: true } });
}


// shape 3cf06aa6: missing-transaction — multiple ORM writes without transaction
declare const repository_3cf06aa6: {
  primaryTable: { create: (a: unknown) => Promise<unknown> };
  secondaryTable: { update: (a: unknown) => Promise<unknown> };
};
export async function performMultiWrite_3cf06aa6(): Promise<void> {
  await repository_3cf06aa6.primaryTable.create({ data: { id: '3cf06aa6' } });
  await repository_3cf06aa6.secondaryTable.update({ where: { id: '3cf06aa6' }, data: { touched: true } });
}


// shape 67dc729e: missing-transaction — multiple ORM writes without transaction
declare const repository_67dc729e: {
  primaryTable: { create: (a: unknown) => Promise<unknown> };
  secondaryTable: { update: (a: unknown) => Promise<unknown> };
};
export async function performMultiWrite_67dc729e(): Promise<void> {
  await repository_67dc729e.primaryTable.create({ data: { id: '67dc729e' } });
  await repository_67dc729e.secondaryTable.update({ where: { id: '67dc729e' }, data: { touched: true } });
}


// shape 8fdccf7d: missing-transaction — multiple ORM writes without transaction
declare const repository_8fdccf7d: {
  primaryTable: { create: (a: unknown) => Promise<unknown> };
  secondaryTable: { update: (a: unknown) => Promise<unknown> };
};
export async function performMultiWrite_8fdccf7d(): Promise<void> {
  await repository_8fdccf7d.primaryTable.create({ data: { id: '8fdccf7d' } });
  await repository_8fdccf7d.secondaryTable.update({ where: { id: '8fdccf7d' }, data: { touched: true } });
}


// shape 8c86107f: missing-transaction — multiple ORM writes without transaction
declare const repository_8c86107f: {
  primaryTable: { create: (a: unknown) => Promise<unknown> };
  secondaryTable: { update: (a: unknown) => Promise<unknown> };
};
export async function performMultiWrite_8c86107f(): Promise<void> {
  await repository_8c86107f.primaryTable.create({ data: { id: '8c86107f' } });
  await repository_8c86107f.secondaryTable.update({ where: { id: '8c86107f' }, data: { touched: true } });
}

