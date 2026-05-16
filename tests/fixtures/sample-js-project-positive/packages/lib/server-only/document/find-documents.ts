
// /d$/ strips trailing 'd' from a period string like '7d' to extract days — ASCII literal match.
export function parsePeriodDays(period: string): number {
  return parseInt(period.replace(/d$/, ''), 10);
}


// Shape: Kysely SQL DSL — column reference strings in .onRef()/.whereRef() are query builder syntax
declare const db: any;

export async function findEnvelopesWithSigners(accountId: number) {
  return db
    .selectFrom('Envelope as e')
    .selectAll()
    .innerJoin('Signer as s', (join) =>
      join
        .onRef('s.envelopeId', '=', 'e.id')
        .on('s.accountId', '=', accountId),
    )
    .whereRef('e.accountId', '=', 's.accountId')
    .execute();
}



// magic-string FP(retry): Kysely .whereRef() column strings — SQL DSL syntax, not magic strings.
// 'Document.ownerId' appears 3× as typed column references in query builder calls.
declare const kyselyDb: any;

export async function findDocumentsByOwner(ownerId: number) {
  return kyselyDb
    .selectFrom('Document')
    .selectAll()
    .where('Document.ownerId', '=', ownerId)
    .whereRef('Document.ownerId', '=', 'Team.ownerId')
    .orderBy('Document.ownerId', 'asc')
    .execute();
}

