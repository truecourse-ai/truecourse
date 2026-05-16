
// [unknown-catch-variable] catch(err) — console.error(err) + fixed 500 (zapier list handler)
declare const db: { document: { findMany(opts: { where: { ownerId: string }; take: number }): Promise<Array<{ id: string; title: string }>> } };
declare function parseAuthHeader(header: string | null): Promise<{ userId: string }>;

export const handleZapierListDocuments = async (req: Request): Promise<Response> => {
  try {
    const authorization = req.headers.get('authorization');
    if (!authorization) {
      return new Response('Unauthorized', { status: 401 });
    }
    const { userId } = await parseAuthHeader(authorization);
    const documents = await db.document.findMany({ where: { ownerId: userId }, take: 100 });
    return Response.json(documents);
  } catch (err) {
    console.error(err);
    return Response.json({ message: 'Internal Server Error' }, { status: 500 });
  }
};
