const HTTP_NOT_FOUND = 404;
const HTTP_CREATED = 201;
export class UserController {
  private readonly name = 'UserController';
  getAll(): string { return this.name; }
  getById(id: string): string | null {
    if (id.length === 0) return null;
    return `${this.name}:${id}`;
  }
  create(name: string, email: string): { name: string; email: string } {
    return { name: `${this.name}:${name}`, email };
  }
}
export function getStatusCodes(): { notFound: number; created: number } {
  return { notFound: HTTP_NOT_FOUND, created: HTTP_CREATED };
}



// Declare external types and functions for user API mapping
declare interface UserRecord {
  internalId: string;
  publicId: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  lastLogin: Date | null;
}

declare function convertInternalId(internalId: string): string;
declare function fetchUsers(params: { page: number; limit: number }): Promise<{ data: UserRecord[]; total: number }>;

// False positive: properly typed map operation that transforms user records
export async function getUsersForAPI(page: number, limit: number) {
  const { data: users, total } = await fetchUsers({ page, limit });
  
  return {
    users: users.map((user) => ({
      id: convertInternalId(user.internalId),
      publicId: user.publicId,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLogin: user.lastLogin,
    })),
    total,
  };
}



declare function findAdminAuditLogs(opts: {
  query: string;
  page: number;
  perPage: number;
  status?: string;
}): Promise<{ data: unknown[]; total: number }>;

declare const auditSearchParams: { get(key: string): string | null };

export async function listAuditLogsHandler(): Promise<{ data: unknown[]; total: number }> {
  const pageRaw = auditSearchParams.get('page');
  const perPageRaw = auditSearchParams.get('perPage');
  const page = pageRaw ? Number(pageRaw) : undefined;
  const perPage = perPageRaw ? Number(perPageRaw) : undefined;
  const query = auditSearchParams.get('q') ?? '';

  return findAdminAuditLogs({
    query,
    page: page || 1,
    perPage: perPage || 20,
  });
}
