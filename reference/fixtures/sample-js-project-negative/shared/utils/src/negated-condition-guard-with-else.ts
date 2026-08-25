export function summarizeAccount(account: { balance: number } | null): string {
  // VIOLATION: code-quality/deterministic/negated-condition
  if (!account) {
    return "missing";
  } else {
    const total = account.balance * 2;
    const half = account.balance / 2;
    const sum = total + half;
    return "balance=" + String(sum);
  }
}
