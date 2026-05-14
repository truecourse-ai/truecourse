
// --- shape dbdd85aac816: fn.count<number>() in Kysely query builder ---
declare const kyselyDb: {
  $kysely: {
    selectFrom: (source: unknown) => {
      select: (fn: (helpers: { fn: { count: <T>(col: string) => { as: (alias: string) => unknown } } }) => unknown) => {
        executeTakeFirstOrThrow: () => Promise<{ total: number | bigint | null }>;
      };
    };
  };
};
declare const baseQuery: {
  clearSelect: () => { select: (col: string) => { limit: (n: number) => { as: (alias: string) => unknown } } };
  as: (alias: string) => unknown;
};

const countQuery = kyselyDb.$kysely
  .selectFrom(baseQuery.as('filtered'))
  .select(({ fn }) => fn.count<number>('id').as('total'));

const countResult = await countQuery.executeTakeFirstOrThrow();
const totalCount = Number(countResult.total ?? 0);



// --- shape dd815d1a4910: new Map(ids.map((id, i) => [id, i])) for ordering ---
declare const ids: number[];
declare const data: Array<{ id: number; title: string }>;

const idOrder = new Map(ids.map((id, index) => [id, index]));
data.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));



// --- expression-complexity shape: destructured-parameter-lists ---
// findItems accepts a large destructured options object. The destructuring
// with defaults is idiomatic for service-layer query functions — not complex.
declare function prisma_findMany(opts: unknown): Promise<unknown[]>;

export const findItems = async ({
  userId,
  teamId,
  type,
  status,
  page = 1,
  perPage = 10,
  orderBy,
  query = '',
  folderId,
  useWindowedCount = true,
}: {
  userId: string;
  teamId: string;
  type?: string;
  status?: string;
  page?: number;
  perPage?: number;
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  query?: string;
  folderId?: string;
  useWindowedCount?: boolean;
}) => {
  const offset = (page - 1) * perPage;
  return prisma_findMany({
    userId,
    teamId,
    type,
    status,
    offset,
    perPage,
    orderBy,
    query,
    folderId,
    useWindowedCount,
  });
};
