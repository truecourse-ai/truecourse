declare function countAdminOrganisations(search?: string): Promise<number>;
declare function listAdminOrganisations(search?: string, page?: number): Promise<Array<{ id: string; name: string }>>;

export async function findAdminOrganisations(search?: string, page = 1) {
  const [total, organisations] = await Promise.all([
    countAdminOrganisations(search),
    listAdminOrganisations(search, page),
  ]);
  return { total, organisations };
}
