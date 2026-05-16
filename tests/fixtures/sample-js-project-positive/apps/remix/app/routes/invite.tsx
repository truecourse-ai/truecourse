
declare function json(data: unknown, init?: ResponseInit): Response;
declare const db: { findInvite: (token: string) => Promise<{ id: string } | null> };

export async function loader({ params }: { params: { token: string } }) {
  const invite = await db.findInvite(params.token);
  if (!invite) {
    return json({ error: 'Not found' }, { status: 404 });
  }
  return json({ invite });
}
