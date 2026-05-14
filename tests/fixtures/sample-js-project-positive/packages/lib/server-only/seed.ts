
// FP: async function body with await ORM call — not a complex expression
declare const db: { user: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: string } | null> } };

async function seedInitialData() {
  const existingAccount = await db.user.findFirst({
    where: { email: 'admin@example.com' },
  });

  if (!existingAccount) {
    // create default account
  }
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;



// FP: async function body with await call containing query object — not a complex expression
declare const db: { emailDomain: { findMany(args: { where: Record<string, unknown> }): Promise<Array<{ id: string; domain: string }>> } };

async function syncPendingEmailDomains() {
  const pendingDomains = await db.emailDomain.findMany({
    where: { verified: false, syncedAt: null },
  });

  for (const domain of pendingDomains) {
    // process each domain
    void domain;
  }
}

declare const _p: boolean, _q: boolean, _r: boolean, _s: boolean, _t: boolean, _u: boolean;
const _complexCheck = _p && _q && _r || _s && _t || _u && _p && _q;
