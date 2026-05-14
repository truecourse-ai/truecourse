
// --- FP shape: ORM $transaction() with async callback ---
declare const prisma2: {
  $transaction<T>(fn: (tx: typeof prisma2) => Promise<T>): Promise<T>;
  user: { create(args: { data: { email: string; name: string } }): Promise<{ id: number }> };
};

const newUser = await prisma2.$transaction(async (tx) => {
  return tx.user.create({ data: { email: 'user@example.com', name: 'Test User' } });
});
