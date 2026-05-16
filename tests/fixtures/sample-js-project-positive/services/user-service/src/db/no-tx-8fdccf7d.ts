declare const db: { users: { update: (a: unknown) => Promise<unknown> }; accounts: { update: (a: unknown) => Promise<unknown> } };
export async function transferFunds_8fdccf7d(from: string, to: string, amount: number): Promise<void> {
  await db.accounts.update({ where: { id: from }, data: { balance: { decrement: amount } } });
  await db.accounts.update({ where: { id: to }, data: { balance: { increment: amount } } });
}
