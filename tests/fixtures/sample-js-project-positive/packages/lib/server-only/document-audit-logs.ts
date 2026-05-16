
// FP: async function with destructured parameter list having 4-6 properties with optional defaults
async function findDocumentAuditLogs({
  userId,
  teamId,
  page = 1,
  perPage = 20,
  orderBy = 'createdAt',
}: {
  userId: string;
  teamId?: string;
  page?: number;
  perPage?: number;
  orderBy?: 'createdAt' | 'action';
}): Promise<{ items: unknown[]; total: number }> {
  return { items: [], total: 0 };
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
