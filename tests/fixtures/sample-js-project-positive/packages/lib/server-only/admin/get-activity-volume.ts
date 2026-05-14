
declare const kyselyDb: any;
declare const sql: any;

export type GetActivityVolumeOptions = {
  search?: string;
  page?: number;
  perPage?: number;
  sortBy?: 'name' | 'createdAt' | 'activityVolume';
  sortOrder?: 'asc' | 'desc';
};

export async function getActivityVolume({
  search = '',
  page = 1,
  perPage = 10,
  sortBy = 'activityVolume',
  sortOrder = 'desc',
}: GetActivityVolumeOptions) {
  const offset = Math.max(page - 1, 0) * perPage;
  return kyselyDb
    .selectFrom('Organisation as o')
    .where((eb: any) =>
      eb.or([
        eb('o.name', 'ilike', `%${search}%`),
      ]),
    )
    .limit(perPage)
    .offset(offset)
    .execute();
}
