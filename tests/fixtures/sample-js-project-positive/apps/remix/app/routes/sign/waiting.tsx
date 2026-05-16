declare function loadSigningToken(token: string): Promise<{ docId: string } | null>;
declare function loadSignerProfile(token: string): Promise<{ name: string } | null>;

export async function loader({ params }: { params: { token: string } }) {
  const [tokenData, signerProfile] = await Promise.all([
    loadSigningToken(params.token).catch(() => null),
    loadSignerProfile(params.token).catch(() => null),
  ]);
  return { tokenData, signerProfile };
}
