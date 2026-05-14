
// Kysely SQL DSL - column reference strings in whereRef are not magic strings
declare const db: any;

async function findDocumentsWithRecipients(userId: number) {
  return db
    .selectFrom('Document as d')
    .selectAll()
    .innerJoin('Recipient as r', (join) =>
      join
        .onRef('r.documentId', '=', 'd.id')
        .on('r.userId', '=', userId)
    )
    .whereRef('d.userId', '=', 'r.userId')
    .execute();
}
